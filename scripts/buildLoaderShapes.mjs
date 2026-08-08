// Bakes the loader's held forms: an SVG in, a point cloud out.
//
// ── Why the shapes are DATA and not a function ───────────────────────────────────────────────────
// `gatherShader.ts` used to carry three forms — a star shell, a black-hole annulus, a galaxy spiral —
// as closed-form functions of a particle's own seed. No buffers, no CPU per frame, and genuinely
// elegant. It is also the reason those were the only three forms that could ever exist: there is no
// function that turns a random seed into "a point inside this drawing". So the forms become a baked
// point cloud, uploaded once, and the shader interpolates between them.
//
// ── Why sharp rather than parsing the path data ──────────────────────────────────────────────────
// Because an SVG is not its `d` attribute. These sources carry nested groups, transforms, arcs and
// even-odd fills, and a hand-written flattener would handle the first file and quietly mis-draw the
// second. sharp is ALREADY a devDependency (optimizeTextures.mjs uses it) and renders through
// librsvg, so every one of those is somebody else's solved problem. We read the alpha channel it
// produces and never look at the markup at all.
//
// Usage:
//   npm run build:shapes                 → every SVG in /loader-shapes-src, in filename order
//
// ── The output goes to public/, not into a module ────────────────────────────────────────────────
// Base64 in a TS file would put ~90 KB of incompressible payload into the LOADER's own chunk — the
// one piece of JavaScript on this site that has to download before anything can be drawn at all. A
// binary in public/ is fetched by the worker alongside the models, lands in a fraction of a second,
// and until it does the field simply streams as it always did. See loaderShapes.ts.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';

const SOURCE_DIRECTORY = 'loader-shapes-src';
const OUTPUT_BINARY = 'public/loader-shapes.bin';
const OUTPUT_MANIFEST = 'components/effects/IntroSequence/loaderShapeManifest.ts';

/**
 * ⚠ FOUR IS A HARD LIMIT, and it is a limit of the RUNTIME, not of this script.
 *
 * Every particle carries its target position in every shape as a vertex attribute, packed two shapes
 * to a `vec4` (see gatherRenderer). Four shapes is two attributes on top of the one the field already
 * had — three of a guaranteed sixteen. A fifth needs the targets to move into a data texture read by
 * the VERTEX shader, and vertex texture units are only guaranteed on WebGL2 while this field keeps a
 * WebGL1 fallback path. So this fails loudly rather than silently dropping the fifth file.
 */
const MAX_SHAPES = 4;

/**
 * Points sampled per shape.
 *
 * The field draws tens of thousands of grains against this, so a point is a place several grains
 * cluster around rather than one grain's home — which is what makes a form read as dust settling into
 * a shape instead of as a plotted outline. 4096 is sized for the LINE ART these sources are: a filled
 * silhouette would read at half this, but a 2%-of-width stroke spread over 4096 points is what keeps
 * the lines continuous rather than dotted.
 *
 * Cost is 4096 × 2 × 2 bytes = 16 KB per shape on the wire.
 */
const POINTS_PER_SHAPE = 4096;

/**
 * The alpha map's resolution.
 *
 * Only the sampling grid — nothing is ever displayed at this size. It wants to be fine enough that a
 * thin stroke is several pixels wide (these sources draw at ~2% of the viewBox, so ~20 px here) and
 * no finer, because every extra pixel is CDF the script walks at build time for no visible gain.
 */
const RASTER_SIZE = 1024;

/** Rasterise well above RASTER_SIZE and let the downscale antialias it, so thin strokes keep weight. */
const RENDER_DENSITY = 400;

/** Below this the pixel is background. Kept low: the feathered edge of a stroke is still the stroke. */
const ALPHA_FLOOR = 8;

const BINARY_MAGIC = 0x56583148; // "VX1H"
const BINARY_VERSION = 1;
const HEADER_BYTES = 16;
/** Int16 range, so a normalised −1..1 coordinate survives the round trip to within 1/32767. */
const COORDINATE_SCALE = 32767;

