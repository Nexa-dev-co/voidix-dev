// The road in from the raw OBJ export to a GLB the Services deck can take apart.
//
// The Services vessel is not shown whole — it assembles across the four service stops, one wave of
// parts per discipline (see docs/services-vessel-assembly-plan.md). That only works if the model
// arrives already split into addressable pieces, each one able to tumble about ITSELF.
//
// The export cannot supply that. Its three `g` groups (Object01 / Object02 / Box01) cut across the
// ship arbitrarily — one of them holds most of the hull and another holds nothing useful. What the
// geometry DOES carry is 39 disjoint mesh islands, mirror-paired down the centreline, and those are
// real parts. So this script finds them, groups them into the nine clusters the assembly is authored
// against, and emits one named glTF node per cluster.
//
// Usage:
//   npm run build:vessel
//
// Output goes to models-src/, which is the INPUT to the existing road:
//   node scripts/buildVessel.mjs           → models-src/vessel.glb   (uncompressed, named, split)
//   npm run optimize:models -- vessel.glb  → public/models/vessel.glb (Draco + KTX2)
//
// ⚠ That second step needs `join`, `flatten` and `instance` all OFF in its recipe. Any one of them
// undoes this script: join merges the nine clusters (they share a material) back into a single mesh,
// flatten bakes each node's translation into its vertices and drops the hierarchy, and instance can
// collapse the mirror pairs onto shared geometry. See MODEL_RECIPES in optimizeModels.mjs.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DIRECTORY = "models-src/vessel";
const SOURCE_OBJ = "vessel.obj";
const SOURCE_TEXTURE = "vessel-albedo.jpg";
const OUTPUT_PATH = "models-src/vessel.glb";

// ── Which island is which part ───────────────────────────────────────────────────────────────────
//
// Matched on FACE COUNT plus, where that is ambiguous, on where the island sits — never on the order
// the islands come out of the parse. That order is an artifact of vertex numbering in the OBJ: it is
// stable for this file but it means nothing, and keying the wave assignment to it would produce a
// table that silently reshuffles if the source is ever re-exported.
//
// Face counts, by contrast, are a property of the geometry. Every part in this model has a distinct
// one except the 28-face islands, where six nacelle side-fins and eight wing pods collide — those are
// separated by z, which is unambiguous (the fins sit back at z −7.7…−10.5, the pods forward at
// z +0.7/+1.9).
const FIN_POD_Z_SPLIT = -5;

const PART_RULES = [
  // ── Wave 1 · 01 Web Experiences · THE FRAME ──
  { faces: 150, cluster: "spine", wave: 1, mirrored: false, part: "spine" },
  { faces: 160, cluster: "body", wave: 1, mirrored: true, part: "body plate" },

  // ── Wave 2 · 02 Mobile Systems · THE REACH ──
  { faces: 46, cluster: "wing", wave: 2, mirrored: true, part: "outer wing" },
  { faces: 10, cluster: "wing", wave: 2, mirrored: true, part: "winglet" },
  {
    faces: 28,
    cluster: "wing",
    wave: 2,
    mirrored: true,
    part: "wing pod",
    where: (island) => island.centre[2] > FIN_POD_Z_SPLIT,
  },

  // ── Wave 3 · 03 Enterprise Platforms · THE POWER ──
  { faces: 316, cluster: "engine", wave: 3, mirrored: true, part: "nacelle" },
  { faces: 34, cluster: "engine", wave: 3, mirrored: true, part: "vent disc" },
  { faces: 26, cluster: "engine", wave: 3, mirrored: true, part: "blade fin" },
  {
    faces: 28,
    cluster: "engine",
    wave: 3,
    mirrored: true,
    part: "side fin",
    where: (island) => island.centre[2] <= FIN_POD_Z_SPLIT,
  },

  // ── Wave 4 · 04 Artificial Intelligence · THE INTELLIGENCE ──
  // Deliberately the smallest wave. It is not carrying mass, it is carrying the ignition.
  { faces: 48, cluster: "core", wave: 4, mirrored: true, part: "end cap" },
  { faces: 19, cluster: "core", wave: 4, mirrored: true, part: "inner plate" },
  { faces: 8, cluster: "core", wave: 4, mirrored: true, part: "rear fitting" },
];

/** Every cluster this build must produce. A missing or unexpected one is a hard failure, not a warning. */
const EXPECTED_CLUSTERS = [
  "w1_spine",
  "w1_body_left",
  "w1_body_right",
  "w2_wing_left",
  "w2_wing_right",
  "w3_engine_left",
  "w3_engine_right",
  "w4_core_left",
  "w4_core_right",
];

