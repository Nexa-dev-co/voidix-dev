# The star is soft on phones — diagnosis and plan

> **Status: PROPOSED. Written 2026-08-13.** Nothing here is built yet.
>
> The complaint is *"the sun looks low quality on my mobile device"*. It is not a model problem, not a
> texture problem and not a tier problem — `SunModelCanvas` never consults `getDeviceTier()` at all. It
> is one number: **the star is allocated 46–67 % of the panel's density on a phone, and 150 % of it on a
> 1× desktop.** This is why, and what to do.

---

## 1 · The measurement that states the problem

The star's canvas is sized by `HeroSun.syncToSquare` from `.hero-sun-card`'s untransformed rect ×
`SUN_CANVAS_HEADROOM` (2.6). The body fills `0.723` of the square (`SUN_BODY_FILL` × the headroom).

| | 1440 × 900, dpr 1 | 390 × 844 phone, dpr 3 |
|---|---|---|
| `.hero-sun-card` — `clamp(7rem, 20vw, 11rem)` | 176 px | **112 px** (the 7rem floor; 20vw = 78) |
| canvas = card × 2.6 | 458 px | 291 px |
| star **body** = 0.723 × card | 127 CSS px | **81 CSS px** |
| body at the panel's native density | 127 device px | **243 device px** |
| ratio the star may be allocated | up to 1.5 | **1.38 – 2.0** |
| body as actually rendered | **190 device px** | **112 – 162 device px** |
| → density against the panel | **150 %** | **46 – 67 %** |

```
   desktop, dpr 1                          phone, dpr 3
   ┌────────────────┐                      ┌────────────────┐
   │ rendered  190  │  supersampled        │ rendered  112  │  drawn at 46 %,
   │ displayed 127  │  1.5× — sharper      │ displayed 243  │  compositor blows
   └────────────────┘  than the panel      └────────────────┘  it up 2.17×
```

Same code, a **2.2–3.3× gap in effective sharpness**, entirely in the phone's disfavour.

---

## 2 · Where that number comes from

```
  deviceTier ──────► gpuProbe ──────► BURN-IN (2 phases) ──────► locked for the session
  hints, latched     1 drained        real rAF frames in          emergency valve only
  potato|low|mid     works frame      the loader, star            (±√2, twice, one way)
  |high              → CEILING only   drawing alongside
       │                                    │
       │ allocates shards, MSAA             │  phase A: field alone
       │ floor, bloom strength              │  phase B: field + star
       │ (the star reads NONE of it)        │  B − A  =  "what the star costs"
       ▼                                    ▼
                              reportSectionCosts(): spend a 33.3 ms frame
                              1 · reserve the star's floor
                              2 · models take what they can afford, capped at `ceil`
                              3 · star takes the remainder, capped at field × 1.6
```

Run it for a dpr 3 phone at 390 × 844:

```
floor  = 3 / MAX_COMPOSITE_UPSCALE 2.17          = 1.382   ← binds nearly everything
ceil   = min(MAX_PIXEL_RATIO 2, dpr 3, √(3/0.33)) = 2.00   ← the probe usually pulls this to ~1.4
sunCeiling = min(hardwareCeil 2, MAX_PIXEL_RATIO 2, native 3) = 2.00

field: a FULL-VIEWPORT 0.63 Mpx buffer that cannot go below 1.382 → eats most of the 33.3 ms
star:  gets whatever is left
```

So even a perfect measurement cannot hand the star more than **2.0 against a panel of 3.0**.
`MAX_PIXEL_RATIO`'s own comment reads *"hard cap (retina native)"* — it was written for dpr 2 desktops.

---

## 3 · ⚠ THE ROOT CAUSE: the instrument's resolution is one vsync interval

The cap explains why the star can never exceed 67 %. It does not explain why it sits at **46 %**, which
is the floor. This does, and it is the finding this document exists for.

**`runBurnIn` measures rAF-to-rAF wall clock.** `requestAnimationFrame` callbacks fire on display
refresh boundaries, so a measured interval is always ≈ `k × 16.67 ms` on a 60 Hz panel (8.33 ms at
120 Hz). The instrument therefore has a **resolution of one refresh interval**, and it always rounds
*up*.

The star's true marginal cost on a phone is somewhere around 5–10 ms. **That is smaller than one
quantum.** So `B − A` — a difference of two quantised numbers — cannot represent it. It can only come
out 0, or a whole 16.7:

