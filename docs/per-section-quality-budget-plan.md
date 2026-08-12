# Per-section quality budget — plan

> **Status:** **STEPS 1–4 BUILT** 2026-08-07 and since measured (§7 ran; `sun · bloom` came back at
> **4.4–7.9 ms per call** against the 9–22 ms this was sized on — half, but far above the 3 ms that
> would have flipped the priority, so the order of work stood).
> **§8 — THE ALLOCATOR — BUILT** 2026-08-07, unverified on a real machine.
> Steps 6–7 shipped as part of it; a deck burn-in and the §7e context-switch experiment remain open.
> v1 2026-08-07 · **v2** same day, after a red-team pass · **v3** same day,
> after verifying the tone-mapping claim v2's headline step rested on.
>
> The revisions were not cosmetic. **v1** proposed paying for a sharper star by making the fleet and
> the field softer — the expensive way to reach the goal. **v2** replaced that with "pay out of
> waste" and found three failure modes that would have shipped. **v3** checked the one claim
> everything hinged on against `node_modules/three` and found that v2's headline step *changes the
> star's appearance by construction* — so it is demoted to an appendix and replaced by something that
> gets 63 % of the saving with no visual change at all.
>
> §1 findings · §2 plan · §5 side-effect register · §6 the demoted step and why.

---

## 0 · What was asked, and the one change to it

> *"Section 1 has the sun only — give it high quality. Section 2 has the sun and the ships; the ships
> have priority, cap them at 1080 and give the rest to the sun. Section 3 the same for works. Section
> 4 all equal, but the sun is big and the black hole is big, so kill everything else on entry except
> the FAQ. And if they travel in time the sun is cached, no worries?"*

**The goal is right; the mechanism is the expensive route.** The star is paying for a full scene
render nobody looks at, and the chamber is rendering a full-screen space scene onto a postage stamp.
Reclaim those and the star gets sharper with **nothing else getting softer** — no cap, no trade.

```
   the ask                                 this plan
   ───────                                 ─────────
   works ──── pixels ───► sun              works  (untouched)
   "marks get softer so                    sun ──► stops doing the work nobody
    the star gets sharper"                         looks at, and keeps it
```

---

## ⚠ Step 0 · Reproduce the measurement before writing any code

**Everything below is sized against one number that came from a code comment**, not from a
measurement anyone has taken recently: `SunModelCanvas.tsx:428` says the profiler had `sun · bloom` at
*"9–22 ms — the largest measured span on the page whenever the star draws."*

If that still holds, the order of work below is right. **If the star is actually 3 ms, the priority
flips** and the chamber (§2.3) is the only item worth doing.

Telemetry is on in `development` and on Vercel **preview** builds (`lib/telemetryEnabled.ts`) — the
preview is the honest place, since dev inflates everything. What to read off the `[frame]` breakdown,
on the reference machine, before touching anything:

| span | where it comes from | why |
|---|---|---|
| `sun · bloom` | `SunModelCanvas.tsx:1340` | the entire premise of §2.1–2.2 |
| `works · space` | `useWorksField.ts:2686` | what §2.3 is decimating |
| `works · screen` | `useWorksField.ts:2706` | the room — what stays at full rate |
| `ratio`, `fps(ctrl)` | gauges | which constraint is actually binding |

Read them at four places: **hero at rest · fleet at rest · works browsing · standing in the chamber.**
The last one is the whole of §2.3.

---

## 1 · What the source actually says

### 1a · One ratio, three renderers

`lib/adaptivePixelRatio.ts` owns a single `pixelRatio`; the works field (`useWorksField.ts:768`), the
deck (`useServicesDeck.ts:450`) and the sun (`SunModelCanvas.tsx:120`) all read it. The split between
the star and the scene behind it is decided by their canvas areas and nothing else — no budget, no
priority, no section. The ask is for the thing that is missing.

### 1b · ⚠ The sun's canvas is 458 × 458

`.hero-sun-card` is `clamp(7rem, 20vw, 11rem)` (`globals.css:1125`); `HeroSun` sizes the layer to that
square's **untransformed** rect × `SUN_CANVAS_HEADROOM` (2.6); the pin's `SUN_SCROLL_SCALE` of 1.1 is
a CSS transform and never touches the backing store.

```
            what the renderer is asked for            share of frame
  works  ┌────────────────────────────────────┐
         │            1512 × 982              │       1.485 Mpx    100 %
         │        ┌────────┐                  │
         │        │458×458 │ ← the sun        │       0.209 Mpx     14 %
         │        └────────┘                  │
         └────────────────────────────────────┘
```

⚠ `SunModelCanvas.tsx:427` calls this canvas *"3 Mpx at this ratio and 6.7 Mpx of device pixels once
composited"*. It is 0.21 Mpx of CSS pixels — **wrong by 14×**, and it is the stated justification for
turning MSAA off on the star. That matters in §2.5.

### 1c · The sun renders its scene TWICE, on an expired justification

`sunBloom.render` (`sunBloom.ts:269–320`): step 1 renders the scene into `sceneTarget` for the bright
pass; step 4 renders **the whole scene again** straight to the canvas, so the base image and its alpha
are never blitted. The header defends it:

> *"The cost is rendering the scene twice per DRAWN frame. That is affordable here and nowhere else:
> … `SunModelCanvas` is demand-rendered — **it draws nothing at all for the whole services → works →
> chamber span.**"*

**That clause is false now.** `SunModelCanvas.tsx:1313–1318` records the change: the star cracks,
breathes and collapses across services and works, so `covered` only goes true at the chamber reveal.
The double render is paid on every frame of the two heaviest sections on the site.

And the doubled scene is heavy: the model **plus twenty additive corona planes, the flares and
`sunParticles`**, all transparent, all overlapping. Overdraw — which is why a 0.28 Mpx canvas can cost
9–22 ms. Per pixel, the star is the most expensive surface on the page by roughly 5–10×.

