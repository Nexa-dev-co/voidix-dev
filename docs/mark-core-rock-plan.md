# The geode — a base rock that grows into the mark

> **Status:** steps 1–5 BUILT and typechecking, **not yet looked at**. Step 6 (judge it) is next and is
> the go/no-go; the swarm is untouched until then. Written 2026-07-29; revised the same day against the
> geode reference (`temp/geode.png`), then again to make the base rock a free agent rather than a
> centred core.
>
> **Built:** `markRockField.ts` · `markContours.ts` · `markCapMesh.ts` · `markGeodeBody.ts` ·
> `markGeodeMorph.ts` · `markGeodePhases.ts`, wired into `/letters` as `body: 'geode'` (the default),
> with `solid` and `rock` still one click away for the comparison.
>
> **Deviations from this plan, and why:**
> - §8.11 said the rock's pose should be live-draggable. It is **not** — the crust mask and growth
>   delay are baked into the vertex buffers, so moving the rock re-carves the body and it sits behind
>   the 220 ms debounce like every other geometry knob. The crystal's look knobs and the scrub ARE
>   live. Making pose live would mean evaluating the rock's field in the shader instead of at build
>   time; worth doing only if authoring proves annoying.
> - Cap edge length became a **fraction** of the mark rather than a world length, because the cap is
>   triangulated before normalisation and the source outlines arrive at wildly different scales.

---

## 1 · The reference, read as a spec

Twelve storyboard frames: a dark veined rock wakes, seeds crystal inside itself, opens into a letter
whose *outer* surface is still the original crust and whose *inner* surface is crystal — then closes
back.

```
  1 ROCK      2 AWAKE     3 SEEDS     4 GROWTH    5 EMERGE    6 FORMED
   ▟███▙       ▟███▙       ▟█▒▒▙       ▟█▒▒        ▟▒▒         ▟▒▒
  ███████     ██▒░███     ██▒░▒██     ██▒░  ▘     █▒░  ▘      █▒░  ▘
  ███████     ██▒░███     ██▒░▒██     ██▒░▁▖      █▒░▁▖       █▒░▁▖
   ▜███▛       ▜███▛       ▜█▒▒▛       ▜█▒▒        ▜▒▒         ▜▒▒
  crust       glow        crystal     silhouette  ─────────▶  the letter
  + veins     inside      forms       gives way

  7 WITHDRAW  8 SHRINK    9 RETURN    10 RECEDE   11 FADE     12 ROCK
  ◀──────────────────── the same curve, run backwards ────────────────────
```

Four separable things happen, and only one is geometry:

| | what moves | frames |
|---|---|---|
| **charge** | emissive only — energy seeping through the crust | 2–3, 11 |
| **grow** | the silhouette: rock → letter | 4–6, 8–9 |
| **reveal** | crystal surfacing where the rock opened | 3–6, 10 |
| **return** | all three, reversed | 7–12 |

The return is free: if each is a pure function of one progress value, playing it backwards *is*
frames 7–12. That is the site's ONE CLOCK rule (`CLAUDE.md` §the scroll spine) paying out, and it is
a real argument for this design over the swarm, which could not reverse cleanly.

---

## 2 · The base rock is a free agent

**It is not the letter's centre.** It has its own position, size, orientation and carve, and the
letter grows out of *wherever it sits*. That single change does a lot of work:

```
   centred core (rejected)              base rock, placed (this plan)

      ╭───────────╮                              ╭───╮
     ╱  ███████    ╲                            ╱ ███ ╲
    │  ██     ██    │                          │  ███  │  ← the rock sits
    │  ██          │        vs                  ╲ ███ ╱      in the V's crook
     ╲ ██     ██  ╱                         ▒▒▒▒▖╰───╯▗▒▒▒▒
      ╰─███████──╯                        ▒▒▒▒▒  ▚   ▞  ▒▒▒▒▒
                                        ▒▒▒▒      ▚ ▞      ▒▒▒▒
   "V" = an egg with two bites          "V" = arms reaching out of a rock
   taken out of it                      that is actually sitting there
```

Last revision I flagged that a "V" inscribed in a centred egg touches at three points with long
inward cuts between them, and might lose its rock identity. **That risk is gone.** Put the rock at
the junction and the two arms grow up and out of it. The base rock's placement becomes an authored
decision per mark — which is exactly what a lab is for.

