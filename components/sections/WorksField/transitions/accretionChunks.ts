import * as THREE from 'three';
import { buildCapMesh } from '../markCapMesh';
import { layeredLobeNoise, rockSkinPoint, type RockField } from '../markRockField';

/**
 * The mark, cut into stones.
 *
 * ── A stone is a PIECE of the mark, never a pebble inside it ──────────────────────────────────────
 * The first attempt packed carved spheres into the mark's area and it read as gravel with a scalloped
 * outline (`docs/accretion-plan.md` §1). This partitions the mark's own solid instead, so the union of
 * the stones IS the mark: the silhouette is exact by construction, holes are exact, the pieces
 * interlock because they were cut from one stone, and every piece is angular because its outline
 * follows the partition rather than a sphere.
 *
 * It is also what makes the growth animatable. A fragment has a correct final ORIENTATION, so it can
 * travel and rotate into alignment and you can watch it lock in. A sphere has no orientation to align,
 * which is exactly why the first attempt had nothing to animate but scale.
 *
 *      PACKING (rejected)            PARTITIONING (this)
 *      ●●●●●●●●●●●                  ┌──┬───┬──┬────┐
 *      ●○  ○  ○  ○●                 ├──┴─┬─┴──┼──┬─┤
 *      ●●●●●●●●●●●                  └────┴────┴──┴─┘
 *      scalloped, gravel            exact edge, interlocking
 *
 * ── Two layers of vertices, and that is the whole trick for watertightness ───────────────────────
 * Every vertex sits at `z = ±halfDepth` — caps at both ends, one quad per boundary edge for the wall.
 * That means the surface displacement can be a function of POSITION ALONE, never of a normal, so two
 * abutting stones displace their shared corner identically and no crack can ever open. A
 * normal-based displacement would separate them, because two neighbours' wall normals are opposed.
 */

/** Angular slack when deciding whether a vertex belongs to a cap or a wall. */
const CAP_NORMAL_THRESHOLD = 0.5;

/** A cluster this small is a sliver; it gets folded into a neighbour instead of becoming a stone. */
const MIN_CLUSTER_TRIANGLES = 2;

/** Seed offsets, so the three displacement fields are independent rather than correlated. */
const IN_PLANE_SEED_X = 11.3;
const IN_PLANE_SEED_Y = 23.7;

export interface AccretionChunkOptions {
  targetSize: number;
  depth: number;

  /** Tessellation of the mark's face. See `markCapMesh` — edge length is a fraction of the mark. */
  capEdgeFraction: number;
  capSubdivisions: number;

  /**
   * Stone size near the outline and deep in the body, in world units.
   *
   * The split is the size hierarchy, and it does two jobs: fine stones on the rim so the outline is
   * precise and the eye reads detail where it looks, big masses in the core so the body reads as a few
   * large stones rather than as noise. One uniform size is what made the first attempt read as gravel.
   */
  rimSpacing: number;
  coreSpacing: number;
  /** How far in from the outline the rim size gives way to the core size. */
  spacingFalloff: number;

  /** Stones interpenetrate by this much, so floating-point error cannot open a hairline crack. */
  chunkInflate: number;

  /** Roughness of the front and back faces — displacement along Z. */
  capAmplitude: number;
  capFrequency: number;
  /**
   * Roughness of the outline itself — displacement across the mark's plane.
   *
   * This is what makes the silhouette hewn rather than typeset, and it is also the knob that eats a
   * counter if pushed. `silhouetteProtection` damps it toward the rim.
   */
  inPlaneAmplitude: number;
  /** 1 leaves the outline untouched; 0 roughens it as hard as the faces. */
  silhouetteProtection: number;

  /** The persistent core every stone grows out of. Its skin is where each one is seeded. */
  baseRock: RockField;

  seed: number;
}

