# The star is soft on phones — diagnosis and plan

> **Rewritten 2026-08-13 against a real device capture.** The first draft of this document reasoned
> from first principles about a handset nobody had measured, and **its central hypothesis was wrong**.
> §5 keeps it, refuted, because the reasoning is still worth not repeating.
>
> Everything below §3 is derived from one iPhone (iOS 18.7, Safari 26.5.2, **375 × 549 · dpr 2 ·
> 4 cores**, `deviceMemory` unreported → `device tier: low`), captured through `/api/telemetry`.

---

## 1 · The complaint

*"The sun looks low quality on my mobile device"* — plus, reported later and confirmed as a separate
defect: **the canvas edge is visible and the bloom is cut off** (§4.6).

It is not a model problem, not a texture problem and not a tier problem — `SunModelCanvas` never
consults `getDeviceTier()` at all.

---

## 2 · What the phone actually reported

```
[voidix] device tier: low      pointer coarse, width 375, dpr 2
                               deviceMemory unreported, cores 4

[voidix] gpu probe: 5.0 ms for 0.21 Mpx at ratio 1 → affordable 1.24, ceiling 1.24

[pixels] phase "A · field alone"   9 samples @ ratio 1.00: 112 31 14 14 13 19 33 36 33
[pixels] phase "B · field + star"  1 sample  @ ratio 1.00: 84
[pixels] burn-in REFUSED  not enough usable frames in 3376 ms (needs 5 per phase)
```

Everything below follows from those four lines.

---

## 3 · ⚠ THE ROOT CAUSE: the allocator never runs at all on this device

### 3.1 · Phase B cannot produce enough samples. Ever.

```
  BURN_IN_PHASE_MAX_MS   600 ms      the wall-clock deadline for one phase
  BURN_IN_DISCARD_FRAMES   3         thrown away before sampling starts
  BURN_IN_MIN_SAMPLES      5         below this the phase returns null
  ─────────────────────────────────────────────────────────────────────────
  ⇒ 8 frames inside 600 ms  ⇒  the device must sustain ≤ 75 ms/frame
```

Measured on this phone:

```
  phase A   field alone      ~34 ms/frame     12 frames in ~410 ms   →  9 samples  ✓
  phase B   field + star    ~150 ms/frame      4 frames in  600 ms   →  1 sample   ✗
```

**Phase B fails by construction, on every load.** And a refused phase B refuses the whole burn-in:
`reportSectionCosts` never runs, `reportBurnIn` never runs, `sunPixelRatio` stays `null`. The quality
allocator — the entire system described in CLAUDE.md's "models first, the star gets the rest" — is
**inert on the class of device it exists for**, and says so in a line that reads like a credibility
check doing its job.

⚠ The asymmetry is the trap: the budget was sized against phase A's cost, and phase B is *the same
phase plus the most expensive object on the page*. A deadline that one phase can meet and the other
structurally cannot is not a deadline, it is a guaranteed refusal.

### 3.2 · The probe's ceiling was never retargeted from 60 fps

`reportProbedFrameCost` solves `affordable = probeRatio × √(SPENDABLE ÷ measured)`, and
`SPENDABLE = PIPELINE_FRAME_BUDGET_MS × 0.85 = 9 × 0.85 = 7.65 ms`. The log confirms it to the digit:

```
  1 × √(7.65 ÷ 5.0)  =  1.237     → logged as "affordable 1.24, ceiling 1.24"
```

**9 ms is a 60 fps number.** Its own comment says so — *"Not 16.7. Three things share that frame"* — and
it was written when everything on this site solved against a 16.7 ms frame. `PRIORITY_TARGET_FPS` went
**50 → 30** on 2026-08-07, `CALIBRATION_TARGET_FRAME_MS` followed it, and **this did not.** The
retarget's own note claims it is *"the single largest quality change available to this file"*; on this
phone it never arrived, because the probe's ceiling clamps below where the calibration would land.

```
  today        9 ms → 7.65 spendable → ceiling 1.24     ← binds everything on this phone
  consistent  18 ms → 15.3 spendable → ceiling 1.75     ← +41 % linear, from one constant
```

Against a native dpr of 2, a ceiling of 1.24 is **62 % of the panel at absolute best**, before the
calibration takes its own safety margin off.

