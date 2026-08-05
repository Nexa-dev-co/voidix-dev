# Performance audit — 2026-08-02

Measured against the tree as it stands after the cleanup. Nothing here is speculative advice; every
number below came out of the repo. Ordered by **payoff ÷ risk**, not by size.

---

## The shape of the problem

The site's cost is not the JavaScript. It is **17–18 MB of models and textures that must all land
before the intro will hand off**, and then a per-frame budget dominated by two `UnrealBloomPass`
pipelines running at up to 2× device pixels.

```
  FIRST LOAD, before the loader can finish
  ┌────────────────────────────────────────────────────────────────────┐
  │ ships ×4        ████████████████████████████████████  8.6 MB       │
  │ basalt-magma    ██████████████                        3.3 MB  ◄─┐  │
  │ geode-druse     ██████████████                        3.2 MB  ◄─┤  │
  │ fractured_sun   █████                                 1.3 MB    │  │
  │ table           ██                                    0.6 MB    │  │
  │ small textures  ██                                    0.5 MB    │  │
  │ JS (first load) ████                                  0.17 MB   │  │
  └─────────────────────────────────────────────────────────────────┼──┘
                                                                    │
   deferred, correctly: black_hole.glb (3.0 MB) — lazy behind ───────┘
   `ensureSingularity`, so it is NOT in the gate.   two PNGs = 37% of the
                                                   gate, for ~0.4 MB of
                                                   actual image content
```

The good news: the systems that usually go wrong here are already right. Both heavy scenes gate on
`document.hidden`, the fluid cursor gates on hero visibility, the deck and works field gate each other
off, and `adaptivePixelRatio` is a genuinely careful controller. **Do not rebuild any of that.**

---

## Tier 1 — do these; they are close to free

### 1 · The two 1254×1254 PNGs → WebP  ⭐ biggest single win

`basalt-magma.png` (3.34 MB) and `geode-druse.png` (3.23 MB) are **PNG-encoded photographic
textures**. PNG is lossless and has no business carrying rock noise. At WebP q80 these land around
150–250 KB each.

```
  6.57 MB  ──WebP q80──▶  ~0.4 MB        94% off, on 37% of the load gate
```

There is already a tool for exactly this problem — `scripts/optimizeModels.mjs` caps model textures at
1024² WebP. These two files never went through it because they are standalone, not embedded in a GLB.

| Pros | Cons |
|---|---|
| ~6 MB off the load gate — by far the largest lever on this site | The source PNGs should be kept out of `public/` (add a `textures-src/`), or the win rots |
| Zero runtime change; same pixels, same VRAM | WebP is lossy — worth an A/B at the actual on-screen scale, though at `stoneTextureRepeat: 2.2` it is tiled small and artifacts are very unlikely to read |
| No code changes beyond two path constants | One-off manual step unless you extend the optimizer script |

**Also worth doing while you're there:** resize to 1024². 1254 is not a power of two and buys nothing;
1024² cuts VRAM per texture from ~8 MB to ~5.3 MB.

### 2 · `antialias: true` on the two renderers that use a composer

`useServicesDeck.ts:359` and `useWorksField.ts:561` both create
`new THREE.WebGLRenderer({ antialias: true })` — and both then render **through an `EffectComposer`**.
The code already knows this is pointless; the comment three lines below the composer setup says a
composer *"ignores the renderer's own `antialias` flag"*, which is why both add an `SMAAPass`.

But the flag still allocates a multisampled default framebuffer, and the driver still resolves it
every frame — for a fullscreen quad that has no interior edges to antialias.

```
  now:  scene ─▶ MSAA composer target ─▶ SMAA ─▶ [MSAA backbuffer] ─▶ screen
                                                  └── allocated, resolved
                                                      every frame, does
                                                      nothing whatsoever
```

| Pros | Cons |
|---|---|
| Pure win: less VRAM, less resolve bandwidth per frame, identical image | None that I can find. The one thing to verify is that no path renders straight to screen bypassing the composer |
| Two-character change in two files | |

### 3 · The stone texture is uploaded to the GPU four times

In `accretionTransition.ts`, `cloneRepeated(this.stoneTexture, ACCRETION_TUNING.stoneTextureRepeat)`
sits **inside `this.marks.map(...)`** — so each of the four marks gets its own clone. `Texture.clone()`
shares the `.image` but takes a new uuid, and three keys its GPU uploads by uuid, so this is four
separate uploads of the same 1254² image with mips.

All four clones are byte-identical: same image, same repeat. Only the core legitimately differs
(`CORE_TEXTURE_REPEAT: 2` vs `stoneTextureRepeat: 2.2`).

```
  now:   mark0 ─clone─┐
         mark1 ─clone─┼─▶ 4 × ~8 MB VRAM        ≈ 32 MB
         mark2 ─clone─┤
         mark3 ─clone─┘
  after: all four ────▶ 1 × ~8 MB               ≈ 24 MB reclaimed
```

| Pros | Cons |
|---|---|
| ~24 MB VRAM back on the heaviest scene on the site | If a future mark ever wants its own repeat, the clone has to come back — worth a comment saying so |
| Fewer GPU uploads during the works build, so a slightly shorter build stall | |
| Hoist one line out of a loop | |

### 4 · Dead weight the cleanup missed

- `public/textures/abstract-layered-formation-…-photo.jpg` (148 KB) — **referenced nowhere**.
- `CHUNK_TEXTURES` in `markChunkMaterial.ts` — the texture-picker registry for the deleted lab. Only a
  comment references it now.