### 1d · At the chamber, the space stage renders full-screen onto a table

Stage 1 (`spaceComposer`: starfield, marks, debris, `UnrealBloomPass`, HUD) renders at full canvas
resolution into a texture; stage 2 paints it onto whatever the reveal says. Full-bleed during works —
correct, 1:1. During the chamber it is `displayHeight: 0.95` world units of table
(`chamberTuning.ts:474`) seen from across a room.

```
   works browsing                        chamber, at rest
  ┌──────────────────┐                 ┌──────────────────┐
  │##################│  1 texel per    │      ______      │  1 texel drawn
  │###  the space  ##│  screen pixel   │     /##### /     │  per ~9 screen
  │##  full-bleed  ##│                 │    /#####_/      │  pixels of
  │##################│                 │   [ table     ]  │  nothing
  └──────────────────┘                 └──────────────────┘
         SAME COST — stage 1 does not know the difference
```

Nothing scales it. Largest single piece of unnecessary work on the site, in exactly the section the
ask wants cleaned out.

### 1e · Most of "kill everything else" is already built

| what | at the chamber / contact | where |
|---|---|---|
| deck | loop runs, no draw, canvas un-composited | `useServicesDeck.ts:1448–1468` |
| sun | frozen on one preserved frame, un-composited | `SunModelCanvas.tsx:590–604` |
| fluid cursor | refuses splats, trail cleared, un-composited | `useFluidCursor.ts:197–203` |
| constellation | frozen | `useConstellationFrame.ts:500–521` |
| drag-to-look | **already dead in the room** | `useWorksField.ts:2208, 2220` |
| the mark | removed from the scene graph at contact | `useWorksField.ts:1906` |
| lensing pass | `enabled = false` until contact | `useWorksField.ts:839` |

Not gated: the space stage above, and `HeroInstruments` — four `requestAnimationFrame` loops
(`useCoreTelemetry`, `useEnvironmentTelemetry`) running for the whole session on a HUD that is off
screen from the fill onward.

### 1f · "Cached, no worries" — yes, and it is a constraint

Nothing is disposed on the loop. `LOOP_RESET_EVENT` only snaps eased values
(`useHeroAnimation.ts:1377`); `SunModelCanvas` stays mounted and replays the assembly on
`SUN_REGATHER_EVENT`. Composers, models and textures survive the teleport, so lap two is free.

⚠ **Therefore: stop drawing, stop compositing, never `dispose()`.** If "kill everything on entering
the chamber" frees anything, lap two pays a rebuild in front of the visitor.

### 1g · ⚠ Tone mapping is applied per-fragment, and only when drawing to the canvas

Verified in `node_modules/three/build/three.cjs:67250–67258` (three 0.184), `WebGLPrograms.getParameters`:

```js
if ( material.toneMapped ) {
  if ( currentRenderTarget === null || currentRenderTarget.isXRRenderTarget === true ) {
    toneMapping = renderer.toneMapping;
  }
}
```

`outputColorSpace` is gated the same way (line 67287). So today:

```
   sceneTarget   ← linear HDR, NO tone map, NO sRGB encode   (feeds the bright pass)
   the canvas    ← ACES + EXPOSURE + sRGB, applied PER FRAGMENT, BEFORE blending
```

**This is what kills the obvious optimisation.** ACES is non-linear, so for the star's twenty
additive corona planes `Σ ACES(xᵢ) ≠ ACES(Σ xᵢ)`. Any scheme that renders the scene once into a
target and tone-maps the *accumulated* result produces a different image — brighter or flatter
depending on the pixel, and different everywhere the planes overlap, which is the whole star. Not an
implementation slip that can be got right with care: **a structural change to the look that requires
re-grading.** See §6.

---

## 2 · The plan

### 2.1 · Sun: decimate the bloom SOURCE, not the base image ★

Split `sunBloom.render` in two, on rate:

```
   EVERY drawn frame                       EVERY OTHER drawn frame
   ─────────────────                       ───────────────────────
   4. scene ─────────► CANVAS              1. scene ────► sceneTarget
   5. glow (additive) ► CANVAS             2. bright ───► mip0
                                           3. blur ×3
```

The base image is **byte-identical to today** — step 4 is untouched, still the direct render, still
tone-mapped per fragment. Only the *glow* is at most one frame stale, and the glow is a wide blurred
halo on a star turning at 11°/s: **0.18° of lag.** Nothing else on the canvas changes.

Removes one full render of the site's most overdraw-heavy scene on alternate frames: **~25 %**, at
zero visual risk and zero re-grading.

### 2.2 · Sun: draw at half rate when nothing is choreographed ★

`AUTO_ROTATE_DEGREES_PER_SECOND = 11` — **0.37° per frame at 30 fps.** Through services and works the
star is a slowly turning background object behind the fleet (z-index −1) or behind the marks. Drawing
it every other frame is imperceptible.

The discriminator already exists and is already load-bearing. `SunModelCanvas.tsx:1325–1331` splits
`choreographyActive` (the scrubbed ramps and the shard flight — *authored beats that must not step*)
from `moving` (the idle turn — *delta-timed, a dropped frame is invisible*). The comment at line 1353
makes exactly this argument for a different purpose. And `preserveDrawingBuffer: true` (line 441)
already exists so skipped frames keep compositing the last image — the mechanism is in place.

```ts
const paintThisFrame = choreographyActive || forceRender || (drawCounter % SUN_IDLE_STRIDE === 0);
```

### ⚠ One rule governs both

