import * as THREE from 'three';
import { createMeteorGeometry } from './meteorBody';

/**
 * The swarm — one persistent cloud of rock that holds whatever shape it's asked to.
 *
 * ── Why this replaced the per-mark aggregate ─────────────────────────────────────────────────────
 * The first version built a fresh set of chunks for every mark and threw them away on a change. That
 * made two things impossible, and both of them turned out to be the point:
 *
 *   1. **Chunks can't arrive from nowhere.** They exist before the mark does — drifting in the dark
 *      at full size — and the formation is them TRAVELLING to their places, not fading into being.
 *      A rebuilt set has nothing to travel from.
 *   2. **A mark change has to be the same rocks moving.** Chunk 37 of the compass is chunk 37 of the
 *      V; it flies from one place to the other. That only works if the pool outlives the shape.
 *
 * So the pool is fixed and permanent, and a "mark" is just a set of target positions handed to it.
 *
 * ── Why the pool is split in two ─────────────────────────────────────────────────────────────────
 * Outline chunks are small (they trace the silhouette) and interior chunks are large (they carry the
 * mass). If a chunk could be an outline rock in one mark and an interior rock in the next, its SIZE
 * would have to change mid-flight — which reads as the rock growing, not moving. Two fixed sub-pools
 * means every chunk keeps its size, its texture and its identity for the life of the page.
 *
 * That's also why the counts are counts and not a spacing: the outline is sampled at exactly
 * `edgeChunkCount` points spread evenly along its arc length, whatever shape it is. Density varies a
 * little between marks; identity is preserved. That trade is the whole feature.
 *
 * ── The three blends, and why they're separate ───────────────────────────────────────────────────
 * A chunk's position is resolved from three independent things every frame:
 *
 *     free (drifting)  ──formation──▶  target      "is the mark assembled?"
 *     previousTarget   ──shapeBlend──▶ currentTarget   "which mark is it?"
 *     …plus a per-chunk delay on both, so it coalesces rather than snapping.
 *
 * They're separate because they're driven by different things: formation belongs to the section's
 * arrival, shapeBlend to a project change. Collapsing them would mean a project change had to scatter
 * the mark back to the void and re-gather it, which is not what a mark change should look like — the
 * rocks should just go to their new places.
 */

const CONTOUR_DIVISIONS = 200;
const MAX_SAMPLE_ATTEMPTS_PER_CHUNK = 40;

/** Distinct carved chunks the instances are dealt across, so the pool never reads as one repeated rock. */
const CHUNK_VARIANT_COUNT = 5;
const CHUNK_VARIANT_DETAIL = 1;
const CHUNK_VARIANT_SEED_STEP = 137.5;
const CHUNK_STRETCH_MIN = 0.68;
const CHUNK_STRETCH_MAX = 1.42;

export interface MarkChunkMaterial {
  material: THREE.Material;
  /** Share of the OUTLINE pool. Normalised against the other entries' edge weights. */
  edgeWeight: number;
  /** Share of the INTERIOR pool, normalised separately — the two zones do different jobs. */
  interiorWeight: number;
}

export interface MarkSwarmOptions {
  /** Largest dimension a held shape is normalised to, in world units. */
  targetSize: number;
  /** Thickness of the slab the chunks are scattered through when holding a shape. */
  depth: number;

  /** Fixed pool sizes. These are what make chunk identity survive a mark change. */
  edgeChunkCount: number;
  interiorChunkCount: number;
  edgeChunkScale: number;
  interiorChunkScale: number;
  /** Per-chunk random size variation, as a fraction of the pool's base scale. */
  scaleJitter: number;

  // ── The free state: where chunks live before (and between) marks ──
  /** Half-extent of the cloud chunks drift in when no shape is held. */
  freeRadius: number;
  /** How far a drifting chunk wanders from its spot, in world units. */
  freeDriftAmplitude: number;
  freeDriftSpeed: number;
  /** Radians/sec a free chunk tumbles. Eases to zero as it locks into a shape. */
  tumbleSpeed: number;

  // ── Timing ──
  /**
   * Share of chunks already in place when the FIRST formation starts, and which never fly for it. A
   * mark that assembles from absolutely nothing reads as a spawn; a sparse partial body reads as
   * completion.
   *
   * Applies to the formation only. Once the swarm is holding a shape every rock is "already there", so
   * a shape change flies all of them — see `staggered`.
   */
  baseFraction: number;
  /** Fraction of the timeline spent staggering chunk starts. */
  formationStagger: number;
  /** Extra delay on OUTLINE chunks, so the mass gathers first and the silhouette resolves last. */
  formationEdgeDelay: number;

  seed: number;
}