```
                    true          measured (60 Hz)      B − A        what the allocator concludes
  ─────────────────────────────────────────────────────────────────────────────────────────────
  A: field alone    22 ms   →     33.3 ms
  B: field + star   30 ms   →     33.3 ms            →   0.0 ms   →  below MIN_CREDIBLE_STAR_MS
                                                                     ⇒ split REFUSED

  A: field alone    30 ms   →     33.3 ms
  B: field + star   38 ms   →     50.0 ms            →  16.7 ms   →  the star "costs" 2.1× what it
                                                                     does; remaining ms ≈ 0
                                                                     ⇒ starSolved ≈ 0
```

**Both roads end at the floor.** On the refusal road `sunPixelRatio` stays `null`, so
`getSunPixelRatio()` falls back to `min(pixelRatio, 2)` — the field's ratio, which is the floor 1.382.
On the overstatement road `starSolved` collapses and `Math.max(starFloor, …)` puts it at the floor
1.382. Either way: **46 % of the panel, and no log says anything is wrong** (the refusal prints
`[pixels] split REFUSED`, which reads like a credibility check doing its job).

⚠ **The same quantisation biases the FIELD's number too, everywhere, including desktop.** `measured ≥
true` always, by an average of half a quantum, so `sustainable = ratio × √(33.3 ÷ measured)` is
systematically low. On a phone whose true frame is 25 ms and measures 33.3, that is **15 % of ratio
lost**; on the reference dpr 2.5 laptop at 60–77 ms it is ~5 %. It is uniform and conservative, so it
is not a correctness bug — but it is part of why this site reads soft in general, and it is worth
knowing before anyone tunes `PIPELINE_FRAME_BUDGET_MS` again.

### ⚠ Confirm this before building anything

This is derived from first principles about the user's device, not measured on it. **Step zero is one
log line**, in `samplePhase`:

```ts
console.log('[pixels] phase samples', samples.map((s) => s.toFixed(1)).join(' '));
```

Deploy to a Vercel **preview** (telemetry is on there — see `lib/telemetryEnabled.ts`) and read it from
the phone. If every sample is a near-multiple of the refresh interval — `33.3 33.3 33.3 50.0 33.3` —
the diagnosis holds and §4.2 is the fix. If the samples are genuinely spread (`27.4 31.9 24.8 …`), the
instrument is finer than argued here and the answer is §4.1 plus the dials in §4.5 instead.

---

## 4 · The fixes

### 4.1 · The star's cap: `MAX_PIXEL_RATIO 2` → a star-specific `STAR_MAX_PIXEL_RATIO 3`

**What.** `sunCeiling()` in `lib/adaptivePixelRatio.ts` currently reads:

```ts
return Math.max(floor, Math.min(hardwareCeil, MAX_PIXEL_RATIO, native));
```

`hardwareCeil` is `min(MAX_PIXEL_RATIO, max(deviceRatio, SUPERSAMPLE_CEIL))`, so on a dpr 3 panel the
expression is `min(2, 2, 3) = 2`. Replace it with:

```ts
const STAR_MAX_PIXEL_RATIO = 3;   // native on the densest phone panels shipping
…
return Math.max(floor, Math.min(STAR_MAX_PIXEL_RATIO, native));
```

⚠ **Dropping `hardwareCeil` from that expression is provably equivalent, not a loosening.** `native` is
already `max(deviceRatioNative, SUPERSAMPLE_CEIL)` in the shipping-pose branch and `deviceRatioNative`
otherwise, and `hardwareCeil` is `min(MAX_PIXEL_RATIO, max(deviceRatio, SUPERSAMPLE_CEIL))` — so
`min(hardwareCeil, MAX_PIXEL_RATIO, native)` reduces to `min(MAX_PIXEL_RATIO, native)` in both
branches. The only change is which cap constant is named.

Then in `SunModelCanvas.tsx`, `MAX_DEVICE_PIXEL_RATIO = 2` clamps a second time and would make the
whole change inert. **Import the constant instead of keeping a second copy** — this is exactly the
`SUN_OMITTED_PARTS`-style drift CLAUDE.md warns about, and `MAX_DEVICE_PIXEL_RATIO` has precisely one
consumer (`sunPixelRatio()`, line 143) despite its comment claiming `particleFrameExtent` and the
camera fit are reasoned about in terms of it.

**⚠ Side effects.**

| | today | after |
|---|---|---|
| dpr 1 desktop | `min(1.5, 2, 1.5)` = **1.5** | `min(3, 1.5)` = **1.5** — unchanged |
| dpr 2 laptop | `min(2, 2, 2)` = **2.0** | `min(3, 2)` = **2.0** — unchanged |
| dpr 2.5 laptop | `min(2, 2, 2.5)` = **2.0** | `min(3, 2.5)` = **2.5** — ⚠ CHANGED |
| dpr 3 phone | `min(2, 2, 3)` = **2.0** | `min(3, 3)` = **3.0** — the point of the change |

- ⚠ **The dpr 2.5 laptop is the machine every cost figure in CLAUDE.md was taken on**, and its star's
  ceiling moves. It cannot actually reach 2.5: `STAR_RAISE_OVER_MODELS` binds the star to
  `field × 1.6`, and the field sits near 1.0 there, so the allowance is ~1.6. **Bounded by the models,
  exactly as designed** — but this is the first place to look if that laptop regresses.
- ⚠ **Memory scales with the square of the ratio, and the star's default framebuffer carries MSAA**
  (`antialias: true`). At 291 CSS px square: ratio 1.38 → 0.16 Mpx ≈ 10 MB of MSAA colour+depth; ratio
  2.2 → 0.41 Mpx ≈ 18 MB; ratio 3.0 → 0.76 Mpx ≈ 24 MB, plus ~10 MB for `sceneTarget` and the mip/blur
  chain. On a phone that is a real allocation and it is the ceiling, not the expected landing.
- **It is a cap, not a grant.** Nothing reaches it unless `starSolved` affords it, which today it
  cannot. **§4.1 alone is inert.** It is listed first because it is the smallest change, not because it
  is the one that works.
- `sunParticles.setPixelRatio` is a uniform (`uPixelRatio`); grain sizes follow correctly at any ratio.
- `getSunPixelRatio()`'s fallback keeps `MAX_PIXEL_RATIO`, deliberately: when the split is refused the
  star tracks the field, and the field is never above 2. Leave that line alone.

### 4.2 · Measure the star in its own context, drained — not as a difference of two rAF intervals

**This is the fix.** `lib/gpuProbe.ts` already contains the right instrument: `measureGpuFrameCost`
brackets a draw with `gl.finish()` either side and takes the median of three. Its resolution is
sub-millisecond because it does not ride the refresh clock at all. The star has its own renderer and
its own context, so it can be measured **directly rather than by subtraction** — which removes the
subtraction, the quantisation, and the three credibility checks' reason to exist in one move.

**Shape of the change.**

```
  useWorksField.runBurnIn                     SunModelCanvas
  ───────────────────────                     ──────────────
  settle for a quiet main thread
  phase A  (field alone, rAF)
  SUN_MEASURE_BEGIN_EVENT ──────────────────► onMeasureBegin: shipping pose, permit,
                                              noteStarMeasuredInShippingPose()
  SUN_DRAW_PERMIT_EVENT   ──────────────────►
  phase B  (field + star, rAF)                       │
        │                                            │  ⚠ on the NEXT frame after the pose,
        │  ◄── measureGpuFrameCost(sunRenderer,      │     NOT during phase B — see below
        │      () => bloom.render(scene, camera))    │
        │                                            ▼
        │                                     noteStarFrameCost(ms, appliedPixelRatio)
  SUN_MEASURE_END_EVENT   ──────────────────► onMeasureEnd: restore the drifting pose
  reportSectionCosts({ fieldMilliseconds, fieldRatio })
        └─ prefers the star's own number; falls back to B − A when it never arrived
