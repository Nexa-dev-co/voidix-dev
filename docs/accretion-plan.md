# Accretion — the mark grown out of a seed

> **Status:** DESIGN, fully specified, nothing built. Written 2026-07-30 after the first attempt was
> rejected on sight. The previous implementation (`accretionFill.ts`, `accretionTransition.ts`) and the
> hard-cut control are **deleted**, not iterated on — §1 explains why iterating would not have helped.
>
> **The plan is unchanged and is the user's:** one persistent base rock; rock grows out of it to form the
> mark; on a change the grown rock retracts away and new rock grows to form the next mark; the middle is
> a deliberate mess that reads as a plot twist. All four beats survive intact. What changes is *what a
> single grown rock is*, which is where the first attempt went wrong.

---

## 1 · Why the first attempt looked bad

Not bad luck, and not tuning. Six specific mistakes, each of which independently ruins the look:

**1 · The rocks were pebbles.** One icosahedron at `detail: 1`, carved gently, scaled uniformly. That is
a lumpy ball. Two hundred lumpy balls is not a rock formation — it is **gravel**, or worse, bubbles.
Real rock chunks are angular: flat facets, sharp edges, wildly varied aspect ratios. Nothing about a
scaled sphere says stone.

**2 · The silhouette scalloped.** Placing circles tangent to the outline gives you a wavy edge with a
period equal to the spacing. This is the oldest cheap-CG tell there is:

```
   wanted                     what tangent circles give

   ▁▁▁▁▁▁▁▁▁▁▁▁▁▁            ◜◝◜◝◜◝◜◝◜◝◜◝◜◝
   ▏            ▕            ●●●●●●●●●●●●●●
```

**3 · Growth was a scale-up in place.** The single most generic "spawn" there is. It says *particle
appeared*, not *material accreted*. Nothing grew from anything.

**4 · The base rock had no visible lineage to the marks.** The plan says rocks grow *from* it. My
chunks were pre-positioned at their destinations and inflated where they stood, so nothing ever left the
core, travelled, or touched it. **The story was not rendered at all** — which is the real failure.

**5 · The "mess" was a crossfade.** Things shrinking while other things grow is a dissolve. No debris,
no tumbling, no energy, no twist.

**6 · No hierarchy, no secondary motion.** All chunks one kind, one size band, and completely static —
`update()` did nothing on purpose. Hundreds of identical motionless peas. The project already learned
this lesson once and wrote it down in `markChunkMaterial.ts`: *"A mark built from a single surface reads
as a solid blob at a distance — the read comes from CONTRAST between chunks."* I ignored my own file.

None of these are fixable with sliders, which is why the code is gone rather than tuned.

---

## 2 · The one correction: a rock is a PIECE of the mark, not a pebble inside it

Everything follows from this.

Instead of packing shapes *into* the mark's area, **partition the mark's own solid into chunks**. The
union of the chunks is then exactly the mark — so the silhouette is exact by construction, holes are
exact, the chunks interlock because they were cut from the same stone, and each one is naturally
angular because its outline follows the partition rather than a sphere.

```
   PACKING (rejected)              PARTITIONING (this plan)

   ●●●●●●●●●●●●●               ┌──┬───┬──┬────┐
   ●○○○○○○○○○○●                │  │   │  │    │      each cell is a solid chunk
   ●○  ○  ○  ○●                ├──┴─┬─┴──┼──┬─┤      the union is the exact mark
   ●○○○○○○○○○○●                │    │    │  │ │
   ●●●●●●●●●●●●●               └────┴────┴──┴─┘

   scalloped edge,             exact edge, angular pieces,
   gravel read                 they interlock
```

This keeps every beat of the plan. The mark is still assembled out of many rocks; those rocks still
grow out of a persistent core; they still retract and regrow. They are simply *shaped like fragments of
the letter* instead of like peas, which is the whole difference between gravel and stone.

**And it makes the animation possible.** A chunk that is a fragment has a correct final position AND a
correct final orientation, so it can arrive by travelling and rotating into alignment — you can watch it
lock in. A sphere has no orientation to align, which is precisely why the first attempt had nothing to
animate but scale.

---

## 3 · Building the chunks

Reuses `markCapMesh.ts`, which already triangulates a mark's face densely and exactly, honours holes,
and keeps the boundary on the real curve. No clipping code, no boolean ops, no Voronoi library.

### 3.1 · Cluster the cap triangles

1. Triangle adjacency over shared edges.
2. **Variable-radius Poisson seeding** on triangle centroids: walk them in a seeded shuffle and accept a
   centroid as a seed when it is farther than `spacing(p)` from every accepted seed, where

   ```
   spacing(p) = mix( rimSpacing, coreSpacing, smoothstep(0, falloff, distanceToOutline(p)) )
   ```

   This is the size hierarchy, and it is doing two jobs at once: **fine chunks on the rim** (so the
   outline is precise and the eye reads detail where it looks) and **big masses in the core** (so the
   body reads as few large stones, not as noise). `distanceToOutline` is brute-force point-to-segment
   over the boundary loops — ~900 segments × ~1500 centroids, single-digit milliseconds.