### One signed distance, four jobs

The base rock is still a carved icosphere, which is a purely **radial height field** — `meteorBody.ts:108-121`
displaces every vertex along its own direction and nothing else. Measured from the rock's *own*
centre rather than the world origin, that property survives intact, and it is what makes everything
below closed-form:

```
  d(q) = length( q − rockCentre ) − rockRadius( direction, seed )

           d < 0   inside the rock          d ≈ 0   the skin        d > 0   beyond it
```

From that one number, computed per target vertex at build time:

```
  aCrust  = band( d, 0, CRUST_THICKNESS )      ← 1 only in a SHELL around the old skin
  aDelay  = clamp( d, 0, ∞ ) / maxOutside      ← 0 at the rock, 1 at the furthest extremity
  aCharge = 1 − aCrust                         ← where energy seeps through before anything opens
  cling   = pull q back onto the skin where d > 0, by uCling
```

Note `aCrust` is a **band**, not a threshold. Deep inside the rock is freshly cut interior → crystal.
Far outside is new growth → crystal. Only the thin shell that was genuinely the rock's skin is crust.
That is both physically honest and exactly what the reference shows.

---

## 3 · Which also gives you one knob for the whole spectrum

The base rock's **size** relative to the letter slides continuously between two completely different
looks, with no code change:

```
  rock ⊇ letter            rock ≈ letter            rock ⊂ letter
  ███████████              ███▒▒▒▒▒███              ▒▒▒▒▒▒▒▒▒▒▒
  ██▒▒▒▒▒▒▒██              ██▒▒▒ ▒▒▒██              ▒▒▒▒███▒▒▒▒
  ███████████              ███▒▒▒▒▒███              ▒▒▒▒▒▒▒▒▒▒▒

  CARVED GEODE             the reference             GROWN CRYSTAL
  mostly crust, crystal    a rocky letter with       a crystal letter with
  only in the cuts         crystal in its cuts       a rocky core showing
```

The reference sits in the middle. "A base rock that grows" is the right-hand end. Both are the same
build, the same shader, one slider apart — which is the strongest argument that this is the right
abstraction.

`uCling` is the companion knob: how hard the letter's surface is pulled back onto the rock's skin
where it would poke through. At 1 the outer face bulges like the rock it was carved from (the
reference); at 0 the letter keeps its own clean profile with the rock embedded in it.

```
   uCling = 0                  uCling = 1
   ┌────────────┐                 ╭────────────╮
   │            │                ╱              ╲     ← outer face bulges,
   │    ▒▒▒▒    │               │      ▒▒▒▒      │       it IS the old skin
   └────────────┘                ╰────────────╯
   reads as laser-cut            reads as carved out of a rock
```

**Honest limitation:** the cling is a radial pull, not a CSG boolean. The crease where the two
surfaces meet is approximated across whatever triangles straddle it rather than being an exact edge.
Real CSG would change topology per mark and destroy the morph, which is not a trade worth making —
and the surface carve hides the soft crease. Stated so nobody "fixes" it later.

---

## 4 · Geometry — a morphing prism, with a movable rock behind it

The topology problem is unchanged and so is its answer. A vertex morph needs the same vertex count in
the same order at both ends, and **you cannot continuously deform a sphere into a torus** — so
shrink-wrapping a rock onto an "O", an "A", the compass ring or the shield cutouts gives a dimple,
not a hole.

The fix: build the body as a **prism swept from 2D contours**, where at `p = 0` the outer contour is a
circle and **every hole already exists as an ε-circle** — a real through-tunnel, sub-pixel, invisible.
It opens as the morph runs. Topology never changes, so a linear morph is legal.

> The reference's "C" has no counter, which quietly dodges the single hardest case. "O", "A", "8",
> the compass ring and the shield cutouts do not. The ε-hole is not optional.

### Vertex layout

Four fixed budgets, so topology is identical for every mark and every value of `p`.

