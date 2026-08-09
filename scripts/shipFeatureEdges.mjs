// The lines a human would draw if asked to draw a hull.
//
// Shared by the fleet bake (which turns them into point clouds) and by anything that wants to look at
// them. A wireframe of every triangle is a grey smear — it draws the tessellation, not the ship. What
// reads as a hull is the set of edges that MEAN something:
//
//   · BOUNDARY — an edge with one face. An open shell's rim.
//   · CREASE   — two faces meeting at more than CREASE_ANGLE. Panel lines, spars, hard corners.
//   · CONTOUR  — two faces that disagree about which way they face the DRAWING'S OWN VIEW. This is
//                the outline, and it is view-dependent on purpose: the drawing is the ship seen from
//                one angle, so the edges that form its silhouette have to be in the set.
//   · NON-MANIFOLD — three or more faces on one edge, i.e. two parts meeting. Always a feature, and
//                treating it as one avoids having to pick which pair of faces to measure between.

/**
 * Two faces meeting at more than this are a crease.
 *
 * Swept at 25 / 34 / 42 against previews of the fighter. 25° drew each wing pylon as a BUNDLE of four
 * or five near-parallel lines — every faceting step across its taper crossed the threshold — which
 * reads as a smudge rather than a spar. 42° is where a pylon becomes one clean outline and the
 * fuselage keeps its panel structure.
 */
export const CREASE_ANGLE_DEGREES = 42;

/** How far a simplified chain may stray from the true edge, as a fraction of the model's size. */
const CHAIN_TOLERANCE = 0.0015;

/**
 * Chains shorter than this (as a fraction of the model's size) are dropped whole.
 *
 * Not per-SEGMENT: a short segment inside a long panel line is meaningful, a whole isolated chain of
 * them is a rivet nobody will ever see and a line the particle field would waste grains on.
 */
// ⚠ Do NOT raise this to thin out a busy hull. Tried at 0.07 and 0.13 on `spaceship`, whose plan view
// is the greebliest of the four: both DELETED ITS OUTLINE and kept the interior clutter. The
// silhouette of a faceted hull arrives as many SHORT contour chains while the long chains are panel
// lines running down the middle of it — so a length filter removes exactly the wrong half. Density is
// the model's, not this constant's, and in an additive particle field it reads as luminance anyway.
const MIN_CHAIN_LENGTH = 0.026;

/** Welding tolerance, as a fraction of the model's size. */
const WELD_TOLERANCE = 0.00002;

// ── 1 · Weld ─────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ Adjacency cannot be read off the index buffer. Hard-surface exports split vertices wherever a
// normal or a UV seam demands it, so the two triangles either side of a panel line very often do not
// share an index at all — and an edge that looks unshared is classified as a boundary, which would
// select every edge in the model. Position is the only thing that survives that.

function weldVertices(triangles, size) {
  const grid = size * WELD_TOLERANCE;
  const lookup = new Map();
  const cornerVertex = new Uint32Array(triangles.length / 3);
  const positions = [];

  for (let corner = 0; corner < triangles.length / 3; corner += 1) {
    const x = triangles[corner * 3];
    const y = triangles[corner * 3 + 1];
    const z = triangles[corner * 3 + 2];
    const key = `${Math.round(x / grid)},${Math.round(y / grid)},${Math.round(z / grid)}`;
    let vertex = lookup.get(key);
    if (vertex === undefined) {
      vertex = positions.length / 3;
      lookup.set(key, vertex);
      positions.push(x, y, z);
    }
    cornerVertex[corner] = vertex;
  }
  return { cornerVertex, positions: new Float64Array(positions) };
}

// ── 2 · Face normals ─────────────────────────────────────────────────────────────────────────────

