import { LEVELS, ENDINGS, NARRATOR, LIVES, TILE, COLS, ROWS, MOODS } from './levels.js';
import { World, LOOP_TICKS } from './world.js';
import { Actor, drawCat, L, R, J } from './actors.js';
import * as r3d from './render3d.js';
import { ensure as audioEnsure, sfx, setMood, debug as audioDebug, toggleMute, isMuted } from './audio.js';
import { submitClear, fetchBoard } from './net.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
const ctx = canvas.getContext('2d');
const W = 960, H = 540;
r3d.init(document.getElementById('gl'));

// ---------- input ----------
const held = new Set();
const pressed = new Set();

addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if (!held.has(e.code)) pressed.add(e.code);
  held.add(e.code);
  audioEnsure();
  if (e.code === 'KeyM') sfxSafe(() => toggleMute());
});
addEventListener('keyup', e => held.delete(e.code));
addEventListener('blur', () => { held.clear(); if (state === 'play') state = 'pause'; });

function sfxSafe(f) { try { f(); } catch { /* audio may not exist yet */ } }

function moveMask() {
  let m = 0;
  if (held.has('ArrowLeft') || held.has('KeyA')) m |= L;
  if (held.has('ArrowRight') || held.has('KeyD')) m |= R;
  if (held.has('ArrowUp') || held.has('KeyW') || held.has('Space')) m |= J;
  return m;
}
const wasPressed = c => pressed.has(c);

// ---------- game state ----------
let state = 'title';
let globalT = 0;

let levelIdx = 0;
let world = null;
let player = null;
let ghosts = [];        // [{rec: Uint8Array, len}]
let ghostActors = [];
let recording = null, recLen = 0;
let loopTick = 0;
let lives = LIVES;
let history = [];
let doorSfxDone = [];
let lastWarnSec = -1;
let noLivesFlash = 0;
let hitStop = 0, deathFlash = 0;

let rewindPos = 0, rewindStep = 1, rewindLine = '';
let clearT = 0, clearKind = 'next';
let failT = 0;
let storyChars = 0, storyT = 0;
let endingKind = 'break', endChars = 0;
let endLines = /** @type {string[]} */ ([]);
let mapSel = 0;

let livesSpent = 0;                     // lives left behind across the whole descent
let epiText = '', epiAlpha = 0;         // husk epitaph, faded by proximity
let shardText = '', shardT = 0;
let vigilT = 0, vigilChars = 0, vigilSeen = false;

// storage keys carry the game version — old saves hold indices of a level list
// that has since changed shape, so they are ignored rather than misread
let unlocked = Math.min(parseInt(localStorage.getItem('ninthecho_unlocked5') || '0', 10), LEVELS.length - 1);
mapSel = unlocked;

let totalTicks = 0;
let playerName = localStorage.getItem('ninthecho_name') || '';
let nameChars = '';
let submitted = false;
let board = null, boardLevel = -1;
let claw = parseInt(localStorage.getItem('ninthecho_claw5') || '0', 10);  // bitmask by level idx
const RELIC_LEVELS = LEVELS.flatMap((lv, i) => lv.relic ? [i] : []);
// interludes are passages, not chambers — they take no number, so the finale
// stays the tenth chamber however many shafts sit between the cantos
let chamberN = 0;
const CHAMBER_NO = LEVELS.map(lv => lv.interlude ? 0 : ++chamberN);
const clawCount = () => RELIC_LEVELS.filter(i => claw & (1 << i)).length;
let worldEchoes = [];   // [{name, world, recs, actors}]

function loadBoardFor(level) {
  if (LEVELS[level].interlude) { board = null; boardLevel = level; return; }   // passages are not races
  fetchBoard(level).then(b => { if (b) { board = b; boardLevel = level; } });
}

function makeShadow(echo, idx) {
  const w = new World(LEVELS[idx]);
  return { name: echo.name, world: w, recs: echo.ghosts, actors: echo.ghosts.map(() => new Actor(w, true)) };
}

function resetShadows() {
  for (const se of worldEchoes) {
    se.world.resetLoop();
    se.actors = se.recs.map(() => new Actor(se.world, true));
  }
}

// ---------- flow ----------
function enterLevel(idx) {
  levelIdx = idx;
  world = new World(LEVELS[idx]);
  world.relicTaken = !!(claw & (1 << idx));
  r3d.buildLevel(world);
  sfxSafe(() => setMood(LEVELS[idx].mood, { interlude: !!LEVELS[idx].interlude, finale: !!LEVELS[idx].finale }));
  player = new Actor(world);
  ghosts = [];
  lives = LIVES;
  storyChars = 0;
  storyT = 0;
  epiAlpha = 0;
  totalTicks = 0;
  submitted = false;
  nameChars = '';
  worldEchoes = [];
  if (!LEVELS[idx].interlude) fetchBoard(idx, true).then(b => {
    if (!b || levelIdx !== idx) return;
    worldEchoes = b.echoes.slice(0, 2).map(e => makeShadow(e, idx));
    resetShadows();
    console.log('world echoes loaded:', worldEchoes.map(se => se.name).join(','));
  }).catch(e => console.error('echo load failed', e));
  newLoop();
  // the spent lives come with you into the heart — once per run
  if (LEVELS[idx].finale && !vigilSeen) {
    vigilSeen = true;
    vigilT = 0;
    vigilChars = 0;
    sfxSafe(() => sfx.meow());
    state = 'vigil';
  } else state = 'story';
}

function newLoop() {
  world.resetLoop();
  ghostActors = ghosts.map(() => new Actor(world, true));
  player.reset();
  recording = new Uint8Array(LOOP_TICKS);
  recLen = 0;
  loopTick = 0;
  history = [];
  doorSfxDone = world.doors.map(() => false);
  lastWarnSec = -1;
  resetShadows();
  state = 'play';
}

function startRewind() {
  if (history.length === 0) { finishRewind(); return; }
  // one narrator line, chosen now, held for the whole rewind
  rewindLine = player.alive
    ? NARRATOR.rewind[Math.min(8, LIVES - lives)]
    : NARRATOR.death[ghosts.length % NARRATOR.death.length];
  rewindPos = history.length - 1;
  rewindStep = Math.max(2, Math.ceil(history.length / 40));
  sfxSafe(() => sfx.rewind());
  r3d.shake(7);
  r3d.boostBloom();
  state = 'rewind';
}

function finishRewind() {
  ghosts.push({ rec: recording.slice(0, recLen), len: recLen });
  lives--;
  if (lives <= 0) { failT = 0; state = 'fail'; sfxSafe(() => sfx.death()); }
  else newLoop();
}

function resetRoom() {
  ghosts = [];
  lives = LIVES;
  newLoop();
}

// debug introspection (harmless in prod)
Object.defineProperty(window, 'NL', { value: {
  get state() { return state; },
  get echoes() { return worldEchoes.map(se => ({ name: se.name, n: se.actors.length, a: se.actors.map(x => [x.x | 0, x.y | 0, x.alive, x.frozen]) })); },
  get tick() { return loopTick; },
  get audio() { return audioDebug(); },
} });