```
  ┌─ SIDE WALL ──────────────────────────────────────────────────────────┐
  │  per contour: POINTS_PER_CONTOUR columns × DEPTH_RINGS rows          │
  │   front ●───●───●───●───●   ← shared with the front cap boundary     │
  │         │   │   │   │   │                                            │
  │         ●───●───●───●───●     a regular quad grid, fully determined  │
  │         │   │   │   │   │     by the two constants                   │
  │    back ●───●───●───●───●   ← shared with the back cap boundary      │
  └──────────────────────────────────────────────────────────────────────┘
  ┌─ CAPS ───────────────────────────────────────────────────────────────┐
  │  boundary = the same resampled contour points as the wall's edge row │
  │  interior = refined triangulation, ~uniform edge length              │
  │      ●───●───●───●    triangulated ONCE from the target shape;       │
  │      │╲  │╲ ╱│  ╱│    the index buffer never changes, only positions │
  │      │ ●─┼─●─┼─● │                                                   │
  │      ●───●───●───●                                                   │
  └──────────────────────────────────────────────────────────────────────┘
```

`THREE.ShapeUtils.triangulateShape(contour, holes)` — the same call `ExtrudeGeometry` uses — returns
index triples into the concatenated point list with no Steiner points, so every cap vertex *is* a
contour point and already has a source position. Then refine: **resample the boundary at the target
edge length first, then longest-edge-bisect interior edges only.** Boundary edges must never split —
they are shared with the wall grid and with the contour correspondence.

Why refine at all: a flat earcut cap is long slivers with no interior vertices. It cannot take a
surface carve (nothing to displace) and it cannot round into a rock at `p = 0`. The refinement is what
makes both the crystal facets and the base rock possible.

**Is the target's triangulation valid at `p = 0`?** Yes. A polygon triangulation uses only diagonals
between boundary vertices, and whether two diagonals cross is decided by the *cyclic order*, which
arc-length resampling preserves. Mapped onto a convex source, no two diagonals cross.

### The base rock, at `p = 0`

Every vertex has a parametric coordinate. Map it onto the rock: wall vertices to the equatorial band
(angle from normalised arc length), cap vertices to the hemispheres (`z = ±R·√(1−r²)`), hole contours
collapsed to ε-rings. Carve with **the same three-lobe structure the field's meteors use** (`lobeAt`,
`meteorBody.ts:51`) so it is visibly a sibling of the rocks in the Works field — then apply the rock's
authored **pose**: offset, scale, stretch, rotation.

The map need not be injective — folds are inside an opaque convex body and cannot be seen. Continuity
is the only requirement.

### Pose is not shape — and that is what keeps mark swaps invisible

The design relies on being able to swap geometry silently at `p = 0`, because a mark change is
*close → swap → reopen* (which the reference shows anyway, frames 7–12):

```
   "V" ──close──▶ rock ──[silent swap]──▶ rock ──open──▶ compass
                       ╰── and it drifts/tumbles to the next mark's pose ──╯
```

That only works if the rock looks the same before and after. So the rule:

> **The base rock's *shape* is global — one seed, one carve, shared by every mark.
> The base rock's *pose* is per-mark, and is lerped on the object transform.**

Shape lives in the vertex morph; pose lives in the mesh's matrix. They never interact, the pose lerp
costs nothing, and the rock visibly *travels and tumbles* between marks instead of teleporting. If
each mark had its own carve seed the swap would pop, so that is deliberately not offered.

**Shapeshift while idle:** a low-amplitude vertex wobble scaled by `(1 − uGrow)`, applied in the
shader on top of the morphed position, so the base rock breathes and is never a static prop — and it
costs one noise call and no rebuild.

---

## 5 · Choreography — four curves, one progress

Everything is a pure function of one `p`. No timelines, no flags, no "arrived" sentinels — the rule
this site was rebuilt once to enforce (`docs/services-to-works-flight.md`).

```
   p    0        .15      .3       .5              .8       1
        │─────────│────────│────────│───────────────│───────│
 uCharge ▁▁▂▄▆████████████████████████████████████████▆▄▂▁▁▁   glow
  uGrow  ▁▁▁▁▁▁▁▁▁▁▂▄▆████████████████████████████████████▇▆   silhouette
 uReveal ▁▁▁▁▁▁▂▄▆████████████████████████████████████████▇▇   crystal
  uVein  ▁▂▄▆████▆▄▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁   gold flare

         └─ frames 1-3 ─┘└──── frames 4-6 ────┘
         charge leads, geometry follows, crystal surfaces with the cut
```

For the round trip `p` runs 0 → 1 → 0 and the curves replay backwards. In the lab this is a scrub
slider plus play/loop; on the site it would be scroll progress. **The curves must be tunable** — where
charge starts relative to grow is the entire feel of the effect, and it is not guessable. That is the
lab's real job here.

