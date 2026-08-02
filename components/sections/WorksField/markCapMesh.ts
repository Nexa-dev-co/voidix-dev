import * as THREE from 'three';
import {
  extractShapeLoops,
  isInsideMark,
  loopPointCount,
  resampleLoop,
  sampleLoop,
  type ClosedLoop,
} from './markContours';

/**
 * The mark's flat face, triangulated densely enough to be carved.
 *
 * ── Why not just use `ExtrudeGeometry`'s cap ─────────────────────────────────────────────────────
 * Earcut gives you a triangulation over the OUTLINE POINTS ONLY — no interior vertices at all, and
 * long slivers where the shape is thin. That cap cannot be displaced (there is nothing between the
 * edges to displace) and it cannot round into a rock at `p = 0` (a flat fan has no way to dome). Both
 * the crystal facets and the base rock depend on interior geometry, so the cap has to be refined.
 *
 * ── Uniform subdivision, with the boundary re-projected ──────────────────────────────────────────
 * Each round splits every triangle 1→4 through its edge midpoints, which is the one refinement scheme
 * that cannot leave a T-junction: every triangle splits, so neighbours always agree. Boundary edges
 * split too — and a geometric midpoint there would quietly polygonise the outline, turning a circle
 * into a coarse N-gon. So boundary midpoints are inserted by ARC PARAMETER and re-sampled from the
 * original dense loop, and the curve survives every split. See `markContours.ts`.
 *
 * ── Then a little smoothing ──────────────────────────────────────────────────────────────────────
 * Subdividing a sliver just gives four smaller slivers, and slivers make displacement noise read as
 * streaks rather than as rock. A couple of constrained Laplacian passes even the interior out. Points
 * are only allowed to move if they stay inside the mark, so a concave outline (every letter) can't
 * have its neighbours dragged out through the boundary.
 */

/** Laplacian passes over the interior. Two is enough to break up earcut's fans; more starts shrinking. */
const SMOOTHING_PASSES = 2;
const SMOOTHING_STRENGTH = 0.5;

/** Marks a point as belonging to no loop — i.e. an interior point, free to be smoothed. */
const NO_LOOP = -1;

export interface CapLoop {
  /** Point indices around the loop, in order. */
  indices: number[];
  /** Normalised arc parameter of each index, same length. */
  params: number[];
  loop: ClosedLoop;
  isHole: boolean;
  /** Index of the hole's centroid within the mark, used to anchor its collapsed tube at `p = 0`. */
  centroid: THREE.Vector2;
}

export interface CapMesh {
  points: THREE.Vector2[];
  /** Flat triples of indices into `points`. */
  triangles: number[];
  loops: CapLoop[];
  /** Per point: index into `loops`, or `NO_LOOP` for an interior point. */
  loopOfPoint: Int32Array;
  /** Every outer loop's points, for the polar map's boundary-distance table. */
  outerPoints: THREE.Vector2[];
}

export interface CapMeshOptions {
  /**
   * Target edge length, as a FRACTION of the mark's largest dimension.
   *
   * Relative rather than absolute because the cap is built before anything is normalised, and the
   * source outlines arrive at wildly different scales — the three logo viewBoxes are 95, 149 and 97
   * units while a typeface glyph comes in at 100. An absolute length would silently give one mark ten
   * times the tessellation of another. As a fraction it reads as "how fine across the mark", which is
   * also the question you are actually asking.
   */
  edgeFraction: number;
  /** Rounds of 1→4 subdivision. Each one quadruples the triangle count. */
  subdivisions: number;
}

function midpointKey(a: number, b: number): number {
  // Symmetric, and cheaper than a string key — cap meshes stay well under 2^21 points.
  return a < b ? a * 2097152 + b : b * 2097152 + a;
}

function loopCentroid(points: THREE.Vector2[]): THREE.Vector2 {
  const centroid = new THREE.Vector2();
  if (points.length === 0) return centroid;
  points.forEach((point) => centroid.add(point));
  return centroid.divideScalar(points.length);
}

