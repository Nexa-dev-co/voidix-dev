// Builds the shipped GLBs in `public/models` from a stable source, in one re-runnable pass:
// geometry decimation where a model carries more vertices than it can show, then KTX2 (Basis
// Universal) for every texture.
//
// ── Why ONE pass and not two scripts ─────────────────────────────────────────────────────────────
// Both stages want to write to `public/models`, and a second script reading that directory would be
// re-encoding its own previous output — decoding KTX2 back to pixels and compressing it again on
// every run, compounding the loss and taking minutes to do it. A single pipeline reading a source it
// never writes to is idempotent by construction: run it as often as you like and the output is
// identical.
//
// ── Why this is separate from optimizeModels.mjs ─────────────────────────────────────────────────
// That script is the road in from a RAW Sketchfab export: it caps texture size, converts to WebP and
// applies Draco, and it reads `models-src/`. This one is the road from the shipped GLB to a better
// shipped GLB, for the five models whose raw export no longer exists (see below). Different inputs,
// different job, and running the wrong one on the wrong file re-encodes textures that were already
// lossy once.
//
// ── ⚠ Where the inputs come from ─────────────────────────────────────────────────────────────────
// `models-src/` holds the pristine Sketchfab exports — for the two models that still have one. The
// other five were never committed (the directory is gitignored) and are gone. `models-src/from-public`
// is a copy of the SHIPPED, already-optimized GLBs taken 2026-08-04, so this pass has a stable input.
// They are also in git under `public/models`, which is the real safety net.
//
// ── Requires KTX-Software ────────────────────────────────────────────────────────────────────────
// gltf-transform's `etc1s` and `uastc` commands shell out to Khronos' `ktx` binary. It is NOT on
// winget under any id — install it from the GitHub releases page:
//   https://github.com/KhronosGroup/KTX-Software/releases/latest
//
// Usage:
//   node scripts/buildModels.mjs                 → every model
//   node scripts/buildModels.mjs black_hole.glb  → only the ones you name

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE_DIRECTORY = 'models-src/from-public';
const OUTPUT_DIRECTORY = 'public/models';

// The properties the runtime reads by name or by position — asserted before anything is published.
const COMPARE_SCRIPT = 'scripts/compareModels.mjs';

// ── Geometry ──
//
// How far the simplifier may move a vertex, as a fraction of the mesh's radius. This is the real
// safety rail, not `ratio`: meshoptimizer treats the ratio as a TARGET and the error as a LIMIT and
// stops at whichever it reaches first. At 0.001 both recipes below asked for 0.5 and got 0.60–0.67,
// because going further would have visibly moved the silhouette. Raise it only with the model on
// screen.
const MAX_SIMPLIFY_ERROR = 0.001;

// ── Textures ──
//
// ⚠ ETC1S FOR EVERYTHING, INCLUDING NORMAL MAPS — and that is not the textbook answer.
//
// The textbook answer is UASTC for normal maps: ETC1S is a palette codec, and neighbouring texels in
// a normal map encode DIRECTIONS rather than colours, so a shared palette entry points the surface
// the wrong way. That is real. It is also unaffordable here, measured on `spaceship3`:
//
//     one 1024² normal map      UASTC 972 KB      ETC1S 140 KB
//
// UASTC is ~1 byte per texel and it is high-entropy, so the `--zstd 18` this ships with barely
// touches it and `--rdo` at any lambda made no measurable difference at all. This site has seven
// normal maps; at UASTC that is ~7 MB added to a ~10 MB page whose loader gate already waits on a
// 1.3 MB download. Trading the whole download budget for the correctness of a map that is, on these
// models, panel-line detail on hulls seen at middle distance is the wrong trade.
//
// So: ETC1S everywhere by default, and `uastcSlots` on a model's recipe to buy the correct codec back
// for a specific map that visibly needs it. Per-model, like everything else here.
const DEFAULT_ETC1S_SLOTS = '*';

// ⚠ Slot globs are plain names, NOT `{normalTexture}`. A brace group with a single member does not
// expand in the matcher gltf-transform uses, so that glob matched nothing, uastc encoded nothing, and
// the normal map fell through as a 1.3 MB PNG — inflating the model 6× while reporting success.

