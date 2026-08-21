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
from Hollow Knight's glowing dark; the narrator's past tense owes a debt to
Prince of Persia; the ending choice, to Infamous 2's sacrifice finale.

## What it does

THE NINTH ECHO is a time-loop puzzle-platformer. Each chamber runs a 15-second
loop. Press R and time rewinds — but a life stays behind: an echo that repeats
your last run, input for input. Echoes hold pressure plates, shove crates and
stand in spike pits so the current you can get through. Nine lives per chamber.

Thirteen levels descend through five visual biomes: **ten puzzle chambers**
plus **three traversal-only passages** — THE DROP, THE SEAM, THE VEIN — that
sit at the biome boundaries and have no puzzle, no timer and no life count, so
each change of colour lands on a held breath.

Wrapped around it is one continuous folktale in two voices: **THE LOOM** in
gold uppercase, and a lowercase narrator who turns out at Canto IX to be the
First Cat itself, grieving the machine humans built to steal its gift. Ten
chambers open on canto title cards. Thirteen petrified husks speak their
epitaphs when you stand close. Before the finale, a vigil: every life you spent
stands up out of the floor and walks in beside you.

Then the boss — the First Cat — fought entirely with the loop. Three seals must
be held at once and two of them sit under its gaze, so the echoes you park
there burn off unless you time the parking against the sweep. **Three endings**,
one of them hidden behind assembling the Claw of the First Cat from three
scattered shards.

And you are never alone: when you clear a chamber, your winning runs upload —
other players see your **golden echo cat** solving the room alongside them in
real time, and race your clear on the per-chamber leaderboard. Deterministic
replay makes a whole run a few hundred bytes.

## How we built it

The core is a deterministic fixed-timestep simulation (60 Hz) in vanilla
JavaScript: input recorded per tick as a bitmask; a ghost is that byte array
replayed through identical physics in an identical tick order. On top sits a
**three.js WebGL presentation layer** — bloom, dynamic lights, depth-extruded
chambers, particles — that only *reads* sim state, so visuals can never
desync a replay. The rewind cutscene plays your actual recorded history
backwards. All sound — the drone score, the tape-rewind sweep, the meow — is
synthesized with WebAudio at runtime; there is not a single audio asset file.
Every biome plays the same motif over the same chord shape with the root,
interval colour, timbre, filter and pacing re-tuned underneath, so the score
darkens as you descend; passages thin to drones and air, and the finale grows
a tritone in the sub.
The cat is drawn procedurally onto a canvas texture billboarded into the scene:
bezier tail, squash and stretch, blinking, sitting down when you leave it
alone, ears pinned flat when a warden's gaze winds up.
Online: Node/Express behind **Caddy** on our own **Google Cloud VM**, serving
the game and the echo/leaderboard API at **game.opxz.dev** — systemd-managed,
JSON-file persistence (with an optional Firestore mirror), so the demo can't
die mid-judging.

## Challenges we ran into

Determinism is unforgiving: one tick of divergence and an echo misses its
plate. We locked the update order (boxes → ghosts oldest-first → player →
plates/doors) and kept every simulation step free of randomness and
wall-clock time. Level design was the other beast — several "obviously fine"
rooms turned out to be geometrically impossible (one wall was 90px tall
against an 82px jump), so we wrote a scripted bot that drives the real physics
through full multi-ghost solutions and *proves* every room solvable.

That proof then convicted our own boss fight. Every seal in the finale sat
outside every beam column, and three echoes could park on them and open the
exit long before the first lethal window ever arrived — the gaze threatened
nothing at all. Rebuilt, two of the three seals now stand inside beam bands, so
each echo has to arrive after that band's second strike and is burned off by
its third: the door is only held open between ticks 613 and 740 of the
900-tick loop, and the proven clear runs to tick 717. Most of the fight is
now spent waiting out the sweep on the one stone no band covers.

## Accomplishments we're proud of

Every level is machine-verified solvable and the proof ships in the repo:
`bun run proof` prints 13/13 and exits non-zero if any chamber regresses —
including the finale, which it must clear through the gaze schedule to the
break exit, not around it. The simulation core is dependency-free and
byte-exact — exact enough that a stranger's few-hundred-byte input recording
replays perfectly on your machine, which is the entire world-echo feature. And
the whole thing — engine, thirteen levels, a folktale in two voices, three
endings, synthesized score, online play — was built in one two-day sprint.

## What we learned

