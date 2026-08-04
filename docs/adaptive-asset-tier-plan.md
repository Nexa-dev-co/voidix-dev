# The adaptive asset tier — 2026-08-04

> The next step past `docs/loader-adaptive-plan.md`. That one fixed the **order** of the download and
> what the loader shows while it waits. This one fixes **how much is downloaded at all**, and how big
> it is once it is on the GPU.
>
> Every number in §1–§3 was measured off `public/models` on 2026-08-04 by parsing the GLB headers —
> texture bytes, texture dimensions, vertex counts. Nothing in §4 onward is measured; it is a design.

---

## 0 · What was decided

| | |
|---|---|
| **KTX2 underneath everything, at every tier** | GPU-compressed textures stay compressed *in VRAM*. Same resolution, same picture, ~4–8× less memory. This is not a tier — it is the floor the tiers stand on. |
| **Four device tiers** | `potato` / `low` / `mid` / `high`. `mid` is the middling one — an integrated-graphics laptop that should still look good. |
| **Per-model ladders, not one global slider** | Each model declares its own texture ladder and its own geometry ladder, because *how much a model matters is a property of the model*. The sun is a bloom-blown ball of light; a hull is a machine you can drag and inspect. They must not be cut by the same rule. |
| **The head decides the opening tier** | An inline `<script>` in `<head>`, before the sun's preload link is written — because the sun is preloaded from static HTML and there is no JS running yet. |
| **Bandwidth opens, capability upgrades** | A weak connection opens low even on a strong machine. A strong machine then pulls the better textures in the background, during the hero, and swaps them in. |

⚠ **All of the complexity lives in a build-time table. The runtime is still one number.** A device
resolves to a single tier and every path goes through `resolve(model, tier)`. Nothing at runtime knows
that the sun has two variants and a hull has four.

---

## 1 · What actually ships

```
FILE                          WIRE      TEX%   TEX VRAM   VERTS     NEEDED
fractured_sun.glb            1.28 MB    94%    30.0 MB      7.7k    AT REVEAL — the gate waits on it
spaceship.glb                2.05 MB    16%    21.3 MB    204.6k    deck stop 1
cargo_spaceship.glb          2.45 MB    46%    53.3 MB    226.5k    deck stop 3
spaceship3.glb               0.27 MB    93%    21.3 MB      2.8k    deck stop 2
star_aventure...fighter.glb  0.38 MB    50%     5.3 MB     67.2k    deck stop 4
table.glb                    0.61 MB     9%     2.7 MB    197.0k    chamber — idle prefetch
black_hole.glb               2.87 MB    42%    34.7 MB    368.1k    contact — idle prefetch
──────────────────────────────────────────────────────────────────
                             9.91 MB          168.6 MB     1.07 M
       + standalone textures 0.89 MB, + Draco WASM 0.24 MB  →  ~11 MB on the wire
```

"TEX VRAM" is decoded RGBA plus a mip chain — what the driver actually holds, not what WebP costs on
disk. Add roughly 40 MB for 1.07 M vertices of interleaved attributes and the asset residency is
**~210 MB**, on top of the ~544 MB of render targets counted in `docs/lag-and-freeze-diagnosis.md` §1.

---

## 2 · The two costs disagree, and that is the whole design

```
   WIRE BYTES                          GPU RESIDENCY
   cargo      ████████████ 2.45 MB     cargo      █████████████████████ 53.3 MB
   black_hole ██████████████ 2.87      black_hole █████████████ 34.7
   spaceship  ██████████ 2.05          sun        ███████████ 30.0
   sun        ██████ 1.28              spaceship  ████████ 21.3
   table      ███ 0.61                 spaceship3 ████████ 21.3   ◄── 0.27 MB on the wire
   star_av    ██ 0.38                  star_av    ██ 5.3
   spaceship3 █ 0.27  ◄────────────────────────────┘  same VRAM as a file 7.6× its size
```

`spaceship3.glb` is 0.27 MB to download and **21.3 MB of VRAM** — four 1024² maps on 2,819 vertices.
Compressing the wire and cutting GPU load are two different levers pulling on two different files, and
a system that only knows about megabytes will optimise the wrong one.

**Which lever moves what**

```
   TEXTURE CAP 1024 → 512 → 256          per halving: −4× VRAM, roughly −3× wire
   ├ sun        1.20 MB tex → ~0.32 → ~0.09      30.0 MB → 7.5 → 1.9
   ├ cargo      1.12 → ~0.30 → ~0.08            53.3 → 13.3 → 3.3
   ├ black_hole 1.22 → ~0.35 → ~0.10            34.7 →  8.7 → 2.2
   └ ...                                        169 MB → ~44 → ~11

   GEOMETRY (every recipe today says simplify:false, each for a stated reason)
   ├ black_hole  368k verts   nested spheres, a disc, concentric rings
   ├ cargo       227k verts
   ├ spaceship   205k verts   ONE primitive, ONE material — the cleanest decimation target on the site
   ├ table       197k verts   8 prims, seen at an angle under a display
   └ at ratio 0.5 across those four: ≈ −0.9 MB wire, ≈ −20 MB VRAM, and −500k vertices per frame
```