---

## 6 · Materials — two treatments, one draw call

Blended by `aCrust` inside a single `MeshStandardMaterial` via `onBeforeCompile`, so PBR, the texture
registry, the tuner and the bloom pass all keep working.

**Crust** — already exists. `createMeteorMaterial` (`meteorBody.ts:135`) uses **one texture as both
albedo and emissive**: dark rock emits nothing, bright veins burn, and the bloom pass turns that into
real glow. The basalt-magma texture with an amber emissive *is* the reference's gold veins.

**Crystal** — new. Faceted druzy: angular high-frequency displacement baked into the target positions
where `aCrust ≈ 0`, flat-shaded, emissive, with vein colour bleeding through. The facets want
cellular/Worley noise, and **there is no cellular noise helper in the codebase** (only `portalGate.ts`
has anything noise-shaped), so that is genuinely new code, ~40 lines.

> **Brand check.** The reference is amethyst purple. Voidix's accent is electric cyan (`#00e5ff`),
> and the sun, fleet, nav meters and FAQ hologram all sit on it. A purple mark would be the only
> purple thing on the site. **Recommend cyan crystal with the crust's gold/amber veins unchanged** —
> the warm/cool split survives, and cyan-on-basalt is the palette the works field already runs. One
> constant either way, so worth judging on screen rather than on paper.

---

## 7 · What survives, what goes

| | verdict |
|---|---|
| `markSwarm.ts` (533 ln) | **deleted.** Only LetterLab consumes it. Recoverable at `61c0b76`. |
| `ChunkMixBalancer.tsx` (127 ln) | **deleted.** One rock has no mix to balance. |
| `edgeWeight` / `interiorWeight` on `ChunkMaterialSpec` | **removed.** Nothing else reads them. |
| `DEFAULT_CHUNK_SPECS` — 5 specs | **collapses to two:** crust and crystal. |
| `ChunkSpecEditor.tsx` | **survives**, promoted — it now edits one of the two treatments. |
| `CHUNK_TEXTURES`, `createChunkMaterial`, `createMeteorMaterial`, `createStoneMaterial` | **survive unchanged.** |
| `markBody.ts` — shapes, `solid` body, materials | **survives unchanged.** |
| `marks.ts` | **survives.** `loadMarks()` stays unused. |
| `markPresetSource.ts` | **rewritten** — everything it exports changes shape, and it must now export a per-mark pose. |
| formation knobs: stagger, edge delay, order, base fraction, cloud radius, cloud drift | **removed** — they describe a pool of chunks. |
| **new: base rock** | offset x/y/z · scale · stretch x/y/z · rotation · seed · carve amplitude · idle wobble |
| **new: the cut** | `uCling` · crust thickness · crystal facet scale/amplitude/colour/emissive |
| **new: choreography** | the four phase curves · slab depth · letter scale |

---

## 8 · Side effects, ranked by how much they will hurt

**1 · Two existing bugs are prerequisites, not cleanup.** `useLetterLab.ts:587` returns *before* two
`useEffect`s declared at lines 595 and 599 — unreachable. Every material control and the whole chunk
mix are inert today, and **Copy config therefore exports values that were never rendered**. Every new
knob here would be silently inert the same way. Second: slab depth is baked into the swarm at
construction (`markSwarm.ts:403`) but sits in the *geometry* effect (`useLetterLab.ts:568`), so it
does nothing in rock mode.

**2 · `enableMeteorMorph` cannot be reused, for a reason that is easy to miss.** Its swell line does
`normalize(transformed)` (`meteorMorph.ts:105`), safe only because *"the carve clamps every vertex to
MIN_RADIUS, so none sits at the origin"*. A prism's cap centre and its ε-hole vertices sit **at** the
origin. `normalize(vec3(0))` is NaN — and `uSwell = 0` does **not** save you, because `0 * NaN` is
NaN. Those vertices fly to infinity dragging their triangles with them. So: a sibling
`markGeodeMorph.ts`, same `onBeforeCompile` technique, no swell, **zero edits to a file the shipped
Works section depends on**.

**3 · Pose is now per-mark data, and the export has to carry it.** A base rock placed by hand for the
V is worthless if it can't be saved. `markPresetSource.ts` must emit a pose per mark id, not one
global block — otherwise the authoring this whole revision unlocks evaporates on reload.

