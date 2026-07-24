# Sun Lab — plan

An authoring tool at **`/sun-lab`** for the `fractured_sun.glb` model: a fixed on-screen **control
HUD** that lets you do **anything** to the sun, with a **grouped tree** to drill from a role group down
to a single object. Snapshots, `localStorage`, **undo**, **reset**, and **copy current values** are
conveniences on top of that — not the point of the tool.

Not lil-gui. This is a custom React/Tailwind HUD in the spirit of **LetterLab** (a Three.js scene
driven by custom control panels), not a folded dev panel. It is a lab route, isolated from the
homepage bundle — nothing here ships to the live site until we deliberately lift authored numbers out.

## Guiding principle — build a GENERAL editor, not a fixed pipeline

The previous fractured-sun tool failed because it was built to *do one particular thing* (a keyframe
timeline across N fixed stages), so the moment the intent moved, the tool fought it. We are **not**
repeating that.

- **The product is a complete, general model editor.** Every object, every property, freely editable.
  It never assumes what you're building toward.
- **No control hardcodes an outcome.** There is no "stage 1 behaviour" baked into a slider. The scene
  reacts to whatever numbers are current — full stop.
- **Stages are just named snapshots of the current numbers.** Save as many as you like, name them,
  switch between them, copy or delete them. "3 stages" is a *thing you might author with the tool*, not
  a mode the tool is wired around. If you later want interpolation/animation between snapshots, that's
  an additive layer over the same numbers — it changes nothing underneath.
- **Everything is data, nothing is a special case.** Adding a control = one field in the schema; it
  then automatically participates in snapshots, copy, reset, and undo. No per-feature plumbing.

---

## 1. What's actually inside the model (from parsing the GLB)

82 nodes · 50 meshes · **5 materials** · 1 scene. It decomposes cleanly into **6 role groups**:

```
fractured_sun.glb
├─ CORE ............ Sphere_0                         (mat: sun_inner)      ← the solid sun body
├─ CORONA ......... Sphere.001 + transp_Sphere_0_cell.*  (mat: sunouter, α0.82)  ← transparent outer shell
├─ CELLS .......... Sphere_0_cell.000 … .009  (10)    (mat: sun_inner + magma) ← the fractured shards
│                     each shard's cracks glow via ↴
├─ MAGMA (material) ... the emissive material on every cell  (mat: magma, +emissive +normal)
├─ FLARES ......... Cylinder, Cylinder.001 … .007 (8) (mat: flare)          ← solar spikes
└─ PLANES ......... Plane.000 … .019 (20)             (mat: blowout)         ← billboard flare cards
```

**Materials** (the shared look; editing one affects everything that uses it):

| # | name        | notable                                    | role                       |
|---|-------------|--------------------------------------------|----------------------------|
| 0 | `flare`     | baseTex, rough 0.9                         | the spike cylinders        |
| 1 | `blowout`   | baseTex, rough 0.9                         | the 20 billboard planes    |
| 2 | `sun_inner` | baseTex, rough 0.9                         | core + shard bodies        |
| 3 | `sunouter`  | baseColor α 0.82 (transparent), baseTex    | corona / outer shell       |
| 4 | `magma`     | baseTex **+ emissiveTex + normal**         | the glowing cracks         |

> `MAGMA` is a *material*, not separate objects — it lives as the 2nd primitive of each cell. So in the
> tree it appears under a **Materials** group (edit the glow once, all cells update), not as its own
> selectable mesh. That's the honest way to expose it.

---

## 2. The HUD (ASCII mock)

A fixed panel down the left, the 3D viewport fills the rest. Stage bar pinned along the top.

```
┌───────────────────────────────────────── /sun-lab ─────────────────────────────────────────┐
│  ◍ Stage 1    ○ Stage 2    ○ Stage 3          [ Undo ⤺ ]  [ Reset ⟲ ]  [ Copy ⧉ ]  saved✓   │
├──────────────────────────┬──────────────────────────────────────────────────────────────────┤
│  TREE                     │                                                                    │
│  ▸ ⦿ Global (the sun)     │                                                                    │
│  ▾ ◍ Core                 │                                                                    │
│       Sphere_0            │                            ☀  (fractured sun)                      │
│  ▾ ◍ Corona               │                         drag to orbit · scroll to zoom             │
│       Sphere.001          │                                                                    │
│       transp_cell ×10 ▸   │                                                                    │
│  ▾ ◍ Cells                │                                                                    │
│       cell.000  ◉ ● ●     │                                                                    │
│       cell.001            │                                                                    │
│       … (10)              │                                                                    │
│  ▸ ◍ Flares (8)           │                                                                    │
│  ▸ ◍ Planes (20)          │                                                                    │
│  ▸ ◍ Materials (5)        │                                                                    │
├──────────────────────────┤                                                                    │
│  SELECTED ▸ Core          │                                                                    │
│  ─ visible ────────── [✓] │                                                                    │
│  Transform                │                                                                    │
│    position  x▮ y▮ z▮     │                                                                    │
│    rotation  x▮ y▮ z▮     │                                                                    │
│    scale     ▮ (uniform)  │                                                                    │
│  Material                 │                                                                    │
│    color        ▮ #ffce6b │                                                                    │
│    emissive     ▮ #ff5a1e │                                                                    │
│    emis. power  ▮──────   │                                                                    │
│    metalness    ──▮────   │                                                                    │
│    roughness    ────▮──   │                                                                    │
│    opacity      ──────▮   │                                                                    │
│    wireframe        [ ]   │                                                                    │
└──────────────────────────┴──────────────────────────────────────────────────────────────────┘
```

