import * as THREE from 'three';
import { createMeteorGeometry } from './meteorBody';

/**
 * A mark built out of rock — the logo or glyph assembled from hundreds of carved space chunks rather
 * than extruded as one solid body.
 *
 * ── Why this and not a solid extrusion ───────────────────────────────────────────────────────────
 * A clean bevelled logo is a foreign object in this scene: everything else out there — the debris, the
 * body the camera orbits — is carved rock. `meteorBody.ts` argues the point for the rock itself ("the
 * thing you're orbiting should read as the biggest member of the same family as the chunks drifting
 * past it, not as an imported object that happens to share a scene with them"). The same argument
 * applies to a mark, and this is what satisfies it: the mark IS the debris, briefly agreeing to hold a
 * shape.
 *
 * ── How the shape survives being made of rubble ──────────────────────────────────────────────────
 * The obvious failure is illegibility — scatter rocks through a letter's area and you get gravel, not
 * a letter. Two things keep the read:
 *
 *   1. The BOUNDARY is sampled separately from the interior. Chunks are walked along the outline at a
 *      fixed spacing, so the silhouette is described by a deliberate chain of rocks rather than left
 *      to whatever the random fill happened to land near the edge.
 *   2. Edge chunks are SMALLER than interior ones. Big rocks on the outline chew holes in the
 *      silhouette; small ones trace it. Size is therefore a function of where a chunk sits, not a
 *      single random range.
 *
 *          ····▓▓▓▓▓▓▓▓····        ▓ small edge chunks — carry the silhouette
 *          ··▓▓░░░░░░░░▓▓··        ░ large interior chunks — carry the mass
 *          ··▓▓░░░░░░░░▓▓··
 *          ····▓▓▓▓▓▓▓▓····
 *
 * ── Why it's instanced, and why there are several variants ───────────────────────────────────────
 * A mark runs to well over a thousand chunks. One draw call per chunk would be absurd, so they're
 * `InstancedMesh`es — but an instanced mesh shares ONE geometry, and a mark where every rock is the
 * same rock reads as a pattern immediately. So a handful of distinct chunks are carved and the
 * placements are dealt across them. A few variants is all it takes: each instance also gets its own
 * random rotation and scale, so the repeats don't line up.
 *
 * ── The morph this makes possible ────────────────────────────────────────────────────────────────
 * Worth knowing before anyone reaches for a hard swap: two aggregates can share an instance count. If
 * they do, chunk *i* of one mark has a counterpart in the next, and the whole assembly can fly apart
 * and re-gather into the new shape. That is a real, topology-independent morph — the thing extruded
 * marks could never have. See docs/works-marks-plan.md.
 */

// How finely a contour is sampled before it's walked. Too low and a curve's chunk chain visibly
// polygonises; this is points-per-contour, so it's generous.
const CONTOUR_DIVISIONS = 200;

// Rejection sampling gives up after this many misses per wanted chunk, so a pathological shape (a
// hairline outline with almost no interior) can't spin forever.
const MAX_SAMPLE_ATTEMPTS_PER_CHUNK = 40;

/** Distinct carved chunks the instances are dealt across. */
const CHUNK_VARIANT_COUNT = 5;
const CHUNK_VARIANT_DETAIL = 1;
const CHUNK_VARIANT_SEED_STEP = 137.5;
/** Per-axis squash range for a base chunk, so no variant is a sphere. */
const CHUNK_STRETCH_MIN = 0.68;
const CHUNK_STRETCH_MAX = 1.42;

/**
 * One surface a chunk can be made of, and how much of the mark uses it.
 *
 * Weighted rather than fixed because the mix is the whole point: the field's debris is dull cold stone
 * and only the body at the centre burns, so a mark built entirely from either one reads wrong. Mostly
 * stone with a scattering of molten chunks gives you rubble with embers still alive in it — and the
 * few that glow catch the field's bloom pass, so they carry far more than their share of the image.
 */
export interface MarkChunkMaterial {
  material: THREE.Material;
  /** Relative share of chunks. Normalised across all entries, so 90/10 and 9/1 mean the same thing. */
  weight: number;
}

export interface MarkAggregateOptions {
  /** Largest dimension of the finished mark, in world units. Matches the solid marks' `targetSize`. */
  targetSize: number;
  /** How thick the slab of rock is, in world units. Chunks are scattered through this depth. */
  depth: number;
  /** Spacing between chunks along the outline, in world units. Smaller = crisper silhouette. */
  edgeSpacing: number;
  /** World-unit radius of an outline chunk, before the per-instance jitter. */
  edgeChunkScale: number;
  /** …and of an interior one. Larger, so the mass reads solid without blurring the edge. */
  interiorChunkScale: number;
  /** How many interior chunks to scatter. The outline count falls out of `edgeSpacing`. */
  interiorChunkCount: number;
  /** Per-instance random size variation, as a fraction of the chunk's base scale. */
  scaleJitter: number;
  /** SVG marks need their Y negated; typeface glyphs are already Y-up. */
  flipY: boolean;
  /** Deterministic layout — the same seed always builds the same mark. */
  seed: number;
}