Record-and-replay is a superpower: once your simulation is deterministic, you
get ghosts, rewind cinematics, and automated playtesting nearly for free. And
the automated playtest is a design critic, not just a regression test — it was
the bot, not us, that noticed the boss couldn't kill anything.

## What's next

More paradox rooms (echo-vs-echo interference is barely explored), speedrun
timer, and touch controls.

**Built with:** javascript, three.js, webgl, webaudio, node.js, express,
google-compute-engine, caddy, firestore

---

# Gallery images

All captured from the live build at the game's native 960×540. In `shots/`:

| File | What it shows |
|------|---------------|
| `title.png` | title screen — lead image |
| `map.png` | the atlas: thirteen levels descending through five biomes, boss pin at the bottom |
| `canto.png` | a canto card with its four lines told — the Loom's gold voice against the narrator's |
| `echoes.png` | ASCENT: an echo parked on the floor plate, the ceiling door it opens, the climb |
| `switchback.png` | CONVOY rebuilt as a switchback: three shelves, a door gating each leg, echoes parked along the route |
| `passage.png` | THE VEIN — a passage falling into the ember heart, HUD gone quiet |
| `boss.png` | the First Cat mid-sweep: beams crossing two of the three held seals |
| `ending.png` | the break ending (spoiler — gallery only, not in the README) |

---

# Demo video shot list (2–3 min)

Record at 1080p with game audio ON (the audio is a feature). OBS: capture the
browser tab, full screen the game first.

1. **0:00–0:12 — Cold open.** Title screen. Let the drone play a beat, press
   ENTER (meow!). Say the one-liner: "The Ninth Echo — you solve puzzles by
   cooperating with your own past lives."
2. **0:12–0:30 — The two voices.** Enter a chamber and let the canto card hold:
   "CANTO IV — The Ledger of Bone". Read one gold LOOM line and one lowercase
   narrator line aloud so the viewer hears the difference. Walk up to a husk so
   its epitaph fades in ("PIP. Held a door for a sister who never came.").
3. **0:30–1:00 — The hook (ASCENT).** Walk to the plate on the floor, press R
   on camera. Let the rewind effect play fully — the narrator's line lands over
   it. Then climb the ledges while your echo holds the plate and the ceiling
   door stays open. Narrate: "Rewinding spends a life — and my past self
   replays my run, exactly."
4. **1:00–1:25 — Rooms with shape.** Quick cuts: NINE (a stepped descent —
   die on spikes once, show a life pip drop, and detour into the dead-end
   pocket for a claw shard), CHAIN (two storeys joined by a chimney, an echo
   parked on each), CONVOY (the switchback folding back on itself, three
   echoes marched through three doors in order).
5. **1:25–1:40 — A passage.** Drop into THE VEIN. Point out that the HUD goes
   quiet — no timer arc, no life pips, no chamber number — while the palette
   turns ember. "Three of these sit between the biomes. No puzzle. Just the
   way down."
6. **1:40–1:55 — The showpiece (PARADOX).** Three lives in one room: one echo
   parked on the high ledge plate, one shoving the crate against the block and
   climbing it to the second plate, and you crossing between them once the
   warden's gaze has swept. Narrate: "Deterministic replay of recorded inputs —
   and it's online: that golden cat is a real player's winning run, replaying
   live in my room." Cut to the atlas and point at the leaderboard.
7. **1:55–2:10 — The vigil.** Enter the ember heart and let the vigil play
   uncut: the spent lives rising out of the floor, "Nine of you walked toward
   the ember heart together."
8. **2:10–2:40 — The boss + the choice.** THE NINTH LIFE: park echoes on the
   three seals, show one being burned off a seal by the gaze, then the timed
   run through the door in the gap between strikes. Or walk left to the warm
   door and stay. Let the ending text type out.
9. **2:40–2:55 — End card.** The atlas with every room lit, then the title.
   Voice: "The Ninth Echo — playable in your browser, link below. There are
   three endings. All of them are worth it."

Tip: pre-clear the early rooms before recording so the atlas looks full; use a
fresh browser profile if you want the tutorial experience instead. Progress
lives in localStorage — DevTools → Application → Local Storage → delete
`ninthecho_unlocked5` (and `ninthecho_claw5`, `ninthecho_name`) to reset.
Loading the game with `?debug` adds two capture-only keys: **K** force-clears
the current chamber, **L** teleports to that chamber's claw shard.