/**
 * Triangulate the mark's face and refine it.
 *
 * Each shape is triangulated on its own — `ShapeUtils.triangulateShape` takes one outline plus the
 * holes punched in it — and the results are merged into one point list, so a multi-part mark ("i", or
 * a logo with separate elements) comes out as a single mesh.
 */
export function buildCapMesh(
  shapes: THREE.Shape[],
  flipY: boolean,
  options: CapMeshOptions,
): CapMesh {
  const subdivisions = Math.max(0, Math.floor(options.subdivisions));
  const subdivisionFactor = 2 ** subdivisions;

  const shapeLoops = extractShapeLoops(shapes, flipY);

  // Measure in the source's own units before anything is resampled, so the requested fraction means
  // the same thing whatever scale the outline arrived at.
  const sourceBounds = new THREE.Box2();
  shapeLoops.forEach((entry) =>
    entry.outer.source.forEach((point) => sourceBounds.expandByPoint(point)),
  );
  const sourceSize = new THREE.Vector2();
  sourceBounds.getSize(sourceSize);
  const largestSourceDimension = Math.max(sourceSize.x, sourceSize.y, 1e-6);

  // Resample coarse enough that the subdivisions land ON the requested edge length rather than far
  // under it — each round halves every edge.
  const baseEdgeLength =
    largestSourceDimension * options.edgeFraction * subdivisionFactor;

  const points: THREE.Vector2[] = [];
  const triangles: number[] = [];
  const loops: CapLoop[] = [];
  const loopIndexOfPoint: number[] = [];
  const outerPoints: THREE.Vector2[] = [];

  const registerLoop = (loop: ClosedLoop, isHole: boolean): number[] => {
    const count = loopPointCount(loop, baseEdgeLength, 1);
    const { points: loopPoints, params } = resampleLoop(loop, count);
    const indices = loopPoints.map((point) => {
      points.push(point);
      loopIndexOfPoint.push(loops.length);
      return points.length - 1;
    });
    loops.push({
      indices,
      params,
      loop,
      isHole,
      centroid: loopCentroid(loopPoints),
    });
    if (!isHole) outerPoints.push(...loopPoints);
    return indices;
  };

  shapeLoops.forEach((entry) => {
    const outerIndices = registerLoop(entry.outer, false);
    const holeIndices = entry.holes.map((hole) => registerLoop(hole, true));

    // `triangulateShape` indexes into `outer.concat(...holes)`, so build the same order to map back.
    const localIndices = [...outerIndices, ...holeIndices.flat()];
    // It also calls `removeDupEndPts`, which POPS from the arrays it is handed. The resample never
    // produces a duplicated end point, so this is a no-op — but pass copies rather than trust that.
    const outerPointList = outerIndices.map((index) => points[index]);
    const holePointLists = holeIndices.map((indices) =>
      indices.map((index) => points[index]),
    );

    const faces = THREE.ShapeUtils.triangulateShape(outerPointList, holePointLists);
    faces.forEach((face) => {
      // A face referencing a point that was popped would silently corrupt the mesh; drop it instead.
      if (face.some((index) => index < 0 || index >= localIndices.length)) return;

      const a = localIndices[face[0]];
      const b = localIndices[face[1]];
      const c = localIndices[face[2]];

      // Forced counter-clockwise rather than trusting earcut to preserve the input winding. The
      // caller builds the front cap from these indices as-is and the back cap reversed, so getting
      // this backwards renders the whole face inside-out — which, with backface culling on, looks
      // exactly like the mark failing to build at all. One cross product removes the guesswork.
      const first = points[a];
      const second = points[b];
      const third = points[c];
      const orientation =
        (second.x - first.x) * (third.y - first.y) -
        (third.x - first.x) * (second.y - first.y);
      if (orientation < 0) triangles.push(a, c, b);
      else triangles.push(a, b, c);
    });
  });

  for (let round = 0; round < subdivisions; round += 1) {
    subdivideOnce(points, triangles, loops, loopIndexOfPoint);
  }

  const loopOfPoint = Int32Array.from(loopIndexOfPoint);
  smoothInterior(points, triangles, loopOfPoint, loops);

  return { points, triangles, loops, loopOfPoint, outerPoints };
}

