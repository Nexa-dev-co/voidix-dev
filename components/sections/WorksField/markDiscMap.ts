import * as THREE from 'three';
import type { CapLoop, CapMesh } from './markCapMesh';

/**
 * Where every point of the mark's face sits on a unit disc — the map the base rock is built from.
 *
 * ── What this replaces, and why ──────────────────────────────────────────────────────────────────
 * The geode's `p = 0` state puts every vertex of the mark's prism somewhere on the rock's skin, and
 * something has to decide WHERE. That used to be a polar map about the mark's centroid: angle, plus
 * distance as a fraction of the outline's distance at that angle. It is a bijection only when every
 * ray from the centroid crosses the outline exactly once — i.e. only for star-shaped marks. No
 * interesting glyph is star-shaped, and a "V" fails it badly:
 *
 *      the mark                    the rock's front cap, as the polar map paints it
 *
 *    ██▖      ▗██                        ╭─────────────────╮
 *     ██▖    ▗██                       ╱▓▓▓▓             ▓▓▓▓╲
 *      ██▖  ▗██                       │▓▓▓▓               ▓▓▓▓│
 *       ██▖▗██                        │ ▓▓▓     HOLE     ▓▓▓ │
 *        ████                          ╲  ▓▓▓▓         ▓▓▓▓ ╱
 *                                        ╰───▓▓▓▓▓▓▓▓▓───╯
 *    the notch holds no
 *    material, so nothing      ▓ = painted     blank = never drawn, and the body
 *    ever maps into it                                 is double-sided, so you see
 *                                                      straight through it
 *
 * ── Tutte instead ────────────────────────────────────────────────────────────────────────────────
 * Pin the outline to the unit circle by ARC LENGTH, give every interior point the weighted average of
 * its neighbours, and solve. Tutte's theorem says the result is a fold-free embedding for ANY simple
 * polygon, concave or not — so the disc is covered exactly once and so, downstream, is the rock.
 *
 * The weights are Floater's MEAN VALUE coordinates, not cotangents. Cotangent weights go negative on
 * an obtuse triangle, and one negative weight is enough to void the guarantee and fold the map. Mean
 * value weights are strictly positive for any non-degenerate triangle, which is the whole reason to
 * pay for the extra tangent.
 *
 * The V's notch is not magicked away — nothing can do that, because covering an empty sector requires
 * stretching material from beside it. What the solve does is spread that stretch across every triangle
 * near the concavity instead of tearing a hole:
 *
 *      cap mesh                 mean value disc map               the rock's front cap
 *
 *    ██▖    ▗██                    ╭─────────╮                       ╭─────────╮
 *     ██▖  ▗██                    ╱ · · · · · ╲                     ╱▓▓▓▓▓▓▓▓▓▓▓╲
 *      ██▖▗██          ──▶       │ ·  ·  ·  · │        ──▶         │▓▓▓▓▓▓▓▓▓▓▓▓▓│
 *       ████                      ╲ · · · · · ╱                     ╲▓▓▓▓▓▓▓▓▓▓▓╱
 *                                  ╰─────────╯                       ╰─────────╯
 *                       the notch's two inner edges are part of the outline,
 *                       so they take their share of the circle by arc length
 *
 * ── Holes ────────────────────────────────────────────────────────────────────────────────────────
 * A counter ("O", "A", the compass ring) makes the face an annulus, and Tutte wants a disc. So each
 * hole is pinned to its own ε-circle — which is also exactly the collapsed tube the geode needs at
 * `p = 0`, so the two requirements are the same requirement. Where to centre that circle is not known
 * before solving, so it is solved for: one pass with the holes free tells us where each one wants to
 * sit, and a second pass pins them there.
 */

/** Angular resolution of the boundary-distance table the seed map reads. */
const ANGLE_BINS = 720;

const TAU = Math.PI * 2;

/**
 * Plain Gauss-Seidel, deliberately.
 *
 * Cap meshes here run to a few thousand points — at `capEdgeFraction` 0.017 and three subdivisions a
 * typical glyph lands under a thousand — so a guaranteed-convergent sweep is cheap enough that
 * over-relaxation would be optimising the wrong thing. Mean value weights are asymmetric, and SOR's
 * convergence proof does not cover asymmetric systems; if this ever needs to be faster, the honest
 * lever is solving on the subdivision hierarchy rather than guessing at an ω.
 */
const MAX_SWEEPS = 4000;
/** Locating a hole's centre needs far less precision than the final map does. */
const HOLE_LOCATING_SWEEPS = 400;
const CONVERGENCE_TOLERANCE = 1e-6;

/** Keep a pinned hole ring clear of the outer circle. */
const HOLE_EDGE_MARGIN = 0.05;
const MIN_HOLE_RADIUS = 1e-3;