export interface MarkSwarm {
  group: THREE.Group;
  /**
   * Hand the swarm a new shape. Existing targets become the "previous" ones, so driving `setShapeBlend`
   * from 0 to 1 flies every chunk from where it was to where it now belongs.
   */
  setShape: (shapes: THREE.Shape[], flipY: boolean) => void;
  /** 0 = drifting free, 1 = holding the shape. */
  setFormation: (progress: number) => void;
  /** 0 = the previous shape, 1 = the current one. Drive after `setShape`. */
  setShapeBlend: (progress: number) => void;
  /** Advance the idle drift and write the frame's matrices. Call once per frame. */
  update: (elapsedSeconds: number) => void;
  dispose: () => void;
}

function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state += 1;
    const raw = Math.sin(state * 12.9898) * 43758.5453;
    return raw - Math.floor(raw);
  };
}

function isInsideContour(point: THREE.Vector2, contour: THREE.Vector2[]): boolean {
  let inside = false;
  for (
    let current = 0, previous = contour.length - 1;
    current < contour.length;
    previous = current, current += 1
  ) {
    const a = contour[current];
    const b = contour[previous];
    if (a.y > point.y === b.y > point.y) continue;
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
 * Place exactly `count` points evenly along the combined arc length of every contour.
 *
 * By arc length rather than by vertex, because a contour's points cluster around curves and spread out
 * along straights — stepping per-vertex piles rocks onto every corner and leaves the flat runs bare.
 * Across ALL contours at once so holes get their fair share: the inside of the compass's ring is as
 * much a part of its silhouette as the outside.
 */
function sampleContoursEvenly(
  contours: THREE.Vector2[][],
  count: number,
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  if (count <= 0) return points;

  interface Segment {
    from: THREE.Vector2;
    to: THREE.Vector2;
    length: number;
    startDistance: number;
  }
  const segments: Segment[] = [];
  let totalLength = 0;
  contours.forEach((contour) => {
    for (let index = 0; index < contour.length; index += 1) {
      const from = contour[index];
      const to = contour[(index + 1) % contour.length];
      const length = from.distanceTo(to);
      if (length <= 0) continue;
      segments.push({ from, to, length, startDistance: totalLength });
      totalLength += length;
    }
  });

  if (segments.length === 0 || totalLength <= 0) return points;

  const step = totalLength / count;
  let segmentIndex = 0;
  for (let pointIndex = 0; pointIndex < count; pointIndex += 1) {
    const distance = pointIndex * step;
    while (
      segmentIndex < segments.length - 1 &&
      segments[segmentIndex].startDistance + segments[segmentIndex].length < distance
    ) {
      segmentIndex += 1;
    }
    const segment = segments[segmentIndex];
    const along = (distance - segment.startDistance) / segment.length;
    points.push(segment.from.clone().lerp(segment.to, THREE.MathUtils.clamp(along, 0, 1)));
  }
  return points;
}

/** Everything one chunk needs, for the life of the page. */
interface ChunkRecord {
  /** Where it drifts when it isn't holding a shape. */
  freeAnchor: THREE.Vector3;
  /** Per-chunk phase offsets, so the cloud doesn't pulse in unison. */
  driftPhase: THREE.Vector3;
  tumbleAxis: THREE.Vector3;
  tumbleOffset: number;
  /** Orientation it settles into once placed. */
  restQuaternion: THREE.Quaternion;
  scale: number;
  /** Where on the 0..1 timelines this chunk starts moving. */
  delay: number;
  isBase: boolean;
  isEdge: boolean;
  /** Slot in its own pool — the index into the sampled points for a shape. */
  poolIndex: number;
  previousTarget: THREE.Vector3;
  currentTarget: THREE.Vector3;
}

export function createMarkSwarm(
  chunkMaterials: MarkChunkMaterial[],
  options: MarkSwarmOptions,
): MarkSwarm {
  const random = createRandom(options.seed);

  const zoneWeights = {
    edge: chunkMaterials.map((entry) => entry.edgeWeight),
    interior: chunkMaterials.map((entry) => entry.interiorWeight),
  };
  const zoneTotals = {
    edge: zoneWeights.edge.reduce((sum, weight) => sum + weight, 0),
    interior: zoneWeights.interior.reduce((sum, weight) => sum + weight, 0),
  };
  const pickMaterialIndex = (zone: 'edge' | 'interior'): number => {
    const total = zoneTotals[zone];
    if (total <= 0) return 0;
    const weights = zoneWeights[zone];
    let ticket = random() * total;
    for (let index = 0; index < weights.length; index += 1) {
      ticket -= weights[index];
      if (ticket <= 0) return index;
    }
    return weights.length - 1;
  };

  // ── Build the pool ──
  const records: ChunkRecord[] = [];
  const makeRecords = (count: number, isEdge: boolean) => {
    for (let poolIndex = 0; poolIndex < count; poolIndex += 1) {
      const baseScale = isEdge ? options.edgeChunkScale : options.interiorChunkScale;
      const scale = baseScale * (1 + (random() - 0.5) * 2 * options.scaleJitter);

      const euler = new THREE.Euler(
        random() * Math.PI * 2,
        random() * Math.PI * 2,
        random() * Math.PI * 2,
      );
      const zoneDelay = isEdge ? options.formationEdgeDelay : 0;
      const delay = Math.min(
        0.999,
        zoneDelay + random() * options.formationStagger * (1 - zoneDelay),
      );

      const freeAnchor = new THREE.Vector3(
        (random() * 2 - 1) * options.freeRadius,
        (random() * 2 - 1) * options.freeRadius,
        (random() * 2 - 1) * options.freeRadius,
      );

      records.push({
        freeAnchor,
        driftPhase: new THREE.Vector3(
          random() * Math.PI * 2,
          random() * Math.PI * 2,
          random() * Math.PI * 2,
        ),
        tumbleAxis: new THREE.Vector3(
          random() * 2 - 1,
          random() * 2 - 1,
          random() * 2 - 1,
        ).normalize(),
        tumbleOffset: random() * Math.PI * 2,
        restQuaternion: new THREE.Quaternion().setFromEuler(euler),
        scale,
        delay,
        isBase: random() < options.baseFraction,
        isEdge,
        poolIndex,
        // Until a shape is set they belong nowhere; the free state covers this.
        previousTarget: freeAnchor.clone(),
        currentTarget: freeAnchor.clone(),
      });
    }
  };
  makeRecords(options.edgeChunkCount, true);
  makeRecords(options.interiorChunkCount, false);

  // ── Carve the variants and bucket by (variant × material) ──
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

  const group = new THREE.Group();
  const instancedMeshes: THREE.InstancedMesh[] = [];
  const meshRecords: ChunkRecord[][] = [];

  const buckets: ChunkRecord[][][] = variantGeometries.map(() =>
    chunkMaterials.map((): ChunkRecord[] => []),
  );
  records.forEach((record, index) => {
    const materialIndex = pickMaterialIndex(record.isEdge ? 'edge' : 'interior');
    buckets[index % CHUNK_VARIANT_COUNT][materialIndex].push(record);
  });

  buckets.forEach((materialBuckets, variantIndex) => {
    materialBuckets.forEach((bucketRecords, materialIndex) => {
      if (bucketRecords.length === 0) return;
      const instanced = new THREE.InstancedMesh(
        variantGeometries[variantIndex],
        chunkMaterials[materialIndex].material,
        bucketRecords.length,
      );
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // The swarm always fills the free cloud, and chunks fly well outside any shape's bounds — a
      // bounding sphere fitted to the resting mark would cull them mid-flight.
      instanced.frustumCulled = false;
      group.add(instanced);
      instancedMeshes.push(instanced);
      meshRecords.push(bucketRecords);
    });
  });

  // ── Shape assignment ──
  const edgeRecords = records.filter((record) => record.isEdge);
  const interiorRecords = records.filter((record) => !record.isEdge);

  const setShape = (shapes: THREE.Shape[], flipY: boolean) => {
    const contourSets: ContourSet[] = shapes.map((shape) => {
      const toPoints = (path: { getPoints: (divisions?: number) => THREE.Vector2[] }) =>
        path
          .getPoints(CONTOUR_DIVISIONS)
          .map((point) => new THREE.Vector2(point.x, flipY ? -point.y : point.y));
      return { outer: toPoints(shape), holes: shape.holes.map(toPoints) };
    });

    const bounds = new THREE.Box2();
    contourSets.forEach((set) => set.outer.forEach((point) => bounds.expandByPoint(point)));
    const size = new THREE.Vector2();
    bounds.getSize(size);
    const largestDimension = Math.max(size.x, size.y);
    const normaliseScale = largestDimension > 0 ? options.targetSize / largestDimension : 1;
    const center = new THREE.Vector2();
    bounds.getCenter(center);

    // A shape-local random stream, so the same mark always lays out identically no matter what order
    // the marks were shown in — otherwise the swarm's shared stream would make it path-dependent.
    const shapeRandom = createRandom(options.seed + shapes.length * 7919);
    const toWorld = (point: THREE.Vector2, target: THREE.Vector3) =>
      target.set(
        (point.x - center.x) * normaliseScale,
        (point.y - center.y) * normaliseScale,
        (shapeRandom() - 0.5) * options.depth,
      );

    const allContours = contourSets.flatMap((set) => [set.outer, ...set.holes]);
    const edgePoints = sampleContoursEvenly(allContours, edgeRecords.length);

    edgeRecords.forEach((record) => {
      record.previousTarget.copy(record.currentTarget);
      const point = edgePoints[record.poolIndex % Math.max(1, edgePoints.length)];
      if (point) toWorld(point, record.currentTarget);
    });

    // Interior: rejection-sample exactly as many points as the interior pool has chunks.
    const candidate = new THREE.Vector2();
    const maxAttempts = interiorRecords.length * MAX_SAMPLE_ATTEMPTS_PER_CHUNK;
    let attempts = 0;
    let filled = 0;
    while (filled < interiorRecords.length && attempts < maxAttempts) {
      attempts += 1;
      candidate.set(
        THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, shapeRandom()),
        THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, shapeRandom()),
      );
      if (!contourSets.some((set) => isInsideShape(candidate, set))) continue;
      const record = interiorRecords[filled];
      record.previousTarget.copy(record.currentTarget);
      toWorld(candidate, record.currentTarget);
      filled += 1;
    }
    // A pathologically thin shape may not yield enough interior points. Park the remainder on the
    // outline rather than leaving them at a stale target from the previous mark.
    for (let index = filled; index < interiorRecords.length; index += 1) {
      const record = interiorRecords[index];
      record.previousTarget.copy(record.currentTarget);
      const point = edgePoints[index % Math.max(1, edgePoints.length)];
      if (point) toWorld(point, record.currentTarget);
    }
  };

  // ── Per-frame resolve ──
  let formation = 1;
  let shapeBlend = 1;

  const framePosition = new THREE.Vector3();
  const frameTarget = new THREE.Vector3();
  const frameFree = new THREE.Vector3();
  const frameQuaternion = new THREE.Quaternion();
  const tumbleQuaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const scaleVector = new THREE.Vector3();

  const settle = (value: number) => 1 - (1 - value) ** 3;

  /**
   * A chunk's eased progress along one of the blends, offset by its own delay.
   *
   * `honourBase` is what separates the two blends, and it matters more than it looks:
   *
   *   **Formation** honours it. The base is the handful of rocks already sitting in the shape before
   *   anything flies, so the mark starts as a sparse suggestion rather than empty space.
   *
   *   **A shape change does NOT.** By then every rock is already placed — "already there" describes
   *   all of them — so a base is meaningless. Worse, honouring it would pin those chunks at 1 and
   *   teleport them to their new spots while everything else flew, which reads as a glitch.
   */
  const staggered = (progress: number, record: ChunkRecord, honourBase: boolean) => {
    if (honourBase && record.isBase) return 1;
    const span = 1 - record.delay;
    const local = span > 0 ? (progress - record.delay) / span : 1;
    return settle(THREE.MathUtils.clamp(local, 0, 1));
  };

  const update = (elapsedSeconds: number) => {
    instancedMeshes.forEach((instanced, meshIndex) => {
      const bucketRecords = meshRecords[meshIndex];
      bucketRecords.forEach((record, instanceIndex) => {
        const placed = staggered(formation, record, true);
        const blended = staggered(shapeBlend, record, false);

        // Where it belongs right now — between the mark it was holding and the one it's taking up.
        frameTarget.lerpVectors(record.previousTarget, record.currentTarget, blended);

        // Where it drifts when it belongs nowhere. Never static: a still cloud reads as a held frame.
        frameFree.set(
          record.freeAnchor.x +
            Math.sin(elapsedSeconds * options.freeDriftSpeed + record.driftPhase.x) *
              options.freeDriftAmplitude,
          record.freeAnchor.y +
            Math.sin(elapsedSeconds * options.freeDriftSpeed * 0.8 + record.driftPhase.y) *
              options.freeDriftAmplitude,
          record.freeAnchor.z +
            Math.sin(elapsedSeconds * options.freeDriftSpeed * 1.2 + record.driftPhase.z) *
              options.freeDriftAmplitude,
        );

        framePosition.lerpVectors(frameFree, frameTarget, placed);

        // Tumbling while free, settling to its resting pose as it locks in.
        tumbleQuaternion.setFromAxisAngle(
          record.tumbleAxis,
          record.tumbleOffset + elapsedSeconds * options.tumbleSpeed,
        );
        frameQuaternion.slerpQuaternions(tumbleQuaternion, record.restQuaternion, placed);

        scaleVector.setScalar(record.scale);
        matrix.compose(framePosition, frameQuaternion, scaleVector);
        instanced.setMatrixAt(instanceIndex, matrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
    });
  };

  return {
    group,
    setShape,
    setFormation: (progress) => {
      formation = THREE.MathUtils.clamp(progress, 0, 1);
    },
    setShapeBlend: (progress) => {
      shapeBlend = THREE.MathUtils.clamp(progress, 0, 1);
    },
    update,
    dispose: () => {
      instancedMeshes.forEach((instanced) => {
        instanced.dispose();
        group.remove(instanced);
      });
      variantGeometries.forEach((geometry) => geometry.dispose());
    },
  };
}
