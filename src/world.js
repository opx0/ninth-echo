// World: level parsing, tile/door/box collision, plates, spikes, exits.
// Everything here advances ONLY in fixed ticks — determinism is what makes
// ghost replays exact, so no Date/random in simulation code.

import { TILE, COLS, ROWS, LOOP_SECONDS } from './levels.js';

export const LOOP_TICKS = LOOP_SECONDS * 60;

const LETTER_COLORS = {
  a: '#6ee7ff',
  b: '#ffb347',
  c: '#ff7ac8',
};

export class World {
  constructor(def) {
    this.def = def;
    this.solidGrid = [];
    this.plates = [];
    this.doors = [];
    this.spikes = [];
    this.exits = [];
    this.boxSpawns = [];
    this.spawn = { x: TILE, y: TILE };

    const grid = def.grid;
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const ch = grid[r][c];
        row.push(ch === '#');
        const x = c * TILE, y = r * TILE;
        if (ch === 'S') this.spawn = { x: x + 4, y: y + TILE - 26 };
        else if (ch === 'E') this.exits.push({ c, r, kind: def.finale ? 'break' : 'next' });
        else if (ch === 'O') this.exits.push({ c, r, kind: 'stay' });
        else if (ch === 'X') this.boxSpawns.push({ x, y });
        else if (ch === '^') this.spikes.push({ c, r });
        else if (ch >= 'a' && ch <= 'c') this.plates.push({ c, r, letter: ch, pressed: false, anim: 0 });
        else if (ch >= 'A' && ch <= 'C') this.doors.push({ c, r, letter: ch.toLowerCase(), open: 0, solidNow: true });
      }
      this.solidGrid.push(row);
    }
    this.resetLoop();
  }

  // Reset world state for a fresh loop (boxes home, doors shut). Ghost list is
  // owned by the game, not the world.
  resetLoop() {
    this.boxes = this.boxSpawns.map(s => ({ x: s.x, y: s.y, vy: 0, w: TILE, h: TILE }));
    for (const d of this.doors) { d.open = 0; d.solidNow = true; }
    for (const p of this.plates) { p.pressed = false; p.anim = 0; }
  }

  tileSolid(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
    if (this.solidGrid[r][c]) return true;
    for (const d of this.doors) {
      if (d.c === c && d.r === r && d.solidNow) return true;
    }
    return false;
  }

  // Static solids (tiles + closed doors) vs a rect.
  rectHitsSolid(x, y, w, h) {
    const c0 = Math.floor(x / TILE), c1 = Math.floor((x + w - 0.01) / TILE);
    const r0 = Math.floor(y / TILE), r1 = Math.floor((y + h - 0.01) / TILE);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (this.tileSolid(c, r)) return true;
    return false;
  }

  boxAt(x, y, w, h, skip) {
    for (const b of this.boxes) {
      if (b === skip) continue;
      if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return b;
    }
    return null;
  }

  // Try to push box horizontally by dx. Returns actual movement.
  pushBox(box, dx) {
    const step = Math.sign(dx) * Math.min(Math.abs(dx), 1.6);
    const nx = box.x + step;
    if (this.rectHitsSolid(nx, box.y, box.w, box.h)) return 0;
    if (this.boxAt(nx, box.y, box.w, box.h, box)) return 0;
    box.x = nx;
    return step;
  }

  tickBoxes() {
    for (const b of this.boxes) {
      b.vy = Math.min(b.vy + 0.5, 10);
      let ny = b.y + b.vy;
      // land on tiles/doors
      if (this.rectHitsSolid(b.x, ny, b.w, b.h)) {
        ny = Math.floor((ny + b.h) / TILE) * TILE - b.h;
        while (this.rectHitsSolid(b.x, ny, b.w, b.h)) ny -= 1;
        b.vy = 0;
      }
      // land on other boxes
      const hit = this.boxAt(b.x, ny, b.w, b.h, b);
      if (hit && b.vy >= 0) { ny = hit.y - b.h; b.vy = 0; }
      b.y = ny;
    }
  }

  spikeRects() {
    return this.spikes.map(s => ({ x: s.c * TILE + 5, y: s.r * TILE + 14, w: 20, h: 16 }));
  }

  hitsSpike(a) {
    for (const s of this.spikes) {
      const sx = s.c * TILE + 5, sy = s.r * TILE + 14;
      // a box sitting on the spike tile shields it
      if (this.boxAt(s.c * TILE + 2, s.r * TILE + 2, TILE - 4, TILE - 4, null)) continue;
      if (a.x < sx + 20 && a.x + a.w > sx && a.y < sy + 16 && a.y + a.h > sy) return true;
    }
    return false;
  }

  exitHit(a) {
    for (const e of this.exits) {
      const x = e.c * TILE, y = e.r * TILE;
      if (a.x < x + TILE - 4 && a.x + a.w > x + 4 && a.y < y + TILE && a.y + a.h > y) return e;
    }
    return null;
  }

  // Plates + doors evaluated after all actors moved. `actors` = alive actors.
  tickPlatesAndDoors(actors) {
    for (const p of this.plates) {
      const px = p.c * TILE + 3, py = p.r * TILE + 10, pw = TILE - 6, ph = TILE - 10;
      let hit = false;
      for (const a of actors) {
        if (a.x < px + pw && a.x + a.w > px && a.y < py + ph && a.y + a.h > py) { hit = true; break; }
      }
      if (!hit && this.boxAt(px, py, pw, ph, null)) hit = true;
      p.pressed = hit;
      p.anim += ((hit ? 1 : 0) - p.anim) * 0.3;
    }
    for (const d of this.doors) {
      const platesOfLetter = this.plates.filter(p => p.letter === d.letter);
      const wantOpen = platesOfLetter.length > 0 && platesOfLetter.every(p => p.pressed);
      d.open += ((wantOpen ? 1 : 0) - d.open) * 0.18;
      d.open = Math.min(1, Math.max(0, d.open));
      let solid = d.open < 0.7;
      if (solid) {
        // never crush: stay passable while something occupies the doorway
        const x = d.c * TILE, y = d.r * TILE;
        for (const a of actors) {
          if (a.x < x + TILE && a.x + a.w > x && a.y < y + TILE && a.y + a.h > y) { solid = false; break; }
        }
        if (solid && this.boxAt(x, y, TILE, TILE, null)) solid = false;
      }
      d.solidNow = solid;
    }
  }

  snapshot() {
    return {
      boxes: this.boxes.map(b => [b.x, b.y]),
      doors: this.doors.map(d => d.open),
      plates: this.plates.map(p => p.anim),
    };
  }

  applySnapshot(s) {
    s.boxes.forEach((v, i) => { this.boxes[i].x = v[0]; this.boxes[i].y = v[1]; });
    s.doors.forEach((v, i) => { this.doors[i].open = v; });
    s.plates.forEach((v, i) => { this.plates[i].anim = v; });
  }

  // ---------- rendering ----------

  draw(ctx, t) {
    // tiles
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!this.solidGrid[r][c]) continue;
        const x = c * TILE, y = r * TILE;
        ctx.fillStyle = '#101a2c';
        ctx.fillRect(x, y, TILE, TILE);
        // top edge highlight only where exposed
        if (r === 0 || !this.solidGrid[r - 1][c]) {
          ctx.fillStyle = 'rgba(130,200,255,0.28)';
          ctx.fillRect(x, y, TILE, 2);
          ctx.fillStyle = 'rgba(130,200,255,0.07)';
          ctx.fillRect(x, y + 2, TILE, 5);
        }
        if (c === 0 || !this.solidGrid[r][c - 1]) {
          ctx.fillStyle = 'rgba(130,200,255,0.10)';
          ctx.fillRect(x, y, 2, TILE);
        }
        if (c === COLS - 1 || !this.solidGrid[r][c + 1]) {
          ctx.fillStyle = 'rgba(10,14,24,0.6)';
          ctx.fillRect(x + TILE - 2, y, 2, TILE);
        }
      }
    }

    // spikes
    for (const s of this.spikes) {
      const x = s.c * TILE, y = s.r * TILE;
      ctx.fillStyle = '#c9d6e8';
      for (let i = 0; i < 3; i++) {
        const sx = x + 3 + i * 9;
        ctx.beginPath();
        ctx.moveTo(sx, y + TILE);
        ctx.lineTo(sx + 4.5, y + 8 + Math.sin(t * 0.05 + i) * 1.5);
        ctx.lineTo(sx + 9, y + TILE);
        ctx.closePath();
        ctx.fill();
      }
    }

    // plates — light beam marks an unpressed plate from across the room
    for (const p of this.plates) {
      const x = p.c * TILE, y = p.r * TILE;
      const col = LETTER_COLORS[p.letter] || '#6ee7ff';
      const press = p.anim;
      const beam = 1 - press;
      if (beam > 0.05) {
        const bh = 90 * beam;
        const g = ctx.createLinearGradient(0, y + TILE - bh, 0, y + TILE);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, col);
        ctx.save();
        ctx.globalAlpha = 0.20 * beam * (0.8 + Math.sin(t * 0.05 + p.c) * 0.2);
        ctx.fillStyle = g;
        ctx.fillRect(x + 8, y + TILE - bh, TILE - 16, bh);
        ctx.restore();
      }
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 10 + press * 16;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55 + press * 0.45;
      ctx.fillRect(x + 4, y + TILE - 7 - (1 - press) * 4, TILE - 8, 5 + (1 - press) * 4);
      if (press > 0.5) {
        ctx.strokeStyle = col;
        ctx.globalAlpha = (press - 0.5) * 1.4;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x + TILE / 2, y + TILE - 3, 16 + press * 4, 5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(x + 2, y + TILE - 3, TILE - 4, 3);
    }

    // doors
    for (const d of this.doors) {
      const x = d.c * TILE, y = d.r * TILE;
      const col = LETTER_COLORS[d.letter] || '#6ee7ff';
      const h = TILE * (1 - d.open);
      if (h > 1) {
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#16233a';
        ctx.fillRect(x + 3, y, TILE - 6, h);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 4, y + 1, TILE - 8, Math.max(1, h - 2));
        ctx.beginPath();
        ctx.moveTo(x + TILE / 2, y + 3);
        ctx.lineTo(x + TILE / 2, y + h - 3);
        ctx.stroke();
        ctx.restore();
      }
    }

    // boxes
    for (const b of this.boxes) {
      ctx.save();
      ctx.shadowColor = '#8fb8ff';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#2a3a58';
      ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      ctx.strokeStyle = 'rgba(150,200,255,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
      ctx.strokeStyle = 'rgba(150,200,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(b.x + 3, b.y + 3); ctx.lineTo(b.x + b.w - 3, b.y + b.h - 3);
      ctx.moveTo(b.x + b.w - 3, b.y + 3); ctx.lineTo(b.x + 3, b.y + b.h - 3);
      ctx.stroke();
      ctx.restore();
    }

    // exits
    for (const e of this.exits) {
      const x = e.c * TILE + TILE / 2, y = e.r * TILE + TILE / 2;
      const warm = e.kind === 'stay';
      const col = warm ? '#ffcf8a' : '#eaffff';
      const pulse = 0.7 + Math.sin(t * 0.06) * 0.3;
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 25 * pulse;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2.5;
      // cat-door arch
      ctx.beginPath();
      ctx.moveTo(x - 10, y + 15);
      ctx.lineTo(x - 10, y - 2);
      ctx.arc(x, y - 2, 10, Math.PI, 0);
      ctx.lineTo(x + 10, y + 15);
      ctx.stroke();
      ctx.globalAlpha = 0.25 * pulse;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x - 10, y + 15);
      ctx.lineTo(x - 10, y - 2);
      ctx.arc(x, y - 2, 10, Math.PI, 0);
      ctx.lineTo(x + 10, y + 15);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