// ---------- ticking ----------
function tick() {
  globalT++;
  if (hitStop > 0) { hitStop--; return; }   // impact freeze on death
  if (shardT > 0) shardT--;

  if (state === 'title') {
    if (wasPressed('Enter') || wasPressed('Space')) {
      sfxSafe(() => sfx.meow());
      livesSpent = 0;
      vigilSeen = false;
      state = 'map';
    }
  } else if (state === 'map') {
    if (boardLevel !== mapSel && globalT % 30 === 0) loadBoardFor(mapSel);
    if (wasPressed('ArrowLeft') || wasPressed('KeyA')) { mapSel = Math.max(0, mapSel - 1); sfxSafe(() => sfx.step()); loadBoardFor(mapSel); }
    if (wasPressed('ArrowRight') || wasPressed('KeyD')) { mapSel = Math.min(unlocked, mapSel + 1); sfxSafe(() => sfx.step()); loadBoardFor(mapSel); }
    if (wasPressed('Enter') || wasPressed('Space')) { sfxSafe(() => sfx.plateOn()); enterLevel(mapSel); }
  } else if (state === 'vigil') {
    vigilT++;
    if (vigilT > VIGIL_HOLD) vigilChars += 1.1;
    const total = NARRATOR.vigil.join('').length;
    if (wasPressed('Enter') || wasPressed('Space')) {
      if (vigilChars < total) { vigilT = Math.max(vigilT, VIGIL_HOLD); vigilChars = total; }
      else { storyT = 0; storyChars = 0; state = 'story'; }
    }
  } else if (state === 'story') {
    storyT++;
    const hold = LEVELS[levelIdx].finale ? CARD_HOLD_FINALE : CARD_HOLD;
    if (storyT > hold) storyChars += 1.2;
    const total = LEVELS[levelIdx].story.join('').length;
    if (wasPressed('Enter') || wasPressed('Space') || wasPressed('KeyR')) {
      if (storyChars < total) { storyT = Math.max(storyT, hold); storyChars = total; }
      else state = 'play';
    }
  } else if (state === 'play') {
    tickPlay();
  } else if (state === 'rewind') {
    rewindPos -= rewindStep;
    if (rewindPos <= 0) finishRewind();
  } else if (state === 'clear') {
    const passage = !!LEVELS[levelIdx].interlude;
    if (!playerName && !passage) {
      // first clear ever: arcade initials
      for (const code of pressed) {
        if (/^Key[A-Z]$/.test(code) && nameChars.length < 3) { nameChars += code.slice(3); sfxSafe(() => sfx.step()); }
        else if (/^Digit[0-9]$/.test(code) && nameChars.length < 3) { nameChars += code.slice(5); sfxSafe(() => sfx.step()); }
        else if (code === 'Backspace') nameChars = nameChars.slice(0, -1);
        else if (code === 'Enter' && nameChars.length >= 1) {
          playerName = nameChars;
          localStorage.setItem('ninthecho_name', playerName);
          sfxSafe(() => sfx.plateOn());
        }
      }
      pressed.clear();
      clearT = Math.min(clearT + 1, 35);
      return;
    }
    if (!submitted) {
      submitted = true;
      livesSpent += LIVES - lives + 1;   // banked once — `submitted` holds for the whole clear screen
      if (!passage) {
        const runs = ghosts.map(g => g.rec.slice(0, g.len));
        runs.push(recording.slice(0, recLen));
        submitClear({
          level: levelIdx, name: playerName,
          lives: Math.max(1, LIVES - lives + 1),
          ticks: Math.max(30, totalTicks),
          ghosts: runs.slice(-9),
        });
        boardLevel = -1;   // force the map panel to refetch with this clear included
      }
    }
    clearT++;
    if (clearT > (passage ? 60 : 140)) {
      if (LEVELS[levelIdx].finale) {
        endingKind = clearKind === 'stay' ? 'stay' : clawCount() === RELIC_LEVELS.length ? 'sever' : 'break';
        endLines = ENDINGS[endingKind].map(l => l
          .replace(/\{spent\} lives/g, livesSpent === 1 ? '1 life' : `${livesSpent} lives`)
          .replace(/\{spent\}/g, String(livesSpent)));
        endChars = 0;
        state = 'ending';
      } else {
        unlocked = Math.max(unlocked, levelIdx + 1);
        localStorage.setItem('ninthecho_unlocked5', String(unlocked));
        mapSel = Math.min(levelIdx + 1, LEVELS.length - 1);
        enterLevel(mapSel);   // descend straight into the next chamber
      }
    }
  } else if (state === 'pause') {
    if (wasPressed('Enter') || wasPressed('Space') || wasPressed('Escape') || wasPressed('KeyP')) state = 'play';
    if (wasPressed('KeyQ')) state = 'map';
  } else if (state === 'fail') {
    failT++;
    if (failT > 130) resetRoom();
  } else if (state === 'ending') {
    endChars += 0.9;
    const total = endLines.join('').length;
    if (wasPressed('Enter') || wasPressed('Space')) {
      if (endChars < total) endChars = total;
      else { state = 'title'; mapSel = unlocked; }
    }
  }

  pressed.clear();
}

const DEBUG_MODE = new URLSearchParams(location.search).has('debug');

