// Render-side effects: particles, dust, shake, background. Never touches the
// simulation, so Math.random here is fine — replays don't depend on it.

export const particles = [];
let dust = [];
let shakeMag = 0;

export function shake(m) { shakeMag = Math.max(shakeMag, m); }

export function shakeOffset() {
  if (shakeMag <= 0.1) return [0, 0];
  const o = [(Math.random() - 0.5) * shakeMag * 2, (Math.random() - 0.5) * shakeMag * 2];
  shakeMag *= 0.88;
  return o;
}

export function burst(x, y, col, n = 12, speed = 3, life = 30, grav = 0.08) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: life * (0.5 + Math.random() * 0.5), maxLife: life,
      col, size: 1 + Math.random() * 2.5, grav,
    });
  }
}

export function landPuff(x, y) {
  for (let i = 0; i < 6; i++) {
    particles.push({
      x: x + (Math.random() - 0.5) * 16, y,
      vx: (Math.random() - 0.5) * 1.5, vy: -Math.random() * 0.8,
      life: 18, maxLife: 18, col: 'rgba(160,200,255,0.5)',
      size: 1.5 + Math.random() * 1.5, grav: -0.01,
    });
  }
}

export function rewindStreaks(w, h) {
  for (let i = 0; i < 3; i++) {
    particles.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: -8 - Math.random() * 10, vy: 0,
      life: 14, maxLife: 14, col: 'rgba(140,230,255,0.7)',
      size: 1, grav: 0, streak: true,
    });
  }
}

export function tickParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vy += p.grav;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

export function drawParticles(ctx) {
  for (const p of particles) {
    const a = p.life / p.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.col;
    if (p.streak) ctx.fillRect(p.x, p.y, 24, 1.5);
    else ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

export function drawBackground(ctx, W, H, t, depth = 0) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a1020');
  g.addColorStop(0.6, '#070b16');
  g.addColorStop(1, '#05070d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // faint "loom threads" — slow-swaying vertical filaments, deeper rooms have more
  const n = 3 + Math.min(6, depth);
  ctx.strokeStyle = 'rgba(110,190,255,0.045)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < n; i++) {
    const bx = ((i + 1) / (n + 1)) * W + Math.sin(t * 0.004 + i * 2.1) * 30;
    ctx.beginPath();
    for (let y = 0; y <= H; y += 20) {
      const x = bx + Math.sin(y * 0.008 + t * 0.01 + i) * 14;
      y === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ambient dust
  if (dust.length < 40) {
    dust.push({
      x: Math.random() * W, y: H + 5,
      vx: (Math.random() - 0.5) * 0.15, vy: -0.1 - Math.random() * 0.25,
      s: 0.5 + Math.random() * 1.5, a: 0.05 + Math.random() * 0.2,
      ph: Math.random() * 10,
    });
  }
  ctx.fillStyle = '#bfe3ff';
  for (let i = dust.length - 1; i >= 0; i--) {
    const d = dust[i];
    d.x += d.vx + Math.sin(t * 0.01 + d.ph) * 0.1;
    d.y += d.vy;
    if (d.y < -5) { dust.splice(i, 1); continue; }
    ctx.globalAlpha = d.a * (0.7 + Math.sin(t * 0.02 + d.ph) * 0.3);
    ctx.fillRect(d.x, d.y, d.s, d.s);
  }
  ctx.globalAlpha = 1;
}

export function drawVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,10,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
