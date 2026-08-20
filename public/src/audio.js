// All audio is synthesized with WebAudio — no files. Context is created on
// first user input (autoplay policy).

let ctx = null;
let master, sfxGain, musicGain;
let muted = localStorage.getItem('ninthecho_mute') === '1';
let musicTimer = null;

export function isMuted() { return muted; }

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('ninthecho_mute', muted ? '1' : '0');
  if (master) master.gain.value = muted ? 0 : 0.9;
  return muted;
}

export function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.7;
  sfxGain.connect(master);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.34;
  musicGain.connect(master);
  startMusic();
}

function tone({ f0 = 440, f1 = f0, dur = 0.15, type = 'sine', vol = 0.5, attack = 0.005, dest = null }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(dest || sfxGain);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ dur = 0.2, vol = 0.4, f = 800, q = 1, f1 = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = 'bandpass';
  flt.frequency.setValueAtTime(f, t);
  if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  flt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt).connect(g).connect(sfxGain);
  src.start(t);
}

export const sfx = {
  jump() { tone({ f0: 300, f1: 620, dur: 0.13, type: 'square', vol: 0.12 }); },
  land() { noise({ dur: 0.09, vol: 0.25, f: 250, q: 0.8 }); },
  step() { noise({ dur: 0.04, vol: 0.06, f: 500, q: 1 }); },
  plateOn() { tone({ f0: 720, f1: 980, dur: 0.09, type: 'sine', vol: 0.22 }); },
  plateOff() { tone({ f0: 620, f1: 420, dur: 0.09, type: 'sine', vol: 0.15 }); },
  door() { tone({ f0: 90, f1: 55, dur: 0.35, type: 'sawtooth', vol: 0.22 }); noise({ dur: 0.3, vol: 0.12, f: 180, q: 0.7 }); },
  death() {
    tone({ f0: 420, f1: 80, dur: 0.45, type: 'sawtooth', vol: 0.25 });
    noise({ dur: 0.3, vol: 0.2, f: 300, f1: 90, q: 1 });
  },
  rewind() {
    tone({ f0: 180, f1: 1500, dur: 0.65, type: 'sawtooth', vol: 0.14 });
    noise({ dur: 0.65, vol: 0.18, f: 400, f1: 2400, q: 2 });
  },
  win() {
    if (!ctx) return;
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => tone({ f0: f, dur: 0.3, type: 'triangle', vol: 0.2 }), i * 90));
  },
  tickWarn() { tone({ f0: 1100, f1: 1100, dur: 0.05, type: 'sine', vol: 0.1 }); },
  meow() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(760, t + 0.12);
    o.frequency.linearRampToValueAtTime(360, t + 0.42);
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.setValueAtTime(900, t);
    flt.frequency.linearRampToValueAtTime(500, t + 0.4);
    flt.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(flt).connect(g).connect(sfxGain);
    o.start(t); o.stop(t + 0.5);
  },
};

// --- music: slow minor arpeggio over a deep drone ---

const SCALE = [110, 130.81, 164.81, 196, 220, 261.63, 329.63]; // A minor-ish
let step = 0;

function padNote(f, dur) {
  const t = ctx.currentTime;
  for (const det of [-2, 2]) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.detune.value = det;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 900;
    o.connect(flt).connect(g).connect(musicGain);
    o.start(t); o.stop(t + dur + 0.1);
  }
}

function startMusic() {
  if (musicTimer) return;
  // continuous drone
  const t = ctx.currentTime;
  const drone = ctx.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = 55;
  const dg = ctx.createGain();
  dg.gain.setValueAtTime(0, t);
  dg.gain.linearRampToValueAtTime(0.1, t + 4);
  drone.connect(dg).connect(musicGain);
  drone.start();
  const pattern = [0, 2, 4, 6, 4, 2, 5, 3];
  musicTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    const idx = pattern[step % pattern.length];
    padNote(SCALE[idx] * (step % 16 >= 8 ? 1 : 0.5), 2.2);
    step++;
  }, 1400);
}