// ETC1S quality, 1–255 (the CLI's own default is 128).
//
// 160, deliberately above the default, and the reason is `hullMaterial.ts`. The fleet's accent glow is
// not painted on — the shader thresholds each texel's own albedo LUMINANCE and anything above
// `emitThreshold` becomes an engine or a window that feeds bloom. Block-compression error pulls
// bright isolated texels toward their neighbours, which is the same failure mode as downscaling
// (docs/adaptive-asset-tier-plan.md §5.4) in a much milder form — resolution is preserved and only the
// block error moves. Buying quality back here is cheap insurance on the one thing that would be hard
// to attribute later.
const ETC1S_QUALITY = 160;

/**
 * Per-model texture exceptions. Two knobs, and the cheap one comes first:
 *
 * `maxTextureSize` caps a model whose maps are simply larger than anything on screen can sample. Every
 * halving is 4× the VRAM and roughly 3× the wire, and unlike a codec change it costs nothing anywhere
 * else.
 *
 * `uastcSlots` buys the correct-but-expensive codec back for specific maps, at roughly 830 KB per
 * 1024² map (see the block above). Reach for it only with the model on screen and a specific artifact
 * to point at — and try `maxTextureSize` first, because a slightly soft normal map reads better than a
 * mis-lit one and costs 4× less.
 */
const TEXTURE_RECIPES = {
  'fractured_sun.glb': {
    // ⚠ PER TEXTURE, not one number for the model — see the resize stage for why the passes cannot be
    // reordered. These three patterns cover all eight maps and do not overlap.
    textureSizes: [
      // The star's SKIN. `sunouter` is eleven translucent shells and its baseColor is the largest map
      // in the file; both were dead weight while a procedural plasma covered them and both are what
      // you actually look at now. A sphere's equirectangular unwrap spends most of its texels near
      // the poles, so the visible hemisphere gets nothing like `size` texels across — 1024 is the
      // first value comfortably above the ~350 device px the star covers.
      { pattern: 'sunouter*', size: 1024 },
      // The shard INTERIORS, seen during the cracks and the collapse and never on the resting hero.
      // These were judged at 512 back when they were the only maps being sampled, and nothing about
      // that judgement changed — they are 62 % of the model's bytes at 1024, which is the whole
      // reason this recipe is per-texture.
      { pattern: 'Lava*', size: 512 },
      // ⚠ `flare` and `blowout` are in SUN_OMITTED_PARTS and NEVER DRAW. Their maps are pure download
      // waste and the only lever here is to make the waste small; reclaiming it properly means
      // dropping the materials from the GLB, which moves the mesh table `compareModels` asserts on.
      { pattern: 'flare*', size: 256 },
      { pattern: 'blowout*', size: 256 },
    ],
    // 2048² maps (the set is literally named Lava004_2K) on a star that is **~350 device pixels
    // across** at its largest. `.hero-sun-card` is `clamp(7rem, 20vw, 11rem)` — 176 CSS px, so 352
    // backing-store pixels at dpr 2 — and the camera pulls back by `SUN_CANVAS_HEADROOM` so the star
    // renders at that size inside a padded canvas; the pin's `SUN_SCROLL_SCALE` of 1.1 is a CSS
    // transform and never touches the backing store. So 2048 was ~6× oversampled per axis.
    //
    // ⚠ 512 → 1024 on 2026-08-12, and the reason is that the star grew a skin. This said "512 is
    // still 2× oversampled", which was true of what was DRAWN at the time: the shells were hidden
    // behind a procedural plasma and the only sampled maps were the magma on the shard interiors.
    // `sunouter_baseColor` is the largest map in the file and is now the star's actual surface, and a
    // sphere's equirectangular unwrap spends most of its texels near the poles — so the visible
    // hemisphere gets nothing like 512 usable texels across. At 1024 it is comfortably above the
    // ~350 px it has to cover, which is the first size that can be said of.
    //
    // ⚠ It buys BYTES AND VRAM, NOT FRAME TIME, and the distinction is measured rather than assumed:
    // hiding whole material groups showed the star's cost is ~0.02 ms per DRAW CALL and independent of
    // texture area (see SUN_OMITTED_PARTS in SunModelCanvas). Nothing here will move `sun · bloom`.
    // The star is preload rung 1 and the loader gate waits on it, so the cost this DOES have is the
    // download — measure it on the console line this script prints, not by eye.
    //
    // ⚠ `flare` and `blowout` never draw (SUN_OMITTED_PARTS) and their two maps are pure download
    // waste — ~78 KB at 512, and this quadruples them. Reclaiming that means removing the materials
    // from the GLB, which moves the mesh table `compareModels` asserts on: a separate pass.
    why: 'the shells are the star surface again — 1024 where it shows, 512 and 256 where it does not',
  },
  'spaceship3.glb': {
    maxTextureSize: 512,
    // Four 1024² maps — 4.2 megatexels — on a model with 2,819 VERTICES. Whatever this ship is, it is
    // not 4 million pixels of detail: it is the smallest hull in the fleet and never fills the frame.
    // It was mis-specified long before any of this (docs/adaptive-asset-tier-plan.md §5.1 flagged it
    // from the raw numbers) and it is the one model here whose textures were always paying for
    // resolution nothing could sample.
    //
    // It is also the model ETC1S cost the most: its WebP maps compressed to 0.50 bits/texel, the
    // lowest on the site, and ETC1S has a floor near 0.85 that no amount of quality tuning goes below.
    // Capping the size fixes the cause rather than arguing with the codec — and lands it well under
    // where it started.
    why: '4.2 megatexels on 2,819 vertices',
  },
};