function tickPlay() {
  if (wasPressed('Escape') || wasPressed('KeyP')) { state = 'pause'; return; }
  if (DEBUG_MODE && wasPressed('KeyL') && world.relic) {
    player.x = world.relic.c * TILE + 4;
    player.y = world.relic.r * TILE + 2;
    player.vy = 0;
  }
  if (DEBUG_MODE && wasPressed('KeyK')) {
    const e = world.exits.find(x => x.kind !== 'stay') || world.exits[0];
    clearT = 0; clearKind = e.kind;
    sfxSafe(() => sfx.win());
    submitted = true;   // a forced clear never reaches the public board
    state = 'clear';
    return;
  }

  const mask = moveMask();
  if (recLen < LOOP_TICKS) recording[recLen++] = mask;
  totalTicks++;

  // world echoes replay in their own shadow worlds — they can never touch your puzzle
  for (const se of worldEchoes) {
    se.world.tickBoxes();
    const shAlive = [];
    se.actors.forEach((a, i) => {
      const rec = se.recs[i];
      if (!a.alive) { a.tick(0); return; }
      a.frozen = loopTick >= rec.length;
      a.tick(a.frozen ? 0 : rec[loopTick]);
      if (se.world.hitsBeam(a, loopTick)) a.die();
      if (a.alive && !a.frozen && se.world.hitsSpike(a)) a.die();
      if (a.alive) shAlive.push(a);
    });
    se.world.tickPlatesAndDoors(shAlive);
  }

  world.tickBoxes();

  // ghosts replay oldest-first, then the player — fixed order keeps physics deterministic
  const alive = [];
  ghostActors.forEach((a, i) => {
    const g = ghosts[i];
    if (!a.alive) { a.tick(0); return; }
    if (loopTick < g.len) a.frozen = false;
    else a.frozen = true;
    a.tick(a.frozen ? 0 : g.rec[loopTick]);
    if (world.hitsBeam(a, loopTick)) {
      a.die();
      r3d.burst(a.x + a.w / 2, a.y + a.h / 2, 0xffb0a0, 14, 3);
    }
    if (a.alive && !a.frozen && world.hitsSpike(a)) {
      a.die();
      r3d.burst(a.x + a.w / 2, a.y + a.h / 2, 0x8ce6ff, 12, 2.2);
    }
    if (a.alive) alive.push(a);
  });

  const ev = player.tick(player.alive ? mask : 0);
  if (ev.jumped) sfxSafe(() => sfx.jump());
  if (ev.landed) { sfxSafe(() => sfx.land()); r3d.burst(player.x + player.w / 2, player.y + player.h, 0x9fc4ff, 6, 1.1, 16); }
  if (ev.step) sfxSafe(() => sfx.step());
  if (player.alive) alive.push(player);

  const prevPressed = world.plates.map(p => p.pressed);
  world.tickPlatesAndDoors(alive);
  world.plates.forEach((p, i) => {
    if (p.pressed && !prevPressed[i]) sfxSafe(() => sfx.plateOn());
    if (!p.pressed && prevPressed[i]) sfxSafe(() => sfx.plateOff());
  });
  world.doors.forEach((d, i) => {
    if (d.open > 0.15 && !doorSfxDone[i]) {
      doorSfxDone[i] = true;
      sfxSafe(() => sfx.door());
      r3d.burst(d.c * TILE + TILE / 2, d.r * TILE + TILE / 2, 0x9fe8ff, 16, 2.5, 40);
      r3d.pulse(0.45);
      r3d.shake(2);
    }
    if (d.open < 0.1) doorSfxDone[i] = false;
  });

  if (player.alive && world.hitsBeam(player, loopTick)) {
    player.die();
    sfxSafe(() => sfx.death());
    hitStop = 6;
    deathFlash = 5;
    r3d.shake(10);
    r3d.burst(player.x + player.w / 2, player.y + player.h / 2, 0xffb0a0, 22, 3.5);
  }
  if (player.alive && world.hitsSpike(player)) {
    player.die();
    sfxSafe(() => sfx.death());
    hitStop = 6;
    deathFlash = 5;
    r3d.shake(10);
    r3d.burst(player.x + player.w / 2, player.y + player.h / 2, 0xff8f8f, 22, 3.5);
  }

  if (player.alive && world.relic && !world.relicTaken) {
    const rx = world.relic.c * TILE, ry = world.relic.r * TILE;
    if (player.x < rx + TILE && player.x + player.w > rx && player.y < ry + TILE && player.y + player.h > ry) {
      world.relicTaken = true;
      shardText = LEVELS[levelIdx].shard || '';
      shardT = SHARD_TICKS;
      claw |= 1 << levelIdx;
      localStorage.setItem('ninthecho_claw5', String(claw));
      r3d.collectRelic();
      r3d.burst(rx + TILE / 2, ry + TILE / 2, 0xffd8a0, 26, 3.5, 50);
      r3d.pulse(0.6);
      sfxSafe(() => sfx.win());
    }
  }

  if (player.alive) {
    const e = world.exitHit(player);
    if (e) {
      clearT = 0;
      clearKind = e.kind;
      r3d.burst(e.c * TILE + TILE / 2, e.r * TILE + TILE / 2, e.kind === 'stay' ? 0xffcf8a : 0xeaffff, 34, 4, 55);
      sfxSafe(() => sfx.win());
      if (LEVELS[levelIdx].finale) {
        if (e.kind === 'stay') r3d.loomStay(); else { r3d.loomBreak(); sfxSafe(() => sfx.death()); if (clawCount() === RELIC_LEVELS.length) r3d.shake(16); }
      }
      state = 'clear';
      return;
    }
  }

  history.push({
    p: [player.x, player.y, player.face, player.phase, player.alive],
    g: ghostActors.map(a => [a.x, a.y, a.face, a.phase, a.alive, a.frozen]),
    w: world.snapshot(),
  });
  loopTick++;

  // First Cat gaze audio cues
  for (const b of (world.def.beams || []))
    for (const t0 of b.times) {
      if (loopTick === t0) sfxSafe(() => sfx.beamWarn());
      if (loopTick === t0 + 50) { sfxSafe(() => sfx.beamStrike()); r3d.shake(4); }
    }

  // countdown warning beeps in the last 3 seconds
  const secLeft = Math.ceil((LOOP_TICKS - loopTick) / 60);
  if (secLeft <= 3 && secLeft !== lastWarnSec) { lastWarnSec = secLeft; sfxSafe(() => sfx.tickWarn()); }

  if (!player.alive && player.deathT > 45) { startRewind(); return; }

  if (wasPressed('KeyR')) {
    if (lives > 1) { startRewind(); return; }
    noLivesFlash = 60;
    r3d.shake(3);
  }
  if (noLivesFlash > 0) noLivesFlash--;

  if (loopTick >= LOOP_TICKS) startRewind();
}

// ---------- drawing ----------
function draw() {
  ctx.clearRect(0, 0, W, H);

  if (state === 'title') drawTitle();
  else if (state === 'map') drawMap();
  else if (state === 'vigil') drawVigil();
  else if (state === 'story') drawStory();
  else if (state === 'ending') drawEnding();
  else drawScene();

  if (state === 'pause') {
    ctx.fillStyle = 'rgba(4,7,14,0.66)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#dff2ff';
    ctx.font = 'bold 30px monospace';
    ctx.fillText('PAUSED', W / 2, H / 2 - 20);
    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(170,210,240,0.75)';
    ctx.fillText('ENTER resume · Q atlas · M mute', W / 2, H / 2 + 16);
    ctx.fillText('the loop waits for no one — except now', W / 2, H / 2 + 44);
  }

  drawVignette();
}

