# Mobile polish — plan

> Branch: `feat/polish-and-cms`. This doc is the **polish** half; the CMS conversion gets its own
> plan and shares nothing with this beyond the branch.
>
> One section per reported defect. §1 is the one raised on 2026-08-12 (the browser chrome eating the
> first gesture on the hero) and is fully worked; §2 onward are stubs waiting on the rest of the list.

---

## §1 · The browser chrome eats the first gesture on the hero

### 1a · What was reported

> *"When I've just arrived at the website and try to scroll a little, it starts with the Safari bar
> underneath — the one with the link and some other things. It scrolls there, and when that's
> finished it starts to scroll in the hero."*

Reproduced by reading the code, not by testing (no iOS device here — see §1g). The description
matches three defects that stack on top of each other and read as one.

```
   FIRST SWIPE UP ON THE HERO — iOS Safari today
   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
   │ ▓▓ address ▓ │     │ ▓ address ▓  │     │ ─ address ─  │  ← chrome collapses
   ├──────────────┤     ├──────────────┤     ├──────────────┤
   │              │     │              │     │              │
   │    cream     │     │    cream     │     │    cream     │  ← .hero-section is 100svh.
   │    hero      │     │    hero      │     │    hero      │    It is PINNED. It does not
   │      ☀       │     │      ☀       │     │      ☀       │    move, and it cannot grow.
   │              │     │              │     │              │
   ├──────────────┤     ├──────────────┤     ├──────────────┤
   │ ▓▓ toolbar ▓ │     │ ▓ toolbar ▓  │     │ ██ #060606 ██│  ← ⚠ the band the collapse
   └──────────────┘     └──────────────┘     └──────────────┘     UNCOVERS: page black
      at rest            ~0–150px of the      chrome minimised
                         gesture spent here
```

So for the first ~15 % of the gesture the only things moving are **Safari's own furniture** and a
**black band growing under the cream**. The hero itself is provably still. That is exactly the
sentence that was reported.

### 1b · Three causes, stacked

**D1 — the fill span is the one place on this site that still uses native scroll.**
`useHeroAnimation.ts:1561` `inCarouselRegion()` returns `false` below `fillFraction`, so
`carouselDirection()` returns `0`, so `handleTouchMove` (`:1613`) returns **before** its
`preventDefault`. The comment at `:109` says so outright — *"The fill phase stays free native scroll
… so the square-grow keeps its continuous scrub."* Deliberate, and correct on a desktop.

On a phone it is the whole problem: a **user-driven** scroll is the only thing that makes iOS Safari
or Android Chrome minimise their chrome. The browser takes the head of the gesture to pay for that
animation, and the page gets what is left.

Scale of it: `FILL_SCROLL_VH = 120` (`:82`), so the fill is 120 vh ≈ 936 px of scroll on a 780 px
phone. The chrome collapse is worth ~100–150 px of it.

**D2 — after the collapse, the pinned hero no longer fills the screen.**
`.hero-section` is `height: 100svh` (`globals.css:1046`) — the **small** viewport, i.e. the height
*with* the chrome showing. That is the right unit and the comment above it explains why (`dvh`
reflows mid-gesture; `vh` is the large viewport and puts bottom-pinned UI under the toolbar). But it
is a *static* unit: when the chrome minimises, the visible viewport becomes the **large** viewport
and the hero is now ~100 px short of it.

What fills the difference is `body`'s `--bg` — `#060606`. Black, under cream, on the one section
where it is impossible to miss. Everywhere else on the site the scene is already black, which is why
this has never been visible before.

`ScrollTrigger.config({ ignoreMobileResize: true })` (`:69`) means the pin never re-measures on that
resize — correct, and not the bug; re-measuring would re-pin and jitter instead.

**D3 — `SCROLL_SCRUB = 1.8` (`:81`) means the hero trails the scrollbar by up to 1.8 s.**
Not a bug, and it is what gives the whole site its weight. But it is why even the part of the
gesture that *does* reach the page produces no immediately visible answer — so D1 and D2 have 1.8
seconds of cover to hide behind before anything contradicts them.

