# What is actually used — a reachability audit, 2026-08-02

Not grep-and-guess. I built the real module graph: every `import` / `import()` / `new URL()`
specifier resolved through the `@/` alias, walked from Next's only two entry points
(`app/layout.tsx`, `app/page.tsx`). Anything the walk never reaches cannot execute.

```
  110 TypeScript files
  ├─ 103 reachable from an entry point
  └─   7 unreachable  ────────────────────  2,358 lines that cannot run
```

---

## 1 · Seven files nothing can reach

Six of them form **one self-contained island** — they import each other, and nothing outside the
island imports any of them. That is why this survived: every file in it *looks* used, because
something does import it. Just nothing alive.

```
                        ┌──────────────────────────────────────────┐
   nothing live ───✗───▶ │  markGeodeBody.ts        641 lines       │
                        │      ├─▶ markDiscMap.ts        440       │
                        │      └─▶ markGeodeMorph.ts     357       │
                        │             └─▶ markGeodePhases.ts  120  │
                        │  markChunkMaterial.ts     226            │
                        │      └─▶ markGeodeMorph, markSwarm       │
                        │  markSwarm.ts             533            │
                        └──────────────────────────────────────────┘
                          2,317 lines, mutually referential, orphaned

   lib/performanceTier.ts   41 lines — imported by nobody at all
```

**Why the earlier greps said they were used:** every apparent importer turned out to be a *comment*
naming the file. `markTransition.ts` says *"`markGeodeBody` gets this right and is the reference"*;
`accretionTransition.ts` says *"Already registered in `markChunkMaterial`'s `CHUNK_TEXTURES`"*. Prose,
not imports.

⚠ **`markRockField.ts` is NOT part of this island** — `accretionChunks`, `accretionCrystals` and
`accretionTransition` all genuinely import it. Deleting `markGeodeBody` must not take it along.

### `lib/performanceTier.ts` deserves its own note

CLAUDE.md lists it under "Performance systems … these exist and are load-bearing — don't reinvent
them", and describes the chamber picking a texture tier from measured frame times. **Nothing imports
it.** Its only supplier, `getPerformanceSnapshot()` in `adaptivePixelRatio.ts`, is also called by
nobody.

So the measured-tier system is a complete, orphaned circuit:

```
   adaptivePixelRatio.getPerformanceSnapshot()  ──▶  performanceTier.ts  ──▶  (nothing)
                    dead                                    dead
```

The `lowPower` flag the scenes actually use comes from `useIsLowPowerViewport` (a viewport/pointer
check), not from measured frame times. Worth knowing before you trust that CLAUDE.md paragraph.

---

## 2 · Assets

Every file in `public/` checked against **live code only**:

| verdict | files |
|---|---|
| **LIVE** | all 7 models, all 3 logos, helvetiker font, `geode-druse.png`, `basalt-magma.png`, `black-stone…jpg` |
| **DEAD — referenced only by the orphaned island** | `asteroid-surface…jpg` (0.12 MB), `istockphoto-1143001921…jpg` (0.25 MB), `OIP.webp` (0.07 MB) |
| **UNREFERENCED by anything** | `abstract-layered-formation-gold-sediment…jpg` (0.14 MB) |

**≈ 0.58 MB reclaimable.** Modest — but these were invisible until the island was identified.

**Correction to my earlier note:** `/draco/*` is fine. It is referenced by *directory*
(`setDecoderPath('/draco/')`), so a filename search misses it. `draco_decoder.js` (0.49 MB) is the
no-WASM fallback and is never fetched by a modern browser — it costs disk, not bandwidth.

**`basalt-magma.png` is still genuinely live** — `useWorksField.ts:1110` loads it as `TEXTURE_SURFACE`
for the ambient shards. So the "convert to WebP" recommendation stands for both big PNGs.

---

## 3 · A correction to the performance audit — and then a correction to *this* ⚠

