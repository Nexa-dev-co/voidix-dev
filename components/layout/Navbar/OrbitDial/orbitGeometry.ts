import { NAV_ITEMS } from '../navItems';

/**
 * The fan's geometry — the ONE place the drawn arc and the drag's hit-testing agree.
 *
 * They must agree exactly. The nodes are placed from these numbers and the selection is done by
 * measuring the pointer against the same ones, so a copy of any of this in the stylesheet would be a
 * selection that lands one row off the thing you can see.
 *
 * ── The shape ────────────────────────────────────────────────────────────────────────────────────
 * One continuous arc leaving the navbar's mark, bowing out to the left and falling away down the
 * screen, with four nodes on it. Each node runs a leader out to its number and name and a tail out to a
 * terminator dot — a plotted trajectory with its stations called out.
 *
 *      •──── ⁰¹ SERVICES ───●                     ⊙ ← the mark, where the arc leaves the bar
 *                            ╲                  ╱
 *   •──── ⁰² WORK ────────────●                ╱
 *                              ╲              ╱
 *        •──── ⁰³ PROCESS ──────●            ╱
 *                                 ╲         ╱
 *          •──── ⁰⁴ CONTACT ───────●───────╱
 *
 * ⚠ 01 IS NEAREST THE MARK. The numbers run away from the button, in the order you meet them reading
 * down — and in the order the site itself travels. It was the other way round to begin with, copying a
 * poster where the composition read bottom-up; on a control you sweep downward through, that put 04
 * under your thumb first and 01 furthest away, which is backwards twice over.
 *
 * ── ⚠ THE ARC IS NOT CENTRED ON THE MARK, AND THAT IS THE WHOLE FIX ──────────────────────────────
 * It used to be: nodes at even angles about the button. The result was that the bottom two rows came
 * out 21px apart while the top two were 45px apart, because a circle centred on the pivot is being
 * sampled near its BOTTOM (θ≈90°), and near the bottom of a circle `y = R·sin θ` is flat — the whole
 * point is stationary there. Vertical spread costs almost nothing in angle at 180° and almost
 * everything at 90°.
 *
 * So the circle's centre is offset DOWN AND RIGHT of the mark, and the stations sample it around its
 * LEFTMOST point (θ = 180°), where `sin` is changing fastest. That is what buys four evenly spread rows
 * — roughly 130px apart instead of 21 — and it is also the shape of the reference this was drawn from.
 * The arc still passes exactly through the mark, by construction: the radius IS the distance from the
 * centre to the mark, so the trajectory genuinely leaves the button rather than appearing near it.
 */

// ── The construction, in DESIGN UNITS ──
// A 360px-wide phone, origin at the mark's centre, x right and y down. Everything is multiplied by
// `fanScale` at use, so one set of numbers describes every screen.

/** Where the circle's centre sits relative to the mark. Down and to the right — see the header. */
const ARC_CENTRE_X = 198;
const ARC_CENTRE_Y = 264;

/** …which fixes the radius, because the arc must pass through the mark itself. */
const ARC_RADIUS = Math.hypot(ARC_CENTRE_X, ARC_CENTRE_Y);

/**
 * The band of the circle the stations occupy, in degrees clockwise from +x about the CENTRE (not the
 * mark). 180° is the circle's leftmost point, so the run 130°→205° straddles it — which is exactly
 * where the vertical spread is best (see the header).
 *
 * ⚠ The HIGHEST angle is the one nearest the bar, so station 0 takes the top of this band and the
 * others descend from it — see `stationOffset`.
 */
const STATION_START_DEG = 130;
const STATION_STEP_DEG = 25;

/**
 * The angle, on that same circle, at which the MARK sits.
 *
 * ⚠ Derived, never chosen. The arc has to start exactly here or it does not leave the button — it
 * merely appears near it, with a gap. (It did, on the first pass: a fixed overshoot past the top
 * station stopped 16° short of the mark and left ~90px of nothing between the two.) Because the radius
 * is the distance from the centre to the mark, this angle always lands the path on (0, 0).
 */
const MARK_ANGLE_DEG =
  (Math.atan2(-ARC_CENTRE_Y, -ARC_CENTRE_X) * 180) / Math.PI + 360;

/** How far the drawn arc runs past the LAST station, at the tail end. */
const ARC_TAIL_OVERSHOOT_DEG = 12;

/**
 * The overall scale.
 *
 * Bounded by BOTH axes: the width decides whether a row's label clears the left edge, and the height
 * decides whether the bottom station clears the bottom of the screen. A phone in landscape fails the
 * second long before the first, so taking the smaller of the two is not belt-and-braces.
 */
export function fanScale(viewportWidth: number, viewportHeight: number): number {
  return Math.min(viewportWidth / 360, viewportHeight / 720, 1.25);
}