### 3.3 · The star costs about 1.5× the entire works field

```
  field alone       ~34 ms
  field + star   ~84–150 ms          ⇒  the star's marginal cost ≈ 50–115 ms
```

Even on the single most favourable sample (84 ms), the star is **~50 ms** — half again the cost of the
heaviest scene on the site, on a canvas of 291 × 291 CSS pixels. It is fill: eleven double-sided,
full-coverage, alpha-blended shells over the core and ten magma cells, **rendered twice per drawn
frame**, with a bloom chain on top.

⚠ One sample is not a measurement, and this figure must be re-taken once §4.1 lands. But the *order* is
not in doubt, and it reframes the whole problem: **the star is not a victim of the budget on this
device, it is what consumes the budget.**

---

## 4 · The fixes, in the order the evidence now puts them

### 4.1 · Let the burn-in finish on a slow device — ✅ **DONE**

**The single highest-value change in this document.** Nothing else in the allocator can matter while it
refuses to run.

⚠ **THERE WERE TWO BINDING CONSTRAINTS, NOT ONE**, and fixing only the deadline would have changed
nothing. Re-reading the capture during implementation:

```
  phase B ran the full 600 ms and returned ONE sample, of 84 ms
  ⇒ the other frames were not missing, they were REJECTED
  ⇒ BURN_IN_SANE_FRAME_MS is 120, and phase B's real frames are ~150
```

So the sane-frame filter — whose job is *"above this, a frame carried a long task and is not evidence
about rendering"* — **was rejecting the frame the visitor actually gets**, on the one device where that
frame is the entire subject. A longer deadline would have produced more frames and thrown all of them
away. Both constants had to move:

```ts
const BURN_IN_PHASE_MAX_LOW_POWER_MS = 1800;    // ≥ 8 frames at ~150 ms, with margin
const BURN_IN_SANE_FRAME_LOW_POWER_MS = 260;    // "slow frame" ≠ "stall" on a slow device
```

⚠ **The lenient ceiling is used for SAMPLING ONLY.** `waitForQuietMainThread` keeps the strict 120,
because it asks a different question ("has the main thread gone quiet") while only the FIELD is drawing
— ~34 ms on this same phone. Raising its threshold would make it declare calm on frames that are not.

Both values are read **once** at the top of `runBurnIn`, so the two phases can never be sampled under
different rules — a phase A judged by one ceiling and a phase B by another would make `B − A` a
difference of two instruments.

⚠ **The serial budget has to be re-checked, and it fits.** `BURN_IN_WAIT_MAX_MS` is 5500:

```
  settle (low power)  1200
  phase A             1800
  phase B             1800
  ────────────────────────
                      4800  <  5500      ✓
  SUN_PERMIT_FALLBACK_MS 4800  ≥  settle + ONE phase (3000)   ✓
```

⚠ It costs a slow phone up to **2.4 s of extra loader**. That is the right trade and it is the same one
`BURN_IN_SETTLE_MAX_MS` already makes: the loader is holding anyway, and the alternative is a session
that runs at an unmeasured resolution from beginning to end.

⚠ **Consider `BURN_IN_MIN_SAMPLES` too, but do not lower it blindly.** Five is already thin for a
median. Prefer buying time over lowering the bar.

### 4.2 · Retarget the probe budget to the frame the site actually aims at — ✅ **DONE**

`PIPELINE_FRAME_BUDGET_MS` (a hard 9) is replaced by a SHARE of whatever frame the site targets, so a
future retarget cannot leave it behind again — which is the actual defect, not the number:

```ts
const PIPELINE_FRAME_SHARE = 0.55;
const spendableFrameBudgetMs = () =>
  CALIBRATION_TARGET_FRAME_MS * PIPELINE_FRAME_SHARE * (1 - SAFETY_HEADROOM_FRACTION);
```

⚠ **A function, not a constant**, and not by preference: `CALIBRATION_TARGET_FRAME_MS` is declared ~90
lines further down the module, so a module-scope `const` reading it would hit the temporal dead zone
and throw on import. Its only caller is `reportProbedFrameCost`, which cannot run before the module has
finished evaluating.

    old   9 × 0.85     =  7.65 spendable  →  ceiling 1.24 on the iPhone
    new  33.3 × 0.55 × 0.85 = 15.6        →  ceiling 1.77

