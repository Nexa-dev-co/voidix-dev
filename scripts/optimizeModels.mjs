// Compresses the raw GLBs (kept in /models-src) into web-ready GLBs in /public/models.
// Re-runnable: it always reads the pristine source, so tuning a setting and re-running never
// compounds compression artifacts.
//
// The raw Sketchfab exports ship 4K PNG textures (~90 MB of VRAM *each*) and junk UV channels. The
// Services section loads all four ships at once, so the real budget is GPU memory, not just download
// size — hence the hard cap on texture resolution below.
//
// Usage:
//   npm run optimize:models                 → every source in /models-src
//   npm run optimize:models -- chamber.glb  → only the sources you name
//
// Name the sources explicitly when you only mean to (re)build one. Reprocessing a model you didn't
// intend to touch re-encodes textures and geometry that were already lossily compressed once.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DIRECTORY = "models-src";
const OUTPUT_DIRECTORY = "public/models";

// 1024² keeps each texture at ~5.6 MB VRAM (vs ~90 MB at 4K) — invisible on
// ships that never fill the screen. WebP collapses the PNG bloat on disk.
const DISPLAY_TEXTURE_SIZE = 1024;
const TEXTURE_FORMAT = "webp";
const GEOMETRY_COMPRESSION = "draco";

// Textures on a model whose maps are never sampled (see the meteor recipe) — crushed to nothing
// rather than merely capped.
const GEOMETRY_ONLY_TEXTURE_SIZE = 8;

// Per-model treatment. Anything not listed here gets the defaults: DISPLAY_TEXTURE_SIZE, geometry
// simplification on, and one output keeping its source filename.
const MODEL_RECIPES = {
  "meteor.glb": {
    // Loaded for its GEOMETRY ONLY — the works field skins the mesh with its own textures
    // (public/textures/meteor/*), so the model's baked-in PBR maps are never sampled and are pure
    // dead weight. Drops it from ~70 MB to ~65 KB.
    textureSizes: [GEOMETRY_ONLY_TEXTURE_SIZE],
  },

  // NOT CURRENTLY SHIPPED — the reveal's set was rebuilt around the podium + table, so nothing loads
  // the cloning-tank room or the sci-fi screen bezel any more. The recipes stay because the sources do:
  // `npm run optimize:models -- cloning_tank_chamber_jfg_-_roblox_pbr_showcase.glb` puts them back.
  "cloning_tank_chamber_jfg_-_roblox_pbr_showcase.glb": {
    outputName: "chamber",
    // Every one of its 36 maps is already 1024², so a 1024 cap resizes nothing and leaves ~192 MB of
    // VRAM resident. That is far too much to force on every machine — and a resize is the ONLY thing
    // that can claw it back, because the adaptive-resolution controller scales the framebuffer, not
    // textures. So it ships at two tiers and the runtime picks one from measured frame times:
    //   512  → ~48 MB VRAM   (the default; the room is dim and mostly seen at a distance)
    //   1024 → ~192 MB VRAM  (only where the GPU has demonstrated the headroom)
    textureSizes: [512, 1024],
    // 6,952 verts for the entire room — there is nothing worth reclaiming by decimating it, and
    // plenty to lose: simplification rounds off the long flat walls and hard edges this model is made
    // of. The whole win here is in the textures.
    simplify: false,
  },

  "sci-fi_screen_-_3d_model.glb": {
    outputName: "screen",
    // 497 verts, and it's a bezel the camera ends up looking straight at — decimating it would visibly
    // round its corners for no meaningful saving.
    simplify: false,
  },

  "scifi_showcase_podium.glb": {
    outputName: "podium",
    // All 27 of its maps are 4096² — 138 MB of texture, and ~2.3 GB of VRAM if you load it as it ships.
    // That is not a "heavy model", it's an unusable one: no GPU on the site's budget survives it. The
    // cap is doing ALL of the work here (512 → ~36 MB, 1024 → ~144 MB); its geometry is a rounding error
    // by comparison, so it ships at two tiers like the chamber and the runtime picks from measured frames.
    textureSizes: [512, 1024],
    // 144k verts across rings, cables and a turbine — decimation would visibly chew the concentric rings,
    // and Draco already collapses this to almost nothing.
    simplify: false,
  },

  "sci-fi_table.glb": {
    outputName: "table",
    // The mirror image of the podium: one small 1024×512 map, and ~10 MB of raw GEOMETRY across 33
    // meshes. Nothing for the texture cap to do; Draco is the whole win.
    simplify: false,
  },
};

function formatMegabytes(byteCount) {
  return `${(byteCount / 1024 / 1024).toFixed(2)} MB`;
}

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

const requestedFileNames = process.argv.slice(2);
const availableFileNames = readdirSync(SOURCE_DIRECTORY).filter((fileName) =>
  fileName.endsWith(".glb"),
);

for (const requested of requestedFileNames) {
  if (!availableFileNames.includes(requested)) {
    console.error(`✗ no such source: ${join(SOURCE_DIRECTORY, requested)}`);
    process.exit(1);
  }
}

const sourceFileNames = requestedFileNames.length
  ? requestedFileNames
  : availableFileNames;

for (const fileName of sourceFileNames) {
  const recipe = MODEL_RECIPES[fileName] ?? {};
  const textureSizes = recipe.textureSizes ?? [DISPLAY_TEXTURE_SIZE];
  const baseName = recipe.outputName ?? fileName.replace(/\.glb$/, "");
  const isTiered = textureSizes.length > 1;

  const inputPath = join(SOURCE_DIRECTORY, fileName);
  const sizeBefore = statSync(inputPath).size;

  for (const textureSize of textureSizes) {
    // A tiered model needs the tier in its name so both variants can sit side by side; a single-output
    // model keeps a clean name.
    const outputFileName = isTiered
      ? `${baseName}-${textureSize}.glb`
      : `${baseName}.glb`;
    const outputPath = join(OUTPUT_DIRECTORY, outputFileName);

    execFileSync(
      "npx",
      [
        "--yes",
        "@gltf-transform/cli@latest",
        "optimize",
        inputPath,
        outputPath,
        "--texture-size",
        String(textureSize),
        "--texture-compress",
        TEXTURE_FORMAT,
        "--compress",
        GEOMETRY_COMPRESSION,
        "--simplify",
        String(recipe.simplify ?? true),
      ],
      { stdio: "inherit", shell: true },
    );

    const sizeAfter = statSync(outputPath).size;
    const reduction = (100 * (1 - sizeAfter / sizeBefore)).toFixed(1);
    console.log(
      `\n✓ ${fileName} → ${outputFileName}: ${formatMegabytes(
        sizeBefore,
      )} → ${formatMegabytes(sizeAfter)}  (−${reduction}%)\n`,
    );
  }
}
