# Black hole — raw model restoration plan

> **BUILT** (committed in `53c3f18`). Two things from this document are still outstanding: the blue-face
> question in §2.5/§4 is unresolved, and the CC-BY-4.0 attribution has not landed anywhere on the site.
> Both are tracked in **`docs/sun-lab-remaining-work.md`**.

**Goal:** make the Sun Lab's "New black hole" tab show the *actual* model with nothing applied, so its
colours match the source and every HUD control does what it says. Today it shows a hand-rebuilt guess.

Everything below was verified against the real asset, not assumed. Commands were run; outputs are quoted.

---

## 1. Diagnosis

### 1.1 `temp/black_hole` is the same asset as `public/models/black_hole.glb`

Swapping to it changes nothing:

| | `public/models/black_hole.glb` | `temp/black_hole/scene.gltf` |
|---|---|---|
| materials | the same 9 | the same 9 |
| textures | the same 12 PNGs | the same 12 PNGs |
| size | 30 MB | 30 MB |
| Draco | **no** | no |
| `KHR_materials_pbrSpecularGlossiness` | **yes** | yes |

The shipped GLB is just the Sketchfab export in a container.

### 1.2 three.js r184 cannot read this model's materials at all

```
$ grep -c "pbrSpecularGlossiness" node_modules/three/examples/jsm/loaders/GLTFLoader.js
0
```

Three.js removed `KHR_materials_pbrSpecularGlossiness` in r151. Every one of this model's 9 materials
defines its colour **and every texture reference** *only* inside that extension. So the loader produces
9 default `MeshStandardMaterial`s — white, `metalness 1`, `roughness 1`, **zero textures**:

```
    black_hole.glb                GLTFLoader (r184)              what you get
  ┌────────────────────┐        ┌──────────────────┐        ┌──────────────────┐
  │ KHR_materials_pbr  │        │  extension not   │        │  white           │
  │ SpecularGlossiness │──────► │  registered      │──────► │  metalness 1     │
  │  · diffuseFactor   │        │  → block ignored │        │  roughness 1     │
  │  · diffuseTexture  │        │                  │        │  NO textures     │
  │  · glossiness      │        └──────────────────┘        │  = chrome mirror │
  └────────────────────┘                                    └──────────────────┘
```

`useSunLabScene.ts:49-94` (`BLACK_HOLE_MATERIAL_BASE`, `BLACK_HOLE_DIFFUSE_TEX`,
`BLACK_HOLE_EMISSIVE_TEX`) exists solely to hand-rebuild what the loader dropped.

### 1.3 That rebuild is why the colours are wrong

Decoded from the spec-gloss block vs. what the code forces:

| material | artist intended | code forces | |
|---|---|---|---|
| `light1/2/3` | diffuse `#ffffff` | `0x000000` | ✗ |
| `light1/2/3` | emissive neutral white | gold `0xffb84d`–`0xffd480` | ✗ |
| `light1` | `emissive_strength` ×2.0 | ignored | ✗ |
| `light1/2/3` | real emissive maps | replaced with custom greyscale masks | ✗ |
| `ring` | diffuse `#bcbcbc` | `0xffffff` — ~2× too bright | ✗ |
| `Planet` | diffuse `#bcbcbc` | `0xffffff` | ✗ |
| `ring` | `KHR_texture_transform` scale `[2,1]` | ignored | ✗ |
| `ring2` | `ring_specularGlossiness.png` as diffuse | same | ✓ **correct — the model really does author it this way** |

**And the registry captures its defaults *after* this rewrite** (`useSunLabScene.ts:969` runs after the
traverse at `:917`). So the lab's "Reset" returns to the hand-authored guess, not the model. The tool is
mislabelling a look as the base — the thing this plan removes.

### 1.4 Dead HUD controls (a separate bug class)

React-side routing: these handlers only search the **sun's** registry, and the group ids are disjoint —
sun `core/corona/cells/flares/planes` vs black hole `horizon/glow/rings/planet`.

