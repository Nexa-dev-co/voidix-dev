# Sun → black hole finale — realism plan

---

> ## STATUS (2026-07-27)
>
> The target moved after this document was written: the reference is a **fluid/plasma spiral with
> gravitational lensing**, not a model swap. See §8 for what that changes.
>
> **Step 1 of 2 is BUILT** (tsc clean): the screen-space lensing pass — `lensingShader.ts`, wired into the
> composer between RenderPass and Bloom, with six controls on the black hole tab.
>
> **Step 2 — the GPU particle spiral — is BUILT** (tsc clean): `accretionShader.ts`, 120k particles seeded
> from the sun's own mesh triangles, wound by Keplerian shear. Controls in Global → "Accretion spiral";
> on by default in the Singularity preset.
>
> Also landed: the sun's implosion is now an **accelerating** curve (cubed) instead of a smoothstep, and
> the **Play/scrub desync bug** in §1 is fixed — Play now reports each step back to React.
>
> Still unbuilt from §3: **TREMOR**, the **FLASH** and its masked handoff, **redshift**, and **spin-up**.
> The flash is the one that matters most — it is what removes the last of the cross-fade.
>
> **→ Full outstanding list, including housekeeping and open questions: `docs/sun-lab-remaining-work.md`**

---


**Goal:** make the Singularity stage read as a star *collapsing into* a black hole, rather than one model
cross-fading into another. Judged on whether a viewer believes the second object was *caused* by the first.

---

## 1. What the finale does today

`applyFinale(sequence)` in `useSunLabScene.ts`, driven by one 0→1 cursor:

```
sequence   0 ──────── 0.2 ─── 0.25 ──────────── 0.55 ─────── 0.92 ── 1
sun scale  ███████████╲___________________________                      smoothstep 0.20→0.55
black hole                  ___________________/███████████████████     smoothstep 0.25→0.55
rings (early)                ______________/████████████████████████    smoothstep 0.22→0.52
rings (late)                                    ______________/█████    smoothstep 0.52→0.92
bloom      2.5 ──────────────╲_____________ 0.44
coreLight  18 ─────╲______ 0
```

It is honest, scrubbable, and structurally sound — the pure-function-of-`sequence` design is exactly right
and everything below preserves it. But as an *animation* it has seven specific problems.

### 1.1 It is a cross-fade, not an event

The sun shrinks over `[0.20, 0.55]` and the black hole grows over `[0.25, 0.55]`. For **30 units of the
timeline both objects are on screen at partial scale**, occupying the same space. That reads as a dissolve
between two assets, because it is one. Nothing hides the handoff.

### 1.2 `smoothstep` is the wrong curve for gravity

`smoothstep` eases **in and out** — it *decelerates* as it finishes. Gravitational collapse does the
opposite: infall accelerates without bound as r→0. The sun currently slows down as it disappears, which is
the single strongest "this is a slider, not physics" tell.

```
  smoothstep (today)              free-fall (wanted)
  1 ─╮                            1 ────────╮
     ╰──╮        decelerates                 ╰─╮      accelerates
        ╰───╮    into nothing                   ╰╮    into nothing
  0        ╰───                   0              ╰──
```

### 1.3 The black hole inflates from a point

`blackHoleGroup.scale` scales **everything** — horizon *and* accretion disc. So the disc balloons outward
from zero. Real discs are already extended; what actually appears is the **shadow**. The disc should arrive
by spinning up and brightening, not by inflating.

### 1.4 There is no moment

Brightness only ever decreases (bloom `2.5 → 0.44`, coreLight `18 → 0`, both monotonic). Every beat is a
fade. Real core-collapse has exactly one punctuation mark — the bounce/flash — and without it there is no
frame where the viewer can say *that* is when it happened.

### 1.5 No angular-momentum spin-up

`blackHoleSpinSpeed` is a flat rate. A collapsing star spins up violently as it contracts (figure-skater
effect) — one of the most recognisable and genuinely physical cues available, currently unused.

### 1.6 No gravitational redshift

Light climbing out of a deepening gravity well reddens. The magma stays white for the entire collapse.
White-hot → amber → deep red → gone is both real and dramatic, and it is cheap.

### 1.7 The shards do not participate

`fractureSpread` already moves the ten shards radially, and negative values **collapse** them — the
Collapse preset sits at `−0.5`. The finale never touches it. The most natural collapse motion in the whole
project is sitting there unused while the sun is uniformly scaled instead.

### Bug found while reading

`playSequence` ramps the scene but **never updates React's `sequence` state**, so the scrub slider does not
follow Play — and afterwards `sequenceRef.current` is still `0`, so the next global edit calls
`applyFinale(0)` and **snaps the finale back to the start**. Fixed as part of this work.

---

## 2. What actually happens when a star collapses

| # | beat | visual signature |
|---|---|---|
| 1 | core fuel exhausted, pressure fails | instability, tremor |
| 2 | **core collapse** — infall at ~0.25c | accelerating implosion |
| 3 | **bounce** — degeneracy briefly halts it | shockwave |
| 4 | **supernova** — envelope blown off | blinding flash |
| 5 | fallback past the neutron limit | — |
| 6 | **horizon forms** — infalling light redshifts exponentially | the "frozen star": the surface appears to *slow, redden and freeze* rather than vanish |
| 7 | leftover angular momentum forms a disc | disc spins up, friction-heated |

