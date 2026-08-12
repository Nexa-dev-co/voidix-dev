# The sun's plasma — plan

> ## ⛔ SUPERSEDED, 2026-08-12. Built, shipped, and REVERTED.
>
> `sunPlasma.ts` existed for four days and is deleted. The performance argument below is sound and its
> measurements still hold — but the art decision it was attached to went the other way once it was on
> screen: the shells carry `sunouter_baseColor`, the largest map in the file and the star's actual
> skin, and one procedural surface over the top of that is a different star rather than a cheaper one.
>
> The 5 ms is bought back instead by `SUN_ABLATION_KEEP_SHELLS` (4 of 11) — see `sunParts.ts`. Eleven
> shells at α 0.815 saturate after three, so most of what this plan proposed to replace was already
> invisible and merely expensive.
>
> **Read this as history.** Nothing in it describes shipping code.

> **Status:** PROPOSED, 2026-08-08. Nothing built. Written after the flare/blowout cull shipped and
> the star came down from 17.5 ms to 7.4 ms per call on the reference laptop. This is the next 5 ms,
> and unlike everything before it, **it changes how the star looks** — so it is an art decision with a
> performance argument attached, not the other way round.

---

## 1 · What the star is, measured

`fractured_sun.glb`, by node instance, outward:

```
   sun_inner   11 opaque    the 1.93 core sphere, and the material the ten shard cells share
   magma       10 opaque    the shard interiors — the emissive glow inside the cracks
   sunouter    11 BLEND     α 0.82, 2.00 across, OUTSIDE everything     ← the whole remaining cost
   flare        8 BLEND ┐   omitted 2026-08-08 (SUN_OMITTED_PARTS)
   blowout     20 BLEND ┘   −57 % of the star's cost between them
```

`sun · bloom` per call, reference laptop (dpr 2.5, 1528×698):

```
   everything                 17.5 ms   ████████████████████
   −flare −blowout (today)     7.4 ms   ████████
   shards only (loader)        1.58 ms  ██
                              ───────
   so sunouter + core + mips ≈ 5.8 ms
```

**Eleven translucent shells over the same sphere are what is left.** At α 0.82 the third is already
at 99.4 % opacity — layers 4–11 pay full framebuffer bandwidth to change the image by under a
percent. And the cost is paid **twice**, because `sunBloom` renders the scene once for the glow and
once for the canvas.

⚠ On the desktop the same groups cost ~0.02 ms **per draw call** and area predicted nothing. Two
machines, two bottlenecks — fill on the laptop, submission on the desktop. **Fewer meshes wins on
both**, which is why this is the right shape of fix and a resolution knob is not.

---

## 2 · The structural question: where does the plasma live?

The shells are not decoration — they are the star's ATMOSPHERE. The core is an opaque ball; those
eleven layers over it are what make it read as burning. So the plasma does not delete them, it
supersedes them. The question is **where it sits relative to the shards**, and that changes the look.

### Option A · plasma as the atmosphere — replace the shells in place

```
         ▄▄▄▄▄▄▄            one translucent sphere at r = 1.00
      ▄█░░░░░░░░░█▄         where eleven used to be
    ▄█░░ ▓▓  ▓▓ ░░█▄        the shards still show THROUGH it
   █░░ ▓▓ core ▓▓ ░░█
    ▀█░░ ▓▓  ▓▓ ░░█▀        11 blended draws → 1
      ▀█░░░░░░░░░█▀         closest to today's image
         ▀▀▀▀▀▀▀
```

Nearest to what ships. Still blended, so still bandwidth — but one layer instead of twenty-two
(double-sided), and animated where today's is static.

### Option B · plasma as the body — inside the shards

```
         ▄▄▄▄▄▄▄            the plasma IS the burning core
      ▄█▓▓▓▓▓▓▓▓▓█▄         the shards are dark crust over it
    ▄█▓▓▓░░░░░▓▓▓█▄         you see plasma through the widening gaps
   █▓▓░ plasma  ░▓▓█
    ▀█▓▓▓░░░░░▓▓▓█▀         OPAQUE — no blending at all
      ▀█▓▓▓▓▓▓▓▓▓█▀         2 draws, and the cheapest of the three
         ▀▀▀▀▀▀▀
```

This is what the code already says the star *is*. `CORONA_APPEAR`'s comment: *"the star lights inside
the closing shell."* `coreLight`'s: *"amber escaping through widening gaps, then white-hot
compression."* Today those are described by a light and an emissive map; here they would be literal.

