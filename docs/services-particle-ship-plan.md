# The Services deck: four craft, one ship

> **Status: BUILT**, 2026-08-09, on `feature/services-particle-ship` (cut from
> `cleanup/dead-code-and-perf` @ `a74b688`). `npx tsc --noEmit` and `npm run build` both pass. **Not
> yet run in a browser** — the section's motion, timing and colour all need eyes on them.

---

## 1 · What changed

The deck flew **four hulls**, swapped through portal gates. It now **draws four craft and builds
one**: every stop gathers its craft out of dust as a flat plan-view drawing and *turns* it into three
dimensions, and only the **last** goes further — wireframing and skinning into the real model, which
the existing works crossing then flies off.

| | before | after |
|---|---|---|
| models shipped | 4 GLB (5.6 MB) | **1 GLB (411 KB) + a 161 KB bake of all four craft** |
| stops | 4 | **4, unchanged** |
| stop change | gates form, craft flies through, replacement arrives | the craft **morph** into each other |
| stops 01–03 | a hull each | a drawing that **turns into a 3D dust craft** — no model, no skin |
| stop 04 | a hull | the same, and then a wireframe and the real hull |
| pin / `carouselLayout` / navbar meters | — | **untouched** |

The other three craft still exist — as **3D** point clouds traced from the models that used to ship.
Their GLBs are gone, but their geometry is not: they turn, they hold on the turntable, and they take
the pinhole's depth grading. They are objects that are never skinned, not flat art.

---

## 2 · The beat

```
   stop 01          stop 02          stop 03          stop 04
   web              mobile           cargo            fighter

   ▒▒▒▒  flat       ▒▒▒▒             ▒▒▒▒             ▒▒▒▒
    │ TURN 0.90s     │                │                │
    ▼                ▼                ▼                ▼
   ◣██◢  3D dust ─► ◣██◢ ─────────► ◣██◢ ─────────► ◣██◢ ─► wire ─► HULL ─► flies off
    on the                every crossing:                    BUILD 1.80s     (the existing
    turntable             unturn → morph → turn                               works crossing)
                          0.90  +  1.70  + 0.90
```

**Every stop turns.** The flat drawing rotates out of plan view into a three-dimensional cloud of
dust and holds there, spun by the same turntable that spins the hull, breathing with the same
shimmer. That is what makes the first three read as *objects* rather than decals — they simply never
get a wireframe or a skin.

**A crossing happens flat.** The craft un-turns back to its drawing, the drawings cross, and the new
one turns. Not a technical constraint — the flatten is linear, so it commutes with the morph and
either order would work — it is the section's idea: a drawing is what one craft becomes on its way to
being another.

| path | | |
|---|---|---|
| drawing → drawing | unturn + morph + turn | 3.50 s |
| drawing → **hero** | + build | **5.30 s** ← the longest |
| hero → drawing | unbuild + unturn + morph + turn | 4.50 s |
| entering at hero | gather + turn + build | 5.00 s |

⚠ Halved in speed on request, 2026-08-09. Everything above was half its present length; the change is
what forced `SERVICES_STEP_HOLD_MS` to exist. See §5.

---

## 3 · ⚠ A drawing is the craft with its depth removed

This is the load-bearing idea and it is what makes the turn work rather than merely play.

Every craft is baked as a **3D cloud**, all four in one shared frame, and its flat form is that cloud
minus its `DECK_PLAN_DORSAL` component:

```
   flat  =  p − dot(p, DORSAL) · DORSAL        ← one dot product, in the vertex shader
```

No 2D positions are stored at all. The turn is then a **plain lerp in model space**:

```glsl
vec3 target = mix(flattened, craft, uTurn);
```

Not a cross-fade, not a view-space trick, and it cannot scramble — correspondence is by construction.
The wireframe gets the same treatment from the other direction: its endpoints were never sampled into
a drawing, but `position - dot(position, DORSAL)*DORSAL` is exactly what the bake did to make one, so
the lines unfold out of the plane in step with the dust.