**`choreographyActive` → everything at full rate.** The cracks, the ring assembly, the shard flight
and above all the collapse across the handoff are scrubbed under the visitor's finger. It also covers
a subtlety: `bloom.setGrade` lerps the bright pass's `uThreshold` during the collapse
(`SunModelCanvas.tsx:1284`), and that uniform lives in a pass §2.1 decimates. One rule, both problems.

**Together, §2.1 + §2.2 put the star at ~37 % of today's cost, with no change to how it looks.**

```
   per second at 60 Hz, in units of canvas fill, overdraw factor k = 5

   today                60 × (2k + 2.0)                        =  722   ████████████████████
   §2.1 alone           60 × (1.5k + 1.5)                      =  540   ███████████████
   §2.1 + §2.2          30 × (k + 1.0) + 15 × (k + 1.0)        =  270   ███████
   …plus the merge      30 × (k + 2.0)                         =  211   ██████  ← §6, needs re-grading
```

⚠ The ratio holds at any *k* — both terms scale together, so it is ~63 % whether the star is lightly
or heavily overdrawn. **The merge buys 8 further points of the original for a re-grade of the site's
centrepiece.** That is why it is in §6 and not here.

### 2.3 · Chamber: the space stage decimates in time ★ biggest single saving

The display is a postage stamp (§1d) and the visitor is looking at a *room*, which stage 2 keeps
drawing at full rate. Stage 1 can update less often — the composer's read buffer holds the last image
and stage 2 re-paints it happily. Drag-to-look is already dead in the room (§1e), so nothing the
visitor does moves that camera.

```ts
// a pure function of the room's own progress: no flags, no timers, reverses for free
const spaceStride = 1 + Math.round(CHAMBER_SPACE_STRIDE_MAX * smoothstep(revealProgress, 0.25, 0.7));
if (isDrawing && spaceFrameCounter % spaceStride === 0) spaceComposer.render();
```

At `CHAMBER_SPACE_STRIDE_MAX = 2` the feed runs at 20 fps on something occupying ~10 % of the frame
while the room stays at 60. **No reallocation, no resolution change, obeys rule 2 of the scroll
spine** — a pure function of progress, reversible, cannot be outrun. About ten lines.

⚠ **A non-obvious failure that would have shipped.** Decimated frames are cheaper, so `sampleFrame`
reads a frame rate the site cannot sustain, and **both** consumers latch on it: `EMERGENCY_FAST_FPS`
(58 fps for 6 s → a one-way resolution raise, opposite direction locked for the session) and
`EXTRA_QUALITY_FPS` (50 fps for 4 s → 4× MSAA on the space stage, ~166 MB). The chamber would teach
the controller the site is fast and works browsing would pay for the rest of the visit. **Skip
`sampleFrame` on any frame where stage 1 was skipped.** §5 item 8.

⚠ The stride must reach 1 **before** the display grows back toward full-bleed, or the frame where the
picture returns carries a stale camera. Verify by scrubbing *backwards* out of the room.

### 2.4 · Re-measure

Re-run step 0 and the loader's burn-in. **Do not decide the star's quality before this number
exists** — `adaptivePixelRatio`'s header records three constants' worth of what guessing costs here.

⚠ The burn-in measures `works + sun` together (`useWorksField.ts:2068`), so it is taken at the *old*
star cost and §2.1–2.2 invalidate it. Save first, then measure, then decide. Decide-then-save is
circular.

⚠ **One hypothesis that changes the answer and takes twenty minutes.** The star is a **second WebGL
context**, and a per-frame context switch costs real milliseconds on some drivers *independent of
resolution*. Test: hold the ratio and halve the canvas. If the cost barely moves, it is the switch —
and raising the star's ratio is far cheaper than any model here predicts.

### 2.5 · Then spend it on the star — MSAA before resolution

| | fixes | cost on a 458² canvas | |
|---|---|---|---|
| **MSAA** — `samples: 4` on `sceneTarget` | *silhouettes* — the shards against the transparent background | **~13 MB** and one resolve, because the canvas is tiny | cheap |
| **resolution** — `getSunPixelRatio()` above the shared ratio | the *whole image*; on a dpr 2.5 panel the star renders at ~46 % of panel density and the compositor upscales it 2.17× | ratio 1.15 → 2.0 is **3× the fill** on the most overdraw-heavy surface on the site | expensive |

⚠ §1b is what makes MSAA cheap here and it is the opposite of what `SunModelCanvas.tsx:427` claims.
Take MSAA first; then as much ratio as §2.4 says is left. Expect **~1.4–1.6, not 2.0**.

⚠ **`setSize` will not rebuild a target for a new sample count** — it only disposes when the
*dimensions* change. Raising `sceneTarget`'s samples means `dispose()` on it first, or it silently
does nothing and reads as "MSAA didn't help". §5 item 9.

### 2.6 · The prerequisite for §2.5 that nobody would find

Whatever §2.5 decides must be applied **once, behind the veil**, or it is a visible sharpness pop on
the site's centrepiece — and `sunParticles.setPixelRatio` (line 543) means the grains change size
with it.

**Today it cannot be.** `applySize` is blocked whenever `choreographyActive` (line 1360), and
`assembling` is set true by the **drift** branch (lines 1197–1199) for the entire loader wait — the
shards tumble on screen the whole time the assets download. `drawingPermitted` is set by
`BURN_IN_EVENT` (line 695). So the star has no clear frame between the burn-in and the hero.

Fix, and a correctness fix in its own right: **split `assembling` into `driftActive` and
`assemblyFlightActive`.** The drift is delta-timed idle tumbling with no authored landing — exactly
the category line 1353 says must *not* block a reallocation. Only the one-shot flight is a beat.

### 2.7 · The two free ones

Gate `HeroInstruments`' four rAF loops on `BLACK_STAGE_EVENT`, as the fluid cursor and constellation
already are (§5 item 7 for the re-arm trap). Leave everything in §1e alone — it is done.

---