export interface MarkAggregate {
  /** Add this to the scene. Its children are the per-variant instanced meshes. */
  group: THREE.Group;
  /** Every chunk's resting position, in group space — the raw material for a fly-apart morph. */
  placements: THREE.Vector3[];
  dispose: () => void;
}

/** A small deterministic PRNG, so a mark's layout is reproducible from its seed. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state += 1;
    const raw = Math.sin(state * 12.9898) * 43758.5453;
    return raw - Math.floor(raw);
  };
}

/** Ray-casting point-in-polygon. The contour is a closed loop of 2D points. */
function isInsideContour(point: THREE.Vector2, contour: THREE.Vector2[]): boolean {
  let inside = false;
  for (
    let current = 0, previous = contour.length - 1;
    current < contour.length;
    previous = current, current += 1
  ) {
    const a = contour[current];
    const b = contour[previous];
    const straddlesRay = a.y > point.y !== b.y > point.y;
    if (!straddlesRay) continue;
    const crossingX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

interface ContourSet {
  outer: THREE.Vector2[];
  holes: THREE.Vector2[][];
}

function isInsideShape(point: THREE.Vector2, contours: ContourSet): boolean {
  if (!isInsideContour(point, contours.outer)) return false;
  return !contours.holes.some((hole) => isInsideContour(point, hole));
}

/**
 * Walk a closed contour placing a point every `spacing` units of arc length.
 *
 * Stepping by arc length rather than by vertex index is what keeps the chunk chain even: a contour's
 * points cluster tightly around curves and spread out along straights, so stepping per-vertex would
 * pile rocks up on every corner and leave the flat runs bare.
 */
function walkContour(
  contour: THREE.Vector2[],
  spacing: number,
  onPoint: (point: THREE.Vector2) => void,
): void {
  if (contour.length < 2 || spacing <= 0) return;
  let distanceSinceLastPoint = spacing; // place one immediately at the start
  for (let index = 0; index < contour.length; index += 1) {
    const from = contour[index];
    const to = contour[(index + 1) % contour.length];
    const segmentLength = from.distanceTo(to);
    if (segmentLength === 0) continue;

    let travelled = 0;
    while (distanceSinceLastPoint + (segmentLength - travelled) >= spacing) {
      travelled += spacing - distanceSinceLastPoint;
      distanceSinceLastPoint = 0;
      onPoint(from.clone().lerp(to, travelled / segmentLength));
    }
    distanceSinceLastPoint += segmentLength - travelled;
  }
}

/**
 * Build the rock assembly for a set of 2D shapes.
 *
 * Takes `THREE.Shape[]` so both sources work unchanged: `SVGLoader.createShapes()` for the logos and
 * `font.generateShapes()` for the glyphs. Everything downstream is identical.
 */
export function createMarkAggregate(
  shapes: THREE.Shape[],
  chunkMaterials: MarkChunkMaterial[],
  options: MarkAggregateOptions,
): MarkAggregate {
  const random = createRandom(options.seed);

  // Weighted pick, drawn from the same seeded stream as everything else so a mark's ember scatter is
  // as reproducible as its layout.
  const totalWeight = chunkMaterials.reduce((sum, entry) => sum + entry.weight, 0);
  const pickMaterialIndex = (): number => {
    if (totalWeight <= 0) return 0;
    let ticket = random() * totalWeight;
    for (let index = 0; index < chunkMaterials.length; index += 1) {
      ticket -= chunkMaterials[index].weight;
      if (ticket <= 0) return index;
    }
    return chunkMaterials.length - 1;
  };

  // 1. Resolve every shape to plain point loops, flipping Y here (once) rather than per sample.
  const contourSets: ContourSet[] = shapes.map((shape) => {
    const toPoints = (path: { getPoints: (divisions?: number) => THREE.Vector2[] }) =>
      path.getPoints(CONTOUR_DIVISIONS).map((point) =>
        new THREE.Vector2(point.x, options.flipY ? -point.y : point.y),
      );
    return {
      outer: toPoints(shape),
      holes: shape.holes.map(toPoints),
    };
  });

  // 2. Source-space bounds, so the whole mark can be normalised to `targetSize` and centred — the same
  //    contract the solid marks honour, and what keeps the camera path framing every mark identically.
  const bounds = new THREE.Box2();
  contourSets.forEach((set) => set.outer.forEach((point) => bounds.expandByPoint(point)));
  const size = new THREE.Vector2();
  bounds.getSize(size);
  const largestDimension = Math.max(size.x, size.y);
  const normaliseScale = largestDimension > 0 ? options.targetSize / largestDimension : 1;
  const center = new THREE.Vector2();
  bounds.getCenter(center);

  const toWorld = (point: THREE.Vector2) =>
    new THREE.Vector2(
      (point.x - center.x) * normaliseScale,
      (point.y - center.y) * normaliseScale,
    );

  // Spacing is given in world units but the walk happens in source space, so convert it back.
  const sourceEdgeSpacing = options.edgeSpacing / normaliseScale;

  interface Placement {
    position: THREE.Vector3;
    scale: number;
    /** Which entry of `chunkMaterials` this chunk is made of. */
    materialIndex: number;
  }
  const placements: Placement[] = [];
  const randomDepth = () => (random() - 0.5) * options.depth;
  const jitteredScale = (base: number) =>
    base * (1 + (random() - 0.5) * 2 * options.scaleJitter);

  // 3. The outline — small chunks, evenly spaced, tracing every contour including hole edges. Holes
  //    get the same treatment as the outer loop: the inside of the compass's ring is as much a part of
  //    its silhouette as the outside.
  contourSets.forEach((set) => {
    [set.outer, ...set.holes].forEach((contour) => {
      walkContour(contour, sourceEdgeSpacing, (point) => {
        const world = toWorld(point);
        placements.push({
          position: new THREE.Vector3(world.x, world.y, randomDepth()),
          scale: jitteredScale(options.edgeChunkScale),
          materialIndex: pickMaterialIndex(),
        });
      });
    });
  });

  // 4. The mass — larger chunks rejection-sampled across the interior.
  let accepted = 0;
  let attempts = 0;
  const maxAttempts = options.interiorChunkCount * MAX_SAMPLE_ATTEMPTS_PER_CHUNK;
  const candidate = new THREE.Vector2();
  while (accepted < options.interiorChunkCount && attempts < maxAttempts) {
    attempts += 1;
    candidate.set(
      THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, random()),
      THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, random()),
    );
    if (!contourSets.some((set) => isInsideShape(candidate, set))) continue;
    accepted += 1;
    const world = toWorld(candidate);
    placements.push({
      position: new THREE.Vector3(world.x, world.y, randomDepth()),
      scale: jitteredScale(options.interiorChunkScale),
      materialIndex: pickMaterialIndex(),
    });
  }

  // 5. Carve the base chunks and deal the placements across them.
  const variantGeometries: THREE.BufferGeometry[] = [];
  for (let variant = 0; variant < CHUNK_VARIANT_COUNT; variant += 1) {
    const variantSeed = options.seed + variant * CHUNK_VARIANT_SEED_STEP;
    const stretchRandom = createRandom(Math.floor(variantSeed));
    variantGeometries.push(
      createMeteorGeometry({
        radius: 1,
        detail: CHUNK_VARIANT_DETAIL,
        seed: variantSeed,
        stretchX: THREE.MathUtils.lerp(CHUNK_STRETCH_MIN, CHUNK_STRETCH_MAX, stretchRandom()),
        stretchY: THREE.MathUtils.lerp(CHUNK_STRETCH_MIN, CHUNK_STRETCH_MAX, stretchRandom()),
        stretchZ: THREE.MathUtils.lerp(CHUNK_STRETCH_MIN, CHUNK_STRETCH_MAX, stretchRandom()),
      }),
    );
  }

  // An InstancedMesh is one geometry AND one material, so the chunks are bucketed by both: a mesh per
  // (variant × material) pair that actually has chunks in it. Five variants and two surfaces is at most
  // ten draw calls for the entire mark — still nothing, and it buys both silhouette variety and the
  // stone/ember mix.
  const buckets: Placement[][][] = variantGeometries.map(() =>
    chunkMaterials.map((): Placement[] => []),
  );
  placements.forEach((placement, index) => {
    buckets[index % CHUNK_VARIANT_COUNT][placement.materialIndex].push(placement);
  });

  const group = new THREE.Group();
  const instancedMeshes: THREE.InstancedMesh[] = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scaleVector = new THREE.Vector3();

  buckets.forEach((materialBuckets, variantIndex) => {
    materialBuckets.forEach((bucketPlacements, materialIndex) => {
      if (bucketPlacements.length === 0) return;
      const instanced = new THREE.InstancedMesh(
        variantGeometries[variantIndex],
        chunkMaterials[materialIndex].material,
        bucketPlacements.length,
      );
      instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      bucketPlacements.forEach((placement, instanceIndex) => {
        euler.set(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2);
        quaternion.setFromEuler(euler);
        scaleVector.setScalar(placement.scale);
        matrix.compose(placement.position, quaternion, scaleVector);
        instanced.setMatrixAt(instanceIndex, matrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      group.add(instanced);
      instancedMeshes.push(instanced);
    });
  });

  return {
    group,
    placements: placements.map((placement) => placement.position.clone()),
    dispose: () => {
      instancedMeshes.forEach((instanced) => {
        instanced.dispose();
        group.remove(instanced);
      });
      // The materials are the caller's — they're shared across marks and outlive any one of them.
      variantGeometries.forEach((geometry) => geometry.dispose());
    },
  };
}
