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
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
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
    // Keep the meshes SEPARATE. Joining merges every mesh that shares a material into one, which fused
    // the three concentric rings into a single object — and the innermost one has to spin on its own.
    // Costs a few draw calls on a model that is 7 of them.
    join: false,
  },

  "sci-fi_table.glb": {
    outputName: "table",
    // The mirror image of the podium: one small 1024×512 map, and ~10 MB of raw GEOMETRY across 33
    // meshes. Nothing for the texture cap to do; Draco is the whole win.
    simplify: false,
  },

  "fractured_sun.glb": {
    // 46 MB against just 10,023 vertices — the weight is ENTIRELY textures (five 2048² PNGs, one of them
    // 22 MB on its own). The size cap plus WebP is the whole win here; geometry is a rounding error.
    //
    // flatten would be catastrophic: the ten fracture shards are Groups at the SCENE ROOT named
    // Sphere_0_cell*, and computeCellSpread() finds them with
    // `root.children.filter(c => c.name.startsWith("Sphere_0_cell"))`. Collapse that hierarchy and the
    // entire fracture/spread/collapse system silently stops working.
    flatten: false,
    // Joining merges meshes that share a material, which would fuse shards together AND renumber every
    // registry id — orphaning every saved snapshot in the lab's localStorage.
    join: false,
    // 10k verts total across 50 meshes. Nothing to reclaim, and decimation would visibly round the
    // shards' fracture edges — the one silhouette this model exists for.
    simplify: false,
    // GPU instancing collapses the repeated flares/planes into shared InstancedMeshes — which took the
    // model from 50 meshes to 36. The lab selects and edits each mesh INDIVIDUALLY, and InstancedMesh
    // extends Mesh, so the registry would happily accept them and then move every copy at once. It also
    // renumbers the ids that saved snapshots are keyed on.
    instance: false,
  },

  "champion_astro_ring.glb": {
    // The services deck's new landing pad, and its own authoring tool at /pad-lab. It is not scenery:
    // every part is individually posed, tinted and lit from that panel, and the ring is meant to spin
    // on its own — so the three passes that would take that control away are all off.
    //
    // flatten bakes each node's transform down into its mesh, which moves a part's PIVOT to the scene
    // origin. A ring whose pivot is no longer at its own centre does not spin, it orbits — and this
    // model's ring stands vertically across a 366-unit span, so that error is enormous rather than
    // subtle.
    flatten: false,
    // Two pairs of meshes share a material here (c_sd_meatcleaver and c_sd_Meatcleaver_on). Joining
    // merges each pair into one object, which would weld the lit and unlit halves of the prop
    // together and drop the mesh count from 9 to 7 — losing two of the parts the panel addresses.
    join: false,
    // InstancedMesh extends Mesh, so a registry accepts it and then transforms every copy at once.
    // The same trap the fractured sun hit.
    instance: false,
    // 26k verts across rings and trim. Decimation visibly chews concentric rings (it did on the
    // podium), and Draco already does the real work — the weight here is textures, not geometry.
    simplify: false,
  },

  "black_hole.glb": {
    // An old Sketchfab export whose materials live ENTIRELY inside KHR_materials_pbrSpecularGlossiness.
    // three.js dropped that extension in r151, so loading it raw gives nine untextured chrome-metal
    // materials — every colour and all 12 textures silently discarded. metalrough bakes the spec/gloss
    // into real metallic-roughness maps, which is the only thing that makes this model loadable at all.
    specGloss: true,
    // 3x "blackoutside" and 4x "ring2" share a material. Joining merges each set into ONE mesh, which
    // both destroys the sun lab's object tree and renumbers every id (name, name#2, name#3…) — orphaning
    // the per-object overrides saved against those ids.
    join: false,
    // flatten DELETES the "black hole" parent node. useSunLabScene.ts centres and fits on that node
    // precisely so the small off-centre Planet can't skew the framing; losing it silently falls back to
    // the whole model.
    flatten: false,
    // Nested spheres, a thin disc and concentric rings — decimation visibly chews the rings, and Draco
    // already takes this from 30 MB to ~3 MB on its own.
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

  // A spec/gloss source has to be converted BEFORE optimize runs — optimize's own passes can't read
  // those materials either, so anything downstream would be working on already-lost data.
  let optimizeInput = inputPath;
  let scratchPath = null;
  if (recipe.specGloss) {
    scratchPath = join(tmpdir(), `${baseName}-metalrough.glb`);
    execFileSync(
      "npx",
      ["--yes", "@gltf-transform/cli@latest", "metalrough", inputPath, scratchPath],
      { stdio: "inherit", shell: true },
    );
    optimizeInput = scratchPath;
  }

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
        optimizeInput,
        outputPath,
        "--texture-size",
        String(textureSize),
        "--texture-compress",
        TEXTURE_FORMAT,
        "--compress",
        GEOMETRY_COMPRESSION,
        "--simplify",
        String(recipe.simplify ?? true),
        "--join",
        String(recipe.join ?? true),
        "--flatten",
        String(recipe.flatten ?? true),
        "--instance",
        String(recipe.instance ?? true),
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

  if (scratchPath) rmSync(scratchPath, { force: true });
}