/** Below this an edge or a triangle carries no usable direction. */
const EPSILON = 1e-9;
/** Slack on the fold test, so a legitimately tiny sliver isn't reported as inverted. */
const FOLD_TOLERANCE = 1e-12;

export interface DiscMapOptions {
  /**
   * Radius each hole's rim is pinned to, in the unit disc — the width of its collapsed tube at
   * `p = 0`. Too small and the tube's normals go bad; too large and you can see the pinprick before
   * it opens.
   */
  holeRadius: number;
}

export interface DiscMap {
  /** Two floats per cap point: its position in the unit disc. */
  coordinates: Float32Array;
  /**
   * False when the solve was skipped or rejected, and these are the old star-shaped polar
   * coordinates instead. Surfaced to the panel — a mark drawn with a fallback map has the wedge, and
   * that needs to be legible as "unsupported mark" rather than as "the geode is broken".
   */
  isRelaxed: boolean;
}

export function buildDiscMap(capMesh: CapMesh, options: DiscMapOptions): DiscMap {
  const pointCount = capMesh.points.length;
  const coordinates = new Float32Array(pointCount * 2);
  if (pointCount === 0 || capMesh.triangles.length === 0) {
    return { coordinates, isRelaxed: false };
  }

  // The seed doubles as the fallback: converging from it is fast, and if the solve has to be rejected
  // the body still draws exactly as it did before this map existed.
  seedFromPolarMap(capMesh, coordinates);

  const outerLoops = capMesh.loops.filter((capLoop) => !capLoop.isHole);
  const holeLoops = capMesh.loops.filter((capLoop) => capLoop.isHole);

  // One outline, one circle. A mark made of several separate shapes ("i", or a logo with detached
  // elements) needs several rocks, and how many rocks a mark gets is a design decision rather than
  // something a solver can answer — so hand back the seed and let the caller report it.
  if (outerLoops.length !== 1) return { coordinates, isRelaxed: false };

  const weights = buildMeanValueWeights(capMesh, pointCount);
  const pinned = new Uint8Array(pointCount);
  pinOuterLoop(outerLoops[0], coordinates, pinned);

  if (holeLoops.length > 0) {
    // Pass 1 — holes free. Their rims collapse inward, which is meaningless as geometry and exactly
    // what is wanted as a position: wherever a hole's rim settles is where the map wants that hole.
    relax(coordinates, pinned, weights, pointCount, HOLE_LOCATING_SWEEPS);
    pinHoleLoops(holeLoops, coordinates, pinned, options.holeRadius);
  }

  relax(coordinates, pinned, weights, pointCount, MAX_SWEEPS);

  if (!isFoldFree(capMesh, coordinates)) {
    // A folded map renders inside-out geometry, which is worse than the wedge the seed leaves. Take
    // the known-imperfect result over the unknown one.
    seedFromPolarMap(capMesh, coordinates);
    return { coordinates, isRelaxed: false };
  }

  return { coordinates, isRelaxed: true };
}

// ── The seed, and the fallback ──

/**
 * The old star-shaped polar map: angle about the centroid, and distance as a fraction of the
 * outline's distance at that angle.
 *
 * Kept because it is a good initial guess — it is right wherever the mark is locally star-shaped,
 * which is most of it — and because it is what the geode drew before, so falling back to it is a
 * regression to a known state rather than to an unknown one.
 */
function seedFromPolarMap(capMesh: CapMesh, coordinates: Float32Array): void {
  const centroid = new THREE.Vector2();
  capMesh.outerPoints.forEach((point) => centroid.add(point));
  if (capMesh.outerPoints.length > 0) centroid.divideScalar(capMesh.outerPoints.length);

  const table = buildBoundaryTable(capMesh.outerPoints, centroid);

  capMesh.points.forEach((point, pointIndex) => {
    const offsetX = point.x - centroid.x;
    const offsetY = point.y - centroid.y;
    const angle = Math.atan2(offsetY, offsetX);
    const boundary = boundaryRadiusAt(table, angle);
    const radius =
      boundary > 0 ? Math.min(Math.hypot(offsetX, offsetY) / boundary, 1) : 0;
    coordinates[pointIndex * 2] = radius * Math.cos(angle);
    coordinates[pointIndex * 2 + 1] = radius * Math.sin(angle);
  });
}

/**
 * How far the outline sits from the centroid, per angle.
 *
 * Several crossings at one angle means the OUTERMOST wins — which is precisely the approximation that
 * makes this a seed and not the answer.
 */
