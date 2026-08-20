// Actor physics (player + ghost replays share this) and the procedural cat.
// Input mask bits: 1 = left, 2 = right, 4 = jump.


export const L = 1, R = 2, J = 4;

const ACCEL_G = 0.65, ACCEL_A = 0.45, MAXV = 3.1;
const GRAV = 0.36, JUMPV = -7.7, MAXFALL = 9.5;
const COYOTE = 6, BUFFER = 7;

export class Actor {
  constructor(world, ghost = false) {
    this.world = world;
    this.ghost = ghost;
    this.w = 22; this.h = 26;
    this.reset();
  }

  reset() {
    this.x = this.world.spawn.x;
    this.y = this.world.spawn.y;
    this.vx = 0; this.vy = 0;
    this.face = 1;
    this.grounded = false;
    this.coyote = 0; this.buffer = 0;
    this.jumpHeld = false; this.cutDone = false;
    this.alive = true;
    this.frozen = false;
    this.phase = 0;         // animation clock
    this.squash = 0;        // >0 right after landing
    this.deathT = 0;
  }

  onGround() {
    const y = this.y + this.h + 1;
    if (this.world.rectHitsSolid(this.x, y, this.w, 1)) return true;
    return !!this.world.boxAt(this.x, y, this.w, 1, null);
  }

  tick(mask) {
    const ev = { jumped: false, landed: false, step: false };
    if (!this.alive) { this.deathT++; return ev; }
    if (this.frozen) { this.phase += 0.02; return ev; }
    const w = this.world;

    // horizontal
    const dir = ((mask & R) ? 1 : 0) - ((mask & L) ? 1 : 0);
    const acc = this.grounded ? ACCEL_G : ACCEL_A;
    if (dir !== 0) {
      this.vx += dir * acc;
      this.vx = Math.max(-MAXV, Math.min(MAXV, this.vx));
      this.face = dir;
    } else {
      this.vx *= this.grounded ? 0.72 : 0.9;
      if (Math.abs(this.vx) < 0.05) this.vx = 0;
    }

    let nx = this.x + this.vx;
    if (w.rectHitsSolid(nx, this.y, this.w, this.h)) {
      // walk flush up to the wall
      const s = Math.sign(this.vx);
      let guard = 8;
      while (guard-- > 0 && !w.rectHitsSolid(this.x + s, this.y, this.w, this.h)) this.x += s;
      nx = this.x;
      this.vx = 0;
    } else {
      const box = w.boxAt(nx, this.y, this.w, this.h, null);
      if (box) {
        const pushed = w.pushBox(box, this.vx);
        // stay flush against the box while shoving it
        nx = this.vx > 0 ? box.x - this.w : box.x + box.w;
        if (w.rectHitsSolid(nx, this.y, this.w, this.h) || w.boxAt(nx, this.y, this.w, this.h, box)) nx = this.x;
        if (pushed === 0) this.vx = 0;
      }
    }
    this.x = nx;

    // vertical
    this.vy = Math.min(this.vy + GRAV, MAXFALL);
    const wasGrounded = this.grounded;
    let ny = this.y + this.vy;
    let landedNow = false;
    if (w.rectHitsSolid(this.x, ny, this.w, this.h)) {
      if (this.vy > 0) landedNow = true;
      const step = Math.sign(this.vy);
      ny = this.y;
      while (!w.rectHitsSolid(this.x, ny + step, this.w, this.h)) ny += step;
      this.vy = 0;
    } else {
      const box = w.boxAt(this.x, ny, this.w, this.h, null);
      if (box) {
        if (this.vy > 0) { ny = box.y - this.h; landedNow = true; }
        else ny = box.y + box.h;
        this.vy = 0;
      }
    }
    this.y = ny;

    this.grounded = this.onGround();
    if (this.grounded) this.coyote = COYOTE;
    else if (this.coyote > 0) this.coyote--;
    if (landedNow && !wasGrounded) { ev.landed = true; this.squash = 8; }

    // jump: buffered + coyote + variable height
    const jumpDown = (mask & J) !== 0;
    if (jumpDown && !this.jumpHeld) this.buffer = BUFFER;
    else if (this.buffer > 0) this.buffer--;
    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = JUMPV;
      this.buffer = 0; this.coyote = 0;
      this.grounded = false;
      this.cutDone = false;
      ev.jumped = true;
    }
    if (!jumpDown && this.vy < 0 && !this.cutDone) {
      this.vy *= 0.45;
      this.cutDone = true;
    }
    this.jumpHeld = jumpDown;