Cheapest, most dramatic, biggest departure — the shards would need to read as crust rather than as
lit debris.

### Option C · both — body plus one rim shell ★ recommended

Option B for the burning body, plus **one** translucent sphere at r = 1.00 carrying only a fresnel
rim — the halo the eleven shells were collectively producing. **2 blended-or-not draws total**, keeps
the soft limb that stops the star reading as a hard-edged ball, and keeps the "lights inside the
shell" narrative the loader is built around.

---

## 3 · The shader, concretely

One sphere, one fragment shader. **A single surface with 3–4 octaves of domain-warped fbm** — not
raymarched volumetrics. GPUs have far more ALU headroom than blend bandwidth, and that asymmetry is
the entire reason this trade wins; 32-step raymarching would spend the win and more.

```glsl
   uTime      → advects the noise field, so the surface actually churns
   uCracks    → turbulence + contrast          (0 hero → 1 services)
   uCollapse  → colour temperature + compression (0 → 1 across works)
```

Both ramps already exist in `SunModelCanvas` and are already eased per frame — they feed straight in,
so the whole thing stays a pure function of scroll progress and reverses for free.

**Colour comes from the heat ramp, mirrored into TS.** `lib/coolPalette.ts` is the precedent and its
header states the rule: Three.js colours cannot read a CSS custom property, so the two sides are kept
in step by hand. A `lib/heatPalette.ts` alongside it, sampling `--heat-000 … --heat-999`, is the
correct home — and it means retuning `--heat-600` still moves the star.

---

## 4 · ⚠ What must not break

Ordered by how quietly it would go wrong.

**1 · The plasma must join `coronaParts`.** That array is what `positionShards` scales from 0 at
`CORONA_APPEAR`, so the star lights *inside* the closing shell. A plasma outside it would be on screen
for the entire download and the loader's finale would have nothing to reveal.

**2 · `sunBloom` needs re-grading.** `BLOOM_THRESHOLD` 0.59, `BLOOM_STRENGTH` 1.26 and `BLOOM_RADIUS`
0.92 were graded against eleven textured shells. A procedural surface has a different luminance
distribution by construction. Their four `COLLAPSE_*` counterparts go with them. This is the same
class of work §6 of the quality-budget plan was demoted for — the difference is that here it is
unavoidable rather than optional, and the saving is 5 ms rather than 0.8.

**3 · The contact star.** CLAUDE.md: `SunModelCanvas`'s `COLLAPSE_*` block and `singularityScene`'s
four geometry values are the same pose — *"the star you leave at works and the star you come back to
at contact."* Changing what collapses risks the two no longer reading as one object. Check the loop.

**4 · `warmStarMaterials` must compile it**, or the first frame it appears pays a program link —
exactly the stall the deck is being diagnosed for right now.

**5 · `SUN_ABLATION_KEEP_SHELLS` becomes meaningless** and should go with the shells.

**6 · The download does not shrink until the GLB is rebuilt.** Hiding `sunouter` leaves its geometry
and its two maps (311 KB before the 512² cap, ~40 KB after) in the file. Stripping them properly
changes the mesh table `compareModels.mjs` asserts on — a separate, deliberate pass.

---

## 5 · Order of work

| # | step | needs | reversible |
|---|---|---|---|
| 1 | `lib/heatPalette.ts` — mirror the ramp, same shape as `coolPalette` | — | trivially |
| 2 | The plasma material + one sphere, added to the scene and to `coronaParts` | 1 | yes |
| 3 | Add `'sunouter'` to `SUN_OMITTED_PARTS` | 2 | one word |
| 4 | Re-grade `sunBloom` by eye, Peaceful → Cracks → Collapse | 3 | yes |
| 5 | Measure `sun · bloom` on the laptop; expect **7.4 → 2–3 ms** | 4 | — |
| 6 | Check the contact loop still reads as the same star | 4 | — |
| 7 | Rebuild the GLB without `sunouter` if the bytes are wanted | 6 | git |

**Steps 1–3 are reversible in one line each** — `SUN_OMITTED_PARTS` back to `['flare','blowout']` and
the plasma sphere stops being the star. Step 4 is the one that cannot be undone by a constant, because
it is authorship.

⚠ Do not start at step 3. Adding `'sunouter'` before the plasma exists leaves the star as a bare lit
sphere with shards around it, which is not a preview of anything and will read as a catastrophe.
