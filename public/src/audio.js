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
  // short ramp, not a jump — the bed drones are always sounding
  if (master) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, t + 0.06);
  }
  return muted;
}

export function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  // cavern: dry path + generated-impulse convolver reverb
  const dry = ctx.createGain();
  dry.gain.value = 0.75;
  master.connect(dry).connect(ctx.destination);
  const verb = ctx.createConvolver();
  const dur = 2.6, len = Math.floor(ctx.sampleRate * dur);
  const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  verb.buffer = impulse;
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  master.connect(verb).connect(wet).connect(ctx.destination);
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
  beamWarn() { tone({ f0: 70, f1: 110, dur: 0.7, type: 'sine', vol: 0.22 }); },
  beamStrike() {
    noise({ dur: 0.35, vol: 0.3, f: 1800, f1: 400, q: 1.2 });
    tone({ f0: 1400, f1: 300, dur: 0.3, type: 'sawtooth', vol: 0.12 });
  },
  // the bell: two detuned partials an octave apart, rung through the cavern.
  // Pitch rides the biome root, so the dings darken as you descend.
  bell(vol = 0.3) {
    if (!ctx) return;
    const f = curBed.root * 16;
    const t = ctx.currentTime;
    for (const [mult, v] of [[1, vol], [2.02, vol * 0.45], [2.99, vol * 0.18]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      o.connect(g).connect(sfxGain);
      o.start(t); o.stop(t + 1.5);
    }
  },
  // the last bell of all: one pure octave, the only bright major sound
  bellFinal() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, v, d] of [[880, 0.32, 3.2], [1760, 0.14, 2.6]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(sfxGain);
      o.start(t); o.stop(t + d + 0.1);
    }
  },
  // the ninth ding is silence: duck everything to nothing for one held beat
  hush(hold = 0.9) {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const back = muted ? 0 : 0.9;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0.0001, t + 0.08);
    master.gain.setValueAtTime(0.0001, t + 0.08 + hold);
    master.gain.linearRampToValueAtTime(back, t + 0.08 + hold + 0.6);
  },
  // the mother's song — the falling motif, stated once in major, music-box slow
  lullaby() {
    if (!ctx) return;
    const MAJ = [0, 2, 4, 5, 7, 9, 11, 12];
    const line = [4, 3, 1, 0, 1, 3, 2, 0];
    const t0 = ctx.currentTime;
    line.forEach((d, i) => {
      const f = 440 * Math.pow(2, MAJ[d] / 12);
      const t = t0 + i * 0.62;
      for (const mult of [1, 2]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(mult === 1 ? 0.16 : 0.05, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
        o.connect(g).connect(sfxGain);
        o.start(t); o.stop(t + 1.5);
      }
    });
  },
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

// --- music: one falling-minor theme worn five ways ---
//
// Every biome plays the SAME motif over the SAME chord shape; what changes is
// the root, the colour of the interval, the timbre and the pacing. Degrees are
// semitones over the root and flatten as you descend — natural minor in the
// under-halls, phrygian b2 by the deep, a tritone sitting in the heart — so the
// descent darkens by construction rather than by taste.
const BEDS = {
  under: { root: 55,    deg: [0, 3, 7, 10, 12, 15, 19], colour: 7, cut: 1150, beat: 1400, type: 'triangle', drone: 0.09 },
  bone:  { root: 51.91, deg: [0, 3, 5, 10, 12, 15, 17], colour: 7, cut: 900,  beat: 1550, type: 'sine',     drone: 0.10 },
  root:  { root: 49,    deg: [0, 2, 3, 7, 10, 14, 15],  colour: 5, cut: 760,  beat: 1500, type: 'triangle', drone: 0.11 },
  deep:  { root: 43.65, deg: [0, 1, 3, 8, 10, 13, 15],  colour: 6, cut: 620,  beat: 1200, type: 'sawtooth', drone: 0.12 },
  heart: { root: 41.2,  deg: [0, 1, 3, 6, 8, 12, 13],   colour: 6, cut: 480,  beat: 950,  type: 'sawtooth', drone: 0.14 },
};
const PATTERN = [0, 2, 4, 6, 4, 2, 5, 3];
const MOTIF = [4, 3, 1, 0, 1, 3, 2, 0];   // the theme: a slow falling minor line
let step = 0;
let curKey = 'under', curBed = BEDS.under, curOpts = {};
let bedGain, bedFilt, droneA, droneB, droneAG, droneBG, airGain, menaceGain;

const hz = (b, d, oct) => b.root * Math.pow(2, b.deg[d] / 12) * oct;

export function setMood(key, opts = {}) {
  const b = BEDS[key] || BEDS.under;
  const same = b === curBed && !!opts.interlude === !!curOpts.interlude && !!opts.finale === !!curOpts.finale;
  curKey = BEDS[key] ? key : 'under';
  curBed = b; curOpts = opts;
  if (!ctx || !bedGain || same) return;   // no ctx yet: startMusic picks this up
  applyBed();
  clearInterval(musicTimer);
  musicTimer = setInterval(seqStep, Math.round(b.beat * (opts.finale ? 0.7 : 1)));
}

// crossfade a param: down to silence over `dip`, back up to `v` over `rise`.
// Ramps only, and re-tuning happens at the bottom of the dip, so chambers
// never click into each other.
function fade(p, v, t, dip, rise) {
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(0.0001, t + dip);
  p.linearRampToValueAtTime(v, t + dip + rise);
}
function slide(p, v, t, dt) {
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(v, t + dt);
}

function applyBed() {
  const b = curBed, o = curOpts, t = ctx.currentTime, dip = 0.5, rise = 1.8;
  const lvl = o.interlude ? 0.4 : o.finale ? 1.15 : 1;
  fade(bedGain.gain, lvl, t, dip, rise);
  fade(droneAG.gain, b.drone * (o.interlude ? 0.5 : 1), t, dip, rise);
  fade(droneBG.gain, b.drone * (o.interlude ? 0.25 : 0.5), t, dip, rise);
  droneA.frequency.setValueAtTime(b.root, t + dip);
  droneB.frequency.setValueAtTime(b.root * Math.pow(2, b.colour / 12), t + dip);
  bedFilt.frequency.setValueAtTime(b.cut, t + dip);
  slide(airGain.gain, o.interlude ? 0.06 : 0.01, t, 1.4);   // passages are mostly air
  slide(menaceGain.gain, o.finale ? 0.5 : 0, t, 2.2);
}

function padNote(f, dur) {
  const t = ctx.currentTime;
  for (const det of [-2, 2]) {
    const o = ctx.createOscillator();
    o.type = curBed.type;
    o.frequency.value = f;
    o.detune.value = det;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(bedGain);
    o.start(t); o.stop(t + dur + 0.1);
  }
}

function leadNote(f, dur, vol) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';   // the theme keeps one voice everywhere
  o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(bedGain);
  o.start(t); o.stop(t + dur + 0.1);
}

