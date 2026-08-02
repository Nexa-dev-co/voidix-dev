import * as THREE from 'three';
import { buildCapMesh } from '../markCapMesh';

/**
 * The mark, cut into a FIXED number of interlocking cells.
 *
 * ── Why the count has to be fixed, and accretion's cannot be reused ──────────────────────────────
 * Shards' whole claim is "cell i becomes cell i". That only means anything if cell i exists in both
 * marks, so every mark must partition into exactly the same number of pieces.
 *
 * `buildAccretionChunks` cannot do that. Its Poisson seeding accepts a seed whenever it clears the
 * locally wanted spacing, so the count falls out of the mark's area and its outline — a compass and a
 * wordmark come out with wildly different totals. That is correct for accretion, where a chunk is
 * anonymous and only its distance from the core matters. It is fatal here.
 *
 * So the seeding is farthest-point instead of Poisson: start somewhere, then repeatedly take the
 * triangle farthest from everything chosen so far, N times. Deterministic, exactly N every time,
 * well spread by construction, and — because each seed is trivially its own nearest seed — no cell can
 * come out empty, which would silently break the correspondence.
 *
 * ── The ordering IS the animation ────────────────────────────────────────────────────────────────
 * A partition alone does not give you a correspondence; something has to decide WHICH cell of B cell i
 * of A becomes. Pair them arbitrarily and every piece flies to an unrelated place — the deciding
 * question calls that "noise", and it is the failure mode to beat.
 *
 * So cells are sorted by angle about the mark's centre before they are numbered. Cell i of A and cell i
 * of B are then both "the i-th piece going around", which means neighbours in A land as neighbours in
 * B and the whole thing reads as one coherent rearrangement rather than as a shuffle.
 *
 * ── Two layers of vertices, same as accretion, for the same reason ───────────────────────────────
 * Every vertex sits at `z = ±halfDepth`, caps at both ends and one quad per boundary edge for the wall.
 * The silhouette is exact by construction and holes are exact, because the union of the cells IS the
 * mark's own triangulation.
 *
 * ⚠ That prism construction is genuinely close to `accretionChunks` §5, and the two want extracting
 * into a shared builder. Deliberately not done in the same change that introduces this strategy —
 * accretion is tuned and working, and refactoring it underneath a new candidate would put both at risk
 * at once. Extract once shards has earned its place.
 */

export interface ShardCellOptions {
  targetSize: number;
  depth: number;
  /** Tessellation of the mark's face. See `markCapMesh` — edge length is a fraction of the mark. */
  capEdgeFraction: number;
  capSubdivisions: number;
  /** How many pieces. The SAME for every mark, or the correspondence has nothing to pair. */
  cellCount: number;
}

export interface ShardCells {
  /** One merged, indexed geometry holding every cell, with the per-cell attributes baked. */
  geometry: THREE.BufferGeometry;
  /** Exactly `cellCount` entries, in the canonical angular order. */
  centroids: THREE.Vector3[];
  /** How far each cell reaches from its own centroid, so a cell can be rescaled to match its partner. */
  radii: number[];
}

/** Where a cell's pose is written for the shader to read. See `shardsTransition`'s pose texture. */
export const SHARD_POSE_STRIDE = 4;

function edgeKey(first: number, second: number): number {
  return first < second ? first * 2097152 + second : second * 2097152 + first;
}

