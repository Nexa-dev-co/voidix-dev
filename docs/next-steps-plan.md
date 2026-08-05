# Plan of record — 2026-08-02

Sequenced from `docs/unused-inventory.md` (what's dead) and `docs/performance-audit.md` (what's slow).
Ordering principle: **everything that cannot change a pixel goes first**, so that when something does
look different later, there is only one candidate for why.

```
  ①  loose end        1 decision      ← blocks nothing, but leaves the tree dirty
  ②  delete dead      ~2,400 lines    ← zero visual risk BY CONSTRUCTION
  ③  free wins        ~24 MB VRAM     ← zero visual risk, measured reasoning
  ─────────────────────── ship + your eyes ────────────────────────────────
  ④  textures         ~6 MB download  ← needs a tool + your A/B
  ⑤  measure          unknown         ← the only item whose size nobody knows
  ─────────────────────── decisions, not defects ──────────────────────────
  ⑥  trade-offs       your call
  ⊘   blocked         needs files only you can supply
```

---

## ① The loose end (1 decision from you)

`docs/admin-content-schema.md` is deleted in the working tree, unstaged, 196 lines. **I did not delete
it** — it went missing during the branch switch to `main`. It's tracked, so it's recoverable:

- `git restore docs/admin-content-schema.md` → put it back
- or stage the deletion → you meant it

`docs/chamber-renovation-plan.md` was untracked and is **already unrecoverable**. Nothing to decide.

---

## ② Delete what cannot run

One commit. **Unreachable code cannot change behaviour** — that is what makes this safe, not testing.

```
  7 files, 2,358 lines
     markGeodeBody · markDiscMap · markGeodeMorph · markGeodePhases
     markChunkMaterial · markSwarm          ← the mutually-referential island
     lib/performanceTier.ts                 ← orphaned circuit

  ⚠ markRockField.ts STAYS — lives next door, imported by all three accretion files

  7 dead exports deleted     createMarkMaterials · markById · createMeteorGeometry
                             TRANSITION_TOTAL_SECONDS · ACCRETION_COUNT
                             clingToRock · getPerformanceSnapshot (+ its type)
  8 exports un-exported      still used inside their own file
  4 assets, 0.58 MB          asteroid-surface · istockphoto · OIP.webp
                             abstract-layered-formation (referenced by nothing at all)
```

**Plus a CLAUDE.md correction.** It currently lists `performanceTier.ts` under *"these exist and are
load-bearing — don't reinvent them"*. Deleting it means saying what's actually true: `lowPower` comes
from `useIsLowPowerViewport`, a viewport/pointer check, and nothing on this site reads measured frame
times to pick quality.

**Verify:** `npx tsc --noEmit` + `npm run build`. Nothing for you to look at.

---

## ③ The free performance wins

One commit. No visual change, but unlike ② these are *reasoned* rather than proven, so they ship
separately and you look at the works field afterwards.