function seqStep() {
  if (!ctx || ctx.state !== 'running') return;
  const b = curBed;
  if (curOpts.interlude) {
    // a passage is silence with one thought in it: no pad, one note every third
    // beat, left long enough for the cavern to answer it
    if (step % 3 === 0) leadNote(hz(b, MOTIF[((step / 3) | 0) % MOTIF.length], 2), 3.4, 0.075);
  } else {
    padNote(hz(b, PATTERN[step % PATTERN.length], step % 16 >= 8 ? 1 : 0.5), b.beat / 620);
    if (step % 2 === 1) leadNote(hz(b, MOTIF[(step >> 1) % MOTIF.length], 2), 1.9, 0.11);
  }
  step++;
}

function startMusic() {
  if (musicTimer) return;
  bedGain = ctx.createGain();
  bedGain.gain.value = 0;
  bedGain.connect(musicGain);
  bedFilt = ctx.createBiquadFilter();
  bedFilt.type = 'lowpass';
  bedFilt.frequency.value = curBed.cut;
  bedFilt.Q.value = 0.6;
  bedFilt.connect(bedGain);
  // two long-lived drones (root + the biome's interval). Moods re-tune these,
  // they are never rebuilt — nothing here accumulates across a session.
  droneA = ctx.createOscillator();
  droneA.type = 'sine';
  droneA.frequency.value = curBed.root;
  droneAG = ctx.createGain();
  droneAG.gain.value = 0;
  droneA.connect(droneAG).connect(bedFilt);
  droneA.start();
  droneB = ctx.createOscillator();
  droneB.type = 'sine';
  droneB.frequency.value = curBed.root * Math.pow(2, curBed.colour / 12);
  droneB.detune.value = 5;
  droneBG = ctx.createGain();
  droneBG.gain.value = 0;
  droneB.connect(droneBG).connect(bedFilt);
  droneB.start();
  // one looping band of air; the master convolver turns it into cavern tail
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const air = ctx.createBufferSource();
  air.buffer = buf;
  air.loop = true;
  const airFlt = ctx.createBiquadFilter();
  airFlt.type = 'bandpass';
  airFlt.frequency.value = 620;
  airFlt.Q.value = 0.5;
  airGain = ctx.createGain();
  airGain.gain.value = 0.01;
  air.connect(airFlt).connect(airGain).connect(musicGain);
  air.start();
  // the First Cat: a tritone press under the room, breathing on a slow LFO.
  // The LFO rides a pre-gain so the on/off gain can close it completely.
  const men = ctx.createOscillator();
  men.type = 'sawtooth';
  men.frequency.value = BEDS.heart.root * Math.pow(2, 6 / 12);
  const menFlt = ctx.createBiquadFilter();
  menFlt.type = 'lowpass';
  menFlt.frequency.value = 220;
  const pulse = ctx.createGain();
  pulse.gain.value = 0.55;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.42;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.4;
  lfo.connect(lfoG).connect(pulse.gain);
  lfo.start();
  menaceGain = ctx.createGain();
  menaceGain.gain.value = 0;
  men.connect(menFlt).connect(pulse).connect(menaceGain).connect(musicGain);
  men.start();
  applyBed();
  musicTimer = setInterval(seqStep, Math.round(curBed.beat * (curOpts.finale ? 0.7 : 1)));
}

// read-only introspection for the smoke harness (harmless in prod)
export function debug() {
  return ctx && {
    state: ctx.state, mood: curKey, opts: curOpts, master: master.gain.value,
    bed: bedGain.gain.value, drone: droneA.frequency.value, colour: droneB.frequency.value,
    cut: bedFilt.frequency.value, air: airGain.gain.value, menace: menaceGain.gain.value,
    beat: curBed.beat, type: curBed.type,
  };
}