## 3 · Not in this plan

| dropped | why |
|---|---|
| **The 1080 cap** | Makes the marks and hulls ~17 % softer to fund the star; §2.1–2.3 fund it without that. Keep as a *fallback lever* — one line on `MAX_DRAWING_BUFFER_MEGAPIXELS`. ⚠ If ever used, note it only applies when the **probe lands**: `pixelBudgetCeil` stays `Infinity` on a refused probe (`adaptivePixelRatio.ts:414`), so a refused probe silently disables it. |
| **Contact takes the cap back** | A 150–400 ms reallocation of both composers while the visitor stands still reading the FAQ, to buy ratio 1.18 → 1.42 on machines where the cap binds at all. |
| **Half-res bloom source** (v1) | Drops `sunParticles` grains between texels → twinkling glow. Note §2.1 decimates the source *in time*, not in resolution — that is a different thing and has no such failure. |
| **Per-section sun ratio** | Unnecessary and risky. The section where the star is most expensive relative to its neighbours (hero) is the one where nothing else draws; the sections where it would compete (chamber, contact) are the ones where it is already frozen. One number, decided in the loader. **⚠ Partly superseded 2026-08-07 — see §8.** The ruling stands on the thing it was ruling on (a ratio that CHANGES as you scroll, putting a reallocation at a section boundary). What §8 builds is still *one number, decided in the loader* — it is only the way that number is arrived at that changed. |

### Considered and rejected

- **Render stage 1 into a sub-rectangle of an over-allocated target** — per-section resolution with no
  reallocation, via `renderTarget.viewport`. Works for a bare `RenderPass`; breaks on
  `UnrealBloomPass`, which owns its own target chain and samples UV 0–1, so it would pull stale pixels
  from the unused region into the glow. Rejected on invasiveness, not principle.
- **Move the sun into the works renderer.** Dissolves this entire problem — one context, one budget,
  no context switch, and the star could appear on the chamber's display. It is also `sunBackdrop.ts`,
  deleted 2026-07-31, and CLAUDE.md documents why. Out of scope; noted because it is the real answer
  if the star is ever rebuilt.
- **Cut the corona plane count.** The direct fix for the overdraw, and it changes how the star looks.
  That is an art decision, not a performance one.
- **Per-pipeline ratios** (deck sharper than works — measured 23–26 fps vs 13–17). No extra
  reallocation, since each composer allocates once. Needs a second measurement, and CLAUDE.md is
  explicit that AA differing between two loads of the same page is worse than not having it. After
  §2.1–2.5, not instead.

---

## 4 · Order of work

| # | step | needs | risk | |
|---|---|---|---|---|
| **0** | **Reproduce `sun · bloom` and `works · space` on a preview build** | — | — | ⬜ §7 |
| 1 | `HeroInstruments` gated on `BLACK_STAGE_EVENT` (§2.7) | — | low | ✅ built |
| 2 | Chamber space stride **+ the `sampleFrame` exclusion** (§2.3) | — | low, one trap | ✅ built |
| 3 | Sun bloom-source decimation (§2.1) | — | low — base image untouched | ✅ built |
| 4 | Sun idle stride (§2.2) | 3 | low | ✅ built |
| 5 | Re-measure; test the context-switch hypothesis (§2.4) | 0, 2, 3, 4 | — | ⬜ §7 |
| 6 | Split `driftActive` from `assemblyFlightActive` (§2.6) | — | low | ⬜ |
| 7 | Spend it: MSAA on `sceneTarget`, then ratio if there is room (§2.5) | 5, 6 | low | ⬜ |

Steps 1–4 need no measurement, each stands alone, and **none of them changes how anything looks**.
Step 5 is the gate on step 7. Nothing is spent on the star before its cost has been re-measured.

### ⚠ One correction made during the build, and it is the user's own brief read back

§2.2 as written strided the star **everywhere**, including the hero — and the hero is precisely where
the brief says the star must be at its best, because it is the one section where nothing else is
drawing and there is therefore no contention to resolve. Striding there buys nothing and costs the
site's opening shot.

The stride is now gated on `BLACK_STAGE_EVENT` as well as on `choreographyActive`:

```
   hero · fill   ── star at FULL rate, full glow      nothing else draws; no contention to resolve
   services      ── stride 2                          behind the fleet at z-index −1
   works         ── stride 2                          behind the marks, heaviest scene on the site
   chamber       ── frozen outright (`covered`)        unchanged, pre-existing
```

Which is the ask, section by section, without a cap on anything.

---

## 5 · Side-effect register

Ordered by how bad it is if missed. Every item has a test.

### Measurement contamination — the quiet ones

**8 · Decimated frames teach the controller the site is fast.** §2.3. Two latched consequences: a
one-way `EMERGENCY_FAST_FPS` raise and 4× MSAA from `EXTRA_QUALITY_FPS`. Both persist for the session
and both make works browsing worse. *Mitigation:* skip `sampleFrame` whenever stage 1 was skipped.
⚠ **The same applies to §2.2** — the sun does not call `sampleFrame`, so it is safe today, but if the
star is ever added as a pipeline the stride must be excluded there too. *Test:* telemetry on, sit in
the chamber 30 s, confirm no `EMERGENCY RAISE` and no `EARNED EXTRA QUALITY`.

**12 · The burn-in measures `works + sun` together.** §2.4. Save first, measure second, decide third.

### Lag / stall

**1 · A resolution apply is a 150–400 ms stall.** Every new ratio reallocates a composer, its bloom
pyramid and its ping-pong targets. *Mitigation:* this plan introduces **zero** new heavy-scene
reallocations; the star's one apply lands in the loader (§2.6). *Test:* profile a full lap — no
`[pixels]` line should appear after the burn-in.

