# Voidix — Edits Backlog

> **Living list.** Each entry is a planned edit: the problem, the clean target behavior, the
> approach (no "cover-up" hacks), the files involved, and what must be preserved. Every edit is
> implemented one at a time and validated against [`BASELINE.md`](./BASELINE.md) — nothing
> outside an edit's stated scope should change.
>
> **Started:** 2026-06-25 · **Status legend:** `planned` · `in-progress` · `done`

---

## Edit 1 — Hero → Services transition (unified single pin)

**Status:** `implemented` — typecheck + `next build` pass; **awaiting visual review**.

### What shipped (steps)
1. ✅ Extracted `DECK_REVEAL_EVENT` into `components/sections/ServicesDeck/deckEvents.ts`;
   `useServicesDeck` now imports it from there.
2. ✅ Rewrote `lib/hooks/useHeroAnimation.ts` as the **single pin**: phase-1 square fill +
   sun rise (scrub), reveal the fleet at fill = 1 (fires `DECK_REVEAL_EVENT`), phase-2
   carousel (snap). Returns `goTo`. Progress is remapped onto `[fillFraction … 1]` for the
   carousel; snap is a function (free scrub in the fill, snap to craft after).
3. ✅ `ServicesDeck` is now presentational (`activeIndex`, `goTo` props); the old per-section
   pin is gone.
4. ✅ `Hero` owns the craft state and renders `<ServicesDeck>` as an overlay inside
   `.hero-section`; `app/page.tsx` no longer renders the deck separately.
5. ✅ CSS: `.services-deck` is now `position:absolute; inset:0; z-index:25; opacity:0`
   (no `margin-top:-100vh`); `.deck-backdrop` / `.deck-canvas-wrap` no longer self-hide.
6. ✅ Deleted the now-unused `hooks/useDeckCarousel.ts`.

### Problem
The hero→services handoff is **two independent pinned ScrollTriggers** glued by a magic
number:
- `useHeroAnimation` pins the hero `+=220%` and scrubs the black square to full screen.
- `useDeckCarousel` is a *separate* pin on `.services-deck` that reveals the fleet and snaps
  through the craft.

They're stitched with `app/globals.css` → `.services-deck { margin-top: -100vh }` plus an
opacity backdrop. That `-100vh` is hand-tuned to cancel the hero's leftover 100vh of
post-unpin height (its own comment says to re-tune it if hero height or pin distance changes).
Original symptom before the cover-up: after the square filled, ~100vh of dead black scroll
before the deck pin engaged — the "empty section, then scroll again."

### Target behavior
One continuous pinned sequence:

```
scroll ─▶ square scrubs to full black ─▶ at 100% fill: fleet materializes ─▶ carousel snaps through craft
          (phase 1, scrubbed)             (reveal fires here, no gap)        (phase 2, snapped)
```

The shared sun **stays visible into services and rises a little**. No magic margin, no empty
beat, nothing coupled to the hero's exact height.

### Clean approach
- Collapse the handoff into a **single pinned region** owning three phases of one scroll:
  scrubbed square-fill → reveal-at-fill → snapped carousel.
- **Pin owner (decided):** the **hero section** owns the single pin, and the deck is rendered
  as an **overlay inside `.hero-section`** (`position:absolute; inset:0`), hidden until the
  fill completes. This keeps the square (which lives in the hero) growing on screen during the
  fill, and means the deck inherits the hero's stacking context for free — no wrapper, no
  curtain hand-off, no margin.
- Move the square-fill out of `useHeroAnimation`'s separate pin so there is only one pin
  across the handoff.
- **Delete** `margin-top: -100vh` and the opacity-backdrop cover-up; the deck sits in normal
  flow right after the hero.
- Fire the fleet reveal (`DECK_REVEAL_EVENT` / stage fade-in) exactly at fill = 1.
- Sun: keep its rise (reuse the `SUN_SCROLL_RISE` / `SUN_SCROLL_SCALE` intent) and let it
  persist over the fleet instead of fading.
- Mixed scrub + snap handled by a `snap` function returning the nearest of
  `[fillComplete, craft0…craftN]` so the fill scrubs freely and the carousel snaps.

### Files
`lib/hooks/useHeroAnimation.ts`, `components/sections/ServicesDeck/hooks/useDeckCarousel.ts`,
`app/globals.css` (`.services-deck`, `.deck-backdrop`), possibly
`components/sections/ServicesDeck/ServicesDeck.tsx`.

### Preserve (BASELINE contracts)
Build the pin only on `REVEAL_EVENT` (never during intro); keep feeding `--nav-progress-home`;
keep `DECK_REVEAL_EVENT` semantics so `useServicesDeck` still replays the craft entrance;
reduced-motion still resolves to end states.

