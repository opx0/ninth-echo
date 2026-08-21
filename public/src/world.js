// World: level parsing, tile/door/box collision, plates, spikes, exits,
// bells, memory tiles, water and Death's counting.
// Everything here advances ONLY in fixed ticks — determinism is what makes
// ghost replays exact, so no Date/random in simulation code.

import { TILE, COLS, ROWS, LOOP_SECONDS } from './levels.js';

export const LOOP_TICKS = LOOP_SECONDS * 60;

export class World {
  constructor(def) {
    this.def = def;
    this.loopTicks = (def.loopSeconds || LOOP_SECONDS) * 60;
    this.solidGrid = [];
    this.plates = [];
    this.doors = [];
    this.spikes = [];
    this.exits = [];
    this.boxSpawns = [];
    this.bells = [];        // [{c, r, rung}] — rung this loop, in ring order
    this.relic = def.relic ? { c: def.relic[0], r: def.relic[1] } : null;
    this.night = def.night ? { c: def.night.at[0], r: def.night.at[1], n: def.night.n } : null;
    this.spawn = { x: TILE, y: TILE };
    this.waterNow = null;   // surface y in px this tick, set by tickBoxes(tick)

    const grid = def.grid;
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const ch = grid[r][c];
        row.push(ch === '#');
        const x = c * TILE, y = r * TILE;
        if (ch === 'S') this.spawn = { x: x + 4, y: y + TILE - 26 };
        else if (ch === 'E') this.exits.push({ c, r, ch, kind: def.endings ? 'break' : 'next' });
        else if (ch === 'O') this.exits.push({ c, r, ch, kind: def.routes && def.routes.O ? 'next' : 'stay' });
        else if (ch === 'N') this.exits.push({ c, r, ch, kind: 'release' });
        else if (ch === 'X') this.boxSpawns.push({ x, y });
        else if (ch === '^') this.spikes.push({ c, r });
        else if (ch === 'g') this.bells.push({ c, r, rung: false });
        else if (ch >= 'a' && ch <= 'c') this.plates.push({ c, r, letter: ch, pressed: false, anim: 0 });
        else if (ch >= 'A' && ch <= 'C') this.doors.push({ c, r, letter: ch.toLowerCase(), open: 0, solidNow: true });
      }
      this.solidGrid.push(row);
    }
    // exit kinds may be overridden by the level's routes (asking rooms, phases)
    for (const e of this.exits) {
      const route = def.routes && def.routes[e.ch];
      if (route && route.kind) e.kind = route.kind;
    }
    // memory tiles come from the authored order, not the grid
    this.memory = (def.memory || []).map(([c, r]) => ({ c, r, occ: false }));
    this.resetLoop();
  }

  // Reset world state for a fresh loop (boxes home, doors shut). Ghost list is
  // owned by the game, not the world.
  resetLoop() {
    this.boxes = this.boxSpawns.map(s => ({ x: s.x, y: s.y, vy: 0, w: TILE, h: TILE }));
    for (const d of this.doors) { d.open = 0; d.solidNow = true; }
    for (const p of this.plates) { p.pressed = false; p.anim = 0; }
    for (const b of this.bells) b.rung = false;
    this.bellSeq = [];       // indices (grid reading order) in ring order
    this.bellDone = false;   // latched: rung in the inscribed order
    this.bellOcc = this.bells.map(() => false);
    for (const m of this.memory) m.occ = false;
    this.memIdx = 0;
    this.memDone = false;
  }

  // water surface y in px at this tick, or null. Square wave of the loop:
  // rows[1] (the low mark) first, rows[0] (the high) on the odd half-periods.
  waterSurface(tick) {
    const w = this.def.water;
    if (!w) return null;
    const row = (Math.floor(tick / w.period) % 2 === 0) ? w.rows[1] : w.rows[0];
    return row * TILE;
  }

  inWater(a, headOnly = false) {
    if (this.waterNow == null) return false;
    const w = this.def.water;
    if (w.cols) {
      const c0 = w.cols[0] * TILE, c1 = (w.cols[1] + 1) * TILE;
      if (a.x + a.w <= c0 || a.x >= c1) return false;
    }
    return (headOnly ? a.y : a.y + a.h) > this.waterNow;
  }

  // Death's counting — pure function of the loop tick.
  // 'warn' during the wind-up, 'strike' on the count itself.
  countPhase(tick) {
    const c = this.def.counting;
    if (!c) return null;
    const m = tick % c.period;
    if (tick > 0 && m === 0) return 'strike';
    if (m >= c.period - 30) return 'warn';
    return null;
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

  tickBoxes(tick = 0) {
    this.waterNow = this.waterSurface(tick);
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

  // First Cat gaze beams — pure function of loopTick, so replays stay exact.
  beamPhase(tick) {
    const out = [];
    for (const b of (this.def.beams || []))
      for (const t0 of b.times) {
        const d = tick - t0;
        if (d >= 0 && d < 50) out.push({ cols: b.cols, warn: true, k: d / 50 });
        else if (d >= 50 && d < 95) out.push({ cols: b.cols, warn: false, k: (d - 50) / 45 });
      }
    return out;
  }

  hitsBeam(a, tick) {
    for (const ph of this.beamPhase(tick)) {
      if (ph.warn) continue;
      for (const c of ph.cols) {
        const bx = c * TILE + 6;
        if (a.x < bx + 18 && a.x + a.w > bx) return true;
      }
    }
    return false;
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

  overlapsTile(a, c, r) {
    const x = c * TILE, y = r * TILE;
    return a.x < x + TILE && a.x + a.w > x && a.y < y + TILE && a.y + a.h > y;
  }

  // Plates + doors + bells + memory, evaluated after all actors moved.
  // `actors` = alive actors, in the fixed deterministic order.
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

    // bells: a ring is the edge of an actor entering the tile. Ringing out of
    // the inscribed order un-rings everything; completing it latches the door.
    if (this.bells.length && !this.bellDone) {
      this.bells.forEach((b, i) => {
        const occ = actors.some(a => this.overlapsTile(a, b.c, b.r));
        if (occ && !this.bellOcc[i] && !b.rung) {
          b.rung = true;
          this.bellSeq.push(i);
          const want = this.def.bellOrder;
          if (want) {
            const k = this.bellSeq.length - 1;
            if (want[k] !== i) {
              for (const bb of this.bells) bb.rung = false;
              this.bellSeq = [];
            } else if (this.bellSeq.length === want.length) this.bellDone = true;
          }
        }
        this.bellOcc[i] = occ;
      });
    }

    // memory tiles: step them in the authored order. A wrong later tile
    // resets the sequence; revisiting an earlier one is forgiven.
    if (this.memory.length && !this.memDone) {
      this.memory.forEach((m, i) => {
        const occ = actors.some(a => this.overlapsTile(a, m.c, m.r));
        if (occ && !m.occ) {
          if (i === this.memIdx) {
            this.memIdx++;
            if (this.memIdx >= this.memory.length) this.memDone = true;
          } else if (i > this.memIdx) this.memIdx = 0;
        }
        m.occ = occ;
      });
    }

    for (const d of this.doors) {
      const platesOfLetter = this.plates.filter(p => p.letter === d.letter);
      let wantOpen = platesOfLetter.length > 0 && platesOfLetter.every(p => p.pressed);
      if (this.def.memory && d.letter === (this.def.memoryDoor || 'a') && this.memDone) wantOpen = true;
      if (this.def.bellOrder && d.letter === (this.def.bellDoor || 'a') && this.bellDone) wantOpen = true;
      d.open += ((wantOpen ? 1 : 0) - d.open) * 0.18;
      d.open = Math.min(1, Math.max(0, d.open));
      let solid = d.open < 0.7;
      if (solid) {
        // never crush: stay passable while something occupies the doorway.
        // The half-pixel margin keeps an actor walked flush against the door
        // (whose edge can land on the boundary ± float dust) from counting
        // as inside it.
        const x = d.c * TILE, y = d.r * TILE;
        for (const a of actors) {
          if (a.x < x + TILE - 0.5 && a.x + a.w > x + 0.5 && a.y < y + TILE && a.y + a.h > y) { solid = false; break; }
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

}