**D4 — ⚠ THE DOMINANT ONE, and it was missed on the first pass: the square's fill tween eased IN.**
Found only after C shipped and the report came back unchanged. `ease: "power1.inOut"` on a
**scrubbed** tween is a dead zone by construction. An ease-in exists to accelerate away from rest —
but a scrub has no rest to accelerate from. The visitor's own gesture already carries the
acceleration, and all the curve does is *attenuate their input* at the exact moment they are asking
whether the page is listening.

The arithmetic, on a 390 × 780 phone (card ≈ 112 px, scaling ~7× in Y):

| through the fill | `power1.inOut` (`2t²`) | square height | `power1.out` (`1−(1−t)²`) | square height |
|---|---|---|---|---|
| 10 % | **2 %** | 112 → 124 px | **19 %** | 112 → 240 px |
| 15 % | 4.5 % | 112 → 142 px | 28 % | 112 → 297 px |
| 30 % | 18 % | 112 → 232 px | 51 % | 112 → 453 px |
| 50 % | 50 % | 112 → 446 px | 75 % | 112 → 613 px |

**Thirty pixels of growth for the first swipe-worth of scroll, arriving up to 1.8 s late.** Then
D1 eats the head of that gesture and D2 grows a black band in the same instant to give the eye
something that *is* moving. All four defects point the same way, and D4 is why fixing D2 alone
changed nothing perceptible.

The visitor's own read — *"it's related to how much you have to scroll to open the black box"* — was
right, and more precisely right than the length alone: it was the distribution, not just the span.

### 1c · The root cause is one sentence

> **The browser is allowed to change the size of its own chrome, and it is allowed to do that
> because the document is still natively scrollable at the top of the page.**

D1 and D2 are the same fact seen from two sides. Fix the fact and both go.

The lever is that **programmatic scrolling does not minimise browser chrome — only a user-driven
scroll gesture does.** Past `fillFraction` this site already scrolls itself and nothing else
(`goToStop` → `gsap.to(window, { scrollTo })`, `:918`). The fill is the last span where the browser
still has the wheel.

### 1d · Fix A — the fill becomes a committed glide on touch devices ✅ recommended

```
              0      fillFraction (≈0.092)                                   1
   progress   ├──────────┼─────────────────────────────────────────────────────┤
              │          │
   TODAY      │  NATIVE  │  intercepted — one gesture = one stop               │
              │  scroll  │  (preventDefault on wheel + touchmove)              │
              │  ▲       │
              │  └── the browser owns this, and spends it on its own chrome
              │
   PROPOSED   │ INTERCEPTED (coarse pointer only) — one swipe commits the      │
   (touch)    │ whole fill: square grows, sun rises, wave 1 lays down          │
              │                                                                │
   PROPOSED   │  NATIVE  │  unchanged — desktop has no chrome to collapse      │
   (mouse)    │  scroll  │
```

The site already has every piece of this. A crossing is *"one gesture from the last stop commits the
whole glide, with input locked so it can't be cut short"* — the fill becomes the first one.

Shape of the change, all inside `useHeroAnimation`'s effect:

1. A named capability read, taken once with the other setup:
   ```ts
   // ⚠ A THIRD question, and not either of the two the codebase already asks. `useIsLowPowerViewport`
   // asks how much work the device can do; `useIsNarrowViewport` asks how much room there is. This
   // asks whether the BROWSER MOVES ITS OWN CHROME in response to a user scroll — which is what eats
   // the first gesture on the hero, and is true on exactly the platforms with a coarse primary
   // pointer (iOS Safari, Android Chrome), desktop touchscreens included in neither.
   const browserChromeCollapsesOnScroll =
     window.matchMedia("(pointer: coarse)").matches;
   ```
2. `FILL_GLIDE_DURATION` — a new constant beside `CAROUSEL_ARRIVAL_DURATION` (`:146`). Start at
   `1.6 s`: long enough to read as the cinematic it is, short enough that the 1.8 s scrub has landed
   before the input lock lifts.