3. Multi-source region growing from the seeds (Dijkstra on the dual graph, cost = centroid distance)
   gives connected, compact clusters. Two Lloyd relaxation passes even out the sizes; more starts
   rounding them, which loses the angularity.

### 3.2 · Turn each cluster into a closed solid

Every vertex ends up at `z = ±halfDepth` — there are only two layers — which keeps the whole thing
simple and is what makes §3.3 watertight.

- **Front cap**: the cluster's triangles at `+halfDepth`, wound counter-clockwise (`buildCapMesh`
  guarantees this already).
- **Back cap**: the same triangles at `−halfDepth`, reversed.
- **Wall**: for every *boundary edge* of the cluster — an edge belonging to exactly one of its triangles
  — one quad from front to back, wound outward.

Vertices are **not** shared between chunks (each moves independently) nor between a chunk's cap and its
wall (so every edge is hard and the chunk reads faceted).

Two coincident interior faces where chunks abut are always occluded: any ray reaching that plane from
outside must first pass through one of the two chunks' outer surfaces. So there is nothing to z-fight.
A `chunkInflate` of ~0.002 world units makes adjacent chunks interpenetrate slightly, so floating-point
error can never open a hairline crack.

### 3.3 · Make it read as rock without breaking watertightness

A flat extrusion is not stone. Displace it — but a naive displacement along each vertex's normal
separates coincident vertices, because two abutting chunks have opposing wall normals.

**So displace along directions that depend only on position, never on the normal:**

```
   Δz   = layeredLobeNoise( x, y, z ) · capAmplitude · sign(z)
   Δxy  = noise2D( x, y ) · inPlaneAmplitude · (1 − silhouetteProtection · rimProximity)
```

Every vertex at the same `(x, y, ±halfDepth)` gets an identical displacement whichever chunk owns it,
so the aggregate stays watertight everywhere while the surface becomes genuinely rocky. `Δxy` is damped
near the outline for exactly the reason `markGeodeBody` damps it: in-plane displacement is what eats a
counter or rounds off a "V", and a mark that stops reading has failed at its only job.

`layeredLobeNoise` comes from `markRockField.ts` — the same lobes every rock in this project is carved
with, so these are visibly siblings of the field's debris rather than a new species.

### 3.4 · Texture continuity is what fuses them

Cap UVs from `(x, y)`, wall UVs from `(arcLength, z)` — i.e. **derived from world position, not per
chunk.** At rest the texture therefore runs continuously across every chunk boundary, and 200 chunks
read as *one rock that happens to be cracked* rather than as 200 objects at the same place. This is free
and it is one of the highest-value details in the whole plan.

---

## 4 · The animation

This is where the first attempt had nothing. Everything below is a **pure function of one progress
value**, evaluated in the vertex shader — no CPU work per frame, no timers, fully scrubbable.

### 4.1 · Baked per chunk

| Attribute | What it is |
|---|---|
| `aRest` | the chunk's centroid at rest |
| `aSeed` | **where it grows from**: the intersection of the ray (base centre → `aRest`) with the base rock's carved skin. Closed form, because the base rock is a radial height field — `rockSkinPoint` already does it. |
| `aStart` | `|aRest − aSeed| / maxDistance` — normalised distance from the core |
| `aSpin` | a seeded random axis (xyz) and total turn (w) |
| `aJitter` | per-chunk random, for phase offsets |
| `aRim` | how close this chunk is to the outline, for the size/detail read |

### 4.2 · The growth front is physical, not a rank

`aStart` is **distance**, not a sort order. A rank-based stagger makes dense regions crawl and sparse
ones race; distance gives a front propagating outward at constant speed, which is what growth actually
looks like. `orderJitter` breaks the perfect shell, because nothing in nature grows as a perfect shell.

```
   incoming chunks:  start = growDelay + aStart · growStagger          front moves OUTWARD
   outgoing chunks:  start = (1 − aStart) · shrinkStagger              front collapses INWARD
```

Both windows are constructed so the last chunk finishes exactly at the window's end, for any stagger:
`start_max + span = stagger·W + (1−stagger)·W = W`.

### 4.3 · The four curves, and why they are offset

A chunk's local time `g ∈ [0,1]`. Three transforms run on it, and **they deliberately do not finish
together** — that offset is the entire difference between "designed" and "tweened":

```
   g   0                                                    1
       ├────────────────────────────────────────────────────┤
 scale ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄░░░░░░░░░░░░░░░░░░  done at ~0.55  (cubic out)
   rot ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄░░░░░░░░░░░░  done at ~0.70  (cubic out)
   pos ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  done at 1.00   (back out)
                                                    ▲
                                        overshoots, then snaps back
```

So a chunk **comes out of the core already solid and already aligned, and the last thing it does is slot
into place with a small overshoot.** Read in order: material emerges → tumbles → aligns → slams home.
The first attempt did all three simultaneously and linearly, which is why it read as a fade.

```
   scaleCurve(g) = easeOutCubic( min(1, g / scaleLead) )
   rotCurve(g)   = easeOutCubic( min(1, g / rotateLead) )
   posCurve(g)   = backOut( g, overshoot )      // 1 + (s+1)(g−1)³ + s(g−1)²
```

