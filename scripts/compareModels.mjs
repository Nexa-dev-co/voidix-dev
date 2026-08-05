// Compares two GLBs on the properties the RUNTIME reads by name or by position.
//
// A re-encoded model must be the SAME model at a different resolution — not a different model.
// Four things in these files are load-bearing beyond how they look, and every one of them can be
// changed silently by a gltf-transform pass (`join` merges meshes, `dedup` collapses materials,
// `flatten` deletes parent nodes):
//
//   mesh/primitive count + order  → deckTuning's `hiddenParts` addresses meshes by POSITIONAL id
//   material names                → SunModelCanvas + singularityScene look up 'flare', REDSHIFT_MATERIAL
//   node names                    → 'Sphere_0_cell*' (the ten shards), getObjectByName('black hole')
//   texture slot structure        → a tier that PRUNES a slot forces a shader recompile on swap
//
// Usage: node scripts/compareModels.mjs before.glb after.glb

import { readFileSync } from 'node:fs';

function readGlb(path) {
  const buffer = readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  return {
    document: JSON.parse(buffer.slice(20, 20 + jsonLength).toString('utf8')),
    byteLength: buffer.length,
  };
}

function describe(document) {
  const primitives = [];
  let vertexCount = 0;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      primitives.push(`${mesh.name ?? '?'}/${primitive.material ?? '-'}`);
      vertexCount += document.accessors?.[primitive.attributes?.POSITION]?.count ?? 0;
    }
  }
  // Texture slots per material, so a pruned map is visible rather than merely smaller.
  const slots = (document.materials ?? []).map((material) => {
    const pbr = material.pbrMetallicRoughness ?? {};
    return [
      pbr.baseColorTexture && 'base',
      pbr.metallicRoughnessTexture && 'mr',
      material.occlusionTexture && 'ao',
      material.normalTexture && 'nrm',
      material.emissiveTexture && 'em',
    ]
      .filter(Boolean)
      .join('+');
  });
  return {
    primitives,
    vertexCount,
    materialNames: (document.materials ?? []).map((material) => material.name ?? '(unnamed)'),
    nodeNames: (document.nodes ?? []).map((node) => node.name ?? '(unnamed)'),
    slots,
  };
}

const [beforePath, afterPath] = process.argv.slice(2);
const before = readGlb(beforePath);
const after = readGlb(afterPath);
const a = describe(before.document);
const b = describe(after.document);

const failures = [];
const check = (label, left, right) => {
  const same = JSON.stringify(left) === JSON.stringify(right);
  if (!same) failures.push(label);
  console.log(`  ${same ? '✓' : '✗'} ${label}`);
  if (!same) {
    console.log(`      before: ${JSON.stringify(left)}`);
    console.log(`      after:  ${JSON.stringify(right)}`);
  }
};

console.log(`\n${beforePath}  →  ${afterPath}`);
check('primitive count + order', a.primitives, b.primitives);
check('material names', a.materialNames, b.materialNames);
check('node names', a.nodeNames, b.nodeNames);
check('texture slots per material', a.slots, b.slots);

const sizeChange = (100 * (after.byteLength / before.byteLength - 1)).toFixed(1);
const vertexChange = (100 * (b.vertexCount / a.vertexCount - 1)).toFixed(1);
console.log(
  `\n  size    ${(before.byteLength / 1024).toFixed(0)} KB → ${(after.byteLength / 1024).toFixed(0)} KB  (${sizeChange}%)` +
    `\n  verts   ${a.vertexCount.toLocaleString()} → ${b.vertexCount.toLocaleString()}  (${vertexChange}%)`,
);
console.log(failures.length ? `\n  ⚠ ${failures.length} INVARIANT(S) BROKEN\n` : '\n  all invariants held\n');
process.exit(failures.length ? 1 : 0);
