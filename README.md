# THE NINTH ECHO

*A 15-second loop. Nine lives. One way out.*

**▶ Play it: https://game.opxz.dev**

Made in ~30 hours for **BTT Web Game Jam — Summer 2026**.

![title](shots/title.png)

## The idea

You are a cat trapped in the Loom — a machine that broke time. Every chamber
runs on a **15-second loop**. When you press **R** (or time runs out, or you
die), the world rewinds — but **a life stays behind**: a ghost of you that
replays your last run, input for input.

Your past lives hold pressure plates, shove crates and stand in pits so the
current you can walk through doors they keep open. You have nine lives per
chamber. Spend them wisely.

![echoes](shots/echoes.png)

## The fable

The story is one continuous folktale told in two voices. **THE LOOM** speaks in
gold uppercase and taunts you. A second, lowercase narrator tells the tale in
past tense — and at **Canto IX** it turns out to be the First Cat itself,
grieving the machine the humans built to steal its gift.

Ten chambers, ten cantos, each opening on a title card. Thirteen petrified cat
husks are scattered through the ruin; stand close and the dead speak their
epitaph. Before the finale a scripted **vigil** plays: every life you spent
stands up out of the floor and walks in beside you.

![canto](shots/canto.png)

## World echoes — you are never alone

When you clear a chamber, your winning runs upload (three arcade letters and
all). Other players then see your **golden echo cat** solving the room
alongside them, live, and race your time on the per-chamber leaderboard.
This works because the simulation is *deterministic*: an echo is just a byte
array of inputs replayed through identical physics — on anyone's machine.
Remote echoes run in a sandboxed shadow world, so they can never touch your
puzzle.

## Controls

| Key | Action |
|-----|--------|
| ← → / A D | move |
| ↑ / W / Space | jump |
| **R** | rewind the loop (spends a life, leaves an echo) |
| Esc / P | pause — then Q for the atlas |
| M | mute |

Desktop keyboard only — no touch controls.

## How it works

- **Deterministic fixed-timestep core** (60 Hz, vanilla JS): input recorded
  per tick as a bitmask; ghosts replay that byte array through the exact same
  tick order (boxes → ghosts oldest-first → player → plates/doors). No
  randomness, no wall-clock, no physics library in the simulation —
  determinism is the game.
- **three.js WebGL presentation**: bloom post-processing, dynamic point
  lights, depth-extruded chambers, particle systems, a camera that leans
  toward the cat. The render layer only *reads* sim state — it can never
  desync a replay.
- **The rewind is real**: every tick snapshots the world; the rewind cutscene
  plays your actual history backwards.
- **All audio synthesized** at runtime with WebAudio — the drone score, the
  tape-rewind sweep, the meow. Zero audio asset files. Every biome plays the
  same motif over the same chord shape, re-tuned underneath: root, interval
  colour, timbre, filter and pacing all darken on the way down, from a
  rain-blue triangle at the top to an ember sawtooth at the heart. Passages
  thin out to drones and air; the finale gets a tritone sitting in the sub.
- **The cat is code**: bezier tail, squash & stretch, blinking — drawn to a
  canvas texture billboarded into the WebGL scene. Left alone it sits down; it
  pins its ears flat when a warden's gaze is winding up.
- **Server**: Node/Express behind Caddy (auto-HTTPS) on our own Google Cloud
  VM, serving the game and the echo/leaderboard API at `game.opxz.dev`, with
  JSON-file persistence and an optional Firestore mirror.
- Every level is **machine-proven solvable**, and the proof ships: `bun run
  proof` runs a waypoint bot through the real physics, records its per-tick
  inputs, and replays them as ghosts through the same code path the game uses.
  13/13, non-zero exit if any chamber regresses — the finale included, which
  it has to clear *through* the gaze schedule to the break exit.
- Type-checked without a build step: `tsc --checkJs` over the plain JS
  (`bun run check`) — the browser runs exactly what's in this repo.

## The chambers

Ten rooms, each teaching the loop a new trick: holding, chaining, weighing,
sacrificing, ascending, marching, and one paradox. The Loom re-dresses itself
as you descend — rain-blue under-halls, a sepia bone archive, teal
root-depths, the violet deep, and the ember heart. Two chambers are watched by
a spectral warden whose gaze sweeps fixed columns on a fixed schedule.

![map](shots/map.png)

Four of those rooms were rebuilt from flat corridors into real vertical
space: ECHO's plate climbed three ledges up a wall, NINE became a stepped
descent with a claw shard hidden in a dead-end pocket, CHAIN split into two
storeys joined by a chimney, and CONVOY folded into a switchback — right along
the bottom, up, back left along the middle shelf, up again, a door gating each
leg.

![switchback](shots/switchback.png)

Between the biomes sit three passages — THE DROP, THE SEAM, THE VEIN —
traversal-only shafts with no puzzle, no timer and no life count, so each
change of colour lands on a held breath.

![passage](shots/passage.png)

Then the First Cat — a finale fought entirely with the loop itself. Three
seals must be held at once, and two of them sit directly under its gaze, so
the echoes you park there burn off unless you time the parking against the
sweep. The door only stays open for the gap between strikes. Learn the pattern
or it shuts behind you. Or take the warm door, and stay.

![boss](shots/boss.png)

Three endings: break the Loom, stay in it, or **sever** it — the third is
locked behind the three hidden claw shards that assemble the Claw of the First
Cat. No screenshot of those here; go and earn one.

## Run it yourself

```
bun install
bun start          # http://localhost:8080 — works fully offline (in-memory board)
bun run proof      # the solvability proof: 29/29, exits non-zero on regression
bun run check      # tsc --checkJs, no build step
```

## Credits

Design, code, art, sound: opx0. All code and assets created during the jam
period.

License: MIT