⚠ **The `simplify: false` reasons in `optimizeModels.mjs` are real and they still hold at `high`** —
which is why the geometry ladder in §5.2 leaves `high` untouched for every model except `table`, whose
197k vertices cannot be justified at any tier. Each ratio needs eyes on the result — see §11.

⚠ And note what the table above does **not** say: none of these numbers are the KTX2 numbers. §5.0
cuts the same 169 MB to ~30 MB *without touching a single resolution*, which is why the tiers below
are far gentler than a first reading of this section would suggest.

---

## 3 · ⚠ Two things that constrain the build before any code is written

### 3.1 · Five of the seven sources no longer exist

```
   models-src/     champion_astro_ring.glb, star_aventure...fighter.glb, one -source.zip
   .gitignore      models-src/          ← never committed, not recoverable from git
```

`spaceship`, `spaceship3`, `cargo_spaceship`, `fractured_sun`, `black_hole` and `table` have no
pristine source on this machine. Their tiers must be re-encoded **from `public/models/*.glb`**, which
is a downscale of an already-lossy 1024² WebP.

**So the pipeline inverts.** `high` is not built — it is **today's file, copied**, byte-identical, no
re-encode, no compounding. `mid` and `low` are derived from it. That also means there can never be a
tier *above* today's quality without re-sourcing from Sketchfab, which is worth knowing before anyone
proposes a "4K" tier.

### 3.2 · The build half of this feature already exists and the runtime half never did

`optimizeModels.mjs` already emits tiered filenames (`chamber-512.glb` / `chamber-1024.glb`) and its
comment says *"the runtime picks one from measured frame times"*. **No such picker was ever written**,
and neither of those two models ships any more. Read those recipes as provenance, not as a working
system — but the `textureSizes: []` machinery in that script is sound and this plan extends it rather
than replacing it.

---

## 4 · The timeline — why one decision cannot serve the whole page

```
   t≈0ms         ~50ms          ~150ms          ~400ms        1s ─────────── 80s
   │ HTML        │ JS parse     │ React mount   │ chunks      │ downloads
   │             │              │               │             │
   ├─ <link rel=preload fractured_sun.glb>   ◄── THE FIRST MODEL BYTE, from static HTML
   │                            │
   │                            ├─ GatherCanvas: a live WebGL context, in a worker
   │                            │
   │                                            ├─ SunModelCanvas mounts, GLTFLoader starts
   │                                            │
   │                                            └─ yieldToStarDownload holds the fleet ──┐
   │                                                                                     │
   │                                                            the fleet releases here ─┘
   │                                                                                  ...
   │                                                   works warm-up ──┐
   └───────── the only measurement the site takes today is HERE ───────┘   gpuProbe
```

Two consequences, and they are the shape of everything below.

1. **`gpuProbe` cannot inform a download.** It fires after every gate asset has already landed. It is
   the right instrument in the wrong place for this job and it stays exactly where it is, doing the
   job it was built for — the pixel ratio.
2. **The sun's tier must be chosen before any JavaScript runs.** `app/layout.tsx` preloads a hardcoded
   URL from static HTML (`docs/loader-adaptive-plan.md` A2, and it is the fix that stopped the site
   opening starless). Choose a tier in JS afterwards and either the preload is wasted and the star
   downloads **twice** — the exact failure the `crossOrigin` comment on that link warns about — or the
   sun cannot be tiered at all.

You cannot benchmark in zero milliseconds. So the decision splits in two, and the split is not a
compromise: the two halves answer different questions.

```
   ┌───────────────────────────────────────────────────────────────────────┐
   │ STAGE 1 · CLASSIFY      inline <head> script, ~1 ms, no rendering     │
   │   what it answers: "how much is it safe to START downloading?"        │
   │   → the OPENING TIER. Writes the sun's preload link itself.           │
   ├───────────────────────────────────────────────────────────────────────┤
   │ STAGE 2 · MEASURE       during the loader, before the fleet releases  │
   │   what it answers: "what can this GPU actually hold?"                 │
   │   → the CAPABILITY TIER. Corrects everything not yet on the wire.     │
   ├───────────────────────────────────────────────────────────────────────┤
   │ STAGE 3 · UPGRADE       during the hero only, if capability > opening │
   │   → fetches the better textures and swaps them onto live materials.   │
   └───────────────────────────────────────────────────────────────────────┘
```