```

**⚠ Side effects, each of which has to be handled.**

1. ⚠ **The drains must not land inside phase A or phase B.** `gl.finish()` stalls the GPU *process*,
   which is what freezes the worker-rendered dust (`docs/loader-freeze-plan.md` §7) and would inflate
   whichever rAF samples straddle it. Take the star's three drains **after phase B's samples are in and
   before `SUN_MEASURE_END_EVENT`** — the pose is still held there and nobody is sampling.
2. ⚠ **A drained frame over-reports**, because it removes the CPU/GPU overlap a real frame has. That is
   `gpuProbe`'s own documented pessimism and it pushes the star's ratio *down*. It is worth accepting:
   ~10–30 % pessimism against an instrument whose current error is 100–200 % in the *same* direction.
   `PIPELINE_FRAME_BUDGET_MS`'s 9 ms already encodes an allowance for exactly this bias, and the same
   reasoning transfers.
3. ⚠ **The rendezvous must be the module, not an event ordering.** The star's loop is asynchronous
   relative to `runBurnIn`'s `await nextWarmupFrame()` chain. Have the star write into
   `adaptivePixelRatio` (`noteStarFrameCost`) and have `reportSectionCosts` read whatever is there;
   **do not make the burn-in wait on a new event**, or a star that refuses the pose hangs the loader
   behind `BURN_IN_WAIT_MAX_MS`.
4. ⚠ **The refusal branches already exist and must stay the fallback.** `onMeasureBegin` refuses under
   reduced motion, before the model lands, and once the assembly is cued. On any of those, no star
   number is written and the allocator falls back to `B − A` — i.e. **today's behaviour, unchanged**.
   That is the whole safety story: the new path is strictly additive.
5. ⚠ **The gating of `reportSectionCosts` has to be restructured, and this is the subtle one.** Today
   the three credibility checks decide whether the allocator runs *at all*; if the split is not
   credible, `reportSectionCosts` is skipped and `reportBurnIn` sizes everything off one number. Once
   the star measures itself, a bad `B − A` is no longer a reason to skip the allocation — phase A is
   still a valid field measurement. So: credibility gates the **`B − A` path only**, and the allocator
   runs whenever it has a field number and *either* star number. ⚠ Watch the order with
   `reportBurnIn`: it early-returns once `phase === 'locked'`, so whichever runs first wins. That is
   already true today and must stay true.
6. ⚠ **Loader budget.** Low-power settle 1200 + 600 + 600 + ~50 ms of drains = ~2450 ms against
   `BURN_IN_WAIT_MAX_MS` 5500. Comfortable. `SUN_PERMIT_FALLBACK_MS` (4800, *"≥ settle + ONE phase"*)
   is untouched because nothing moves before phase A.
7. ⚠ **It changes the star's ratio on desktop too, and not necessarily upward.** A machine where
   `B − A` happened to land in a favourable bucket may have been over-allocating the star; a true
   measurement will take that back. That is correct, and it is the same argument
   `STAR_RAISE_OVER_MODELS`'s header makes about the last correction — *"expect the honest number to be
   lower than the biased one"*. Flag it in the `ALLOCATED` log so it is visible rather than mysterious.

**Expected outcome on the phone.** With a true star cost of ~6 ms measured at ratio 1.38, and the field
holding the floor: `remainingMs ≈ 33.3 − fieldSpent`, `starSolved = 1.38 × √(remaining ÷ 6) × 0.9`.
Even 8 ms of remainder solves ≈ **1.8**; `STAR_RAISE_OVER_MODELS` allows up to `1.382 × 1.6 = 2.21`.
So §4.2 alone moves the star **1.38 → ~1.8–2.0 (+30–45 % linear density)**, and §4.1 is what lets the
rest of that allowance through.

### 4.3 · `sunBloom` renders the glow source at 4× the resolution its only consumer reads

**What.** `createTarget` sizes `sceneTarget` to the full device resolution (`sunBloom.ts:363`), step 1
renders the entire star into it, and step 2 — the only thing that ever reads it — immediately
downsamples it by half into `mipTargets[0]`. **Three quarters of those fragments are averaged away one
pass later.**

```
  today                                        proposed
  ─────                                        ────────
  sceneTarget   D × D      ← full scene         sceneTarget   D/2 × D/2   ← full scene, ¼ the fill
       │ bright pass, 2:1 downsample                 │ bright pass, 1:1
  mip0          D/2 × D/2                       mip0          D/2 × D/2   ← IDENTICAL size
       │ … chain unchanged …                         │ … chain unchanged …
