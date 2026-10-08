const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const STATS_FILE = process.env.STATS_FILE || path.join(__dirname, 'stats.json');
const BUNDLED_SEED_FILE = path.join(__dirname, 'data.json');

// If DATA_FILE points somewhere else (e.g. a persistent disk) and nothing lives
// there yet, seed it from the repo's bundled data.json so a freshly-attached
// disk doesn't start empty and wipe out all the real links.
function seedDataFileIfNeeded() {
  if (DATA_FILE === BUNDLED_SEED_FILE) return; // same file, nothing to seed
  if (fs.existsSync(DATA_FILE)) return; // already has data, don't overwrite
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    if (fs.existsSync(BUNDLED_SEED_FILE)) {
      fs.copyFileSync(BUNDLED_SEED_FILE, DATA_FILE);
      console.log(`Seeded ${DATA_FILE} from bundled data.json`);
    }
  } catch (err) {
    console.error('Could not seed DATA_FILE:', err.message);
  }
}
seedDataFileIfNeeded();
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || 'changeme';

const DOC_TYPES = ['Forms', 'Trackers & Response Sheets', "SOP's", "Doc's & Guides"];
const FLAT_CATEGORIES = ['common-tools'];

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { categoryOrder: ['common-tools', 'dsa', 'cc-borrow', 'dca'], docTypeOrder: {}, items: {} };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function readStats() {
  if (!fs.existsSync(STATS_FILE)) return { dailyViews: {}, linkClicks: {}, deletedLinks: [] };
  const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  if (!stats.deletedLinks) stats.deletedLinks = [];
  return stats;
}
function writeStats(stats) {
  fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}
function todayKey() { return new Date().toISOString().slice(0, 10); }

function requirePassword(req, res, next) {
  if (req.headers['x-edit-password'] !== EDIT_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect edit password' });
  }
  next();
}

// --- Public reads ---
app.get('/api/data', (req, res) => res.json(readData()));

app.post('/api/verify', (req, res) => {
  res.json({ ok: (req.body || {}).password === EDIT_PASSWORD });
});

app.post('/api/track', (req, res) => {
  const { type, key } = req.body || {};
  const stats = readStats();
  if (type === 'pageview') {
    const d = todayKey();
    stats.dailyViews[d] = (stats.dailyViews[d] || 0) + 1;
  } else if (type === 'click' && key) {
    stats.linkClicks[key] = (stats.linkClicks[key] || 0) + 1;
  } else {
    return res.status(400).json({ error: 'Invalid tracking payload' });
  }
  writeStats(stats);
  res.json({ ok: true });
});

// --- Protected: stats ---
app.get('/api/stats', requirePassword, (req, res) => res.json(readStats()));

// --- Protected: add / delete links ---
function getList(data, categoryId, docType) {
  if (FLAT_CATEGORIES.includes(categoryId)) {
    if (!data.items[categoryId]) data.items[categoryId] = [];
    return data.items[categoryId];
  }
  if (!data.items[categoryId]) data.items[categoryId] = {};
  if (!data.items[categoryId][docType]) data.items[categoryId][docType] = [];
  return data.items[categoryId][docType];
}

app.post('/api/links', requirePassword, (req, res) => {
  const { categoryId, docType, name, url } = req.body || {};
  if (!categoryId || !name || !url) return res.status(400).json({ error: 'Missing fields' });
  if (!FLAT_CATEGORIES.includes(categoryId) && !DOC_TYPES.includes(docType)) {
    return res.status(400).json({ error: 'Missing or invalid docType' });
  }
  const data = readData();
  const list = getList(data, categoryId, docType);
  list.push([name, url, new Date().toISOString()]);
  writeData(data);
  res.json({ ok: true, data });
});

app.delete('/api/links', requirePassword, (req, res) => {
  const { categoryId, docType, name, categoryLabel } = req.body || {};
  const data = readData();
  const list = getList(data, categoryId, docType);
  const removed = list.find(([n]) => n === name);
  if (removed) {
    const stats = readStats();
    stats.deletedLinks.unshift({
      categoryId, categoryLabel: categoryLabel || categoryId, docType: docType || null,
      name: removed[0], url: removed[1], deletedAt: new Date().toISOString()
    });
    writeStats(stats);
    const idx = list.indexOf(removed);
    list.splice(idx, 1);
  }
  writeData(data);
  res.json({ ok: true, data });
});

// --- Protected: reordering ---
app.post('/api/reorder', requirePassword, (req, res) => {
  const { scope, categoryId, docType, order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
  const data = readData();

  if (scope === 'category') {
    data.categoryOrder = order;
  } else if (scope === 'docType') {
    if (!data.docTypeOrder) data.docTypeOrder = {};
    data.docTypeOrder[categoryId] = order;
  } else if (scope === 'item') {
    const list = getList(data, categoryId, docType);
    const byName = Object.fromEntries(list.map(entry => [entry[0], entry]));
    const reordered = order.map(name => byName[name]).filter(Boolean);
    // keep any entries not mentioned (safety net) at the end
    list.forEach(entry => { if (!order.includes(entry[0])) reordered.push(entry); });
    if (FLAT_CATEGORIES.includes(categoryId)) {
      data.items[categoryId] = reordered;
    } else {
      data.items[categoryId][docType] = reordered;
    }
  } else {
    return res.status(400).json({ error: 'Invalid scope' });
  }
  writeData(data);
  res.json({ ok: true, data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CX Hub listening on port ${PORT}`));