---

## 5 · Part A — the assets on disk

### 5.0 · The floor: KTX2, for everyone, at every tier

Today's textures are WebP. WebP is small on the **wire** and then the driver expands it to raw RGBA in
**VRAM** — a 180 KB file becomes 5.6 MB resident. KTX2 (Basis) stays compressed on the GPU.

```
   ONE 1024² TEXTURE, RESIDENT ON THE GPU
   today  WebP → RGBA + mips   ██████████████   5.6 MB
   KTX2 · UASTC               ███               1.4 MB    normal maps
   KTX2 · ETC1S               ██                0.7 MB    colour, roughness, AO, metalness

   THE WHOLE SITE            169 MB  →  ~30 MB     at the SAME resolutions
```

**This is the single largest win in the plan and it is invisible.** It is bigger than dropping
everything to the smallest tier, and unlike that it costs no picture. It applies at `high` as much as
at `potato`, which is why it is the floor and not a tier.

Rules, and they are not optional: **ETC1S for colour / roughness / AO / metalness, UASTC for normal
maps.** ETC1S is a palette codec and mangles the packed vectors in a normal map — it is the one map
type that must pay for UASTC.

⚠ **This trades download for memory, and the trade can go the wrong way on the wire.** UASTC files are
*larger* than the WebP they replace; ETC1S is roughly comparable. Expect total download to land flat
to slightly up, and VRAM to fall by 4–8×. The site's measured problem is a struggling GPU
(`docs/lag-and-freeze-diagnosis.md`), not the wire — the ladder in `loader-adaptive-plan.md` already
fixed the wire — so this is the right direction. But it must not be described as a download win.

⚠ It needs the **Basis transcoder** (~250 KB WASM), a serial dependency exactly like Draco: nothing
decodes until it lands. It gets the same treatment — a shared loader in `lib/modelLoading.ts` and a
`<link rel="preload">` beside Draco's. `three@0.184` ships `KTX2Loader`; nothing in this repo uses it
today.

### 5.1 · How much each model actually matters

The mistake in the first draft of this plan was one global slider. **Visual importance is a property
of the model, and on this site it varies enormously** — and so does *which axis* is worth cutting.

```
   MODEL            SEEN AS                                     TEXTURE   GEOMETRY
   ─────────────────────────────────────────────────────────────────────────────────
   the four hulls   ONE at a time, filling the frame, and the   PROTECT   protect
                    visitor can DRAG-ROTATE it. Panel lines,             (hard-surface
                    normal maps and the glow threshold are               silhouettes)
                    the entire section.
   black_hole       the finale — but seen through a LENSING     medium    CUT HARD
                    shader that bends it, for ~4 seconds.                 368k verts
   fractured_sun    a ball of light under heavy bloom, at       CUT HARD  NEVER
                    "o"-glyph size, then hero-square size.                the fracture
                    Bloom blows out texture detail by design.             edges ARE the
                                                                          model
   table            under the display, at an angle, in a dim    already   CUT HARD
                    room. Its 2 maps are 2.7 MB — nothing       cheap     197k verts
                    to reclaim.                                           for a table
```

Two things fall out of that grid, and both are the opposite of what a uniform tier does:

- **The sun and the table can be cut hard — but on different axes.** The sun's 30 MB is all texture on
  7,694 vertices; the table's cost is 197k vertices behind 2.7 MB of texture. Cutting "the sun" and
  "the table" by the same rule reaches the wrong half of each.
- **The hulls should barely be cut at all**, and with KTX2 (§5.0) they no longer need to be. Their
  53 MB + 21 MB + 21 MB + 5 MB becomes roughly 13 + 5 + 5 + 1 at full resolution.

### 5.2 · The ladders

Each model declares a texture ladder and a geometry ladder, in `optimizeModels.mjs` beside the recipe
that already explains it. Repeated entries mean **one file serving two tiers** — you only pay for a
variant where the variance is visible.

```
   TEXTURE                potato    low      mid      high      files
   ───────────────────────────────────────────────────────────────────
   spaceship               256      512      1024     1024        3
   cargo_spaceship         256      512      1024     1024        3
   spaceship3              256      512      512      512         2   ← 4×1024² on 2,819 verts today
   star_aventure           256      512      512      512         2
   black_hole              256      512      1024     1024        3
   fractured_sun           256      256      512      512         2   ← bloom eats the detail
   table                   256      512      512      512         2
                                                                 ──
                                                                  17 model files

   GEOMETRY (simplify ratio; "—" = untouched)
   ───────────────────────────────────────────────────────────────────
   table                   0.35     0.35     0.5      0.5      197k verts, dim, at an angle
   black_hole              0.3      0.4      0.5      —        368k verts, behind a lens
   cargo_spaceship         0.5      0.7      —        —        227k
   spaceship               0.5      0.7      —        —        205k, ONE prim, ONE material
   star_aventure           0.7      —        —        —        67k
   spaceship3              —        —        —        —        2,819. Nothing there.
   fractured_sun           —        —        —        —        NEVER. See §5.3.
```