| # | control | file:line | failure |
|---|---|---|---|
| 1 | group **Reset** | `SunLab.tsx:322` | group never found → early return, button dead |
| 2 | group **show/hide all** | `SunLab.tsx:336` | same → dead |
| 3 | shared-material **Reset** | `SunLab.tsx:312` | override dropped but live material never restored |
| 4 | fracture-spread slider | `ObjectControls` `GroupPanel` | black hole's `cellSpread` is `{shards: [], radius: 1}` → moves, does nothing |
| 5 | **Fit camera** | `useSunLabScene.ts:580` | not exposed on this tab; also fits `modelRoot`, which standalone scales to 0 |
| 6 | ring scale fields | `useSunLabScene.ts:729` | stale `ringForm.currentForm` from a scrubbed finale multiplies the value |
| 7 | `color` on `light1/2/3` | — | forced-black diffuse → picker has no visible effect |
| 8 | `metalness` (all) | — | forced 0 + `envMapIntensity` 0 → nothing to modulate |

---

## 2. The fix: convert the asset offline

`@gltf-transform/cli` (already used by `scripts/optimizeModels.mjs`) has `metalrough`, which bakes
spec-gloss into real metallic-roughness — including generating proper baseColor + metalRough textures.

### 2.1 Verified result

```
$ gltf-transform metalrough black_hole.glb bh_mr.glb
$ gltf-transform optimize bh_mr.glb bh_final.glb \
    --texture-size 1024 --texture-compress webp --compress draco \
    --simplify false --join false --flatten false
```

| material | baseColor | α | metal | rough | alpha | emissive | maps |
|---|---|---|---|---|---|---|---|
| `black_hole_blackoutside` | `#000000` | 1.000 | 0.00 | 1.00 | MASK | 0.00 | base, metalRough |
| `black_hole_light3` | `#ffffff` | 1.000 | 0.00 | 0.83 | MASK | 0.20 | base, emis |
| `black_hole_light2` | `#ffffff` | 1.000 | 0.00 | 0.67 | MASK | 0.60 | base, emis |
| `black_hole_light1` | `#ffffff` | 1.000 | 0.00 | 1.00 | MASK | **1.00 ×2** | base, emis |
| `black_hole_distortion` | `#000000` | 0.000 | 0.00 | 1.00 | BLEND | 0.00 | — |
| `black_hole_center` | `#000000` | 0.888 | 0.00 | 1.00 | BLEND | 0.00 | — |
| `ring` | `#bcbcbc` | 1.000 | 0.00 | 1.00 | BLEND | 0.00 | base, metalRough |
| `ring2` | `#bcbcbc` | 0.200 | 0.00 | 1.00 | BLEND | 0.00 | base, metalRough |
| `Planet` | `#bcbcbc` | 1.000 | 0.00 | 1.00 | OPAQUE | 0.00 | base, metalRough |

Spec-gloss gone. Every material non-metallic with its true colour, alpha mode, and emissive strength.
Roughness reads `1.00` on the textured ones because the glossiness was baked into the metalRough map.

**Size: 30 MB → 2.9 MB (−90%).**

All four surviving extensions are supported by three r184 (`grep -c` in `GLTFLoader.js` = 3 each):
`KHR_materials_specular`, `KHR_materials_ior`, `KHR_texture_transform`, `KHR_materials_emissive_strength`.

> `KHR_materials_specular`/`ior` make three build a `MeshPhysicalMaterial`. That is **not** a problem:
> it extends `MeshStandardMaterial`, so `isEditableMaterial` (`sunLabModel.ts:134`) and
> `materialKindOf` already accept it. No lab change needed. Verified by reading, not assumed.

### 2.2 Three flags that are NOT optional

