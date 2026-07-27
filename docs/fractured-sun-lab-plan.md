# Fractured Sun Lab — plan

An isolated authoring tool at **`/sun-lab`** for the new `fractured_sun.glb`. You dial in
lighting, colour, per-layer look, and a full **keyframe timeline** across the sun's four
life stages, then **export presets** that the real hero replays on scroll — so everything is
tuned and approved *before* it touches the live page.

> Status: PLAN (not built). Ship-as-is on file size for now (46 MB) — optimisation is a
> separate later pass, tracked at the end of this doc.

---

## 1. The creative target (the four stages + loader)

The sun has a life cycle, driven by scroll on the real site. Each homepage section is one stage:

```
 SECTION 1 · HERO        SECTION 2 · ?           SECTION 3 · ?           SECTION 4 · ?
 ┌──────────────┐        ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
 │   ( sun )    │        │  ((( sun )))  │       │   sun ✷ ✷    │        │      ●        │
 │  peaceful    │   →    │  vibrating,   │   →   │  shattering,  │   →   │  black hole   │
 │  a few       │        │  lights       │        │  cells fly    │        │  shards spiral│
 │  cylinders   │        │  changing     │        │  apart        │        │  into the dark│
 │  appear      │        │               │        │               │        │               │
 └──────────────┘        └──────────────┘        └──────────────┘        └──────────────┘
   calm rotation          noise jitter +          per-cell explode        collapse + accretion
   cylinders fade in       emissive pulse          (built-in fracture)     disk + in-spiral

 PROCESS section: no sun.
```

**Loader** (downstream, not part of lab v1): the wordmark **voidix** where the **O is the sun**,
playing like a movie trailer — quick glimpses of all four stages (including the black hole),
each flash tinting what the user sees. The lab makes this possible by being able to **jump to
any stage instantly** and snapshot it. Called out in §8; the lab is what feeds it.

---

## 2. What the model actually is (the parts map)

`fractured_sun.glb` — 50 meshes / 82 nodes / 5 materials / 8 textures, `KHR_materials_unlit`
on 4 of 5 materials, **no baked animations**. Verified by walking the node graph (world
positions), it groups **1 material → 1 layer**, into **5 controllable layers**:

```
 LAYER            MESHES  MATERIAL    LIT?   WHERE (dist from origin)     STAGE IT SERVES
 ─────────────────────────────────────────────────────────────────────────────────────────
 Rays / Cylinders 8       flare        no     radial spikes @ ~1.0         Stage 1 "cylinders appear"
 Edge glow        20      blowout      no     halo planes @ ~1.0           soft outer glow / bloom, Stage 2 pulse
 Inner core       11      sun_inner    no     centre @ 0–0.7               Stage 1–2 heat, black-hole core
 Outer shell      11      sunouter     no     corona skin @ ~0.5 (81% α)   the atmosphere, fades on shatter
 Magma shards     10      magma        YES    fracture cells @ ~0.57       Stage 3 shatter, Stage 4 in-spiral
                          (Color+Rough+Normal+Emission — full PBR)
```

Two facts that make the plan very achievable:

- **The sun is already pre-shattered.** The 10 `Sphere_0_cell.*` magma nodes are Voronoi fracture
  pieces — AND the inner/outer shells carry matching cell pieces (`Sphere_0_cell.*` /
  `transp_Sphere_0_cell.*`). So a "shard" is a stack: **magma cell N + inner cell N + outer cell N**
  fly together. Stage 3 = push each stacked cell outward along its centroid direction. Explode
  vectors computed once at load; nothing faked.
- **The cylinders ARE the `flare` material** (verified — 8 radial spikes at distance ~1.0, no
  other layer uses it). So "some cylinders appearing" is one clean layer to reveal/stagger.

> Two groupings, two purposes: **by material (5 layers)** for look control (colour/emissive/opacity),
> **by cell index** for motion (each shard stack flies as one). `sunModel.ts` exposes both.

### The lighting truth (read before designing lighting controls)