function faceNormals(triangles) {
  const faceCount = triangles.length / 9;
  const normals = new Float64Array(faceCount * 3);
  for (let face = 0; face < faceCount; face += 1) {
    const at = face * 9;
    const ax = triangles[at + 3] - triangles[at];
    const ay = triangles[at + 4] - triangles[at + 1];
    const az = triangles[at + 5] - triangles[at + 2];
    const bx = triangles[at + 6] - triangles[at];
    const by = triangles[at + 7] - triangles[at + 1];
    const bz = triangles[at + 8] - triangles[at + 2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const length = Math.hypot(nx, ny, nz);
    // A degenerate triangle has no opinion about which way it faces; leaving it at zero makes every
    // dihedral test involving it fail closed rather than selecting a random edge.
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    }
    normals[face * 3] = nx;
    normals[face * 3 + 1] = ny;
    normals[face * 3 + 2] = nz;
  }
  return normals;
}

// ── 3 · Select ───────────────────────────────────────────────────────────────────────────────────

function selectFeatureEdges(cornerVertex, normals, viewDirection) {
  const edges = new Map();
  const faceCount = cornerVertex.length / 3;
  const KEY_STRIDE = 1e7;

  for (let face = 0; face < faceCount; face += 1) {
    for (let side = 0; side < 3; side += 1) {
      const a = cornerVertex[face * 3 + side];
      const b = cornerVertex[face * 3 + ((side + 1) % 3)];
      if (a === b) continue; // collapsed by the weld
      const key = Math.min(a, b) * KEY_STRIDE + Math.max(a, b);
      const existing = edges.get(key);
      if (existing) existing.faces.push(face);
      else edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [face] });
    }
  }

  const creaseCosine = Math.cos((CREASE_ANGLE_DEGREES * Math.PI) / 180);
  const selected = [];
  const counts = { boundary: 0, crease: 0, contour: 0, nonManifold: 0 };

  for (const edge of edges.values()) {
    if (edge.faces.length === 1) {
      selected.push(edge);
      counts.boundary += 1;
      continue;
    }
    if (edge.faces.length > 2) {
      selected.push(edge);
      counts.nonManifold += 1;
      continue;
    }

    const [first, second] = edge.faces;
    const dot =
      normals[first * 3] * normals[second * 3] +
      normals[first * 3 + 1] * normals[second * 3 + 1] +
      normals[first * 3 + 2] * normals[second * 3 + 2];
    if (dot < creaseCosine) {
      selected.push(edge);
      counts.crease += 1;
      continue;
    }

    const facingFirst =
      normals[first * 3] * viewDirection[0] +
      normals[first * 3 + 1] * viewDirection[1] +
      normals[first * 3 + 2] * viewDirection[2];
    const facingSecond =
      normals[second * 3] * viewDirection[0] +
      normals[second * 3 + 1] * viewDirection[1] +
      normals[second * 3 + 2] * viewDirection[2];
    if (facingFirst * facingSecond < 0) {
      selected.push(edge);
      counts.contour += 1;
    }
  }
  return { selected, counts };
}

// ── 4 · Chain, then simplify in 3D ───────────────────────────────────────────────────────────────

/** Distance from a point to the infinite line through a → b. */
function distanceToLine(point, a, b, positions) {
  const abx = positions[b * 3] - positions[a * 3];
  const aby = positions[b * 3 + 1] - positions[a * 3 + 1];
  const abz = positions[b * 3 + 2] - positions[a * 3 + 2];
  const apx = positions[point * 3] - positions[a * 3];
  const apy = positions[point * 3 + 1] - positions[a * 3 + 1];
  const apz = positions[point * 3 + 2] - positions[a * 3 + 2];
  const crossX = apy * abz - apz * aby;
  const crossY = apz * abx - apx * abz;
  const crossZ = apx * aby - apy * abx;
  const length = Math.hypot(abx, aby, abz);
  if (length === 0) return Math.hypot(apx, apy, apz);
  return Math.hypot(crossX, crossY, crossZ) / length;
}