// ── OBJ parsing ──────────────────────────────────────────────────────────────────────────────────

/** Positions, uvs, normals and triangles, straight out of the file. */
function parseObj(text) {
  const positions = [];
  const uvs = [];
  const normals = [];
  const triangles = [];

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const parts = line.trim().split(/\s+/);
      positions.push([+parts[1], +parts[2], +parts[3]]);
    } else if (line.startsWith("vt ")) {
      const parts = line.trim().split(/\s+/);
      // OBJ's v axis runs bottom-up, glTF's runs top-down.
      uvs.push([+parts[1], 1 - +parts[2]]);
    } else if (line.startsWith("vn ")) {
      const parts = line.trim().split(/\s+/);
      normals.push([+parts[1], +parts[2], +parts[3]]);
    } else if (line.startsWith("f ")) {
      const corners = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((corner) => {
          const [vertex, uv, normal] = corner.split("/");
          // Negative OBJ indices count back from the end of the list so far.
          const resolve = (raw, list) => {
            if (raw === undefined || raw === "") return -1;
            const index = parseInt(raw, 10);
            return index < 0 ? list.length + index : index - 1;
          };
          return {
            position: resolve(vertex, positions),
            uv: resolve(uv, uvs),
            normal: resolve(normal, normals),
          };
        });
      // Fan-triangulate anything with more than three corners. This export is all triangles, but a
      // re-export need not be, and a silently dropped quad is a hole in the hull.
      for (let corner = 1; corner < corners.length - 1; corner += 1) {
        triangles.push([corners[0], corners[corner], corners[corner + 1]]);
      }
    }
  }

  return { positions, uvs, normals, triangles };
}

// ── Islands ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Disjoint mesh islands, by union-find over POSITION-WELDED vertices.
 *
 * The weld is the load-bearing part. An OBJ splits a vertex wherever its uv or normal differs, so two
 * triangles that visibly share an edge routinely reference different `v` indices — union-find on raw
 * indices finds ~200 fragments instead of 39 parts. Welding on rounded position first collapses those
 * back together.
 */
