# Mark → mark — three ways to change the body

> **Status:** THREE PROPOSALS, nothing built. Written 2026-07-30.
>
> **Why this document exists:** the geode (`docs/geode-solid-rock-plan.md`) solves *rock → mark*, which
> happens at most once, on entry. The event that happens on **every project step** is *mark → mark*,
> and a pre-drilled-rock design has nothing to say about it. That was an aiming error, not a coding
> one — see §6 for what survives from it.

---

## 1 · The problem, stated correctly

Four projects, four marks: three SVG logos and one glyph. One persistent body at the origin. Each stop
change runs the schedule in `worksTransition.ts`:

```
   0s          0.84       1.15  1.45                                        2.90s
   ├────────────┼──────────┼─────┼───────────────────────────────────────────┤
   │ text OUT   │          │     │                                           │
   │ rock spins up ────────┤▓▓▓▓▓│ spins DOWN to idle ───────────────────────┤
   │ field counter-spins ──┤ ✷   │                                           │
   │                    peak  the body changes                               │
   │                          ├── MORPH_SECONDS = 1.0 ──┤                    │
   │                          │     ├── text IN ────────┤                    │
```

So the budget is **one second**, beginning at peak blur (1150°/s — ~19° per frame) and finishing well
into the settle, where it is *watched*. `MORPH_SECONDS`' own comment says this out loud: *"the blur
only flatters something that would survive being watched."*

### What actually ships today

Nothing survives being watched, because there is no morph:

```ts
// useWorksField.ts:1004
if (startMorph(index)) return;
// Incompatible shapes — no morph is possible, so fall back to the original hard swap.
```

`attachMorphTarget` bails when `targetPosition.count !== position.count`. That test passes for two
carved icospheres — same base solid, same vertex count, carved radially — and **can never pass for two
extruded marks**. An "O" and a "V" differ in outline length, hole count and triangulation. So every
project step is a hard cut on one frame, hidden by the spin.

### What "no flaws" has to mean here

| | |
|---|---|
| **Crisp at rest** | Each mark reads exactly at its stop. The silhouette is the only job a mark has. |
| **Topology-proof** | Marks differ in hole count (compass ring, shield cutouts) and in piece count. No design may assume they match. |
| **Solid throughout** | Never see through the body, never see it come apart unintentionally. |
| **One body, one draw call** | The field is already the page's most expensive scene (●●●●●, `docs/performance-ratings.md`). |
| **No per-morph allocation** | `attachMorphTarget`'s comment: a new `BufferAttribute` per swap orphans GPU buffers — ~5.9 MB a step. Reuse or leak. |
| **Survives being watched** | It has to be good under the settle, not just under the blur. |
| **Degrades** | `prefersReducedMotion` → arrive at the target with no journey. |

### One trap to inherit, not rediscover

`meteorMorph.ts` earned two facts the hard way, and both apply to anything below:

- **A lerp between two irregular bodies passes through something rounder than either**, so an
  uncorrected morph visibly deflates to a potato at t = 0.5 and re-inflates. `MORPH_SWELL_UNITS`
  exists to cancel exactly that.
- **The swell must be radial, never along the normal.** On non-indexed geometry, face normals send
  each triangle off in its own direction and the shell opens along every edge.

---

## 2 · The question that produces the answers

Every approach is an answer to one question: **what carries the mark's identity across the swap?**
There are only three possible answers, which is why there are exactly three proposals.

```
   identity is …        CONNECTIVITY          PIECES             A FIELD
                        one mesh, always      N shards that      no mesh at all;
                        the same vertices     tile the mark      a distance function
                             │                     │                   │
                        ①  ONE SKIN          ②  SHARDS         ③  FIELD
                        liquid metal          fracture &         impossible
                        setting               reassembly         material
```

*(Your own idea — a persistent base rock with sub-rocks growing and retracting — is a fourth answer:
identity carried by a **seed**. Excluded from the three, as asked.)*

---

## 3 · ① ONE SKIN — every mark is the same mesh