⚠ **A geometry ladder and a texture ladder can want different files.** `table` at `mid` is
`texture 512 / geometry 0.5`; at `potato` it is `256 / 0.35`. The build emits one GLB per *distinct
combination*, and the manifest records which tier maps to which file — so a model with 2 texture steps
and 3 geometry steps does not silently become 6 files. Expect ~19 GLBs total.

**`high` is still today's bytes for geometry** (§3.1) — only the textures are re-encoded to KTX2, which
is a format change rather than a quality change at that step.

**`manifest.json` is the point of the build change, not a side effect.** It is what finally kills the
standing ⚠ in `assetLoadProgress.ts` — see §9. It ships as a **generated `.ts` module, not a fetched
JSON file**: the weights are needed before the counter can be honest, and adding a serial request in
front of that would be a new rung on the ladder §4 exists to remove.

### 5.3 · ⚠ The invariant every tier must satisfy, and the build must assert it

A tier is **the same model at a different resolution**. Not a different model. Three properties of
these files are read by name or by position at runtime, and a tier that quietly changes any of them
breaks a section on exactly the devices least able to report it:

```
   MESH / PRIMITIVE COUNT and ORDER   must be identical across tiers
      deckTuning's `hiddenParts` addresses meshes by POSITIONAL id, `${shipIndex}:${partIndex}`,
      assigned in traverse order. Renumber them and the wrong pieces vanish.

   MATERIAL NAMES                     must be identical across tiers
      SunModelCanvas:806   materials.some(m => m.name === 'flare')
      singularityScene:980 material.name === REDSHIFT_MATERIAL
      singularityScene:993 m.name === 'flare'
      ⚠ `optimize` runs `dedup`. At 256² two maps that were distinct at 1024² can hash
        identical — and materials that dedup together lose one of the two names.

   NODE NAMES                         must survive at every tier
      SunModelCanvas:877     child.name.startsWith('Sphere_0_cell')  ← the ten shards
      singularityScene:1042  the same prefix, for the collapse
      singularityScene:1155  blackHoleRoot.getObjectByName('black hole')
      ⚠ That last one is STILL LIVE. `optimizeModels.mjs` justifies black_hole's
        `flatten: false` by pointing at `useSunLabScene`, which was deleted — but the
        contact scene does the same lookup and would silently fall back to the whole model,
        skewing the framing on the small off-centre Planet.

   TEXTURE SLOT STRUCTURE             must be identical across tiers
      Stage 3 (§8) swaps maps onto live materials. Replacing a map recompiles nothing;
      ADDING one that a lower tier had pruned changes the program's defines and forces a
      recompile mid-session — a GPU stall in the hero. So no tier may drop a slot.
```

**So the build asserts all four**, reads them out of the generated manifest, and fails loudly rather
than shipping a tier that is subtly a different model. This is cheap — it is four counts and two
sorted name lists per file — and it converts the whole category from "needs eyes forever" into a
guarantee.

`fractured_sun` additionally keeps `flatten:false / join:false / instance:false` at every tier, and
`black_hole` keeps `flatten:false / join:false`, for the reasons above.

### 5.4 · ⚠⚠ The threshold problem — downscaling turns the fleet's lights off

This is the one genuinely dangerous side effect in the plan, and it is not obvious from any file size.

`hullMaterial.ts` does not read an emissive map to decide what glows. It thresholds the **albedo's own
luminance, per texel**:

```glsl
hullLum  = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
hullEmit = smoothstep(uEmitThreshold, 1.0, hullLum) * uEmitStrength * uEmitPulse;
totalEmissiveRadiance += uAccent * hullEmit + ...;      // ← this is what feeds bloom
```

A downscale is an average. A cockpit window three texels wide at 1024² is **under one texel at 256²**,
averaged with the dark hull around it:

```
   1024²   ███░░░░░░  lum 0.92  ──►  above emitThreshold  ──►  GLOWS, blooms
    512²   ██░░░░░░░  lum 0.71  ──►  above (just)         ──►  dimmer
    256²   █░░░░░░░░  lum 0.38  ──►  BELOW threshold      ──►  DARK. No glow. No bloom.
```

The deck's entire visual identity — four ships each with a distinct accent that blooms — is keyed on a
per-texel threshold that a box filter erodes. The same shader also grades the hull by that luminance
(`smoothstep(0, uGradeMid, hullLum)`), so the shadow → hull → highlight separation compresses toward
the mid tone and the hulls read flatter as well. **`fractured_sun`'s corona has the same shape of
dependency.**