| Pros | Cons |
|---|---|
| Free; deletion only | None. Confirm the registry isn't wanted as documentation of what's available |

---

## Tier 2 — real wins, real trade-offs

### 5 · `star_aventure_spaceship_starship_fighter.glb` is 3.7 MB — ✅ DONE 2026-08-02

**Resolved, and my diagnosis here was wrong.** I guessed the model was "taking the defaults" and
suggested a texture cap. It has no textures at all — every material on it is untextured, so a cap
would have done precisely nothing.

The real cause: it was **the one model that never went through the optimizer**. Generator
`Sketchfab-16.95.0`, no Draco, `f32` attributes, `u32` indices, and a `TEXCOORD_0` on materials with
nothing to sample. Its three sibling ships all read `glTF-Transform` with Draco.

Draco alone took it **3.56 MB → 0.38 MB (−89%)** with the geometry bit-identical in vertex count
(167,565 before and after) and the bounding box unchanged to five decimal places. `simplify` stayed
off, as it is for every hard-surface model in that script. Recipe added, raw export preserved in
`models-src/`.

### 6 · Fluid cursor dye buffer at 1024²

`dyeResolution: 1024` with `densityDissipation: 10.2`. The config's own comment says the dissipation is
pushed "~3× faster than default → no lingering tail". A 1024² dye texture exists to keep long smeared
ink edges crisp — but this ink is deliberately killed almost the moment it is laid.

| Pros | Cons |
|---|---|
| 512² is 4× less bandwidth on every dye pass, every frame the hero is visible | It *is* a visual change: the blob's edge softens slightly. Needs your eyes |
| Only affects desktop — phones already unmount this entirely | The hero is the first impression; this is the one place quality matters most |

### 7 · `adaptivePixelRatio` cannot drop below native

The module's header comment promises it will drop *"even below 1× on a non-retina panel where there's
nothing else to give"* — but `BASE_PIXEL_RATIO = 1` is the floor, so it cannot. On a weak GPU at
dpr 1, the controller has **no move left**: it detects the slowness and can do nothing about it.

| Pros | Cons |
|---|---|
| A 0.75 floor gives the controller ~44% fewer pixels to push on exactly the machines that need it | Sub-native rendering is visibly soft — this is a real quality floor being lowered |
| Fixes a documented-but-unimplemented behaviour | Only helps the weakest tier; invisible to everyone else |
| One constant | |

### 8 · Supersampling to 2× on retina

`MAX_PIXEL_RATIO = 2` means a retina machine renders the works field at 4× the pixel count of 1×,
through bloom + SMAA. That is a deliberate quality-first choice and the controller will back off if it
can't hold 30fps — but 1.5 would still be above native and much cheaper.

| Pros | Cons |
|---|---|
| Large frame-time saving on the heaviest scene, on the most common premium laptop | Directly trades away the crispness the controller was built to buy |
| The controller already backs off — so this only changes the *ceiling*, i.e. the best case | Arguably the wrong direction for an Awwwards target |

---

## Tier 3 — measure before touching

### 9 · The mark's tessellation was never validated after the rig was deleted ⚠

`ACCRETION_TUNING.capEdgeFraction` sits at **0.008 — the absolute floor of its old slider** — with
`capSubdivisions: 2`. Against `markTargetSize: 2.6` that asks for ~0.021 world-unit edges, roughly 124
edges across the mark, and each subdivision quadruples the triangle count (2 subdivisions = 16×).

Its own comment says: *"by far the heaviest setting in the file. Watch the rig's triangle and
build-time read-outs before carrying it into the section."* **That rig is now deleted, so nobody ever
did.** Four marks are cut at this density during the load gate.

This is the one item I would not guess at. The strategy already reports
`metrics.buildMilliseconds` and `bufferBytes` — log them, and read `renderer.info.render.triangles`.
If the four marks are costing tens of MB of buffers and hundreds of ms of build, dropping
`capSubdivisions` to 1 is a 4× reduction and may well be invisible.

| Pros | Cons |
|---|---|
| Potentially the largest per-frame *and* build-time win on the site | Genuinely unknown until measured — could equally turn out to be fine |
| The instrumentation to answer it already exists on the object | Lowering it changes the mark's silhouette fidelity, which is the section's subject |

### 10 · `powerPreference: 'high-performance'` is set on no renderer

On dual-GPU laptops the browser may pick the integrated GPU by default.

| Pros | Cons |
|---|---|
| One-line hint; can be a large win on exactly the machines that struggle | Forces the discrete GPU → more battery drain, and some users dislike that |
| | It's a hint; drivers may ignore it |

---

## What I would actually do, in order

```
  1  two PNGs → WebP 1024²        ~6 MB off the gate      no visual risk
  2  antialias: false ×2          free frame-time         no visual risk
  3  hoist the texture clone      ~24 MB VRAM             no visual risk
  4  delete the dead asset+registry                       no visual risk
  ─────────────────────────────── ship, re-measure ───────────────────────
  5  MEASURE the mark tessellation before deciding anything else
  6  re-run the optimizer on the 3.7 MB ship
  7  the rest are quality trade-offs — your call, not a defect
```

Items 1–4 are unambiguous: they cost nothing visually and remove ~6 MB of download and ~24 MB of
VRAM. Everything below the line involves giving something up, and item 5 should be measured before it
is argued about.

**Not verified by me:** I have not run the app or profiled a real frame. These are static findings —
file sizes, allocation sites and pipeline configuration read from source. The frame-time claims are
reasoned from what the pipeline does, not from a captured profile.