function buildBoundaryTable(
  outerPoints: THREE.Vector2[],
  centroid: THREE.Vector2,
): Float32Array {
  const table = new Float32Array(ANGLE_BINS);
  let largest = 0;

  outerPoints.forEach((point) => {
    const offsetX = point.x - centroid.x;
    const offsetY = point.y - centroid.y;
    const radius = Math.hypot(offsetX, offsetY);
    if (radius <= 0) return;
    largest = Math.max(largest, radius);
    const angle = Math.atan2(offsetY, offsetX);
    const bin = Math.floor(((angle + Math.PI) / TAU) * ANGLE_BINS) % ANGLE_BINS;
    table[bin] = Math.max(table[bin], radius);
  });

  // Bins between samples are empty on a sparse outline; carry the nearest measured value into them so
  // the seed stays continuous rather than snapping to zero.
  const fallback = largest > 0 ? largest : 1;
  for (let bin = 0; bin < ANGLE_BINS; bin += 1) {
    if (table[bin] > 0) continue;
    let found = 0;
    for (let step = 1; step < ANGLE_BINS && found === 0; step += 1) {
      found = Math.max(
        table[(bin + step) % ANGLE_BINS],
        table[(bin - step + ANGLE_BINS) % ANGLE_BINS],
      );
    }
    table[bin] = found > 0 ? found : fallback;
  }
  return table;
}

function boundaryRadiusAt(table: Float32Array, angle: number): number {
  const normalised = ((angle + Math.PI) / TAU) * ANGLE_BINS;
  const low = Math.floor(normalised) % ANGLE_BINS;
  const high = (low + 1) % ANGLE_BINS;
  const blend = normalised - Math.floor(normalised);
  return THREE.MathUtils.lerp(table[low], table[high], blend);
}

// ── The solve ──

/** Neighbour lists and their weights, flattened. `start[i]…start[i+1]` is vertex `i`'s span. */
interface MeanValueWeights {
  start: Int32Array;
  index: Int32Array;
  weight: Float64Array;
}

/**
 * Floater's mean value weights, accumulated triangle by triangle.
 *
 * At a corner `i` of a triangle, the half-angle there contributes to BOTH of the edges leaving `i` —
 * so summing over every triangle gives each edge the `tan(α/2) + tan(β/2)` its two adjacent triangles
 * owe it, with no explicit edge-adjacency structure to build.
 */
function buildMeanValueWeights(capMesh: CapMesh, pointCount: number): MeanValueWeights {
  const adjacency: Set<number>[] = Array.from({ length: pointCount }, () => new Set<number>());
  const { triangles, points } = capMesh;

  for (let triangle = 0; triangle < triangles.length; triangle += 3) {
    const a = triangles[triangle];
    const b = triangles[triangle + 1];
    const c = triangles[triangle + 2];
    adjacency[a].add(b).add(c);
    adjacency[b].add(a).add(c);
    adjacency[c].add(a).add(b);
  }

  const start = new Int32Array(pointCount + 1);
  for (let point = 0; point < pointCount; point += 1) {
    start[point + 1] = start[point] + adjacency[point].size;
  }
  const index = new Int32Array(start[pointCount]);
  const weight = new Float64Array(start[pointCount]);
  const slotOf: Map<number, number>[] = Array.from(
    { length: pointCount },
    () => new Map<number, number>(),
  );

  for (let point = 0; point < pointCount; point += 1) {
    let slot = start[point];
    adjacency[point].forEach((neighbour) => {
      index[slot] = neighbour;
      slotOf[point].set(neighbour, slot);
      slot += 1;
    });
  }

  const addCorner = (corner: number, first: number, second: number) => {
    const origin = points[corner];
    const toFirstX = points[first].x - origin.x;
    const toFirstY = points[first].y - origin.y;
    const toSecondX = points[second].x - origin.x;
    const toSecondY = points[second].y - origin.y;

    const firstLength = Math.hypot(toFirstX, toFirstY);
    const secondLength = Math.hypot(toSecondX, toSecondY);
    if (firstLength < EPSILON || secondLength < EPSILON) return;

    const cross = Math.abs(toFirstX * toSecondY - toFirstY * toSecondX);
    if (cross < EPSILON) return;

    // tan(θ/2) = (1 − cos θ) / sin θ, with the lengths cancelled out of both.
    const dot = toFirstX * toSecondX + toFirstY * toSecondY;
    const halfTangent = (firstLength * secondLength - dot) / cross;

    const firstSlot = slotOf[corner].get(first);
    const secondSlot = slotOf[corner].get(second);
    if (firstSlot !== undefined) weight[firstSlot] += halfTangent / firstLength;
    if (secondSlot !== undefined) weight[secondSlot] += halfTangent / secondLength;
  };

  for (let triangle = 0; triangle < triangles.length; triangle += 3) {
    const a = triangles[triangle];
    const b = triangles[triangle + 1];
    const c = triangles[triangle + 2];
    addCorner(a, b, c);
    addCorner(b, c, a);
    addCorner(c, a, b);
  }

  return { start, index, weight };
}

