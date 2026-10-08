const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
// Chart.js served from our own server, so the Activity chart works even where CDNs are blocked
app.use('/vendor/chartjs', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));

const EDIT_PASSWORD = process.env.EDIT_PASSWORD || 'changeme';
const TIME_ZONE = process.env.TIME_ZONE || 'Asia/Kolkata';
const GIST_ID = (process.env.GIST_ID || '').trim();
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const STATS_FILE = process.env.STATS_FILE || path.join(__dirname, 'stats.json');
const SEED_DATA_FILE = path.join(__dirname, 'data.json');
const SEED_STATS_FILE = path.join(__dirname, 'stats.json');

const DOC_TYPES = ['Forms', 'Trackers & Response Sheets', "SOP's", "Doc's & Guides"];
const FLAT_CATEGORIES = ['common-tools'];

if (!process.env.EDIT_PASSWORD) console.warn('WARNING: EDIT_PASSWORD is not set — the default password "changeme" is active.');

// ---------- Dates (local time zone, not UTC) ----------
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
function todayKey() { return dayFmt.format(new Date()); } // YYYY-MM-DD

// ---------- In-memory state ----------
function emptyData() { return { categoryOrder: ['common-tools', 'dsa', 'cc-borrow', 'dca'], docTypeOrder: {}, items: {} }; }
function normalizeData(d) {
  d = d || emptyData();
  if (!Array.isArray(d.categoryOrder)) d.categoryOrder = emptyData().categoryOrder;
  if (!d.docTypeOrder) d.docTypeOrder = {};
  if (!d.items) d.items = {};
  return d;
}
function normalizeStats(s) {
  s = s || {};
  if (!s.dailyViews) s.dailyViews = {};
  if (!s.dailyClicks) s.dailyClicks = {};
  if (!s.linkClicks) s.linkClicks = {};
  if (!Array.isArray(s.deletedLinks)) s.deletedLinks = [];
  return s;
}
let DATA = null;
let STATS = null;

const storage = {
  mode: GIST_ID && GITHUB_TOKEN ? 'gist' : 'file',
  readOnly: false,
  lastSavedAt: null,
  lastError: null,
  dirty: { data: false, stats: false }
};

function readJsonFile(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return text.trim() ? JSON.parse(text) : null;
}