**The move:** stop deriving the mesh from each mark. Build **one canonical mesh, once**, and express
every mark as nothing but a set of target positions on that fixed vertex layout. Then vertex counts
match *by construction*, `attachMorphTarget` can never fail again, and mark → mark is the morph the
field already ships.

```
   THE CANONICAL DOMAIN                        EVERY MARK IS A SET OF POSITIONS FOR IT
   built once, never rebuilt

     ╭───────────╮                          ┌──────────┬──────────┬──────────┐
    ╱ · · · · · · ╲     uniform disc        │    V     │    O     │  shield  │
   │ · · ◦ · · · · │    + K reserved        │  ██▖ ▗██ │   ▟███▙  │  ▟█████▙ │
   │ · · · · · · · │      ε-hole rings      │   ██▖▗██ │  ██   ██ │  █▓▓▓▓▓█ │
    ╲ · · · · · · ╱     + wall band         │    ████  │   ▜███▛  │   ▜███▛  │
     ╰───────────╯      + mirrored back     └──────────┴──────────┴──────────┘
                                              same vertex count, same indices,
                                              same UVs — only positions differ
```

**How a mark's target positions are computed.** Each mark's face gets a fold-free disc
parameterization (the `markDiscMap.ts` already written — mean-value Tutte). Push every *canonical*
disc vertex through the **inverse** of that map to find where it lands on the mark. Boundary vertices
are placed by arc length, so they sit exactly on the real outline — the silhouette is exact, not
approximated. Point location is a barycentric search in the mark's disc triangulation, accelerated by
a uniform grid; it runs once per mark, at load, where `loadMarks` already builds everything up front.

**Holes and piece counts, solved by hiding.** Reserve K hole rings and S face discs — the maxima
across all marks. A mark that uses fewer collapses the spares to ε **inside its own material**, where
an opaque solid swallows them. So a mark with no counter still carries the ring, invisibly.

That turns the hardest case into the best moment in the transition:

```
   O ─────────────────────────────────────────────────────────▶ V

    ▟███▙        ▟███▙        ▟██▙         ▟█▙         ██▖ ▗██
   ██   ██      ██  ██       ██ ▪█        ██ ·          ██▖▗██
    ▜███▛        ▜███▛        ▜██▛         ▜█▛           ████
   the counter   closing      a speck     swallowed    gone, still
                                                       carried inside
```

The hole *heals shut* and migrates into the arm. Reversed, a pinprick opens inside the V and inflates
into the O's counter. Neither is a compromise — both are better than a cut.

**Why it has no flaws**

- Exact at both ends: boundary vertices are on the outline, by construction.
- Solid at every intermediate frame: the silhouette mid-morph is the arc-length blend of two closed
  curves, which is a closed curve.
- Zero topology risk — the topology is fixed for all time, decided once.
- One mesh, one draw call, buffers allocated once. Reuses `enableMeteorMorph` / `attachMorphTarget` /
  `bakeMorphTarget` unchanged, including the leak fix.
- Reversible and resize-proof; reduced motion sets `uMorph` to 1 and bakes.
- **It subsumes the geode.** The rock is just one more target position set — the trivial
  parameterization. Entry (rock → mark) and every step (mark → mark) become the same mechanism with
  one uniform.

**Named risks, and the answer to each**

| Risk | Answer |
|---|---|
| Two very different marks give long travel and an ugly midpoint. | Inherit `MORPH_SWELL_UNITS`, radially. Choose each mark's boundary phase offset by a 1-D search that minimises total travel, so the outline doesn't rotate inside itself. |
| A blended silhouette could self-intersect. | Only for wildly mismatched marks, and on an opaque body a self-intersecting outline reads as a fold, not a hole. Phase alignment makes it rare. |
| Canonical density must suit every mark. | It is uniform in the *parameter* domain, so a thin mark gets the same density as a fat one — the failure mode of the per-mark mesh, inverted. |
| Inverse point location is fiddly. | ~150 lines with a grid accelerator, run 4 times at load. |

