// The fleet, as four drawings — and one of them as a ship.
//
// The Services deck shows FOUR craft and builds only the LAST one. Stops 01–03 are drawings and never
// anything else; stop 04 gathers the same way, then turns out of plan view, wireframes and skins into
// the real hull. So this bakes:
//
//   · four 2D point clouds, one per craft, all the same length so a grain can travel from its place
//     in one drawing to its place in the next;
//   · the hero's 3D position for every one of those points, so its drawing can get its depth back;
//   · the hero's feature-edge segments, for the wireframe that draws itself between the grains.
//
// ── ⚠ Everything is baked in DECK UNITS, normalised exactly as prepareVessel normalises a hull ────
// A point is (rotation · p − centre) / largestDimension, so the craft's largest dimension spans 1 and
// the runtime multiplies by TARGET_SIZE. That is what makes the hero's drawing *be* its flattened
// hull rather than merely resemble it: the same centring and the same scale, so when the turn hands
// the grains their depth back they are already exactly where the model's geometry is.
//
// ⚠ It also means TARGET_SIZE must stay a RUNTIME constant. Baking it in would put a number in a
// binary that has to agree with a number in a TypeScript file, and nothing would check.
//
// ── The order of the points is load-bearing ──────────────────────────────────────────────────────
// Every shape is sorted into scan order — topmost ink first — so a grain holds roughly the same PART
// of every craft. Tops travel to tops. Without it a morph is 4 096 grains crossing each other at
// random, which reads as noise resolving into noise. (The loader's own bake does the same thing and
// its shader's comments say why: do not shuffle these to "spread them out".)
//
// Usage:
//   node scripts/buildFleetDrawings.mjs [previewDirectory]

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readWorldTriangles, boundsOf, orbitBasis, PLAN_VIEW } from './shipGeometry.mjs';
import { extractFeatureEdges } from './shipFeatureEdges.mjs';
import { coveragePng, rasterisePoints } from './previewImage.mjs';

const OUTPUT_BINARY = 'public/deck-drawings.bin';
const OUTPUT_MANIFEST = 'components/sections/ServicesDeck/deckDrawingsManifest.ts';

/**
 * The fleet, in DECK_SERVICES order.
 *
 * `rotation` is the model's own base orientation in DEGREES — the same correction the deck used to
 * apply per ship. It is applied BEFORE anything is measured, so every number downstream is in the
 * space the craft is actually seen in.
 *
 * `hero` marks the one craft that becomes a ship. Exactly one may be marked.
 */
const FLEET = [
  { name: 'web', path: 'public/models/spaceship.glb' },
  { name: 'mobile', path: 'public/models/spaceship3.glb' },
  { name: 'enterprise', path: 'public/models/cargo_spaceship.glb' },
  {
    name: 'ai',
    path: 'public/models/star_aventure_spaceship_starship_fighter.glb',
    // The hull imports facing the wrong way; the deck has always flipped it.
    rotation: { x: -180 },
    hero: true,
  },
];

/**
 * Points per drawing.
 *
 * Every shape carries the same count — that is what a morph needs — so this is sized for the BUSIEST
 * of them (the cargo hauler, 6 800 segments) rather than the cleanest (the shuttle, 614). Four shapes
 * plus the hero's third dimension is 4096 × (4×2 + 3) × 2 bytes = 90 KB on the wire.
 */
const POINTS_PER_SHAPE = 4096;

/** Hard cap on the hero's wireframe, longest chains first. ~66 KB at the shipped 5 531. */
const MAX_HERO_SEGMENTS = 9000;

const BINARY_MAGIC = 0x44583156; // "VX1D"
const BINARY_VERSION = 1;
const HEADER_BYTES = 24;
/** Int16 range. A stored axis is the deck-unit value, where the largest dimension spans 1. */
const COORDINATE_SCALE = 32767;

const PREVIEW_GRID = 900;
const PREVIEW_DOT = 1.1;