```

Because mip0 keeps its absolute size, `MIP_COUNT`, `MIP_WEIGHTS`, `BLOOM_RADIUS` and `BLOOM_STRENGTH`
all keep their exact meanings and the grade does not move. `MIN_MIP_SIZE` produces the same chain
(`floor(D/2)` either way).

**The saving.** The star renders its scene twice per drawn frame. Step 1 drops to a quarter of its
pixels, so per-frame scene fill goes **2.0 → 1.25 full-resolution renders, −37.5 %** — on the most
overdraw-heavy surface on the site (11 double-sided blended shells + the core + 10 magma cells), on
devices where the limit is fill. That headroom is not spent as such; it is handed to the allocator,
which converts it into ratio for **both** the star and the field.

**⚠ Side effects.**

1. ⚠ **The bright pass loses a free 4:1 box average.** Today mip0's texels are bilinear averages of
   four full-resolution texels; after, they are single half-resolution texels. Level 0 is the *tight
   core* glow, so if anything shows it will be a faint shimmer on the hot veins as the star turns —
   and five blur passes sit downstream of it. **If it shows, render `sceneTarget` at 0.707× instead of
   0.5×** (half the pixels rather than a quarter, −25 % fill) and keep mip0 where it is.
2. `sceneTarget` carries no `samples` today and none after — no MSAA interaction.
3. The visible base image (step 4, straight to the canvas) is **untouched**. This changes only what
   feeds the glow.
4. ⚠ After this, `sceneTarget` no longer matches the canvas resolution. Nothing else reads it today;
   anything that ever does must not assume it does.

### 4.4 · Two comments that are wrong, fixed in the same sitting

Not behaviour — but CLAUDE.md's standing rule is *"if this file disagrees with the code, the code is
right: fix this file as part of the change"*, and both of these will mislead the next person to grade
the star.

- ⚠ **`BLOOM_THRESHOLD`'s header claims the bright pass compares against *"the TONE-MAPPED luma"*. It
  does not.** Verified in `node_modules/three/src/renderers/WebGLRenderer.js` (and `WebGLPrograms.js:175`):
  tone mapping is applied **only when the render target is null**. `sceneTarget` is a render target, so
  the bright pass reads **linear HDR** values, and `BRIGHT_PASS_FRAGMENT_SHADER` applies no tone curve
  of its own. Against ACES at `EXPOSURE` 1.42, a linear 0.42 displays as ≈ 0.56 — so the effective cut
  sits about one stop above where the comment's percentile table implies, and the *"roughly the top
  fifth of the surface"* claim is nearer the top 3–4 %. **Nothing shipping changes** — 0.42 was tuned
  by eye and the star blooms correctly — but the explanation must be corrected.
- `MAX_DEVICE_PIXEL_RATIO`'s comment says it is kept *"because `particleFrameExtent` and the camera fit
  are reasoned about in terms of it"*. Neither reads it; `sunPixelRatio()` is its only consumer.

### 4.5 · Two dials that are judgement calls, not defects

Neither should move until §4.2 has been measured on a real handset.

- **`MAX_COMPOSITE_UPSCALE` 2.17 sets the field's floor at 1.382 on a dpr 3 phone**, for a
  full-viewport 0.63 Mpx buffer with bloom and composer ping-pong. **That floor is what eats the frame
  the star is taking its remainder from.** The constant's own header anticipates this: *"If it bites,
  the fix is to read `isLowPowerDevice()` when computing the floor rather than to move this number
  back"*. Lowering the phone's field floor trades mark/debris sharpness for star sharpness. It is a
  real lever and it is a taste decision about which subject matters more on a phone.
- **`.hero-sun-card` is `clamp(7rem, 20vw, 11rem)`, so a phone gets the 7rem floor: 112 px, and a star
  body of 81 CSS px.** This is the only fix that raises the star's **apparent size** rather than its
  density, and the plumbing risk is near zero — `HeroSun.syncToSquare`, the pin's fill geometry and the
  intro's o→square flight all *measure* the element rather than assuming a size. It is purely a design
  question: the square is the "o" in **we build W□rlds**, so growing it on a phone is a headline
  composition decision, not a performance one.

---

## 5 · ⚠ REJECTED: crediting `SUN_IDLE_STRIDE` in the star's budget

This was proposed, looked like the largest free win in the file, and **must not be built.** Recorded
here so it is not re-derived.

The argument for it: `reportSectionCosts` budgets the star at full rate, while through services and
works it draws every other frame (`SUN_IDLE_STRIDE = 2`). The allocator says so itself — *"it actually
spends half of this"*. Crediting the stride is worth `√2 = 1.41×` on the star's ratio for six lines.

**Why it is wrong: vsync quantisation turns the amortisation into visible stutter.**

Amortising is valid for *mean* frame time and invalid for *pacing*. Sizing the star so that
`field + star/2 ≤ 33.3 ms` means the frames it actually draws on cost `field + star`, which overshoots
the budget by exactly the credited amount. The display then quantises that overshoot to the next
refresh boundary:

```
  today   (star charged at full rate)      credited (star charged at half rate)
  ────────────────────────────────────     ─────────────────────────────────────
  drawn frame     field + star ≤ 33.3      drawn frame     field + star ≈ 41.6  → 50.0 ms
  skipped frame   field       ≈ 25         skipped frame   field       ≈ 25     → 33.3 ms
  ───────────────────────────────────      ─────────────────────────────────────
  steady 30 fps                            alternating 50 / 33 = 24 fps average,
                                           with a 2:1 ripple you can see