/**
 * Where one station sits, in design units relative to the mark.
 *
 * ⚠ Counted DOWN from the top of the band, so index 0 (`SERVICES`, 01) is the station nearest the mark
 * and index 3 (`CONTACT`, 04) is furthest away. Everything else in this module derives from here — the
 * pointer angles, the selection, the stagger order — so this single expression is what decides the
 * running order of the whole control.
 */
export function stationOffset(index: number): { x: number; y: number } {
  const fromTop = NAV_ITEMS.length - 1 - index;
  const radians = ((STATION_START_DEG + fromTop * STATION_STEP_DEG) * Math.PI) / 180;
  return {
    x: ARC_CENTRE_X + ARC_RADIUS * Math.cos(radians),
    y: ARC_CENTRE_Y + ARC_RADIUS * Math.sin(radians),
  };
}

/**
 * The angle each station subtends AT THE MARK, which is what the drag hit-tests against.
 *
 * ⚠ Not the same as its angle on the circle, and it must be derived rather than assumed. It happens to
 * come out very evenly — about 129°, 116.6°, 104° and 91.6° for stations 0…3, so 12.5° apart and
 * DESCENDING — but that is a consequence of the construction above, not something chosen. Change the
 * centre offset or the running order and these move with it, which is exactly why the selection reads
 * them from the same function that places the nodes.
 */
function stationPointerAngle(index: number): number {
  const offset = stationOffset(index);
  return (Math.atan2(offset.y, offset.x) * 180) / Math.PI;
}

/**
 * The arc, as an SVG path in design units with the mark at the origin.
 *
 * Constant, so a resize scales the SVG and never rebuilds the string. `0 0` is the mark itself — the
 * path starts there by construction.
 */
export function arcPath(): string {
  const pointAt = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: ARC_CENTRE_X + ARC_RADIUS * Math.cos(radians),
      y: ARC_CENTRE_Y + ARC_RADIUS * Math.sin(radians),
    };
  };
  // Starts AT the mark — the highest angle on the circle is the one nearest the bar — and runs down
  // past the last station.
  const start = pointAt(MARK_ANGLE_DEG);
  const end = pointAt(STATION_START_DEG - ARC_TAIL_OVERSHOOT_DEG);
  // Sweep 0 (counter-clockwise on screen) because the path runs from the high angle down to the low
  // one; large-arc 0 because the whole run is about 115°, well under 180.
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${ARC_RADIUS.toFixed(2)} ${ARC_RADIUS.toFixed(
    2,
  )} 0 0 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/** The SVG's viewBox in design units, sized to hold the arc and its glow with room to spare. */
export const ARC_VIEW_BOX = { x: -170, y: -40, width: 260, height: 640 } as const;

/**
 * Inside this many px of the mark the pointer has not committed to anything yet.
 *
 * Without it, the tiniest tremor during a press would resolve to whatever angle it happened to be at
 * and arm a jump the visitor never asked for.
 */
const DEAD_ZONE_PX = 44;

/**
 * Which station the pointer is over, or `null` for none.
 *
 * By ANGLE at the mark, not by proximity to the node — anywhere along a station's ray counts, at any
 * distance past the dead zone. That is what makes a 10px node a comfortable target: the real target is
 * a ~12.5° wedge running the height of the screen, and it covers the row's whole label on the way.
 */
export function stationFromPointer(
  deltaX: number,
  deltaY: number,
  scale: number,
): number | null {
  if (Math.hypot(deltaX, deltaY) < DEAD_ZONE_PX * scale) return null;

  // atan2 with y measured DOWNWARD gives degrees clockwise from +x, the convention used throughout.
  const angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;

  const lastIndex = NAV_ITEMS.length - 1;
  const first = stationPointerAngle(0);
  const last = stationPointerAngle(lastIndex);
  const halfStep = Math.abs(last - first) / lastIndex / 2;
  if (angle < Math.min(first, last) - halfStep || angle > Math.max(first, last) + halfStep) {
    return null;
  }

  // Nearest by angle. A loop rather than arithmetic because the angles are derived and only
  // approximately evenly spaced — rounding against an assumed step would drift at the ends.
  let nearest = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index <= lastIndex; index += 1) {
    const distance = Math.abs(angle - stationPointerAngle(index));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }
  return nearest;
}

/**
 * Which section the visitor is currently in, as an index into `NAV_ITEMS`, or `null` in the hero.
 *
 * Read from the very same `--nav-progress-<key>` variables the navbar's meters run on: the pin fills
 * every section behind you to 1 and leaves everything ahead at 0, so the one you are in is simply the
 * LAST one that has started. Read once when the fan opens rather than per frame — the fan swallows the
 * gestures that would move the page, so it cannot change while it is up.
 */
export function currentSectionIndex(): number | null {
  const styles = getComputedStyle(document.documentElement);
  let found: number | null = null;
  NAV_ITEMS.forEach((navItem, index) => {
    const raw = styles.getPropertyValue(`--nav-progress-${navItem.key}`).trim();
    const progress = Number.parseFloat(raw);
    if (Number.isFinite(progress) && progress > 0) found = index;
  });
  return found;
}
