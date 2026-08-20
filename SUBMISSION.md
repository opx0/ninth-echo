# Devpost submission — copy-paste kit

**Project name:** THE NINTH ECHO

**Tagline:** A 15-second loop. Nine lives. One way out.

**Playable link:** https://game.opxz.dev
**Repo:** https://github.com/opx0/ninth-echo

---

## Inspiration

Cats have nine lives — and roguelikes and time-loopers make you spend lives
anyway. We fused them: what if *dying or rewinding* didn't just reset the
level, but left a **ghost of you that replays your exact run** — and the
puzzles required cooperating with your own past lives? Visual mood borrows
from Hollow Knight's glowing dark; the ending choice owes a debt to
Infamous 2's sacrifice finale.

## What it does

THE NINTH ECHO is a time-loop puzzle-platformer. Each chamber runs a 15-second
loop. Press R and time rewinds — but a life stays behind: an echo that repeats
your last run, input for input. Echoes hold pressure plates, shove crates and
stand in spike pits so the current you can get through. Nine lives per
chamber, ten chambers, and a final choice with **two different endings**.

And you are never alone: when you clear a chamber, your winning runs upload —
other players see your **golden echo cat** solving the room alongside them in
real time, and race your clear on the per-chamber leaderboard. Deterministic
replay makes a whole run just a few hundred bytes.

## How we built it

The core is a deterministic fixed-timestep simulation (60 Hz) in vanilla
JavaScript: input recorded per tick as a bitmask; a ghost is that byte array
replayed through identical physics in an identical tick order. On top sits a
**three.js WebGL presentation layer** — bloom, dynamic lights, depth-extruded
chambers, particles — that only *reads* sim state, so visuals can never
desync a replay. The rewind cutscene plays your actual recorded history
backwards. All sound — the drone score, the tape-rewind sweep, the meow — is
synthesized with WebAudio at runtime; there is not a single asset file. The
cat is drawn procedurally onto a canvas texture billboarded into the scene.
Online: Node/Express behind **Caddy** on our own **Google Cloud VM**, serving
the game and the echo/leaderboard API at **game.opxz.dev** — systemd-managed,
JSON-file persistence, so the demo can't die mid-judging.

## Challenges we ran into

Determinism is unforgiving: one tick of divergence and an echo misses its
plate. We locked the update order (boxes → ghosts oldest-first → player →
plates/doors) and kept every simulation step free of randomness and
wall-clock time. Level design was the other beast — several "obviously fine"
rooms turned out to be geometrically impossible (jump heights, box-stair
math), so we wrote a scripted bot that drives the real physics through full
multi-ghost solutions and *proves* every room solvable.

## Accomplishments we're proud of

Every level is machine-verified solvable, including both endings. The
simulation core is dependency-free and byte-exact — exact enough that a
stranger's 300-byte input recording replays perfectly on your machine, which
is the entire world-echo feature. And the whole thing — engine, ten rooms,
story, two endings, synthesized score, online play — was built in one
two-day sprint.

## What we learned

Record-and-replay is a superpower: once your simulation is deterministic, you
get ghosts, rewind cinematics, and automated playtesting nearly for free.

## What's next

More paradox rooms (echo-vs-echo interference is barely explored), speedrun
timer, and touch controls.

**Built with:** javascript, three.js, webgl, webaudio, node.js, express, google-cloud-run, firestore

---

# Demo video shot list (2–3 min)

Record at 1080p with game audio ON (the audio is a feature). OBS: capture the
browser tab, full screen the game first.

1. **0:00–0:15 — Cold open.** Title screen. Let the drone play a beat, press
   ENTER (meow!). Say the one-liner: "The Ninth Echo — you solve puzzles by
   cooperating with your own past lives."
2. **0:15–0:45 — The hook (chamber 3, ECHO).** Stand on the plate, press R on
   camera. Let the rewind effect play fully. Then walk through the door your
   echo holds open. Narrate: "Rewinding spends a life — and my past self
   replays my run, exactly."
3. **0:45–1:15 — Escalation montage.** Quick cuts: NINE (die on spikes once —
   show the life counter drop), WEIGHT (slot the crate into the floor
   socket), SACRIFICE (drop an echo into the pit, jump over it).
4. **1:15–1:50 — The showpiece (chamber 9, PARADOX).** Show three echoes
   working at once: one holding the door, one pushing the crate and climbing.
   Narrate: "Deterministic replay of recorded inputs — and it's online:
   that golden cat is a real player's winning run, replaying live in my room."
   Point at the leaderboard on the map screen.
5. **1:50–2:20 — The choice.** Chamber 10: pan between the cold exit and the
   warm exit. Pick one, let the ending text type out.
6. **2:20–2:40 — End card.** Map screen (all rooms lit), then title. Voice:
   "The Ninth Echo — playable in your browser, link below. Both endings are
   worth it."

Tip: pre-clear rooms 1–8 before recording so the map looks full; use a fresh
browser profile if you want the tutorial experience instead (progress lives
in localStorage — DevTools → Application → Local Storage → delete
`ninthecho_unlocked` to reset).