```

So the credit buys sharpness and pays for it in **judder plus a lower average frame rate** — the exact
trade `RESOLUTION_PRIORITY`'s header says is a decision about the site, made accidentally, in the wrong
direction, by a constant nobody would look at again.

⚠ **The existing full-rate charge is therefore correct, not conservative**, and the header's
"conservatism" note should be softened to say so: the star's *worst* frame is what has to fit, and its
worst frame contains the star.

**What survives of the idea.** The hero genuinely is a different frame — the star draws at full rate
there and the field draws *nothing*, so the whole of `fieldSpent` is free. Spending it would mean a
hero-specific star ratio, i.e. a bloom-pyramid reallocation at the hero↔services boundary, where
`choreographyActive` is true (the cracks ramp across the fill) and `SunModelCanvas:1787` defers the
reallocation to the next settled frame — landing it *late and visibly*, behind the fleet, twice per lap
on a site that loops. **Not worth it.** The star's single allocated ratio stays.

---

## 6 · ⚠ REJECTED: reusing the canvas as the glow source

The natural extension of §4.3 is to delete step 1 entirely — render the scene once to the canvas
(step 4) and copy that back into `sceneTarget` — which would save 50 % rather than 37.5 %.

**It cannot work as a drop-in.** The canvas is the default framebuffer, so three applies ACES tone
mapping at `EXPOSURE` to it and does *not* apply it to `sceneTarget` (§4.4). The bright pass would
suddenly be thresholding display-space values against a number graded for linear ones — a cut point
moving from a linear 0.42 to an effective linear ~0.30, which re-grades the site's centrepiece. It also
requires resolving the MSAA default framebuffer into a texture every frame, on the one context that
also sets `preserveDrawingBuffer`. If it is ever wanted, it needs `BLOOM_THRESHOLD` re-graded from
scratch against the tone-mapped distribution — a deliberate pass, not a refactor.

---

## 7 · Order of work

| # | change | risk | needs a device to verify |
|---|---|---|---|
| 0 | log the raw phase samples, read them from the phone (§3) | none | **yes — do this first** |
| 1 | §4.3 half-resolution glow source | low | no (`tsc` + eyes on the hero) |
| 2 | §4.4 comment corrections | none | no |
| 3 | §4.2 measure the star drained, in its own context | **medium** | yes |
| 4 | §4.1 `STAR_MAX_PIXEL_RATIO` | low | yes |
| 5 | §4.5 dials, only if 3+4 leave it short | — | yes |

§4.1 and §4.2 ship **together**: §4.1 alone is inert (nothing solves high enough to reach the old cap),
and §4.2 alone lands into a cap of 2.0 — still worth +30–45 %, but half the available win.

## 8 · How to know it worked

Preview deploy, phone, console. Before:

```
[voidix] device tier: low   pointer coarse, width 390, dpr 3
[pixels] split REFUSED  field 33.3 ms, both 33.3 ms → star 0.00 ms.
[pixels] BURN-IN  1.38 → 1.38 — bound by the floor
```

After:

```
[voidix] device tier: low   pointer coarse, width 390, dpr 3
[pixels] ALLOCATED a 33.3 ms frame (30 fps), models first…
  measured   field 30.1 ms @ 1.38  ·  star 6.2 ms @ 1.38 (17 % of the frame)
  3 · star  1.38 → 2.05  from the 9.4 ms left, bound by the measurement
  ✓ the star's 6.2 ms is its SHIPPING pose, measured drained in its own context
```

The two numbers that matter are the `ratio` and **`sun ratio`** gauges in the frame profiler. `sun
ratio` at or near the floor means this document's diagnosis is still live; `sun ratio` above the
field's `ratio` means the allocator is doing what it was built to do.