// Per-model treatment. A model absent from GEOMETRY_RECIPES is not decimated at all — the right
// default for nearly everything here, and why `optimizeModels.mjs` sets `simplify: false` almost
// everywhere. Every entry has to justify itself.
const GEOMETRY_RECIPES = {
  'table.glb': {
    ratio: 0.5,
    // 196,997 vertices for a table. It sits under the chamber's display, is only ever seen at an
    // oblique angle in a dim room, and is never the subject of a shot. Its textures are already
    // trivial — geometry is the whole of its cost, and it is the one model on the site whose vertex
    // count cannot be justified at any tier.
    why: 'a table, at an angle, in a dim room',
  },
  'black_hole.glb': {
    ratio: 0.5,
    // 368,063 vertices — the heaviest mesh on the site, for something on screen for about four
    // seconds at the very end, viewed THROUGH a lensing shader that bends it. `optimizeModels.mjs`
    // warns that decimation visibly chews its concentric rings, which is why MAX_SIMPLIFY_ERROR is
    // doing the deciding rather than the ratio.
    //
    // ⚠ Its `flatten: false` matters as much as ever: `singularityScene.ts` still calls
    // `getObjectByName('black hole')` to centre the model, and flattening deletes that parent node.
    // Nothing in this pass flattens, and the node-name assertion would catch it if it did.
    why: 'four seconds on screen, behind a lens',
  },
};

/**
 * Where the `ktx` binary lives, or `null` if it is already on PATH.
 *
 * The installer adds itself to PATH, but a shell opened BEFORE the install still carries the old
 * environment — and that is the overwhelmingly common way this fails: the tool is installed, the
 * error says it is not, and the fix is invisible. Looking in the default install directory costs one
 * `existsSync` and removes a genuinely confusing failure.
 */
function findKtxDirectory() {
  try {
    execFileSync('ktx', ['--version'], { stdio: 'ignore', shell: true });
    return null;
  } catch {
    // Not on PATH — fall through to the known install locations.
  }
  const candidates = [
    'C:/Program Files/KTX-Software/bin',
    'C:/Program Files (x86)/KTX-Software/bin',
    '/usr/local/bin',
  ];
  for (const directory of candidates) {
    if (existsSync(join(directory, 'ktx.exe')) || existsSync(join(directory, 'ktx'))) {
      return directory;
    }
  }
  console.error(
    '\n✗ KTX-Software not found. gltf-transform shells out to its `ktx` binary to encode KTX2.\n' +
      '  It is NOT on winget under any id. Install it from:\n' +
      '    https://github.com/KhronosGroup/KTX-Software/releases/latest\n' +
      '  (KTX-Software-*-Windows-x64.exe — it adds itself to PATH; reopen the shell afterwards.)\n',
  );
  process.exit(1);
}

