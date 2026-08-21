// Authored solutions, keyed by level name. A solution is an ordered list of
// runs; every run but the last exists to leave a ghost somewhere useful.
//
// Steps:
//   { to: [col, row] }   walk/jump until standing in that tile (feet on its
//                        bottom edge, centred) — i.e. the tile the cat's body
//                        occupies, which is the tile a plate/exit sits in
//   { hold: n }          n ticks of no input (parks a ghost on a plate)
//   { wait_until: t }    idle until the loop reaches absolute tick t
//   { face: 1 | -1 | 0 } sticky direction pressed during hold/wait (box shoving)
//   { budget: n }        optional per-step tick budget override
//
// A run may be { steps: [...], sacrificial: true } if it is allowed to die.

export const SOLUTIONS = {
  // Climb the ledges to the exit.
  'WAKE': [
    [{ to: [12, 14] }, { to: [17, 12] }, { to: [22, 10] }, { to: [25, 8] }, { to: [26, 8] }],
  ],

  // A descent: walk off each shelf onto the next (the bot never jumps toward a
  // target below it), hop the spiked gaps, and detour into the right-hand
  // pocket for the claw shard at [29,7] before dropping on down.
  'NINE': [
    [
      { to: [9, 4] },                                              // off the top shelf onto shelf 2
      { to: [17, 4] },                                             // hop the spiked gap at cols 11-12
      { to: [22, 7] },                                             // drop right onto the shelf 3
      { to: [29, 7] }, { to: [23, 7] },                            // over the spikes into the shard pocket and back
      { to: [16, 10] },                                            // drop left onto shelf 4
      { to: [8, 15] },                                             // drop left again, clear of the floor pits
      { to: [27, 15] },                                            // right along the floor, over both pits
    ],
  ],

  // Ghost climbs the left ledges and parks on the high plate a; the second run
  // takes the floor the climb left behind, through door A, then up to the exit.
  'ECHO': [
    [{ to: [5, 14] }, { to: [10, 12] }, { to: [15, 10] }, { hold: 30 }],
    [{ to: [22, 16] }, { to: [25, 14] }, { to: [29, 12] }],
  ],

  // Interlude: walk off each shelf, let gravity do the rest, then aim the last
  // fall down the throat at cols 15-19.
  'THE DROP': [
    [{ to: [13, 5] }, { to: [22, 9] }, { to: [16, 16] }, { to: [10, 16] }],
  ],

  // Two plates, two doors, two parked ghosts — one on the plinth below, one on
  // the gallery above. The chimney (block at 13-14, ledge at 15-16, gap at
  // 14-17) is the only way up, and each hop is exactly two tiles.
  'CHAIN': [
    [{ to: [5, 14] }, { hold: 30 }],
    [
      { to: [11, 16] },                                             // through door A, down onto the hall floor
      { to: [14, 14] }, { to: [16, 12] }, { to: [18, 11] },         // chimney -> gallery
      { to: [19, 11] }, { hold: 30 },
    ],
    [
      { to: [11, 16] }, { to: [14, 14] }, { to: [16, 12] }, { to: [18, 11] },
      { to: [27, 11] },                                             // through door B to the exit
    ],
  ],

  // No ghosts needed: a box shoved into the floor gap presses plate a and holds
  // it (tickPlatesAndDoors accepts a box), and the second box is a step over the
  // col-25 wall, which is 90px tall — 8px more than a jump can clear.
  'WEIGHT': [
    [
      { to: [4, 15] }, { face: 1 }, { hold: 110 }, { face: 0 },   // shove box 1 into the gap
      { to: [12, 15] }, { to: [21, 15] },                          // through door A, up to box 2
      { face: 1 }, { hold: 70 }, { face: 0 },                      // shove box 2 flush to the wall
      { to: [24, 14] }, { to: [25, 12] }, { to: [28, 15] },        // box -> wall top -> exit
    ],
  ],

  // The pit plate is flanked by spikes at cols 12 and 14. A cat is 22px wide and
  // hitsSpike insets 5px into the tile, so x in [385,403] presses the plate and
  // touches neither spike — the ghost lives down there, it does not die, it just
  // can never climb out (the pit is 90px deep, a jump is 82px). "A life stays
  // behind" is literal: a life is spent, not killed.
  'SACRIFICE': [
    [{ to: [11, 12] }, { to: [13, 15] }, { hold: 20 }],
    [{ to: [27, 12] }],
  ],

  // Interlude: three shelves stepping down-left, then the split at cols 3-7.
  'THE SEAM': [
    [{ to: [18, 4] }, { to: [10, 7] }, { to: [5, 16] }, { to: [11, 16] }],
  ],

  // Ghost holds the floor plate; the cat climbs and exits up through the door.
  'ASCENT': [
    [{ to: [27, 16] }, { hold: 30 }],
    [
      { to: [5, 16] },                                             // clear the overhang first
      { to: [3, 14] }, { to: [8, 12] }, { to: [13, 10] }, { to: [17, 8] },
      { to: [20, 7] }, { to: [21, 7] },                            // line up under the open door
      { to: [22, 5] },                                             // jump up through it into the exit
    ],
  ],

  // Three plates, three doors, marched in order — but each one is a leg of the
  // switchback: bottom leg rightward, middle shelf back leftward, top leg
  // rightward again. The climb steps repeat verbatim in the last three runs.
  'CONVOY': [
    [{ to: [5, 16] }, { hold: 30 }],
    [
      { to: [25, 16] },                                             // through door A to the foot of the right stair
      { to: [26, 14] }, { to: [24, 12] }, { to: [22, 12] }, { to: [21, 10] },
      { to: [18, 10] }, { hold: 30 },                               // plate b, on the middle shelf
    ],
    [
      { to: [25, 16] }, { to: [26, 14] }, { to: [24, 12] }, { to: [22, 12] }, { to: [21, 10] },
      { to: [3, 10] },                                              // through door B, back along the shelf
      { to: [2, 8] }, { to: [4, 6] }, { to: [5, 6] }, { to: [7, 4] },
      { to: [9, 4] }, { hold: 30 },                                 // plate c, on the top shelf
    ],
    [
      { to: [25, 16] }, { to: [26, 14] }, { to: [24, 12] }, { to: [22, 12] }, { to: [21, 10] },
      { to: [3, 10] }, { to: [2, 8] }, { to: [4, 6] }, { to: [5, 6] }, { to: [7, 4] },
      { to: [17, 4] },                                              // through door C to the exit
    ],
  ],

  // Ghost 1 takes the high ledge plate a; ghost 2 shoves the box against the
  // col-21 block, climbs it and parks on plate b. Both park clear of the warden's
  // beam columns (11,12 -> x 336..384). The final run waits out the first strike
  // window before crossing.
  'PARADOX': [
    [{ to: [7, 14] }, { to: [3, 12] }, { hold: 20 }],
    [
      { to: [16, 16] }, { face: 1 }, { hold: 80 }, { face: 0 },    // box flush to the block
      { to: [20, 15] }, { to: [21, 13] }, { hold: 20 },
    ],
    [{ wait_until: 260 }, { to: [29, 16] }],
  ],

  // Interlude: one long plunge onto the rock shelf at row 12, a nudge right,
  // then the vein at cols 20-24 drops you into the ember hall.
  'THE VEIN': [
    [{ to: [10, 11] }, { to: [21, 16] }, { to: [13, 16] }],
  ],

  // Asking rooms: flat floors, one door on each end. The proof walks left.
  'THE ASKING': [
    [{ to: [2, 15] }],
  ],
  'THE SECOND ASKING': [
    [{ to: [2, 15] }],
  ],

  // Memory tiles in order along the floor, then up the right steps to the
  // fourth, and out through the door the room opens for a good memory.
  'HUSH': [
    [
      { to: [6, 15] }, { to: [12, 15] }, { to: [18, 15] },
      { to: [20, 13] }, { to: [25, 11] },
      { to: [28, 15] }, { to: [30, 15] },
    ],
  ],

  // The loop starts dry: off the ledge and straight down the tunnel before
  // the half-loop floods it.
  'FONT': [
    [{ to: [8, 15] }, { to: [15, 15] }, { to: [25, 15] }, { to: [29, 15] }],
  ],

  // Interlude: off the entry ledge onto the long shelf, off its end onto the
  // right ledge, then back left into the throat, which drops you to the hall.
  'THE TOLL': [
    [{ to: [12, 4] }, { to: [22, 8] }, { to: [16, 15] }, { to: [10, 15] }],
  ],

  // Ring low (up the left pillar to the shelf), then far (the floor), park;
  // the echo replays both while the cat climbs the right stair to ring high.
  'KNELL': [
    [
      { to: [8, 13] }, { to: [4, 11] },
      { to: [11, 15] }, { to: [14, 15] }, { hold: 30 },
    ],
    [
      { to: [20, 15] }, { to: [22, 13] }, { to: [24, 11] }, { to: [26, 9] },
      { to: [23, 7] }, { to: [21, 7] },
      { to: [29, 15] }, { to: [30, 15] },
    ],
  ],

  // WEIGHT with a warden over it: box 1 into the plate gap, wait out the
  // first strike, box 2 flush to the wall, over the top between sweeps.
  'LARDER': [
    [
      { to: [4, 15] }, { face: 1 }, { hold: 110 }, { face: 0 },
      { wait_until: 260 },
      { to: [12, 15] }, { face: 1 }, { hold: 130 }, { face: 0 },
      { to: [19, 14] }, { to: [20, 12] },
      { wait_until: 560 },
      { to: [24, 15] }, { to: [28, 15] }, { to: [30, 15] },
    ],
  ],

  // Solo by design — the Loom is holding the echoes. Box onto the plate,
  // over the spikes, through the door.
  'THE TITHE': [
    [
      { to: [5, 15] }, { face: 1 }, { hold: 70 }, { face: 0 },
      { to: [13, 15] }, { to: [18, 15] }, { to: [25, 15] }, { to: [29, 15] },
    ],
  ],

  // Five seals: two floor echoes, two shelf echoes, then the box on the
  // fifth and the run through the door.
  'THE LONG WAY': [
    [{ to: [5, 15] }, { hold: 20 }],
    [{ to: [15, 15] }, { hold: 20 }],
    [{ to: [6, 13] }, { to: [10, 11] }, { hold: 20 }],
    [{ to: [13, 15] }, { to: [16, 13] }, { to: [18, 11] }, { to: [20, 11] }, { hold: 20 }],
    [
      { to: [19, 15] }, { face: 1 }, { hold: 70 }, { face: 0 },
      { to: [25, 15] }, { to: [28, 15] }, { to: [29, 15] },
    ],
  ],

  // The plate is under the water. The first life stands on it and the pool
  // keeps it; the second crosses while its breath still holds the door.
  'SHALLOWS': [
    { steps: [{ to: [15, 15] }, { hold: 420, budget: 500 }], sacrificial: true },
    [{ to: [22, 15] }, { to: [27, 15] }, { to: [29, 15] }],
  ],

  // Hold right for the whole loop: the mirrored echo walks left instead and
  // wedges itself over the far plate forever. Then walk through the glass.
  'OTHER-SIDE': [
    [{ face: 1 }, { hold: 860, budget: 900 }],
    [{ wait_until: 200 }, { to: [20, 15] }, { to: [26, 15] }, { to: [29, 15] }],
  ],

  // Move between the counts, be nothing on them. Each leg fits a window.
  'THE COUNTING ROOM': [
    [
      { wait_until: 10 }, { to: [8, 15] },
      { wait_until: 130 }, { to: [14, 15] },
      { wait_until: 250 }, { to: [18, 15] },
      { wait_until: 370 }, { to: [24, 15] },
      { wait_until: 490 }, { to: [29, 15] },
    ],
  ],

  // Memory tiles with a gaze between the second and third.
  'SPINDLE': [
    [
      { to: [6, 15] }, { to: [14, 15] },
      { wait_until: 300 }, { to: [22, 15] },
      { to: [27, 15] }, { to: [30, 15] },
    ],
  ],

  // A walk. That is the point of it.
  'THE NURSERY': [
    [{ to: [15, 15] }, { to: [28, 15] }],
  ],

  // Phase two: park a seal echo clear of the gaze, walk the second through
  // the beam window with the count underfoot, then run the door.
  'THE SHUTTLE': [
    [{ wait_until: 10 }, { to: [7, 15] }, { hold: 800, budget: 900 }],
    [{ wait_until: 200 }, { to: [11, 15] }, { to: [17, 15] }, { to: [21, 15] }, { hold: 500, budget: 600 }],
    [{ wait_until: 200 }, { to: [11, 15] }, { to: [18, 15] }, { to: [24, 15] }, { to: [27, 15] }, { to: [29, 15] }],
  ],

  // Phase three: the proof takes the heart. The ninth door asks for a
  // stillness no bot is written to hold.
  'THE NINTH DOOR': [
    [{ to: [11, 13] }, { to: [16, 11] }],
  ],

  // Three seals held at once, two of them under the gaze. Lethal windows (50..94
  // after each telegraph): cols 12/13 at 120-164, 400-444, 740-784; cols 17/18 at
  // 200-244, 480-524, 770-814; cols 19/20 at 280-324, 550-594, 840-884.
  // Seal 1 (col 5) is out of the gaze. Seals 2 and 3 (cols 13, 17) sit inside a
  // band, so each echo has to arrive after that band's second strike and is burned
  // off by its third — the door is only held open between 613 and 740. The cat
  // waits out the sweep on col 15, the one stone no band covers, then runs the
  // gauntlet in that gap. Going early means burning against the shut door.
  'THE NINTH LIFE': [
    [{ to: [5, 16] }, { hold: 20 }],
    [{ wait_until: 495, budget: 600 }, { to: [13, 16] }, { hold: 20 }],
    [{ wait_until: 545, budget: 600 }, { to: [17, 16] }, { hold: 20 }],
    [
      { wait_until: 485, budget: 600 }, { to: [15, 16] },          // cross behind the first band
      { wait_until: 635 }, { to: [24, 16] },                       // let the sweep pass, then run
    ],
  ],
};