**All four turn — only the hero builds.** The other three have real depth to rotate into, take the
pinhole's size grading and sit on the turntable exactly as the hull does; they simply never get a
wireframe or a skin. That is the whole distinction between `turn` (every craft) and `build` (the
hero's alone), and it is why they read as objects rather than as decals.

Because the flatten is linear it **commutes with the morph** — crossing two craft then flattening is
the same as crossing two flattened craft — so running the crossing flat is a choice about meaning,
not a constraint.

### What the SVGs are

`deck-shapes-src/01-web.svg` … `04-ai.svg` are the **readable record** of the same extraction — the
four drawings a human can open, check and judge the angle from. The field does **not** sample them:
it reads the point cloud in `public/deck-drawings.bin`, and re-drawing an SVG by hand would not move a
single grain. They are two renderings of one decision, not two sources.

---

## 4 · The pipeline

```
  4 × *.glb ──► buildFleetDrawings.mjs ──┬──► public/deck-drawings.bin  (what ships, 161 KB)
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

Each craft's points are re-expressed in the **hero's** basis (dot with its own right/up/forward, then
rebuild along the hero's), which is the identity for the hero itself. Without that, every shape would
need its own DORSAL uniform and a morph between two of them would cross two different spaces.

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

## 5 · ⚠ The beat and the pin's input lock move together

`STAGE_STEP_HOLD_MS` in `useHeroAnimation` is **2900 ms**, sized long ago to the portal swap this
replaces. Its own comment records what happens when a transition outgrows it: a second gesture lands
mid-cinematic and cuts it in half.

At half speed the longest path is **5.30 s**, well past that. So services now states its own hold —
`SERVICES_STEP_HOLD_MS = 5500` — through the `stepHoldMs` field the carousel spec already had for
exactly this, and which `work` uses in the other direction (shorter than its transition, deliberately).

⚠ **The cost is real and worth naming.** The hold is ONE value per section, so it is sized for the
longest path and every shorter one over-locks by the difference: a drawing-to-drawing change takes
3.50 s and the section ignores input for 5.50 s. That is the pin knowing only which *section* it is
stepping in, not which *stop* it is stepping to. Fixing it properly means `stepHoldMs` becoming a
function of the destination — see §10.

**To change the pace, scale the six durations in `useServicesDeck` and move this constant with them.**
To change what the beat spends its time *on* without spending more of it, retune the WINDOWS in
`fleetDrawing.ts` instead.

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
- **Three GLBs** — 2.1 MB + 196 KB + 2.9 MB, replaced by a 161 KB bake that carries *all four*
  craft in three dimensions. `public/models` went **8.6 MB → 3.6 MB**.
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

## 9 · The polish pass

Added after the first working version, all of it pushing one idea — *a machine drawing a ship, then
building it*:

**The wireframe draws itself.** Each line's nose-most end anchors while the other travels out to meet
its real position, so a segment GROWS rather than fading in whole; and the lines are ordered nose to
tail (with a little jitter, so the front is not a ruled line). It reads as a plotter working down the
craft. ⚠ The draw progress and the opacity are separate uniforms — fading the wireframe out by winding
the reveal back would make every line RETRACT into its anchor as the hull closed over it, which is the
opposite of what skinning means.

**The hull skins behind a moving edge.** A plane travels down the craft; everything on the far side of
it is discarded and the fragments right at it glow cyan. Nose first, in the same direction the
wireframe just drew. ⚠ In WORLD space, because each mesh's own local frame is no use to a plane that
has to cut across all eight of them while the turntable turns the craft — `buildAxis` and
`buildOrigin` are pushed every frame. ⚠ And the hull's opacity snaps on over the first 12 % of the
skin rather than ramping across it: a slow fade underneath the sweep would cross-dissolve the craft in
at the same time, and the two together read as neither.

**Grains in transit burn hotter.** A crossing peaks mid-flight, so it reads as energy rather than as
the same dust sliding into a different arrangement. One sine that was already being computed.

**A scan sweeps the held craft, forever.** A band of brighter, hotter grains travelling nose to tail
on a loop. This is what stops a held craft being a still image — the loader's field has the same rule
and the shimmer alone is per-grain noise, not something an eye can follow.

### ⚠ And a regression it caught

The pose slerp was running **every frame**, and since a settled stop sits at `turn = 1` it pinned the
rig to the resting pose on every one — silently clobbering **drag-to-rotate** and its release spring,
which write the same object. The craft could not be turned by hand at all. It now hands `spin` back
the moment the beat lands, which also means you can grab a DUST craft and turn it: the clearest proof
available that the first three are objects and not pictures.

---

## 10 · Still open

- **Nobody has watched it.** Every number was chosen against a static preview or by reasoning. The
  gather's arc, the morph's stagger, `TURN_DURATION`, `DRAWING_SLAB`, the scan's rate and tightness,
  the build sweep's edge glow and the grain count are all first estimates.
- **The build sweep has never been seen to line up.** Its axis is derived from the drawing's world
  quaternion and the hull's from `modelMatrix`; those agree by construction, but "by construction" is
  exactly what this section has already been wrong about twice.
- **Grain count** (7k–26k by tier) is sized by argument, not measurement. Worth a frame-time check.
- **The dust does not bloom through the composer**, by choice — the deck's `UnrealBloomPass` ships
  `enabled = false` and a strength-0 pass costs the whole blur pyramid. The grains carry a core+halo in
  the sprite instead. If the drawings read flat, retune those before reaching for the pass.
- **`scripts/buildModels.mjs` still carries recipes for the three deleted hulls** — harmless (it reads
  a gitignored source directory) but now dead configuration.
- **The stop-change beat is shorter than the pin's hold** for stops 01→02→03 (3.50 s against 5500 ms),
  so the section ignores input for ~2 s longer than it is doing anything — worse since the halving,
  because the gap between the shortest and longest path doubled with everything else. `stepHoldMs` is
  per-section, not per-stop; fixing it means the pin learning that a hold can vary by destination.