const ktxDirectory = findKtxDirectory();
const childEnvironment = ktxDirectory
  ? { ...process.env, PATH: `${ktxDirectory};${process.env.PATH}` }
  : process.env;

function runTransform(args) {
  execFileSync('npx', ['--yes', '@gltf-transform/cli@latest', ...args], {
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: true,
    env: childEnvironment,
  });
}

const KTX2_IDENTIFIER = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
// Offset of `supercompressionScheme` in the fixed KTX2 header: 12 identifier bytes, then EIGHT uint32s
// — vkFormat, typeSize, pixelWidth, pixelHeight, pixelDepth, layerCount, faceCount, levelCount.
const SUPERCOMPRESSION_OFFSET = 12 + 8 * 4;
const SUPERCOMPRESSION_NAMES = { 0: 'none', 1: 'ETC1S', 2: 'Zstd/UASTC', 3: 'ZLIB' };

/**
 * Every texture's final pixel dimensions, and a HARD GATE on a per-pattern recipe having landed.
 *
 * ⚠ `resize --pattern` matches on texture NAME, and a glob that matches nothing does not fail — it
 * resizes nothing and reports success, which is the same silent shape the `--slots` note above
 * records. The symptom is a build that is simply larger than it should be, which nobody notices.
 * So each entry must be shown to have hit at least one texture AT the size it asked for.
 *
 * Dimensions come from the KTX2 header, where `pixelWidth`/`pixelHeight` are the 3rd and 4th uint32
 * after the 12-byte identifier and `vkFormat`/`typeSize`.
 */
function assertTextureSizes(path, textureSizes) {
  const buffer = readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.slice(20, 20 + jsonLength).toString('utf8'));
  const binaryStart = 20 + jsonLength + 8;

  const measured = (document.images ?? []).map((image, index) => {
    const view = document.bufferViews?.[image.bufferView];
    if (!view) return { name: image.name ?? `image ${index}`, width: 0, height: 0 };
    const start = binaryStart + (view.byteOffset ?? 0);
    return {
      name: image.name ?? `image ${index}`,
      width: buffer.readUInt32LE(start + 12 + 2 * 4),
      height: buffer.readUInt32LE(start + 12 + 3 * 4),
    };
  });
  console.log(
    `  sizes   ${measured.map(({ name, width, height }) => `${name} ${width}²`.replace(/ (\d+)²/, ' $1²')).join(', ')}`,
  );

  if (!textureSizes) return;
  // Same matcher shape the CLI uses for these globs: `*` only, no brace expansion (see the note on
  // uastcSlots for what happened the one time a `{a,b}` glob was assumed to expand).
  const missed = textureSizes.filter(({ pattern, size }) => {
    const matcher = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return !measured.some(
      ({ name, width, height }) => matcher.test(name) && Math.max(width, height) === size,
    );
  });
  if (missed.length) {
    console.error(
      `\n  ⚠ ${missed.length} texture size rule(s) matched nothing at the size they asked for:\n` +
        missed.map(({ pattern, size }) => `      ${pattern} → ${size}`).join('\n') +
        '\n    `resize --pattern` matches texture NAMES and fails silently. Check them against the\n' +
        '    `sizes` line above.\n',
    );
    process.exit(1);
  }
}

/**
 * Which codec each texture actually ended up as — and a HARD GATE on the answer.
 *
 * ⚠ This is the most valuable check in the file, and it earned that on its first run. The KTX2
 * encoder silently **skips** any texture it cannot read, and these models arrived as WebP, which it
 * cannot: the first attempt reported success, grew the file 45 %, and encoded precisely nothing. A
 * `--slots` glob that stops matching fails the same silent way, and an ETC1S normal map looks like a
 * slightly noisy normal map rather than like an error.
 *
 * So: anything that is not KTX2 at the end of the pipeline fails the build. Every texture is meant to
 * be compressed; a skip is a defect, never a choice.
 */