/** Every outline point onto the unit circle, spaced by arc length. */
function pinOuterLoop(
  outerLoop: CapLoop,
  coordinates: Float32Array,
  pinned: Uint8Array,
): void {
  outerLoop.indices.forEach((pointIndex, position) => {
    // Outer loops are counter-clockwise and their arc parameters increase along them, so a rising
    // angle preserves the orientation the cap triangles were wound with.
    const angle = outerLoop.params[position] * TAU;
    coordinates[pointIndex * 2] = Math.cos(angle);
    coordinates[pointIndex * 2 + 1] = Math.sin(angle);
    pinned[pointIndex] = 1;
  });
}

/** Each hole's rim onto its own ε-circle, centred wherever the free pass left it. */
function pinHoleLoops(
  holeLoops: CapLoop[],
  coordinates: Float32Array,
  pinned: Uint8Array,
  holeRadius: number,
): void {
  holeLoops.forEach((holeLoop) => {
    const rimCount = holeLoop.indices.length;
    if (rimCount === 0) return;

    let centreX = 0;
    let centreY = 0;
    holeLoop.indices.forEach((pointIndex) => {
      centreX += coordinates[pointIndex * 2];
      centreY += coordinates[pointIndex * 2 + 1];
    });
    centreX /= rimCount;
    centreY /= rimCount;

    // Align the ring with where the free pass actually put the rim, rather than with the disc's own
    // frame — a ring pinned at an arbitrary phase twists the tube against the hole it opens into.
    // Averaged as a direction, because angles wrap and their arithmetic mean does not.
    let phaseX = 0;
    let phaseY = 0;
    holeLoop.indices.forEach((pointIndex, position) => {
      const observed = Math.atan2(
        coordinates[pointIndex * 2 + 1] - centreY,
        coordinates[pointIndex * 2] - centreX,
      );
      const aligned = observed + holeLoop.params[position] * TAU;
      phaseX += Math.cos(aligned);
      phaseY += Math.sin(aligned);
    });
    const phase = Math.atan2(phaseY, phaseX);

    const radius = Math.max(
      Math.min(holeRadius, 1 - Math.hypot(centreX, centreY) - HOLE_EDGE_MARGIN),
      MIN_HOLE_RADIUS,
    );

    holeLoop.indices.forEach((pointIndex, position) => {
      // Holes run clockwise, so their image has to as well or the annulus maps inside-out.
      const angle = phase - holeLoop.params[position] * TAU;
      coordinates[pointIndex * 2] = centreX + Math.cos(angle) * radius;
      coordinates[pointIndex * 2 + 1] = centreY + Math.sin(angle) * radius;
      pinned[pointIndex] = 1;
    });
  });
}

function relax(
  coordinates: Float32Array,
  pinned: Uint8Array,
  weights: MeanValueWeights,
  pointCount: number,
  maxSweeps: number,
): void {
  const { start, index, weight } = weights;

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let largestMove = 0;

    for (let point = 0; point < pointCount; point += 1) {
      if (pinned[point] === 1) continue;

      let totalWeight = 0;
      let sumX = 0;
      let sumY = 0;
      for (let slot = start[point]; slot < start[point + 1]; slot += 1) {
        const neighbourWeight = weight[slot];
        if (neighbourWeight <= 0) continue;
        const neighbour = index[slot];
        totalWeight += neighbourWeight;
        sumX += neighbourWeight * coordinates[neighbour * 2];
        sumY += neighbourWeight * coordinates[neighbour * 2 + 1];
      }
      if (totalWeight <= 0) continue;

      const nextX = sumX / totalWeight;
      const nextY = sumY / totalWeight;
      const move = Math.hypot(
        nextX - coordinates[point * 2],
        nextY - coordinates[point * 2 + 1],
      );
      if (move > largestMove) largestMove = move;
      coordinates[point * 2] = nextX;
      coordinates[point * 2 + 1] = nextY;
    }

    if (largestMove < CONVERGENCE_TOLERANCE) return;
  }
}

/**
 * Every cap triangle still counter-clockwise in the disc.
 *
 * `buildCapMesh` forces them counter-clockwise in the mark's plane, so an orientation-preserving map
 * keeps them that way — one negative area means the embedding folded and the guarantee did not hold.
 */
function isFoldFree(capMesh: CapMesh, coordinates: Float32Array): boolean {
  const { triangles } = capMesh;
  for (let triangle = 0; triangle < triangles.length; triangle += 3) {
    const a = triangles[triangle] * 2;
    const b = triangles[triangle + 1] * 2;
    const c = triangles[triangle + 2] * 2;
    const area =
      (coordinates[b] - coordinates[a]) * (coordinates[c + 1] - coordinates[a + 1]) -
      (coordinates[c] - coordinates[a]) * (coordinates[b + 1] - coordinates[a + 1]);
    if (area < -FOLD_TOLERANCE) return false;
  }
  return true;
}