**9 · `setSize` will not rebuild a target for a new sample count.** §2.5. Symptom is silence, which
reads as "MSAA didn't help" rather than as a bug.

**10 · Two composers' worth of memory stays allocated in the chamber.** Deliberate — freeing it costs
the loop its free second lap (§1f). Named so nobody "optimises" it later.

### Disappearing / visual regression

**6 · A decimated collapse steps.** The cracks, the ring and the collapse are scrubbed under the
visitor's finger; drawing them at 30 fps stutters against the scroll. *Mitigation:* the one rule in
§2.2. *Test:* scroll the services→works handoff slowly and watch the star implode, then flick it.

**15 · The star freezes one frame short of its settled pose.** `wasAnimating` (line 1343) exists to
draw the one final frame after motion stops. With a stride, that flag can be consumed on a frame the
stride skipped — so the last frame drawn is not the settled one, and the star holds a pose 16 ms shy
of where the scroll left it. *Mitigation:* a stride-skipped frame must not clear `wasAnimating`.
*Test:* stop scrolling mid-crack and compare against a reload at the same scroll position.

**5 · The chamber stride shows one stale frame on the way out.** If the ramp lags the display's
growth, the frame where the picture returns to full-bleed carries a 2-frame-old camera. *Test:* scrub
*backwards* out of the room, slowly and then fast.

**7 · The hero HUD never comes back.** Gating `HeroInstruments` on `BLACK_STAGE_EVENT` means it must
re-arm when the stage goes false — **including after the teleport**, where the visitor arrives at the
hero with the readouts frozen wherever contact left them. *Test:* complete a lap via "Travel in time"
and watch Core Stability.

**16 · The glow lags a fast beat.** §2.1's one-frame-stale halo is invisible at 11°/s and would not be
during the collapse's grade change — covered by the one rule in §2.2, listed separately because it is
a different mechanism from item 6. *Test:* the handoff, watching the halo rather than the body.

**11 · Mid-session sun ratio changes resize the grains.** `sunParticles` point sizes are in device
pixels (line 543). Another reason the ratio is decided once, in the loader.

**2 · Premultiplied alpha — verified NOT a hazard for §2.1.** Both the direct-to-canvas render and
the render into `sceneTarget` go through the same blend equations, so both framebuffers hold
premultiplied colour. §2.1 does not copy between them at all — step 4 is untouched. ⚠ This *is* a
hazard for the §6 variant, where a wrong premultiply produces the exact failure `sunBloom`'s header
documents: a visible rectangle around the star over the cream hero.

**3 · Tone-map order — structural, see §1g and §6.** Not applicable to §2.1–2.2.

### Architecture

**13 · Anything new must be a pure function of published progress**, not a flag or a threshold — rule
2 of the scroll spine. The chamber stride is; the sun stride reads a flag the file already maintains.

**14 · Any new eased value must listen for `LOOP_RESET_EVENT`.** Both strides are derived per frame
rather than eased, so they are exempt by construction — stated so nobody adds an ease without wiring
the reset.

---

## 6 · The demoted step: merging the sun's two scene renders

**What it is.** Render the scene once into `sceneTarget`; bright/blur from it as now; then one final
pass to the canvas writing `toneMap(scene.rgb) + glow` with `scene.a + glowAlpha`, blending off.
Saves the second full scene render outright — **8 percentage points beyond §2.1 + §2.2** (§2.2's
table).

**Why it is not the headline step.** §1g, verified in three's source: tone mapping is applied
per-fragment *before* blending, and only when the destination is the canvas. ACES is non-linear, so
across the star's twenty additive corona planes `Σ ACES(xᵢ) ≠ ACES(Σ xᵢ)`. Rendering once and
tone-mapping the accumulated result **changes the image by construction** — most where the planes
overlap, which is the whole star. There is no way to force tone mapping into a render target in
three; `renderer.toneMapping` is read only for the canvas.

So this is not "implement it carefully and it matches". It is: the star will look different, and
`BLOOM_THRESHOLD`, `BLOOM_STRENGTH` and `EXPOSURE` — plus their four `COLLAPSE_*` counterparts —
would need re-grading by eye, on the hero *and* through the collapse.

**When it would be worth it.** Only if step 0 confirms the star is genuinely 9–22 ms, step 5 finds
§2.1–2.2 insufficient, **and** you want to re-grade the star anyway. Otherwise 8 points is not worth
re-authoring the centrepiece.

⚠ If it is ever built: the header's objection about alpha does *not* apply (that is `OutputPass`
forcing alpha to 1; a hand-written quad emitting `scene.a` reproduces today's alpha exactly), the
sRGB encode has to be done by hand alongside ACES (`outputColorSpace` is gated the same way), and
`COLLAPSE_EXPOSURE` becomes a uniform instead of `renderer.toneMappingExposure`.

---

## 7 · The test protocol — what steps 0 and 5 actually are

Steps 1–4 are built and neither `tsc` nor `next build` complains, but **nothing here has been seen
running.** This section is the whole of what is left before step 7 can be decided, and it is the
user's own question — *does the site budget correctly, per section, on real hardware?*

### 7a · Getting an honest console

Telemetry is on in `development` and on Vercel **previews**. Dev is the wrong place to measure — the
file `lib/telemetryEnabled.ts` lists four reasons, of which unminified chunks and StrictMode's double
mount are the two that would bend these numbers most. The honest **local** build:

```powershell
$env:NEXT_PUBLIC_VOIDIX_TELEMETRY = "1"
npm run build
npm start                     # http://localhost:3000
```

That is a real production build with real headers, telemetry forced on. Unset the variable afterwards.
`[frame]` prints a breakdown **every 3 s**; it now carries a `section` gauge, so a report is
attributable to where the page actually is.

### 7b · The reading sheet — four stations, one machine

Sit still at each. The bar takes a moment to settle after a scroll; read the **second** report.