```
--join false      3x "blackoutside" + 4x "ring2" share materials. Joining collapses them into
                  one mesh each, destroying the lab's object tree and renumbering every id
                  (uniqueId() emits name, name#2, name#3…) — which orphans saved overrides.

--flatten false   optimize's flatten step DELETES the "black hole" parent node.
                  useSunLabScene.ts:957 does getObjectByName("black hole") ?? blackHoleModel —
                  losing it silently falls back to the whole model, so the off-centre Planet
                  skews the centring and fit. This is the exact case that line guards against.
                  Verified: with flatten on → node absent; with --flatten false → present.

--simplify false  Spheres, rings and a thin disc. Decimation visibly chews concentric rings for
                  a saving Draco already delivers.
```

Mesh counts confirmed identical before and after with these flags.

---

## 2.5 Will it match the Sketchfab render?

**Not on its own — and the plan should not pretend otherwise.** The conversion fixes the *materials*.
The Sketchfab reference is materials **plus** things that are not in the file.

Verified: `extras` is `{}` on every material, and there are no top-level extras. Sketchfab keeps its
viewer configuration server-side; the glTF export carries none of it.

### What the file genuinely contains (conversion restores all of it)

- Correct base colours, roughness, alpha modes, emissive factors + the `×2` strength on `light1`
- **All 12 textures actually loading.** Today zero of them load.

The ingredients are all present and currently unused:

| texture | what it is |
|---|---|
| `ring_diffuse.png` | the gold banded accretion disc — the disc's entire colour |
| `light1/2/3_emissive.png` | the gold / white / teal / lavender arcs over the hole |
| `ring_specularGlossiness.png` | `ring2`'s diffuse (the model authors it this way — not a mistake) |

### What the file does NOT contain

| missing | consequence |
|---|---|
| Sketchfab's lighting environment | not exported; the lab supplies its own key/fill/ambient |
| Post-processing / tone mapping / grading | the lab has its own bloom + ACES to stand in |
| **Per-material blend mode** | **glTF has only OPAQUE / MASK / BLEND. Sketchfab supports Additive.** |

That last row is the significant gap:

```
  Sketchfab (additive)                    three.js (glTF BLEND)
  ┌──────────────────────┐                ┌──────────────────────┐
  │  ring                │                │  ring                │
  │  + ring2  α .2       │  colours       │  ring2  α .2  over   │  each layer
  │  + ring2  α .2       │  ACCUMULATE    │  ring2  α .2  over   │  REPLACES
  │  + ring2  α .2       │  toward white  │  ring2  α .2  over   │  the last
  │  + ring2  α .2       │                │  ring2  α .2         │
  └──────────────────────┘                └──────────────────────┘
     saturated glowing core                  flat translucent grey
```

The reference image's saturated white core is additive accumulation across the 4 stacked `ring2`
meshes. Under standard alpha blending the same geometry composites flatter and darker.

### The blue-over-the-hole question

Tested the obvious explanation and it does **not** hold: `light1/2/3` are `alphaMode: MASK`, but 0% of
their diffuse alpha falls below the 0.5 cutoff, so nothing is discarded. The blue lower region of
`light1_emissive.png` is genuinely mapped onto geometry.

Why Sketchfab does not show it as blue cannot be settled from the files — most plausibly additive
blending washing it out against black, or UVs placing it on the far/outer side. **This needs a render to
answer.** Do not plan around either guess.

### Consequence for the plan

Add a **blending control** to the lab (Phase C5). It is the single biggest lever between the raw glTF
and the reference, and today it is not editable at all. Making it a general per-material control —
rather than hardcoding `AdditiveBlending` onto `ring2` — is what keeps this a tool and not a pipeline.

---

## 2.6 Scene contamination audit

Question asked directly: *is anything else in the scene affecting the black hole?* Full inventory,
from `grep` over the lab, not memory.

### Models — exactly three things render

| object | in standalone mode | verdict |
|---|---|---|
| `fractured_sun.glb` (`modelRoot`) | `scale.setScalar(0)` — **scaled, not hidden** | ⚠ see below |
| `black_hole.glb` (`blackHoleGroup`) | the subject | — |
| `particlePoints` | `visible = false` | ✓ clean |