/** Where the readable record of each drawing is written, and how it is drawn. */
const SVG_DIRECTORY = 'deck-shapes-src';
const SVG_VIEWBOX = 1024;
const SVG_STROKE = 1.6;

/**
 * A fixed-seed generator, so re-running on unchanged models produces an identical file.
 *
 * Not a nicety: the output is committed, and a jitter seeded from Math.random() would rewrite 150 KB
 * of binary on every run and make every diff meaningless.
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 0x1000000) / 0x1000000;
  };
}

/** Rotate a vector by a degrees triple, X then Y then Z — matching three's default euler order. */
function rotateVector([x, y, z], rotation) {
  const rx = ((rotation?.x ?? 0) * Math.PI) / 180;
  const ry = ((rotation?.y ?? 0) * Math.PI) / 180;
  const rz = ((rotation?.z ?? 0) * Math.PI) / 180;
  let vx = x, vy = y, vz = z;
  // X
  let ty = vy * Math.cos(rx) - vz * Math.sin(rx);
  let tz = vy * Math.sin(rx) + vz * Math.cos(rx);
  vy = ty; vz = tz;
  // Y
  let tx = vx * Math.cos(ry) + vz * Math.sin(ry);
  tz = -vx * Math.sin(ry) + vz * Math.cos(ry);
  vx = tx; vz = tz;
  // Z
  tx = vx * Math.cos(rz) - vy * Math.sin(rz);
  ty = vx * Math.sin(rz) + vy * Math.cos(rz);
  vx = tx; vy = ty;
  return [vx, vy, vz];
}

function rotateTriangles(triangles, rotation) {
  if (!rotation) return triangles;
  const out = new Float64Array(triangles.length);
  for (let vertex = 0; vertex < triangles.length; vertex += 3) {
    const [x, y, z] = rotateVector(
      [triangles[vertex], triangles[vertex + 1], triangles[vertex + 2]],
      rotation,
    );
    out[vertex] = x;
    out[vertex + 1] = y;
    out[vertex + 2] = z;
  }
  return out;
}

/**
 * Spread `count` points over a segment set, weighted by PROJECTED length.
 *
 * ⚠ Projected, not 3D. A segment running nearly along the view axis has real length but almost no
 * extent in the drawing — weighted in 3D it would attract a crowd of grains into a few pixels. The
 * drawing is what the visitor sees, so the drawing is what the density has to be even over.
 *
 * ⚠ And walked as a cumulative distribution in equal steps rather than rejection-sampled: rejection
 * gives an even expectation with a visibly clumpy realisation, and clumps in a form made of dust read
 * as damage.
 */
function samplePoints(segments, segmentCount, basis, count) {
  const projectedLength = new Float64Array(segmentCount);
  const cumulative = new Float64Array(segmentCount);
  let total = 0;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const at = segment * 6;
    const dx =
      (segments[at + 3] - segments[at]) * basis.right[0] +
      (segments[at + 4] - segments[at + 1]) * basis.right[1] +
      (segments[at + 5] - segments[at + 2]) * basis.right[2];
    const dy =
      (segments[at + 3] - segments[at]) * basis.up[0] +
      (segments[at + 4] - segments[at + 1]) * basis.up[1] +
      (segments[at + 5] - segments[at + 2]) * basis.up[2];
    projectedLength[segment] = Math.hypot(dx, dy);
    total += projectedLength[segment];
    cumulative[segment] = total;
  }
  if (total === 0) throw new Error('every segment is edge-on to the view — is the angle degenerate?');

  const random = createRandom(0x9e3779b9);
  const points = new Float64Array(count * 3);
  let segment = 0;
  for (let point = 0; point < count; point += 1) {
    const wanted = ((point + random()) / count) * total;
    // The steps only increase, so the search resumes where the last one stopped.
    while (segment < segmentCount - 1 && cumulative[segment] < wanted) segment += 1;
    const at = segment * 6;
    const along = random();
    points[point * 3] = segments[at] + (segments[at + 3] - segments[at]) * along;
    points[point * 3 + 1] = segments[at + 1] + (segments[at + 4] - segments[at + 1]) * along;
    points[point * 3 + 2] = segments[at + 2] + (segments[at + 5] - segments[at + 2]) * along;
  }
  return points;
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────