3. A `commitFillGlide()` next to `stepBy` (`:1523`). **It must not be `stepBy`** — `stepBy` targets
   `currentStop + direction`, and `currentStop` is already `0` at the hero, so `stepBy(1)` would fly
   past services 01 to services 02. It is `goToStop(0, FILL_GLIDE_DURATION)` +
   `lockStepping(FILL_GLIDE_DURATION * 1000 + FILL_SETTLE_MS)`, which is what the existing arrival
   branch already does with a shorter duration.
4. In `handleTouchMove` **only** (not `handleWheel` — a trackpad has no chrome to collapse and the
   free scrub stays): before the `carouselDirection` call, if
   `browserChromeCollapsesOnScroll && hasRevealed && trigger.progress < fillFraction && deltaY > 0`,
   `preventDefault()` unconditionally, then honour `stepLocked` / `TOUCH_STEP_THRESHOLD_PX` exactly
   as the carousel branch does, then `commitFillGlide()`.

Falls out for free, and each is worth checking off deliberately:

- **The chrome never moves.** The only scroll the document ever sees on a phone becomes
  `gsap.to(window, { scrollTo })`. D1 gone, and D2 with it — `100svh` is now permanently exactly
  the visible height, which is the assumption the CSS was written under.
- **`window.innerHeight` stops disagreeing with `100svh`.** `computeGeometry()` (`:1063`) scales the
  square by `window.innerHeight / rect.height` and is re-run only on refresh. With the chrome frozen
  the two units are the same number for the page's whole life.
- **The momentum-absorb hack becomes unreachable on mobile.** The `wasInFill` branch (`:1172`)
  exists because *"the fill is free native scroll, so the flick that carried us here is still
  delivering momentum"*. Its own `if (!committedGlide)` guard (`:1179`) already skips it when a glide
  owns the scroll. No change needed — but it is the reason this fix does not need to touch that
  branch, and that is worth knowing before reading it and worrying.
- **Backwards at the hero still spills to native**, as it does at every other end. There is nothing
  to scroll at `scrollY = 0`, and `overscroll-behavior-y: none` (`globals.css:150`) already holds
  off pull-to-refresh. Rubber-banding at the top does not minimise chrome.

⚠ **The one mechanical trap: iOS decides whether a gesture is a scroll on its FIRST `touchmove`.**
`preventDefault` on a later move is ignored for the rest of that gesture. So the `preventDefault`
above has to fire before the threshold check, not after — which is how the carousel branch already
orders it (`:1619` precedes `:1625`), and the new branch must copy that order rather than reading
more naturally.

If a real device shows the first move slipping through anyway (a `deltaY` of exactly 0 on the first
event would do it), the compositor-level guarantee is `touch-action` on `.hero-section` — but
`touch-action: none` also kills pinch-zoom, so it would have to be `pan-x pinch-zoom`, and every
drawer's scroll area would then need `touch-action: pan-y` back. **Hold that in reserve**; do not
ship it pre-emptively.

### 1e · Fix C — the band always matches whatever is covering the screen ✅ ship this first

Independent of A, and the only part of this with **no side effects at all** — it changes no scroll,
no input, no layout, and nothing on a desktop. It fixes D2 only, and D2 is the half that is *this
site's fault*: a black band growing under the cream hero is not something any other website does.
D1 on its own is the browser doing what it does everywhere.

It is also needed even if A ships. A stops the chrome collapsing *on this page*; it cannot stop it
having **already** collapsed. `/about` and `/careers` are ordinary scrolling documents, the navbar
links to them are client-side navigations, and the chrome does not re-expand on the way back. One
route change and the hero is short of the viewport again.

⚠ **Two things the obvious version gets wrong**, both found while writing this up:

1. **It must be on `body`, not `html`.** `body`'s box spans the whole document — it contains the
   pin spacer — so its `--bg` paints over an `html` background everywhere the band actually appears.
2. **It cannot be one static colour.** Toggling cream at the stage boundary is right at fill 0 and
   wrong at fill 1, where the screen should be entirely black and a 100 px cream strip under a
   nearly-full black square is a worse artefact than the black one was.

So the band tracks the fill, cream → black, from the publisher that already exists:

```ts
// The pinned hero is 100svh — a static unit, deliberately (see .hero-section). If the browser
// minimises its own chrome, the visible viewport becomes the LARGE viewport and a strip of page
// shows beneath the hero. Past the fill that strip is black under black and invisible; on the cream
// hero it is the most visible thing on screen, and it grows exactly when the chrome moves — which
// is what makes the browser's animation read as the SITE failing to respond.
//
// So the page behind the hero is always the colour of whatever is covering it: the cream at rest,
// the square's black once it has filled. Nothing else in the fill is discrete, and neither is this.
document.body.style.backgroundColor = fillProgress < 1
  ? gsap.utils.interpolate(HERO_CREAM, SQUARE_BLACK, fillProgress)
  : "";   // hand it back to the stylesheet's --bg for the rest of the journey
```

in `applyHeroServicesProgress` (`:837`), which already runs on pin updates only and already
dedupes on `transitionProgress` — so this costs one style write per *changed* update, not per frame.
`HERO_CREAM` is `.hero-section`'s `#e2dfd2`; `SQUARE_BLACK` is `.hero-sun-fill`'s `#000`
(`globals.css:1147`), not `--bg`'s `#060606` — the square is the thing actually covering the screen.

Desktop is untouched in practice: the hero covers the viewport exactly, `overscroll-behavior-y: none`
(`globals.css:150`) kills the rubber-band, so the band has nowhere to show.

### 1e2 · Fix D — the fill's curve and its length ✅ SHIPPED, second

Two dials, both inside the fill, neither touching the scroll spine:

1. **`FILL_EASE`: `power1.inOut` → `power1.out`**, on the square *and* the sun. ⚠ One named constant
   feeding both tweens, because they are anchored through the same `geometry` — two curves over one
   span is how the star comes off the square. The soft landing is kept; only the dead start goes.
2. **`FILL_SCROLL_VH` 120 → `FILL_SCROLL_VH_TOUCH` 80 on a coarse pointer.** A wheel delivers scroll
   in a continuous stream you can keep feeding; a swipe delivers one finite arc and stops. 120 vh is
   ~940 px on a 780 px phone — more than one comfortable swipe, which made the hero the one beat on
   the site that could not be got through in a single gesture. Gated on the **pointer**, not the
   width: a narrow desktop window still has a wheel and wants the long authored version.

Latched at effect setup, like `deviceTier`: every stop's progress hangs off `fillFraction`, so a
dragged window must not re-space the journey underneath the visitor.

`BAND_BLACKEN_FILL_START` (Fix C) still holds — at linear fill 0.9 the eased square is 99 % of the
way under either curve, so the band still meets the black exactly when the square closes.

### 1ef · Recommended order — C first, alone

**There is no fix for D1 with no side effects, and there cannot be.** The browser eats the gesture
*because* the document scrolls natively there; the only way to stop it is to not scroll natively,
which is a behaviour change by definition. Anyone offering a side-effect-free version of A is
mis-describing it.

So:

| | side effects | fixes | status |
|---|---|---|---|
| **C** (the band) | **none** — no scroll, input, layout or desktop change | D2 | shipped |
| **D** (curve + length) | the fill's *feel* changes: it opens immediately instead of after a beat, and is a third shorter on touch. No scroll, input or layout change | D4, and most of what D1 and D3 were being blamed for | shipped |
| **A** (committed glide) | mobile loses the finger-tracked square-grow; chrome stays expanded for the session (~100 px of screen, permanently) | D1 outright | **not spent** |
| **B** (hand-rolled drag + inertia) | keeps the finger-tracked scrub, but we own the momentum curve — a feel we'd be authoring from scratch against native | D1 | not spent |

**C was shipped first and alone, and the report came back unchanged** — which is what surfaced D4.
Worth recording rather than tidying away: C was correct and worth keeping (the band was real, and it
is the only thing standing between the hero and a chrome state inherited from `/about`), but it was
never going to be sufficient, because the biggest of the four defects had not been found yet. The
mistake was diagnosing the *stage* — the browser, the viewport units — and never opening the tween
that actually draws the thing the visitor said was not moving.