function findIslands({ positions, triangles }) {
  const WELD_PRECISION = 1e4;
  const weldKey = (position) =>
    position.map((axis) => Math.round(axis * WELD_PRECISION)).join(",");

  const representative = new Array(positions.length);
  const seen = new Map();
  positions.forEach((position, index) => {
    const key = weldKey(position);
    if (!seen.has(key)) seen.set(key, index);
    representative[index] = seen.get(key);
  });

  const parent = positions.map((_, index) => index);
  const find = (node) => {
    let root = node;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  triangles.forEach((triangle) => {
    const welded = triangle.map((corner) => representative[corner.position]);
    union(welded[0], welded[1]);
    union(welded[0], welded[2]);
  });

  const islands = new Map();
  triangles.forEach((triangle) => {
    const root = find(representative[triangle[0].position]);
    if (!islands.has(root)) {
      islands.set(root, {
        triangles: [],
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
      });
    }
    const island = islands.get(root);
    island.triangles.push(triangle);
    triangle.forEach((corner) => {
      const position = positions[corner.position];
      for (let axis = 0; axis < 3; axis += 1) {
        island.min[axis] = Math.min(island.min[axis], position[axis]);
        island.max[axis] = Math.max(island.max[axis], position[axis]);
      }
    });
  });

  return [...islands.values()].map((island) => ({
    ...island,
    faces: island.triangles.length,
    centre: island.min.map((low, axis) => (low + island.max[axis]) / 2),
  }));
}

// ── Clustering ───────────────────────────────────────────────────────────────────────────────────

function clusterIslands(islands) {
  const clusters = new Map();
  const unmatched = [];

  islands.forEach((island) => {
    const rule = PART_RULES.find(
      (candidate) =>
        candidate.faces === island.faces &&
        (candidate.where === undefined || candidate.where(island)),
    );
    if (!rule) {
      unmatched.push(island);
      return;
    }
    // A mirrored part belongs to the cluster on its own side of the centreline, so a pair can fly in
    // from opposite edges of the frame and meet in the middle.
    const side = island.centre[0] < 0 ? "left" : "right";
    const key = rule.mirrored
      ? `w${rule.wave}_${rule.cluster}_${side}`
      : `w${rule.wave}_${rule.cluster}`;

    if (!clusters.has(key)) {
      clusters.set(key, { name: key, wave: rule.wave, triangles: [], parts: [] });
    }
    const cluster = clusters.get(key);
    cluster.triangles.push(...island.triangles);
    cluster.parts.push(rule.part);
  });

  if (unmatched.length > 0) {
    const detail = unmatched
      .map(
        (island) =>
          `    ${island.faces} faces at ${island.centre
            .map((axis) => axis.toFixed(1))
            .join(", ")}`,
      )
      .join("\n");
    throw new Error(
      `${unmatched.length} island(s) matched no rule in PART_RULES — they would be silently ` +
        `dropped from the ship:\n${detail}`,
    );
  }

  return clusters;
}

// ── Geometry per cluster ─────────────────────────────────────────────────────────────────────────

/**
 * Build one indexed primitive per cluster, recentred on the cluster's own bounding-box centre.
 *
 * ⚠ The recentring is what lets a loose part tumble about ITSELF. Left on the ship's origin, every
 * drifting part would orbit the ship's centre instead of spinning in place, and the whole swarm would
 * read as a carousel rather than as debris. The offset removed here comes back as the node's
 * translation — which is then exactly the socket the assembly interpolates toward.
 */
function buildPrimitive(cluster, source) {
  const { positions, uvs, normals } = source;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  cluster.triangles.forEach((triangle) =>
    triangle.forEach((corner) => {
      const position = positions[corner.position];
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], position[axis]);
        max[axis] = Math.max(max[axis], position[axis]);
      }
    }),
  );
  const socket = min.map((low, axis) => (low + max[axis]) / 2);

  // glTF needs one vertex per unique (position, uv, normal) triple; OBJ indexes the three separately.
  const vertexIndexByKey = new Map();
  const outPositions = [];
  const outNormals = [];
  const outUvs = [];
  const outIndices = [];

  cluster.triangles.forEach((triangle) =>
    triangle.forEach((corner) => {
      const key = `${corner.position}/${corner.uv}/${corner.normal}`;
      let index = vertexIndexByKey.get(key);
      if (index === undefined) {
        index = outPositions.length / 3;
        vertexIndexByKey.set(key, index);
        const position = positions[corner.position];
        outPositions.push(
          position[0] - socket[0],
          position[1] - socket[1],
          position[2] - socket[2],
        );
        const normal = normals[corner.normal] ?? [0, 1, 0];
        outNormals.push(normal[0], normal[1], normal[2]);
        const uv = uvs[corner.uv] ?? [0, 0];
        outUvs.push(uv[0], uv[1]);
      }
      outIndices.push(index);
    }),
  );

  return {
    socket,
    positions: new Float32Array(outPositions),
    normals: new Float32Array(outNormals),
    uvs: new Float32Array(outUvs),
    indices: new Uint32Array(outIndices),
    // Recentred, so the accessor bounds are the box around the origin.
    positionMin: min.map((low, axis) => low - socket[axis]),
    positionMax: max.map((high, axis) => high - socket[axis]),
  };
}

// ── GLB assembly ─────────────────────────────────────────────────────────────────────────────────
//
// Written by hand rather than through a library, for the same reason optimizeModels.mjs shells out to
// `npx @gltf-transform/cli` instead of importing it: this repo deliberately keeps its model toolchain
// out of package.json. The output is a plain glTF 2.0 container — the compression, the texture encode
// and every other transform still happen in the existing optimize step.

const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_INT = 5125;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;

function createBufferBuilder() {
  const chunks = [];
  let byteLength = 0;
  return {
    /** Append a typed array (or Buffer) and return the bufferView it landed in. */
    add(data, target) {
      // Accessors are read as aligned typed arrays, so every view has to start on a 4-byte boundary.
      const padding = (4 - (byteLength % 4)) % 4;
      if (padding > 0) {
        chunks.push(Buffer.alloc(padding));
        byteLength += padding;
      }
      const buffer = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const view = { buffer: 0, byteOffset: byteLength, byteLength: buffer.length };
      if (target !== undefined) view.target = target;
      chunks.push(buffer);
      byteLength += buffer.length;
      return view;
    },
    build() {
      return Buffer.concat(chunks);
    },
    get byteLength() {
      return byteLength;
    },
  };
}

function writeGlb(json, binary) {
  const jsonText = Buffer.from(JSON.stringify(json), "utf8");
  // Both chunks are 4-byte aligned; JSON pads with spaces, BIN with zeroes, per the spec.
  const jsonPadding = (4 - (jsonText.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - (binary.length % 4)) % 4;
  const binaryChunk = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binaryChunk.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryChunk.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4); // "BIN"

  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]);
}