export function buildShardCells(
  shapes: THREE.Shape[],
  flipY: boolean,
  options: ShardCellOptions,
): ShardCells {
  const capMesh = buildCapMesh(shapes, flipY, {
    edgeFraction: options.capEdgeFraction,
    subdivisions: options.capSubdivisions,
  });

  const empty: ShardCells = {
    geometry: new THREE.BufferGeometry(),
    centroids: [],
    radii: [],
  };
  if (capMesh.points.length === 0 || capMesh.triangles.length === 0) return empty;

  // ── 1 · Normalise, so every mark is framed identically ──
  // Only X and Y come from the outline; `depth` is authored in world units and must never be dragged
  // through the source-to-world scale, or an SVG viewBox and a font glyph give the same slider two
  // different thicknesses. Same reasoning as `accretionChunks` §1.
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

  // ── 2 · Triangle centroids ──
  const triangleCount = capMesh.triangles.length / 3;
  const centroids2D: THREE.Vector2[] = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = capMesh.triangles[triangle * 3];
    const b = capMesh.triangles[triangle * 3 + 1];
    const c = capMesh.triangles[triangle * 3 + 2];
    centroids2D.push(
      new THREE.Vector2(
        (points[a].x + points[b].x + points[c].x) / 3,
        (points[a].y + points[b].y + points[c].y) / 3,
      ),
    );
  }

  // ── 3 · Farthest-point seeding — exactly N, well spread, deterministic ──
  // Starting from triangle 0 rather than a random one keeps the whole partition reproducible: re-tuning
  // something unrelated must never reshuffle the subject being judged.
  const wantedCells = Math.max(1, Math.min(Math.round(options.cellCount), triangleCount));
  const seedTriangles: number[] = [0];
  const nearestSeedDistance = centroids2D.map((centroid) =>
    centroid.distanceToSquared(centroids2D[0]),
  );
  while (seedTriangles.length < wantedCells) {
    let farthest = 0;
    let farthestDistance = -1;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      if (nearestSeedDistance[triangle] > farthestDistance) {
        farthestDistance = nearestSeedDistance[triangle];
        farthest = triangle;
      }
    }
    seedTriangles.push(farthest);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const distance = centroids2D[triangle].distanceToSquared(centroids2D[farthest]);
      if (distance < nearestSeedDistance[triangle]) nearestSeedDistance[triangle] = distance;
    }
  }

  // ── 4 · Number the cells by angle about the centre — this is the correspondence ──
  // See the header: pairing by arbitrary index is what makes a rearrangement look like a shuffle.
  // Radius breaks ties so two cells on the same ray still get a stable, meaningful order.
  const orderedSeeds = seedTriangles
    .map((triangle) => ({
      triangle,
      angle: Math.atan2(centroids2D[triangle].y, centroids2D[triangle].x),
      radius: centroids2D[triangle].length(),
    }))
    .sort((first, second) => first.angle - second.angle || first.radius - second.radius)
    .map((entry) => entry.triangle);

  // ── 5 · Assign every triangle to its nearest seed ──
  const cellOfTriangle = new Int32Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    let best = 0;
    let bestDistance = Infinity;
    orderedSeeds.forEach((seedTriangle, cellIndex) => {
      const distance = centroids2D[triangle].distanceToSquared(centroids2D[seedTriangle]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cellIndex;
      }
    });
    cellOfTriangle[triangle] = best;
  }

  const cellTriangles: number[][] = orderedSeeds.map(() => []);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    cellTriangles[cellOfTriangle[triangle]].push(triangle);
  }

  // ── 6 · Build every cell as a prism ──
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cellIndexAttribute: number[] = [];
  const cellCentroidAttribute: number[] = [];
  const cellRadiusAttribute: number[] = [];

  const uvScale = 1 / Math.max(options.targetSize, 1e-4);
  const centroids: THREE.Vector3[] = [];
  const radii: number[] = [];
  const wallScratch = new THREE.Vector2();

  cellTriangles.forEach((member, cellIndex) => {
    const vertexStart = positions.length / 3;

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

    const pushVertex = (pointIndex: number, side: number, u: number, v: number): number => {
      const point = points[pointIndex];
      positions.push(point.x, point.y, halfDepth * side);
      uvs.push(u, v);
      return positions.length / 3 - 1;
    };

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

    // The wall: one quad per edge that only one of this cell's triangles owns.
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
        else edgeUse.set(key, { first, second, count: 1 });
      }
    });

    edgeUse.forEach((edge) => {
      if (edge.count !== 1) return;
      const from = points[edge.first];
      const to = points[edge.second];
      const depthSpan = options.depth * uvScale;

      // U is the vertex's POSITION projected onto the wall's direction, never a run restarting at 0 —
      // see the long note in `accretionChunks`, where restarting it made every wall in the mark sample
      // one identical sliver of texture and read as banding.
      wallScratch.set(to.x - from.x, to.y - from.y);
      const edgeLength = wallScratch.length();
      if (edgeLength > 1e-9) wallScratch.divideScalar(edgeLength);
      else wallScratch.set(1, 0);
      const uFrom = (from.x * wallScratch.x + from.y * wallScratch.y) * uvScale;
      const uTo = (to.x * wallScratch.x + to.y * wallScratch.y) * uvScale;

      const frontFrom = pushVertex(edge.first, 1, uFrom, 0);
      const frontTo = pushVertex(edge.second, 1, uTo, 0);
      const backTo = pushVertex(edge.second, -1, uTo, depthSpan);
      const backFrom = pushVertex(edge.first, -1, uFrom, depthSpan);
      indices.push(frontFrom, frontTo, backTo, frontFrom, backTo, backFrom);
    });

    // ── 7 · The cell's own frame ──
    const vertexEnd = positions.length / 3;
    const centroid = new THREE.Vector3();
    for (let vertex = vertexStart; vertex < vertexEnd; vertex += 1) {
      centroid.x += positions[vertex * 3];
      centroid.y += positions[vertex * 3 + 1];
      centroid.z += positions[vertex * 3 + 2];
    }
    centroid.divideScalar(Math.max(1, vertexEnd - vertexStart));

    let radius = 0;
    for (let vertex = vertexStart; vertex < vertexEnd; vertex += 1) {
      radius = Math.max(
        radius,
        Math.hypot(
          positions[vertex * 3] - centroid.x,
          positions[vertex * 3 + 1] - centroid.y,
          positions[vertex * 3 + 2] - centroid.z,
        ),
      );
    }

    centroids.push(centroid);
    radii.push(radius);
    for (let vertex = vertexStart; vertex < vertexEnd; vertex += 1) {
      cellIndexAttribute.push(cellIndex);
      cellCentroidAttribute.push(centroid.x, centroid.y, centroid.z);
      cellRadiusAttribute.push(radius);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aCellIndex', new THREE.Float32BufferAttribute(cellIndexAttribute, 1));
  geometry.setAttribute(
    'aCellCentroid',
    new THREE.Float32BufferAttribute(cellCentroidAttribute, 3),
  );
  geometry.setAttribute('aCellRadius', new THREE.Float32BufferAttribute(cellRadiusAttribute, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return { geometry, centroids, radii };
}