```
  station        what to be looking at                        the number that matters
  ─────────      ─────────────────────────────────────        ──────────────────────
  1  hero        the star, at rest, nothing else drawing      sun · bloom   ← the premise
  2  fleet       any craft, at rest                           deck spans + sun · bloom
  3  works       any project, at rest, no drag                works · space + sun · bloom
  4  chamber     standing in the room, FAQ panel up           works · space  ← §2.3's whole case
```

| | hero | fleet | works | chamber |
|---|---|---|---|---|
| `fps` (headline) | | | | |
| `sun · bloom` ms / calls | | | | |
| `works · space` ms / calls | — | — | | |
| `works · screen` ms / calls | — | — | | |
| `unaccounted` ms | | | | |
| `ratio` · `fps(ctrl)` | | | | |
| **`sun stride`** | must be **1** | 2 | 2 | (frozen) |
| **`space stride`** | — | — | must be **1** | **3** |

The two bold rows are the *only* new instruments and they are the fastest way to know the change is
live at all. **If `sun stride` reads 2 on the hero, the black-stage gate is inverted somewhere** — that
is the one thing in this build that would be wrong in a way the eye might not catch.

Expected, if the premise holds:

```
   sun · bloom        hero  ████████████████   unchanged — full rate is deliberate here
                     fleet  ████████           half, from the stride
                     works  ████████           half
   works · space     works  ████████████████   unchanged
                   chamber  █████              a third of its calls
```

### 7c · The regressions to hunt, in the order they would be missed

Each is a live item from §5. The point of listing them here is that **four of the five are invisible
unless you go looking for them.**

| # | do this | pass looks like | §5 |
|---|---|---|---|
| 1 | Complete a full lap via **Travel in time**, land back on the hero, watch Core Stability | it is *moving* | 7 |
| 2 | Sit in the chamber **30 s** with the console open | no `EMERGENCY RAISE`, no `EARNED EXTRA QUALITY` | 8 |
| 3 | Scrub **backwards** out of the room, slowly, then fast | the picture returns clean, no stale-camera frame | 5 |
| 4 | Stop mid-crack in the handoff; reload at that exact scroll position; compare | identical pose | 15 |
| 5 | Scroll the handoff slowly, watch the **halo** rather than the body | glow tracks the collapse, does not lag it | 16, 6 |
| 6 | Profile the whole lap | no `[pixels]` line after the burn-in | 1 |

⚠ **Test 4 is the one that would ship.** A stride-skipped frame that consumed `wasAnimating` leaves
the star 16 ms short of its settled pose — which does not read as a bug, it reads as the animation
"not quite landing". The fix is in, this is the check that it works.

### 7d · Does the per-device calculation hold? — the second question

This is the half of the brief that is not about the star at all. The chain is
`deviceTier` → `gpuProbe` → **burn-in** → `adaptivePixelRatio`, and it is decided **once, in the
loader**, then held. What to confirm on each machine:

```
   LOADER                                        REST OF SESSION
   ──────                                        ───────────────
   deviceTier   latched once, never re-asked  →  allocations (composers, samples)
   gpuProbe     one drained frame             →  the CEILING only
   burn-in      real pipelined frames         →  the START ratio + the MSAA licence
                                                 └─ then the live controller, on real frame times
```

| check | how | why it matters |
|---|---|---|
| the ratio **settles and stays** | `ratio` gauge identical across all four stations | a ratio that moves mid-session is a 150–400 ms reallocation each time |
| it **climbs**, never claws back | first `ratio` after the burn-in ≤ every later one | `adaptivePixelRatio`'s header: guessing upward and clawing back allocates the expensive configuration on the machine that could not afford it |
| `fps(ctrl)` **tracks** the `[frame]` headline | compare the two on the same report | they diverged once already, and the controller acted on the wrong one |
| the tier is **plausible** | `deviceTier`'s answer vs. what the machine is | it never measures — it is a guess made before anything can be measured |

⚠ **Run this on more than one machine and expect the numbers to differ — that is the system working.**
What must NOT differ is the *shape*: same order of sections by cost, ratio settling early and staying,
no emergency moves. A machine where the ratio oscillates is a finding, not a slow machine.

⚠ **A 4K laptop at 250 % scaling is the case worth having.** It is the one `MAX_DRAWING_BUFFER_MEGAPIXELS`
exists for — `hardwareCeil` rises with `devicePixelRatio`, which is backwards, and that machine was
handed 5.26 Mpx and ran at 20 fps. If one is to hand, station 3 on it is the single most informative
reading in this document.

### 7e · The twenty-minute experiment that could change step 7

**Hypothesis:** the star's cost is not its pixels — it is that it is a **second WebGL context**, and a
per-frame context switch costs real driver time *independent of resolution*.

**Test:** hold `ratio` fixed and halve the sun canvas (`.hero-sun-card`'s `clamp()` in `globals.css`,
or `SUN_CANVAS_HEADROOM`). Re-read `sun · bloom` at station 3.

```
   cost falls ~4×   →  it is FILL. §2.5's model holds; expect ratio ~1.4–1.6.
   cost barely moves →  it is the SWITCH. Raising the star's resolution is nearly free,
                        and step 7 should take far more than the model predicts.
```

Revert the canvas size afterwards — it is a probe, not a change. ⚠ `SUN_CANVAS_HEADROOM` is shared
with `CAMERA_FIT_MARGIN`; change one and the star renders a different size, which is fine for a
measurement and wrong for anything else.

---

## 8 · The allocator — what §0 actually asked for

> **Added 2026-08-07**, after steps 1–4 shipped and §7's measurement came back. This is the brief in
> §0 read literally, and it supersedes the mechanism §3 dropped without reopening the ruling §3 made.

### 8a · What the brief turned out to mean

