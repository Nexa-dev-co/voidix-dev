# The Services deck: four drawings, one ship

> **Status: BUILT**, 2026-08-09, on `feature/services-particle-ship` (cut from
> `cleanup/dead-code-and-perf` @ `a74b688`). `npx tsc --noEmit` and `npm run build` both pass. **Not
> yet run in a browser** — the section's motion, timing and colour all need eyes on them.

---

## 1 · What changed

The deck flew **four hulls**, swapped through portal gates. It now **draws four craft and builds
one**: every stop gathers its craft out of dust as a flat plan-view drawing, and only the **last**
goes further — turning out of plan view into three dimensions, wireframing, and skinning into the
real model, which the existing works crossing then flies off.

| | before | after |
|---|---|---|
| models shipped | 4 GLB (5.6 MB) | **1 GLB (411 KB) + a 153 KB bake of all four drawings** |
| stops | 4 | **4, unchanged** |
| stop change | gates form, craft flies through, replacement arrives | the drawings **morph** into each other |
| stops 01–03 | a hull each | drawings, with **no geometry at all** |
| stop 04 | a hull | a drawing that **becomes** the hull |
| pin / `carouselLayout` / navbar meters | — | **untouched** |

The other three craft still exist — as point clouds traced from the models that used to ship. Their
GLBs are gone.

---

## 2 · The beat

```
   stop 01        stop 02        stop 03        stop 04
   ┌────────┐     ┌────────┐     ┌────────┐     ┌────────────────────────────┐
   │ web    │     │ mobile │     │ cargo  │     │ fighter                    │
   │ drawing│ ──► │ drawing│ ──► │ drawing│ ──► │ drawing → turn → wire →hull│──► flies off
   └────────┘     └────────┘     └────────┘     └────────────────────────────┘
        ▲   MORPH 1.05s    MORPH        MORPH          MATERIALISE 1.55s        (the existing
        │   one grain travels from its place                                     works crossing)
   GATHER  in one craft to its place in the next
   1.15s
```

**Entering the section** — dust streams in out of the dark and settles into the current craft's
drawing (`GATHER`). **A stop change** — the drawings cross (`MORPH`). **Arriving at stop 04** — the
crossing lands, then the craft materialises. **Leaving stop 04** — it de-materialises back into its
own drawing first (0.80 s), then crosses.

⚠ The longest path is *arriving at the hero*: 1.05 + 1.55 = **2.60 s**, inside the pin's
`STAGE_STEP_HOLD_MS` (2900 ms). See §5.

---

## 3 · ⚠ The hero's drawing is not a picture of it. It *is* the hull, flattened

This is the load-bearing idea and it is what makes the last stop work rather than merely play.

A stored drawing point is `(drawX, drawY)` in a plane spanned by `DECK_PLAN_RIGHT` and
`DECK_PLAN_NOSE`, and the bake produced it by projecting the hull's **own feature-edge points** onto
exactly those axes. Those two axes and `DECK_PLAN_DORSAL` are orthonormal — so

```
   drawX·RIGHT + drawY·NOSE   ≡   the 3D point with its DORSAL component removed
```

which means the turn is a **plain lerp in model space** between the drawing and the hull:

```glsl
vec3 target = mix(drawingPosition, aSolid, uMaterialise);
```

Not a cross-fade, not a view-space trick, and it cannot scramble — correspondence is by construction.
The wireframe gets the same treatment from the other direction: its endpoints were never sampled into
a drawing, but `position - dot(position, DORSAL)*DORSAL` is exactly what the bake did to make one, so
the lines unfold out of the plane in step with the dust.

**The other three craft have no third dimension at all.** They are drawings and never anything else,
which is why only the hero's model ships.

### What the SVGs are

`deck-shapes-src/01-web.svg` … `04-ai.svg` are the **readable record** of the same extraction — the
four drawings a human can open, check and judge the angle from. The field does **not** sample them:
it reads the point cloud in `public/deck-drawings.bin`, and re-drawing an SVG by hand would not move a
single grain. They are two renderings of one decision, not two sources.

---

## 4 · The pipeline

