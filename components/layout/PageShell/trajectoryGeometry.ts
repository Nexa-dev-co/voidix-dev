/**
 * The phase track's trajectory — the ONE place the drawn curve and the phase markers agree about where
 * a point on the path is.
 *
 * `railGeometry.ts` is the same idea standing up in the gutter; this is it lying down under a row of
 * phases. Two files rather than one generalised module because the two solve different shapes: the rail
 * bows a fixed-width gutter and is consumed by `pathLength`, while this one has to stretch to whatever
 * width the section is and hand each marker a vertical offset in the same breath. A single "arc helper"
 * covering both would take more parameters than either caller has opinions about.
 *
 *          ╭─────●─────╮
 *     ●────╯            ╰────●          the markers ride the curve; the curve does not
 *   Day 0   2 days   Week 1   Week 2    pass near them and hope
 *
 * ── ⚠ WHY A QUADRATIC AND NOT A CIRCULAR ARC ─────────────────────────────────────────────────────
 * Because this one is drawn with `preserveAspectRatio="none"` — it has to stretch from a 20rem column
 * to a 60rem one without the curve's depth changing with the width. A stretched circle is no longer a
 * circle, so a radius here would be a lie the moment the viewport moved. A quadratic Bézier stretches
 * to exactly itself: with the control point centred, x(t) collapses to a straight `t` (the two t² terms
 * cancel), which is what lets a marker at fraction t sit at `left: t × 100%` in ordinary CSS while its
 * height comes from `heightAt(t)`. No measurement, no resize handler, no second copy of the curve.
 */

/**
 * The curve's coordinate space. Width is nominal — the SVG stretches — so only the HEIGHT is a real
 * quantity, and it is what the CSS divides by to turn a marker's offset into pixels.
 */
export const TRAJECTORY_VIEW_BOX = { width: 100, height: 20 } as const;

/** Where the curve sits at its ends, and how far it climbs between them. */
const END_Y = 16;
const APEX_CONTROL_Y = 0;

/**
 * How high the curve stands at `fraction`, in viewBox units.
 *
 * The quadratic with both ends at `END_Y` and the control point centred:
 *   y(t) = (1−t)²·END_Y + 2(1−t)t·APEX_CONTROL_Y + t²·END_Y
 *
 * ⚠ The apex is at HALF the control point's height, which is why `APEX_CONTROL_Y` is named for the
 * control and not for the apex — a Bézier does not pass through its own handle.
 */
export function trajectoryHeightAt(fraction: number): number {
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  const inverse = 1 - clamped;
  return (
    inverse * inverse * END_Y + 2 * inverse * clamped * APEX_CONTROL_Y + clamped * clamped * END_Y
  );
}

/**
 * Where phase `index` of `count` sits along the run.
 *
 * The LEFT EDGE of its own column, because the markers sit at the left of each phase's text and the
 * grid gives every phase an equal share of the width. That also means the curve runs on past the last
 * marker rather than ending under it — the track continues after the final phase, which is the correct
 * thing for a hiring process to imply.
 */
export function phaseFraction(index: number, count: number): number {
  if (count <= 0) return 0;
  return index / count;
}

/** The trajectory as an SVG path. One quadratic, its control point centred — see the header. */
export function trajectoryPath(): string {
  const { width } = TRAJECTORY_VIEW_BOX;
  return `M 0 ${END_Y} Q ${width / 2} ${APEX_CONTROL_Y} ${width} ${END_Y}`;
}