**Two ways out, and I would do both:**

1. **Dilate, don't average.** The low/mid albedo maps get a max-filter pass on the brightest texels
   before the downscale, so a small light survives as a small bright texel rather than dissolving into
   its surroundings. `optimizeTextures.mjs` already drives sharp, so this is a pre-pass in the same
   toolchain, not a new dependency.
2. **Compensate the threshold per tier.** `emitThreshold` is a per-ship number in `deckServices.ts`.
   It becomes a small per-tier offset applied at material build time — the tier is already known
   there. Cheaper than (1), and it is the safety net for whatever (1) does not preserve.

⚠ Whichever ships, **the low tier's ships must be looked at with bloom on before the ratio is
final.** A file-size table cannot tell you the fleet stopped glowing.

### 5.5 · The standalone textures should be tiered too, and they can be done properly

`optimizeTextures.mjs` covers what `optimizeModels.mjs` cannot reach: `basalt-magma.webp` (423 KB) and
`geode-druse.webp` (398 KB). They are the works field's hero material — the body you orbit for four
stops — and 0.82 MB of the gate's weight.

Unlike the models, **`textures-src/` still exists**, so these tiers are clean encodes from the lossless
originals rather than a downscale of a downscale (§3.1). They are the one part of this plan with no
quality compounding at all.

---

## 6 · Part B — stage 1, the instant classifier

An inline, blocking `<script>` in `<head>`, above the preload links. It must never throw, must touch
nothing that forces layout, and must finish in about a millisecond.

```js
tier = localStorage['voidix.tier.v1']        // a previous visit already measured this machine
    ?? classify(pointer, dpr, screen, deviceMemory, hardwareConcurrency, connection)
document.write / appendChild:  <link rel=preload href=/models/fractured_sun-{tier}.glb ...>
```

**What it reads, and what each is for**

| signal | reads on | says |
|---|---|---|
| `navigator.connection.saveData` | Chromium | the visitor has explicitly asked for less → `low`, full stop |
| `.effectiveType` / `.downlink` | Chromium | how much it is reasonable to open with |
| `matchMedia('(pointer: coarse)')` | everywhere | a phone or tablet — correlates with the weak GPUs |
| `devicePixelRatio` × `screen` | everywhere | how many pixels the panel will demand |
| `navigator.deviceMemory` | Chromium | the single best proxy for "will 169 MB of texture fit" |
| `hardwareConcurrency` | everywhere | a weak tiebreak |

**Rejected: sniffing the GPU here.** `WEBGL_debug_renderer_info` would be the obvious addition and it
is wrong in this slot for three reasons: creating a GL context in `<head>` blocks the parser for
several milliseconds on exactly the machines that can least afford it; Safari and Firefox return a
generic masked string, so it answers for Chromium and nobody else; and stage 2 measures the real
thing a few hundred milliseconds later for free. The head script is a **network and form-factor**
classifier. That is all it needs to be, because the tier it picks is only the tier the page *opens*
with.

**Its residual blind spot, stated plainly:** a weak *desktop* GPU on a fast connection opens at
`high`, and stage 2 will not have answered before the sun is already on the wire. That costs at worst
30 MB of texture on one model. The fleet — 100 MB of the 169 — is still ahead of the correction,
because `yieldToStarDownload` is holding it. That is the whole reason this design survives having a
slow answer.

**Persisted with a schema version**, so visit 2 opens at the measured tier immediately rather than
re-deriving it — and, more importantly, requests the **same filenames the HTTP cache already holds**.
A tier that flip-flops between visits throws away a warm cache and re-downloads ~10 MB, which is worse
than being one tier wrong.

---

## 7 · Part C — stage 2, the field is already the benchmark

**Do not build a second `gpuProbe`.** The loader is, at that moment, running 60,000 particles through
a hand-written WebGL shader in a worker, at the real canvas size, at the real device pixel ratio,
sixty times a second, for the entire download. That is a fill-rate and vertex-throughput sample on the
real device and it is **already being paid for**.

```
   gatherRenderer.renderFrame()  ── already runs every frame ──
        │
        ├─ accumulate an EMA of its own frame time                  ~8 lines
        ├─ for ~10 frames early on, draw the buffer at a RAISED     ~6 lines
        │  point size / instance count, and measure the slope
        └─ post one message back:  { type: 'gpu', msPerFrame, slope }
```

**The slope is the measurement, not the frame time.** A single frame time confounds the GPU with
whatever else is on the machine; how much *worse* the frame gets when the fill rate is tripled is a
property of the GPU alone. It is the same reasoning `gpuProbe` uses — measure a real pipeline, not a
synthetic one — applied to a pipeline that was going to run regardless.

