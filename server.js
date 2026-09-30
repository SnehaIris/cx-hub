const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Where link data is stored. By default this is a file inside the app folder,
// which works fine to start but gets reset every time you redeploy on Render's
// free tier. See README.md for how to point this at a persistent disk later.
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// The password people need to add/remove links. Set this as an environment
// variable in Render (never hard-code your real password here).
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || 'changeme';

function readData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Anyone can read the links.
app.get('/api/links', (req, res) => {
  res.json(readData());
});

// Check the edit password without changing anything (used by the "unlock edit" button).
app.post('/api/verify', (req, res) => {
  const { password } = req.body || {};
  res.json({ ok: password === EDIT_PASSWORD });
});

function requirePassword(req, res, next) {
  const pw = req.headers['x-edit-password'];
  if (pw !== EDIT_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect edit password' });
  }
  next();
}

app.post('/api/links', requirePassword, (req, res) => {
  const { category, name, url } = req.body || {};
  if (!category || !name || !url) {
    return res.status(400).json({ error: 'category, name and url are all required' });
  }
  const data = readData();
  if (!data[category]) data[category] = [];
  data[category].push([name, url]);
  writeData(data);
  res.json({ ok: true, data });
});

app.delete('/api/links', requirePassword, (req, res) => {
  const { category, name } = req.body || {};
  const data = readData();
  if (data[category]) {
    data[category] = data[category].filter(([n]) => n !== name);
    if (!data[category].length) delete data[category];
  }
  writeData(data);
  res.json({ ok: true, data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CX Hub listening on port ${PORT}`));