// ---------- Backend: GitHub Gist (survives restarts, sleeps and deploys) ----------
function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cx-hub'
  };
}
const gistBackend = {
  async load() {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: ghHeaders() });
    if (!res.ok) throw new Error(`GitHub returned ${res.status} while loading the gist: ${(await res.text()).slice(0, 200)}`);
    const gist = await res.json();
    const readFile = async (name) => {
      const f = gist.files && gist.files[name];
      if (!f) return null;
      let text = f.content;
      if (f.truncated) {
        const r = await fetch(f.raw_url, { headers: ghHeaders() });
        if (!r.ok) throw new Error(`GitHub returned ${r.status} while loading ${name}`);
        text = await r.text();
      }
      if (!text || !text.trim()) return null;
      try { return JSON.parse(text); }
      catch (e) { throw new Error(`${name} in the gist is not valid JSON (${e.message}). Fix it on gist.github.com.`); }
    };
    return { data: await readFile('data.json'), stats: await readFile('stats.json') };
  },
  async save(names) {
    const files = {};
    if (names.includes('data')) files['data.json'] = { content: JSON.stringify(DATA, null, 2) };
    if (names.includes('stats')) files['stats.json'] = { content: JSON.stringify(STATS, null, 2) };
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ files })
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status} while saving: ${(await res.text()).slice(0, 200)}`);
  }
};

// ---------- Backend: local files (only for running on your own computer) ----------
const fileBackend = {
  async load() { return { data: readJsonFile(DATA_FILE), stats: readJsonFile(STATS_FILE) }; },
  async save(names) {
    if (names.includes('data')) { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(DATA, null, 2)); }
    if (names.includes('stats')) { fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true }); fs.writeFileSync(STATS_FILE, JSON.stringify(STATS, null, 2)); }
  }
};
const backend = storage.mode === 'gist' ? gistBackend : fileBackend;

// ---------- Saving (one save at a time, latest state always wins) ----------
let saveChain = Promise.resolve();
async function flushDirty() {
  const names = Object.keys(storage.dirty).filter(k => storage.dirty[k]);
  if (!names.length) return;
  names.forEach(n => { storage.dirty[n] = false; });
  try {
    await backend.save(names);
    storage.lastSavedAt = new Date().toISOString();
    storage.lastError = null;
  } catch (err) {
    names.forEach(n => { storage.dirty[n] = true; }); // retry later
    storage.lastError = err.message;
    console.error('Save failed:', err.message);
    throw err;
  }
}
function persist(which = []) {
  which.forEach(w => { storage.dirty[w] = true; });
  const p = saveChain.then(flushDirty);
  saveChain = p.catch(() => {});
  return p;
}
// Tracking data is batched; link edits are saved immediately.
setInterval(() => { if (storage.dirty.data || storage.dirty.stats) persist().catch(() => {}); }, 20000);

async function shutdown() {
  const timer = setTimeout(() => process.exit(0), 8000);
  try { await persist(); } catch (e) { /* already logged */ }
  clearTimeout(timer);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ---------- Startup ----------
async function init() {
  let loaded = null;
  for (let attempt = 1; attempt <= 4 && !loaded; attempt++) {
    try { loaded = await backend.load(); }
    catch (err) {
      storage.lastError = err.message;
      console.error(`Loading saved data failed (attempt ${attempt}):`, err.message);
      if (attempt < 4) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  if (!loaded) {
    // Never overwrite saved data with an empty/old copy: show the repo copy read-only until storage works again.
    storage.readOnly = true;
    DATA = normalizeData(readJsonFile(SEED_DATA_FILE));
    STATS = normalizeStats(null);
    console.error('Starting in READ-ONLY mode. Fix GIST_ID / GITHUB_TOKEN and redeploy.');
    return;
  }
  DATA = normalizeData(loaded.data);
  STATS = normalizeStats(loaded.stats);
  if (!loaded.data) {
    DATA = normalizeData(readJsonFile(SEED_DATA_FILE));
    storage.dirty.data = true;
    console.log('No saved links found — seeded from the repo\'s data.json');
  }
  if (!loaded.stats) {
    const seedStats = readJsonFile(SEED_STATS_FILE);
    if (seedStats) { STATS = normalizeStats(seedStats); console.log('Seeded stats from the repo\'s stats.json'); }
    storage.dirty.stats = true;
  }
  if (storage.dirty.data || storage.dirty.stats) await persist().catch(() => {});
  console.log(`Storage: ${storage.mode}${storage.mode === 'file' ? ' (NOT persistent on Render free tier)' : ''}`);
}

// ---------- Helpers ----------
function requirePassword(req, res, next) {
  if (req.headers['x-edit-password'] !== EDIT_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect edit password' });
  }
  next();
}
function requireWritable(req, res, next) {
  if (storage.readOnly) {
    return res.status(503).json({ error: 'Saving is switched off because the hub could not load its saved data. Check GIST_ID / GITHUB_TOKEN on Render.' });
  }
  next();
}
async function saveDataAndRespond(res, which = ['data']) {
  try {
    await persist(which);
    res.json({ ok: true, data: DATA });
  } catch (err) {
    res.status(503).json({ error: 'The change is live but could not be saved permanently yet — it will keep retrying. ' + err.message, data: DATA });
  }
}
function getList(categoryId, docType) {
  if (FLAT_CATEGORIES.includes(categoryId)) {
    if (!Array.isArray(DATA.items[categoryId])) DATA.items[categoryId] = [];
    return DATA.items[categoryId];
  }
  if (!DATA.items[categoryId] || Array.isArray(DATA.items[categoryId])) DATA.items[categoryId] = {};
  if (!DATA.items[categoryId][docType]) DATA.items[categoryId][docType] = [];
  return DATA.items[categoryId][docType];
}
function allDays(stats, today) {
  const keys = [...Object.keys(stats.dailyViews), ...Object.keys(stats.dailyClicks)].sort();
  const first = keys[0] || today;
  const days = [];
  const d = new Date(first + 'T00:00:00Z');
  const end = new Date(today + 'T00:00:00Z');
  while (d <= end && days.length < 3700) { days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return days;
}

// ---------- Public ----------
app.get('/api/data', (req, res) => res.json(DATA));

app.post('/api/verify', (req, res) => {
  res.json({ ok: (req.body || {}).password === EDIT_PASSWORD });
});

app.post('/api/track', (req, res) => {
  const { type, key } = req.body || {};
  if (storage.readOnly) return res.json({ ok: false });
  const d = todayKey();
  if (type === 'pageview') {
    STATS.dailyViews[d] = (STATS.dailyViews[d] || 0) + 1;
  } else if (type === 'click' && key) {
    STATS.linkClicks[key] = (STATS.linkClicks[key] || 0) + 1;
    STATS.dailyClicks[d] = (STATS.dailyClicks[d] || 0) + 1;
  } else {
    return res.status(400).json({ error: 'Invalid tracking payload' });
  }
  storage.dirty.stats = true; // saved in the next batch (every 20s)
  res.json({ ok: true });
});

// ---------- Protected: stats / status / export ----------
app.get('/api/stats', requirePassword, (req, res) => {
  res.json({ ...STATS, today: todayKey(), timeZone: TIME_ZONE });
});

app.get('/api/storage-status', requirePassword, (req, res) => {
  res.json({
    mode: storage.mode, readOnly: storage.readOnly, lastSavedAt: storage.lastSavedAt,
    lastError: storage.lastError, pending: storage.dirty.data || storage.dirty.stats
  });
});

function csvCell(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function csvRow(cells, width) { const r = cells.slice(); while (r.length < width) r.push(''); return r.map(csvCell).join(','); }

// Plain form POST so the browser downloads a real file from the server (works on mobile + desktop).
app.post('/api/export', (req, res) => {
  if ((req.body || {}).password !== EDIT_PASSWORD) return res.status(401).send('Incorrect edit password. Go back and unlock editor mode again.');
  const W = 5;
  const today = todayKey();
  const rows = [];
  rows.push(csvRow(['CX Hub activity export', `Generated ${today} (${TIME_ZONE})`], W));
  rows.push(csvRow([], W));
  rows.push(csvRow(['DAILY ACTIVITY'], W));
  rows.push(csvRow(['Date', 'Page views', 'Link opens'], W));
  allDays(STATS, today).forEach(d => rows.push(csvRow([d, STATS.dailyViews[d] || 0, STATS.dailyClicks[d] || 0], W)));
  rows.push(csvRow([], W));
  rows.push(csvRow(['LINK OPEN COUNTS'], W));
  rows.push(csvRow(['Link', 'Opens'], W));
  Object.entries(STATS.linkClicks).sort((a, b) => b[1] - a[1]).forEach(([k, c]) => rows.push(csvRow([k, c], W)));
  rows.push(csvRow([], W));
  rows.push(csvRow(['REMOVED LINKS'], W));
  rows.push(csvRow(['Category', 'Doc Type', 'Name', 'URL', 'Removed At'], W));
  STATS.deletedLinks.forEach(d => rows.push(csvRow([d.categoryLabel, d.docType || '', d.name, d.url, d.deletedAt], W)));

  const body = '\uFEFF' + rows.join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cx-hub-activity-${today}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(body, 'utf8'));
});

// ---------- Protected: add / delete links ----------
app.post('/api/links', requirePassword, requireWritable, async (req, res) => {
  const { categoryId, docType, name, url } = req.body || {};
  if (!categoryId || !name || !url) return res.status(400).json({ error: 'Missing fields' });
  if (!FLAT_CATEGORIES.includes(categoryId) && !DOC_TYPES.includes(docType)) {
    return res.status(400).json({ error: 'Missing or invalid docType' });
  }
  getList(categoryId, docType).push([name, url, new Date().toISOString()]);
  await saveDataAndRespond(res);
});

app.delete('/api/links', requirePassword, requireWritable, async (req, res) => {
  const { categoryId, docType, name, url, index, categoryLabel } = req.body || {};
  const list = getList(categoryId, docType);
  // Match by position first (handles two links with the same name), then fall back to name + url, then name.
  let idx = Number.isInteger(index) && list[index] && list[index][0] === name ? index : -1;
  if (idx === -1) idx = list.findIndex(([n, u]) => n === name && (!url || u === url));
  if (idx === -1) idx = list.findIndex(([n]) => n === name);
  if (idx === -1) return res.status(404).json({ error: 'That link was not found — it may already have been removed. Refresh the page.', data: DATA });

  const [removed] = list.splice(idx, 1);
  STATS.deletedLinks.unshift({
    categoryId, categoryLabel: categoryLabel || categoryId, docType: docType || null,
    name: removed[0], url: removed[1], deletedAt: new Date().toISOString()
  });
  await saveDataAndRespond(res, ['data', 'stats']);
});

// ---------- Protected: reordering ----------
app.post('/api/reorder', requirePassword, requireWritable, async (req, res) => {
  const { scope, categoryId, docType, order, from, to, name } = req.body || {};

  if (scope === 'category' || scope === 'docType') {
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
    if (scope === 'category') DATA.categoryOrder = order;
    else DATA.docTypeOrder[categoryId] = order;
  } else if (scope === 'item') {
    const list = getList(categoryId, docType);
    if (!Number.isInteger(from) || !Number.isInteger(to) || !list[from] || to < 0 || to >= list.length) {
      return res.status(400).json({ error: 'Invalid positions', data: DATA });
    }
    if (list[from][0] !== name) return res.status(409).json({ error: 'The list changed since you loaded it — refresh and try again.', data: DATA });
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
  } else {
    return res.status(400).json({ error: 'Invalid scope' });
  }
  await saveDataAndRespond(res);
});

const PORT = process.env.PORT || 3000;
init().then(() => {
  app.listen(PORT, () => console.log(`CX Hub listening on port ${PORT}`));
});
