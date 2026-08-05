// Compresses the raw standalone textures (kept in /textures-src) into web-ready files in
// /public/textures. Re-runnable: it always reads the pristine source, so changing a quality setting
// and re-running never compounds compression artifacts.
//
// ── Why this is separate from optimizeModels.mjs ─────────────────────────────────────────────────
// That script drives gltf-transform, which only reaches textures EMBEDDED in a GLB. These files are
// sampled directly by the works field and the mark, so nothing in the model pipeline ever saw them —
// which is exactly how two 3.3 MB PNGs sat in `public/` unnoticed while every model texture was being
// capped at 1024² WebP. Same idea, different toolchain, so: same shape of script, its own file.
//
// Usage:
//   npm run optimize:textures                    → every source in /textures-src
//   npm run optimize:textures -- basalt-magma    → only the sources whose path contains this
//
// ── Why the sources are gitignored ──────────────────────────────────────────────────────────────
// Same reasoning as models-src: the lossless originals are build inputs, not site assets, and they are
// an order of magnitude larger than what ships. Unlike the models, though, these two were previously
// committed — so if /textures-src is ever lost, the originals are still recoverable from git history
// (they were removed in the same commit that added this script).

import { mkdirSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import sharp from 'sharp';

const SOURCE_DIRECTORY = 'textures-src';
const OUTPUT_DIRECTORY = 'public/textures';

// 1024² rather than the sources' 1254². Two reasons, and the second is the one that matters:
// it is a power of two (cleaner mip chain under the RepeatWrapping both of these use), and it drops
// each texture from ~8 MB of VRAM to ~5.3 MB. The mark tiles its surface 2.2× across a body a couple
// of hundred pixels tall, so nothing here is ever sampled near 1:1.
const MAX_SIZE = 1024;

// WebP quality. Measured on these two files: q72 ≈ 255 KB avg, q80 ≈ 320 KB, q86 ≈ 400 KB, q92 ≈ 515 KB.
//
// 86 is deliberately not the smallest. These are the works section's hero material — the body you
// orbit for four stops — and the difference between q80 and q86 costs ~160 KB against a page that was
// carrying 6.5 MB of PNG. Drop it if the load gate ever needs the room; the originals are kept
// precisely so that re-encoding at a different quality stays possible.
const QUALITY = 86;

// Higher = slower encode, smaller file, identical decode cost. This runs by hand, so buy the bytes.
const EFFORT = 6;

const filters = process.argv.slice(2);

function collectSources(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) collectSources(path, found);
    else if (/\.(png|jpe?g|webp)$/i.test(entry)) found.push(path);
  }
  return found;
}

if (!existsSync(SOURCE_DIRECTORY)) {
  console.error(
    `No ${SOURCE_DIRECTORY}/ directory.\n` +
      'The lossless sources are gitignored build inputs — recover them from git history (they were ' +
      'removed from public/textures when this script landed) and drop them back in here.',
  );
  process.exit(1);
}

const sources = collectSources(SOURCE_DIRECTORY).filter(
  (path) => filters.length === 0 || filters.some((filter) => path.includes(filter)),
);

if (sources.length === 0) {
  console.error(`No sources matched${filters.length ? ` ${filters.join(', ')}` : ''}.`);
  process.exit(1);
}

let sourceTotal = 0;
let outputTotal = 0;

for (const source of sources) {
  // Mirror the source's own sub-directory into public/textures, so a texture's path is the same on
  // both sides and the constants in the code do not have to know this script exists.
  const relativePath = relative(SOURCE_DIRECTORY, source);
  const outputPath = join(OUTPUT_DIRECTORY, relativePath).replace(/\.[^.]+$/, '.webp');
  mkdirSync(join(outputPath, '..'), { recursive: true });

  const image = sharp(source);
  const { width = 0, height = 0, hasAlpha } = await image.metadata();
  const encoded = await image
    // `inside` never enlarges and preserves aspect, so a source already under the cap passes through
    // at its own size rather than being blown up to 1024.
    .resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: EFFORT, alphaQuality: hasAlpha ? 100 : undefined })
    .toBuffer();

  writeFileSync(outputPath, encoded);

  const sourceBytes = statSync(source).size;
  sourceTotal += sourceBytes;
  outputTotal += encoded.length;

  const saved = (100 - (encoded.length / sourceBytes) * 100).toFixed(1);
  console.log(
    `${relativePath.split(sep).join('/')}\n` +
      `   ${width}×${height} ${(sourceBytes / 1048576).toFixed(2)} MB` +
      `  →  ${Math.min(width, MAX_SIZE)}² ${(encoded.length / 1024).toFixed(0)} KB webp q${QUALITY}` +
      `   (${saved}% smaller)`,
  );
}

console.log(
  `\n${sources.length} texture(s): ` +
    `${(sourceTotal / 1048576).toFixed(2)} MB → ${(outputTotal / 1048576).toFixed(2)} MB`,
);