### Side effects (+ how they were handled)
1. ✅ **Pin owner** — decided: hero section owns the pin, deck is an overlay inside it (above).
2. ✅ **Progress → craft remap.** Done via `fillFraction`: `onUpdate` maps craft from
   `(progress − fillFraction)/(1 − fillFraction)`; snap is `snapProgress()` (identity in the
   fill range, snap-to-craft after); `goTo` targets `fillFraction + (i/steps)*(1 − fillFraction)`.
3. ✅ **`--nav-progress-home`.** Now set to `min(progress / fillFraction, 1)` — the logo meter
   tracks the fill, then reads full through the carousel.
4. ✅ **`.deck-backdrop`.** The whole `.services-deck` overlay fades in at fill = 1 (autoAlpha);
   backdrop/canvas are opaque underneath. The square is already full black, the deck backdrop
   is `var(--bg)` — both near-black, so the cross-fade has no flash.
5. ✅ **Downstream scroll.** `-100vh` gone and the deck no longer adds its own section height
   (it's absolute inside the hero); scroll length now comes solely from the hero pin's `end`.
6. ✅ **`DECK_REVEAL_EVENT` timing.** Fired from `revealDeck()` exactly at fill = 1 (and
   un-/re-fired on scroll back up/down), so `useServicesDeck` replays the entrance in step.

### ⚠ Known rough edges to confirm in visual review (likely fine, flagged honestly)
- **Sun rise is still `200px`** (`SUN_SCROLL_RISE`) — fine on desktop, too large on phones;
  it becomes viewport-relative in Edit 2a. The sun stays over the fleet and rises a little,
  as requested.
- **FluidCursor keeps running behind the deck** while the hero is pinned (it's hidden under the
  overlay). Harmless but slightly wasteful; can gate it on `deckRevealed` later if needed.
- **Fill feel:** `FILL_SCROLL_VH = 120` / `CRAFT_SCROLL_VH = 100` are first-pass values — tune
  to taste after seeing it.
- **No section after the deck yet** — after the carousel the pin releases into page end; when
  `work`/`process` land they go after `<Hero>` in `page.tsx`.

---

## Edit 2 — Responsiveness + Adaptation

**Status:** `implemented` — typecheck + `next build` pass; **awaiting visual review across
breakpoints**. Done in the planned order: 2b (resize-safety) first, then 2a (fluid units).

### What shipped (steps)
- ✅ New `lib/measureUntransformedRect.ts` — strips an element's transform before measuring
  (the discipline `HeroSun` was missing).
- ✅ **2b** `useHeroAnimation`: fill geometry is now function-based + `invalidateOnRefresh`,
  recomputed on every resize via `onRefreshInit`; added
  `ScrollTrigger.config({ ignoreMobileResize: true })` so a mobile address bar doesn't thrash
  the pin.
- ✅ **2b** `HeroSun.syncToSquare` now measures the square's **untransformed** footprint, so
  resizing mid-scroll no longer balloons or displaces the sun.
- ✅ **2b (refinement after review)** the untransformed measure wasn't enough — the base box and
  the pin transform still skidded *during* a live resize (different update cadences). Now
  `HeroSun` **hides the sun the instant a resize starts, debounces (`RESIZE_SETTLE_MS = 180`),
  then `ScrollTrigger.refresh()` + re-syncs + fades it back in** (`RESIZE_FADE_SECONDS = 0.35`)
  at the correct spot. Height-only resizes on touch (address bar) are ignored so it doesn't
  blink on phone scroll.
- ✅ **2a** `app/globals.css`: added a fluid type scale (`--fs-micro … --fs-mark`), converted
  every fixed `px` to `rem`/`clamp()`/`vw`, made `.hero-sun-card` fluid
  (`clamp(7rem, 20vw, 11rem)`), switched the two breakpoints to `em`. Only 1px/1.5px hairline
  borders (+ the `0 0 0 1px` ring and corner-bracket offsets tied to them) remain in `px`.

Confirmed scope: fluid units (`rem` + `clamp()`/`vw`), 1px hairline borders kept as the one px
exception; target range phones (~360px) → large desktop (1440px+); carousel drag works on
touch.

### 2a · Responsiveness (no fixed px)

**Problem.** `app/globals.css` has ~113 px occurrences (navbar height 72px, sun square 175px,
orbital mark 26px, body 14px, fixed nav/eyebrow/number/tag font sizes, gaps, paddings, loading
rings). Layout doesn't fluidly adapt; type is fixed at several sizes.

**Target.** Whole site fluid from ~360px to 1440px+; type scales with the viewport;
sizing/spacing in `rem`/`clamp()`/`vw`. 1px hairlines are the only px kept.

**Clean approach.**
- Define a small **fluid type + spacing scale** as CSS custom properties
  (`clamp(min, preferred-vw, max)`); convert fixed `font-size` px → those tokens; convert
  fixed spacing/size px → `rem` (and `clamp()`/`vw` where it should breathe). Keep
  `letter-spacing` in `em`.
- Sun square (`.hero-sun-card`, 175px, also the JS measurement anchor) → fluid `clamp()`; JS
  keeps measuring it, so no hardcoded constant.
- Audit the existing `@media (max-width: 820px)` blocks; fold most into fluid values, keep
  hard breakpoints only where layout must restructure (row→column).

**Files.** Primarily `app/globals.css`; `tailwind.config.ts` (fluid scale tokens if used via
classes); spot-check inline px in `HeroSun.tsx` (initial `175`) and `IntroSequence.tsx`.

### 2b · Adaptation (resize-safe sun & models, every scroll state)

**Problem.** On resize the sun balloons ("I'm inside it") or jumps out of the square, and is
only correct when fully scrolled. Two root causes:
1. `HeroSun.syncToSquare` reads `square.getBoundingClientRect()` — which **includes the live
   scroll transform** — so resizing mid-scroll measures the *expanded* square and sizes the sun
   to it. (`useHeroAnimation.measureCardLayout` already strips the transform before measuring;
   `HeroSun` doesn't follow that discipline.)
2. `useHeroAnimation`'s scroll-expansion bakes one-time pixel translate/scale values with no
   `invalidateOnRefresh`, so on resize the square fill and the sun transform desync.

**Target.** Resizing at any scroll position keeps the sun correctly sized and locked to the
square; all WebGL scenes re-fit cleanly. No "only correct when fully scrolled" cover-up.

**Clean approach.**
- Scroll-expansion uses **GSAP function-based start/end values + `invalidateOnRefresh: true`**
  so `ScrollTrigger.refresh()` (auto on resize) recomputes translate/scale from fresh,
  **untransformed** geometry — correct at any progress.
- **Single source of truth** for the square footprint (the transform-stripped
  `measureCardLayout` pattern); the sun layer derives its base layout from the same
  untransformed measurement; the scroll timeline alone owns the sun's transform.
  `HeroSun.syncToSquare` must never read a transformed rect.
- Verify each Three.js `ResizeObserver` (SunCanvas, useServicesDeck, useFleetViewer) re-fits
  camera aspect + renderer size with DPR clamp — the WebGL sizing is already fine; the breakage
  is the DOM coupling above.

**Files.** `components/sections/Hero/HeroSun.tsx`, `lib/hooks/useHeroAnimation.ts`; verify
`SunCanvas.tsx`, `ServicesDeck/hooks/useServicesDeck.ts`, `ServicesFleet/hooks/useFleetViewer.ts`.

### Preserve (BASELINE contracts)
Single-shared-sun contract; the `.hero-sun-layer` (base + scroll transform) vs
`.hero-sun-flight` (intro's o→square flight) ownership split; reduced-motion paths.

### Side effects (+ how they were handled)
- ✅ **Fluid sun square ↔ intro `parkSunInO`.** It measures the `o` glyph and the square rect
   live, so a fluid square is fine — but **confirm the intro flight still lands centered** on a
   phone-width screen in visual review (low risk, measured live).
- ✅ **Resize re-runs triggers.** There's now a single pin (Edit 1), and `ignoreMobileResize`
   plus `invalidateOnRefresh` keep it from jumping; the nav meters re-measure on `resize`
   already. Confirm no visible jump on desktop resize.
- ✅ **Root font size left untouched.** Used per-token `clamp()` + `rem`; `html` font-size is
   the browser default, so existing rems didn't cascade-shift.
- ⚠ **Touch story (open).** Carousel drag already uses pointer events (works on touch). The
   fluid cursor still binds `touchmove` and is decorative; decide later whether to disable it on
   coarse pointers / small screens. Not blocking.

### ⚠ Not converted on purpose
- `IntroSequence.tsx` inline styles (already mostly `clamp()`/`vw`/`em`; a couple of small `px`
   nudges remain) and `HeroSun.tsx`'s initial inline `175` fallback (immediately overwritten by
   `syncToSquare`, and invisible at `opacity:0`). Flag if you want these fully purged too.

> **Sequencing:** Edit 1 and Edit 2b both touch `useHeroAnimation` + `HeroSun`. Do Edit 1
> first (it restructures the pin), then 2b (resize-safety) on top of the new single-pin
> geometry, then 2a (pure CSS units) last so it's measured against final layout.

---

## Edit 3 — Services sun (big + rapid) and section layering

**Status:** `implemented` — typecheck + `next build` pass; **awaiting visual review**.
Scoped to the services section only (an `is-services` class on `.hero-section`, toggled exactly
on fleet reveal/hide) — the intro and the square-fill phase are untouched. Prep for turning the
sun into a black hole later.

### Requirements
1. In services the sun becomes **big and rapid** — faster churn/spin, sudden speed surges that
   ramp up "out of nowhere" and ease back, and stronger flares (explosions).
2. **Text z-index above the sun** (services only).
3. **Spaceship + landing pad above the sun, below the text** (services only).

### Clean approach
- New event `DECK_HIDE_EVENT` (in `deckEvents.ts`) pairs with `DECK_REVEAL_EVENT`.
  `useHeroAnimation` fires them and toggles `is-services` on the hero in `revealDeck`/`hideDeck`.
- **Layering (2 & 3):** on services-enter, `HeroSun` drops the sun's z-index **behind the hero**
  (`Z_SERVICES = -1`); CSS `.is-services` makes the layers between the fleet and the sun
  transparent (hero bg, `.hero-sun-fill`, `.deck-backdrop`) so the sun reads as the big
  background with ships (deck canvas) and labels (deck overlay) painting in front. Reverts on
  leave. So order becomes **text > ships/pad > sun**.
- **Big (1):** `HeroSun` scales `.hero-sun-flight` to `SERVICES_SUN_SCALE = 3.2` on enter, back
  to 1 on leave (the intro owns the flight earlier, but it's idle by services, so no conflict).
- **Rapid + explosions (1):** `SunCanvas` ramps a `uIntensity` uniform 0→1 on the same events.
  The render loop drives an accelerated `flowTime` with a base speed-up (`RAPID_BASE_SPEEDUP`)
  plus random decaying **bursts** (`BURST_SPEEDUP`, every `BURST_INTERVAL_MIN/MAX_S`) for the
  "sudden surge" feel; `uIntensity` boosts flares + contrast in `sunShaders.ts`. At intensity 0
  the multiplier is exactly 1, so the hero/intro sun is unchanged.

### Files
`components/sections/ServicesDeck/deckEvents.ts`, `lib/hooks/useHeroAnimation.ts`,
`app/globals.css`, `components/sections/Hero/HeroSun.tsx`,
`components/sections/Hero/SunCanvas.tsx`, `components/sections/Hero/sunShaders.ts`.

### Tuning knobs
`SERVICES_SUN_SCALE`, `SERVICES_SUN_RAMP_SECONDS` (HeroSun); `RAPID_BASE_SPEEDUP`,
`BURST_SPEEDUP`, `BURST_DECAY`, `BURST_INTERVAL_MIN/MAX_S`, `INTENSITY_LERP` (SunCanvas);
`SERVICES_FLARE_BOOST`, `SERVICES_CONTRAST_BOOST` (sunShaders); the `0.5s` transparency
transitions (globals.css).

### ⚠ Flags for review
- "Big" is a **CSS scale** on the flight, so the (small) WebGL canvas is upscaled — the plasma
  is soft so it should read fine, but if it looks blurry at 3.2× I'll switch to a bigger canvas
  / camera zoom so it stays crisp.
- Confirm the transition from "full-black fill" into "sun-as-background" reads cleanly (both are
  near-black, so it should be seamless) and that the sun sits behind the ships as intended.

### Refinements (post-review)
- ✅ **Sun motion rhythm.** Replaced the constant fast churn + random bursts (looked bad) with a
  rhythm: **calm for `SUN_IDLE_SECONDS = 10`, then a fast spin for `SUN_SPIN_SECONDS = 2`**,
  repeating (trapezoid ease via `SUN_SPIN_RAMP_SECONDS`). During idle the multiplier is 1 (same
  calm motion as the hero); the surge only happens in the spin window.
- ✅ **Large canvas (sharp, not upscaled).** On services-enter `SunCanvas` bumps its backing
  resolution (`SERVICES_RENDER_SCALE = 3.5`, via `setPixelRatio`), so the enlarged sun renders
  crisp. `HeroSun` still does the smooth CSS-scale swell; the render-scale stays ≥ that factor.
- ✅ **Label-click over-scroll fixed.** Clicking a craft used to scroll to the exact fill/reveal
  edge and read as hiding the section. Craft now live in `[carouselStart, 1]` with `carouselStart`
  a touch past the fill (`CAROUSEL_SETTLE_FRACTION = 0.08`), so jumping to craft 0 lands on the
  fully-revealed fleet. `goTo`, snap, and index mapping all share that range.
- ✅ **Cursor trail is hero-only.** `useFluidCursor` stops splatting on `DECK_REVEAL_EVENT` and
  resumes on `DECK_HIDE_EVENT`, so no trail is laid over services and the existing one dissipates.
- ✅ **"we build worlds" + tagline are hero-only.** `.hero-section.is-services .hero-mask,
  .hero-sub` fade to 0 so they don't bleed through the transparent fleet layers (the square isn't
  a `.hero-mask`, so it stays as the sun's backdrop).