⚠ **Why not `gl.finish()` here.** `docs/loader-freeze-plan.md` §7: a busy GPU process cannot present
*anyone's* frames, worker canvases included. A drained probe in this worker would stutter the one
thing on the loader whose entire job is to keep moving. Frame-time deltas across frames that were
going to be drawn anyway cost nothing and stall nothing.

⚠ **This is the first message the worker has ever sent back**, and `gatherMessages.ts` says the
one-way contract is deliberate: *"no round trip that a blocked main thread could stall."* A
fire-and-forget report does not violate that — there is no request and nothing waits — but its
**delivery is queued behind whatever is on the main thread**, which at that moment may be parsing the
star's glTF. So:

> The release path must never *wait* for this message. It uses the capability tier if it has arrived
> and the opening tier if it has not. Late is a missed optimisation; blocking would be a new freeze.

The capability tier is latched on arrival, written to `localStorage`, and every model not yet
requested resolves against it.

---

## 8 · Part D — stage 3, the upgrade window

Capability higher than the opening tier means a strong machine opened low because the connection
looked bad. Recover it in the background — but under three hard rules.

**Rule 1 · Swap textures, never models.** Re-loading a whole GLB means rebuilding a scene graph, and
the deck catalogues every mesh by positional id (`${index}:${partIndex}`), binds per-ship uniforms,
and honours `hiddenParts` against those ids. Instead: load the higher tier into a throwaway scene,
copy `map` / `normalMap` / `roughnessMap` / … onto the **existing** materials by material name, flag
them `needsUpdate`, dispose the temporary scene. Geometry stays at the opening tier for the session —
which is the smaller win anyway (§2) and the one that is structurally load-bearing.

**Rule 2 · One texture per idle frame.** A ~50 MB batch of uploads is a GPU-process stall, i.e.
precisely the freeze `loader-freeze-plan.md` was written about. `lib/warmScene.ts` already establishes
the idle-frame pattern; reuse its shape.

**Rule 3 · Hero only, fleet only.**

```
   INTRO      HERO ◄── the only window ──►   SERVICES     WORKS    CHAMBER   CONTACT
   ┌─────┐    ┌──────────────────────┐       ┌──────┐    ┌──────┐  ┌─────┐   ┌─────┐
   │     │    │ nothing is scrubbed  │       │      │    │      │  │     │   │     │
   │     │    │ the deck is off      │       │ ▲    │    │      │  │     │   │     │
   └─────┘    └──────────────────────┘       └─┼────┘    └──────┘  └─────┘   └─────┘
                                               │
                          if the swap has not finished by here, it is ABANDONED
```

`adaptivePixelRatio` already refuses to reallocate during a crossing because the jump is visible; a
texture upload mid-crossing is the same fault with a bigger stall. The fleet is 100 MB of the 169 and
it is what the hero window sits directly in front of. Everything else keeps the tier it opened with.

---

## 9 · What this breaks, and what each becomes

