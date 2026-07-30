# The geode's base rock — making it a solid, properly textured rock

> **Status:** PLAN. Nothing built. Written 2026-07-29 against the geode as it stands in `/letters`
> (`markGeodeBody.ts` · `markCapMesh.ts` · `markContours.ts` · `markRockField.ts` · `markGeodeMorph.ts`).
>
> **Blast radius: the lab only.** `buildGeodeBody` and `enableGeodeMorph` have exactly one call site
> — `components/lab/LetterLab/hooks/useLetterLab.ts`. The works field still runs the swarm. Nothing
> in this plan can reach the homepage.
>
> **The complaint:** at `p = 0` the body is not a rock. A "V" opens a large wedge-shaped hole through
> the middle of it, and the texture on what *is* covered is smeared. The morph should shape-shift a
> solid model, not collapse an extrusion onto a sphere and leave the gaps showing.

---

## 1 · What is actually happening

The body is a prism swept from the mark's own contours — front cap, side walls, back cap. At `p = 0`
every one of those vertices is placed somewhere on the base rock's skin. **Where** is decided by a
polar map about the mark's centroid (`markGeodeBody.ts:337–355`):

```
  azimuth      = atan2( point − centroid )
  radiusRatio  = |point − centroid| / boundaryRadius( azimuth )      ← clamped to 1
  polar angle  = capShare · π · radiusRatio                          ← front cap
```

That is a **star-shaped** map. It is a bijection only if every ray from the centroid crosses the
outline exactly once. No interesting glyph satisfies that, and a "V" fails it hard:

```
   the mark: helvetiker "V"              the rock's front cap, seen down +Z
                                          (what the map actually paints)

    ██▖          ▗██                            ╭───────────────╮
     ██▖        ▗██                          ╱▓▓▓▓             ▓▓▓▓╲
      ██▖      ▗██                         ╱▓▓▓▓▓               ▓▓▓▓▓╲
       ██▖    ▗██                         │▓▓▓▓▓                 ▓▓▓▓│
        ██▖  ▗██                          │ ▓▓▓▓      HOLE      ▓▓▓▓ │
         ██▖▗██                            ╲ ▓▓▓▓▓           ▓▓▓▓▓ ╱
          ████                              ╲  ▓▓▓▓▓▓  ·  ▓▓▓▓▓▓  ╱
                                              ╰──────▓▓▓▓▓──────╯
    ▲ the notch is EMPTY                              ▲
      no cap triangles live here                      · = the pole, uncovered too
                                                        (the centroid is in the notch,
                                                         so no triangle contains it)

   ▓ = surface the map paints    blank = nothing was ever drawn there
```

Two independent gaps, not one:

1. **The caps gap.** The notch has no material, so no cap triangle maps into that angular sector.
   The sector — from near the pole out to the rim — is simply never painted. The material is
   `DoubleSide`, so you look straight through the front shell at the inside of the back shell. That
   is the "big hole in the middle".

2. **The wall band gap.** Walls are laid into the equatorial band at the azimuth of their own outline
   point. For a V the centroid sits *outside* the polygon, so walking the outline makes the azimuth
   sweep back and forth instead of advancing monotonically. The band therefore gets covered **twice**
   over the arms (two shells z-fighting) and **not at all** over the notch.

`markGeodeBody.ts:166–173` already anticipates this and calls it harmless — *"folds happen inside an
opaque convex body at p = 0 and cannot be seen."* That is true of folds. It is not true of gaps, and
the same defect produces both.

### And the texture

UVs are the mark's planar XY (`markGeodeBody.ts:439–440`). At `p = 1` that is correct. At `p = 0`
the same UVs are dragged onto the rock through the broken map, so:

- near the centroid, `radiusRatio → 0` means an entire disc of rock is covered by an infinitesimal
  neighbourhood of one point of the letter — the texture there is one texel smeared over a large area;
- the stretch factor varies by orders of magnitude across the surface, so grain size does too;
- `texture.anisotropy` is never set **anywhere in this project**, so every grazing-angle texel is
  blurred on top of that.

So even with the holes fixed, the current UV scheme cannot make the rock read as stone.

---

## 2 · What cannot be traded away

