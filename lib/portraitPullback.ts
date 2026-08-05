/**
 * The portrait pull-back: how much further back a camera has to sit when the frame is taller than it
 * is wide, so the subject stays framed instead of overflowing the sides.
 *
 * ── Why this is a shared module and not two inline expressions ────────────────────────────────────
 * It used to be one line inside `useWorksField`'s resize handler, and that was fine while the works
 * field was the only thing that pulled back. It isn't: the services → works flight hands the camera
 * from the DECK's renderer to the FIELD's, and `PROJECT_VIEW_KEYS`' first stop is written to be
 * exactly where the flight leaves it (see worksTuning). The moment one side of that handoff applies a
 * pull-back and the other doesn't, the identity the seam is built on stops being an identity — and on
 * a phone it stopped being one by a factor of 1.9. The mark arrived at desktop framing, filling the
 * frame, and shrank the frame browsing took over. That is the "starts big then gets small" bug.
 *
 * So both scenes now read the pull-back from here, and the flight ramps between the two framings
 * rather than cutting between them.
 *
 * ── The two guarantees ───────────────────────────────────────────────────────────────────────────
 * The ramp is exact at both ends, which is what makes it safe to put inside a crossing:
 *
 *      progress 0.0 ─────────── 0.3 ──────────────────── 1.0
 *      scale     1.0            1.0  ╭─────────────╮  portraitPullbackScale(aspect)
 *                │               │  ╱               ╲        │
 *      exactly the deck's    the camera's authored      exactly the works browsing
 *      resting pose          HOLD through the launch    camera's own framing
 *
 *   · At 0 it returns exactly 1, so the fleet's resting shot is untouched — including on desktop,
 *     where `portraitPullbackScale` returns 1 anyway and this whole module is a no-op.
 *   · At 1 it returns exactly the browsing scale, so `updateCamera` picks the camera up where the
 *     flight put it, to the bit.
 *
 * The ramp starts at 0.3 rather than 0 because that is where `CAMERA_POSITION_KEYS` stops holding:
 * for the first 30% the camera deliberately stands still while the craft rises off the pad, and a
 * camera creeping backwards through that beat would undo the anchor the hold exists to provide.
 *
 * Pure and allocation-free — a scalar in, a scalar out, no `three` import. Both render loops call it
 * every frame.
 */

/**
 * How far back a portrait frame pulls, at most.
 *
 * A 1.9× dolly is very nearly the reciprocal of a modern phone's ~0.46 aspect, so at the narrowest
 * frame the site meets, the subject recovers almost exactly the width it had on a landscape screen.
 * Capped rather than left open because `1 / aspect` diverges: a browser window dragged to a sliver
 * would otherwise send the camera to infinity.
 */
const MAX_PULLBACK = 1.9;

/** Where the flight's ramp begins — matched to the camera's authored hold in `handoffFlightPath`. */
const RAMP_START = 0.3;
const RAMP_END = 1;

const clamp = (value: number, low: number, high: number) =>
  value < low ? low : value > high ? high : value;

/**
 * The resting pull-back for a frame of this aspect. 1 on any landscape or square frame, so every
 * desktop caller pays one comparison and nothing else changes.
 *
 * Multiply a camera's offset FROM ITS AIM POINT by this — never its world position. Scaling the
 * position would drag the shot off whatever it was framing.
 */
export function portraitPullbackScale(aspect: number): number {
  return aspect < 1 ? clamp(1 / aspect, 1, MAX_PULLBACK) : 1;
}

/**
 * How far through the flight's MOVING part we are — 0 for the whole of the camera's authored hold,
 * then smoothly to 1 at the landing.
 *
 * Anything that is true of the fleet's resting shot but must not survive into the works framing rides
 * this: the portrait pull-back below, and the deck's own portrait ship drop. Exact at both ends, so a
 * value faded out on it is exactly present at progress 0 and exactly gone at 1.
 *
 * Smoothstep rather than a straight lerp: this joins a camera that is standing still to one that is
 * already moving, and a linear start would put a corner in the motion exactly where the hold ends.
 */
export function flightRamp(progress: number): number {
  const t = clamp((progress - RAMP_START) / (RAMP_END - RAMP_START), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The pull-back part-way through the services → works flight.
 *
 * `portraitScale` is what {@link portraitPullbackScale} returned for the current frame; pass the same
 * number both scenes are holding, or they will disagree about where the camera is and the ship will
 * come apart from the debris it is flying through.
 */
export function flightPullbackScale(portraitScale: number, progress: number): number {
  return 1 + (portraitScale - 1) * flightRamp(progress);
}
