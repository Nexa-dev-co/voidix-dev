# Cleanup plan — delete the labs, delete the tuners, bake the numbers

> **Goal:** the repo ships one route (`/`) and nothing configurable at runtime. No `?tune`, no
> `lil-gui`, no authoring routes, no strategy/knob indirection. Every value is a named constant in
> the file that uses it.

---

## 1 · What is actually entangled

The good news first: **no section imports from `components/lab/`.** The labs are a leaf. The
entanglement is entirely in the other direction plus four shared `lib/` files.

```
                    ┌──────────────── DELETE ────────────────┐
                    │                                        │
  app/sun-lab ──────┤                                        │
  app/letters ──────┤──► components/lab/**  (27 files, 8.9k lines)
  app/letters/                                               │
    transition ─────┘         │                              │
                              │ imports (one-way, safe)      │
                              ▼                              │
                    components/sections/WorksField/          │
                      transitions/markTransition.ts  ◄───────┼── keep, but STRIP
                      transitions/shardsTransition.ts ───────┤   the knob layer
                      transitions/shardsCells.ts     ────────┤   (lab-only candidate)
                      transitions/registry.ts        ────────┤
                      transitions/transitionCatalog.ts ──────┘

  lib/tunerDock.ts ─┐
  lib/tunerExport.ts├─► used ONLY by chamberTunerPanel + chamberTuning + LetterLab
  lib/tunerReset.ts ┘
  lib/tuneScrollLock.ts ──► ALSO used by lib/hooks/useHeroAnimation.ts  ⚠ live code
```

Three places where lab plumbing has grown into shipped code, and they are the whole risk of this
change:

| # | Site | What has to happen |
|---|---|---|
| ① | `useHeroAnimation.ts` wheel + touchmove handlers | two `isInsideTunerDock` early-returns and two `isTuneScrollLocked` swallows come out |
| ② | `chamberScene.ts` | the `?tune` dynamic import, `tunerCleanups`, and the whole `setCameraOverride` free-fly hatch come out — including `canPlaceHologram`'s `\|\| !!cameraOverride` |
| ③ | `accretionTransition.ts` | `ACCRETION_CONTROLS` (≈60 `TuningControl` records) becomes a plain frozen constants object; ~95 `this.tuning.x` reads repoint at it |

---

## 2 · The interpretation I'm working to

> *"hardcode the values, no need for anything configurable"*

**In scope — removed:** anything that lets a value change at runtime or be authored from a UI.
`?tune`, `lil-gui` panels, the dock, export/reset registries, the free-fly camera, `getWritable*`,
`applyTuning`, `TuningControl`, the strategy registry/catalogue.

**Out of scope — kept as-is:** `chamberTuning.ts`, `deckTuning.ts`, `worksTuning.ts`,
`deckServices.ts`. These files are *already* nothing but hardcoded constants — they're the
destination of this change, not a target of it. Only their writable/reset escape hatches go.

Say the word if you want those renamed or inlined too; I read "hardcode the values" as *stop it
being editable*, not *rename the constants files*.

---

## 3 · The work, in commit order

Each step ends with `npx tsc --noEmit` green before the next starts.

### Step 1 — cut the three live tendrils (nothing deleted yet)

```
useHeroAnimation.ts   wheel:      - if (isInsideTunerDock(event.target)) return;
                                  - if (isTuneScrollLocked()) { preventDefault(); return; }
                      touchmove:  - same two
                      import:     - lib/tuneScrollLock

chamberScene.ts       - setCameraOverride from the ChamberScene interface + its impl
                      - cameraOverride / lastCameraOverrideFrame / the frame-loop branch
                      - tunerCleanups[] + the dispose() forEach
                      - the `URLSearchParams(...).has('tune')` import block
                      ~ canPlaceHologram: (inTour || !!cameraOverride) → inTour

chamberTuning.ts      - import { snapshotDefaults, restoreInPlace }
                      - CHAMBER_DEFAULTS, resetChamberTuning(), getWritableChamberTuning()
                      ~ rewrite the file header (it currently argues the panel must exist)
```

