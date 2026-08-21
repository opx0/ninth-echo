// Machine proof that every chamber of THE NINTH ECHO is solvable.
//
//   bun tools/solve.js        -> per-level table, exit 0 iff every level clears
//
// A waypoint bot plays each run and its per-tick input masks are RECORDED,
// then replayed as ghosts in the next run through the same code path the game
// uses. The tick order below mirrors main.js tickPlay() exactly; if that
// function changes, this proof is worthless until it is updated to match.

import { LEVELS, TILE, LIVES } from '../public/src/levels.js';
import { World, LOOP_TICKS } from '../public/src/world.js';
import { Actor, L, R, J } from '../public/src/actors.js';
import { SOLUTIONS } from './solutions.js';

const REACH = 110;   // px a full jump covers while above the target's height
const LOOK = 12;     // gap probe distance ahead of the feet
const BUDGET = 500;  // default ticks a single step may take

const targetOf = step => ({ x: step.to[0] * TILE + TILE / 2, feet: step.to[1] * TILE + TILE });

function stepDone(a, step, st, tick) {
  if (step.face !== undefined) return true;
  if (step.hold !== undefined) return st.stepT >= step.hold;
  if (step.wait_until !== undefined) return tick >= step.wait_until;
  const t = targetOf(step);
  return a.grounded && Math.abs(a.x + a.w / 2 - t.x) <= 6 && Math.abs(a.y + a.h - t.feet) <= 8;
}

// Deterministic controller: walk toward the target x, jump when something is in
// the way, when the target is above and within jump reach, or when the floor
// ahead runs out.
function botMask(a, world, step, st) {
  if (step.to === undefined) return st.face === 1 ? R : st.face === -1 ? L : 0;
  const t = targetOf(step);
  const dx = t.x - (a.x + a.w / 2);
  // lead term brakes before overshooting: coasting alone drifts ~28px in air
  const lead = dx - a.vx * (a.grounded ? 2.5 : 4);
  const m = Math.abs(lead) > 1 ? (lead > 0 ? R : L) : 0;
  const dir = m === R ? 1 : m === L ? -1 : (dx >= 0 ? 1 : -1);
  if (a.grounded) {
    const above = (a.y + a.h) - t.feet > 8;
    const below = t.feet - (a.y + a.h) > 8;
    const gy = a.y + a.h + 1;
    const ground = world.rectHitsSolid(a.x + dir * LOOK, gy, a.w, 1) ||
      !!world.boxAt(a.x + dir * LOOK, gy, a.w, 1, null);
    st.jump = world.rectHitsSolid(a.x + dir * 4, a.y, a.w, a.h) ||
      !!world.boxAt(a.x + dir * 4, a.y, a.w, a.h, null) ||
      (above && Math.abs(dx) <= REACH) ||
      (!ground && !below && Math.abs(dx) > 8);
  } else {
    st.jump = st.jump && a.vy < 0;  // keep JUMP held for full height, release at apex
  }
  return st.jump ? m | J : m;
}

class Fail extends Error {}

// One loop of one chamber. `recs` are the recordings of the earlier runs.
const swapLR = m => ((m & L) ? R : 0) | ((m & R) ? L : 0) | (m & J);