**4 · The rock can be placed somewhere that produces no crust at all.** Fully inside the letter, or
fully outside it, and the shell band never intersects the surface — the mark comes out uniformly
crystal and the "geode" read is gone. Not a bug, but the panel should *show* the crust share (a
percentage, the way `ChunkMixBalancer` showed mix shares) so it's visible before it's confusing.

**5 · The reference is an offline render; parts are not reachable in realtime.** Achievable: the
silhouette choreography, the crust/crystal split, the seeping charge, faceted crystal geometry,
bloom. Not at that fidelity: true subsurface scattering, and the sheer *density* of individually
modelled druzy crystals. `MeshPhysicalMaterial`'s `transmission` + `thickness` could fake translucency
(the deck and sun lab already use physical materials), but transmission forces an extra scene render
and this page already runs bloom — budget it before committing. Expect ~80%, with the gap in crystal
density.

**6 · Legibility.** Carve amplitude that makes a convincing rock will round off a counter or the V's
notch — mitigated by splitting displacement anisotropically (strong through the thickness, damped
in-plane), which must exist in the first build. And the letter only reads from the front; the lab
spins the body, and at 90° a C is a lumpy slab. Already true of today's marks.

**7 · `normaliseAndCentre` must apply the *same* transform to both ends.** Scale and centre from the
**target's** bounds and apply that matrix to source and target alike, or the body changes size for
reasons unrelated to the growth. The rock's pose offset is applied *after* that, in rock-local space,
so moving the rock never rescales the letter.

**8 · The Y-flip trap, again.** `markBody.ts:20-34` documents it: SVG is Y-down, three is Y-up, the
fix is `rotateX(π)` — a proper rotation — **never** `scale(1,-1,1)`, which is a reflection and inverts
winding. The swarm didn't care (point cloud). This body has real surfaces and does. Apply the
identical rotation to source positions, target positions and both normal sets — **and to the rock's
pose offset**, or a rock placed low on an SVG mark jumps to the top.

**9 · Facet pop on a mark swap.** Two marks give different cap tessellations, so with flat shading the
silent swap at `p = 0` changes the facet pattern visibly. Refining to a uniform target edge length
reduces it to a flicker; smooth shading on the crust removes it. The crystal wants flat shading for
its facets — so shade *per-region*, flat where `aCrust ≈ 0`, smooth where it's 1, in the same shader.

**10 · The mark reads darker and calmer than the swarm.** 600 chunks at ~10% molten throw a lot of
bloom; one rock throws one rock's worth. Expect to re-tune `BLOOM_STRENGTH` and the emissives once.
The crystal's own glow largely replaces what's lost, but not on the first render.

**11 · Rebuild hitch on knob changes.** Resample + triangulate + refine + two carves for ~30–60k
vertices is tens of ms on the main thread. Already debounced at 220 ms (`useDebounced`), so it lands
as one hitch on slider release, never during the morph. **Moving the rock's pose must not trigger it**
— pose is a transform and a uniform, so it should be live and draggable at 60fps while size and seed
stay debounced.

**12 · Performance strictly improves.** From up to 25 `InstancedMesh` draw calls plus ~600 CPU matrix
composes per frame (`markSwarm.ts:475-513`) to **one mesh, one draw call, zero per-frame CPU**.

**13 · The lab's lighting is not the field's.** The six light/bloom constants are hand-copied and
currently match `useWorksField.ts:162-175`, but the lab has **no `RoomEnvironment` IBL**, no
`OutputPass`, no `SMAAPass`. `createStoneMaterial` sets `envMapIntensity: 0.35` — with no environment
that contributes nothing. **Crystal depends on reflections far more than 600 matte chunks did**, so
this goes from cosmetic to disqualifying. Adding `RoomEnvironment` is small and must ride along.

**14 · Docs go stale.** `markChunkMaterial.ts:88-108` is a long essay about a five-way mix that will
not exist. `useLetterLab.ts:74` already points at `markAggregate.ts` (gone) and `marks.ts:38` at
`docs/works-marks-plan.md` (gone). CLAUDE.md's rule applies: fix them as part of the change.

---

## 9 · Approaches considered and rejected