**4 of 5 materials are *unlit* — self-illuminated sprites.** Only the magma shards respond to
real lights. That is *correct* for a star (it emits, it doesn't receive). So "control the
lighting inside the sun" means, in practice:

1. **Emissive control + bloom** on the unlit layers — this is 90% of the look.
2. **Real lights** matter for the shards, and for the light the dying sun *casts* in Stage 4.
3. A **"Relight mode" toggle**: convert the unlit materials → `MeshStandardMaterial` with the
   base texture wired to `emissive`, so lights + the colour tint affect *everything* uniformly.
   Default ON (you asked for lighting control); OFF shows the model exactly as authored.

---

## 3. The control surface

Six control groups. All live React state (LetterLab pattern), debounced into the scene.

### A. Per-layer (the 6 layers above)
- visibility toggle · opacity · **base colour** · **emissive colour** · emissive intensity
- This is the raw multi-colour mixing: cyan core + magenta shards + white flares, per layer.

### B. Global colour ramp (the "mix of multi colours" mixer)
- **3-stop gradient**: `core → mid → edge`, tinting all emissive across the sun's radius.
- Because the emissive textures are near-greyscale glow, a tint ramp recolours the whole star
  instantly and blends colours across it.
- A single **temperature** slider shifts the whole palette at once (peaceful cyan → white-hot →
  violent orange → cold black-hole blue).

### C. Lighting + post
- **Bloom** (UnrealBloomPass): threshold · strength · radius. *The single biggest look lever —
  flat sprites become a glowing star only with bloom.*
- Light rig: 2–3 lights (colour · intensity · position) that hit the shards + Relight-mode layers.
- Ambient level. Exposure / tone-mapping toggle.

### D. Motion (each of these is an animatable property, see §4)
- rotation speed · vibration amplitude + frequency · emissive pulse amount + speed
- cylinder reveal (0→1, with per-cylinder stagger)
- **shatter**: amount (0→1 explode) · spin-on-release · stagger · drift/gravity
- **black hole**: amount · core radius · accretion-disk speed · shard in-spiral · lens warp

### E. Stage system
- Four named stages sit as **markers on the timeline**. "Jump to stage" moves the playhead
  there (also what the loader trailer needs).

### F. Camera + export
- Orbit camera (drag), distance, optional keyframed camera moves.
- **Export**: the whole timeline + layer setup as JSON *and* pasteable TS source (LetterLab's
  copy-config pattern), so it drops into a `sunTuning.ts` the real hero consumes.

---

## 4. The keyframe timeline (the core of v1)

Every animatable property is a **track**. The engine evaluates all tracks at the playhead time
and produces one flat state object the scene applies each frame.

```ts
type EaseId = 'linear' | 'power2.in' | 'power2.out' | 'power2.inOut' | 'power4.out' | ...;

interface Keyframe {
  time: number;                 // seconds along the master timeline
  value: number | [r, g, b];    // colour keys interpolate in RGB
  ease: EaseId;                 // easing INTO this key from the previous one
}
interface Track {
  property: string;             // e.g. 'shatter.amount', 'layer.core.emissiveColor'
  type: 'number' | 'color';
  keys: Keyframe[];             // sorted by time
}
```

**Evaluation:** for time `t`, find the surrounding keys on each track, apply the incoming key's
ease, lerp (numbers) or RGB-lerp (colours). Tracks with no keys hold their default. The output
is a `SunState` the scene reads — the scene never knows about keyframes, only the resolved state
(same clean split as LetterLab: UI → settled settings → scene).

### Timeline UI (bottom of the page)

```
 ┌─ transport ───────────────────────────────────────────────────────────────┐
 │  ⏮  ▶/⏸  ⏭   loop ☐    t = 3.20s / 12.0s    [Stage1][Stage2][Stage3][Stage4]│
 ├─ tracks ────────────────────────────── playhead │ ─────────────────────────┤
 │ rotation.speed     ●───────●──────────────────●                            │
 │ vibration.amp      ─────────●■■■■■■■●──────────────────                     │
 │ core.emissive      ●────●──────────●──────────────●                        │
 │ shatter.amount     ──────────────────────●////////////●                    │
 │ blackhole.amount   ─────────────────────────────────●──────●               │
 │ bloom.strength     ●────●──────●──────────●─────────────────●              │
 │ camera.distance    ●──────────────────────────────────────●               │
 ├─────────────────────────────────────────────────────────────────────────── │
 │   └─ Stage 1 ──┴──── Stage 2 ────┴──── Stage 3 ────┴──── Stage 4 ──┘        │
 └────────────────────────────────────────────────────────────────────────────┘
   ● keyframe    ■/▓ held region    click track+time to add a key · drag to move · dbl-click to delete
```

- **Add a key**: select a property in the inspector, scrub to a time, hit "＋ key" (or click the
  track lane). It captures the property's *current* value.
- **Edit a key**: drag horizontally to move in time; edit its value in the inspector; pick easing.
- **Stage markers**: draggable region dividers. "Jump to stage" seeks the playhead to a marker.
- **Play / scrub**: drives the scene exactly as scroll will on the real site — see §5.

---

## 5. Why the timeline == the real scroll (the whole point)

The lab's master time `t ∈ [0, duration]` is the **same parameter scroll will drive** on the
homepage. Author against the playhead here; on the live site `scrollProgress → t`. So an approved
timeline maps 1:1 onto the pinned scroll — no re-tuning when we implement. The exported
`sunTuning.ts` (tracks + layers + stage times) becomes the single source of truth both the lab
and the hero read.

```
   LAB                                    REAL SITE
   playhead ──drives──► SunState          scrollProgress ──maps──► t ──► SunState
                 │                                                        │
                 └──────── same evaluator, same tuning file ─────────────┘
```

---

## 6. File structure (LetterLab conventions)

```
app/sun-lab/
  page.tsx                       # Server Component: metadata (noindex) + <SunLab/>
components/lab/SunLab/
  SunLab.tsx                     # the page: canvas + control panels + timeline
  Timeline.tsx                   # the keyframe timeline editor (tracks, keys, playhead, stages)
  LayerInspector.tsx             # per-layer colour/emissive/opacity controls
  PropertyInspector.tsx          # selected-property value + easing + add/remove key
  hooks/
    useSunLab.ts                 # the Three scene: load GLB, group layers, apply SunState/frame
    useSunTimeline.ts            # playhead state, play/scrub, track CRUD, evaluate → SunState
  sunModel.ts                    # parts map: group the 50 meshes into the 6 layers by material
  sunLayers.ts                   # layer ids, defaults, Relight-mode material conversion
  sunTimeline.ts                 # Keyframe/Track types + the evaluator (pure, testable)
  sunStages.ts                   # the 4 stage definitions + seeded default keyframes
  sunPresetSource.ts             # export timeline+layers as JSON / pasteable TS source
```

Everything is client-side and dynamic — nothing reaches the homepage bundle (separate route,
same isolation as `/letters`). Styled with Tailwind utilities, **not** `globals.css`.

---

## 7. Build phases (each self-reviewed before the next)

1. **Phase 1 — See it + look controls. ✅ BUILT.** Route `/sun-lab`, GLB loaded + framed, orbit
   camera, parts map into 5 layers, per-layer emissive colour / intensity / opacity / visibility,
   gradient ramp, **bloom + ACES tone mapping**, key/fill/rim light rig, studio-vs-authored material
   toggle, backdrop switch, copy-config (JSON). *Outcome: you can make it look like any of the four
   stages by hand.* Files under `components/lab/SunLab/`.
2. **Phase 2 — Motion params. ✅ BUILT.** Cylinder reveal (Stage 1), vibration tremor + emissive
   pulse (Stage 2), per-shard shatter using the built-in fracture cells — reparented into a
   centre-origin group so explode is plain radial maths (Stage 3), and black-hole collapse +
   in-spiral + procedural core/accretion disk (Stage 4). Each is a live slider, plus four
   **stage-preview quick-sets** (motion + a temperature-tuned gradient). All deterministic on the
   amount params, so they'll scrub cleanly once keyframed.
3. **Phase 3 — Timeline. ✅ BUILT.** A typed **property registry** (`sunProperties.ts`) is the single
   source for every knob — the panel renders from it AND the timeline keys tracks by its paths, so
   "control over everything" and "keyframe everything" stay in sync. Added finalization controls:
   shard base colour / roughness / metalness, per-light X/Y/Z positions, explode distance, disk size.
   The timeline (`sunTimeline.ts` evaluator + `useSunTimeline.ts` playback + `Timeline.tsx` UI):
   play/pause/loop/scrub, per-property lanes with selectable keyframes (time + easing + delete),
   a ◆ record button on every control, and four **stage stamps** that write a preset as keyframes at
   its marker. Record model: untracked edits → base; tracked edits → a key at the playhead. The scene
   reads an always-fresh resolved ref (60fps) so playback is smooth without per-frame React renders.
4. **Phase 4 — Export. ✅ BUILT.** The global Export button copies a pasteable **`sunTuning.ts`**
   (`sunPresetSource.ts`) — typed `SUN_BASE` + `SUN_TIMELINE` with the hero import paths — so the
   real hero imports it and drives the timeline's `time` from scrollProgress. The panel is now
   organised into **three tabs (Look / Motion / Timeline)** with Export global at the top, so it
   reads as a simple tool instead of one long firehose of controls.

---

## 8. Downstream (enabled by the lab, not built in it)

- **Loader trailer**: sequences quick "jump-to-stage" snapshots of the sun inside the wordmark's
  O. Needs the lab's parametric stages + a small render target — a later, separate piece.
- **Hero integration**: swap `SunCanvas`'s procedural sphere for the GLB scene, feed it the
  exported `sunTuning.ts`, drive `t` from the existing pinned `scrollProgress`. The `HeroSun`
  wrapper, intro flight, hero-pin transforms, CSS and events **do not change** — they only touch
  the two wrapper DOM elements, never the canvas internals.

## 9. Open items / risks

- **File size (46 MB, no Draco).** Fine for the lab (local). Before hero integration: Draco the
  geometry + drop/downscale the 22 MB magma **normal map** (a self-emissive sun barely needs it)
  and the 2K textures → realistically a few MB. Tracked, not done now.
- **Relight vs authored look.** Default Relight ON for full lighting control; keep authored look
  one toggle away so we can compare.
- **Additive blend + bloom order.** The unlit sprites are `BLEND`; getting flares/blowout to read
  right through bloom needs correct draw order + tone mapping — a Phase-1 thing to verify on the
  near-black site backdrop, not on grey.
```