    // animation clock
    this.phase += this.grounded && Math.abs(this.vx) > 0.3 ? 0.35 : 0.06;
    if (this.squash > 0) this.squash--;
    if (this.grounded && Math.abs(this.vx) > 0.3 && (Math.floor(this.phase * 2) % 6 === 0)) ev.step = true;
    return ev;
  }

  die() {
    this.alive = false;
    this.deathT = 0;
  }
}

// (cx, cy) = bottom-center of the cat.
export function drawCat(ctx, cx, cy, face, phase, vy, o = {}) {
  const a = o.alpha ?? 1;
  if (o.dead && o.deathT > 40) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(face, 1);

  let sx = 1, sy = 1;
  if (!o.grounded && vy < -1) { sy = 1.12; sx = 0.92; }
  else if (!o.grounded && vy > 2) { sy = 1.06; sx = 0.95; }
  if (o.squash > 0) { sy = 0.85; sx = 1.15; }
  if (o.dead) { const k = Math.min(1, o.deathT / 40); sy = 1 - k * 0.6; ctx.globalAlpha = a * (1 - k); }
  else ctx.globalAlpha = a;
  ctx.scale(sx, sy);

  const bob = o.husk ? 0 : o.running ? Math.sin(phase * 2) * 1.5 : Math.sin(phase) * 0.8;
  const bodyFill = o.husk ? '#232c3a' : o.remote ? 'rgba(255,210,140,0.16)' : o.ghost ? 'rgba(140,230,255,0.20)' : '#0c1018';
  const rim = o.husk ? 'rgba(110,125,150,0.45)' : o.remote ? 'rgba(255,205,130,0.8)' : o.ghost ? 'rgba(150,235,255,0.85)' : 'rgba(110,210,255,0.35)';

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rim;
  ctx.fillStyle = bodyFill;
  if (o.ghost || o.frozen) { ctx.shadowColor = o.remote ? '#ffc87a' : '#7fe3ff'; ctx.shadowBlur = 12; }

  // tail
  const tw = Math.sin(phase * (o.running ? 2 : 1)) * 6;
  ctx.beginPath();
  ctx.moveTo(-9, -8 + bob * 0.5);
  ctx.bezierCurveTo(-16, -12 + bob, -20 + tw, -22, -15 + tw, -28);
  ctx.stroke();

  // body
  ctx.beginPath();
  ctx.ellipse(-1, -7 + bob * 0.4, 11, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // head
  const hx = 7, hy = -16 + bob;
  ctx.beginPath();
  ctx.arc(hx, hy, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // ears
  ctx.beginPath();
  ctx.moveTo(hx - 6, hy - 3);
  ctx.lineTo(hx - 5, hy - 12);
  ctx.lineTo(hx - 0.5, hy - 6.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx + 1, hy - 6.5);
  ctx.lineTo(hx + 4, hy - 12.5);
  ctx.lineTo(hx + 7, hy - 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // eyes
  ctx.shadowBlur = 0;
  if (o.dead) {
    ctx.strokeStyle = '#ff8f8f';
    ctx.lineWidth = 1.4;
    for (const ex of [hx + 1.5, hx + 6]) {
      ctx.beginPath();
      ctx.moveTo(ex - 1.6, hy - 1.6); ctx.lineTo(ex + 1.6, hy + 1.6);
      ctx.moveTo(ex + 1.6, hy - 1.6); ctx.lineTo(ex - 1.6, hy + 1.6);
      ctx.stroke();
    }
  } else if (o.husk) {
    ctx.fillStyle = '#0a0e16';
    ctx.beginPath();
    ctx.ellipse(hx + 2, hy - 0.5, 1.8, 2.4, 0, 0, Math.PI * 2);
    ctx.ellipse(hx + 6.2, hy - 0.5, 1.6, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const blink = Math.sin(phase * 0.7) > 0.97 ? 0.25 : 1;
    ctx.save();
    ctx.fillStyle = o.remote ? '#ffe2b0' : o.ghost ? '#dffaff' : '#a5f3ff';
    ctx.shadowColor = o.remote ? '#ffc87a' : '#7fe3ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(hx + 2, hy - 0.5, 1.7, 2.2 * blink, 0, 0, Math.PI * 2);
    ctx.ellipse(hx + 6.2, hy - 0.5, 1.5, 2.0 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // legs (simple run cycle)
  if (o.grounded && !o.dead) {
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2;
    const lp = o.running ? Math.sin(phase * 2) * 3 : 0;
    ctx.beginPath();
    ctx.moveTo(-6, -2); ctx.lineTo(-6 + lp, 0);
    ctx.moveTo(5, -2); ctx.lineTo(5 - lp, 0);
    ctx.stroke();
  }

  ctx.restore();
}