| today | after |
|---|---|
| `app/layout.tsx` preloads a hardcoded `/models/fractured_sun.glb` | the head script writes the link, at a tiered URL. ⚠ `crossOrigin="anonymous"` must survive verbatim or the star downloads twice. |
| `SOURCE_WEIGHTS` in `assetLoadProgress.ts`, hand-maintained, with a standing ⚠ | **derived from `manifest.json` at the resolved tier.** The comment warning that shrinking an asset invalidates them as much as growing it stops being a trap and becomes arithmetic. This is the best thing in the plan. |
| `fractured_sun.glb` fetched twice (`SunModelCanvas` + `singularityScene`) | both go through one resolver, so both hit the same URL. Still two fetches (`THREE.Cache` is off for a real reason — `modelLoading.ts`), but at least not two *tiers*. |
| `prefetchWhenAssetsReady([TABLE_MODEL, BLACKHOLE_MODEL_PATH])` | tier-resolved paths. It already skips entirely on `saveData`; the classifier now agrees with it instead of duplicating the check. |
| `lowPower` — a viewport/pointer flag decided at mount, in three places | folded into the tier. **One quality authority, not two.** `useIsLowPowerViewport` keeps its own job (unmounting the hero's optional effects on resize) but stops being a second opinion about scene quality. |
| `next.config.mjs` immutable headers on `/models/:path*` | unchanged, and now strictly better: tiered filenames are content-addressed by name. |
| `lib/cacheTelemetry.ts` | classifies by `/models/` — unaffected, but should print the resolved tier once so a slow session can be read at a glance. |
| `LoaderTelemetry` | should show the tier and why it was chosen. It is the only surface where a wrong decision is visible. |

---

## 9b · Side effects — the register

Everything this change causes that is not the thing it is for. Grouped by whether it is certain,
conditional, or one-time.

### Certain — these happen, by design, and someone will notice

| effect | reading |
|---|---|
| **Every model filename changes**, including at `high` | `fractured_sun.glb` → `fractured_sun-high.glb`. With `immutable` headers in production this **invalidates every returning visitor's cache once**: one full ~10 MB re-download on the deploy. Unavoidable and worth timing deliberately. |
| **The dust shapes will appear less often** | `SHAPE_ONSET_ETA_SECONDS = 10` (shipped 2026-08-04, `loader-adaptive-plan.md` §4d). A tiered sun downloads faster, so fewer loads cross that threshold. That is the plan working, but the feature will look like it regressed. Do not "fix" it by lowering the onset. |
| **`gpuProbe`'s number stops being comparable across sessions** | Less texture pressure → a faster measured frame → a higher earned pixel ratio. Correct behaviour, but the `[voidix] gpu probe:` line now means something different per tier. It must print the tier beside it or it becomes actively misleading. |
| **The loader's counter reaches 100 sooner** | It tracks the star's fraction; the star is smaller. Nothing is dishonest — the weights are derived (§9) — but the loader's *pacing* changes and the timeline beats around it were tuned against today's durations. |
| **Two tiers can sit in the HTTP cache at once** | A visitor whose stored tier is invalidated by a schema bump fetches a second full set. Up to ~20 MB of cache for one site. Mitigated only by never re-tiering within a session. |
| **Normal maps suffer most, per pixel of loss** | Albedo downscales gracefully; a normal map at 256² on a hull covered in panel lines goes to mush and shimmers under camera motion. It is the map to check first at `low`, not the colour. |

### Conditional — these break something unless the plan's guards hold

| risk | the guard |
|---|---|
| **The sun downloads twice** | The head writes a preload for tier X; `SunModelCanvas` must resolve X, not a tier stage 2 has since latched. **The resolved tier is pinned per model at first request**, never re-read. `singularityScene` loads the same file later in the session and must land on the same URL — that is 1.3 MB of mid-scroll re-download if it does not. `THREE.Cache` is off (`modelLoading.ts`) and cannot save us here. |
| **`dedup` merges two materials at `low`** | §5.3's build assertion on material names. Without it this fails at runtime, in the contact scene, as a star that has lost its `flare`. |
| **`hiddenParts` addresses the wrong meshes** | §5.3's assertion on primitive count and order. Currently every ship's list is empty, so this would be silent today and a trap the first time one is populated. |
| **Stage 3 recompiles a program mid-hero** | No tier may prune a texture slot (§5.3). Replacing a map is an upload; adding one is a recompile, and a recompile in the hero is the §7 freeze. |
| **Stage 2 measures noise instead of the GPU** | It must run **worker-only**. On the main-thread fallback (no `OffscreenCanvas`) the field's frame times are polluted by glTF parsing on the same thread — the very interference the worker exists to escape. On that path, and under `prefers-reduced-motion` (where `GatherCanvas` bails before creating any context at all), there is **no measurement** and the classified tier stands. |
| **A stage-3 upload stutters the hero** | One texture per idle frame, hero only, abandoned at the services boundary (§8). The fluid cursor is running on that screen and a batched upload would be visible in the ink trail. |

### One-time and operational

- **Repo weight**: 21 model files, ~17 MB, and Git stores no delta for binaries — every rebuild of a
  tier adds its full size to history permanently. Three rebuilds during tuning is ~50 MB of history
  that never comes back. Either commit tiers only when they genuinely change, or generate `low`/`mid`
  in CI and accept that a fresh checkout is no longer buildable offline. **Decide before the first
  commit, not after.**
- **`npm run optimize:models` gets ~3× slower** and re-encodes textures on every run. Its existing
  warning about reprocessing a model you did not intend to touch matters three times as much now.
- **No runtime override.** CLAUDE.md is explicit that nothing on this site is configurable at runtime
  and that every `?tune`-style route was deleted deliberately. Testing a tier is therefore a
  `localStorage` key set by hand plus the `LoaderTelemetry` readout — **not** a query parameter.

### Considered and found harmless

- CDN/edge caching: the tier is chosen by client-side JS reading `navigator` and `localStorage`, so
  the HTML stays static and cacheable. **This is why the head script classifies rather than the server
  sniffing a User-Agent** — UA sniffing would fragment the HTML cache by device.
- `saveData` visitors: already skipped by `prefetchWhenAssetsReady`; the classifier now agrees with it
  instead of being a second, different opinion.
- The `black_hole.glb` CC-BY-4.0 attribution in the contact footer is unaffected by tiering — it is
  required for every tier and the credit is not per-file.
- `next.config.mjs`'s immutable headers: strictly better, since tiered filenames are content-addressed
  by name.

---

## 10 · Order of work

**Split into two phases, and the first one ships on its own.**

### Phase 1 — invisible. Everyone gets the same files. No tiers, no device test.

| # | change | risk | payoff |
|---|---|---|---|
| 1 | **KTX2 everywhere** (§5.0) — encoder in `optimizeModels.mjs`, shared `KTX2Loader` in `modelLoading.ts`, transcoder preload beside Draco's | medium — a new codec path, and `three` must transcode before first draw | **169 MB → ~30 MB of VRAM at unchanged resolution** |
| 2 | pack roughness/metalness/AO into one texture, at half resolution | low — they are low-frequency maps | another large cut on `cargo`'s ten maps |
| 3 | right-size the obviously over-supplied: `spaceship3`'s four 1024² maps on 2,819 verts | low | 21 MB → ~5 MB before KTX2 even applies |
| 4 | trim `table` (197k verts) and `black_hole` (368k) | low — a table at an angle, a sphere behind a lens | −500k vertices per frame |

**Stop here and measure.** Phase 1 has no head script, no `localStorage`, no device test, no upgrade
window, no per-model ladders and no extra files. It is a build-script change plus a loader swap, and
every visitor gets a site that looks exactly like today's. If the laptop is smooth after this, Phase 2
may not be worth its complexity at all.

### Phase 2 — the tiers, if Phase 1 was not enough

| # | change | risk | payoff |
|---|---|---|---|
| 5 | the per-model ladders + generated manifest + **the §5.3 assertions** | low | the variants exist, and cannot be subtly different models |
| 6 | `optimizeTextures.mjs` → ladders for basalt + geode (§5.5) | none | 0.82 MB, encoded properly from surviving sources |
| 7 | the emissive dilate / `emitThreshold` compensation (§5.4) | **medium — this is a look change** | the fleet still glows at `potato` and `low` |
| 8 | `lib/assetTier.ts` — resolver, per-model pinning, manifest-derived `SOURCE_WEIGHTS` | low | every path goes through one place; kills a standing ⚠ |
| 9 | head classifier + tiered sun preload | **medium** — it is in the critical path of every load | the phone stops paying for a hero-sized star |
| 10 | stage-2 measurement in `gatherRenderer` + the worker's first reply | low | the fleet is chosen from evidence |
| 11 | fold `lowPower` into the tier | low | one quality authority instead of two |
| 12 | stage-3 hero upgrade window | medium | strong machine on a bad pipe stops being punished for it |

5–8 are inert until 9. **7 must land before 9**, or the first tiered load is also the first load where
the ships stopped glowing and the two causes are indistinguishable. 12 is genuinely optional and
should ship last, or not at all if 5–11 already read well.

### One thing that could go UP, not down

§3.1 says there can be no tier above today's quality, and for five models that is true. But
`models-src/` still holds the pristine `star_aventure_spaceship_starship_fighter.glb` (3.56 MB raw)
and `champion_astro_ring.glb`. If a genuinely high-end tier is ever wanted, those two are the only
assets on the site that could actually be re-encoded *upward*. It is a small prize — the AI ship is
already the fleet's lightest hull at 0.38 MB — and it is the only place the answer to "can we make it
better rather than smaller" is yes without re-sourcing from Sketchfab.

---

## 11 · Still needs eyes

Nothing below is measured, and the first two cannot be settled by reading.

1. **Whether the fleet still glows at `low`** (§5.4). The single most important check in the plan, and
   the only one where a file-size table actively lies to you. Look at the four ships with bloom on.
2. **The four decimations.** `spaceship` at 0.5 and `table` at 0.5 should be invisible; `black_hole`
   at 0.4 will soften the concentric rings its recipe explicitly protects, and `cargo` at 0.5 is
   unknown. Build them and look at all four before the ratios are written down as final. Check the
   **normal maps** rather than the colour — that is where a downscale shows first.
3. **Whether `low`'s 256² textures are acceptable at all** on the sun. It is 94 % textures and it is
   the subject of the hero — the one model where the tier is most tempting and most visible.
4. **The classifier's thresholds.** Where `low` ends and `mid` begins is a guess until it has been run
   against a real phone and a real throttled desktop.
5. **The slope threshold in stage 2.** How much a tripled fill rate is allowed to cost before the
   machine is judged incapable. Start permissive: a wrong `low` is a soft site, a wrong `high` is a
   thrashing driver.
6. **Repo weight, decided before the first commit.** 21 model files, ~17 MB, and git keeps every
   rebuild forever (§9b). If that is too much, `low`/`mid` are generated in CI instead — at the cost
   of the build no longer being reproducible from a checkout.
7. **When to deploy.** The rename invalidates every returning visitor's cache once (§9b). Not a
   blocker, but it should be a decision rather than a surprise.
