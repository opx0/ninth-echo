import { LEVELS, ENDINGS, LIVES, TILE } from './levels.js';
import { World, LOOP_TICKS } from './world.js';
import { Actor, drawCat, L, R, J } from './actors.js';
import * as r3d from './render3d.js';
import { ensure as audioEnsure, sfx, toggleMute, isMuted } from './audio.js';
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
addEventListener('blur', () => held.clear());

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

let rewindPos = 0, rewindStep = 1;
let clearT = 0, clearKind = 'next';
let failT = 0;
let storyChars = 0;
let endingKind = 'break', endChars = 0;
let mapSel = 0;

let unlocked = Math.min(parseInt(localStorage.getItem('ninthecho_unlocked') || '0', 10), LEVELS.length - 1);
mapSel = unlocked;

let totalTicks = 0;
let playerName = localStorage.getItem('ninthecho_name') || '';
let nameChars = '';
let submitted = false;
let board = null, boardLevel = -1;
let worldEchoes = [];   // [{name, world, recs, actors}]

function loadBoardFor(level) {
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
  r3d.buildLevel(world);
  player = new Actor(world);
  ghosts = [];
  lives = LIVES;
  storyChars = 0;
  totalTicks = 0;
  submitted = false;
  nameChars = '';
  worldEchoes = [];
  fetchBoard(idx).then(b => {
    if (!b || levelIdx !== idx) return;
    worldEchoes = b.echoes.slice(0, 2).map(e => makeShadow(e, idx));
    resetShadows();
    console.log('world echoes loaded:', worldEchoes.map(se => se.name).join(','));
  }).catch(e => console.error('echo load failed', e));
  newLoop();
  state = 'story';
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
} });

// ---------- ticking ----------
function tick() {
  globalT++;

  if (state === 'title') {
    if (wasPressed('Enter') || wasPressed('Space')) {
      sfxSafe(() => sfx.meow());
      state = 'map';
    }
  } else if (state === 'map') {
    if (boardLevel !== mapSel && globalT % 30 === 0) loadBoardFor(mapSel);
    if (wasPressed('ArrowLeft') || wasPressed('KeyA')) { mapSel = Math.max(0, mapSel - 1); sfxSafe(() => sfx.step()); loadBoardFor(mapSel); }
    if (wasPressed('ArrowRight') || wasPressed('KeyD')) { mapSel = Math.min(unlocked, mapSel + 1); sfxSafe(() => sfx.step()); loadBoardFor(mapSel); }
    if (wasPressed('Enter') || wasPressed('Space')) { sfxSafe(() => sfx.plateOn()); enterLevel(mapSel); }
  } else if (state === 'story') {
    storyChars += 1.2;
    const total = LEVELS[levelIdx].story.join('').length;
    if (wasPressed('Enter') || wasPressed('Space') || wasPressed('KeyR')) {
      if (storyChars < total) storyChars = total;
      else state = 'play';
    }
  } else if (state === 'play') {
    tickPlay();
  } else if (state === 'rewind') {
    rewindPos -= rewindStep;
    if (rewindPos <= 0) finishRewind();
  } else if (state === 'clear') {
    if (!playerName) {
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
      const runs = ghosts.map(g => g.rec.slice(0, g.len));
      runs.push(recording.slice(0, recLen));
      submitClear({
        level: levelIdx, name: playerName,
        lives: Math.max(1, LIVES - lives + 1),
        ticks: Math.max(30, totalTicks),
        ghosts: runs.slice(-9),
      });
    }
    clearT++;
    if (clearT > 140) {
      if (LEVELS[levelIdx].finale) {
        endingKind = clearKind === 'stay' ? 'stay' : 'break';
        endChars = 0;
        state = 'ending';
      } else {
        unlocked = Math.max(unlocked, levelIdx + 1);
        localStorage.setItem('ninthecho_unlocked', String(unlocked));
        mapSel = Math.min(levelIdx + 1, LEVELS.length - 1);
        state = 'map';
      }
    }
  } else if (state === 'fail') {
    failT++;
    if (failT > 130) resetRoom();
  } else if (state === 'ending') {
    endChars += 0.9;
    const total = ENDINGS[endingKind].join('').length;
    if (wasPressed('Enter') || wasPressed('Space')) {
      if (endChars < total) endChars = total;
      else { state = 'title'; mapSel = unlocked; }
    }
  }

  pressed.clear();
}