// ── Build ────────────────────────────────────────────────────────────────────────────────────────

const source = parseObj(readFileSync(join(SOURCE_DIRECTORY, SOURCE_OBJ), "utf8"));
const islands = findIslands(source);
const clusters = clusterIslands(islands);

const producedClusters = [...clusters.keys()].sort();
const expected = [...EXPECTED_CLUSTERS].sort();
if (producedClusters.join("|") !== expected.join("|")) {
  throw new Error(
    `cluster set does not match EXPECTED_CLUSTERS.\n  expected: ${expected.join(", ")}\n` +
      `  produced: ${producedClusters.join(", ")}`,
  );
}

const buffer = createBufferBuilder();
const bufferViews = [];
const accessors = [];
const meshes = [];
const nodes = [];

const addAccessor = (data, target, type, componentType, extras = {}) => {
  bufferViews.push(buffer.add(data, target));
  accessors.push({
    bufferView: bufferViews.length - 1,
    componentType,
    count:
      type === "SCALAR"
        ? data.length
        : data.length / (type === "VEC3" ? 3 : 2),
    type,
    ...extras,
  });
  return accessors.length - 1;
};

// Waves first, then sides — so the node order in the file reads in assembly order.
const orderedClusters = [...clusters.values()].sort(
  (a, b) => a.wave - b.wave || a.name.localeCompare(b.name),
);

for (const cluster of orderedClusters) {
  const primitive = buildPrimitive(cluster, source);

  const position = addAccessor(
    primitive.positions,
    TARGET_ARRAY_BUFFER,
    "VEC3",
    COMPONENT_FLOAT,
    { min: primitive.positionMin, max: primitive.positionMax },
  );
  const normal = addAccessor(primitive.normals, TARGET_ARRAY_BUFFER, "VEC3", COMPONENT_FLOAT);
  const uv = addAccessor(primitive.uvs, TARGET_ARRAY_BUFFER, "VEC2", COMPONENT_FLOAT);
  const indices = addAccessor(
    primitive.indices,
    TARGET_ELEMENT_ARRAY_BUFFER,
    "SCALAR",
    COMPONENT_UNSIGNED_INT,
  );

  meshes.push({
    name: cluster.name,
    primitives: [
      {
        attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv },
        indices,
        material: 0,
      },
    ],
  });
  nodes.push({
    name: cluster.name,
    translation: primitive.socket,
    mesh: meshes.length - 1,
  });

  const partCounts = cluster.parts.reduce((counts, part) => {
    counts[part] = (counts[part] ?? 0) + 1;
    return counts;
  }, {});
  const partSummary = Object.entries(partCounts)
    .map(([part, count]) => (count > 1 ? `${count}× ${part}` : part))
    .join(", ");
  console.log(
    `  ${cluster.name.padEnd(16)} ${String(cluster.triangles.length).padStart(4)} tris  ` +
      `socket ${primitive.socket.map((axis) => axis.toFixed(1).padStart(6)).join(" ")}   ${partSummary}`,
  );
}

// The albedo rides along as an embedded bufferView; the optimize step re-encodes it to KTX2/ETC1S.
const textureBytes = readFileSync(join(SOURCE_DIRECTORY, SOURCE_TEXTURE));
bufferViews.push(buffer.add(textureBytes));
const imageBufferView = bufferViews.length - 1;

const binary = buffer.build();
const json = {
  asset: { version: "2.0", generator: "voidix buildVessel" },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, index) => index) }],
  nodes,
  meshes,
  materials: [
    {
      name: "vessel_hull",
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0.6,
        roughnessFactor: 0.55,
      },
    },
  ],
  textures: [{ sampler: 0, source: 0 }],
  images: [{ bufferView: imageBufferView, mimeType: "image/jpeg" }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  accessors,
  bufferViews,
  buffers: [{ byteLength: binary.length }],
};

writeFileSync(OUTPUT_PATH, writeGlb(json, binary));

const totalTriangles = orderedClusters.reduce(
  (total, cluster) => total + cluster.triangles.length,
  0,
);
console.log(
  `\n✓ ${islands.length} islands → ${orderedClusters.length} clusters → ${OUTPUT_PATH}` +
    `  (${totalTriangles} tris, ${(binary.length / 1024).toFixed(0)} KB binary)\n` +
    `  next: npm run optimize:models -- vessel.glb\n`,
);