**Register:** precision engineering. The mark flows into the next like metal setting.
**Cost:** medium. Highest reuse of what exists. **Lowest risk of the three.**

---

## 4 · ② SHARDS — pre-fracture every mark into the same N cells

**The move:** fracture each mark's solid into exactly **N cells** (same N for every mark). Cell *i* of
the outgoing mark flies, tumbles and morphs into cell *i* of the incoming one. At rest the cells tile
the mark exactly, so the body is a genuine crisp solid; in flight it is real debris.

```
   AT REST              MID-TRANSITION                   AT REST
   cells tile exactly   real tumbling debris             the next mark

    ▟█▛▜█▙                ▗▘  ◣   ▝▖                     ▟█████▙
   ██╲│╱██              ◤   ▗▚  ◥   ▞                    █▛╲ │ ╱▜█
   █─ ╳ ─█      ──▶      ▝▖  ◢  ▘ ▗▘      ──▶            █─  ╳  ─█
   ██╱│╲██                 ◥   ▞  ◣                      █▙╱ │ ╲▟█
    ▜█▙▟█▛                  ▘ ▗▖  ▝                       ▜█████▛
   seams are interior    each shard is a solid,          seams interior
   faces, occluded       lit, tumbling body              again
```

**Why the topology problem evaporates.** Every cell is a small convex-ish solid — genus 0, always. A
hole in the mark is simply *where no cells are*. Nothing anywhere has to match hole counts, and a
multi-part mark is free.

**How it stays one draw call.** One merged `BufferGeometry`; each cell padded to a fixed vertex budget
with degenerate repeated vertices so the layout is uniform across marks. Per-cell attributes carry the
target position, a tumble axis and a flight delay; the vertex shader does everything. Same
morph-and-bake pattern, same reused buffers.

**Correspondence is what separates this from noise.** Match A's cells to B's cells by sorting both by
a space-filling curve over their centroids (or greedy nearest-neighbour). Short, coherent travel reads
as a body rearranging; random pairing reads as a particle effect.

**Why it has no flaws**

- Perfectly crisp and perfectly solid at rest — the cells *are* a fracture of the real mark.
- No topology constraint of any kind, anywhere.
- The mid-state is honest physics, which is exactly the register the 1150°/s spin already sets up.
- It is the evolution of the swarm you already built, with the swarm's actual weakness fixed: its
  chunks were generic rocks that never resolved into a solid; these are pieces *of the letter*.

**Named risks, and the answer to each**

| Risk | Answer |
|---|---|
| Hairline cracks between cells at rest, from float error. | Inflate each cell by ~1e-3 so neighbours interpenetrate slightly. Standard, invisible, robust. |
| Coincident interior faces z-fighting. | They sit behind the union's outer hull, so they are never rasterised in front of anything. Not an issue for opaque cells. |
| Clipped-Voronoi fracture in JS is real work. | The heaviest build of the three — ~400 lines, run 4 times at load. This is the honest cost. |
| Padding wastes vertices. | Bounded: pad to the 90th-percentile cell size and split the rare outlier. |

**Register:** physical, violent, memorable. **Cost:** high (the fracture). **Highest ceiling for
"people share this".**

---

## 5 · ③ FIELD — the mark is a distance function, raymarched

**The move:** no mesh at all. Each mark becomes a signed distance field — a 2D SDF texture of its
outline, extruded analytically — and the body is drawn by sphere-tracing `mix(sdfA, sdfB, t)`.

```
   t = 0            t = 0.35           t = 0.5            t = 0.8          t = 1
   ▟███▙            ▟██▛▜▙             ▟▙  ▟▙            ██▖ ▗██          ██▖ ▗██
  ██   ██          ██   ▝█            ██    █▙            ██▖▗██           ██▖▗██
   ▜███▛            ▜█▙▄▟▛             ▜█▄▄█▛              ████             ████
   material necks, pinches, splits and re-merges — for free, because a field
   has no topology to preserve
```