const previewDirectory = process.argv[2];
const heroIndex = FLEET.findIndex((craft) => craft.hero);
if (heroIndex === -1) throw new Error('no craft is marked `hero` — one of them has to become a ship');

const drawings = [];
let heroData = null;

for (const [index, craft] of FLEET.entries()) {
  const raw = await readWorldTriangles(craft.path);
  // Into the space the craft is actually seen in, before anything is measured.
  const triangles = rotateTriangles(raw, craft.rotation);

  const bounds = boundsOf(triangles);
  const size = [0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis]);
  const centre = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
  const largestDimension = Math.max(...size);

  // The plan view, carried through the craft's own rotation so it means the same thing for a hull
  // that was imported upside down.
  const rawBasis = orbitBasis(PLAN_VIEW.yaw, PLAN_VIEW.pitch);
  const basis = {
    right: rotateVector(rawBasis.right, craft.rotation),
    up: rotateVector(rawBasis.up, craft.rotation),
    forward: rotateVector(rawBasis.forward, craft.rotation),
  };

  const { segments, segmentCount, counts, truncated } = extractFeatureEdges(
    triangles,
    largestDimension,
    basis.forward,
    MAX_HERO_SEGMENTS,
  );
  if (truncated) console.warn(`⚠ ${craft.name}: hit MAX_HERO_SEGMENTS — the chain tail was dropped.`);

  const sampled = samplePoints(segments, segmentCount, basis, POINTS_PER_SHAPE);

  // Into deck units, then into the drawing's own plane.
  const flat = [];
  for (let point = 0; point < POINTS_PER_SHAPE; point += 1) {
    const x = (sampled[point * 3] - centre[0]) / largestDimension;
    const y = (sampled[point * 3 + 1] - centre[1]) / largestDimension;
    const z = (sampled[point * 3 + 2] - centre[2]) / largestDimension;
    flat.push({
      // The drawing: the deck-unit point projected onto the view's two screen axes.
      drawX: x * basis.right[0] + y * basis.right[1] + z * basis.right[2],
      drawY: x * basis.up[0] + y * basis.up[1] + z * basis.up[2],
      solid: [x, y, z],
    });
  }

  // Scan order — topmost ink first, so a grain holds the same part of every craft.
  flat.sort((a, b) => (b.drawY - a.drawY) || (a.drawX - b.drawX));

  // The readable record: the same extraction as an SVG a human can open and judge the angle from.
  // ⚠ It is a RECORD, not a source — the field samples the point cloud above, and re-drawing this
  // file by hand would not change a single grain. See docs/services-particle-ship-plan.md §3.
  const svgPaths = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const at = segment * 6;
    const project = (offset) => {
      const x = (segments[at + offset] - centre[0]) / largestDimension;
      const y = (segments[at + offset + 1] - centre[1]) / largestDimension;
      const z = (segments[at + offset + 2] - centre[2]) / largestDimension;
      return [
        (x * basis.right[0] + y * basis.right[1] + z * basis.right[2] + 0.5) * SVG_VIEWBOX,
        (0.5 - (x * basis.up[0] + y * basis.up[1] + z * basis.up[2])) * SVG_VIEWBOX,
      ];
    };
    const [x1, y1] = project(0);
    const [x2, y2] = project(3);
    svgPaths.push(`M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`);
  }
  mkdirSync(SVG_DIRECTORY, { recursive: true });
  writeFileSync(
    join(SVG_DIRECTORY, `0${index + 1}-${craft.name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_VIEWBOX} ${SVG_VIEWBOX}" ` +
      `width="${SVG_VIEWBOX}" height="${SVG_VIEWBOX}">\n` +
      `  <path fill="none" stroke="#000000" stroke-width="${SVG_STROKE}" stroke-linecap="round" d="${svgPaths.join('')}"/>\n` +
      `</svg>\n`,
  );

  drawings.push({ name: craft.name, points: flat });
  console.log(
    `${craft.name.padEnd(11)} ${String(segmentCount).padStart(5)} segments ` +
      `(boundary ${counts.boundary} · crease ${counts.crease} · contour ${counts.contour}) ` +
      `→ ${POINTS_PER_SHAPE} points`,
  );

  if (index === heroIndex) {
    // The lift that puts the craft's base on y=0, in deck units — prepareVessel's own, so the
    // drawings and the hull sit at exactly the same height.
    const liftY = size[1] / largestDimension / 2;
    const heroSegments = new Float64Array(segmentCount * 6);
    for (let value = 0; value < segmentCount * 6; value += 1) {
      heroSegments[value] = (segments[value] - centre[value % 3]) / largestDimension;
    }
    heroData = {
      liftY,
      segments: heroSegments,
      segmentCount,
      // DORSAL points from the hull toward the eye; NOSE is screen-up. Rotating the craft until these
      // face the camera and point up reproduces the drawing exactly.
      dorsal: basis.forward,
      nose: basis.up,
      right: basis.right,
    };
  }
}