function assertTextureCodecs(path) {
  const buffer = readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.slice(20, 20 + jsonLength).toString('utf8'));
  const binaryStart = 20 + jsonLength + 8;

  const counts = new Map();
  for (const image of document.images ?? []) {
    const view = document.bufferViews?.[image.bufferView];
    if (!view) continue;
    const start = binaryStart + (view.byteOffset ?? 0);
    const header = buffer.slice(start, start + SUPERCOMPRESSION_OFFSET + 4);
    const label = header.slice(0, 12).equals(KTX2_IDENTIFIER)
      ? (SUPERCOMPRESSION_NAMES[header.readUInt32LE(SUPERCOMPRESSION_OFFSET)] ?? 'ktx2/?')
      : `NOT KTX2 (${image.mimeType ?? '?'})`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const summary = [...counts].map(([label, count]) => `${count}× ${label}`).join(', ');
  console.log(`  textures: ${summary || 'none'}`);

  const skipped = [...counts].filter(([label]) => label.startsWith('NOT KTX2'));
  if (skipped.length) {
    console.error(
      `\n  ⚠ ${skipped.reduce((total, [, count]) => total + count, 0)} texture(s) were NOT encoded.\n` +
        '    The KTX2 encoder skips formats it cannot read, and says so only as a warning. Check that\n' +
        '    the PNG stage ran before it, and that the --slots globs still match.\n',
    );
    process.exit(1);
  }
}

function formatKilobytes(byteCount) {
  return `${(byteCount / 1024).toFixed(0)} KB`;
}

const availableFileNames = readdirSync(SOURCE_DIRECTORY).filter((name) => name.endsWith('.glb'));
const requestedFileNames = process.argv.slice(2);

for (const requested of requestedFileNames) {
  if (!availableFileNames.includes(requested)) {
    console.error(`✗ no such source: ${join(SOURCE_DIRECTORY, requested)}`);
    process.exit(1);
  }
}

const fileNames = requestedFileNames.length ? requestedFileNames : availableFileNames;
mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

