// THE NINTH ECHO server: static hosting + echo/leaderboard API on Firestore.
import express from 'express';
import { Firestore } from '@google-cloud/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, GAME_VERSION } from './public/src/levels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '256kb' }));

let clears = null;
try { clears = new Firestore().collection('clears'); } catch (e) { console.error('firestore init failed', e.message); }
// In-memory store with JSON snapshot on disk — primary persistence on a plain
// VM; Firestore (if creds exist) is a bonus mirror.
const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'clears.json');
let mem = [];
try { mem = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* first boot */ }
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(mem), e => { if (e) console.error('save', e.message); });
  }, 2000);
}
async function saveClear(doc) {
  mem.push(doc);
  if (mem.length > 2000) mem.shift();
  scheduleSave();
  if (clears) { try { await clears.add(doc); } catch (e) { console.error('fs add, disabling firestore:', e.message); clears = null; } }
}
async function loadClears(level, version) {
  if (clears) {
    try {
      const snap = await clears.where('level', '==', level).where('v', '==', version)
        .orderBy('at', 'desc').limit(200).get();
      if (!snap.empty) return snap.docs.map(d => d.data());
    } catch (e) { console.error('fs query, disabling firestore:', e.message); clears = null; }
  }
  return mem.filter(d => d.level === level && d.v === version);
}

const NAME_RE = /^[A-Z0-9]{1,3}$/;

// Submit a clear: arcade initials, lives+ticks score, and the winning loop's
// input recordings so other players can watch real echoes.
app.post('/api/clear', async (req, res) => {
  try {
    const { level, name, lives, ticks, ghosts, v } = req.body || {};
    if (v !== GAME_VERSION) return res.status(400).json({ error: 'version' });
    if (!Number.isInteger(level) || level < 0 || level >= LEVELS.length) return res.status(400).json({ error: 'level' });
    if (typeof name !== 'string' || !NAME_RE.test(name)) return res.status(400).json({ error: 'name' });
    if (!Number.isInteger(lives) || lives < 1 || lives > 9) return res.status(400).json({ error: 'lives' });
    if (!Number.isInteger(ticks) || ticks < 30 || ticks > 9000 * 10) return res.status(400).json({ error: 'ticks' });
    // ghosts: array of base64 input recordings (last one = the winning run)
    if (!Array.isArray(ghosts) || ghosts.length < 1 || ghosts.length > 9) return res.status(400).json({ error: 'ghosts' });
    for (const g of ghosts) {
      if (typeof g !== 'string' || g.length > 4000 || !/^[A-Za-z0-9+/=]*$/.test(g)) return res.status(400).json({ error: 'ghost' });
    }
    await saveClear({ level, name, lives, ticks, ghosts, v, at: Date.now() });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

// Top clears for a level (best = fewest lives, then fewest ticks) + recent runs.
app.get('/api/board/:level', async (req, res) => {
  try {
    const level = parseInt(req.params.level, 10);
    if (!Number.isInteger(level) || level < 0 || level >= LEVELS.length) return res.status(400).json({ error: 'level' });
    const all = await loadClears(level, GAME_VERSION);
    all.sort((a, b) => a.lives - b.lives || a.ticks - b.ticks);
    const top = all.slice(0, 8).map(({ name, lives, ticks }) => ({ name, lives, ticks }));
    // world echoes: up to 3 distinct best runs with recordings
    const echoes = all.slice(0, 3).map(({ name, ghosts }) => ({ name, ghosts }));
    res.json({ top, echoes, total: all.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (r, p) => {
    r.setHeader('Cache-Control', p.includes('/vendor/') ? 'public, max-age=86400' : 'no-cache');
  },
}));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`ninth-echo on :${port}`));