const DEBUG_MODE = new URLSearchParams(location.search).has('debug');

function tickPlay() {
  if (wasPressed('Escape')) { state = 'map'; return; }
  if (DEBUG_MODE && wasPressed('KeyK')) {
    const e = world.exits[0];
    clearT = 0; clearKind = e.kind;
    sfxSafe(() => sfx.win());
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
      if (!a.frozen && se.world.hitsSpike(a)) a.die();
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
    if (!a.frozen && world.hitsSpike(a)) {
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
    if (d.open > 0.15 && !doorSfxDone[i]) { doorSfxDone[i] = true; sfxSafe(() => sfx.door()); }
    if (d.open < 0.1) doorSfxDone[i] = false;
  });

  if (player.alive && world.hitsSpike(player)) {
    player.die();
    sfxSafe(() => sfx.death());
    r3d.shake(10);
    r3d.burst(player.x + player.w / 2, player.y + player.h / 2, 0xff8f8f, 22, 3.5);
  }

  if (player.alive) {
    const e = world.exitHit(player);
    if (e) {
      clearT = 0;
      clearKind = e.kind;
      r3d.burst(e.c * TILE + TILE / 2, e.r * TILE + TILE / 2, e.kind === 'stay' ? 0xffcf8a : 0xeaffff, 34, 4, 55);
      sfxSafe(() => sfx.win());
      if (LEVELS[levelIdx].finale) {
        if (e.kind === 'stay') r3d.loomStay(); else { r3d.loomBreak(); sfxSafe(() => sfx.death()); }
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
  else if (state === 'story') drawStory();
  else if (state === 'ending') drawEnding();
  else drawScene();

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
    for (const se of worldEchoes) {
      const a = se.actors[se.actors.length - 1];
      if (!a || !a.alive) continue;
      cats.push({
        x: a.x + a.w / 2, y: a.y + a.h, face: a.face, phase: a.phase, vy: a.vy, z: 3,
        opts: { ghost: true, remote: true, frozen: a.frozen, grounded: a.grounded, running: a.grounded && Math.abs(a.vx) > 0.3, alpha: 0.34 },
      });
    }
    ghostActors.forEach(a => {
      if (!a.alive && a.deathT > 40) return;
      cats.push({
        x: a.x + a.w / 2, y: a.y + a.h, face: a.face, phase: a.phase, vy: a.vy,
        opts: { ghost: true, frozen: a.frozen, dead: !a.alive, deathT: a.deathT, squash: a.squash, grounded: a.grounded, running: a.grounded && Math.abs(a.vx) > 0.3, alpha: a.frozen ? 0.62 : 0.5 },
      });
    });
    if (player.alive || player.deathT <= 40) {
      cats.push({
        x: player.x + player.w / 2, y: player.y + player.h, face: player.face, phase: player.phase, vy: player.vy,
        opts: { dead: !player.alive, deathT: player.deathT, squash: player.squash, grounded: player.grounded, running: player.grounded && Math.abs(player.vx) > 0.3, alpha: 1 },
      });
    }
  }

  r3d.render(globalT, world, cats, px, py);

  // 2D overlay (canvas already cleared transparent in draw())
  if (state === 'rewind') {
    ctx.fillStyle = 'rgba(160,240,255,0.9)';
    ctx.font = '28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('\u27f2  a life stays behind', W / 2, H / 2 - 100);
  }

  drawHud();

  if (state === 'clear') {
    const k = Math.min(1, clearT / 30);
    ctx.fillStyle = `rgba(10,16,30,${k * 0.6})`;
    ctx.fillRect(0, 0, W, H);
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
    ctx.fillText('THE LOOM RECLAIMS YOU', W / 2, H / 2 - 10);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#c9a8b8';
    ctx.fillText('nine lives, restored. it is patient.', W / 2, H / 2 + 24);
    ctx.globalAlpha = 1;
  }
}

function drawHud() {
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

  // level name + keys
  ctx.fillStyle = 'rgba(160,200,235,0.75)';
  ctx.font = '14px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${levelIdx + 1} · ${LEVELS[levelIdx].name}`, W - 20, 26);
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(140,180,215,0.5)';
  ctx.fillText('R rewind · ESC map · M mute', W - 20, 44);

  // hint
  ctx.textAlign = 'center';
  ctx.font = '14px monospace';
  ctx.fillStyle = 'rgba(170,210,240,0.55)';
  ctx.fillText(LEVELS[levelIdx].hint, W / 2, H - 16);
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

function drawMap() {
  r3d.renderMenu(globalT);
  ctx.fillStyle = 'rgba(4,6,12,0.62)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#bfe8ff';
  ctx.font = 'bold 26px monospace';
  ctx.save();
  ctx.shadowColor = '#7fe3ff'; ctx.shadowBlur = 14;
  ctx.fillText('THE LOOM', W / 2, 52);
  ctx.restore();
  ctx.fillStyle = 'rgba(140,180,215,0.6)';
  ctx.font = '13px monospace';
  ctx.fillText('descend, chamber by chamber', W / 2, 76);

  // edges
  ctx.strokeStyle = 'rgba(110,190,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 6]);
  for (let i = 0; i < LEVELS.length - 1; i++) {
    const [x1, y1] = LEVELS[i].mapPos, [x2, y2] = LEVELS[i + 1].mapPos;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2 + 20, (y1 + y2) / 2 - 15, x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  LEVELS.forEach((lv, i) => {
    const [x, y] = lv.mapPos;
    const cleared = i < unlocked;
    const isCurrent = i === unlocked;
    const locked = i > unlocked;
    ctx.save();
    if (!locked) { ctx.shadowColor = '#7fe3ff'; ctx.shadowBlur = cleared ? 8 : 14; }
    ctx.fillStyle = cleared ? '#7fd6f2' : locked ? '#22304a' : '#eaffff';
    ctx.beginPath();
    ctx.arc(x, y, locked ? 6 : 9, 0, Math.PI * 2);
    ctx.fill();
    if (isCurrent) {
      ctx.strokeStyle = `rgba(190,240,255,${0.5 + Math.sin(globalT * 0.08) * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (i === mapSel) {
      drawCat(ctx, x, y - 16, 1, globalT * 0.03, 0, { grounded: true });
      ctx.fillStyle = '#dff6ff';
      ctx.font = '15px monospace';
      ctx.fillText(lv.name, x, y + 32);
    } else if (!locked) {
      ctx.fillStyle = 'rgba(150,190,220,0.5)';
      ctx.font = '11px monospace';
      ctx.fillText(lv.name, x, y + 28);
    }
  });

  // leaderboard for the selected chamber
  if (board && boardLevel === mapSel && board.top && board.top.length) {
    const bx = W - 185, by = 120;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,205,130,0.9)';
    ctx.font = '13px monospace';
    ctx.fillText('TOP ECHOES', bx, by);
    ctx.font = '12px monospace';
    board.top.slice(0, 6).forEach((r, i) => {
      ctx.fillStyle = i === 0 ? '#ffe2b0' : 'rgba(200,220,240,0.75)';
      ctx.fillText(`${(r.name + '   ').slice(0, 3)} ${r.lives}♥ ${(r.ticks / 60).toFixed(1)}s`, bx, by + 20 + i * 17);
    });
    ctx.fillStyle = 'rgba(140,180,215,0.5)';
    ctx.fillText(`${board.total} clears worldwide`, bx, by + 28 + Math.min(6, board.top.length) * 17);
    ctx.textAlign = 'center';
  }

  ctx.fillStyle = 'rgba(160,200,235,0.6)';
  ctx.font = '14px monospace';
  ctx.fillText('←→ choose · ENTER enter chamber' + (isMuted() ? ' · M unmute' : ' · M mute'), W / 2, H - 20);
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

function drawStory() {
  r3d.renderMenu(globalT);
  ctx.fillStyle = 'rgba(4,6,12,0.68)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(150,200,240,0.5)';
  ctx.font = '14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`chamber ${levelIdx + 1} — ${LEVELS[levelIdx].name}`, W / 2, 120);
  typewriterLines(LEVELS[levelIdx].story, storyChars, 220, 40, '19px monospace', '#cfeaff');
  ctx.fillStyle = `rgba(180,220,250,${0.4 + Math.sin(globalT * 0.06) * 0.3})`;
  ctx.font = '13px monospace';
  ctx.fillText('ENTER', W / 2, H - 60);
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

  typewriterLines(ENDINGS[endingKind], endChars, 80, 26, '16px monospace', '#dff2ff');
  const total = ENDINGS[endingKind].join('').length;
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