/**
 * A fixed-seed generator, so re-running this script on unchanged sources produces an identical file.
 *
 * Not a nicety: the output is committed, and a jitter seeded from `Math.random()` would rewrite 64 KB
 * of binary on every run and make every diff meaningless.
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    // xorshift32 — no dependency, and far better distributed than a bare LCG's low bits, which is
    // what the sub-pixel jitter below actually consumes.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 0x1000000) / 0x1000000;
  };
}

/**
 * Turn one alpha map into `POINTS_PER_SHAPE` points spread evenly over the INKED AREA.
 *
 * ⚠ Stratified over a cumulative distribution, not rejection-sampled. Rejection sampling gives an even
 * expectation and a visibly clumpy realisation — and clumps in a form made of dust read as damage.
 * Walking a CDF in equal steps guarantees the points are spread by area, with only the sub-pixel
 * jitter left random.
 */
function samplePoints(alpha, width, height) {
  // ── 1 · the cumulative distribution, weighted by coverage ──
  // Weighted rather than thresholded, so a stroke's antialiased edge attracts proportionally fewer
  // points than its solid centre and the sampled shape keeps the drawing's own weight.
  const cumulative = new Float64Array(width * height);
  let total = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const coverage = alpha[pixel] >= ALPHA_FLOOR ? alpha[pixel] / 255 : 0;
    total += coverage;
    cumulative[pixel] = total;
    if (coverage > 0) {
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (total === 0) throw new Error('rendered to nothing — is the SVG empty, or all stroke-none?');

  // ── 2 · the bounding box, so every shape arrives the same size ──
  // Fitted to the LARGER side and applied to both, so a wide shape stays wide. Normalising each axis
  // independently would stretch the meteor's diagonal into a square and nobody would know why.
  const inkWidth = maxX - minX + 1;
  const inkHeight = maxY - minY + 1;
  const extent = Math.max(inkWidth, inkHeight) / 2;
  const centreX = (minX + maxX + 1) / 2;
  const centreY = (minY + maxY + 1) / 2;

  // ── 3 · walk the distribution in equal steps ──
  const random = createRandom(0x9e3779b9);
  const points = new Int16Array(POINTS_PER_SHAPE * 2);
  let pixel = 0;
  for (let index = 0; index < POINTS_PER_SHAPE; index += 1) {
    const wanted = ((index + random()) / POINTS_PER_SHAPE) * total;
    // The steps only ever increase, so the search resumes where the last one stopped: the whole walk
    // is one pass over the image rather than POINTS_PER_SHAPE binary searches through it.
    while (pixel < cumulative.length - 1 && cumulative[pixel] < wanted) pixel += 1;
    const x = pixel % width;
    const y = (pixel - x) / width;
    const jitteredX = x + random();
    const jitteredY = y + random();
    // Y flips: an image counts downward and the field's space counts up.
    points[index * 2] = Math.round(((jitteredX - centreX) / extent) * COORDINATE_SCALE);
    points[index * 2 + 1] = Math.round((-(jitteredY - centreY) / extent) * COORDINATE_SCALE);
  }
  return { points, inkWidth, inkHeight, coverage: total / (width * height) };
}

async function readAlpha(path) {
  const { data, info } = await sharp(path, { density: RENDER_DENSITY })
    .resize(RASTER_SIZE, RASTER_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const alpha = new Uint8Array(info.width * info.height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    alpha[pixel] = data[pixel * info.channels + info.channels - 1];
  }
  return { alpha, width: info.width, height: info.height };
}

if (!existsSync(SOURCE_DIRECTORY)) {
  console.error(
    `No ${SOURCE_DIRECTORY}/ directory.\n` +
      'Drop the SVGs there, numbered for the order you want them to cycle in (01-…, 02-…).',
  );
  process.exit(1);
}

const sources = readdirSync(SOURCE_DIRECTORY)
  .filter((entry) => /\.svg$/i.test(entry))
  .sort();

if (sources.length === 0) {
  console.error(`${SOURCE_DIRECTORY}/ has no .svg files in it.`);
  process.exit(1);
}
if (sources.length > MAX_SHAPES) {
  console.error(
    `${sources.length} SVGs, but the field can only carry ${MAX_SHAPES}.\n` +
      'Each shape is half a vertex attribute per particle — see MAX_SHAPES in this file for what a ' +
      'fifth would cost. Remove one, or move the targets to a data texture first.',
  );
  process.exit(1);
}

const names = [];
const shapeBuffers = [];

for (const entry of sources) {
  const path = join(SOURCE_DIRECTORY, entry);
  const { alpha, width, height } = await readAlpha(path);
  const { points, inkWidth, inkHeight, coverage } = samplePoints(alpha, width, height);
  const name = basename(entry, '.svg').replace(/^\d+[-_]?/, '');
  names.push(name);
  shapeBuffers.push(points);
  console.log(
    `${entry.padEnd(28)} → ${name.padEnd(14)} ` +
      `ink ${String(inkWidth).padStart(4)}×${String(inkHeight).padStart(4)} ` +
      `· ${(coverage * 100).toFixed(1)}% covered · ${POINTS_PER_SHAPE} points`,
  );
}

// ── The binary ──
// header: magic u32 · version u16 · shapeCount u16 · pointCount u32 · reserved u32
// body:   shapeCount × (pointCount × 2 × int16), normalised −1..1 × COORDINATE_SCALE
const body = shapeBuffers.length * POINTS_PER_SHAPE * 2 * 2;
const output = new ArrayBuffer(HEADER_BYTES + body);
const header = new DataView(output);
header.setUint32(0, BINARY_MAGIC, true);
header.setUint16(4, BINARY_VERSION, true);
header.setUint16(6, shapeBuffers.length, true);
header.setUint32(8, POINTS_PER_SHAPE, true);
const payload = new Int16Array(output, HEADER_BYTES);
shapeBuffers.forEach((points, shape) => payload.set(points, shape * POINTS_PER_SHAPE * 2));

mkdirSync('public', { recursive: true });
writeFileSync(OUTPUT_BINARY, Buffer.from(output));

writeFileSync(
  OUTPUT_MANIFEST,
  `// GENERATED by scripts/buildLoaderShapes.mjs — do not edit.\n` +
    `// Re-run \`npm run build:shapes\` after changing anything in /${SOURCE_DIRECTORY}.\n` +
    `//\n` +
    `// The points themselves live in ${OUTPUT_BINARY} and are fetched at runtime; only the facts the\n` +
    `// renderer needs before the fetch lands are here, so this stays a handful of bytes in the loader's\n` +
    `// own chunk. See loaderShapes.ts for the decoder.\n\n` +
    `export const LOADER_SHAPES_URL = '/${basename(OUTPUT_BINARY)}';\n` +
    `export const LOADER_SHAPE_MAGIC = ${BINARY_MAGIC};\n` +
    `export const LOADER_SHAPE_VERSION = ${BINARY_VERSION};\n` +
    `export const LOADER_SHAPE_HEADER_BYTES = ${HEADER_BYTES};\n` +
    `export const LOADER_SHAPE_COORDINATE_SCALE = ${COORDINATE_SCALE};\n` +
    `/** The most the shader can carry — see MAX_SHAPES in the build script. */\n` +
    `export const LOADER_SHAPE_MAX = ${MAX_SHAPES};\n` +
    `/** In cycle order, which is filename order. For logs and for nothing else. */\n` +
    `export const LOADER_SHAPE_NAMES = [${names.map((name) => `'${name}'`).join(', ')}] as const;\n`,
);

console.log(
  `\n${shapeBuffers.length} shapes → ${OUTPUT_BINARY} ` +
    `(${((HEADER_BYTES + body) / 1024).toFixed(1)} KB) + ${OUTPUT_MANIFEST}`,
);