for (const fileName of fileNames) {
  const geometryRecipe = GEOMETRY_RECIPES[fileName];
  const sourcePath = join(SOURCE_DIRECTORY, fileName);
  const outputPath = join(OUTPUT_DIRECTORY, fileName);
  const sizeBefore = statSync(sourcePath).size;

  // Scratch files, one per stage. `simplify` writes UNCOMPRESSED geometry (it had to decode Draco to
  // touch the mesh at all), so that intermediate is several times larger than either end of this pipe.
  const scratch = (stage) => join(tmpdir(), `voidix-${fileName}.${stage}.glb`);
  // `resized-N` covers the patterned resize passes — one scratch file each, so cleanup has to
  // reach further than the single `resized` a global cap used to produce.
  const stages = [
    'simplified', 'geometry', 'png', 'resized', 'uastc', 'etc1s', 'final',
    ...(TEXTURE_RECIPES[fileName]?.textureSizes ?? []).map((_, index) => `resized-${index}`),
  ];

  const reasons = [geometryRecipe?.why, TEXTURE_RECIPES[fileName]?.why].filter(Boolean);
  console.log(`\n── ${fileName}${reasons.length ? ` — ${reasons.join('; ')}` : ''}`);

  try {
    // 1. Geometry, only where a recipe asks for it. Everything else keeps the Draco stream it
    //    arrived with, untouched — no decode, no re-quantization.
    let current = sourcePath;
    if (geometryRecipe) {
      runTransform([
        'simplify', current, scratch('simplified'),
        '--ratio', String(geometryRecipe.ratio),
        '--error', String(MAX_SIMPLIFY_ERROR),
      ]);
      // Re-apply Draco with the CLI's defaults, which is what `optimizeModels.mjs --compress draco`
      // used on the way in — so the output is quantized exactly as the input was.
      runTransform(['draco', scratch('simplified'), scratch('geometry')]);
      current = scratch('geometry');
    }

    // 2. ⚠ WebP → PNG, and this step is not optional. The KTX2 encoder reads PNG and JPEG only; hand
    //    it the `EXT_texture_webp` these models ship with and it SKIPS every texture with a warning,
    //    reports success, and produces a larger file containing nothing new. That is exactly what the
    //    first run of this script did. PNG is lossless, so the conversion adds no loss of its own —
    //    the WebP was already lossy once and this does not compound it.
    //
    //    ⚠ `--formats "*"` is load-bearing. The flag defaults to `"png"`, which means "only touch
    //    textures that are ALREADY PNG" — so without it this stage is a no-op on a WebP model and
    //    every downstream skip looks like a --slots problem instead.
    runTransform(['png', current, scratch('png'), '--formats', '*']);

    // 3. Cap the resolution, where a recipe says the maps are bigger than anything can sample.
    //    ⚠ After the PNG stage, not before: this resamples, and resampling a lossless intermediate
    //    keeps the operation to a single resample rather than a decode-resize-recompress round trip.
    //
    //    ⚠ A recipe may cap PER TEXTURE (`textureSizes`) instead of across the model
    //    (`maxTextureSize`). One number for a whole model assumes every map is sampled at the same
    //    rate, and on the sun that is simply false: its shells are the surface you look at and its
    //    magma maps are shard interiors seen for two beats. `resize` NEVER INCREASES a dimension, so
    //    the passes cannot be reordered out of trouble — an unpatterned cap run after a patterned one
    //    would just shrink what the first pass raised. Patterned entries must therefore cover
    //    everything they mean to bound, and must not overlap.
    //
    //    ⚠ Globs here match a texture's NAME, and a glob that matches nothing fails SILENTLY —
    //    exactly the trap the `--slots` note above records. `assertTextureSizes` proves each entry
    //    hit something, because "no error and a suspiciously large file" is the only other symptom.
    const textureRecipe = TEXTURE_RECIPES[fileName];
    let textureInput = scratch('png');
    if (textureRecipe?.textureSizes) {
      textureRecipe.textureSizes.forEach(({ pattern, size }, index) => {
        const output = scratch(`resized-${index}`);
        runTransform([
          'resize', textureInput, output,
          '--pattern', pattern,
          '--width', String(size), '--height', String(size),
        ]);
        textureInput = output;
      });
    } else if (textureRecipe?.maxTextureSize) {
      const size = String(textureRecipe.maxTextureSize);
      runTransform(['resize', textureInput, scratch('resized'), '--width', size, '--height', size]);
      textureInput = scratch('resized');
    }

    // 4. Any slot a recipe has bought UASTC for. Runs FIRST of the two codecs, so its glob sees the
    //    original textures and step 5's exclusion has something real to exclude.
    const uastcSlots = textureRecipe?.uastcSlots;
    if (uastcSlots) {
      runTransform(['uastc', textureInput, scratch('uastc'), '--slots', uastcSlots]);
    } else {
      copyFileSync(textureInput, scratch('uastc'));
    }
    // 5. Everything else — which is normally everything. `assertTextureCodecs` proves the globs held.
    runTransform([
      'etc1s', scratch('uastc'), scratch('etc1s'),
      '--slots', uastcSlots ? `!${uastcSlots}` : DEFAULT_ETC1S_SLOTS,
      '--quality', String(ETC1S_QUALITY),
    ]);

    // 6. ⚠ Re-apply Draco, because every texture pass above DECODED it. gltf-transform decompresses
    //    geometry on read whatever it was asked to do, so a model that needed no geometry work still
    //    comes out of step 4 uncompressed — the first run shipped `spaceship3` 45 % LARGER for this
    //    reason. Re-encoding at the same bit depths against the same bounding box lands the positions
    //    back on the same lattice, so this is near-lossless even for models step 1 never touched.
    runTransform(['draco', scratch('etc1s'), scratch('final')]);

    // ⚠ Assert BEFORE publishing. A pass that renamed a material or renumbered a mesh must never
    // reach public/models — nothing downstream would notice until a section silently lost its star
    // or hid the wrong part of a hull.
    execFileSync('node', [COMPARE_SCRIPT, sourcePath, scratch('final')], { stdio: 'inherit' });
    assertTextureSizes(scratch('final'), textureRecipe?.textureSizes);
    assertTextureCodecs(scratch('final'));

    copyFileSync(scratch('final'), outputPath);
    console.log(
      `  → ${OUTPUT_DIRECTORY}/${fileName}: ${formatKilobytes(sizeBefore)} → ${formatKilobytes(statSync(outputPath).size)}`,
    );
  } finally {
    for (const stage of stages) rmSync(scratch(stage), { force: true });
  }
}
