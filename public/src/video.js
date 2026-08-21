// Cutscene player. Clips live at /video/<id>.mp4 — a missing file rejects
// instantly and the caller falls back to the inked cards, so the game never
// waits on footage that was not shot.
import * as r3d from './render3d.js';

const el = /** @type {HTMLVideoElement} */ (document.getElementById('cine'));
let done = null;

export function playing() { return !!done; }

export function play(id) {
  return new Promise((resolve, reject) => {
    if (!el) { reject(new Error('no element')); return; }
    done = null;
    el.src = `video/${id}.mp4`;
    el.onended = () => finish(resolve);
    el.onerror = () => { cleanup(); reject(new Error('missing')); };
    el.play().then(() => {
      el.style.display = 'block';
      r3d.setVisible(false);
      done = () => finish(resolve);
    }).catch(err => { cleanup(); reject(err); });
  });
}

export function skip() { if (done) done(); }

function finish(resolve) {
  cleanup();
  resolve();
}

function cleanup() {
  done = null;
  el.onended = el.onerror = null;
  el.pause();
  el.style.display = 'none';
  el.removeAttribute('src');
  r3d.setVisible(true);
}

export function preload(id) {
  // one hint to the cache; errors are the fallback working as intended
  fetch(`video/${id}.mp4`, { headers: { Range: 'bytes=0-1' } }).catch(() => {});
}
