/**
 * The orbit rail's geometry — the ONE place the drawn arc, the station nodes and the travelling body
 * agree about where a point on the orbit is.
 *
 * They have to agree exactly, for the same reason `OrbitDial/orbitGeometry.ts` gives: the arc is drawn
 * from these numbers and the body is placed per frame from these numbers, so a second copy of the
 * construction in the stylesheet would be a marker that rides a few pixels off its own path.
 *
 * ── What it is ───────────────────────────────────────────────────────────────────────────────────
 * A shallow arc standing in the page's left gutter, with one node per numbered section and a small
 * amber body that travels it as you scroll. It is the navbar's meters said as an orbit — which is the
 * one visual idea these document pages borrow from the homepage rather than inventing.
 *
 *        ╷ 01        ← nodes sit at even fractions of the arc, NOT at measured
 *        │              section offsets. See "why the arc is a dial" below.
 *        ●           ← the body: where you actually are
 *        │
 *        ╵ 02
 *         ╲
 *          ╵ 03      ← the bow. 32 user units of sagitta over 540 of run: enough
 *          │            that the eye reads a curve, little enough that the
 *        ╷ 04          numbers stay in a column.
 *
 * ── ⚠ WHY THE ARC IS A DIAL AND NOT A MAP ────────────────────────────────────────────────────────
 * The nodes are spaced EVENLY along the arc, not placed at each section's real scroll offset. A map
 * would be the obvious choice and it is the wrong one twice over. It would have to re-measure and
 * re-place every node on every resize, reflow and font load; and because a section's height is decided
 * by how much copy it happens to hold, the "map" it drew would be a chart of paragraph lengths rather
 * than of the document's structure — two nodes crushed together because one section is terse.
 *
 * The BODY carries the real position, continuously and honestly. The nodes are an index.
 *
 * ── ⚠ THE ARC IS DEFINED BY ITS SAGITTA, NOT BY ITS RADIUS ───────────────────────────────────────
 * `ARC_RADIUS` below is derived, never typed. What is actually being chosen is how far the middle of
 * the arc bows out from the chord — that is the thing you can see, and it is the thing that has to
 * stay inside a gutter about 60 units wide. Picking a radius by hand and looking at the result means
 * re-guessing every time the gutter changes width.
 */

/** The SVG's coordinate space. Everything below is in these units; CSS scales the whole thing. */
export const RAIL_VIEW_BOX = { width: 60, height: 600 } as const;

/** The chord: a vertical line near the right of the gutter, which the arc bows to the LEFT of. */
const CHORD_X = 46;
const CHORD_TOP_Y = 30;
const CHORD_BOTTOM_Y = 570;

/** How far the middle of the arc stands off the chord. The one number here chosen by eye. */
const ARC_SAGITTA = 32;

const CHORD_HALF_LENGTH = (CHORD_BOTTOM_Y - CHORD_TOP_Y) / 2;

/**
 * Derived from the sagitta, by the intersecting-chords relation:
 *   s(2R − s) = (c/2)²   →   R = ((c/2)² + s²) / 2s
 */
const ARC_RADIUS =
  (CHORD_HALF_LENGTH * CHORD_HALF_LENGTH + ARC_SAGITTA * ARC_SAGITTA) / (2 * ARC_SAGITTA);

/** The centre sits to the RIGHT of the chord, which is what makes the arc bow left. */
const CENTRE_X = CHORD_X + Math.sqrt(ARC_RADIUS * ARC_RADIUS - CHORD_HALF_LENGTH * CHORD_HALF_LENGTH);
const CENTRE_Y = (CHORD_TOP_Y + CHORD_BOTTOM_Y) / 2;

const START_ANGLE = Math.atan2(CHORD_TOP_Y - CENTRE_Y, CHORD_X - CENTRE_X);
const END_ANGLE = Math.atan2(CHORD_BOTTOM_Y - CENTRE_Y, CHORD_X - CENTRE_X);

const TWO_PI = Math.PI * 2;

/**
 * ⚠ THE SHORT WAY ROUND, AND IT MUST BE COMPUTED — THE OBVIOUS SUBTRACTION IS A BUG.
 *
 * The centre sits to the RIGHT of the chord, so both endpoints are at angles near ±180° — which is
 * exactly where `atan2` wraps. It returns −166.5° for the top of the arc and +166.5° for the bottom,
 * so a plain `END − START` reads as **+333°**: the long way round, out through 0° and the far side of
 * a 1155-unit circle. The arc that was asked for is the 27° between them.
 *
 * Interpolating that 333° put every station and the travelling body **outside the 60 × 600 viewBox** —
 * nodes 01 and 02 at x ≈ 1962 and NEGATIVE y, i.e. floating up over the masthead and off to the right
 * of the page, while the drawn `<path>` (an SVG `A` command, which takes the short arc by construction)
 * stayed correctly in the gutter. The precise failure this file's own header warns about: the drawn
 * path and the placed nodes disagreeing.
 *
 * Rounding the raw difference to the nearest full turn and subtracting it folds any angle pair into
 * the shortest signed sweep, whichever side of the wrap they landed on.
 */
const ARC_SWEEP = END_ANGLE - START_ANGLE - TWO_PI * Math.round((END_ANGLE - START_ANGLE) / TWO_PI);

/**
 * A point on the orbit, at `fraction` of the way down it.
 *
 * The single source for both jobs: node placement (a fixed fraction each, at build time) and the
 * travelling body (scroll progress, per frame).
 */
export function pointOnRail(fraction: number): { x: number; y: number } {
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  const angle = START_ANGLE + ARC_SWEEP * clamped;
  return {
    x: CENTRE_X + ARC_RADIUS * Math.cos(angle),
    y: CENTRE_Y + ARC_RADIUS * Math.sin(angle),
  };
}

/**
 * Where node `index` of `count` sits. Evenly spread, and inset from both ends so the arc runs ON past
 * its contents at each end — an orbit that stops exactly where its stations do reads as a bracket.
 *
 * A single node (a one-section page) would divide by zero on the even spread, so it takes the middle.
 */
export function nodeFraction(index: number, count: number): number {
  if (count <= 1) return 0.5;
  const NODE_INSET = 0.08;
  return NODE_INSET + (index / (count - 1)) * (1 - NODE_INSET * 2);
}

/**
 * The arc as an SVG path.
 *
 * Sweep flag 0 — counter-clockwise on screen. The centre is to the right of the chord, so running top
 * to bottom past a leftward bow is the negative direction in SVG's y-down space. Large-arc 0: the
 * whole run is about 27°.
 *
 * ⚠ Consumed with `pathLength="1"` on the element, so `stroke-dasharray: 1` and a dashoffset of
 * `1 − progress` draw exactly the travelled portion with no arc-length arithmetic anywhere — and none
 * that would have to be redone if the sagitta above ever changed.
 */
export function railPath(): string {
  return (
    `M ${CHORD_X} ${CHORD_TOP_Y} ` +
    `A ${ARC_RADIUS.toFixed(2)} ${ARC_RADIUS.toFixed(2)} 0 0 0 ${CHORD_X} ${CHORD_BOTTOM_Y}`
  );
}