function drawScene() {
  let cats = [];
  let px = player.x + 11, py = player.y + 26;

  if (state === 'rewind' && history.length) {
    const f = history[Math.max(0, Math.min(history.length - 1, Math.round(rewindPos)))];
    world.applySnapshot(f.w);
    f.g.forEach(g => {
      if (g[4]) cats.push({ x: g[0] + 11, y: g[1] + 26, face: g[2], phase: g[3], vy: 0, opts: { ghost: true, frozen: g[5], alpha: 0.55, grounded: true } });
    });
    if (f.p[4]) {
      cats.push({ x: f.p[0] + 11, y: f.p[1] + 26, face: f.p[2], phase: f.p[3], vy: 0, opts: { grounded: true, alpha: 1 } });
      px = f.p[0] + 11; py = f.p[1] + 26;
    }
    r3d.streaks();
  } else {
    // every cat in the chamber flinches while a warden's gaze is winding up
    const wary = world.beamPhase(loopTick).some(b => b.warn);
    for (const se of worldEchoes) {
      const a = se.actors[se.actors.length - 1];
      if (!a || !a.alive) continue;
      cats.push({
        x: a.x + a.w / 2, y: a.y + a.h, face: a.face, phase: a.phase, vy: a.vy, z: 3,
        opts: { ghost: true, remote: true, frozen: a.frozen, grounded: a.grounded, running: a.grounded && Math.abs(a.vx) > 0.3, idle: a.idleT > 90, wary, alpha: 0.34 },
      });
    }
    ghostActors.forEach(a => {
      if (!a.alive && a.deathT > 40) return;
      cats.push({
        x: a.x + a.w / 2, y: a.y + a.h, face: a.face, phase: a.phase, vy: a.vy,
        opts: { ghost: true, frozen: a.frozen, dead: !a.alive, deathT: a.deathT, squash: a.squash, grounded: a.grounded, running: a.grounded && Math.abs(a.vx) > 0.3, idle: a.idleT > 90, wary, alpha: a.frozen ? 0.62 : 0.5 },
      });
    });
    if (player.alive || player.deathT <= 40) {
      cats.push({
        x: player.x + player.w / 2, y: player.y + player.h, face: player.face, phase: player.phase, vy: player.vy,
        opts: { dead: !player.alive, deathT: player.deathT, squash: player.squash, grounded: player.grounded, running: player.grounded && Math.abs(player.vx) > 0.3, idle: player.idleT > 90, wary, alpha: 1 },
      });
    }
  }

  r3d.render(globalT, world, cats, px, py, state === 'rewind' ? -1 : loopTick);

  if (deathFlash > 0) {
    ctx.fillStyle = `rgba(255,235,235,${deathFlash * 0.09})`;
    ctx.fillRect(0, 0, W, H);
    deathFlash--;
  }

  // 2D overlay (canvas already cleared transparent in draw())
  if (state === 'rewind') {
    ctx.fillStyle = 'rgba(160,240,255,0.9)';
    ctx.font = '28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('\u27f2  ' + rewindLine, W / 2, H / 2 - 100);
  }

  // husk epitaphs \u2014 the dead speak when you stand close enough to read them
  let nearEpi = '';
  if (state === 'play') {
    const pcx = player.x + player.w / 2, pcy = player.y + player.h / 2;
    for (const h of (world.def.husks || [])) {
      const line = h[2];
      if (typeof line !== 'string') continue;
      const hx = Number(h[0]) * TILE + TILE / 2, hy = Number(h[1]) * TILE + TILE / 2;
      if (Math.hypot(pcx - hx, pcy - hy) < TILE * 2.5) { nearEpi = line; break; }
    }
  }
  if (nearEpi) epiText = nearEpi;
  epiAlpha += ((nearEpi ? 1 : 0) - epiAlpha) * 0.09;
  if (epiText && epiAlpha > 0.02) {
    ctx.font = 'italic 15px Georgia, serif';
    ctx.textAlign = 'center';
    // the chamber glow sits right at floor level, so the inscription needs its own dark
    const wide = ctx.measureText(epiText).width / 2 + 40;
    const scrim = ctx.createLinearGradient(W / 2 - wide, 0, W / 2 + wide, 0);
    scrim.addColorStop(0, 'rgba(6,9,16,0)');
    scrim.addColorStop(0.5, `rgba(6,9,16,${epiAlpha * 0.78})`);
    scrim.addColorStop(1, 'rgba(6,9,16,0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(W / 2 - wide, H - 66, wide * 2, 28);
    ctx.fillStyle = `rgba(214,224,240,${epiAlpha * 0.92})`;
    ctx.fillText(epiText, W / 2, H - 47);
  }

  // claw shard, named as it is taken
  if (shardText && shardT > 0) {
    ctx.save();
    ctx.font = '17px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,216,160,${Math.min(1, Math.min(shardT, SHARD_TICKS - shardT) / 30)})`;
    ctx.shadowColor = '#ffc060';
    ctx.shadowBlur = 10;
    ctx.fillText(shardText, W / 2, H / 2 - 60);
    ctx.restore();
  }

  drawHud();

  if (state === 'clear') {
    const k = Math.min(1, clearT / 30);
    ctx.fillStyle = `rgba(10,16,30,${k * 0.6})`;
    ctx.fillRect(0, 0, W, H);
    if (LEVELS[levelIdx].interlude) return;   // a passage just fades on down
    ctx.fillStyle = clearKind === 'stay' ? '#ffcf8a' : '#eaffff';
    ctx.globalAlpha = k;
    ctx.font = '34px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(LEVELS[levelIdx].finale ? '...' : 'CHAMBER CLEARED', W / 2, H / 2 - 10);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#8fb8d8';
    if (!playerName) {
      const slots = (nameChars + '___').slice(0, 3).split('').join(' ');
      ctx.fillText('leave your mark (3 letters):', W / 2, H / 2 + 24);
      ctx.font = '28px monospace';
      ctx.fillStyle = '#eaffff';
      ctx.fillText(slots, W / 2, H / 2 + 58);
      ctx.font = '13px monospace';
      ctx.fillStyle = '#7fa8c8';
      ctx.fillText('type letters \u00b7 ENTER to confirm \u2014 your echo joins the world', W / 2, H / 2 + 84);
    } else if (!LEVELS[levelIdx].finale) {
      ctx.fillText(`lives spent here: ${LIVES - lives + 1} \u00b7 time ${(totalTicks / 60).toFixed(1)}s`, W / 2, H / 2 + 24);
    }
    ctx.globalAlpha = 1;
  }

  if (state === 'fail') {
    const k = Math.min(1, failT / 25);
    ctx.fillStyle = `rgba(20,6,10,${k * 0.75})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = k;
    ctx.fillStyle = '#ff9f9f';
    ctx.font = '30px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(NARRATOR.fail.title, W / 2, H / 2 - 10);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#c9a8b8';
    ctx.fillText(NARRATOR.fail.sub, W / 2, H / 2 + 24);
    ctx.globalAlpha = 1;
  }
}

function drawHud() {
  const lv = LEVELS[levelIdx];
  // a passage has nothing to fail, so it gets no countdown and no life pips —
  // the loop still turns underneath, it just stops shouting about it
  if (!lv.interlude) drawLoopHud();

  // level name + keys — passages are between the cantos and take no number
  ctx.fillStyle = 'rgba(160,200,235,0.75)';
  ctx.font = '14px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(lv.interlude ? lv.name : `${CHAMBER_NO[levelIdx]} · ${lv.name}`, W - 20, 26);
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(140,180,215,0.5)';
  ctx.fillText('R rewind · ESC map · M mute', W - 20, 44);

  // claw assembly
  if (clawCount() > 0) {
    ctx.save();
    ctx.textAlign = 'right';
    for (let i = 0; i < RELIC_LEVELS.length; i++) {
      const cx2 = W - 30 - i * 16, cy2 = 62;
      const have = i < clawCount();
      ctx.strokeStyle = have ? '#ffd8a0' : 'rgba(140,120,90,0.35)';
      if (have) { ctx.shadowColor = '#ffc060'; ctx.shadowBlur = 6; } else ctx.shadowBlur = 0;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx2 - 5, cy2, 7, -0.9, 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  // hint
  ctx.textAlign = 'center';
  ctx.font = '14px monospace';
  ctx.fillStyle = 'rgba(170,210,240,0.55)';
  ctx.fillText(lv.hint, W / 2, H - 16);
}

function drawLoopHud() {
  // lives — cat-head pips
  for (let i = 0; i < LIVES; i++) {
    const x = 22 + i * 22, y = 22;
    const alive = i < lives;
    ctx.save();
    ctx.globalAlpha = alive ? 0.95 : 0.22;
    if (alive) { ctx.shadowColor = '#7fe3ff'; ctx.shadowBlur = 6; }
    ctx.fillStyle = alive ? '#a5e8ff' : '#3a4a63';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.moveTo(x - 6, y - 3); ctx.lineTo(x - 6, y - 10); ctx.lineTo(x - 1, y - 5.5);
    ctx.moveTo(x + 6, y - 3); ctx.lineTo(x + 6, y - 10); ctx.lineTo(x + 1, y - 5.5);
    ctx.fill();
    ctx.restore();
  }
  if (worldEchoes.length) {
    ctx.fillStyle = 'rgba(255,205,130,0.75)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('world echoes: ' + worldEchoes.map(se => se.name).join(' \u00b7 '), 22, 48);
  }
  if (noLivesFlash > 0 && (noLivesFlash >> 2) % 2 === 0) {
    ctx.fillStyle = '#ff9f9f';
    ctx.font = '13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('last life — no rewinds left', 22, 48);
  }

  // loop timer arc
  const frac = loopTick / LOOP_TICKS;
  const secLeft = Math.max(0, (LOOP_TICKS - loopTick) / 60);
  const urgent = secLeft < 3;
  ctx.save();
  ctx.strokeStyle = 'rgba(120,180,230,0.25)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(W / 2, 30, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = urgent ? '#ff9f7f' : '#7fe3ff';
  if (urgent) ctx.shadowColor = '#ff9f7f', ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(W / 2, 30, 16, -Math.PI / 2, -Math.PI / 2 + (1 - frac) * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = urgent ? '#ffcbb3' : '#bfe8ff';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(secLeft.toFixed(0), W / 2, 34);
  ctx.restore();
}

function drawTitle() {
  r3d.renderMenu(globalT);
  ctx.fillStyle = 'rgba(4,6,12,0.5)';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, 285);
  ctx.scale(3.2, 3.2);
  drawCat(ctx, 0, 0, Math.sin(globalT * 0.005) > 0 ? 1 : -1, globalT * 0.03, 0, { grounded: true });
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.save();
  ctx.shadowColor = '#7fe3ff';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#eaffff';
  ctx.font = 'bold 64px monospace';
  ctx.fillText('THE NINTH ECHO', W / 2, 130);
  ctx.restore();
  ctx.fillStyle = '#8fc3e8';
  ctx.font = '17px monospace';
  ctx.fillText('a 15-second loop · nine lives · one way out', W / 2, 165);

  ctx.fillStyle = `rgba(200,240,255,${0.6 + Math.sin(globalT * 0.06) * 0.35})`;
  ctx.font = '18px monospace';
  ctx.fillText('press ENTER', W / 2, 420);
  ctx.fillStyle = 'rgba(140,180,215,0.55)';
  ctx.font = '13px monospace';
  ctx.fillText('←→ move · ↑ jump · R rewind time (a life stays behind and repeats your run)', W / 2, 460);
  ctx.fillText('made for BTT Web Game Jam — Summer 2026', W / 2, 500);
}

// --- atlas: hand-inked cartography, not UI boxes ---
let paperTex = null;
function paper() {
  if (paperTex) return paperTex;
  paperTex = document.createElement('canvas');
  paperTex.width = paperTex.height = 192;
  const g = paperTex.getContext('2d');
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(${180 + Math.random() * 60},${190 + Math.random() * 50},${215 + Math.random() * 40},${0.015 + Math.random() * 0.03})`;
    g.fillRect(Math.random() * 192, Math.random() * 192, 1.3, 1.3);
  }
  g.strokeStyle = 'rgba(160,180,210,0.03)';
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    const y0 = Math.random() * 192;
    g.moveTo(0, y0);
    g.bezierCurveTo(60, y0 + 20 * (Math.random() - 0.5), 130, y0 + 20 * (Math.random() - 0.5), 192, y0 + 12 * (Math.random() - 0.5));
    g.stroke();
  }
  return paperTex;
}