§0 was read as *"cap the ships at 1080 and give the remainder to the sun"*, and §3 dropped that
because §2.1–2.3 could fund the star without making anything softer. The clarification:

> *"Not fixed values. If the device can handle more, the sun can get the highest. I'm at the services
> section, the ship is on high and there is still more to give and performance is great — then I give
> the rest to the sun. As much quality as I can with as much smooth as I can (30 fps), with a priority
> on models."*

**1080 was never the point; it was an example of a mechanism.** The ask is a *greedy allocator*: the
section's models take what they can afford, and whatever the frame has left over goes to the star. On
a strong machine the models hit their own ceiling early and the star ends up with a large share; on a
weak one the models take nearly all of it and the star sits near its floor. No number is fixed
anywhere.

### 8b · Why this needs a measurement nothing on the site could take

The split between the star and the scene behind it was *"decided by their canvas areas and nothing
else"* (§1a). To budget it you need the star's **cost**, and no span can see it: WebGL is
asynchronous, so timing around `bloom.render` measures submission, and `unaccounted` — GPU execution —
is 70–95 % of every frame on this site. Both subjects live inside that number.

The only instrument that can separate them is a **difference between two sets of drawing things**. So
the loader's burn-in now runs two phases:

```
   phase A     field draws, star dark      →  field + fixed cost
   phase B     field draws, star lit       →  field + star + fixed cost
                              B − A        →  THE STAR, measured
```

That is why `SUN_DRAW_PERMIT_EVENT` had to exist: the star used to be permitted by `BURN_IN_EVENT`
itself, so there was no window in which the field drew alone.

### 8c · The solve

Cost is the square of the ratio, so a pipeline measured at `c` ms while drawn at `r` costs
`c × (r'/r)²` anywhere else. Budget is `1000/30` less the 10 % safety fraction — **30.0 ms**. Then, in
priority order:

```
   1 · reserve the star's FLOOR        the centrepiece is never starved to nothing
   2 · models take the rest            up to their OWN ceiling, never past it
   3 · star takes what remains         up to its own ceiling
```

**Step 2 capping at the ceiling is what makes step 3 mean anything.** A machine strong enough to run
the field at full density has real budget left, and all of it goes to the star — which is the brief's
*"if the device can handle more, the sun can get the highest"*, as an outcome of measurement rather
than as a constant.

### 8d · Two deliberate conservatisms, both in the same direction

- `fieldMilliseconds` carries the **fixed** cost (compositor, blend layers, DOM) as well as the
  field's, and scaling the whole thing by `(r'/r)²` over-charges the field for pixels the fixed part
  never spends.
- The star is measured at **full rate**, but through services and works it draws at `SUN_IDLE_STRIDE`
  — every other frame — so it really spends half of what it is budgeted.

Both land the allocation under budget rather than over, which is the correct direction for a number
that is applied once. The star's 2× margin is also what makes the **hero** safe without a separate
measurement: there it draws at full rate, but the field is not drawing at all, so the whole of
`fieldSpent` is free.

### 8e · What else had to change

| | |
|---|---|
| **`PRIORITY_TARGET_FPS` 50 → 30** | Every solve on the site aimed at a 20 ms frame. Against 33.3 ms that is √(33.3÷20) = **1.29× the ratio, 1.67× the pixels**, on every machine with room above the floor. Largest single quality change in the file, and it is one number. |
| **The burn-in stopped refusing** | Measured: `0 usable frames in 2545 ms`, and on another load `0 in 15786 ms`. Not a sampler bug — the loader had 15 long tasks totalling 4.7 s running through it, so frames were 850 ms. Now: wait for the main thread to go quiet, then reject *individual* insane frames instead of abandoning the reading. It is the sole source of truth for both ratios now, so it could not stay optional. |
| **§2.6's `driftActive` split** | Shipped as part of this, because it had to be. `applySize` is blocked while `choreographyActive`, and `assembling` was true for the whole loader wait — so the star had no clear frame to apply a new ratio on, and any allocation would have landed as a sharpness pop on the centrepiece. |

### 8f · Not in this either

| dropped | why |
|---|---|
| **A deck burn-in** | The fleet would get its own ratio instead of inheriting the field's. Costs a third loader phase, and buys nothing for the *star*: the star's one ratio is set by whichever section binds hardest, which is always works (heavier). So the deck inheriting works is safe, and only the deck's own sharpness is left on the table. The obvious next step. |
| **Per-section star ratio** | Still rejected, still for §3's reason — a reallocation at a section boundary. The allocator solves the star against the section where it competes hardest and holds one number. |
| **Timer queries** (`EXT_disjoint_timer_query_webgl2`) | Would measure both subjects directly and make the two-phase dance unnecessary. Missing on plenty of drivers, so it cannot be the shipping path — but as a *diagnostic* it would confirm this whole model in one reading. |

### 8g · What to read on the console

```
[pixels] ALLOCATED a 30.0 ms frame (30 fps, less 10% safety), models first.
  measured   field 12.4 ms @ 1.15  ·  star 6.1 ms @ 1.15 (33% of the frame)
  1 · reserved the star's floor          6.1 ms
  2 · models  1.15 → 1.44  spending 19.5 ms, bound by the measurement
  3 · star    1.15 → 1.71  from the 10.5 ms left (35% of the budget), bound by the measurement