I originally wrote here that re-optimising `star_aventure_spaceship_starship_fighter.glb` was
impossible, because `models-src/` holds only `champion_astro_ring` and is gitignored, so no shipped
model has a source. **That reasoning was right about the directory and wrong about this file.**

Inspecting the shipped GLBs showed the fighter's generator was `Sketchfab-16.95.0` with no
`KHR_draco_mesh_compression`, while all six others read `glTF-Transform` with Draco:

```
  star_aventure_…  3.56 MB   Sketchfab-16.95.0      ← never processed
  cargo_spaceship  2.45 MB   glTF-Transform v4.4.0    DRACO
  spaceship        2.05 MB   glTF-Transform v4.4.0    DRACO
  spaceship3       0.27 MB   glTF-Transform v4.4.0    DRACO
  fractured_sun    1.28 MB   glTF-Transform v4.4.2    DRACO
  table            0.61 MB   glTF-Transform v4.4.1    DRACO
  black_hole       2.87 MB   glTF-Transform v4.4.2    DRACO
```

It needed no source **because it *was* the source** — the raw export had been committed to
`public/models` and shipped as-is. Compressed 2026-08-02: **3.56 MB → 0.38 MB (−89%)**, geometry
identical (167,565 render vertices before and after), and the raw export preserved in `models-src/`.

**The general point still stands for the other six.** They are already optimised, so there is nothing
to reclaim — but if one ever needs re-processing at a different setting, its source is neither in
`models-src/` nor in git history, and would have to be downloaded again.

---

## 4 · Dead exports

Of 40 files with unimported exports, **most are false alarms** — TypeScript interfaces exported so a
returned value has a name (`ChamberPlinth`, `GroundGrid`, `DeckService`…). Consumers use inference.
That is good practice, not dead code. `app/layout.tsx`'s `metadata` is a Next.js convention.

The **15 runtime values** that no other live file uses, split by whether the code itself is dead:

**Delete entirely — declared, never referenced even internally (7):**

| file | symbol |
|---|---|
| `markBody.ts` | `createMarkMaterials` |
| `markRockField.ts` | `clingToRock` |
| `marks.ts` | `markById` |
| `meteorBody.ts` | `createMeteorGeometry` |
| `worksTransition.ts` | `TRANSITION_TOTAL_SECONDS` |
| `lib/accretionShader.ts` | `ACCRETION_COUNT` |
| `lib/adaptivePixelRatio.ts` | `getPerformanceSnapshot` (+ its `PerformanceSnapshot` type) |

**Just drop the `export` — still used inside their own file (8):**
`ORB_ASSUMED_FPS`, `ORB_ROTATION_SPEED_RAD_PER_FRAME` (heroReadouts — the superseded spin constants
its own comment calls history), `createClosedLoop`, `meanStretch`, `rockRadiusInDirection`,
`signedDistanceToRock`, `FLIGHT_LANDING_KEY`, `SHOWCASE_KEYS`.

---

## 5 · CSS and dependencies: clean

- **All 189 class selectors in `globals.css` are used.** Nothing to reclaim.
- **Three design tokens are defined but never read:** `--card`, `--hero-dust`, `--hero-dust-rgb`.
  `--card` is documented in CLAUDE.md as the elevated-surface colour. Dropping them is a *design*
  call, not a cleanup — flagging, not recommending.
- **`package.json` is honest.** Every remaining dependency is imported. `react-dom` has no direct
  import but is required by React/Next; `@types/three` is types-only.
- `models-src/` (24 MB) and `temp/` are both gitignored — local disk only, never shipped.

---

## Summary

```
  code      2,358 lines   7 files, unreachable         ← the real find
  exports      15 symbols  7 delete · 8 un-export
  assets     0.58 MB      4 files
  css              —      clean
  deps             —      clean
```

Deleting the island is **zero-risk by construction**: unreachable code cannot change behaviour. The
one thing to be careful about is `markRockField.ts`, which lives next door and is very much alive.

**Not verified by me:** I have not run the app since these findings. The reachability claim is static
and I trust it, but `npx tsc --noEmit` and a build should follow any deletion.