**A stays unspent.** D4 was the dead zone; D1 is now the browser doing what it does on every site,
against a square that answers the gesture immediately. If it still reads wrong after D, A is the
escalation and its two costs are known and priced.

### 1f · What is deliberately NOT the fix

| Rejected | Why |
|---|---|
| **`100dvh` on `.hero-section`** | `dvh` tracks the chrome, so the pinned box would resize *mid-gesture* — on a scrubbed pin that is a reflow inside the one animation that must not reflow. The comment at `globals.css:1042` already rejects it and is right. |
| **Move the page into an inner `overflow: auto` scroller** | The textbook way to freeze mobile chrome, and it does work — but it means `ScrollTrigger.defaults({ scroller })`, retargeting every `gsap.to(window, { scrollTo })`, re-checking `pinType`, and a global `html/body { overflow: hidden }` that the two document routes must then opt out of. Enormous surface for a defect Fix A closes in ~30 lines. |
| **`ScrollTrigger.normalizeScroll(true)`** | GSAP's own answer to this exact problem, and it would probably work. But it takes over *all* wheel and touch input, and this site has a hand-rolled stepper on `window` plus three separate layers that survive by swallowing gestures before they reach it (`useModalLayer`, `useScrollGuard`, `useDrawerSheet`). Two owners of the same events, one of them a black box. Not on a site whose scroll is its entire product. |
| **Force the collapse early, behind the loader** | Cannot be done. Programmatic scroll does not minimise chrome — which is the very property Fix A relies on — and scroll is locked for the whole intro anyway (Contract 1). |
| **Drop `SCROLL_SCRUB` to make the hero answer faster** | It would mask D1 rather than fix it, and re-times every crossing on the site. If the fill still feels soft after A, the dial is `FILL_GLIDE_DURATION`, which is local to the fill. |

### 1g · What this costs, honestly

**The browser chrome stays expanded for the whole session on a phone.** ~100 px of a ~780 px screen,
permanently, on a site that wants to be immersive. That is a real price and it should be named
rather than discovered.

It is the right trade anyway: `100svh` is already the height everything on this site is laid out to,
so this makes the layout *true* instead of aspirational, and it removes the only mid-journey
viewport resize on the platform. The alternative — a chrome that comes and goes — costs a stolen
gesture, a black band, and a `window.innerHeight` that disagrees with the stylesheet.

**Needs a real device.** I cannot test iOS from here, so two things are reasoned rather than
observed: that the chrome stays expanded when the page is only ever scrolled programmatically, and
that the first-`touchmove` `preventDefault` wins reliably at window level. Both are well-established
platform behaviour, and both are the kind of thing that is obvious within ten seconds on a phone.
Check them before anything downstream is built on them.

### 1h · Files touched

**Fix C alone** (the recommended first ship):

| file | change |
|---|---|
| `lib/hooks/useHeroAnimation.ts` | `HERO_CREAM` + `SQUARE_BLACK` constants; four lines inside `applyHeroServicesProgress` (`:837`) |

That is the whole of it. No CSS, no CLAUDE.md change — the fill is still free native scroll, so
nothing the file says stops being true.

**Fix A, if it is escalated to:**

| file | change |
|---|---|
| `lib/hooks/useHeroAnimation.ts` | `browserChromeCollapsesOnScroll`; `FILL_GLIDE_DURATION` + `FILL_SETTLE_MS`; `commitFillGlide()`; the new branch at the top of `handleTouchMove` |
| `CLAUDE.md` | the scroll-spine section says the fill is free native scroll. After this it is free native scroll **on a fine pointer**; the file's own rule is that it gets fixed in the same change |

No change to `carouselLayout.ts`, to any crossing span, to `FILL_SCROLL_VH`, or to any scene. The
scroll spine does not move.

No change to `carouselLayout.ts`, to any crossing span, to `FILL_SCROLL_VH`, or to any scene. The
scroll spine does not move.

---

## §2 · (open — the rest of the mobile list)

Not yet specified. Each item gets the same treatment: what was seen, what actually causes it, the
fix, and what the fix costs.