/**
 * One round of 1→4 subdivision.
 *
 * Loop midpoints are created FIRST and seeded into the cache, so when the triangles ask for the
 * midpoint of a boundary edge they get the point that sits on the real curve rather than a fresh
 * chord midpoint. Everything else falls out of the cache normally.
 */
function subdivideOnce(
  points: THREE.Vector2[],
  triangles: number[],
  loops: CapLoop[],
  loopIndexOfPoint: number[],
): void {
  const midpoints = new Map<number, number>();

  loops.forEach((capLoop, loopIndex) => {
    const { indices, params } = capLoop;
    const count = indices.length;
    if (count === 0) return;

    const nextIndices: number[] = [];
    const nextParams: number[] = [];

    for (let position = 0; position < count; position += 1) {
      const currentIndex = indices[position];
      const followingIndex = indices[(position + 1) % count];
      const currentParam = params[position];
      // The last pair wraps past 1; lift it so the average lands between them, not back at the start.
      const followingParam =
        position + 1 === count ? params[0] + 1 : params[position + 1];
      const midParam = (currentParam + followingParam) / 2;

      points.push(sampleLoop(capLoop.loop, midParam, new THREE.Vector2()));
      loopIndexOfPoint.push(loopIndex);
      const midIndex = points.length - 1;
      midpoints.set(midpointKey(currentIndex, followingIndex), midIndex);

      nextIndices.push(currentIndex, midIndex);
      nextParams.push(currentParam, midParam - Math.floor(midParam));
    }

    capLoop.indices = nextIndices;
    capLoop.params = nextParams;
  });

  const midpointBetween = (a: number, b: number): number => {
    const key = midpointKey(a, b);
    const existing = midpoints.get(key);
    if (existing !== undefined) return existing;
    points.push(points[a].clone().add(points[b]).multiplyScalar(0.5));
    loopIndexOfPoint.push(NO_LOOP);
    const created = points.length - 1;
    midpoints.set(key, created);
    return created;
  };

  const source = triangles.slice();
  triangles.length = 0;
  for (let index = 0; index < source.length; index += 3) {
    const a = source[index];
    const b = source[index + 1];
    const c = source[index + 2];
    const ab = midpointBetween(a, b);
    const bc = midpointBetween(b, c);
    const ca = midpointBetween(c, a);
    triangles.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
}

/** Even out the interior so displacement noise reads as rock rather than as streaks along slivers. */
function smoothInterior(
  points: THREE.Vector2[],
  triangles: number[],
  loopOfPoint: Int32Array,
  loops: CapLoop[],
): void {
  const neighbours: Set<number>[] = points.map(() => new Set<number>());
  for (let index = 0; index < triangles.length; index += 3) {
    const [a, b, c] = [triangles[index], triangles[index + 1], triangles[index + 2]];
    neighbours[a].add(b).add(c);
    neighbours[b].add(a).add(c);
    neighbours[c].add(a).add(b);
  }

  // Rebuilt from the final loops, so the inside test matches the boundary the mesh actually has.
  const shapePolygons = loops
    .filter((capLoop) => !capLoop.isHole)
    .map((outerLoop) => ({
      outer: outerLoop.indices.map((index) => points[index]),
      holes: loops
        .filter((capLoop) => capLoop.isHole)
        .map((holeLoop) => holeLoop.indices.map((index) => points[index])),
    }));

  const average = new THREE.Vector2();
  const candidate = new THREE.Vector2();
  for (let pass = 0; pass < SMOOTHING_PASSES; pass += 1) {
    for (let index = 0; index < points.length; index += 1) {
      if (loopOfPoint[index] !== NO_LOOP) continue;
      const adjacent = neighbours[index];
      if (adjacent.size === 0) continue;

      average.set(0, 0);
      adjacent.forEach((other) => average.add(points[other]));
      average.divideScalar(adjacent.size);

      candidate.copy(points[index]).lerp(average, SMOOTHING_STRENGTH);
      // A concave outline can pull a point straight through the boundary; leave it where it is.
      if (!isInsideMark(candidate, shapePolygons)) continue;
      points[index].copy(candidate);
    }
  }
}