**Why it is the most convincing.** Nothing else gives you material that genuinely *necks and splits*.
Holes open and close because a field has no opinion about them. The silhouette at rest is
**analytically exact** — sharper than any mesh, with no tessellation at all. And a mark can be any
shape whatsoever: multi-part, nested, holes inside holes.

**Fitting it into the scene.** The raymarch writes depth, so the debris, the starfield and the bloom
composite correctly around it. `mix()` of two SDFs is not strictly a distance field, so sphere-trace
with a ~0.7 step scale for safety.

**Why it has no flaws on quality**

- No topology, no vertex budget, no correspondence, no parameterization — every hard problem in ① and
  ② simply does not exist here.
- Exact silhouette at every frame, including mid-morph.
- Opens the door to interior effects nothing else can do: light scattering inside the cracks as they
  open, real self-shadowing, refraction in the crystal.

**Named risks, and the answer to each**

| Risk | Answer |
|---|---|
| **Cost** — the real one. | March only inside a tight screen-space bounding quad of the mark, not fullscreen. Render the body to its own half-res target during the transition, near-full at rest. `performanceTier` already picks step counts. Marks occupy a modest footprint for most of the section. |
| **It cannot use `MeshStandardMaterial`.** | The basalt/lava look must be re-implemented by hand — triplanar albedo, the env probe, the emissive veins. A genuine cost, and simultaneously the biggest opportunity: a hand-written material is the most distinctive of the three. |
| SDF texture memory. | 512² R16F per mark, 4 marks ≈ 2 MB. Negligible. |
| Debugging a raymarcher is harder than debugging a mesh. | True. This is the option that should be prototyped in `/letters` before anything is promised. |

**Register:** impossible material. **Cost:** highest, and the least reuse. **Highest ceiling for
technical-excellence scoring, highest risk.**

---

## 6 · Choosing, and what happens to the geode

| | ① One skin | ② Shards | ③ Field |
|---|---|---|---|
| Crisp at rest | exact | exact | exact (analytic) |
| Solid mid-morph | yes | debris, deliberately | yes |
| Topology risk | none (fixed once) | none (per-cell) | none (no topology) |
| Draw calls | 1 | 1 | 1 (a quad) |
| Reuses shipped code | **almost all** | morph/bake pattern | almost none |
| Build cost | medium | high | highest |
| Risk it disappoints | low | low | medium |
| Memorability | high | **highest** | highest |

**Recommendation: ① as the spine, ② as the transition's character, if you want both.** They compose —
①'s canonical mesh can *be* one shard's worth of geometry, and a shard-based flight can carry a
canonical skin. But pick one to build first, and ① is the one that pays immediately: it is the only
option that turns today's hard cut into a real morph while reusing `enableMeteorMorph`,
`attachMorphTarget` and `bakeMorphTarget` untouched.

**The geode work is not lost.** ① makes the rock *one more target position set* on the canonical mesh,
so `markDiscMap.ts` (the fold-free parameterization, already written and typechecking) becomes the
core of ① rather than a fix to a dead end. `markGeodeBody.ts`'s prism construction is what gets
replaced — its parameter-domain thinking is what ① is built from.

---

## 7 · Current repo state, so nothing is lost

- `markDiscMap.ts` — **new, complete, typechecking.** Mean-value Tutte disc parameterization with a
  polar-map seed, two-pass hole pinning, and a fold-free validation that falls back to the seed.
- `markGeodeBody.ts` — rewired onto the disc map; the ε-ring construction and the boundary table are
  gone. Typechecks. **Not yet looked at in the browser.**
- `markGeodePhases.ts` — charge moved to the last 10% (`0.9 → 1.0`) as asked; `veinFlare` documented
  as inert (it multiplies an emissive map the `stone` crust does not have).
- `LetterLab` — the two dead sliders (`silhouetteHold`, `crystalPatchScale`) now rebuild; the seed
  slider reaches its own default; `spreadStart/End` exposed; "Copy config" now exports the geode's
  build, look and choreography as pasteable source.
- `npx tsc --noEmit` — clean.