// A chamber's plan, drawn small from its own grid: solid rock, the spikes in
// it, the doors and seals, and the way out. Scaled to fit the atlas room.
function surveyPlan(lv, x, y, w, h, aHex, cleared) {
  const g = lv.grid;
  const padX = 7, padY = 6;
  const sx = (w - padX * 2) / COLS, sy = (h - padY * 2) / ROWS;
  const ox = x + padX, oy = y + padY;
  ctx.save();
  const solid = aHex + (cleared ? '62' : '3e');
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      const ch = g[r][c];
      if (ch === '#') { ctx.fillStyle = solid; ctx.fillRect(ox + c * sx, oy + r * sy, sx + 0.4, sy + 0.4); }
      else if (ch === '^') { ctx.fillStyle = 'rgba(255,150,140,0.72)'; ctx.fillRect(ox + c * sx, oy + r * sy + sy * 0.4, sx + 0.3, sy * 0.6); }
      else if (ch >= 'A' && ch <= 'C') { ctx.fillStyle = 'rgba(150,225,255,0.62)'; ctx.fillRect(ox + c * sx, oy + r * sy, sx + 0.3, sy + 0.3); }
      else if (ch >= 'a' && ch <= 'c') { ctx.fillStyle = 'rgba(150,225,255,0.85)'; ctx.fillRect(ox + c * sx, oy + r * sy + sy * 0.5, sx + 0.3, sy * 0.5); }
      else if (ch === 'X') { ctx.fillStyle = 'rgba(210,190,160,0.6)'; ctx.fillRect(ox + c * sx, oy + r * sy, sx + 0.3, sy + 0.3); }
    }
  }
  // the ways out, and the way in
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      const ch = g[r][c];
      if (ch !== 'E' && ch !== 'O' && ch !== 'S') continue;
      ctx.fillStyle = ch === 'S' ? 'rgba(210,230,250,0.55)' : ch === 'O' ? '#ffcf8a' : '#eaffff';
      ctx.beginPath();
      ctx.arc(ox + (c + 0.5) * sx, oy + (r + 0.5) * sy, ch === 'S' ? 1.2 : 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// where a corridor meets a chamber: the point on its wall facing the next room
function edgePoint(r, tx, ty) {
  const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
  const dx = tx - cx, dy = ty - cy;
  const s = Math.min(dx ? (r[2] / 2) / Math.abs(dx) : 1e9, dy ? (r[3] / 2) / Math.abs(dy) : 1e9);
  return [cx + dx * s, cy + dy * s];
}

// one wall of a winding passage; `side` picks which wall. Same seed, same
// wander, every frame.
function corridorPath(ax, ay, bx, by, seed, side) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const bow = Math.sin(seed * 2.7) * Math.min(34, len * 0.24);
  const steps = Math.max(10, Math.round(len / 12));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bend = Math.sin(Math.PI * t) * bow;
    const half = 3.6 + Math.sin(seed * 1.7 + t * 6.1) * 1.3;
    const wob = Math.sin(seed * 5.3 + t * 11.4) * 1.5 + Math.sin(seed * 2.1 + t * 23.7) * 0.7;
    const off = side * half + wob;
    const px2 = ax + dx * t + nx * (bend + off);
    const py2 = ay + dy * t + ny * (bend + off);
    if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
  }
}