Beats **2, 4, 6, 7** are the ones a viewer recognises. Beat 6 — light freezing and reddening instead of
cleanly disappearing — is the detail that sells it as physics rather than a dissolve.

---

## 3. Proposed timeline

Five phases, with the handoff **hidden inside the flash** so the two models are never both visible at
partial scale.

```
 0.00      0.16              0.42  0.47  0.58        0.78          1.00
   │ TREMOR  │   IMPLOSION     │ FLASH │   HORIZON    │   SETTLE     │
   │         │                 │   ▲   │              │              │
   │ anticip.│  accelerating   │  peak │  darkness    │  disc spins  │
   │         │  free-fall      │       │  resolves    │  up, settles │

 sun scale   ────╲__                                                     easeInQuart, hits 0 at 0.47
 shards      ────╲______  rush inward                                    same curve
 redshift    ────╱▔▔▔▔▔▔  white → amber → deep red                       tracks compression
 flash            ______╱▔╲___                                           fast attack, slow decay
 horizon               ______╱▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔                    easeOut from 0.46
 rings early                 ____╱▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
 rings late                        ______________╱▔▔▔▔
 spin        ────╱▔▔▔▔▔╲__________  violent peak → idle                  turns as f(sequence)
```

### Phase 1 — TREMOR `0.00 → 0.16`

The star destabilises *before* it falls. Shards tighten slightly, spin begins to rise, a faint brightness
swell. Pure anticipation — the beat the current version lacks entirely, and the reason it feels like it
starts mid-thought.

### Phase 2 — IMPLOSION `0.16 → 0.47`

- Sun scale on **ease-in quartic** (`1 − t⁴`): barely moves for the first half, then plummets
- `fractureSpread` driven hard negative on the same curve — **the shards actually rush inward**, using the
  model's real geometry instead of a uniform scale
- **Gravitational redshift**: magma emissive tints white → amber → deep red as it compresses
- Spin accelerates sharply
- `coreLight` *intensifies* as it compresses (smaller and hotter) before dying — currently it only fades

### Phase 3 — FLASH `0.42 → 0.58`, peak `0.47`

The moment. An asymmetric pulse on exposure + bloom: fast attack, slower decay.

**The sun's scale reaches zero exactly at the flash peak**, so its final vanishing is *masked* — you never
watch it scale to nothing. This is what removes the cross-fade.

### Phase 4 — HORIZON `0.46 → 0.78`

Exposure and bloom crash from the spike down to the settled black-hole grade, and the darkness resolves
out of the glare with the horizon already present. The **horizon scales on its own curve, separately from
the disc** — so the shadow appears without the disc inflating.

### Phase 5 — SETTLE `0.78 → 1.00`

Rings form late, spin decays from its violent peak toward the idle rate, bloom settles.

---

## 4. Mechanics

### 4.1 Split the horizon from the disc

Today `blackHoleGroup.scale` scales the whole model. Instead:

- keep the group at full scale
- add `horizonForms` (dark meshes) alongside the existing `ringForms`, each `baseScale × form`
- the two get **different curves**

`ringForms` already works exactly this way and `applyObjectTransform` already composes `scale × currentForm`
for those entries — so this is the established pattern, extended, not a new mechanism.

### 4.2 Keep `applyFinale` a pure function of `sequence`

Non-negotiable — it is what makes scrubbing and Play deterministic. Consequence for spin: the finale's
contribution must be an **angle computed from `sequence`**, not an accumulated `+= rate * delta`, or
scrubbing backwards would not rewind it.

```
blackHoleSpinner.rotation.y = idleAngle          // accumulates in the render loop, as now
                            + finaleSpinAngle(sequence)   // pure function, scrubs cleanly
```

The two compose, so the idle spin still runs before and after the finale.

### 4.3 Redshift without destroying the authored material

The finale tints the magma emissive, so it must remember what to tint *from*: capture the authored emissive
when `applyGlobal` / `applySharedMaterial` writes it, then lerp from that captured base. At `sequence 0` it
restores exactly, and a mid-finale material edit re-captures. Gated behind a toggle so it can be switched off.

### 4.4 Shard ownership

The render loop's breathing branch (`fracturePulse !== 0`) writes shard positions every frame and would
fight the finale. The finale takes priority while it is driving. (The Singularity preset has
`fracturePulse: 0`, so this is a guard, not a live conflict — but it should not depend on that.)

---

## 5. New parameters

Intensities are exposed; phase boundaries stay well-named constants (a dozen timing sliders would be
unusable, and they are one edit away). One timing knob is exposed because it genuinely changes the feel.