function playRun(def, recs, run, label) {
  const steps = Array.isArray(run) ? run : run.steps;
  const sacrificial = !Array.isArray(run) && !!run.sacrificial;
  const world = new World(def);
  const COLSPX = 32 * TILE;
  const ghostActors = recs.map(() => new Actor(world, true));
  if (def.mirror) for (const a of ghostActors) a.x = COLSPX - world.spawn.x - a.w;
  const player = new Actor(world);
  const rec = new Uint8Array(world.loopTicks);
  const st = { stepT: 0, face: 0, jump: false };
  let tick = 0, si = 0, exit = null;

  while (tick < world.loopTicks) {
    while (si < steps.length && stepDone(player, steps[si], st, tick)) {
      if (steps[si].face !== undefined) st.face = steps[si].face;
      si++; st.stepT = 0;
    }
    if (si >= steps.length) break;               // run over: player would rewind here
    const step = steps[si];
    if (st.stepT > (step.budget || BUDGET))
      throw new Fail(`${label} step ${si} ${JSON.stringify(step)} stalled at ` +
        `x=${player.x.toFixed(1)} y=${player.y.toFixed(1)} tick=${tick}`);

    let mask = botMask(player, world, step, st);
    // Death's counting: the bot goes still on the count, like any sane cat
    const beat = world.countPhase(tick) === 'strike';
    if (def.counting && (tick % def.counting.period === 0) && tick > 0) mask = 0;
    rec[tick] = mask;
    st.stepT++;

    // ---- tick order, identical to tickPlay() ----
    world.tickBoxes(tick);
    const alive = [];
    ghostActors.forEach((a, i) => {
      if (!a.alive) { a.tick(0); return; }
      a.frozen = tick >= recs[i].length;
      const gm = a.frozen ? 0 : (def.mirror ? swapLR(recs[i][tick]) : recs[i][tick]);
      a.tick(gm);
      if (world.hitsBeam(a, tick)) a.die();
      if (a.alive && !a.frozen && world.hitsSpike(a)) a.die();
      if (a.alive && !a.frozen && beat && recs[i][tick] !== 0) a.die();
      if (a.alive) alive.push(a);
    });
    player.tick(player.alive ? mask : 0);
    if (player.alive) alive.push(player);
    world.tickPlatesAndDoors(alive);
    if (player.alive && world.hitsBeam(player, tick)) player.die();
    if (player.alive && world.hitsSpike(player)) player.die();
    if (player.alive && beat && mask !== 0) player.die();
    if (player.alive) {
      const e = world.exitHit(player);
      if (e && e.kind !== 'release') exit = e;   // the ninth door does not open to touch
    }
    tick++;
    // --------------------------------------------

    if (exit) break;
    if (!player.alive) {
      if (!sacrificial) throw new Fail(`${label} died at tick ${tick} (step ${si}) and is not marked sacrificial`);
      break;
    }
  }

  if (!exit && si < steps.length && player.alive)
    throw new Fail(`${label} ran out of loop (${world.loopTicks} ticks) on step ${si}`);
  return { rec: rec.slice(0, tick), ticks: tick, exit, alive: player.alive, loop: world.loopTicks };
}

function proveLevel(def) {
  const sol = SOLUTIONS[def.name];
  if (!sol) throw new Fail(`${def.name}: no solution authored`);
  if (sol.length > LIVES) throw new Fail(`${def.name}: ${sol.length} runs > ${LIVES} lives`);
  const recs = [];
  let last = null;
  for (let i = 0; i < sol.length; i++) {
    last = playRun(def, recs, sol[i], `${def.name} run ${i + 1}`);
    recs.push(last.rec);
  }
  if (!last.exit) throw new Fail(`${def.name}: final run never reached an exit`);
  if (last.exit.kind === 'stay') throw new Fail(`${def.name}: final run took the 'stay' exit`);
  if (!last.alive) throw new Fail(`${def.name}: player was dead at the exit`);
  return { runs: sol.length, ticks: last.ticks, kind: last.exit.kind, loop: last.loop };
}

let failed = 0;
console.log('THE NINTH ECHO — solvability proof\n');
for (const def of LEVELS) {
  try {
    const r = proveLevel(def);
    console.log(`  ${def.name.padEnd(18)} runs ${String(r.runs).padStart(2)}/${LIVES}   final run ${String(r.ticks).padStart(4)}/${r.loop} ticks   CLEAR (${r.kind})`);
  } catch (e) {
    failed++;
    console.log(`  ${def.name.padEnd(16)} FAILED — ${e instanceof Fail ? e.message : e.stack}`);
  }
}
console.log(`\n${LEVELS.length - failed}/${LEVELS.length} chambers proven solvable.`);
process.exit(failed ? 1 : 0);