/** Douglas–Peucker over a chain of vertex indices. */
function simplifyChain(chain, positions, tolerance) {
  if (chain.length < 3) return chain;
  const keep = new Uint8Array(chain.length);
  keep[0] = 1;
  keep[chain.length - 1] = 1;

  const stack = [[0, chain.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let furthest = -1;
    let furthestDistance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const distance = distanceToLine(chain[index], chain[first], chain[last], positions);
      if (distance > furthestDistance) {
        furthest = index;
        furthestDistance = distance;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  return chain.filter((_, index) => keep[index] === 1);
}

/**
 * Walk the selected edges into chains.
 *
 * Chains start at every JUNCTION or free end (any vertex whose selected-edge degree is not exactly 2)
 * and run until they reach another one — which is what keeps a Y-shaped feature from being drawn as
 * one line that doubles back. Whatever is left afterwards is a closed loop with no junction on it, so
 * those get an arbitrary start.
 */
function buildChains(selected, positions) {
  const incident = new Map();
  for (const edge of selected) {
    if (!incident.has(edge.a)) incident.set(edge.a, []);
    if (!incident.has(edge.b)) incident.set(edge.b, []);
    incident.get(edge.a).push(edge);
    incident.get(edge.b).push(edge);
  }

  const visited = new Set();
  const chains = [];

  const walk = (start, firstEdge) => {
    const chain = [start];
    let current = start;
    let edge = firstEdge;
    while (edge && !visited.has(edge)) {
      visited.add(edge);
      const next = edge.a === current ? edge.b : edge.a;
      chain.push(next);
      current = next;
      const options = incident.get(current) ?? [];
      edge = options.length === 2 ? options.find((candidate) => !visited.has(candidate)) : undefined;
    }
    return chain;
  };

  for (const [vertex, options] of incident) {
    if (options.length === 2) continue;
    for (const edge of options) {
      if (visited.has(edge)) continue;
      chains.push(walk(vertex, edge));
    }
  }
  for (const edge of selected) {
    if (visited.has(edge)) continue;
    chains.push(walk(edge.a, edge));
  }

  return chains.map((chain) => {
    let length = 0;
    for (let index = 1; index < chain.length; index += 1) {
      length += Math.hypot(
        positions[chain[index] * 3] - positions[chain[index - 1] * 3],
        positions[chain[index] * 3 + 1] - positions[chain[index - 1] * 3 + 1],
        positions[chain[index] * 3 + 2] - positions[chain[index - 1] * 3 + 2],
      );
    }
    return { chain, length };
  });
}

/**
 * A hull's feature edges, as a flat segment list in the GLB's own world space:
 * `[ax,ay,az, bx,by,bz, …]`.
 *
 * `viewDirection` decides which edges count as CONTOUR, so it must be the direction the drawing will
 * be seen from (pointing from the hull toward the eye).
 */
export function extractFeatureEdges(triangles, modelSize, viewDirection, maxSegments) {
  const { cornerVertex, positions } = weldVertices(triangles, modelSize);
  const { selected, counts } = selectFeatureEdges(cornerVertex, faceNormals(triangles), viewDirection);

  const chains = buildChains(selected, positions)
    .filter(({ length }) => length >= MIN_CHAIN_LENGTH * modelSize)
    .sort((a, b) => b.length - a.length);

  const segments = [];
  let truncated = false;
  for (const { chain } of chains) {
    const simplified = simplifyChain(chain, positions, CHAIN_TOLERANCE * modelSize);
    for (let index = 1; index < simplified.length; index += 1) {
      if (segments.length / 6 >= maxSegments) {
        truncated = true;
        break;
      }
      const from = simplified[index - 1];
      const to = simplified[index];
      segments.push(
        positions[from * 3], positions[from * 3 + 1], positions[from * 3 + 2],
        positions[to * 3], positions[to * 3 + 1], positions[to * 3 + 2],
      );
    }
  }

  return {
    segments: new Float64Array(segments),
    segmentCount: segments.length / 6,
    chainCount: chains.length,
    vertexCount: positions.length / 3,
    counts,
    truncated,
  };
}