| param | default | what it does |
|---|---|---|
| `finaleFlash` | 0.8 | flash intensity. 0 = no supernova punctuation |
| `finaleRedshift` | 0.85 | how far the magma reddens as it collapses. 0 = off |
| `finaleShardCollapse` | 1.2 | how hard the shards rush inward (cell-radius units) |
| `finaleSpinTurns` | 2.4 | extra turns the collapse spins the hole through |
| `finaleFlashAt` | 0.47 | where the flash lands — shifts the whole handoff |
| `finaleDuration` | 6 | Play length in seconds (currently hardcoded in `SunLab.tsx`) |

All optional in `MaterialParams` style, so existing presets and saved states stay valid.

---

## 6. Deliberately not doing

**Gravitational lensing.** The Interstellar look is dominated by light bending around the photon sphere, and
the model even ships an unused `black_hole_distortion` material at opacity 0 that the artist likely intended
for it. Doing it properly needs a screen-space distortion pass or a raymarched shader. It is the **single
biggest realism lever beyond the animation** — but it is its own project, and it should not ride along on
this one. Flagged for later.

**Infalling particles.** There is a parked 2600-point system, and the yellow-spark treatment was rejected
once already. A different treatment (thin, fast, disc-plane accretion streaks that only fall *inward*) is a
genuinely different idea, but re-introducing a rejected element uninvited is a bad trade against a result
that is otherwise landing well. Available on request.

**Camera moves.** The lab uses OrbitControls and the user drives the camera. Not the finale's business.

---

## 7. Order of work

```
1. Fix the Play/scrub desync bug          (independent, small)
2. Split horizon forms from ring forms    (structural — everything else builds on it)
3. Re-curve implosion + shard collapse    (the biggest single readability win)
4. Flash + the masked handoff             (removes the cross-fade)
5. Redshift + spin-up                     (the physics cues)
6. Expose the params, set defaults
```

Steps 3 and 4 together are what stop it reading as a dissolve; if time is short, they are the two that
matter. Verification is `npx tsc --noEmit` plus a scrub through `/sun-lab` → Singularity.

---

## 8. The fluid-spiral reference (added 2026-07-27)

The target is now a storyboard of a star dissolving into a **swirling plasma spiral** with heavy
refraction and chromatic aberration — "space behaves like fluid water".

### Why the existing models cannot produce it

| reference element | can the models do it? |
|---|---|
| panel 1 — bright star | roughly, yes |
| **panels 2–3 — the star becomes a spiral plasma flow** | **no** |
| panels 4–6 — black disc | yes, already correct |
| refraction / chromatic aberration | not from geometry — needs a post pass |

`fractured_sun.glb` is **10,023 vertices of rigid geometry** (10 shards + flares + planes). Rigid meshes
cannot flow; spiralling them reads as ten rocks orbiting. `black_hole.glb`'s rings are textured geometry —
they spin, they do not wind. The reference's filaments are **fbm noise in a shader**; no geometry produces
that. The spiral is ~80% of every frame from panel 2 on, and neither asset can make it.

### Step 1 — screen-space lensing — BUILT

`components/lab/SunLab/lensingShader.ts`, inserted **between RenderPass and Bloom** (gravity bends light
on its way to the camera; bloom is a camera artefact — and this way the photon ring blooms).

Six params under `global.lensing`, all on the black hole tab: `strength` (0 = pass-through), `aberration`,
`liquid`, `ring`, `shadow`, `radiusScale`.

Mechanics: bend ∝ 1/r² in units of the shadow radius (clamped at 4× its edge value, faded out by 7 radii);
R/G/B sampled at different bends for the fringing; a travelling ripple modulates the bend for the liquid
read; a photon ring hugs the edge. Centre and radius are **re-projected every frame** from the horizon
meshes' own measured bounding sphere, so it tracks orbiting, zoom and the reveal.

**Its hard limit:** it distorts the *rendered frame*. Light that never reached the camera cannot be
recovered, so the far side of the disc will not arc over the top the way it does in a raymarched metric.
~80% of the look for ~5% of the cost. Do not let the result be described as real lensing.

### Step 2 — GPU particle spiral — NOT BUILT

The plan, when it happens:

- **Seed particles from the sun's own mesh.** 10,023 vertices is small enough to sample across its surface
  triangles and spawn ~150k points from it — so the star *becomes* the disc. That is the causal link the
  current cross-fade lacks, using the asset already loaded.
- **Keplerian angular velocity** (ω ∝ r^−1.5). This is the whole trick: differential rotation winds the
  arms into a spiral by itself. The shape is not authored, it emerges — and it emerges because that is
  what real accretion does.
- **Curl noise** for the turbulent filaments; particles stretched along velocity so they read as strands
  rather than dots; additive, coloured by temperature (white core → orange → deep red rim).
- Must stay a **pure function of `sequence`** to preserve scrubbing: with r(s) analytic, the orbit angle
  integral is analytic too, so this is achievable — but it rules out any per-frame accumulation.

Decided: the black hole model's rings **stay**, blending with the particles for the settled end state,
rather than being replaced.

### Known gaps at that point

- Real lensing (light from behind the hole) still absent — needs raymarching, its own project
- Filament density will be softer than an offline/AI render; 60fps is the binding constraint
- The reference is composed **face-on**; the lab orbits in 3/4. Matching it means committing the camera
