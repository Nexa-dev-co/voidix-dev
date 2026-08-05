import * as THREE from 'three';

/**
 * A mark's outlines, as closed loops you can sample anywhere along.
 *
 * ── Why a loop and not just a point list ─────────────────────────────────────────────────────────
 * The geode body subdivides its cap mesh, and every subdivision inserts a new point halfway along an
 * existing boundary edge. Taking the geometric midpoint of a chord would quietly polygonise the
 * outline — a circle would come out as a coarse N-gon with subdivided straight edges, and the logo
 * marks are mostly curves. So a boundary point carries its ARC PARAMETER, and a midpoint is found by
 * averaging the two parameters and re-sampling the original dense outline at that value. The curve
 * survives however many times it is split.
 *
 * ── Arc length, not vertex index ─────────────────────────────────────────────────────────────────
 * A contour's own points cluster around curves and spread out along straights, so stepping per-vertex
 * piles samples onto every corner and leaves the flat runs bare. Everything here works in normalised
 * arc length instead, which is the same discipline the swarm used to place its outline chunks.
 */

/** How finely a `THREE.Path` is flattened before anything is measured. */
const SOURCE_DIVISIONS = 400;

/** No loop resamples below this, however short it is — an ε-hole still needs a ring. */
const MIN_LOOP_POINTS = 12;

export interface ClosedLoop {
  /** The dense source polyline. Closed implicitly: the last point connects back to the first. */
  source: THREE.Vector2[];
  /** Arc length at each source point, plus the total as one extra trailing entry. */
  cumulative: number[];
  totalLength: number;
}

/** One shape's outline and the holes punched in it — the unit `ShapeUtils.triangulateShape` wants. */
export interface MarkShapeLoops {
  outer: ClosedLoop;
  holes: ClosedLoop[];
}

/** Twice the enclosed area, signed: positive is counter-clockwise. */
function signedArea(points: THREE.Vector2[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    total += from.x * to.y - to.x * from.y;
  }
  return total;
}

/**
 * Flatten a shape's paths into loops, with a known winding.
 *
 * ── Why the flip happens here and not on the finished geometry ───────────────────────────────────
 * `markBody.ts` fixes SVG's downward Y axis by rotating the extruded geometry a half turn about X,
 * because a negative scale is a reflection that inverts every triangle's winding (see its header). The
 * geode builder generates all of its own faces, so it can do better: negate Y here, then normalise
 * every outline to counter-clockwise and every hole to clockwise, and emit windings from that known
 * orientation. Nothing is mirrored and nothing needs undoing afterwards.
 *
 * That also keeps the finished body in the same space the base rock is authored in. A final rotation
 * would silently rotate the rock's centre with it, so a rock placed low on an SVG mark would jump to
 * the top.
 */
export function extractShapeLoops(
  shapes: THREE.Shape[],
  flipY: boolean,
): MarkShapeLoops[] {
  const toLoop = (
    path: THREE.Path | THREE.Shape,
    wantCounterClockwise: boolean,
  ): ClosedLoop => {
    const points = path
      .getPoints(SOURCE_DIVISIONS)
      .map((point) => new THREE.Vector2(point.x, flipY ? -point.y : point.y));
    const isCounterClockwise = signedArea(points) > 0;
    if (isCounterClockwise !== wantCounterClockwise) points.reverse();
    return createClosedLoop(points);
  };

  return shapes
    .map((shape) => ({
      outer: toLoop(shape, true),
      holes: shape.holes.map((hole) => toLoop(hole, false)),
    }))
    .filter((entry) => entry.outer.totalLength > 0);
}

/** Measure a polyline once, so it can be sampled by arc length afterwards. */
function createClosedLoop(points: THREE.Vector2[]): ClosedLoop {
  // A path that ends where it started would contribute a zero-length segment and a duplicate sample.
  const source = points.slice();
  while (
    source.length > 1 &&
    source[0].distanceTo(source[source.length - 1]) < 1e-9
  ) {
    source.pop();
  }

  const cumulative: number[] = [0];
  let totalLength = 0;
  for (let index = 0; index < source.length; index += 1) {
    const from = source[index];
    const to = source[(index + 1) % source.length];
    totalLength += from.distanceTo(to);
    cumulative.push(totalLength);
  }

  return { source, cumulative, totalLength };
}

/**
 * The point at a normalised position around the loop. `param` wraps, so 1.2 is the same as 0.2 and a
 * midpoint that straddles the seam still lands on the curve.
 */
export function sampleLoop(
  loop: ClosedLoop,
  param: number,
  target: THREE.Vector2,
): THREE.Vector2 {
  if (loop.source.length === 0) return target.set(0, 0);
  if (loop.totalLength <= 0) return target.copy(loop.source[0]);

  const wrapped = param - Math.floor(param);
  const distance = wrapped * loop.totalLength;

  // The cumulative table is sorted, so this is a binary search for the segment containing `distance`.
  let low = 0;
  let high = loop.source.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (loop.cumulative[middle] <= distance) low = middle;
    else high = middle - 1;
  }

  const segmentStart = loop.cumulative[low];
  const segmentLength = loop.cumulative[low + 1] - segmentStart;
  const along = segmentLength > 0 ? (distance - segmentStart) / segmentLength : 0;
  const from = loop.source[low];
  const to = loop.source[(low + 1) % loop.source.length];
  return target.copy(from).lerp(to, along);
}

/**
 * How many points a loop should be resampled to for a given edge length, rounded to a multiple of the
 * subdivision factor so that every later split lands on a clean parameter.
 */
export function loopPointCount(
  loop: ClosedLoop,
  targetEdgeLength: number,
  multipleOf: number,
): number {
  const wanted = Math.ceil(loop.totalLength / Math.max(targetEdgeLength, 1e-4));
  const clamped = Math.max(wanted, MIN_LOOP_POINTS);
  return Math.ceil(clamped / multipleOf) * multipleOf;
}

/** Evenly spaced points around a loop, plus the arc parameter each one sits at. */
export function resampleLoop(
  loop: ClosedLoop,
  count: number,
): { points: THREE.Vector2[]; params: number[] } {
  const points: THREE.Vector2[] = [];
  const params: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const param = index / count;
    params.push(param);
    points.push(sampleLoop(loop, param, new THREE.Vector2()));
  }
  return { points, params };
}

/** Standard crossing count. A point is inside the polygon when the count is odd. */
function isInsidePolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current, current += 1
  ) {
    const a = polygon[current];
    const b = polygon[previous];
    if (a.y > point.y === b.y > point.y) continue;
    const crossingX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

/** Inside the mark: within some shape's outline, and not inside one of that shape's holes. */
export function isInsideMark(
  point: THREE.Vector2,
  shapeLoops: { outer: THREE.Vector2[]; holes: THREE.Vector2[][] }[],
): boolean {
  return shapeLoops.some(
    (shape) =>
      isInsidePolygon(point, shape.outer) &&
      !shape.holes.some((hole) => isInsidePolygon(point, hole)),
  );
}
