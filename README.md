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

Your past lives hold pressure plates, shove crates, and stand in pits so the
current you can walk through doors they keep open. You have nine lives per
chamber. Spend them wisely.

At the heart of the Loom, the game asks you one question — and it has **two
endings**.

## World echoes — you are never alone

When you clear a chamber, your winning runs upload (three arcade letters and
all). Other players then see your **golden echo cat** solving the room
alongside them, live, and race your time on the per-chamber leaderboard.
This works because the simulation is *deterministic*: an echo is just a byte
array of inputs replayed through identical physics — on anyone's machine.
Remote echoes run in a sandboxed shadow world, so they can never touch your
puzzle.

![paradox](shots/paradox.png)

## Controls

| Key | Action |
|-----|--------|
| ← → / A D | move |
| ↑ / W / Space | jump |
| **R** | rewind the loop (spends a life, leaves an echo) |
| Esc | back to the map |
| M | mute |

Desktop keyboard only — no touch controls.

## How it works

- **Deterministic fixed-timestep core** (60 Hz, vanilla JS): input recorded
  per tick as a bitmask; ghosts replay that byte array through the exact same
  tick order (boxes → ghosts oldest-first → player → plates/doors). No
  randomness, no wall-clock, no physics library — determinism is the game.
- **three.js WebGL presentation**: bloom post-processing, dynamic point
  lights, depth-extruded chambers, particle systems, a camera that leans
  toward the cat. The render layer only *reads* sim state — it can never
  desync a replay.
- **The rewind is real**: every tick snapshots the world; the rewind cutscene
  plays your actual history backwards.
- **All audio synthesized** at runtime with WebAudio — the drone score, the
  tape-rewind sweep, the meow. Zero asset files.
- **The cat is code**: bezier tail, squash & stretch, blinking — drawn to a
  canvas texture billboarded into the WebGL scene.
- **Server**: Node/Express on Google Cloud Run with Firestore for clears and
  echoes, in-memory fallback if Firestore blinks, static files from the same
  service at `game.opxz.dev`.
- Every level is **machine-proven solvable**: a scripted bot drives the real
  physics through the full multi-ghost solutions (see commit history).

![rewind](shots/rewind.png)

## The chambers

Ten rooms, each teaching the loop a new trick: holding, chaining, weighing,
sacrificing, ascending, marching, and one paradox. Then the choice.

![map](shots/map.png)

## Run it yourself

```
npm install
npm start          # http://localhost:8080 — works fully offline (in-memory board)
```

## Credits

Design, code, art, sound: opx0 — with AI pair-programming (Claude), as
permitted by the jam rules. All code and assets created during the jam period.

License: MIT