// ── The binary ──
// header: magic u32 · version u16 · shapeCount u16 · pointCount u32 · heroIndex u16 · pad u16 ·
//         heroSegmentCount u32 · reserved u32
// body:   shapeCount × pointCount × 2 int16   (the drawings)
//         pointCount × 3 int16                (the hero's depth)
//         heroSegmentCount × 6 int16          (the hero's wireframe)
const drawingValues = FLEET.length * POINTS_PER_SHAPE * 2;
const solidValues = POINTS_PER_SHAPE * 3;
const wireValues = heroData.segmentCount * 6;
const output = new ArrayBuffer(HEADER_BYTES + (drawingValues + solidValues + wireValues) * 2);

const header = new DataView(output);
header.setUint32(0, BINARY_MAGIC, true);
header.setUint16(4, BINARY_VERSION, true);
header.setUint16(6, FLEET.length, true);
header.setUint32(8, POINTS_PER_SHAPE, true);
header.setUint16(12, heroIndex, true);
header.setUint32(16, heroData.segmentCount, true);

const payload = new Int16Array(output, HEADER_BYTES);
const quantise = (value) => Math.max(-32768, Math.min(32767, Math.round(value * COORDINATE_SCALE)));

let cursor = 0;
for (const drawing of drawings) {
  for (const point of drawing.points) {
    payload[cursor] = quantise(point.drawX);
    payload[cursor + 1] = quantise(point.drawY);
    cursor += 2;
  }
}
for (const point of drawings[heroIndex].points) {
  payload[cursor] = quantise(point.solid[0]);
  payload[cursor + 1] = quantise(point.solid[1]);
  payload[cursor + 2] = quantise(point.solid[2]);
  cursor += 3;
}
for (let value = 0; value < wireValues; value += 1) {
  payload[cursor] = quantise(heroData.segments[value]);
  cursor += 1;
}

mkdirSync('public', { recursive: true });
writeFileSync(OUTPUT_BINARY, Buffer.from(output));

