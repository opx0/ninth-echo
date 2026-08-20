# Devpost submission — copy-paste kit

**Project name:** NINTH LIFE

**Tagline:** A 15-second loop. Nine lives. One way out.

**Playable link:** https://opx0.github.io/ninth-life/
**Repo:** https://github.com/opx0/ninth-life

---

## Inspiration

Cats have nine lives — and roguelikes and time-loopers make you spend lives
anyway. We fused them: what if *dying or rewinding* didn't just reset the
level, but left a **ghost of you that replays your exact run** — and the
puzzles required cooperating with your own past lives? Visual mood borrows
from Hollow Knight's glowing dark; the ending choice owes a debt to
Infamous 2's sacrifice finale.

## What it does

NINTH LIFE is a time-loop puzzle-platformer. Each chamber runs a 15-second
loop. Press R and time rewinds — but a life stays behind: an echo that repeats
your last run, input for input. Echoes hold pressure plates, shove crates and
stand in spike pits so the current you can get through. Nine lives per
chamber, ten chambers, and a final choice with **two different endings**.

## How we built it

Vanilla JavaScript, Canvas 2D and WebAudio — zero dependencies, no engine, no
build step, no asset files. The core is a deterministic fixed-timestep
simulation (60 Hz): player input is recorded per tick as a bitmask, and a
ghost is just that byte array replayed through identical physics in an
identical tick order. The rewind cutscene plays your *actual* recorded history
backwards. All sound — including the ambient score and the meow — is
synthesized with oscillators and filtered noise at runtime. The cat is drawn
procedurally (bezier tail, squash & stretch, blinking).

## Challenges we ran into

Determinism is unforgiving: one tick of divergence and an echo misses its
plate. We locked the update order (boxes → ghosts oldest-first → player →
plates/doors) and kept every simulation step free of randomness and
wall-clock time. Level design was the other beast — several "obviously fine"
rooms turned out to be geometrically impossible (jump heights, box-stair
math), so we wrote a scripted bot that drives the real physics through full
multi-ghost solutions and *proves* every room solvable.

## Accomplishments we're proud of

Every level is machine-verified solvable, including both endings. The whole
game — engine, ten rooms, story, two endings, audio — fits in a handful of
dependency-free files that load instantly on GitHub Pages.

## What we learned

Record-and-replay is a superpower: once your simulation is deterministic, you
get ghosts, rewind cinematics, and automated playtesting nearly for free.

## What's next

More paradox rooms (echo-vs-echo interference is barely explored), speedrun
timer, and touch controls.

**Built with:** javascript, html5-canvas, webaudio, github-pages

---

# Demo video shot list (2–3 min)

Record at 1080p with game audio ON (the audio is a feature). OBS: capture the
browser tab, full screen the game first.

1. **0:00–0:15 — Cold open.** Title screen. Let the drone play a beat, press
   ENTER (meow!). Say the one-liner: "Ninth Life — you solve puzzles by
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
   Narrate the determinism tech in one sentence: "No engine, no assets —
   deterministic replay of recorded inputs, all vanilla JS."
5. **1:50–2:20 — The choice.** Chamber 10: pan between the cold exit and the
   warm exit. Pick one, let the ending text type out.
6. **2:20–2:40 — End card.** Map screen (all rooms lit), then title. Voice:
   "Ninth Life — playable in your browser, link below. Both endings are
   worth it."

Tip: pre-clear rooms 1–8 before recording so the map looks full; use a fresh
browser profile if you want the tutorial experience instead (progress lives
in localStorage — DevTools → Application → Local Storage → delete
`ninthlife_unlocked` to reset).