// jittered organic room outline — same seed, same wobble, every frame
function roomPath(x, y, w, h, seed) {
  const jit = (k) => Math.sin(seed * 13.7 + k * 2.31) * 4.2 + Math.sin(seed * 5.1 + k * 4.7) * 2.1 + Math.sin(seed * 2.3 + k * 1.13) * 2.6;
  const pts = [];
  const per = 2 * (w + h);
  const step = 13;
  for (let d = 0; d < per; d += step) {
    let px2, py2, nx2, ny2;
    if (d < w) { px2 = x + d; py2 = y; nx2 = 0; ny2 = -1; }
    else if (d < w + h) { px2 = x + w; py2 = y + (d - w); nx2 = 1; ny2 = 0; }
    else if (d < 2 * w + h) { px2 = x + w - (d - w - h); py2 = y + h; nx2 = 0; ny2 = 1; }
    else { px2 = x; py2 = y + h - (d - 2 * w - h); nx2 = -1; ny2 = 0; }
    const j = jit(d / step);
    pts.push([px2 + nx2 * j, py2 + ny2 * j]);
  }
  ctx.beginPath();
  ctx.moveTo((pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  ctx.closePath();
}

// an interlude is not a room but a shaft: two ragged walls and the air between
function shaftPath(x, y, w, h, seed) {
  const jit = (k) => Math.sin(seed * 9.3 + k * 1.71) * 2.1 + Math.sin(seed * 3.7 + k * 3.9) * 1;
  const n = Math.max(4, Math.round(h / 15));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) ctx.lineTo(x + jit(i), y + (h * i) / n);
  for (let i = n; i >= 0; i--) ctx.lineTo(x + w + jit(i + 41), y + (h * i) / n);
  ctx.closePath();
}

function drawMap() {
  // ink-dark parchment ground
  ctx.fillStyle = '#0a0d16';
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createRadialGradient(W / 2, H / 2 - 30, 60, W / 2, H / 2, 640);
  wash.addColorStop(0, 'rgba(70,88,120,0.14)');
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.8;
  for (let ty = 0; ty < H; ty += 192)
    for (let tx = 0; tx < W; tx += 192) ctx.drawImage(paper(), tx, ty);
  ctx.globalAlpha = 1;

  // ornamented title
  ctx.textAlign = 'center';
  ctx.fillStyle = '#cfdcec';
  ctx.font = '24px Georgia, serif';
  ctx.fillText('T H E   L O O M', W / 2, 46);
  ctx.strokeStyle = 'rgba(170,190,215,0.4)';
  ctx.lineWidth = 1;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + dir * 130, 40);
    ctx.lineTo(W / 2 + dir * 250, 40);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2 + dir * 258, 40, 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(150,170,195,0.5)';
  ctx.font = 'italic 12px Georgia, serif';
  ctx.fillText('descend, chamber by chamber', W / 2, 66);

  const hex = n => '#' + n.toString(16).padStart(6, '0');

  // corridors: passages bored through rock, not ruled lines — they leave a
  // chamber at its wall, bow off the straight, and wander on the way over
  for (let i = 1; i < LEVELS.length; i++) {
    const ra = LEVELS[i - 1].atlas, rb = LEVELS[i].atlas;
    const [ax, ay] = edgePoint(ra, rb[0] + rb[2] / 2, rb[1] + rb[3] / 2);
    const [bx2, by2] = edgePoint(rb, ra[0] + ra[2] / 2, ra[1] + ra[3] / 2);
    const open = i <= unlocked;
    ctx.strokeStyle = open ? 'rgba(150,170,200,0.4)' : 'rgba(110,125,150,0.14)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash(open ? [] : [3, 5]);
    for (const sgn of [1, -1]) {
      corridorPath(ax, ay, bx2, by2, i, sgn);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  LEVELS.forEach((lv, i) => {
    const [x, y, w, h] = lv.atlas;
    const cleared = i < unlocked;
    const locked = i > unlocked;
    const accent = MOODS[lv.mood].accent;
    const aHex = hex(accent);

    if (lv.interlude) {
      if (locked) {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(120,135,160,0.22)';
        ctx.lineWidth = 1;
        shaftPath(x, y, w, h, i);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        shaftPath(x, y, w, h, i);
        ctx.fillStyle = '#0d1220';
        ctx.fill();
        // the shaft brightens downward, toward the biome it opens into
        const gl3 = ctx.createLinearGradient(0, y, 0, y + h);
        gl3.addColorStop(0, aHex + '0e');
        gl3.addColorStop(1, aHex + (cleared ? '3c' : '24'));
        ctx.fillStyle = gl3;
        ctx.fill();
        shaftPath(x, y, w, h, i);
        ctx.strokeStyle = i === mapSel ? '#e8f2fa' : aHex + '99';
        ctx.lineWidth = i === mapSel ? 1.6 : 1;
        ctx.stroke();
        // scoring down the walls — no floor line, a fall has no floor to survey
        ctx.strokeStyle = aHex + '44';
        ctx.lineWidth = 1;
        for (let d = 11; d < h - 8; d += 14) {
          ctx.beginPath();
          ctx.moveTo(x + 2, y + d);
          ctx.lineTo(x + w - 2, y + d + 4);
          ctx.stroke();
        }
      }
      if (i === mapSel) {
        drawCat(ctx, x + w / 2, y - 6, 1, globalT * 0.03, 0, { grounded: true });
        ctx.fillStyle = '#e8f2fa';
        ctx.font = '12px Georgia, serif';
        ctx.fillText(lv.name, x + w / 2, y + h + 15);
      } else if (!locked) {
        ctx.fillStyle = 'rgba(175,195,215,0.5)';
        ctx.font = '10px Georgia, serif';
        ctx.fillText(lv.name, x + w / 2, y + h + 13);
      }
      return;
    }

    if (locked) {
      // unexplored: faint dashed outline only
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(120,135,160,0.22)';
      ctx.lineWidth = 1;
      roomPath(x, y, w, h, i);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // opaque ink base hides corridor lines under the chamber…
      roomPath(x, y, w, h, i);
      ctx.fillStyle = '#0d1220';
      ctx.fill();
      // …then the muted region tint
      roomPath(x, y, w, h, i);
      ctx.fillStyle = aHex + (cleared ? '26' : '15');
      ctx.fill();
      // soft inner light for cleared chambers
      if (cleared) {
        const gl2 = ctx.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, w / 2);
        gl2.addColorStop(0, aHex + '30');
        gl2.addColorStop(1, aHex + '00');
        ctx.fillStyle = gl2;
        ctx.fill();
      }
      // double-inked border: broad faint + fine bright
      roomPath(x, y, w, h, i);
      ctx.strokeStyle = aHex + '3d';
      ctx.lineWidth = 4;
      ctx.stroke();
      roomPath(x, y, w, h, i);
      ctx.strokeStyle = i === mapSel ? '#e8f2fa' : aHex + 'aa';
      ctx.lineWidth = i === mapSel ? 1.8 : 1.1;
      ctx.stroke();
      // interior: the chamber's real plan, surveyed — platforms, spikes,
      // doors, seals and the way out, straight off the grid the room is built
      // from. A surveyed room should show what is in it.
      surveyPlan(lv, x, y, w, h, aHex, cleared);
      if (lv.warden) {
        // a watched chamber is marked as watched
        ctx.save();
        ctx.strokeStyle = 'rgba(255,190,150,0.7)';
        ctx.lineWidth = 1.1;
        const ex = x + w - 11, ey = y + h - 9;
        ctx.beginPath();
        ctx.moveTo(ex - 5, ey);
        ctx.quadraticCurveTo(ex, ey - 4.5, ex + 5, ey);
        ctx.quadraticCurveTo(ex, ey + 4.5, ex - 5, ey);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, ey, 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // claw shard pin
    if (lv.relic) {
      const have = !!(claw & (1 << i));
      ctx.save();
      ctx.strokeStyle = have ? '#ffd8a0' : locked ? 'rgba(140,120,90,0.3)' : 'rgba(230,190,130,0.55)';
      if (have) { ctx.shadowColor = '#ffc060'; ctx.shadowBlur = 5; }
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x + w - 8, y + 9, 4.5, -0.9, 0.9);
      ctx.stroke();
      ctx.restore();
    }
    // boss sigil on the finale
    if (lv.finale) {
      const px3 = x + w / 2, py3 = y - 12;
      ctx.save();
      ctx.strokeStyle = locked ? 'rgba(190,140,95,0.45)' : '#ffcf9a';
      if (!locked) { ctx.shadowColor = '#ff9840'; ctx.shadowBlur = 5; }
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(px3, py3, 5.5, 0, Math.PI * 2);
      ctx.moveTo(px3 - 5.5, py3 - 2); ctx.lineTo(px3 - 6.5, py3 - 10); ctx.lineTo(px3 - 1, py3 - 5);
      ctx.moveTo(px3 + 5.5, py3 - 2); ctx.lineTo(px3 + 6.5, py3 - 10); ctx.lineTo(px3 + 1, py3 - 5);
      ctx.stroke();
      ctx.restore();
    }

    // labels: small caps ink
    if (i === mapSel) {
      drawCat(ctx, x + w / 2, y - 6, 1, globalT * 0.03, 0, { grounded: true });
      ctx.fillStyle = '#e8f2fa';
      ctx.font = '13px Georgia, serif';
      ctx.fillText(lv.name, x + w / 2, y + h + 17);
    } else if (!locked) {
      ctx.fillStyle = 'rgba(175,195,215,0.6)';
      ctx.font = '10px Georgia, serif';
      ctx.fillText(lv.name, x + w / 2, y + h + 14);
    }
  });

  // the selected chamber, named as the fable names it — the atlas should say
  // what a room IS, not just where it sits
  {
    const lv = LEVELS[mapSel];
    const px3 = W - 20, py3 = 424;
    ctx.textAlign = 'right';
    if (mapSel > unlocked) {
      ctx.fillStyle = 'rgba(150,170,195,0.45)';
      ctx.font = 'italic 12px Georgia, serif';
      ctx.fillText('unsurveyed', px3, py3 + 18);
    } else {
      if (lv.canto) {
        ctx.fillStyle = 'rgba(150,170,195,0.6)';
        ctx.font = '10px Georgia, serif';
        ctx.fillText(lv.canto.split('').join(' '), px3, py3);
      }
      ctx.fillStyle = lv.finale ? '#e8d6c0' : '#dce7f4';
      ctx.font = `${lv.finale ? 21 : 18}px Georgia, serif`;
      ctx.fillText(lv.title || lv.name, px3, py3 + 22);
      ctx.strokeStyle = 'rgba(170,190,215,0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px3 - 150, py3 + 32);
      ctx.lineTo(px3, py3 + 32);
      ctx.stroke();
      if (lv.region) {
        ctx.fillStyle = 'rgba(150,170,195,0.5)';
        ctx.font = 'italic 11px Georgia, serif';
        ctx.fillText(lv.region, px3, py3 + 47);
      }
      // one line of the tale, so the map carries the fable
      const teaser = (lv.story || []).find(l => l && l !== l.toUpperCase());
      if (teaser) {
        ctx.fillStyle = 'rgba(196,212,232,0.62)';
        ctx.font = '11px monospace';
        ctx.fillText(teaser.length > 52 ? teaser.slice(0, 51) + '\u2026' : teaser, px3, py3 + 68);
      }
      if (lv.interlude) {
        ctx.fillStyle = 'rgba(150,170,195,0.42)';
        ctx.font = 'italic 10px Georgia, serif';
        ctx.fillText('a passage \u00b7 no puzzle, no timer', px3, py3 + 86);
      } else {
        ctx.fillStyle = 'rgba(150,170,195,0.42)';
        ctx.font = '10px monospace';
        ctx.fillText(`chamber ${CHAMBER_NO[mapSel]} of ${CHAMBER_NO[LEVELS.length - 1]}`
          + (lv.relic ? '  \u00b7  a shard lies here' : ''), px3, py3 + 86);
      }
    }
    ctx.textAlign = 'center';
  }

  // leaderboard: inked side table
  if (board && boardLevel === mapSel && board.top && board.top.length) {
    const bx = W - 168, by = 108;
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(255,205,130,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx - 12, by - 16);
    ctx.lineTo(bx - 12, by + 24 + Math.min(6, board.top.length) * 17);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,215,150,0.85)';
    ctx.font = '12px Georgia, serif';
    ctx.fillText('TOP ECHOES', bx, by);
    ctx.font = '11px monospace';
    board.top.slice(0, 6).forEach((r, i) => {
      ctx.fillStyle = i === 0 ? '#ffe2b0' : 'rgba(195,210,230,0.7)';
      ctx.fillText(`${(r.name + '   ').slice(0, 3)} ${r.lives}♥ ${(r.ticks / 60).toFixed(1)}s`, bx, by + 18 + i * 16);
    });
    ctx.fillStyle = 'rgba(150,170,195,0.5)';
    ctx.fillText(`${board.total} clears worldwide`, bx, by + 26 + Math.min(6, board.top.length) * 16);
    ctx.textAlign = 'center';
  }

  // controls: quiet corner note
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(150,170,195,0.5)';
  ctx.font = '11px monospace';
  ctx.fillText('←→ choose · ENTER descend' + (isMuted() ? ' · M unmute' : ' · M mute'), 18, H - 14);
  ctx.textAlign = 'center';
}

function typewriterLines(lines, chars, y0, lineH, font, color) {
  ctx.textAlign = 'center';
  ctx.font = font;
  let remaining = Math.floor(chars);
  lines.forEach((line, i) => {
    if (remaining <= 0) return;
    const shown = line.slice(0, remaining);
    remaining -= line.length;
    const loom = line === line.toUpperCase() && /[A-Z]/.test(line);
    ctx.fillStyle = loom ? '#ffcf8a' : color;
    ctx.fillText(shown, W / 2, y0 + i * lineH);
  });
}

const CARD_HOLD = 55, CARD_HOLD_FINALE = 150, CARD_HOLD_PASSAGE = 30, SHARD_TICKS = 240, VIGIL_HOLD = 90;

function drawStory() {
  r3d.renderMenu(globalT);
  const lv = LEVELS[levelIdx];
  const hold = lv.finale ? CARD_HOLD_FINALE : lv.interlude ? CARD_HOLD_PASSAGE : CARD_HOLD;
  const k = Math.min(1, Math.max(0, (storyT - hold) / 30));
  // 0 = card holds the screen, 1 = settled header. A passage never settles: it
  // keeps its title and its region, because that is all it has to say.
  const s = lv.interlude ? 0 : k * k * (3 - 2 * k);
  ctx.fillStyle = `rgba(4,6,12,${lv.finale ? 0.8 : 0.68})`;
  ctx.fillRect(0, 0, W, H);

  // the canto card, inked like the atlas — holds, then settles upward
  ctx.save();
  ctx.translate(W / 2, 236 - s * 132);
  ctx.scale(1 - s * 0.36, 1 - s * 0.36);
  ctx.textAlign = 'center';
  if (lv.canto) {
    ctx.fillStyle = 'rgba(150,170,195,0.55)';
    ctx.font = '13px Georgia, serif';
    ctx.fillText(lv.canto.split('').join(' '), 0, -50);
  }
  ctx.fillStyle = lv.finale ? '#e8d6c0' : '#cfdcec';
  ctx.font = `${lv.finale ? 42 : 34}px Georgia, serif`;
  const title = lv.title || lv.name;
  const half = ctx.measureText(title).width / 2;
  ctx.fillText(title, 0, 0);
  ctx.strokeStyle = 'rgba(170,190,215,0.4)';
  ctx.lineWidth = 1;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * (half + 22), -11);
    ctx.lineTo(dir * (half + 96), -11);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(dir * (half + 104), -11, 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (lv.region) {
    // the region phrase belongs to the held card; it is unreadable once shrunk
    ctx.fillStyle = `rgba(150,170,195,${0.5 * (1 - s)})`;
    ctx.font = 'italic 14px Georgia, serif';
    ctx.fillText(lv.region, 0, 32);
  }
  ctx.restore();

  if (s > 0 || lv.interlude) {
    ctx.globalAlpha = lv.interlude ? k : s;
    if (!lv.finale && !lv.interlude) {
      ctx.fillStyle = 'rgba(150,200,240,0.5)';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`chamber ${CHAMBER_NO[levelIdx]} — ${lv.name}`, W / 2, 172);
    }
    typewriterLines(lv.story, storyChars, lv.interlude ? 344 : 244, lv.interlude ? 34 : 40, '19px monospace', '#cfeaff');
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(180,220,250,${(0.4 + Math.sin(globalT * 0.06) * 0.3) * (lv.finale ? s : 1)})`;
  ctx.font = '13px monospace';
  ctx.fillText('ENTER', W / 2, H - 60);
}

// the vigil: every life you spent walks in with you
function drawVigil() {
  r3d.renderMenu(globalT);
  ctx.fillStyle = 'rgba(3,5,10,0.82)';
  ctx.fillRect(0, 0, W, H);

  const n = Math.max(3, Math.min(8, livesSpent));
  for (let i = 0; i < n; i++) {
    const k = Math.min(1, (vigilT - 20 - i * 26) / 200);
    if (k <= 0) continue;
    const x0 = W / 2 + (i % 2 ? 1 : -1) * (100 + (i >> 1) * 78);
    const x = x0 + (W / 2 - x0) * k * 0.55;
    const y = H + 40 - k * H * 0.42 + Math.sin(globalT * 0.02 + i) * 4;
    drawCat(ctx, x, y, x < W / 2 ? 1 : -1, globalT * 0.03 + i, 0,
      { ghost: true, alpha: 0.45 * Math.min(1, k * 4), grounded: true });
  }

  typewriterLines(NARRATOR.vigil, vigilChars, 118, 34, '18px monospace', '#dfeaff');
  const total = NARRATOR.vigil.join('').length;
  if (vigilChars > total + 70) {   // a beat of silence first
    ctx.fillStyle = `rgba(180,220,250,${0.4 + Math.sin(globalT * 0.06) * 0.3})`;
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ENTER', W / 2, H - 40);
  }
}

function drawEnding() {
  r3d.renderMenu(globalT);
  ctx.fillStyle = endingKind === 'stay' ? 'rgba(20,12,6,0.6)' : 'rgba(4,6,12,0.62)';
  ctx.fillRect(0, 0, W, H);

  if (endingKind === 'stay') {
    // curled cat, ghosts circling
    for (let i = 0; i < 8; i++) {
      const a = globalT * 0.008 + (i / 8) * Math.PI * 2;
      drawCat(ctx, W / 2 + Math.cos(a) * 130, 400 + Math.sin(a) * 46, Math.cos(a) > 0 ? 1 : -1, globalT * 0.02 + i, 0, { ghost: true, alpha: 0.4, grounded: true });
    }
    ctx.save();
    ctx.translate(W / 2, 410);
    ctx.scale(2.2, 2.2);
    drawCat(ctx, 0, 0, 1, globalT * 0.01, 0, { grounded: true });
    ctx.restore();
  } else {
    // lone cat walking into light
    const grad = ctx.createRadialGradient(W - 120, 260, 10, W - 120, 260, 320);
    grad.addColorStop(0, 'rgba(255,250,230,0.35)');
    grad.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2 + Math.sin(globalT * 0.002) * 4, 410);
    ctx.scale(2.2, 2.2);
    drawCat(ctx, 0, 0, 1, globalT * 0.06, 0, { grounded: true, running: true });
    ctx.restore();
  }

  typewriterLines(endLines, endChars, 80, 26, '16px monospace', '#dff2ff');
  const total = endLines.join('').length;
  if (endChars >= total) {
    ctx.fillStyle = `rgba(180,220,250,${0.4 + Math.sin(globalT * 0.06) * 0.3})`;
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ENTER — thanks for playing', W / 2, H - 30);
  }
}

function drawVignette() {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,10,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ---------- loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(100, now - last);
  last = now;
  while (acc >= 1000 / 60) {
    tick();
    acc -= 1000 / 60;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