| approach | why not |
|---|---|
| **Shrink-wrap an icosphere onto the letter** | Cannot create through-holes — genus is fixed. O, A, 8, the compass ring, the shield cutouts all come out as dimples. |
| **Radial raycast from the origin** | Keeps `meteorMorph` working unchanged, very tempting — but letters are not star-shaped. The V's notch bridges over and counters fill. Fails on legibility, the one thing a mark cannot fail. |
| **Real CSG boolean (letter ∩ rock)** | Exactly right geometrically, and it changes topology per mark — no stable vertex buffer, no morph. `uCling` is the approximation that keeps the morph. |
| **Marching cubes on a blended SDF, per frame** | Handles holes and splits perfectly, but topology changes every frame → no GPU morph, plus 10–20 ms/frame CPU. |
| **Raymarched SDF (3D SDF texture per mark)** | Highest visual ceiling and the crystal would be gorgeous. Rejected because it abandons `MeshStandardMaterial` — the entire texture/treatment/tint/roughness authoring surface this lab exists for would need re-implementing as a hand-written lighting model, with no IBL. Revisit only if the mesh carve can't be made to look good. |
| **Per-mark base rock *shape*** | The mark swap at `p = 0` stops being invisible. Pose is per-mark; shape is global. |
| **Instanced druzy crystals on the revealed surface** | Closest to the reference's crystal density — but reintroduces the hundreds-of-instances approach this change exists to remove. Hold as an optional later layer. |

---

## 10 · Build order

Each step leaves the route working and is reviewable on its own.

1. **Fix the two bugs** (§8.1). Verify by moving a mix slider and seeing the scene change. Worth doing
   even if the rest is abandoned — the export is currently untrustworthy.
2. **Add `RoomEnvironment` to the lab** (§8.13). One-screen change, and nothing about crystal can be
   judged without it.
3. **`markGeodeBody.ts`** — the builder, headless. Contour resample → wall grid → cap triangulate +
   refine → parametric rock map → pose → signed distance `d` → cling → `aCrust` / `aDelay` → two
   carves. Returns `{ geometry, targetPositions, targetNormals, delay, crust }`. No React, no scene.
   Sanity-check static at `p = 1`.
4. **`markGeodeMorph.ts`** — the `onBeforeCompile` injection: position/normal morph with per-vertex
   delay, crust/crystal blend, charge bleed, per-region shading, idle wobble. Modelled on
   `meteorMorph.ts`, no swell.
5. **Wire into `useLetterLab`** as `body: 'geode'` alongside `solid` and `rock`, so all three compare
   side by side for one round. Scrub slider over `p`, play/loop, the four phase curves, and a **live
   draggable rock pose** with the crust share shown.
6. **Judge it — go/no-go.** Tune before deciding. **Test three cases the reference doesn't answer:**
   "V" with the rock in the crook, a holed mark (the compass), and the rock-smaller-than-letter end of
   the size spectrum.
7. **On approval, remove the swarm.** Delete `markSwarm.ts` and `ChunkMixBalancer.tsx`, collapse
   `DEFAULT_CHUNK_SPECS` to crust + crystal, drop the weight fields, rewrite `markPresetSource.ts`
   with per-mark poses.
8. **Docs.** `markChunkMaterial.ts`'s header, the two stale references, CLAUDE.md Part 2/4.

---

## 11 · Open questions

1. **Purple or cyan crystal?** §6. Recommend cyan; worth judging on screen.
2. **Does this body ever return to the Works field?** The whole mark pipeline is orphaned today —
   `markSwarm`, `marks`, `markChunkMaterial` and `loadMarks` are consumed *only* by `/letters`, and
   `useWorksField` renders a carved meteor with no mark in it anywhere. If marks are coming back, the
   new modules belong in `WorksField/` as designed. If not, the whole pipeline should move under
   `components/lab/LetterLab/` and stop pretending to be section code.
3. **Keep `body: 'rock'` (the swarm) after approval, or delete it?** Deleting is the CLAUDE.md-correct
   answer and git holds it at `61c0b76`. Step 5 keeps both regardless.
4. **Is the round trip (frames 7–12) part of the mark's life on the site, or lab-only?** Free either
   way, but if marks close and reopen between projects that is a section-level pacing decision.
5. **Names.** `markGeodeBody.ts` / `markGeodeMorph.ts` — reads well against `meteorBody` /
   `meteorMorph`, and "geode" is what the thing actually is.