```
  4 × *.glb ──► buildFleetDrawings.mjs ──┬──► public/deck-drawings.bin  (what ships, 153 KB)
                                         ├──► deckDrawingsManifest.ts
                                         ├──► deck-shapes-src/*.svg     (the record)
                                         └──► point-cloud PNG previews
                     │
                     └── shipGeometry.mjs (GLB + Draco + node transforms)
                         shipFeatureEdges.mjs (weld · classify · chain · simplify)
                         previewImage.mjs (PNG + line/point rasterisers)
```

`scripts/buildShipSilhouette.mjs` is the **angle-picking tool**, not a build step: it renders a
model's true silhouette by marching squares so a view can be *chosen* by looking at it. That is how
the plan view was picked; run it by hand with explicit yaw/pitch arguments.

**Feature edges** — the lines a human would draw:

| | boundary | crease (>42°) | contour | → segments | → points |
|---|---|---|---|---|---|
| 01 web | 8 | 40 260 | 19 408 | 2 236 | 4 096 |
| 02 mobile | 243 | 541 | 167 | 614 | 4 096 |
| 03 enterprise | 3 877 | 60 146 | 11 457 | 6 842 | 4 096 |
| 04 ai (hero) | 8 372 | 16 815 | 6 048 | 5 531 | 4 096 |

Every drawing carries the **same** point count — that is what a morph needs — so the budget is sized
for the busiest (the hauler) rather than the cleanest (the shuttle, which is 11× sparser in lines and
comes out as a beautifully clean cloud).

⚠ **Adjacency cannot be read off the index buffer.** Hard-surface exports split vertices at every
normal and UV seam, so the two triangles either side of a panel line often share no index — and an
unshared edge classifies as a *boundary*, which would select the entire model. Welding by position is
the only thing that survives that.

⚠ **42° was swept, not guessed.** At 25° every wing pylon came out as a *bundle* of four or five
near-parallel lines — each faceting step across its taper crossed the threshold.

⚠ **Do not raise `MIN_CHAIN_LENGTH` to thin out a busy hull.** Tried at 0.07 and 0.13 on `web`, the
greebliest: both **deleted its outline** and kept the interior clutter. A faceted hull's silhouette
arrives as many *short* contour chains while the long chains are panel lines down the middle of it, so
a length filter removes exactly the wrong half. Density is the model's, and in an additive field it
reads as luminance.

⚠ **The point order is load-bearing.** Every shape is sorted into scan order — topmost ink first — so
a grain holds roughly the same *part* of every craft and tops travel to tops. Without it a morph is
4 096 grains crossing at random, which reads as noise resolving into noise.

⚠ **Yaw 180, not 0.** The first orbit basis was **left-handed**, so every drawing was **mirrored** —
undetectable on a near-symmetric fighter right up until the mirrored drawing is composited over the
real model. `shipGeometry.orbitBasis` now asserts `right × up === forward` in its comment.

---

## 5 · ⚠ The timing is bounded by the pin, not by taste

`STAGE_STEP_HOLD_MS` in `useHeroAnimation` is **2900 ms**, sized to the portal swap this replaces
(~2.77 s). Its own comment records what happens when a transition outgrows it: a second gesture lands
mid-cinematic and cuts it in half.

The longest path here is 2.60 s. An ordinary stop change is only the 1.05 s crossing — which is why
the carousel now feels quicker than the swap did *everywhere except the one place it should not*.

**To lengthen the build, retune the WINDOWS in `fleetDrawing.ts` first** — they change what the beat
spends its time on without spending more of it.

---

## 6 · The palette — the hero keeps its own look, untouched

CLAUDE.md flagged that the AI ship's purple→cyan is *"the one deliberate exception to the heat ramp —
the fleet is allowed exactly one alien"*. **It is intact, in the treatment it was authored in.**

An intermediate cut of this rebuild had one hull standing in for all four services, which forced that
craft's flat two-tone `legacy` profile (whose colours compile *into the program*) to be rewritten as a
graded one purely so its palette could live in uniforms and be swapped per stop. That also dragged in
a real trap — three decides `USE_IRIDESCENCE` from `material.iridescence > 0` **at compile time**, so
the hull had to be built from the *richest* profile and graded down.

**All of that is gone.** With three of the four stops being drawings, the hull is only ever on screen
at its own stop, so it wears exactly one palette for its whole life:

```
   stop 01-03    profile → the DUST only        (no geometry exists to skin)
   stop 04       profile → the dust, AND the hull, skinned once at load, never re-graded
```

⚠ **`applyServicePalette` must never touch the hull.** The four stops are told apart by their drawing
— which is the better answer anyway, since the dust is what the visitor is looking at for three
quarters of this section.

---

## 7 · What this deleted

- **`portalGate.ts`** (377 lines) and ~15 `PORTAL_*`/`GATE_*` constants, `computePortalLayout`,
  `flyShipIntoGate`, `flyShipOutOfGate`, `runPortalSwap`.
- **Three GLBs** — 2.1 MB + 196 KB + 2.9 MB, replaced by a 153 KB bake that carries *all four*
  drawings. `public/models` went **8.6 MB → 3.6 MB**.
- The `ships[]` array. There is one `ship`, and `DeckShip` says so.

⚠ **`SOURCE_WEIGHTS` was re-weighed** (deck .47 → .10). The deck fell from ~5.3 MB to ~0.57 MB, taking
the page total from 10.76 MB to ~5.67 MB. Left alone, the loader's counter would sprint through the
deck's old half of the bar and then crawl — precisely the dishonesty that file exists to prevent, in
the other direction.

---

## 8 · Traps found while building

Each was a real defect in a working version:

1. **A closed loop simplifies to nothing.** Douglas–Peucker anchors on first→last; on a closed contour
   those are the same point, so the outline collapsed to two points. Cut the loop at its most distant
   vertex first.
2. **The mirrored drawing** (§4).
3. **Heat graded backwards.** `view.z` is *negative* in front of the camera, so the nearer grain has
   the *larger* z. Subtracting the other way made the far face hot — a hole rather than a hull.
4. **`stage.visible` hid the drawing.** The old `applyOpacity` hid the whole rig, which was correct
   when four transparent hulls stacked at the origin and punched depth holes in each other. It hides
   the **meshes** now — the drawings are in the rig and must be on screen *while the hull is not*.
5. **`presence === 1` never became true.** Presence is derived per frame and only written when it
   moves more than a threshold, so a settled craft rests a hair under 1 forever.
6. **The camera matrix is a frame stale.** three refreshes it inside `render()`, which runs *after*
   the plan-pose solve — so the pose lagged the shot by a frame once the handoff moved the camera.
7. **The crossing could catch a beat mid-build.** The build and the flight both want the craft's
   orientation and there is no sensible blend. The handoff finishes it outright — through `snapToStop`
   rather than `timeline.progress(1)`, because GSAP suppresses callbacks on `seek` but not `progress`,
   and a beat that ended without its `onComplete` would leave the render loop fighting the flight.
8. **Reduced motion never solved the plan pose.** The solve is gated on `animate`, so `planPose` would
   still be its initial copy of the resting pose — and every drawing would be edge-on, i.e. invisible.
9. **The authored placement moved the hull off its drawing.** `tuning.ships[]` was applied to the hull
   object; a `place` group now carries it so the hull and the drawing are nudged together. Every
   placement is currently identity, so this changes nothing today — it is there so it still changes
   nothing if one ever isn't.

---

## 9 · Still open

- **Nobody has watched it.** Every number was chosen against a static preview or by reasoning. The
  gather's arc, the morph's stagger, the wireframe opacity, `DRAWING_SLAB` and the grain count are all
  first estimates.
- **Grain count** (7k–26k by tier) is sized by argument, not measurement. Worth a frame-time check.
- **The dust does not bloom through the composer**, by choice — the deck's `UnrealBloomPass` ships
  `enabled = false` and a strength-0 pass costs the whole blur pyramid. The grains carry a core+halo in
  the sprite instead. If the drawings read flat, retune those before reaching for the pass.
- **`scripts/buildModels.mjs` still carries recipes for the three deleted hulls** — harmless (it reads
  a gitignored source directory) but now dead configuration.
- **The stop-change beat is shorter than the pin's hold** for stops 01→02→03, so the section ignores
  input for ~1.8 s longer than it is doing anything. `stepHoldMs` is per-section, not per-stop, so
  fixing it properly means the pin learning that a section's hold can vary by destination.