No other model is loaded anywhere in the lab. Confirmed: the only `.glb` paths in
`components/lab/SunLab/**` are `fractured_sun.glb` and `black_hole.glb`.

⚠ **The sun is scaled to zero, not hidden.** Zero-scale geometry rasterises no pixels, so it does not
*visibly* leak — but it is still traversed and submitted every frame, and it is why `fitCamera` degenerates
(§1.4 #5). Fix: `modelRoot.visible = false` in `showBlackHoleStandalone`, restored in
`exitBlackHoleStandalone`.

### Light sources — exactly four, plus an IBL, plus bloom

| source | standalone | reaches the black hole? |
|---|---|---|
| `keyLight` (Directional) | set from settings — **approved base is 3.6** | **YES — specular** |
| `fillLight` (Directional) | set from settings, 0.3 | **YES — specular** |
| `ambientLight` (Ambient) | set from settings, 0.75 | diffuse only → ×black albedo = 0 ✓ |
| `coreLight` (Point, at origin) | `intensity = 0` | ✓ explicitly killed |
| **`scene.environment` = PMREM(`RoomEnvironment`)** | neutralised by `envMapIntensity = 0` | ✓ *only* because of that |
| `UnrealBloomPass` | strength from settings | **YES — bleeds over the silhouette** |

`scene.environment` is a **studio room IBL the lab adds** — it is not from the model and the model was
never authored for it. `envMapIntensity = 0` fully zeroes both its diffuse and specular paths, so the
approved base is clean. But note it is only applied when `showBlackHoleStandalone` runs.

Bloom is a screen-space effect: it blurs the bright disc *across* the hole's silhouette, hazing it grey.
That is not lighting and cannot be fixed with material values — keep `strength` low or `threshold` high.

### Cross-contamination bug found while auditing

`applyFullState` (`SunLab.tsx:155-156`) calls `applyRegistry(handle.blackHoleRegistry)` — so **the sun's
state is applied to the black hole's materials**. Since a sun state has no black-hole material names, it
writes `shared.defaults`, silently resetting every black-hole material whenever the sun tab applies.
Self-correcting on tab switch, but it is real cross-talk between two things the design claims are walled
off. Fix: scope `applyFullState` to the sun's registry only.

---

## 2.7 Guaranteeing a genuinely black hole

This is the requirement that most changes the plan, because **the conversion makes the horizon *more*
reflective, not less.**

### The finding

`metalrough` cannot express an arbitrary specular colour with a normal IOR, so it encodes the original
`specularFactor` as `KHR_materials_ior: 1000` plus `KHR_materials_specular.specularColorFactor`:

```
F0 = ((ior − 1) / (ior + 1))²  ×  specularColorFactor
   = ((999) / (1001))²         ×  specularColorFactor
   = 0.996                     ×  specularColorFactor
```

| material | specularColorFactor | resulting F0 | vs. today |
|---|---|---|---|
| **`black_hole_blackoutside`** | 0.2 | **0.199 — 20% reflectance** | **5× today's 0.04** |
| `black_hole_center` | 0.0 | 0.000 ✓ | — |
| `black_hole_light1` | 0.0 | 0.000 ✓ | — |
| `black_hole_light2` | 0.05 | 0.050 | — |
| `black_hole_light3` | 0.041 | 0.041 | — |
| `ring` | 0.5 | 0.498 | — |
| `ring2` | 0.596 | 0.594 | — |
| `Planet` | 0.547 | 0.545 | — |

Today the hack produces a plain `MeshStandardMaterial`, whose dielectric F0 is fixed at **0.04**. After
conversion `blackoutside` becomes a `MeshPhysicalMaterial` at **F0 0.199**.

**`envMapIntensity = 0` does not save this.** It zeroes the *environment* path only. Direct lights still
generate specular — and the approved base runs the key light at **3.6**. The result is a glossy black
billiard ball with a broad highlight, not an event horizon.

### The fix, and why it is airtight

A surface renders black iff every term of its BRDF is zero:

```
  diffuse   = albedo × irradiance      albedo #000000          → 0  ✓ already
  emissive  = emissive × intensity     emissive #000000        → 0  ✓ already
  IBL       = env × envMapIntensity    envMapIntensity 0       → 0  ✓ already
  specular  = F0-driven, from LIGHTS   F0 = 0.199              → NOT 0   ✗
```

Specular is the only non-zero term. Three's `MeshPhysicalMaterial` computes:

```glsl
specularColor = mix(min(pow2((ior-1)/(ior+1)) * specularColorFactor, 1.0) * specularIntensity,
                    diffuseColor, metalness);
specularF90   = mix(specularIntensity, 1.0, metalness);
```

With `metalness = 0` and **`specularIntensity = 0`**, both `specularColor` and `specularF90` collapse to
zero — the specular term vanishes identically, for every light, at every angle.

So: **black albedo + `specularIntensity 0` + `envMapIntensity 0` is mathematically unlightable.** No light
intensity, no exposure, no environment can lift it above zero. Only bloom bleed from *neighbouring*
pixels can haze it, and that is a post-process, not lighting.

`specularIntensity` is not currently editable anywhere — Phase C6 adds it.

---

## 2.8 The four questions, answered

**Will it work?** For materials, textures and size — yes, verified end to end. For "looks like Sketchfab"
— no, not without blending (§2.5). For "completely black" — **no, it gets worse first** (§2.7), and C6 is
what makes it true.

**What are the side effects?**

1. `blackoutside` reflectance **0.04 → 0.199**, so the hole gains a specular sheen until C6 lands
2. `ring` / `ring2` / `Planet` land at F0 ≈ 0.5–0.59, so they catch strong direct-light highlights
3. All 9 materials become `MeshPhysicalMaterial`. **Verified harmless** — it extends `MeshStandardMaterial`,
   so `isEditableMaterial` (`sunLabModel.ts:134`) and `materialKindOf` already accept it, unchanged
4. Saved localStorage state still applies (ids stable) but sits on a different base — expect it to look
   wrong until reset
5. The `metalrough` step is lossy in principle; `models-src/` keeps the original so it is re-runnable

**Is it like the base?** Yes — and that is the point: the registry finally captures the model's own values,
so Reset means reset. But note "base" now means *the artist's true material values*, which include that
20% specular. "Base" and "reads as a black hole" are not the same thing — C6 is the bridge.

**Is it more glowy?** Net yes, and much more colourful:

| layer | today (hack) | after conversion | change |
|---|---|---|---|
| `light1` | 1.35, gold tint on a **greyscale mask** | **2.0** (emissive 1.0 × `emissiveStrength` 2.0), **full-colour map** | **+48%, far more colourful** |
| `light2` | 0.85 | 0.6 | −29% |
| `light3` | 0.22 | 0.2 | ≈ same |
| `ring` | flat `#ffffff` | `#bcbcbc` + real banded texture | dimmer but detailed |

So the bright arcs get brighter and gain their real colour, while the mid layer softens. More pixels
cross the bloom threshold, so **expect to lower `bloom.strength` from the current 0.03 baseline.**
Checked: the HUD's `emissiveIntensity` slider maxes at 8, so 2.0 needs no range change.

---

## 3. Changes

### Phase A — asset pipeline

```
models-src/black_hole.glb          ← NEW (copy of today's public glb; it IS the raw export)
                                     models-src/ is gitignored, the established home for raw sources
temp/black_hole/                   ← DELETE after copying license.txt out
                                     (30 MB, NOT gitignored — one `git add .` away from a commit)
public/models/black_hole.glb       ← REBUILT, 30 MB → 2.9 MB
public/models/black_hole_tex/      ← DELETE the 6 *_diffuse / *_specularGlossiness copies
                                     (superseded by the converted model's own maps)
                                     KEEP the 3 *_emissive_mask.png + README until the
                                     blue question in §2.5/§4 is answered by a real render
public/models/blackhole.glb        ← flag for deletion (14 MB, referenced nowhere)
```

`scripts/optimizeModels.mjs` needs two small additions:

1. a `specGloss: true` recipe flag that runs `metalrough` into a temp file before `optimize`
2. pass-through for `--flatten` (currently not a flag the script emits)

```js
"black_hole.glb": {
  // Sketchfab spec-gloss export. three r151+ dropped that extension, so without this
  // conversion the loader yields 9 white chrome-mirror materials with no textures at all.
  specGloss: true,
  // See §2.2 — each of these three protects something the lab depends on.
  join: false,      // 3x blackoutside / 4x ring2 would merge and renumber every object id
  flatten: false,   // flatten deletes the "black hole" node useSunLabScene.ts:957 centres on
  simplify: false,  // rings and a thin disc; Draco already does the work
},
```

### Phase B — delete the runtime rebuild (`useSunLabScene.ts`)

| lines | action |
|---|---|
| 49-77 | delete `BLACK_HOLE_MATERIAL_BASE` |
| 81-85 | delete `BLACK_HOLE_DIFFUSE_TEX` |
| 90-94 | delete `BLACK_HOLE_EMISSIVE_TEX` |
| 916-953 | delete the whole `blackHoleModel.traverse(...)` material rewrite + `TextureLoader` |

Net ≈ 70 lines removed. The load path becomes: load → centre on `"black hole"` → fit → build registry.
The registry then captures the **model's own values** as defaults, so Reset means reset.

### Phase C — fix the dead controls

**C1 — route through the active registry** (`SunLab.tsx`). One helper, three call sites:

```ts
// The registry the HUD is currently editing — the sun's, or the black hole's own.
const activeSceneRegistry = () =>
  activeModelRef.current === "blackhole"
    ? handleRef.current?.blackHoleRegistry
    : handleRef.current?.registry;
```

- `resetGroup:322` → `activeSceneRegistry()?.groups`
- `broadcastGroupVisible:336` → same
- `resetSharedMaterial:312` → `activeSceneRegistry()?.sharedMaterials`

Guard `resetGroup`'s `groupId === "cells"` fracture branch so it stays sun-only.

**C2 — hide the meaningless fracture slider.** `GroupPanel` takes a `hasShards` prop; `SunLab` passes
`(activeRegistry?.cellSpread.shards.length ?? 0) > 0`. Renders nothing for black-hole groups rather
than a slider that does nothing.

**C3 — Fit camera on the black hole tab.** In the scene, make `fitCamera` frame whatever is on screen:

```ts
const fitTarget = () => (blackHoleStandalone ? blackHoleGroup : modelRoot);
```

Expose the button in `BlackHoleSettings` alongside Reset.

**C4 — kill the stale ring form.** `showBlackHoleStandalone` calls `applyRingForm(1, 1)` on entry, so a
half-scrubbed finale can never leave the rings at a partial multiplier while you edit their scale.

**C5 — blending + depthWrite controls (see §2.5).** The one lever that can close the gap to the
Sketchfab reference, and currently not editable anywhere.

Add to `MaterialParams` (`sunLabState.ts`) — it flows through copy / reset / snapshot automatically
because everything reads from that one schema:

```ts
/** How the material composites. "additive" is what makes stacked glow layers accumulate to white. */
blending: "normal" | "additive" | "multiply";
/** Off lets stacked transparent layers all show through instead of the nearest one winning. */
depthWrite: boolean;
```

- `readMaterialParams` / `applyMaterialParams` (`sunLabModel.ts:105,120`) map to `THREE.NormalBlending`
  / `AdditiveBlending` / `MultiplyBlending` and `material.depthWrite`
- `MaterialPanel` gets a 3-way segmented control + a checkbox, matching the existing `Section` styling
- `normalizeState` gives older saved states `"normal"` / `true`, so nothing already stored breaks

Worth trying first on the 4 stacked `ring2` meshes and the `light1/2/3` domes — the layers §2.5
identifies as the additive ones.

**C6 — `specularIntensity` control (the black-hole guarantee, see §2.7).** Without this the converted
horizon is *more* reflective than today's. Add to `MaterialParams` alongside C5's fields:

```ts
/** Dielectric specular strength. 0 makes a black surface mathematically unlightable — see §2.7. */
specularIntensity: number;
```

- `readMaterialParams` / `applyMaterialParams`: read/write `material.specularIntensity`, guarded by
  `material instanceof THREE.MeshPhysicalMaterial` (it is absent on `MeshStandardMaterial`/`MeshBasicMaterial`)
- `MaterialPanel`: slider 0..1, shown only for physical materials
- `normalizeState`: default `1` so existing saved states are unchanged
- **Base state**: `black_hole_blackoutside` → `specularIntensity: 0`. `black_hole_center` is already
  `specularColorFactor 0`, so it needs nothing — verified.

**C7 — standalone isolation (see §2.6).** Three small corrections so the tab is genuinely alone:

- `showBlackHoleStandalone`: `modelRoot.visible = false` (not just `scale 0`);
  `exitBlackHoleStandalone` restores `visible = true`
- `fitCamera` frames `blackHoleStandalone ? blackHoleGroup : modelRoot` (this is also C3)
- `applyFullState` stops calling `applyRegistry(handle.blackHoleRegistry)` — the sun's state must not
  touch black-hole materials

### Phase D — re-establish the base look

`createBlackHoleInitialState()` (`sunLabState.ts:159`) was tuned against the *hacked* materials, so its
numbers (`exposure 0.98`, `bloom 0.03`, `key 3.6`, `envIntensity 0`) will not mean the same thing.

Plan: reduce it to a neutral starting point, hand it over, you dial the look in the lab, then we save
your numbers back as the approved base. `objects: { Planet_Planet_0: { visible: false } }` stays valid —
that node survives the conversion (verified).

---

## 4. Risks, stated plainly

**The blue face probably comes back — but this is genuinely unresolved.** Your `*_emissive_mask.png`
files solved a real problem: the domes wrap over the hole and the true emissive maps tint that face
blue. Restoring the real maps restores the blue.

What is *not* known is why Sketchfab does not show it (see §2.5). The MASK-culling explanation was
tested and ruled out. So do not assume either outcome — the first render after Phase A+B answers it, and
that answer decides whether C5's additive blending removes the problem on its own.

Keep `public/models/black_hole_tex/*_emissive_mask.png` until that render exists. If the blue survives
additive blending, the masks return as an explicit lab toggle, not a hidden load-time force. Raw first,
art-direct second. (Phase B still deletes the *diffuse* hack textures — those are unambiguously
superseded by the converted model's own maps.)

**localStorage survives.** Object ids and material names are unchanged, so your saved black-hole state
still applies — on top of a different base. Expect it to look wrong until reset. "Fresh start" clears it.

**One-way on the source.** `metalrough` is an approximation; spec-gloss → metal-rough cannot always be
represented exactly. This asset is the clean case (non-metallic, neutral `specularFactor 0.5`), and
`models-src/` keeps the original, so it is always re-runnable.

---

## 5. Order of work

```
A ─ asset pipeline ────► rebuild glb, verify in lab ──┐
                                                       ├──► D ─ re-dial base look
B ─ delete rebuild ────► raw colours visible ─────────┘
C ─ fix dead controls ─► independent of A/B, can land either side
```

A and B must land together — B without A leaves a chrome mirror. C is independent.
Verification is `npx tsc --noEmit` plus your own check at `/sun-lab`.
