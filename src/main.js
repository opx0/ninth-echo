import { LEVELS, ENDINGS, LIVES, TILE } from './levels.js';
import { World, LOOP_TICKS } from './world.js';
import { Actor, drawCat, L, R, J } from './actors.js';
import * as fx from './fx.js';
import { ensure as audioEnsure, sfx, toggleMute, isMuted } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 960, H = 540;

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

let unlocked = Math.min(parseInt(localStorage.getItem('ninthlife_unlocked') || '0', 10), LEVELS.length - 1);
mapSel = unlocked;

// ---------- flow ----------
function enterLevel(idx) {
  levelIdx = idx;
  world = new World(LEVELS[idx]);
  player = new Actor(world);
  ghosts = [];
  lives = LIVES;
  storyChars = 0;
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
  state = 'play';
}

function startRewind() {
  if (history.length === 0) { finishRewind(); return; }
  rewindPos = history.length - 1;
  rewindStep = Math.max(2, Math.ceil(history.length / 40));
  sfxSafe(() => sfx.rewind());
  fx.shake(6);
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

// ---------- ticking ----------
function tick() {
  globalT++;
  fx.tickParticles();

  if (state === 'title') {
    if (wasPressed('Enter') || wasPressed('Space')) {
      sfxSafe(() => sfx.meow());
      state = 'map';
    }
  } else if (state === 'map') {
    if (wasPressed('ArrowLeft') || wasPressed('KeyA')) { mapSel = Math.max(0, mapSel - 1); sfxSafe(() => sfx.step()); }
    if (wasPressed('ArrowRight') || wasPressed('KeyD')) { mapSel = Math.min(unlocked, mapSel + 1); sfxSafe(() => sfx.step()); }
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
    fx.rewindStreaks(W, H);
    rewindPos -= rewindStep;
    if (rewindPos <= 0) finishRewind();
  } else if (state === 'clear') {
    clearT++;
    if (clearT === 1) sfxSafe(() => sfx.win());
    if (clearT > 140) {
      if (LEVELS[levelIdx].finale) {
        endingKind = clearKind === 'stay' ? 'stay' : 'break';
        endChars = 0;
        state = 'ending';
      } else {
        unlocked = Math.max(unlocked, levelIdx + 1);
        localStorage.setItem('ninthlife_unlocked', String(unlocked));
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

function tickPlay() {
  if (wasPressed('Escape')) { state = 'map'; return; }

  const mask = moveMask();
  if (recLen < LOOP_TICKS) recording[recLen++] = mask;

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
      fx.burst(a.x + a.w / 2, a.y + a.h / 2, 'rgba(140,230,255,0.8)', 10, 2);
    }
    if (a.alive) alive.push(a);
  });

  const ev = player.tick(player.alive ? mask : 0);
  if (ev.jumped) sfxSafe(() => sfx.jump());
  if (ev.landed) { sfxSafe(() => sfx.land()); fx.landPuff(player.x + player.w / 2, player.y + player.h); }
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
    fx.shake(8);
    fx.burst(player.x + player.w / 2, player.y + player.h / 2, '#ff8f8f', 18, 3.5);
  }

  if (player.alive) {
    const e = world.exitHit(player);
    if (e) {
      clearT = 0;
      clearKind = e.kind;
      fx.burst(e.c * TILE + TILE / 2, e.r * TILE + TILE / 2, e.kind === 'stay' ? '#ffcf8a' : '#eaffff', 30, 4, 50, 0.02);
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
    fx.shake(3);
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

  fx.drawVignette(ctx, W, H);
}

function drawScene() {
  fx.drawBackground(ctx, W, H, globalT, levelIdx);
  ctx.save();
  const [ox, oy] = fx.shakeOffset();
  ctx.translate(ox, oy);

  if (state === 'rewind' && history.length) {
    const f = history[Math.max(0, Math.min(history.length - 1, Math.round(rewindPos)))];
    world.applySnapshot(f.w);
    world.draw(ctx, globalT);
    f.g.forEach(g => {
      if (g[4]) drawCat(ctx, g[0] + 11, g[1] + 26, g[2], g[3], 0, { ghost: true, frozen: g[5], alpha: 0.5, grounded: true });
    });
    if (f.p[4]) drawCat(ctx, f.p[0] + 11, f.p[1] + 26, f.p[2], f.p[3], 0, { alpha: 0.9, grounded: true });
    fx.drawParticles(ctx);
    ctx.restore();
    // rewind overlay
    ctx.fillStyle = `rgba(140,230,255,${0.08 + Math.random() * 0.05})`;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(160,240,255,0.9)';
    ctx.font = '28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⟲  a life stays behind', W / 2, H / 2 - 100);
    drawHud();
    return;
  }

  world.draw(ctx, globalT);
  ghostActors.forEach(a => a.draw(ctx, a.frozen ? 0.55 : 0.45));
  player.draw(ctx);
  fx.drawParticles(ctx);
  ctx.restore();

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
    if (!LEVELS[levelIdx].finale) {
      ctx.font = '16px monospace';
      ctx.fillStyle = '#8fb8d8';
      ctx.fillText(`lives spent here: ${LIVES - lives + 1}`, W / 2, H / 2 + 24);
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
  fx.drawBackground(ctx, W, H, globalT, 2);

  // slow-turning loom ring behind the cat
  ctx.save();
  ctx.translate(W / 2, 240);
  ctx.rotate(globalT * 0.003);
  ctx.strokeStyle = 'rgba(110,200,255,0.14)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 90 + i * 26, i, i + Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.restore();

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
  ctx.fillText('NINTH LIFE', W / 2, 130);
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
  fx.drawBackground(ctx, W, H, globalT, 4);
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
  fx.drawBackground(ctx, W, H, globalT, levelIdx);
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
  fx.drawBackground(ctx, W, H, globalT, endingKind === 'stay' ? 8 : 0);

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
    const wx = Math.min(W - 200, 200 + (globalT % 100000) * 0.0);
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