⚠ **Side effects, and they are not small:**

- It raises the ceiling on **every** device, not just phones. That is defensible precisely because it
  is a *ceiling*: the burn-in and the calibration are what pick the destination, and both measure real
  frames. What this removes is a cap derived from a frame rate the site no longer targets.
- ⚠ **On this phone it stops being the binding constraint, which means something else starts binding**
  — most likely the honest measurement, which is the intended behaviour and may well land *below* 1.24
  anyway once §4.1 lets it run. **Do not expect this to be a free 41 %.** It removes a wrong cap; it
  does not create headroom.
- ⚠ `MAX_DRAWING_BUFFER_MEGAPIXELS` (3 Mpx) still applies and is untouched. That is the constant
  standing between a dense panel and the 700 MB / 20 fps case, and it must keep doing so.
- The `0.55` share is a judgement, not a measurement. Name it as one.

### 4.3 · Halve the glow source's resolution — ✅ **DONE**

`sceneTarget` rendered the whole star at full device resolution, and the bright pass — its only
consumer — downsampled it by half one pass later. Now rendered at `GLOW_SOURCE_SCALE` (0.5), with
`mipTargets[0]` keeping its exact previous size, so `MIP_WEIGHTS`, `BLOOM_RADIUS` and `BLOOM_STRENGTH`
all keep their meanings and nothing is re-graded.

**Per-frame scene fill: 2.0 → 1.25 full-resolution renders, −37.5 %.** Given §3.3 this is worth more
than it looked when it was written as a nice-to-have.

⚠ Outstanding: the halo has not been compared before/after by eye. Predicted artefact is a faint
shimmer on the hot veins as the star turns (mip 0 loses a free 4:1 box average); the documented
response is to raise the constant to 0.707 rather than revert.

### 4.4 · Measure the star directly, drained, in its own context

⚠ **The justification for this has changed and it is weaker than the first draft claimed** — the
vsync-quantisation argument it was built on is refuted (§5). It survives on two different grounds:

1. **It deletes phase B**, which is the thing that cannot complete (§3.1). Settle + phase A + three
   drained star frames replaces settle + phase A + phase B, and phase A already succeeds on this
   device. That makes it an alternative to §4.1 rather than an addition to it.
2. `measureGpuFrameCost` has sub-millisecond resolution against a difference of two medians, and §3.3
   shows the star's cost is the number the whole allocation turns on.

⚠ **It is now the SECOND choice, not the first.** §4.1 is three constants and no new failure modes;
this is a cross-context measurement with GPU drains inside the loader. Do §4.1, re-measure, and only
build this if the split still comes out unusable. The mechanics — `SUN_MEASURE_BEGIN/END_EVENT`, the
refusal branches, the module as rendezvous, the ordering against `reportBurnIn` — are unchanged from
the first draft and are recorded in git history if it is wanted.

### 4.5 · `STAR_MAX_PIXEL_RATIO` — ⚠ INERT on this device, deprioritised

The first draft led with this. **The phone is dpr 2, not dpr 3**, so `sunCeiling()` already resolves to
`min(hardwareCeil 2, MAX_PIXEL_RATIO 2, native 2) = 2` and the cap is not what binds. It remains
correct for dpr 3 handsets and costs almost nothing, but it fixes nothing here.

### 4.6 · ⚠ The canvas clips the bloom, and the edge is visible — NEW, user-reported

Separate defect from everything above: the glow reaches the canvas boundary and is cut flat, drawing a
rectangle around the star. `SUN_CANVAS_HEADROOM` (2.6) exists precisely to prevent this and is no
longer sufficient — most visibly on a phone, where the square hits its `7rem` floor and the layer is
only 291 CSS px while the star scales to `SUN_SCROLL_SCALE` 1.1 across the fill.

⚠ **First, identify which edge is being seen.** Two different things can draw a box here and they have
different fixes:

- the **canvas's clipped glow** — a soft gradient ending in a hard straight cut;
- `.hero-sun-card`'s own `box-shadow: 0 0 0 1px rgb(var(--accent-rgb) / 0.08)` — a crisp 1 px amber
  outline that is *supposed* to be there.

A screenshot settles it in one look. The rest of this section assumes the former.