Selecting a **group** row edits the whole group at once (broadcast to every object in it); expanding it
and selecting a **child** edits that one object. Selecting **Global** shows the whole-sun controls.

---

## 3. Controls, by scope

**Per object** (Core / a shard / a flare / a plane):
- `visible`
- Transform: `position xyz`, `rotation xyz`, `scale` (uniform, with an "advanced" toggle for xyz)
- Material: `color`, `emissive` color, `emissive intensity`, `metalness`, `roughness`, `opacity`
  (+ `transparent`), `wireframe`
- Per-object material edits **clone the shared material on first touch**, so recolouring one shard
  never bleeds into the others. Untouched objects keep sharing the source material (cheap).

**Per group** — the same fields, but **broadcast** to every object in the group, plus `group visible`.

**Cells group — a `fracture spread` slider** (the key handle for the stages): moves every shard along
its own outward direction from the sun's centre. `0` = closed (Stage 1), positive = cracks open so the
inner light bleeds through the gaps (Stage 2), negative = collapse inward (Stage 3). It's just a signed
radial offset per cell — general, but the exact affordance these stages need. Pairs with the `magma`
emissive and the core light below to make the gap-glow read.

**Materials group** — edit the 5 *shared* source materials directly (the global look knob): affects
everything still bound to that material.

**Global (the sun)**:
- Whole model: `scale`, `rotation xyz`, `auto-rotate speed`
- **Core light**: a point light at the sun's centre — `colour`, `intensity`, `distance` — so opening
  the fracture spread lets pure light pour out through the gaps (Stage 2). Off/zero for Stage 1.
- Bloom: `strength`, `radius`, `threshold`
- Lighting: key / fill / ambient (colour + intensity), `exposure`
- Environment: `env intensity`, `background` colour (or transparent)
- Camera: `fov`, `distance`, **reset view**

---

## 4. Snapshots, persistence, undo, copy

These are generic conveniences over the current numbers — they know nothing about "stages" as a
concept. A snapshot is just "remember everything as it is right now."

- **Named snapshots (any number).** A snapshot is a full capture: `{ global, perObject overrides,
  perMaterial overrides, notes }`. Save one, name it, switch to it (swaps every number in the HUD and
  re-applies the model), rename, duplicate, delete. Only *overrides* are stored (an object you never
  touched isn't in the snapshot), so a shard you tuned in one snapshot can differ in another. Authoring
  "3 stages of the sun" is simply making three snapshots — the tool doesn't hardcode the number.
- **Save → `localStorage`** under `voidix:sun-lab:v1`. Autosaves on edit (debounced) so a refresh
  never loses work; the `saved✓` indicator reflects it.
- **Undo** — a bounded history stack (e.g. 50 deep) of doc snapshots; every committed edit pushes,
  Undo pops. (Redo is a cheap add-on if you want it — say so.)
- **Reset** — restores the selected scope to the model's **as-imported defaults** (captured once at
  load). Two flavours: reset selected object/group, or reset the whole stage. I'll wire both, default
  button = reset selected.
