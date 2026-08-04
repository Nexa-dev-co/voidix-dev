// Decimates the geometry of models that carry far more vertices than they can show, and re-applies
// Draco. Textures are never touched.
//
// ── Why this is separate from optimizeModels.mjs ─────────────────────────────────────────────────
// That script runs `optimize`, which RE-ENCODES every texture. These models' pristine sources are
// gone (see below), so the only inputs available are already-lossy 1024² WebP — and running them
// through a texture encoder again would compound the loss for no reason, since this pass has nothing
// to say about textures. `simplify` + `draco` touch geometry alone, which is the whole job here.
//
// ── ⚠ Where the inputs come from, and why they are not `models-src/` proper ──────────────────────
// `models-src/` holds the pristine Sketchfab exports — for the two models that still have one. The
// other five were never committed (the directory is gitignored) and are gone. `models-src/from-public`
// is a copy of the SHIPPED, already-optimized GLBs, taken 2026-08-04 so that this pass has a stable
// input that re-running it cannot compound: it always reads that copy, never its own output.
//
// They are also still in git under `public/models`, which is the real safety net if the working copy
// is ever lost.
//
// Usage:
//   node scripts/trimGeometry.mjs                → every model with a recipe below
//   node scripts/trimGeometry.mjs black_hole.glb → only the ones you name

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE_DIRECTORY = 'models-src/from-public';
const OUTPUT_DIRECTORY = 'public/models';

// How far the simplifier is allowed to move a vertex, as a fraction of the mesh's radius.
//
// This is the real safety rail, not `ratio`. meshoptimizer treats the ratio as a TARGET and the error
// as a LIMIT — it stops at whichever it reaches first. At 0.001 every recipe below asked for 0.5 and
// got between 0.60 and 0.77, because the simplifier refused to go further without visibly moving the
// silhouette. That is the correct direction to be wrong in: raise it only with the model on screen.
const MAX_ERROR = 0.001;

// Per-model treatment. A model absent from here is not decimated at all — which is the right default
// for nearly everything on this site, and the reason `optimizeModels.mjs` sets `simplify: false`
// almost everywhere. Each entry has to justify itself.
const GEOMETRY_RECIPES = {
  'table.glb': {
    ratio: 0.5,
    // 196,997 vertices for a table. It sits under the chamber's display, is only ever seen at an
    // oblique angle in a dim room, and is never the subject of a shot. Its textures are already
    // trivial (2.7 MB resident, one 1024×512 map plus a 32×4 palette strip) — geometry is the whole
    // of its cost, and it is the one model on the site whose vertex count cannot be justified at any
    // tier.
    why: 'a table, at an angle, in a dim room',
  },
  'black_hole.glb': {
    ratio: 0.5,
    // 368,063 vertices — the heaviest mesh on the site, for something on screen for about four
    // seconds at the very end, viewed THROUGH a lensing shader that bends it. `optimizeModels.mjs`
    // warns that decimation visibly chews its concentric rings, which is why MAX_ERROR is doing the
    // deciding here rather than the ratio.
    //
    // ⚠ Its `flatten: false` matters as much as ever: `singularityScene.ts:1155` still calls
    // `getObjectByName('black hole')` to centre the model, and flattening deletes that parent node.
    // Nothing in this pass flattens, and the assertion below would catch it if it did.
    why: 'four seconds on screen, behind a lens',
  },
};

// The properties the runtime reads by name or by position. If a pass changes any of them it has
// produced a different model, not a smaller one, and the output must not be shipped.
const COMPARE_SCRIPT = 'scripts/compareModels.mjs';

function formatKilobytes(byteCount) {
  return `${(byteCount / 1024).toFixed(0)} KB`;
}

function runTransform(args) {
  execFileSync('npx', ['--yes', '@gltf-transform/cli@latest', ...args], {
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: true,
  });
}

const requestedFileNames = process.argv.slice(2);
const recipeFileNames = Object.keys(GEOMETRY_RECIPES);

for (const requested of requestedFileNames) {
  if (!recipeFileNames.includes(requested)) {
    console.error(`✗ no geometry recipe for ${requested} — add one to GEOMETRY_RECIPES first`);
    process.exit(1);
  }
}

const fileNames = requestedFileNames.length ? requestedFileNames : recipeFileNames;
mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

for (const fileName of fileNames) {
  const recipe = GEOMETRY_RECIPES[fileName];
  const inputPath = join(SOURCE_DIRECTORY, fileName);
  const outputPath = join(OUTPUT_DIRECTORY, fileName);

  // Two scratch files: `simplify` writes uncompressed geometry (it had to decode Draco to touch the
  // mesh at all), so the intermediate is several times larger than either end of this pipeline.
  const simplifiedPath = join(tmpdir(), `${fileName}.simplified.glb`);
  const compressedPath = join(tmpdir(), `${fileName}.compressed.glb`);

  const sizeBefore = statSync(inputPath).size;
  console.log(`\n── ${fileName} — ${recipe.why}`);

  try {
    runTransform([
      'simplify',
      inputPath,
      simplifiedPath,
      '--ratio',
      String(recipe.ratio),
      '--error',
      String(MAX_ERROR),
    ]);
    // Re-apply Draco with the CLI's defaults, which is what `optimizeModels.mjs --compress draco`
    // used on the way in — so the output is quantized exactly as the input was.
    runTransform(['draco', simplifiedPath, compressedPath]);

    // ⚠ Assert BEFORE publishing. A pass that renamed a material or renumbered a mesh must never
    // reach public/models, because nothing downstream would notice until a section silently lost its
    // star or hid the wrong part of a hull.
    execFileSync('node', [COMPARE_SCRIPT, inputPath, compressedPath], { stdio: 'inherit' });

    copyFileSync(compressedPath, outputPath);
    const sizeAfter = statSync(outputPath).size;
    console.log(
      `  → ${OUTPUT_DIRECTORY}/${fileName}: ${formatKilobytes(sizeBefore)} → ${formatKilobytes(sizeAfter)}`,
    );
  } finally {
    rmSync(simplifiedPath, { force: true });
    rmSync(compressedPath, { force: true });
  }
}