**Stage 1 — stop the hard cut — ✅ DONE.** The composite now multiplies the summed glow by a smooth
radial falloff reaching zero at the canvas edge (`EDGE_FADE_START` 0.75 → `EDGE_FADE_END` 1.0, in a
metric where 0 is the centre, 1.0 the nearest edge, 1.414 a corner). One length, one smoothstep, one
multiply per pixel. It does not give the glow more room; it makes running out of room invisible, which
is the actual complaint.

⚠ **It cannot dim a corona that is in no trouble**, and the arithmetic is worth recording: the star's
BODY reaches only `edgeDistance` **0.278** (`SUN_BODY_FILL` 0.723 ÷ `SUN_CANVAS_HEADROOM` 2.6, halved),
so the glow is untouched out to ~2.7 body radii and rolls off only across the last quarter —
`1.000 · 1.000 · 1.000` at 0.28 / 0.50 / 0.75, then `0.648 · 0.104 · 0.000` at 0.85 / 0.95 / 1.00.

⚠ Because the composite derives its alpha from the glow (`max` of the channels), the fade carries into
alpha automatically — so the canvas stays properly transparent at the edge and premultiplication stays
valid. That is the mechanism the file's header depends on, and it is preserved rather than worked
around.

⚠ **Three backticks in a comment inside the shader template broke the build during this change** —
exactly the trap CLAUDE.md and this file's own header both record. Now noted a third time, in the
shader body itself.

**Stage 2 — decouple the canvas size from the star's size (the real fix, and it is not small).**

```
  today                                    proposed
  ─────                                    ────────
  .hero-sun-layer = square × 2.6           .hero-sun-layer = the viewport
  camera pulled back by the same 2.6       star placed and sized by the CAMERA
  the pin scales the ELEMENT               the pin drives a camera/scale uniform
```

⚠ **What this touches, and why it is a project rather than a constant:**

- `SUN_CANVAS_HEADROOM` is imported by `gatherShader` (`CAMERA_DISTANCE`, `SUN_BODY_FILL`,
  `SUN_IN_O_RATIO`) and by `SunModelCanvas` (`CAMERA_FIT_MARGIN`). It is the shared scale between the
  loader's dust field and the star. All of it has to move together.
- **The intro's o→square flight measures the element.** With a full-viewport canvas there is no element
  to fly; the flight becomes a camera move. `IntroSequence`'s `parkSunInO` is the affected code.
- **The three-owner rule** (`layer` / `parallax` / `flight`, one owner each) is built on the pin
  transforming the layer. A full-screen canvas means the pin's scale becomes a 3D quantity.
- ⚠ **It costs 2.4× the fill on this phone** — 0.206 Mpx of viewport against 0.085 Mpx of layer — on the
  device where §3.3 already measures the star at ~50 ms. **Stage 2 must not land before the cost work
  in §4.1–4.3 has been measured**, or it will make the original complaint worse while fixing the new
  one.

### 4.7 · Two dials that remain judgement calls

- **`MAX_COMPOSITE_UPSCALE` 2.17** sets the field's floor at `2 / 2.17 = 0.92` here — not binding on
  this device, unlike the dpr 3 case the first draft worked through.
- **`.hero-sun-card`'s `7rem` floor** gives a star body of ~81 CSS px on a phone against 127 on
  desktop. The only lever that changes the star's *apparent size* rather than its density. Everything
  measures the element live, so the plumbing risk is low; it is a headline-composition decision.

---

## 5 · ⚠ REFUTED: rAF quantisation (the first draft's central claim)

The first draft argued that `runBurnIn` measures rAF-to-rAF wall clock, that rAF fires on refresh
boundaries, and that the star's cost is therefore below the instrument's resolution — so `B − A` could
only come out 0 or one whole refresh period, and both roads put the star on the floor.

**The device says no.** Phase A returned `112 · 31 · 14 · 14 · 13 · 19 · 33 · 36 · 33` — not clustered
on any multiple of 16.7 or 8.3. Whatever iOS Safari does with rAF scheduling under load, it is not
delivering a quantised clock, and a difference of medians is not destroyed by it.

**Kept because the reasoning is sound and only the premise was false.** If this instrument is ever
moved to a platform whose rAF *is* strictly vsync-aligned, the argument comes back — and the one-line
diagnostic that settles it now lives in `samplePhase`. That log line is the most useful thing the first
draft produced.