```

Then per section, on the `[frame]` gauge line: **`ratio`** (the field's) and **`sun ratio`** (the
star's). Those two numbers together are the entire output of this system.

⚠ If `[pixels] split REFUSED` appears instead, the two phases did not separate credibly and everything
falls back to one number for the whole frame — exactly the behaviour before this section existed. The
line says which of the three credibility checks failed.

---

## 9 · ⚠ The allocator measures the wrong star

> **Found 2026-08-08** by reading §8's code, not by measuring it. The architecture is sound; one input
> to it is wrong. That is the better failure to have — the fix is upstream of the solver and the solver
> does not change.

### 9a · The finding

`beginBurnIn` fires after warm-up; `SUN_ASSEMBLE_EVENT` fires later, in the finale timeline
(`IntroSequence.tsx:985`). So through **both** phases the star sits in the drift branch at
`assembly = 0` — and `SunModelCanvas.tsx:1150` has already run `positionShards(0, 0)` at model-land:

```ts
coronaGrowth = smoothstep(arrival = 0, CORONA_APPEAR = 0.55, 1) = 0
coronaParts.forEach(part => part.visible = false)
```

`coronaParts` is, in that file's own words (`SunModelCanvas.tsx:214`), *"the core sphere, the outer
glow, the flares and the twenty corona planes."*

```
   what §8b thinks it is measuring          what phase B actually draws
   ────────────────────────────────         ───────────────────────────
   ● core sphere                            ○  hidden
   ● outer glow                             ○  hidden
   ● flares                                 ○  hidden
   ● 20 additive corona planes  ◄── the     ○  hidden
   ● sunParticles rings             cost    ○  ringForm 0, collapsed to the knot
   ● 10 shards                              ●  10 shards, several off the frame edge
```

And the corona is not incidental to the star's cost — §1c blames exactly those twenty overlapping
additive planes for a 0.28 Mpx canvas reaching 9–22 ms. **The overdraw is the corona, and the corona is
invisible when the measurement is taken.**

### 9b · Why all three credibility checks pass anyway

`MIN_CREDIBLE_STAR_MS` (0.6) exists for the *noise* version of this — its own comment says a too-small
difference *"would divide by very nearly nothing and hand the star its ceiling."* A shard-only star
measuring ~1.5 ms clears it comfortably, and the conclusion is wrong regardless. Every check asks **is
this a real difference?**; none can ask **is this the star we are budgeting for?**

### 9c · The honest severity — less than it first looks

Worked on §8g's own example (field 12.4 ms @ 1.15, real star 6.1 ms, measured 1.5 ms, dpr 2.5):

```
   believed         star solves 3.21 → clamped to ceiling 2.00, budgeted 4.5 ms
   actual           6.1 × (2.00/1.15)² = 18.5 ms   ← 4× its allocation
   at SUN_IDLE_STRIDE                     9.2 ms   ← 2× its allocation
   frame            18.9 + 9.2 = 28.1 ms against a 33.3 budget   ← SURVIVES
```

The bias is ~2× after the square root; the stride is a 2× margin; they very nearly cancel. **So this
does not blow the frame — it eats the margins.** Both of §8d's conservatisms are consumed by the error
instead of doing the jobs they were reserved for, including the one meant to absorb the chamber, which
is measured with SMAA off and never re-checked with the room in frame.

### 9d · What shipped now — a bound, not a fix

| | |
|---|---|
| `STAR_RAISE_OVER_MODELS = 1.35` | The star may be sharper than the section's models, never unboundedly. Justified twice over: `starSolved` is an upper bound, and past ~1.35× density a star composited over softer marks reads as **pasted on** rather than sharper. |
| `sunCeiling()` capped at **native** | It omitted `deviceRatio`, which the field's `ceil` includes — so on a **1× panel** the star could be allocated 1.5 while the field was held to 1.0. Supersampling, on the machines least able to afford it, in exactly the regime the bias escapes into. A probe-gated exception was tried and rejected: the probe has an eightfold spread across loads, and a binary gate on it supersamples on some loads and not others. |
| the `ALLOCATED` log | Now names the cap as a third binding constraint, prints what the star *wanted*, and states that its measurement is a lower bound with the comparison to make. |

⚠ The cap changes almost nothing on dpr 2–2.5 (the field's own ceiling is already close). It bites on
1× panels. That is intentional and it is where the arithmetic says the escape is.

### 9e · Still open — measuring the star in its real state

Ranked. **Take a reading first** — `ALLOCATED`'s `star X ms` against `sun · bloom` per call on the hero
at the same ratio. The quotient is the bias, and it decides whether this is worth doing at all.

| | | |
|---|---|---|
| **A** | **Measure the star off-screen.** A short star-only burn-in during the warm-up, corona forced visible, rendered into a target rather than the canvas — nothing reaches the screen, so the loader's finale is untouched and the star is measured as it really is. | needs a render-to-target variant of `bloom.render`; the only option that keeps §8's "solved once, behind the veil" claim true |
| **B** | Measure on the hero, apply once, early. Cheaper than §2.6 feared: the star's targets are ~9 MB, and `ringForm` is 0 on the hero so `sunParticles`' grain-size change is **hidden**, which was that section's main objection. | one reallocation after `REVEAL_EVENT` |
| **C** | Move phase B into the post-assembly hold. | lengthens the finale and makes the field draw through it — worst of the three |

### 9f · Two unrelated things this pass raised

- **The burn-in helps least where it is needed most.** `BURN_IN_PHASE_MAX_MS` 600 with
  `BURN_IN_MIN_SAMPLES` 5 and 3 discarded needs ~8 frames in 600 ms, so **below ~15 fps in the loader
  phase B returns null** — and the early return skips `reportBurnIn` too. The slowest machines get no
  burn-in *and* no allocator, falling back to the runtime calibration and its two mid-session
  reallocations. Splitting one phase into two roughly doubled the frames required.
- **`renderClock` was reverted while its target was kept.** `PRIORITY_TARGET_FPS` is still 30, but
  nothing caps delivery any more — so the cross-section variance the clock was written to remove (hero
  42 · fleet 35 · works 32 · chamber 43 · contact 49) is still there, and sizing one resolution for the
  heaviest section does not remove it. Worth knowing why it went before it is written off.