export interface AccretionChunks {
  /** One merged, indexed geometry holding every stone of one mark, with the growth attributes baked. */
  geometry: THREE.BufferGeometry;
  chunkCount: number;
  triangleCount: number;
  /** Outline sites the crystal layer grows from — see `accretionCrystals`. */
  rimPoints: THREE.Vector2[];
  rimNormals: THREE.Vector2[];
}

/** mulberry32 — deterministic, so a mark always cuts into the same stones. */
function createRandom(seed: number): () => number {
  let state = (Math.imul(Math.floor(seed) ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function edgeKey(first: number, second: number): number {
  return first < second ? first * 2097152 + second : second * 2097152 + first;
}

function distanceToSegment(
  point: THREE.Vector2,
  from: THREE.Vector2,
  to: THREE.Vector2,
): number {
  const edgeX = to.x - from.x;
  const edgeY = to.y - from.y;
  const lengthSquared = edgeX * edgeX + edgeY * edgeY;
  if (lengthSquared < 1e-12) return point.distanceTo(from);
  let along = ((point.x - from.x) * edgeX + (point.y - from.y) * edgeY) / lengthSquared;
  along = along < 0 ? 0 : along > 1 ? 1 : along;
  return Math.hypot(point.x - (from.x + edgeX * along), point.y - (from.y + edgeY * along));
}

export function buildAccretionChunks(
  shapes: THREE.Shape[],
  flipY: boolean,
  options: AccretionChunkOptions,
): AccretionChunks {
  const capMesh = buildCapMesh(shapes, flipY, {
    edgeFraction: options.capEdgeFraction,
    subdivisions: options.capSubdivisions,
  });

  const empty: AccretionChunks = {
    geometry: new THREE.BufferGeometry(),
    chunkCount: 0,
    triangleCount: 0,
    rimPoints: [],
    rimNormals: [],
  };
  if (capMesh.points.length === 0 || capMesh.triangles.length === 0) return empty;

  // ── 1 · Normalise, so every mark is framed identically ──
  // Only X and Y come from the outline; `depth` is authored in world units and must never be dragged
  // through the source-to-world scale, or an SVG viewBox and a font glyph give the same slider two
  // different thicknesses.
  const bounds = new THREE.Box2();
  capMesh.points.forEach((point) => bounds.expandByPoint(point));
  const size = new THREE.Vector2();
  bounds.getSize(size);
  const largestDimension = Math.max(size.x, size.y, 1e-6);
  const normaliseScale = options.targetSize / largestDimension;
  const rawCentre = new THREE.Vector2();
  bounds.getCenter(rawCentre);

  const points = capMesh.points.map((point) =>
    point.clone().sub(rawCentre).multiplyScalar(normaliseScale),
  );
  const halfDepth = options.depth / 2;

  // ── 2 · Distance from every point to the outline ──
  // Drives the size hierarchy, the silhouette protection, and where the crystal grows.
  const boundaryLoops = capMesh.loops.map((capLoop) =>
    capLoop.indices.map((index) => points[index]),
  );
  const distanceToOutline = (point: THREE.Vector2): number => {
    let nearest = Infinity;
    boundaryLoops.forEach((loop) => {
      for (let index = 0; index < loop.length; index += 1) {
        const distance = distanceToSegment(point, loop[index], loop[(index + 1) % loop.length]);
        if (distance < nearest) nearest = distance;
      }
    });
    return nearest === Infinity ? 0 : nearest;
  };

  const pointRimDistance = points.map((point) => distanceToOutline(point));

  // ── 3 · Cluster the cap triangles into stones ──
  const triangleCount = capMesh.triangles.length / 3;
  const centroids: THREE.Vector2[] = [];
  const centroidRim: number[] = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = capMesh.triangles[triangle * 3];
    const b = capMesh.triangles[triangle * 3 + 1];
    const c = capMesh.triangles[triangle * 3 + 2];
    centroids.push(
      new THREE.Vector2(
        (points[a].x + points[b].x + points[c].x) / 3,
        (points[a].y + points[b].y + points[c].y) / 3,
      ),
    );
    centroidRim.push((pointRimDistance[a] + pointRimDistance[b] + pointRimDistance[c]) / 3);
  }

  // Variable-radius Poisson seeding: walk the triangles in a seeded shuffle and accept a centroid when
  // it is farther than the locally wanted spacing from every seed already taken. Fine on the rim,
  // coarse in the core, and deterministic.
  const random = createRandom(options.seed);
  const order = centroids.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }

  const wantedSpacing = (rimDistance: number): number =>
    THREE.MathUtils.lerp(
      options.rimSpacing,
      options.coreSpacing,
      THREE.MathUtils.smoothstep(rimDistance, 0, Math.max(options.spacingFalloff, 1e-4)),
    );

  const seedTriangles: number[] = [];
  order.forEach((triangle) => {
    const spacing = wantedSpacing(centroidRim[triangle]);
    const centroid = centroids[triangle];
    const clashes = seedTriangles.some(
      (seedTriangle) => centroid.distanceTo(centroids[seedTriangle]) < spacing,
    );
    if (!clashes) seedTriangles.push(triangle);
  });
  // A mark smaller than one spacing would otherwise become a single stone with no growth to watch.
  if (seedTriangles.length === 0) seedTriangles.push(0);

  // Nearest seed by centroid distance. Cheaper than a graph traversal, and the connectivity pass below
  // repairs the one thing it gets wrong: a cell that reaches across a concavity — a "V"'s notch — and
  // claims triangles in both arms.
  const clusterOfTriangle = new Int32Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    let best = 0;
    let bestDistance = Infinity;
    seedTriangles.forEach((seedTriangle, seedIndex) => {
      const distance = centroids[triangle].distanceToSquared(centroids[seedTriangle]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = seedIndex;
      }
    });
    clusterOfTriangle[triangle] = best;
  }

  // Triangle adjacency over shared edges, for the connectivity split.
  const trianglesOfEdge = new Map<number, number[]>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = capMesh.triangles[triangle * 3];
    const b = capMesh.triangles[triangle * 3 + 1];
    const c = capMesh.triangles[triangle * 3 + 2];
    [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)].forEach((key) => {
      const existing = trianglesOfEdge.get(key);
      if (existing) existing.push(triangle);
      else trianglesOfEdge.set(key, [triangle]);
    });
  }
  const neighboursOf = (triangle: number): number[] => {
    const a = capMesh.triangles[triangle * 3];
    const b = capMesh.triangles[triangle * 3 + 1];
    const c = capMesh.triangles[triangle * 3 + 2];
    const found: number[] = [];
    [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)].forEach((key) => {
      trianglesOfEdge.get(key)?.forEach((other) => {
        if (other !== triangle) found.push(other);
      });
    });
    return found;
  };

  // Split every cluster into its connected components, so a stone is always one solid piece.
  const componentOfTriangle = new Int32Array(triangleCount).fill(-1);
  const components: number[][] = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (componentOfTriangle[triangle] !== -1) continue;
    const cluster = clusterOfTriangle[triangle];
    const componentIndex = components.length;
    const member: number[] = [];
    const stack = [triangle];
    componentOfTriangle[triangle] = componentIndex;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      member.push(current);
      neighboursOf(current).forEach((other) => {
        if (componentOfTriangle[other] !== -1) return;
        if (clusterOfTriangle[other] !== cluster) return;
        componentOfTriangle[other] = componentIndex;
        stack.push(other);
      });
    }
    components.push(member);
  }

  // Fold slivers into whichever neighbour they touch, so no stone is a single triangle.
  components.forEach((member, componentIndex) => {
    if (member.length >= MIN_CLUSTER_TRIANGLES) return;
    const host = member
      .flatMap((triangle) => neighboursOf(triangle))
      .map((triangle) => componentOfTriangle[triangle])
      .find((other) => other !== componentIndex && components[other]?.length > 0);
    if (host === undefined) return;
    member.forEach((triangle) => {
      componentOfTriangle[triangle] = host;
      components[host].push(triangle);
    });
    components[componentIndex] = [];
  });

  const stones = components.filter((member) => member.length > 0);

  // ── 4 · The displacement fields, functions of position only ──
  const displaced = new THREE.Vector3();
  const noiseSample = new THREE.Vector3();

  /** A vertex's final rest position: the flat prism, roughened. */
  const restPositionOf = (point: THREE.Vector2, rimDistance: number, side: number): THREE.Vector3 => {
    const z = halfDepth * side;

    // Across the plane — what makes the outline hewn. Damped toward the rim so a counter survives.
    const protection = THREE.MathUtils.clamp(options.silhouetteProtection, 0, 1);
    const rimProximity =
      1 - THREE.MathUtils.smoothstep(rimDistance, 0, Math.max(options.rimSpacing * 2, 1e-4));
    const inPlaneScale = options.inPlaneAmplitude * (1 - protection * rimProximity);
    noiseSample.set(point.x, point.y, 0);
    const offsetX =
      layeredLobeNoise(noiseSample, options.capFrequency, options.seed + IN_PLANE_SEED_X) *
      inPlaneScale;
    const offsetY =
      layeredLobeNoise(noiseSample, options.capFrequency, options.seed + IN_PLANE_SEED_Y) *
      inPlaneScale;

    // Through the thickness — what makes the faces pitted. Sampled with z included, so the front and
    // back faces get their own relief instead of mirroring each other.
    noiseSample.set(point.x, point.y, z);
    const offsetZ =
      layeredLobeNoise(noiseSample, options.capFrequency, options.seed) *
      options.capAmplitude *
      side;

    return displaced.set(point.x + offsetX, point.y + offsetY, z + offsetZ);
  };

  // ── 5 · Build every stone ──
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const chunkCentroid: number[] = [];
  const seedPoint: number[] = [];
  const startDistance: number[] = [];
  const spinAxis: number[] = [];
  const spinTurns: number[] = [];
  const jitter: number[] = [];
  const rim: number[] = [];

  const uvScale = 1 / Math.max(options.targetSize, 1e-4);
  const centroidAccumulator = new THREE.Vector3();
  const chunkRecords: { centroid: THREE.Vector3; vertexStart: number; vertexEnd: number }[] = [];

  stones.forEach((member) => {
    const vertexStart = positions.length / 3;

    // Unique cap points of this stone, and where each landed in the buffer.
    const localOfPoint = new Map<number, number>();
    const uniquePoints: number[] = [];
    member.forEach((triangle) => {
      for (let corner = 0; corner < 3; corner += 1) {
        const pointIndex = capMesh.triangles[triangle * 3 + corner];
        if (localOfPoint.has(pointIndex)) continue;
        localOfPoint.set(pointIndex, uniquePoints.length);
        uniquePoints.push(pointIndex);
      }
    });

    centroidAccumulator.set(0, 0, 0);

    /** Push one vertex and return its buffer index. */
    const pushVertex = (
      pointIndex: number,
      side: number,
      u: number,
      v: number,
    ): number => {
      const point = points[pointIndex];
      const rest = restPositionOf(point, pointRimDistance[pointIndex], side);
      positions.push(rest.x, rest.y, rest.z);
      uvs.push(u, v);
      rim.push(pointRimDistance[pointIndex]);
      return positions.length / 3 - 1;
    };

    // Front and back caps share the stone's point set, so the pitted relief reads as one surface.
    const frontBase = positions.length / 3;
    uniquePoints.forEach((pointIndex) => {
      const point = points[pointIndex];
      pushVertex(pointIndex, 1, point.x * uvScale, point.y * uvScale);
    });
    const backBase = positions.length / 3;
    uniquePoints.forEach((pointIndex) => {
      const point = points[pointIndex];
      pushVertex(pointIndex, -1, point.x * uvScale, point.y * uvScale);
    });

    member.forEach((triangle) => {
      const a = localOfPoint.get(capMesh.triangles[triangle * 3]) as number;
      const b = localOfPoint.get(capMesh.triangles[triangle * 3 + 1]) as number;
      const c = localOfPoint.get(capMesh.triangles[triangle * 3 + 2]) as number;
      // `buildCapMesh` forces every triangle counter-clockwise, so as-is the front faces +Z and the
      // back is the same triangle reversed.
      indices.push(frontBase + a, frontBase + b, frontBase + c);
      indices.push(backBase + c, backBase + b, backBase + a);
    });

    // The wall: one quad per edge that only one of this stone's triangles owns.
    const edgeUse = new Map<number, { first: number; second: number; count: number }>();
    member.forEach((triangle) => {
      const corners = [
        capMesh.triangles[triangle * 3],
        capMesh.triangles[triangle * 3 + 1],
        capMesh.triangles[triangle * 3 + 2],
      ];
      for (let corner = 0; corner < 3; corner += 1) {
        const first = corners[corner];
        const second = corners[(corner + 1) % 3];
        const key = edgeKey(first, second);
        const existing = edgeUse.get(key);
        if (existing) existing.count += 1;
        // Stored in the triangle's own winding order, which is what makes the wall face outward.
        else edgeUse.set(key, { first, second, count: 1 });
      }
    });

    const wallScratch = new THREE.Vector2();
    edgeUse.forEach((edge) => {
      if (edge.count !== 1) return;
      const from = points[edge.first];
      const to = points[edge.second];
      // Texture the wall along its own direction: continuous along the run, and the jump at each
      // fracture is what a broken stone face actually looks like.
      wallScratch.set(to.x - from.x, to.y - from.y);
      const run = wallScratch.length() * uvScale;
      const depthSpan = options.depth * uvScale;

      // Wall vertices are NOT shared with the caps, so cap and wall meet at a hard edge and the stone
      // reads faceted rather than inflated.
      const frontFrom = pushVertex(edge.first, 1, 0, 0);
      const frontTo = pushVertex(edge.second, 1, run, 0);
      const backTo = pushVertex(edge.second, -1, run, depthSpan);
      const backFrom = pushVertex(edge.first, -1, 0, depthSpan);
      indices.push(frontFrom, frontTo, backTo, frontFrom, backTo, backFrom);
    });

    const vertexEnd = positions.length / 3;
    for (let vertex = vertexStart; vertex < vertexEnd; vertex += 1) {
      centroidAccumulator.x += positions[vertex * 3];
      centroidAccumulator.y += positions[vertex * 3 + 1];
      centroidAccumulator.z += positions[vertex * 3 + 2];
    }
    const vertexTotal = Math.max(1, vertexEnd - vertexStart);
    chunkRecords.push({
      centroid: centroidAccumulator.clone().divideScalar(vertexTotal),
      vertexStart,
      vertexEnd,
    });
  });

  // ── 6 · Where each stone grows FROM ──
  // The ray from the core's centre through the stone, intersected with the core's carved skin. Closed
  // form, because the base rock is a radial height field — so a stone visibly comes out of the rock
  // rather than appearing where it already belonged.
  const rayDirection = new THREE.Vector3();
  const skin = new THREE.Vector3();
  const seeds: THREE.Vector3[] = [];
  let longestGrowth = 0;
  chunkRecords.forEach((record) => {
    rayDirection.copy(record.centroid).sub(options.baseRock.centre);
    if (rayDirection.lengthSq() < 1e-10) rayDirection.set(0, 0, 1);
    rayDirection.normalize();
    rockSkinPoint(options.baseRock, rayDirection, skin);
    seeds.push(skin.clone());
    longestGrowth = Math.max(longestGrowth, record.centroid.distanceTo(skin));
  });
  const growthScale = longestGrowth > 1e-6 ? 1 / longestGrowth : 0;

  // ── 7 · Bake the per-stone animation data onto every one of its vertices ──
  const axis = new THREE.Vector3();
  chunkRecords.forEach((record, chunkIndex) => {
    const seed = seeds[chunkIndex];
    const start = record.centroid.distanceTo(seed) * growthScale;
    // A seeded axis per stone; normalised so the spin rate does not depend on how the numbers fell.
    axis
      .set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
      .normalize();
    if (axis.lengthSq() < 0.5) axis.set(0, 1, 0);
    const turns = random();
    const chunkJitter = random();

    for (let vertex = record.vertexStart; vertex < record.vertexEnd; vertex += 1) {
      chunkCentroid.push(record.centroid.x, record.centroid.y, record.centroid.z);
      seedPoint.push(seed.x, seed.y, seed.z);
      startDistance.push(start);
      spinAxis.push(axis.x, axis.y, axis.z);
      spinTurns.push(turns);
      jitter.push(chunkJitter);
    }
  });

  // ── 8 · Inflate, so no crack can open between neighbours ──
  // Away from the stone's own centroid, which is a per-stone direction and therefore cannot be
  // position-derived — but it only ever pushes neighbours INTO each other, so nothing separates.
  if (options.chunkInflate > 0) {
    const outward = new THREE.Vector3();
    chunkRecords.forEach((record) => {
      for (let vertex = record.vertexStart; vertex < record.vertexEnd; vertex += 1) {
        outward
          .set(
            positions[vertex * 3] - record.centroid.x,
            positions[vertex * 3 + 1] - record.centroid.y,
            positions[vertex * 3 + 2] - record.centroid.z,
          )
          .normalize();
        positions[vertex * 3] += outward.x * options.chunkInflate;
        positions[vertex * 3 + 1] += outward.y * options.chunkInflate;
        positions[vertex * 3 + 2] += outward.z * options.chunkInflate;
      }
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aChunkCentroid', new THREE.Float32BufferAttribute(chunkCentroid, 3));
  geometry.setAttribute('aSeedPoint', new THREE.Float32BufferAttribute(seedPoint, 3));
  geometry.setAttribute('aStart', new THREE.Float32BufferAttribute(startDistance, 1));
  geometry.setAttribute('aSpinAxis', new THREE.Float32BufferAttribute(spinAxis, 3));
  geometry.setAttribute('aSpinTurns', new THREE.Float32BufferAttribute(spinTurns, 1));
  geometry.setAttribute('aJitter', new THREE.Float32BufferAttribute(jitter, 1));
  geometry.setAttribute('aRim', new THREE.Float32BufferAttribute(rim, 1));
  // After the displacement, so the relief actually shades. Coincident vertices are separate indices, so
  // this leaves the hard edges hard.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // ── 9 · Outline sites for the crystal layer ──
  const rimPoints: THREE.Vector2[] = [];
  const rimNormals: THREE.Vector2[] = [];
  const rimNormal = new THREE.Vector2();
  capMesh.loops.forEach((capLoop) => {
    const loop = capLoop.indices.map((index) => points[index]);
    loop.forEach((point, index) => {
      const previous = loop[(index - 1 + loop.length) % loop.length];
      const next = loop[(index + 1) % loop.length];
      // Outward is the RIGHT of travel: outer loops run counter-clockwise with material on the left,
      // and holes run clockwise with material also on the left, so one formula serves both.
      rimNormal.set(next.y - previous.y, -(next.x - previous.x));
      if (rimNormal.lengthSq() < 1e-12) return;
      rimNormal.normalize();
      rimPoints.push(point.clone());
      rimNormals.push(rimNormal.clone());
    });
  });

  return {
    geometry,
    chunkCount: chunkRecords.length,
    triangleCount: indices.length / 3,
    rimPoints,
    rimNormals,
  };
}