const vector = (values) => `[${values.map((value) => value.toFixed(6)).join(', ')}]`;
writeFileSync(
  OUTPUT_MANIFEST,
  `// GENERATED by scripts/buildFleetDrawings.mjs — do not edit.\n` +
    `// Re-run \`npm run build:drawings\` after changing the fleet or the extraction constants.\n` +
    `//\n` +
    `// The points live in ${OUTPUT_BINARY} and are fetched at runtime; only the facts a caller needs\n` +
    `// before the fetch lands are here. See deckDrawings.ts for the decoder.\n\n` +
    `export const DECK_DRAWINGS_URL = '/${OUTPUT_BINARY.split('/').pop()}';\n` +
    `export const DECK_DRAWINGS_MAGIC = ${BINARY_MAGIC};\n` +
    `export const DECK_DRAWINGS_VERSION = ${BINARY_VERSION};\n` +
    `export const DECK_DRAWINGS_HEADER_BYTES = ${HEADER_BYTES};\n` +
    `export const DECK_DRAWINGS_COORDINATE_SCALE = ${COORDINATE_SCALE};\n` +
    `export const DECK_DRAWINGS_POINTS = ${POINTS_PER_SHAPE};\n` +
    `export const DECK_DRAWINGS_SEGMENTS = ${heroData.segmentCount};\n` +
    `/** In DECK_SERVICES order. For logs and for nothing else. */\n` +
    `export const DECK_DRAWING_NAMES = [${drawings.map((d) => `'${d.name}'`).join(', ')}] as const;\n` +
    `\n` +
    `/**\n` +
    ` * The one craft that becomes a ship. Every other stop is a drawing and never anything else.\n` +
    ` */\n` +
    `export const DECK_HERO_INDEX = ${heroIndex};\n` +
    `\n` +
    `/**\n` +
    ` * Deck units: a stored coordinate is (rotated - centre) / largestDimension, so the craft's\n` +
    ` * largest dimension spans 1. Multiply by TARGET_SIZE and lift by TARGET_SIZE * DECK_HERO_LIFT_Y\n` +
    ` * to land exactly where prepareVessel puts the hull.\n` +
    ` */\n` +
    `export const DECK_HERO_LIFT_Y = ${heroData.liftY.toFixed(6)};\n` +
    `\n` +
    `/**\n` +
    ` * The plan view, in the same space.\n` +
    ` *\n` +
    ` * DORSAL points from the hull toward the eye and NOSE is screen-up — rotate the craft until these\n` +
    ` * two axes face the camera and point up and you have reproduced the drawing exactly.\n` +
    ` */\n` +
    `export const DECK_PLAN_DORSAL = ${vector(heroData.dorsal)} as const;\n` +
    `export const DECK_PLAN_NOSE = ${vector(heroData.nose)} as const;\n` +
    `/**\n` +
    ` * The drawing plane's other axis — screen-right; a point's stored drawX runs along it.\n` +
    ` *\n` +
    ` * With NOSE this spans the plane every drawing lives in, and the three of them are orthonormal.\n` +
    ` * So drawX·RIGHT + drawY·NOSE is the same thing as "the hero's 3D point with its DORSAL component\n` +
    ` * removed" — which is why the hero's drawing IS its flattened hull rather than a copy of it.\n` +
    ` */\n` +
    `export const DECK_PLAN_RIGHT = ${vector(heroData.right)} as const;\n`,
);

console.log(
  `\n${FLEET.length} drawings + ${heroData.segmentCount} hero segments → ${OUTPUT_BINARY} ` +
    `(${(output.byteLength / 1024).toFixed(1)} KB) + ${OUTPUT_MANIFEST}`,
);

// ── Previews ──
// Every drawing as the POINT CLOUD the field will actually hold, not as the lines it came from —
// because the sampling density is the thing most likely to be wrong, and lines cannot show it.
if (previewDirectory) {
  mkdirSync(previewDirectory, { recursive: true });
  for (const drawing of drawings) {
    const flat = new Float64Array(POINTS_PER_SHAPE * 2);
    for (const [index, point] of drawing.points.entries()) {
      // Deck units are ±0.5 at the largest dimension; centre them in the frame.
      flat[index * 2] = (point.drawX + 0.5) * PREVIEW_GRID;
      flat[index * 2 + 1] = (0.5 - point.drawY) * PREVIEW_GRID;
    }
    writeFileSync(
      join(previewDirectory, `drawing-${drawing.name}.png`),
      coveragePng(rasterisePoints(flat, PREVIEW_DOT, PREVIEW_GRID), PREVIEW_GRID),
    );
  }
  console.log(`previews → ${previewDirectory}`);
}