Rotation is about the chunk's **own centroid** — axis `aSpin.xyz`, angle `aSpin.w · (1 − rotCurve(g))` —
via Rodrigues in the vertex shader, applied to position and normal alike.

### 4.4 · The streams curve, and they counter-rotate

Travel is not a straight line. Rotate the chunk's offset-from-core about the core's axis by

```
   spiralAngle = ±spiralTurns · TAU · (1 − posCurve(g))
```

`+` for growing, `−` for retracting. The outgoing stream therefore spirals in one direction while the
incoming sprays out the other way — two counter-rotating flows crossing at the midpoint. **This is the
mess**, and it is the same trick the section already relies on: `worksTransition.ts` counter-spins the
debris field against the rock because *"the two rates ADD into the apparent speed."* Proven here,
reused.

### 4.5 · Landing

- **Judder**: `ring(g) = sin(TAU · tremorCycles · g) · (1 − g)²`, a small offset along the travel
  direction. Zero at `g = 1` by construction, so a landed chunk is perfectly still.
- **Lock flash**: `flash(g) = smoothstep(0.72, 0.94, g)² · (1 − smoothstep(0.94, 1, g))` — a spike as it
  seats, added to `totalEmissiveRadiance`. The field already runs a bloom pass, so each chunk locking in
  throws a brief spark. Hundreds of them, staggered by the front, and the mark **crackles** as it forms.
- **The core**: swells `sin(π · progress)` between `baseRestScale` and `basePeakScale`, and glows in
  proportion to how much material is in flight. It cannot simply stay large: a "V" has no interior to
  hide a sphere in — its centroid is not even inside the material — so a permanently full-size core
  would break the silhouette it is feeding. The two scales are separate knobs, so "always visible" is
  one slider away.

### 4.6 · The whole beat

```
  p=0            p≈0.25          p≈0.5           p≈0.75          p=1
  the mark       outer chunks    two streams     new chunks      the next mark
  at rest        unlock,         crossing        slam in,        at rest
                 spiral in       around a        crackling
                                 swollen core

  ████████        ▙▖ ▗▟          ·  ▟█▙  ·        ▗▄▟█▙▄▖        ████████
  ██    ██  ──▶  ▘▝ ●● ▘▝  ──▶  ▝ ·███· ▘  ──▶   ▘ ████ ▝  ──▶  ██    ██
  ████████        ▛▘ ▝▜          ·  ▜█▛  ·        ▝▀▜█▛▀▘        ████████
```

---

## 5 · Performance

| | |
|---|---|
| Chunks | ~200 per mark; each ~32 triangles → ~6.4k triangles per mark |
| Geometry | one merged buffer **per mark**, so only the two active marks are drawn (`visible` flag). Halves vertex work versus one buffer for all four. |
| Draw calls | 3 — outgoing chunks, incoming chunks, the core |
| CPU per frame | **zero.** Three uniforms: `uProgress`, and the two mark roles. |
| Attributes | ~22 floats/vertex × ~12k verts/mark ≈ 1 MB per mark |
| Build | cap mesh + clustering + prism assembly, ~50–150 ms per mark, at load |

---

## 6 · The tuning surface

**Rebuilds** — `rimSpacing`, `coreSpacing`, `spacingFalloff`, `capEdgeFraction`, `capSubdivisions`,
`chunkInflate`, `capAmplitude`, `capFrequency`, `inPlaneAmplitude`, `silhouetteProtection`, `depth`.

**Live** — `shrinkWindow`, `growDelay`, `shrinkStagger`, `growStagger`, `orderJitter`, `overshoot`,
`scaleLead`, `rotateLead`, `spinTurns`, `spiralTurns`, `tremorCycles`, `tremorAmplitude`,
`flashStrength`, `baseRestScale`, `basePeakScale`.

---

## 7 · Build order

1. `accretionChunks.ts` — clustering and prism assembly, with the position-only displacement. **This is
   the piece that decides whether it reads as stone at rest**, and it can be judged with no animation
   at all by parking progress at 1.
2. `accretionGrowth.ts` — the shader injection: every curve in §4, on the GPU.
3. `accretionTransition.ts` — the strategy: per-mark buffers, the core, uniforms, tuning.

Step 1 is worth looking at on its own before step 2 exists, because if the resting mark does not look
like carved rock then no animation will save it — and that is exactly the mistake that produced the
first attempt.

## 8 · What could still be wrong

Named now so they are checked rather than discovered:

- **200 chunks may be too few to read as an aggregate, or too many to read as stones.** The rim/core
  spacing split is the lever; the failure mode is soft either way.
- **`inPlaneAmplitude` fights the silhouette.** It is the knob most likely to be set too high, because
  a rocky outline is tempting right up until a counter closes. `silhouetteProtection` exists for this.
- **The flash could turn the mark into a light show.** Bloom is generous. Default it low.
- **Deliberately not included:** crystal overgrowth on the rim, and dust puffs at lock-in. Both would
  suit this and neither is in the plan as stated — they are additions to propose after the plan itself
  is working, not before.