- **Copy ⧉** — copies the current values to the clipboard as formatted JSON/TS via
  `sunLabPresetSource.ts` (mirrors LetterLab's `markPresetSource.ts`), so authored numbers can be
  lifted into the real site sun later. Copies the active stage by default; modifier for whole doc.

---

## 5. Files (mirrors `components/lab/LetterLab/`)

```
app/
  sun-lab/
    page.tsx                     # Server Component: noindex metadata → <SunLab/> (like app/letters)

components/lab/SunLab/
  SunLab.tsx                     # top-level client: viewport + HUD, holds React state (doc, selection, undo)
  hooks/
    useSunLabScene.ts            # Three scene: load glb (Draco), camera/OrbitControls, lights, env, bloom.
                                 #   Parses model → group tree. Exposes an IMPERATIVE apply API so slider
                                 #   drags update the model live without rebuilding the 47MB scene.
    useSunLabDoc.ts              # doc state + stages + undo history + localStorage autosave (React side)
  sunLabModel.ts                 # load + parse glb into the typed 6-group tree; capture import defaults
  sunLabState.ts                # types + defaults: ObjectParams, GlobalParams, Stage, SunLabDoc, serialize
  sunLabStorage.ts              # localStorage read/write + versioning
  sunLabPresetSource.ts          # format the active stage / doc as copy-paste JSON/TS
  hud/
    StageBar.tsx                 # the 3 stage tabs + Undo / Reset / Copy / saved indicator
    ObjectTree.tsx               # grouped, expandable tree + selection
    ObjectControls.tsx           # controls for the selected object/group (transform + material)
    GlobalControls.tsx           # whole-sun controls (bloom, lights, env, camera)
    controls/                    # shared inputs: Slider, ColorField, Vec3Field, Toggle (Tailwind)
```

- **Styled with Tailwind**, not `globals.css` (a lab has no business growing the 1786-line shipped CSS
  — same rule LetterLab follows).
- **Draco**: reuse the existing `/public/draco/` decoder + `GLTFLoader`/`DRACOLoader`, exactly as
  `useWorksField` does.
- **Isolation**: `/sun-lab` is its own route; nothing imports it into the homepage bundle. Keeps
  Contract-style separation from the live site.

### The React ↔ scene bridge (why it's imperative)
The model is 47 MB. Rebuilding the scene per slider tick would be unusable. So `useSunLabScene` returns
an imperative handle — `applyObject(nodeId, params)`, `applyGlobal(params)`, `applyMaterial(matId,
params)`, `getDefaults()`, `resetObject(nodeId)` — and the HUD calls these directly on input. React
state holds the values (for display, stages, persistence); the scene is mutated in place. This is the
same "state for display, imperative for the hot path" split the site's tuners already use.

---

## 6. Build order (each a self-contained, reviewable step)

**Phase 1 — do anything to the model** (the foundation you asked for first) — ✅ BUILT (awaiting your
browser check). Route + scene + grouped tree + full per-object/global controls + fracture spread + core
light + Copy + Reset all + per-scope Reset. tsc clean.
1. Route + `SunLab` shell + `useSunLabScene` loading the glb with camera / OrbitControls / lights /
   env / bloom, model framed and centred, orbit + zoom working.
2. `sunLabModel.ts` — parse into the 6 groups; `ObjectTree` renders it; selection works.
3. `ObjectControls` — live per-object transform + material (with lazy material cloning) + visibility.
4. `GlobalControls` — whole-sun / bloom / lights / env / camera.
5. **Copy** current values + **Reset** selected/all. → *At this point it's a full model editor.*

**Phase 2 — memory over the same numbers** (additive; changes nothing in Phase 1) — ✅ BUILT (awaiting
browser check). Named snapshots (add/switch/rename/duplicate/delete), localStorage autosave, undo
(Ctrl+Z, coalesced per edit-burst, cleared on snapshot switch), digits 1-9 switch snapshots. Snapshot =
full SunLabState; switching calls applyFullState (un-clones per-object materials back to shared). tsc
clean.

**Phase 3 — motion, only if/when you want it** (additive; needs your input — see §7)
8. Optional per-snapshot animation model + play/preview, and/or interpolation *between* snapshots.
9. Whatever "interactive space" resolves to.

Phase 1 is the real product — a complete general editor. Phases 2 and 3 are layers on top of the exact
same numbers; neither reaches back and constrains the editor. I'd build and hand off **Phase 1** first
for you to verify in the browser, then continue.

---

## 7. The three stages (the intent Phase 3 animates)

Known now — captured so the eventual motion matches the vision, and so Phase 1's control surface can
already *pose* each one:

1. **Normal sun** — whole-model rotation; the flare cylinders animate on their own (idle pulse / sway).
   `fracture spread = 0`, core light off, calm bloom.
2. **Unstable sun** — spins faster; `fracture spread > 0` so the shards part and the **core light**
   pours pure light through the widening gaps (the `magma` emissive lifts too). No shake.
3. **Collapse** — `fracture spread < 0`, the shards pull inward under rising "gravity", tightening down
   to hand off to a **black-hole model** (supplied later).

These are just three snapshots plus, in Phase 3, animation between them. Phase 1 lets you dial each
snapshot in by hand; Phase 3 decides how they move.

Still open (none block Phase 1):
- **Flare/cylinder animation** (Stage 1) — what motion exactly (pulse in length? sway? flicker glow?).
  Phase 3.
- **Collapse "gravity" feel** (Stage 3) — pure inward slide, or ease-in acceleration + shrink + spin-up?
  Phase 3.
- **Copy format** — plain JSON (portable) or a ready-to-paste TS `const` (like `markPresetSource`)?
- **Redo** — want it alongside Undo, or is Undo enough?
```