## 6 · ⚠ REJECTED: crediting `SUN_IDLE_STRIDE` in the star's budget

Charging the star at half rate because it draws every other frame through services and works is worth
`√2` on its ratio and **must not be built**. Amortising is valid for mean frame time and invalid for
pacing: the frames it actually draws on then overshoot the budget, the display quantises the overshoot
to the next boundary, and a steady 30 fps becomes an alternating 50/33 with a visible 2:1 ripple. The
existing full-rate charge is correct, not conservative — the star's *worst* frame is what has to fit,
and its worst frame contains the star.

## 7 · ⚠ REJECTED: reusing the canvas as the glow source

Deleting step 1 and copying the canvas back into `sceneTarget` would save 50 % rather than 37.5 %, and
cannot work as a drop-in: three applies tone mapping **only when the render target is null** (verified
in `WebGLPrograms.js` and `WebGLRenderer.js`), so the canvas is ACES-mapped while `sceneTarget` is
linear. The bright pass would threshold display-space values against a number graded for linear ones.
It also needs an MSAA resolve into a texture every frame on the one context that sets
`preserveDrawingBuffer`. Possible only with `BLOOM_THRESHOLD` re-graded from scratch.

---

## 8 · Order of work

| # | change | risk | evidence behind it |
|---|---|---|---|
| ✅ | §4.3 half-resolution glow source | low | §3.3 — the star is the frame |
| ✅ | comment corrections (tone mapping, the dead cap) | none | verified in three's source |
| ✅ | **§4.1 phase budget + sane-frame ceiling** | low | §3.1 — measured refusal, every load |
| ✅ | **§4.2 retarget the probe budget** | medium | §3.2 — arithmetic confirmed to the digit |
| ✅ | **§4.6 stage 1** glow falloff | low | user-reported |
| **→** | **RE-MEASURE on the phone** | — | **everything below depends on it** |
| 4 | §4.4 direct star measurement | medium | only if the split is still unusable |
| 5 | §4.5 star cap | low | inert here; correct for dpr 3 |
| 6 | §4.6 stage 2 full-viewport canvas | **high** | must follow the cost work, not lead it |

**Everything shipped is a constant or a shader line — no architecture moved.** The next step is not
another change, it is a measurement: until the allocator runs, every number on this page is unallocated
by default rather than by measurement, and §4.4–4.6 are all decisions that need the real figures.

## 9 · How to know it worked

Same capture route (`/api/telemetry` → `vercel logs`). Before:

```
[voidix] gpu probe: 5.0 ms … → affordable 1.24, ceiling 1.24
[pixels] phase "B · field + star"  1 sample @ ratio 1.00: 84
[pixels] burn-in REFUSED  not enough usable frames in 3376 ms (needs 5 per phase)
```

After — and the phase line now reports the rules it was measured under, so a second refusal says why
rather than just that:

```
[voidix] gpu probe: 5.0 ms … → affordable 1.77, ceiling 1.77
[pixels] phase "B · field + star"  9 samples @ ratio 1.00: 148 151 …
  0 frames rejected over 260 ms · 1400 of 1800 ms budget · needs 5
[pixels] ALLOCATED a 33.3 ms frame (30 fps), models first…
  measured   field 34.0 ms @ 1.00  ·  star ~50 ms @ 1.00 (~60 % of the frame)
  3 · star  1.00 → …
```

**Read the three numbers in this order:**

1. `gpu probe … ceiling` — should be ~1.77, not 1.24. Confirms §4.2.
2. `phase "B" … N samples` and `M frames rejected` — should be ≥ 5 samples, few rejections. Confirms
   §4.1. If it still refuses, the rejected count and the elapsed budget say which of the two limits is
   still binding, which is exactly what the old log could not.
3. `ALLOCATED` rather than `burn-in REFUSED` — the allocator ran at all, for the first time on this
   device.

⚠ **Expect the star's share to be alarming**, and expect the allocator to cut it hard. That is the
system working — and it is also the point at which §3.3 stops being a footnote and becomes the next
piece of work: a star costing 60 % of a phone's frame is a cost problem, not an allocation problem, and
no amount of correct budgeting will make it sharp.