**a · `antialias: false` on the two composer renderers.** `useServicesDeck.ts:359` and
`useWorksField.ts:561` request an MSAA backbuffer, then render through an `EffectComposer` — which
ignores it. The code already knows (that's why both add an `SMAAPass`). The flag still allocates a
multisampled framebuffer and resolves it every frame, for a fullscreen quad with no interior edges.

**b · Hoist the stone-texture clone out of the per-mark loop.** In `accretionTransition.ts`,
`cloneRepeated(...)` runs once per mark with identical arguments. `Texture.clone()` takes a new uuid
and three keys GPU uploads by uuid, so:

```
  4 identical clones × ~8 MB  ──▶  1 shared  ≈ 24 MB VRAM reclaimed
```

**Verify:** build, then your eyes on the works field — the mark should be pixel-identical.

---

## ④ The textures (~6 MB, 37% of the load gate)

`basalt-magma.png` 3.34 MB + `geode-druse.png` 3.23 MB, both 1254×1254 **PNG-encoded photographic
rock**. At WebP q80 → ~0.4 MB total. Resizing to 1024² also cuts VRAM 8 MB → 5.3 MB each.

**Two things I need from you before I start:**

1. **A tool.** `optimizeModels.mjs` shells out to gltf-transform, which only handles textures *inside*
   a GLB. Standalone images need something else — `sharp` as a devDependency is the obvious choice,
   and I'd extend the existing script rather than add a second one.
2. **Where the originals live.** If the PNGs are overwritten in place, the lossless source is gone. I'd
   add `textures-src/` alongside `models-src/` and gitignore it the same way — but that only works if
   you still have the originals, which is the same trap that has left model re-optimisation blocked
   (see ⊘).

**Verify:** yours. Lossy compression on the section's hero material is exactly the thing a build can't
check. At `stoneTextureRepeat: 2.2` it tiles small and I expect nothing visible — but expectation
isn't verification.

---

## ⑤ Measure the mark's tessellation

**The only item on this list whose size nobody knows**, and possibly the largest.

`ACCRETION_TUNING.capEdgeFraction` sits at **0.008 — the exact floor of its old slider** — with
`capSubdivisions: 2` (each subdivision quadruples triangles → 16×). Against `markTargetSize: 2.6` that
asks for ~0.021 world-unit edges, roughly 124 across the mark. Four marks are cut at this density
during the load gate.

Its own comment: *"by far the heaviest setting in the file. Watch the rig's triangle and build-time
read-outs before carrying it into the section."* **That rig is the one we deleted, so nobody ever
did.**

The instrumentation already exists on the strategy — `metrics.buildMilliseconds` and
`metrics.bufferBytes` are computed and thrown away. Plan: log those plus
`renderer.info.render.triangles` behind a temporary flag, you load the page once and send me the
numbers, then we decide. `capSubdivisions: 1` would be a 4× cut and may be invisible — or the numbers
may say it's already fine. **I won't guess at this one.**

---

## ⑥ Trade-offs — your call, not defects

None of these is a bug. Each buys frame-rate with quality:

| change | buys | costs |
|---|---|---|
| fluid dye 1024² → 512² | 4× less bandwidth per hero frame | slightly softer ink edge — on the first thing anyone sees |
| `adaptivePixelRatio` floor 1.0 → 0.75 | the controller gets a move it currently doesn't have on weak GPUs | visibly soft on the machines that hit it |
| supersample ceiling 2.0 → 1.5 | large saving on retina, the common premium laptop | directly undoes the crispness the controller exists to buy |
| `powerPreference: 'high-performance'` | may pick the discrete GPU | more battery drain; it's only a hint |

My read: the floor change (row 2) is the most defensible — it fixes a behaviour the module's own
header comment already promises and doesn't. The others trade away quality on an Awwwards target, and
I'd leave them until ⑤ says whether you even need them.

---

## ⊘ Blocked: model re-optimisation

`star_aventure_spaceship_starship_fighter.glb` is 3.56 MB — 43% of the ship budget for a vessel that
is never full-screen. A 512² texture cap plausibly halves it.

**Cannot proceed.** `models-src/` holds only `champion_astro_ring`; none of the seven shipped models
has a source there, and the directory is gitignored so they were never committed. The recipes also
name `meteor.glb` and `cloning_tank_chamber_…glb`, neither present.

Unblocking needs the original downloads. Worth deciding whether `models-src/` should stay gitignored —
it is the reason a documented, working optimisation pipeline currently cannot be run on anything.

---

## What I'd do next

**② and ③ now** — they're ~2,400 lines of dead code and ~24 MB of VRAM for no visual risk, and they
make every later diff easier to read. Then **⑤'s instrumentation**, because it's cheap and it decides
whether ④ and ⑥ are even worth arguing about.

④ waits on your answer about `sharp` + the original PNGs. ⑥ waits on ⑤.