⚠ `chamberTuning.ts`'s header comment and `SHOWCASE_KEYS`' header both say values are "re-authored
in the `?tune` panel" and that the keys are **stale, aiming at a podium that no longer exists**.
That's a real note about the shipped tour, not about the tuner — I'll rewrite the comments to keep
the warning and drop the "author it in the panel" instruction. **The stale-keys problem itself is
not in this change's scope.**

### Step 2 — collapse the transition contract

The `MarkTransitionFactory` / registry / catalogue layer exists only so the lab could compare four
candidates behind one interface. The homepage uses exactly one, and passes `{}` for tuning:

```
BEFORE                                    AFTER
  registry.ts ─┬─ accretionTransition       accretionTransition.ts
               └─ shardsTransition            export async function createAccretionMark(
  transitionCatalog.ts (4 entries,             marks, options
    2 unbuilt)                               ): Promise<MarkTransitionStrategy>
  markTransition.ts
    TuningControl, TransitionTuning,        markTransition.ts
    tuningDefaults(), applyTuning?,           PreparedMark, MarkTransitionBuildOptions,
    MarkTransitionFactory                     TransitionBuildMetrics,
                                              MarkTransitionStrategy  ← minus applyTuning
  ACCRETION_CONTROLS: TuningControl[]         clampProgress, measureGeometryBytes
    [{key,label,min,max,step,value,…}×60]
                                            ACCRETION_TUNING = { …60 plain numbers }
```

**Deleted:** `registry.ts`, `transitionCatalog.ts`, `shardsTransition.ts`, `shardsCells.ts` (815
lines of a comparison candidate that never shipped).
**Edited:** `markTransition.ts`, `accretionTransition.ts`, and `useWorksField.ts` (drop the `{}`
argument; rewrite the "the tuning is deliberately EMPTY" comment, which points at a route that will
no longer exist).

The 60 authored numbers are carried across **verbatim** from each control's `value:` field — this
step must not change a single rendered pixel.

### Step 3 — delete the labs and the tuner plumbing

```
app/sun-lab/                         app/letters/
components/lab/                      components/sections/Chamber/chamberTunerPanel.ts
lib/tunerDock.ts  lib/tunerExport.ts  lib/tunerReset.ts  lib/tuneScrollLock.ts
```

### Step 4 — the fallout

- **`NavbarGate.tsx` → deleted.** It exists purely to keep the nav off `/letters` and `/sun-lab`.
  `layout.tsx` renders `<Navbar />` directly again. (Its long comment about the invisible z-9999
  click-eater is worth preserving in the git history, not the tree.)
- **`globals.css`** — the `.pad-lab*` block (lines ≈2546–2586) goes. It's already dead: `/pad-lab`
  doesn't exist and nothing references those classes.
- **`package.json`** — drop `lil-gui` (panels only) and `lucide-react` (labs only; confirmed no
  non-lab importer). `npm install` afterwards to update the lockfiles.
- **`CLAUDE.md`** — PART 2's structure tree, "The `?tune` authoring panel" section and "The labs"
  section all describe things that will be gone. The file's own rule is that it gets fixed as part
  of the change.

### What survives that you might expect not to

- **`public/models/black_hole.glb` stays.** It looked orphaned when `SunLab` goes, but
  `Contact/singularityScene.ts` loads it too — and its CC-BY credit in the contact footer is
  legally required. No assets are deleted by this change.
- **The hero sun's constants stay where they are.** `SunModelCanvas` / `sunParticles` never
  imported `sunLabPresets.ts`; deleting the lab costs the authoring surface, not the values.

---

## 4 · Net effect

```
  deleted   ~10,900 lines   (labs 8.9k · tuner plumbing 0.8k · shards 0.8k · panels 0.5k)
  edited         6 files    (useHeroAnimation, chamberScene, chamberTuning,
                             markTransition, accretionTransition, useWorksField)
  routes         3 → 1      (/ only)
  deps           8 → 6      (lil-gui, lucide-react out)
  runtime knobs  ~360 → 0
```

**Verification:** `npx tsc --noEmit` after every step, `npm run build` at the end, self-review of
the diff. Per the project rule, you run the app — the thing to look at is the chamber tour and the
works mark growth, since those are the two places where knob values got re-homed.