Any fix has to keep all five of these, or it is a different feature:

| | |
|---|---|
| **One mesh, fixed topology** | A vertex morph needs the same vertices in the same order at both ends. This is what makes the whole thing a pure function of `p` — the ONE CLOCK rule. |
| **Holes pre-drilled** | A sphere cannot become a torus. "O", "A", the compass ring and the shield's cutouts exist at `p = 0` as ε-radius tubes. That trick stays. |
| **The letter is exact** | Legibility is the mark's only job. The silhouette at `p = 1` must be the real outline, not an approximation of it. |
| **The rock is closed** | A solid, uniformly-shaded, properly-textured carved rock at `p = 0`. This is the thing being fixed. |
| **Reversible** | Everything a pure function of `p`, so frames 7–12 are frames 6–1 run backwards. |

The tension is between rows 3 and 4: **one mesh has to be well-tessellated for two very different
shapes**, and whichever end drives the connectivity is the end that comes out exact.

---

## 3 · Three routes

### Route A — keep the prism, replace the map *(recommended)*

Connectivity still comes from the mark, so the letter stays exact by construction. The broken polar
map is replaced with a **provably fold-free parameterization**: pin the cap's outer boundary to a
circle by arc length, solve a mean-value Laplacian for the interior, and you have a bijection from
the mark's cap to a disc. Tutte's theorem guarantees no fold and no gap for any simple polygon,
concave or not. Map the disc onto the rock's polar cap and the sphere is covered exactly once.

```
   cap mesh (V)              mean-value disc map            disc → polar cap
                              boundary pinned to the         (equal-area / Lambert)
    ██▖    ▗██                circle BY ARC LENGTH
     ██▖  ▗██                   ╭─────────╮                       ╭───╮
      ██▖▗██                   ╱ · · · · · ╲                     ╱ ▓▓▓ ╲
       ████        ──▶        │ · · · · · · │      ──▶          │ ▓▓▓▓▓ │
                              │ · · · · · · │                    ╲ ▓▓▓ ╱
                               ╲ · · · · · ╱                      ╰───╯
                                ╰─────────╯
                     the notch's two inner edges are part of the
                     boundary, so they take their fair share of the
                     circle — and the triangles behind them stretch
                     to fill the sector that used to be a hole
```

The surface budget becomes exact and unambiguous:

```
  polar   0 ──────── capShare·π ─────────────── (1−capShare)·π ──────── π
          │  front cap    │          walls           │   back cap   │
          └───────────────┴──────────────────────────┴──────────────┘
             disc map          outline arc-length          disc map
                               (now monotone, because
                                the disc pinning IS the
                                angular ordering)
```

Because the wall's azimuth is now the pinned disc angle of its own boundary vertex, and that pinning
is monotone around the loop by construction, the band is covered once. Both gaps close for the same
reason.

**Cost:** one sparse solve per mark. ~120 lines, and the neighbour lists it needs are *already built*
by `markCapMesh.smoothInterior`. Gauss–Seidel over 5–20k unknowns, initialised from the current polar
map, converges in a few hundred sweeps — order 100 ms.

**Crucially, the solve depends only on the cap's connectivity — not on the rock.** So it caches per
(mark · `capEdgeFraction` · `capSubdivisions`), and moving the rock, changing `cling`, `crustThickness`
or the carves re-poses a cached shell instead of re-solving. The rock's pose gets *faster* than it is
today, not slower.

### Route B — mesh from the rock, shrink-wrap onto the letter

Literally "shape-shift the model": start from a uniform icosphere (tubes pre-drilled for holes),
project each vertex onto the prism, relax tangentially.

The rock comes out perfect — uniform triangles, natural spherical UVs, the carve fully resolved. **The
letter does not.** A uniform sphere has no vertices on the mark's silhouette, so the outline becomes
whatever the triangulation happens to cut. At 10k vertices the edge length on a 2.6-unit mark is
~0.05 world units and the outline is visibly polygonal; counters come out ragged. Getting a crisp
letter back means feature-aware snapping plus a constrained remesh — a research project, and the one
thing we cannot compromise is the letter.

**Route A and Route B are the same machinery viewed from opposite ends.** A dominates because it
takes its exactness from the end where exactness is non-negotiable.

