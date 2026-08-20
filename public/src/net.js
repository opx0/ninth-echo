// Leaderboard / world-echo client. All calls fail soft — offline play never breaks.
export const GAME_VERSION = 2;

export function encodeRec(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

export function decodeRec(b64) {
  try {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  } catch { return new Uint8Array(0); }
}

export function submitClear({ level, name, lives, ticks, ghosts }) {
  try {
    fetch('/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, name, lives, ticks, ghosts: ghosts.map(encodeRec), v: GAME_VERSION }),
    }).catch(() => {});
  } catch { /* offline */ }
}

const boardCache = new Map();
export async function fetchBoard(level, fresh = false) {
  if (!fresh && boardCache.has(level)) return boardCache.get(level);
  try {
    const r = await fetch(`/api/board/${level}`);
    if (!r.ok) return null;
    const data = await r.json();
    data.echoes = (data.echoes || []).map(e => ({ name: e.name, ghosts: (e.ghosts || []).map(decodeRec) }));
    boardCache.set(level, data);
    return data;
  } catch { return null; }
}
