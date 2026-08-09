// Reading a GLB's geometry, in Node, without three.
//
// Shared by buildShipSilhouette.mjs (which projects it) and buildFleetDrawings.mjs (which walks its
// edges). Both need the same thing: every triangle in the file, in the GLB's own world space, with
// each node's transform already applied.
//
// ── Why not three's GLTFLoader ───────────────────────────────────────────────────────────────────
// It wants a DOM, a renderer for KTX2, and a DRACOLoader that spins up a worker pool. None of that
// exists here and none of it is needed — the container is a JSON chunk and a binary chunk, and the
// only hard part is Draco, which the decoder in public/draco does on its own.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(process.cwd() + '/');

// ── The container ────────────────────────────────────────────────────────────────────────────────

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BINARY = 0x004e4942;

export function readGlb(path) {
  const buffer = readFileSync(path);
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${path} is not a GLB`);

  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const body = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === CHUNK_JSON) json = JSON.parse(body.toString('utf8'));
    if (chunkType === CHUNK_BINARY) binary = body;
    // Chunks are 4-byte aligned.
    offset += 8 + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (!json) throw new Error(`${path} has no JSON chunk`);
  return { json, binary };
}

// ── Accessors (the uncompressed path) ────────────────────────────────────────────────────────────

const COMPONENT_READERS = {
  5121: (view, at) => view.getUint8(at),
  5123: (view, at) => view.getUint16(at, true),
  5125: (view, at) => view.getUint32(at, true),
  5126: (view, at) => view.getFloat32(at, true),
};
const COMPONENT_BYTES = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_LENGTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json, binary, index) {
  const accessor = json.accessors[index];
  const length = TYPE_LENGTHS[accessor.type];
  const values = new Float64Array(accessor.count * length);
  if (accessor.bufferView === undefined) return values;

  const view = json.bufferViews[accessor.bufferView];
  const data = new DataView(
    binary.buffer,
    binary.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
  );
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const stride = view.byteStride || componentBytes * length;
  const read = COMPONENT_READERS[accessor.componentType];
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < length; component += 1) {
      values[element * length + component] = read(data, element * stride + component * componentBytes);
    }
  }
  return values;
}

// ── Draco ────────────────────────────────────────────────────────────────────────────────────────

async function createDracoDecoder() {
  // The page's own decoder, so this script and the site are never decoding with different versions.
  const factory = require('./public/draco/draco_decoder.js');
  return await factory();
}

function decodeDracoPrimitive(draco, binary, json, extension) {
  const view = json.bufferViews[extension.bufferView];
  const bytes = new Uint8Array(binary.buffer, binary.byteOffset + (view.byteOffset ?? 0), view.byteLength);

  const decoder = new draco.Decoder();
  const buffer = new draco.DecoderBuffer();
  buffer.Init(bytes, bytes.length);
  const mesh = new draco.Mesh();
  const status = decoder.DecodeBufferToMesh(buffer, mesh);
  if (!status.ok()) throw new Error(`draco: ${status.error_msg()}`);

  const attribute = decoder.GetAttributeByUniqueId(mesh, extension.attributes.POSITION);
  const pointCount = mesh.num_points();
  const dracoPositions = new draco.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attribute, dracoPositions);
  const positions = new Float64Array(pointCount * 3);
  for (let value = 0; value < pointCount * 3; value += 1) positions[value] = dracoPositions.GetValue(value);

  const faceCount = mesh.num_faces();
  const indices = new Uint32Array(faceCount * 3);
  const face = new draco.DracoInt32Array();
  for (let index = 0; index < faceCount; index += 1) {
    decoder.GetFaceFromMesh(mesh, index, face);
    indices[index * 3] = face.GetValue(0);
    indices[index * 3 + 1] = face.GetValue(1);
    indices[index * 3 + 2] = face.GetValue(2);
  }

  draco.destroy(face);
  draco.destroy(dracoPositions);
  draco.destroy(mesh);
  draco.destroy(buffer);
  draco.destroy(decoder);
  return { positions, indices };
}

// ── Node transforms ──────────────────────────────────────────────────────────────────────────────

/** Row-major 4×4, applied as matrix · column vector. */
function nodeMatrix(node) {
  if (node.matrix) {
    // glTF stores matrices column-major; transpose into the layout multiply() expects.
    const m = node.matrix;
    return [
      m[0], m[4], m[8], m[12],
      m[1], m[5], m[9], m[13],
      m[2], m[6], m[10], m[14],
      m[3], m[7], m[11], m[15],
    ];
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy - wz) * sy, (xz + wy) * sz, tx,
    (xy + wz) * sx, (1 - (xx + zz)) * sy, (yz - wx) * sz, ty,
    (xz - wy) * sx, (yz + wx) * sy, (1 - (xx + yy)) * sz, tz,
    0, 0, 0, 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[row * 4 + k] * b[k * 4 + column];
      out[row * 4 + column] = sum;
    }
  }
  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ── The one thing this module is for ─────────────────────────────────────────────────────────────

/**
 * Every triangle in the file's default scene, in world space, as a flat
 * [ax,ay,az, bx,by,bz, cx,cy,cz, …].
 *
 * `skipMeshes` takes mesh INDICES (the numbers inspectGlb prints), for dropping a part that is in the
 * file but should not be in the drawing.
 */
export async function readWorldTriangles(path, skipMeshes = new Set()) {
  const { json, binary } = readGlb(path);
  const draco = await createDracoDecoder();
  const triangles = [];

  const walk = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex];
    const world = multiply(parent, nodeMatrix(node));

    if (node.mesh !== undefined && !skipMeshes.has(node.mesh)) {
      for (const primitive of json.meshes[node.mesh].primitives) {
        // Mode 4 is TRIANGLES. Nothing else contributes a surface.
        if ((primitive.mode ?? 4) !== 4) continue;

        const dracoExtension = primitive.extensions?.KHR_draco_mesh_compression;
        const { positions, indices } = dracoExtension
          ? decodeDracoPrimitive(draco, binary, json, dracoExtension)
          : {
              positions: readAccessor(json, binary, primitive.attributes.POSITION),
              indices: readAccessor(json, binary, primitive.indices),
            };

        for (let corner = 0; corner < indices.length; corner += 1) {
          const vertex = indices[corner] * 3;
          const x = positions[vertex];
          const y = positions[vertex + 1];
          const z = positions[vertex + 2];
          triangles.push(
            world[0] * x + world[1] * y + world[2] * z + world[3],
            world[4] * x + world[5] * y + world[6] * z + world[7],
            world[8] * x + world[9] * y + world[10] * z + world[11],
          );
        }
      }
    }
    for (const child of node.children ?? []) walk(child, world);
  };

  for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, IDENTITY);
  return new Float64Array(triangles);
}

/** The axis-aligned bounds of a triangle soup. */
export function boundsOf(triangles) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < triangles.length; vertex += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = triangles[vertex + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

/**
 * An orthographic view basis.
 *
 * Yaw turns around the model's up axis (Y); pitch lifts the eye above the horizon. `forward` points
 * from the model TOWARD the eye, and `right`/`up` are the screen axes the geometry projects onto.
 *
 * ⚠ Right-handed: `right × up === forward`. Getting this backwards mirrors the drawing, which on a
 * near-symmetric hull is invisible right up until it is composited over the real model.
 */
/**
 * The plan view — the eye directly overhead, the nose pointing up the frame.
 *
 * ⚠ Yaw 180 rather than 0. At pitch 90 the eye is overhead and yaw only rolls the picture; with the
 * right-handed basis above, yaw 0 puts the nose at the BOTTOM. (It appeared at the top under an
 * earlier left-handed basis, which was drawing the hull mirrored — invisible on a near-symmetric
 * fighter, which is exactly what makes it worth writing down.)
 *
 * Shared, because the silhouette SVG and the wireframe bake have to agree about which view the
 * drawing is of. They are two renderings of one decision.
 */
export const PLAN_VIEW = { yaw: 180, pitch: 90 };

export function orbitBasis(yawDegrees, pitchDegrees) {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const forward = [
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw),
  ];
  // Horizontal by construction, so it stays well-defined when pitch reaches ±90° and a
  // cross-with-world-up would collapse.
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [
    forward[1] * right[2] - forward[2] * right[1],
    forward[2] * right[0] - forward[0] * right[2],
    forward[0] * right[1] - forward[1] * right[0],
  ];
  return { right, up, forward };
}