### Route C — two bodies, no morph

A real carved rock mesh (`meteorBody.ts` already makes these, with sane UVs) plus the mark's prism;
the rock cracks and recedes while the mark grows out of it. Cheapest by a distance and the rock would
be flawless — but it abandons the continuous shape-shift the storyboard is built on, and a dissolve is
what the swarm already does. Listed for completeness; recommend against.

---

## 4 · The build

### Phase 0 — the charge beat moves to the end *(authored, not a bug fix)*

Today `charge` ramps over `p = 0.02 → 0.30`, so the rock glows orange through almost the whole
opening. That is the second reason it does not read as stone. **The charge moves to the last 10% of
forming: `chargeStart 0.9, chargeEnd 1.0`.**

```
                p  0        .2       .4       .6       .8       1
                   ├────────┼────────┼────────┼────────┼────────┤
   BEFORE  charge  ─▄███████████████████████████████████████████   lit almost throughout
   AFTER   charge  ─────────────────────────────────────────▄████   inert stone, then it wakes
```

Two things fall out of this, and they are the point:

- **The rock is completely unlit until 0.9.** Not just dimmer — unlit. The other emissive term,
  `uVeinFlare`, multiplies `totalEmissiveRadiance`, and the crust spec is the `stone` treatment,
  which carries **no emissive map** — so it is multiplying zero. The "Vein flare / Flare at / Flare
  width" sliders do nothing as currently configured. They would only come alive if the crust were
  switched to the `meteor` treatment, which is exactly what `DEFAULT_CHUNK_SPECS` deliberately
  avoided (it turned basalt-magma's seams into glowing veins). Left as-is; documented so no time is
  lost tuning dead knobs.
- **The last 10% becomes a pile-up**, deliberately: `spread` crossfades crystal coverage 0.15 → 0.8
  over `0.9 → 1.0`, `grow` finishes at 0.92, and now `charge` fires across the same window. Three
  beats landing together read as the mark coming alive as it completes.

The one consequence to watch: `ramp()` is monotonic, so charge **holds at 1 once it arrives** — the
settled mark keeps a faint wash on every opened surface (`chargeStrength` 0.22). If it should flare
and fade instead, charge needs to become a trapezoid (rise bounds + fall bounds). Worth knowing that
`markGeodePhases.ts`'s own diagram already draws it rising *and falling* — the diagram describes an
intent the code never implemented. Fixing the diagram is part of this phase; adding the fall is a
decision, not a defect.

### Phase 1 — the parameterization *(fixes the hole)*

New file: `components/sections/WorksField/markDiscMap.ts`.

1. **Neighbours and mean-value weights.** Mean-value coordinates (Floater), not cotangent — cotangent
   weights go negative on obtuse triangles and a negative weight can fold the map. Mean-value weights
   are strictly positive, which is what makes Tutte's guarantee hold.
2. **Pin the outer boundary** to the unit circle by normalised arc length. The cap's boundary vertices
   already carry `params` (`CapLoop.params`) — the pinning is `angle = 2π · param`, free.
3. **Pin each hole** to a small circle of radius `holeSeedFraction`, centred at the hole's normalised
   centroid, clamped to stay clear of the outer circle and of each other.
4. **Solve** the interior with Gauss–Seidel to a tolerance, initialised from the existing polar map.
5. **Validate**: check every triangle's signed area is positive. If any is negative, or the solve
   stalls, **fall back to the current polar map and warn** — a mark that renders imperfectly beats a
   mark that renders as garbage.

Then in `markGeodeBody.ts`:

6. Replace `buildBoundaryTable` / `boundaryRadiusAt` / `polarOf` / `capPolar` / `holeAnchorPolar`
   (≈90 lines) with a lookup into the disc map.
7. Disc → polar cap by an **equal-area** relation, `polar = 2·asin( r · sin(capShare·π/2) )`, rather
   than the linear `polar = capShare·π·r` — a linear radius crowds triangles at the pole for no reason.
8. Keep the hole-tube chord construction exactly as it is; only its anchors change.

### Phase 2 — the texture *(fixes the smear)*

9. **Triplanar sampling** in `markGeodeMorph.ts`, injected at `map_fragment`, projecting from the
   **current object-space position**. That means: at `p = 0` the coordinate is the rock, at `p = 1` it
   is the letter — each end gets an undistorted projection with constant texel density, and mid-morph
   the surface slides through the material, which is what a rock coming apart should do. Object space,
   not world space, so the idle spin doesn't drag the texture across the surface.
10. `uTriplanarScale` and a blend sharpness as authored knobs. The crust spec's `textureRepeat` feeds
    the scale; `texture.repeat` is left at 1 for the geode so it cannot be applied twice.
11. **Anisotropy.** `texture.anisotropy = renderer.capabilities.getMaxAnisotropy()` on load. Nothing in
    this project sets it today; it costs nothing and it is half of "the texture looks fine".
12. Keep the `uv` attribute (the `solid` and `rock` bodies still use planar UVs) but the geode stops
    reading it.

### Phase 3 — optional: the rock field moves into the shader

The rock is closed-form — three products of sines. Evaluating it per-vertex in GLSL from a stored
sphere direction would make **every rock knob live**: pose, radius, stretch, seed, carve, cling and
the crust mask all become uniforms, and the 220 ms debounce disappears for the knobs that are hardest
to author blind. This is the deviation `mark-core-rock-plan.md` records at §8.11.

`silhouetteHold` is the one obstacle: it needs `max |target − source|` across the whole mesh, which is
a reduction the CPU has to supply. Either keep a uniform the CPU refreshes on rebuild, or normalise
against a fixed reference (rock radius + mark half-extent). Both are fine.

Deliberately after phases 1–2: it is an authoring-speed win, not a correctness one.

### Phase 4 — optional: remesh in parameter space

If phase 1's rock still shows stretched facets across the notch, generate a triangulation that is
uniform **on the sphere** and pull it back through the inverse disc map, with the mark's outline
inserted as constrained edges. Uniform rock *and* exact letter. Needs a constrained Delaunay
triangulation, which the project does not have (earcut takes no Steiner points). Only if measured to
be necessary.

---

## 5 · Side effects, exhaustively

### Certain — plan for these

| # | Effect | Why | Handling |
|---|---|---|---|
| 1 | **Every geode value needs re-tuning.** | `cling`, `crustThickness`, `markCarve*`, `silhouetteHold` and the whole choreography were authored against a body whose `p = 0` state was wrong. | Re-author in the lab after phase 1. Treat the current numbers as starting points, not as truth. |
| 2 | **`silhouetteHold` changes meaning most.** | It blends the delay toward normalised travel distance. Source positions move everywhere, so travel changes everywhere. | Expect 0.65 to be wrong. Re-tune last, after the pose is settled. |
| 3 | **Stretched triangles across the notch at `p = 0`.** | Covering an empty sector with material from beside it *requires* stretch — this is a metric fact, not a bug. The rock's carve is under-sampled there, so it reads as a smoother patch. | Raise `capSubdivisions`. Phase 4 if it still shows. Flagged, not hidden. |
| 4 | **Mid-morph self-intersection near a concavity.** | The stretched sheet retracts into the crotch and may briefly pass through an arm. | Opaque + `DoubleSide`, so it shows as interpenetration rather than a hole. Watch on the V and the C; the fix if needed is a small outward bias on the retracting sheet. |
| 5 | **~90 lines of `markGeodeBody.ts` are deleted.** | `ANGLE_BINS`, the boundary table, the polar helpers, the hole anchor map all become dead. | Delete, don't leave both paths live — except the deliberate fallback in step 5. |
| 6 | **Build time moves from the pose knobs to the tessellation knobs.** | The solve caches on connectivity. | `capEdgeFraction` / `capSubdivisions` get slower; everything else gets faster. Consider a per-knob debounce. |
| 7 | **`textureRepeat` is reinterpreted for the geode.** | Triplanar takes a world scale, not a UV repeat. | One knob, documented at both ends, `texture.repeat` pinned to 1 for the geode material only. |
| 8 | **`crustShare` stays valid but its meaning sharpens.** | It is computed from target positions and the rock field, both unchanged. Coverage changing means the *visible* crust changes even though the number does not. | No code change; note it in the panel copy. |

### Likely — decide when we get there

| # | Effect | Notes |
|---|---|---|
| 9 | **Multi-shape marks.** | Tutte pins one outer boundary to one circle. Two separate outer loops cannot share a rock. Check the three logos first: if any is multi-part, either give each shape its own rock (pose per shape, one shared field) or restrict the geode to single-shape marks. Uppercase A–Z and 0–9 are all single-component, so letters are safe. |
| 10 | **A hole close to the outline.** | Pinning a hole circle near the disc's edge can collide with the outer circle and break the solve. Clamp hole centres and radii; fall back if a collision is unavoidable. |
| 11 | **Elongated marks crowd.** | Harmonic maps compress the ends of a long thin shape ("I", "1"). Mean-value weights reduce this; if it bites, pin by a curvature-compensated parameter instead of raw arc length. |
| 12 | **Triplanar costs 3 samples.** | Irrelevant in the lab. Also irrelevant in the works field (4 marks), but note it before the geode ships there. |
| 13 | **`markCapMesh.smoothInterior` has a latent multi-shape bug.** | It pairs every outer loop with *all* holes from *all* shapes when testing insideness. Pre-existing, only bites on multi-shape marks — same trigger as #9. |

### Explicitly unaffected — checked, not assumed

- **The homepage.** No call sites outside the lab. Verified by grep.
- **The swarm (`rock` body) and the plain extrusion (`solid` body).** Different code paths entirely;
  they keep their planar UVs and their materials.
- **`markGeodePhases.ts`.** Pure functions of `p`; the choreography does not know what the geometry is.
- **The crust / charge / crystal masks.** All derived from the *target* positions against the rock
  field. Target positions do not change.
- **Reduced motion, the bloom pass, the environment probe, the drag rig.**

---

## 6 · Riding along (independent of the route)

These are real defects found in the same read, none of which depend on the decision above. Cheap, and
they make the re-tuning in §5.1 possible rather than maddening:

| | |
|---|---|
| **Two dead sliders** | `silhouetteHold` and `crystalPatchScale` are baked into the vertex buffers but missing from the geode rebuild effect (`useLetterLab.ts:899–922`). Moving them does nothing until some *other* geometry knob is nudged. |
| **The seed slider can't reach its default** | `rockSeed: 149` against `min={0} max={20}`. The thumb pins at 20 while the label reads "149.00", and the first touch silently changes the rock. |
| **`MAX_GROWTH_DELAY` is applied conditionally** | Only inside `if (silhouetteHold > 0)` (`markGeodeBody.ts:688`). At hold 0 the furthest vertex keeps a delay of exactly 1.0 and never arrives — the file's own comment warns about precisely this. |
| **`spread` has no UI** | `spreadStart` / `spreadEnd` are the beat where crystal takes the finished mark. Not editable. |
| **"Copy config" exports nothing about the geode** | ~35 authored numbers with no way out of the lab. After a re-tune that is the difference between work saved and work lost — **this one should land before the re-tune, not after.** |
| **Dead import** | `DEFAULT_GEODE_MORPH` imported in `LetterLab.tsx` and unused; the crystal defaults are hand-retyped beside it instead. |

---

## 7 · Verification

The user runs the app (`CLAUDE.md` §Verification). What to look at, in order:

1. **`p = 0`, backdrop `Site`, body `geode`, glyph "V"** — a closed rock. No wedge, no see-through,
   no seam at the equator. Drag all the way round.
2. **Step through O · A · C · S · 8** — every concavity and every counter closed at `p = 0`.
3. **The three logos**, especially the compass ring (a hole) and the shield (cutouts).
4. **Scrub 0 → 1 → 0 slowly.** The close must be the open reversed, exactly. Then scrub violently —
   it must not be outrunnable.
5. **Texture:** at `p = 0` the grain should be the same size everywhere on the rock, and the same size
   it is on the letter at `p = 1`.
6. `npx tsc --noEmit` and `npm run build`.

A one-frame regression check worth keeping: **the RSS square logo is nearly convex**, so the current
map almost works on it. It should look essentially unchanged after phase 1. If it changes a lot,
something in the new map is wrong.
