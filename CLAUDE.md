# CLAUDE.md

> **Rewritten 2026-07-28** against the actual source; **revised 2026-08-02** when every authoring
> route, tuning panel and runtime knob was deleted (see "Nothing is configurable at runtime"). If you
> find this file disagreeing with the code again, the code is right: fix this file as part of the
> change.

---

# PART 1 — The brief

## Project Overview

**Voidix** is a premium software studio specialising in custom web applications, SaaS platforms,
enterprise CRM, mobile applications, AI solutions, and digital product design.

The name comes from orbital systems, gravitational movement, celestial mechanics, and
interconnected ecosystems.

**The website is not a marketing page. The website is the demonstration.** Every interaction,
animation, transition, and visual element must communicate innovation, technical excellence,
precision engineering, premium quality, and future thinking.

## Primary Objective

The goal is a site that can realistically **compete on Awwwards**. Evaluate every decision against:

> *"Would this feel impressive next to recent Awwwards winners?"*

If no — don't build it. Propose something more original, memorable, immersive, or technically
impressive.

## Creative Principles

**1 · Avoid generic agency design.** No generic hero sections, gradient backgrounds, floating
cards, feature grids, SaaS landing layouts, Framer-style templates, or startup aesthetics. If a
section resembles a typical agency site, reject it.

**2 · Create experiences, not pages.** Every section is a scene: orbital systems reacting to the
cursor, scroll-driven worlds, cinematic camera movement, particle systems, physics. The site should
feel alive.

**3 · Motion first.** Motion is a design language. Avoid basic fades, slides, and generic scroll
reveals. Prefer morphing, spatial transitions, depth, camera travel, object transformation,
procedural animation. Motion communicates meaning.

**4 · Use 3D purposefully.** Never decoration — every 3D element supports the narrative.

**5 · Design for emotional impact.** Curiosity → wonder → engagement → trust → excitement. Create
moments users want to share.

## Awwwards Evaluation Framework

Score any proposed feature 1–10 on: **Creativity · Innovation · Interaction · Visual Design ·
Motion · Technical Excellence · Memorability.** Anything below 8 in any category gets redesigned.

## Brand Personality

Voidix **is**: visionary, intelligent, precise, premium, futuristic, confident.
Voidix **is not**: corporate, boring, generic, minimal for minimalism's sake, trend-following.

## Content Standards

Never generate generic agency copy — no *"we build digital solutions"*, *"we transform
businesses"*, *"your trusted partner"*. Every headline should be distinctive; every sentence should
reinforce the Voidix universe. The established voice is **a claim, then the thing that backs it
up** (see `faqEntries.ts`, `worksProjects.ts`).

## Decision Rule

Before proposing anything, ask: Is this unique? Memorable? Technically impressive? Does it
strengthen the Voidix identity? Could it appear on Awwwards? If not — build something better.

---

# PART 2 — The system as it actually exists

## Stack

**Next.js 14.2 (App Router) · TypeScript (strict) · Tailwind CSS.**

| | |
|---|---|
| `three` ^0.184 | All WebGL. Four independent scenes — see below. Always dynamically imported (`ssr: false`). |
| `gsap` + `ScrollTrigger` + `ScrollToPlugin` | Used **directly**. No `@gsap/react`, no `useGSAP`. |

There is **no** shadcn/ui, no Framer Motion, no form library, no validation library, and **no
smooth-scroll layer** — scroll is native. (`lenis`, `ogl` and `@gsap/react` were dependencies that
nothing imported; removed 2026-07-28. If you want smooth scroll, wire it deliberately and re-sync
ScrollTrigger to it.)

## Design tokens

Defined in `app/globals.css` `:root`, exposed to Tailwind in `tailwind.config.ts`. **Never hardcode
a colour.**

```css
--bg: #060606;                        /* near-black page background */
--fg: #ebe8e0;                        /* warm off-white text        */
--muted: rgba(235, 232, 224, 0.38);   /* secondary / metadata       */
--accent: var(--sun-accent);          /* the sun's amber, #ff8a1a   */
--border: rgba(235, 232, 224, 0.08);  /* hairlines                  */
--card: #0d0d0d;                      /* elevated surfaces          */
```

Non-token colours that matter: the hero's cream `#e2dfd2` and `--hero-invert-text: #c0c0c0`.

**The accent IS the sun.** `--accent` used to be an electric cyan held deliberately apart from the star;
that split is gone and it now aliases `--sun-accent`. Retune the star and the navbar, the meters, the
CTA, the contact form and the footer all follow.

⚠ **Amber on a light background needs deepening, and two places already do it.** The raw `#ff8a1a`
manages 1.77:1 on the hero's cream and 2.36:1 on the chamber's white room — nowhere near the 4.5:1 small
text needs. `--hud-accent` (`#8f4400`) and `chamberTuning`'s `holoTint` (`#a85400`) are the deepened
versions. Check any retune of those against their own background, not against black.

**Type:** `--font-syne` (Syne, 700/800) for display via `.font-display`; `--font-dm-sans` (DM Sans,
300/400/500) is the `<body>` default. `.eyebrow` is the uppercased kicker helper. A fluid scale
(`--fs-micro … --fs-mark`) drives sizing — use it rather than fixed px.

**All CSS lives in `app/globals.css`** (~1,900 lines, class-based). There are no CSS Modules.

## Responsiveness — non-negotiable

Everything ships working from ~360px phones to large desktops **in the same change**.

- **Fluid by default** — `clamp()` / viewport units and the `--fs-*` tokens, not fixed px. Reach for
  a breakpoint only when fluid scaling genuinely can't fix the layout.
- **The breakpoint is `@media (max-width: 51.25em)`** (≈820px). Reuse it.
- **3D scenes reframe, not stretch** — update camera aspect on resize, keep subjects framed at
  portrait, clamp DPR.
- **Scrubbed animation must survive resize** — `invalidateOnRefresh` + function-based tween values,
  measure with `measureUntransformedRect` (never a transformed `getBoundingClientRect`), and
  `ScrollTrigger.config({ ignoreMobileResize: true })` so a mobile address bar doesn't re-pin.
- **Phones don't mount the optional hero effects at all** — `useIsLowPowerViewport` unmounts
  `FluidCursor` and `HeroInstruments` below 760px / on coarse pointers. Hiding with CSS leaves the
  rAF loops running, which is the opposite of the point.

## Project structure

```
app/
  layout.tsx        # fonts, Navbar, metadata
  globals.css       # tokens + every component's CSS
  page.tsx          # the ONLY public route

components/
  layout/Navbar/
  sections/
    Hero/           # Hero, HeroSun, SunModelCanvas, HeroInstruments/
    ServicesDeck/   # the fleet carousel + DeckCanvas + hullMaterial
    WorksField/     # the project field + FieldCanvas + the mark systems + transitions/
    Chamber/        # the room: walls/ground/plinth, FaqHologram/
  effects/
    IntroSequence/  # loader: GatherCanvas, gather.worker, LoaderTelemetry/
    FluidCursor/    # hero ink trail (hand-rolled WebGL fluid sim)
    ConstellationFrame/

lib/                # shared: the pin's layout maths, events, perf systems, tuning constants
scripts/optimizeModels.mjs   # `npm run optimize:models` — per-model gltf-transform recipes
docs/               # living design + state docs
```

**Component file convention:** each component lives in its own folder named after it, holding its
`.tsx` plus everything it owns (config, events, sub-hooks, shaders). A component that owns a WebGL
scene co-locates its scene hook (`ServicesDeck/hooks/useServicesDeck.ts`); only genuinely shared
things get promoted to `lib/`.

---

## ► The scroll spine — read this before touching any section

**The entire public site is ONE pinned `ScrollTrigger`, owned by `lib/hooks/useHeroAnimation.ts`.**
`app/page.tsx` renders only `<Hero/>`, `<HeroSun/>`, `<IntroSequence/>` and `<FaqHologram/>`. Every
"section" past the hero is an **absolutely-positioned overlay inside `.hero-section`**, revealed by
scroll progress. There is no stack of sections and no second pin.

```
  INTRO      HERO       SERVICES     ══HANDOFF══   WORKS      ══REVEAL══   CHAMBER
  ┌─────┐    ┌─────┐    ┌──────┐       (180vh)     ┌──────┐     (140vh)    ┌──────┐
  │dust │───►│square───►│4 craft│── craft flies ──►│4 marks│── camera ────►│ room │
  │→ sun│    │fills │   │+ gates│   off, then the  │grown  │   backs out   │ + FAQ│
  └─────┘    └─────┘    └──────┘   mark arrives    │from   │  of "screen"  │ holo │
     ▲                             from the dark   │stone  │               │      │
     │                                             └──────┘                └──────┘
     │                              ── the sun COLLAPSES across the handoff and holds ──
     │       fillFraction ──┤├── carousel: stops separated by wide CROSSINGS ─────────┤
     │                                                                          │
     │   ══LOOP══      CONTACT        ══RETURN══                                │
     │   (200vh)       ┌──────┐        (140vh)                                  │
     └───── fall ──────│ form │◄─── dive back INTO the screen ──────────────────┘
        into the hole  │black │      mark gone, star restored,
        → black        │ hole │      then it DIES (the finale)
        → teleport     └──────┘
        → cream, hero
```

**The last span is not a scroll.** The pin has a fixed range and contact sits at progress 1, so the
loop is a **teleport** — `scrollTo(0)` under cover of the hole's own shadow. That is why
`LOOP_RESET_EVENT` exists: everything that *eases* toward a target has to be told to stop easing and be
there now, or the site visibly un-plays behind the cream. See `docs/contact-loop-plan.md`.

**The layout is data, not arithmetic spread through the file.** `useHeroAnimation` declares a list
of sections; `lib/carouselLayout.ts` derives everything else from it:

```ts
const carouselSections = [
  { key: 'services', stopCount: craftCount,   setActiveStop: …, crossingAfter: { scrollVh: 180, apply: applyServicesToWorksHandoff } },
  { key: 'work',     stopCount: projectCount, setActiveStop: …, crossingAfter: { scrollVh: 140, apply: applyWorksToChamberReveal   } },
  { key: 'process',  stopCount: 1, crossingAfter: { scrollVh: 140, apply: applyChamberToContactReturn } },
  { key: 'contact',  stopCount: 1, crossingAfter: { scrollVh: 120, apply: applyContactToHeroLoop      } },
  { key: 'loop',     stopCount: 1 },   // a landing pad, never rested on — arriving IS the teleport
];
```

⚠ **The last entry is not optional.** `computeCarouselLayout` records every `crossingAfter` as
`toStop: lastStop + 1`; on the final section that stop does not exist, so its `endProgress` is `NaN` —
and because `applyCrossings` walks the whole list, **every** crossing on the site gets NaN, not just
that one. A crossing always needs a section to cross into.

`computeCarouselLayout()` returns the stop progress values, the crossing spans, the fill fraction
and each section's navbar-meter span. **Adding a section is one entry in that list** — do not
hand-roll new progress arithmetic.

**A crossing** is a wide scrubbed span between two sections. One gesture from the last stop commits
the whole glide, with input locked (`settleMs`) so it can't be cut short.

### The rules that keep this working

1. **ONE pin.** New transitions go *inside* it as a section or a crossing. This site was rebuilt
   once already because a crossing ran on three clocks and fast scroll desynced them
   (`docs/services-to-works-flight.md`).
2. **ONE clock.** Every visual in a crossing is a **pure function of its progress `0..1`**. No
   `gsap.to(…)` with a duration, no "arrived" flags, no sentinels. Each scene eases its own copy of
   the progress per frame. Consequences fall out for free: it can't be outrun, it reverses
   perfectly, and a resize just re-derives it. (The two deliberate exceptions are documented in
   `docs/works-to-chamber-reveal.md` §3.8.)
3. **Nothing scroll-driven exists before `REVEAL_EVENT`** — see Contract 2 below.

### Why the Chamber lives inside the WorksField

**A GPU texture cannot cross a WebGL context.** The space scene renders to a texture that gets
painted onto a quad in the chamber room — so the room must be drawn by the *same renderer*. That is
why `useWorksField.ts` hosts `chamberScene.ts` rather than the chamber owning a canvas. **Do not
"tidy" this.**

---

## The intro (loading screen)

`components/effects/IntroSequence/` gates every load. It is one GSAP timeline plus a WebGL "gather"
field, driven by **real asset progress** — not a timer.

- **`GatherCanvas` + `gather.worker.ts`** render dust streaming in from off-screen. The render loop
  runs in a **Web Worker on an `OffscreenCanvas`** so it keeps painting while the main thread is
  blocked parsing glTF and compiling shaders. A main-thread fallback exists for older Safari.
- **The sun assembles.** At 100% the ten fracture shards of `fractured_sun.glb` sweep in from
  outside the frame and lock together; the star lights inside the closing shell. The intro holds
  its handoff on `SUN_ASSEMBLED_EVENT`, so the reveal can never land on a half-built star.
- Then the sun **flies from the wordmark's "o" into the hero square** and `REVEAL_EVENT` fires.

### Contract 1 — scroll is locked for the whole intro

`IntroSequence` locks scroll on mount (`html.scroll-locked`, non-passive `wheel`/`touchmove`
blockers, scroll-key blockers, `scrollRestoration = 'manual'`, `scrollTo(0,0)`) and releases it
**exactly once** in the timeline's `onComplete`. The component returns `null` when done but **stays
mounted** — never rely on effect cleanup to unlock.

### Contract 2 — no scroll-driven hero animation during the intro

The pin is created **only** inside the `REVEAL_EVENT` handler, never on mount (with a fallback
timeout if the intro is bypassed). Any new scroll-driven hero/sun animation must be gated the same
way, or a restored scroll position moves things while the loader is still up.

## The shared sun

**There is exactly one sun: `HeroSun` → `SunModelCanvas` → `fractured_sun.glb`.** It is the same
model a deleted editor authored, and its constants ARE that editor's "Peaceful" stage. This file is
now the only copy of them.

It is driven through exactly **three nested elements, one owner each** — sharing one between two
owners is how you get a sun that jumps:

| element | owner | drives |
|---|---|---|
| `.hero-sun-layer` (outer) | `HeroSun` (base box, z-index, resize fade) + the pin (scroll transform) | where the sun sits and how big it is |
| `.hero-sun-parallax` (middle) | `useSunParallax`, and nothing else | the works camera's drag-to-look |
| `.hero-sun-flight` (inner) | `IntroSequence` (the o → square flight), then the services scale, then the reveal's fade-out | the intro handoff and the sun's opacity |

**The middle one is why drag-to-look doesn't leave the star stuck to the glass.** Everything in the
works scene belongs to a camera the visitor can drag; the sun is a separate WebGL context and cannot
be in that scene, so instead `useWorksField` publishes how far the camera has been dragged off the
pose the current stop authored (`lib/sunParallaxPose.ts`, a per-frame store) and the sun follows.

It is a **deviation**, not a world position, and that is the design: at rest the identity is exact, so
the star sits precisely where the pin put it at every stop and through every travel, and only a drag
moves it. Full world anchoring was rejected — the path orbits ±35° at a ~40° lens, so a world-fixed
sun would swing about two screen widths across the four stops and be off-frame at projects 02 and 03,
which are compositions authored with the star in them.

Its z-index walks `10001` (during intro, above the veil) → `9500` (after) → `-1` (services, so the
fleet and its labels paint in front).

### ⚠ The sun does not enter the chamber, and this is deliberate

At the works→chamber reveal the sun **fades out** over `REVEAL_SUN_FADE` `[0, 0.12]`, matched to
`OPAQUE_WINDOW` in `chamberScene` — early, while the display still fills the frame, so what you
perceive is a light dimming rather than the site's anchor vanishing. The star never reaches the
table.

Two ways of changing that have been built and reverted. **Read this before building a third.**

1. *Transform the DOM sun onto the display.* Cannot work. The room sets an opaque
   `scene.background` and the display's alpha closes over `OPAQUE_WINDOW`, so a layer **behind** the
   canvas is invisible past ~0.12; putting it **in front** leaves a flat rectangle over a screen the
   tour views at an angle. (A stale revision of this file described this as shipped, via a
   `.hero-sun-screen` element and a `lib/screenPose.ts` store. **Neither ever existed.**)
2. *Sample the sun's canvas into the space render* (`sunBackdrop.ts`, deleted 2026-07-31). The idea
   is sound — once the pixels are inside the space texture the display's own perspective carries
   them onto the table correctly — but that build had two defects: the quad was written in **clip
   space**, so the works camera could not move it, and the handoff with the DOM sun was arbitrated by
   a **threshold on eased progress**, which did not hold. Both suns ended up on screen at once.

If it is tried again: the two images must be mutually exclusive *by construction*, not by timing,
and anything living in the space scene must be positioned through the camera rather than in clip
space. The open cost is a per-frame `CanvasTexture` upload on the heaviest scene on the site.

This matters beyond the reveal: **the planned collapse finale needs a star on that screen to die.**

`SUN_COVERED_CHAMBER_PROGRESS` (`SunModelCanvas`) freezes the star just past that fade's end. Keep
the two in step — below the fade's end it freezes something still on screen; far above it, it pays
for a bloom pass on something fully transparent.

`AUTO_ROTATE_DEGREES_PER_SECOND` is **imported** from `HeroInstruments/heroReadouts.ts`, not
copied — the HUD displays that exact rate, so one source of truth stops the telemetry lying.

## Event contracts

| Event | Constant | Fired by | Purpose |
|---|---|---|---|
| `voidix:reveal` | `REVEAL_EVENT` | IntroSequence | **The** intro→site handoff. Hero pin, navbar entrance, sun z-index all wait on it. |
| `voidix:intro-active` | `INTRO_ACTIVE_EVENT` | IntroSequence | Intro is up. |
| `voidix:sun-assemble` / `-assembled` | `SUN_ASSEMBLE_EVENT` / `SUN_ASSEMBLED_EVENT` | IntroSequence ↔ SunModelCanvas | Cue and completion of the shard assembly. The intro holds on the latter. |
| `voidix:intro-ignite` | `IGNITE_EVENT` | IntroSequence | The gather field's final rush. |
| `voidix:assets-warmup` | `ASSETS_WARMUP_EVENT` | IntroSequence | Asks each scene to compile shaders during a still beat, so the stall is invisible. |
| `deck:reveal` / `deck:hide` | `DECK_REVEAL_EVENT` / `DECK_HIDE_EVENT` | useHeroAnimation | **The fleet itself** enters/leaves — replay the craft's entrance. Nothing else. |
| `voidix:black-stage` | `BLACK_STAGE_EVENT` | useHeroAnimation (`setStage`) | A full-black scene is / is not on screen — the event form of `is-services`. Drives the sun's z-index, the fluid cursor's gate and the constellation's freeze. ⚠ Those three used to read `deck:reveal`, which was only ever right because the fleet was the first black scene you met — a **navbar jump** reaches works or contact without entering it. Keyed off the fill boundary so it cannot depend on the route. |
| `voidix:jump-begin` / `-covered` / `-arrived` | `JUMP_BEGIN_EVENT` etc. | useHeroAnimation ↔ SectionJumpVeil | A navbar jump of 2+ sections is hidden: the cover closes, the **ordinary glide** runs underneath unwatched, the cover opens once the PIN (not its scrollTo tween) has settled. Nothing is skipped or snapped. See `docs/nav-jump-plan.md`. |
| `voidix:goto-section` | `GOTO_SECTION_EVENT` | Navbar | **Every** nav item and the CTA. Carries a section key; the pin drives itself there on a distance-scaled glide. None of these sections is a place — they are overlays inside one pin, so an anchor would land on the hero whichever you clicked. |
| `voidix:handoff-progress` | `HANDOFF_PROGRESS_EVENT` | useHeroAnimation | The services→works crossing, `0..1`. |
| `voidix:chamber-progress` | `CHAMBER_PROGRESS_EVENT` | useHeroAnimation | The works→chamber reveal, `0..1`. |
| `voidix:chamber-hologram` | `CHAMBER_HOLOGRAM_EVENT` | chamberScene | The tour has arrived; the FAQ panel may unseal. |
| `voidix:hero-services` | `HERO_SERVICES_PROGRESS_EVENT` | useHeroAnimation | The hero→services span. Carries **two** fractions: `progress` (to the fleet landing) and `fill` (to the square covering the viewport). The pin owns the layout; the sun owns what to do with it. |
| `voidix:contact-progress` | `CONTACT_PROGRESS_EVENT` | useHeroAnimation | The chamber→contact return, `0..1`. Its own signal rather than the chamber's, so one number never has two writers. |
| `voidix:loop-progress` | `LOOP_PROGRESS_EVENT` | useHeroAnimation | The dive into the hole, `0..1`. Reversible; its job is to be opaque by 1. |
| `voidix:loop-reset` | `LOOP_RESET_EVENT` | useHeroAnimation | **The scrollbar has just jumped to the top — snap, do not ease.** Every owner of an eased value listens. |
| `voidix:loop-request` | `LOOP_REQUEST_EVENT` | ContactSection | The "Travel in time" button. Routed through the pin so button and scroll commit one cinematic. |
| `voidix:sun-regather` | `SUN_REGATHER_EVENT` | useHeroAnimation | Replay the shard assembly at the top. **Not** `SUN_ASSEMBLE_EVENT` — the intro is still mounted and still listening to that one. |

One per-frame **store** sits alongside these, for values too hot for an event: `lib/hologramPose.ts`
(where the FAQ panel is on screen). It is written every frame by `chamberScene` and read in the
consumer's own rAF — a CustomEvent or React state per frame would be a re-render per frame.

## Navbar & the per-section meters

Two stacked fixed layers: `.nav-root` uses `mix-blend-mode: difference` (auto-inverts against
whatever scrolls under it); `.nav-accent` sits behind holding everything that must stay brand-amber
(top line, orbital mark, the meters), so the blend never turns it blue.

Each nav item has a cyan meter. **A section feeds its meter by setting `--nav-progress-<key>` on
`document.documentElement`** — the hero pin publishes `home`, `services`, `work`, `process`.
`useNavbarAnimation` positions each meter by measuring live layout (re-run on resize and once fonts
are ready), so a new section's meter works with zero navbar changes. Entrance plays on
`REVEAL_EVENT`, items converging from the four directions in their `data-enter`.

## Performance systems

These exist and are load-bearing — don't reinvent them:

| `lib/` | Job |
|---|---|
| `adaptivePixelRatio.ts` | Measures real frame times and trades resolution for smoothness. **Frozen during crossings** — reallocating a composer mid-flight causes a visible jump. |
| `performanceTier.ts` | `'low' \| 'high'` from measured frame times; picks which texture tier to fetch. |
| `assetLoadProgress.ts` | Weighted, monotonic combined progress from the `deck` and `works` sources, plus the shader-warmup gate. The intro's counter is honest because of this. **Re-weigh `SOURCE_WEIGHTS` if either side's assets change size.** |
| `useIsLowPowerViewport.ts` | Unmounts the hero's optional effects on phones. |

**Only one heavy 3D scene ever draws at a time past the hero** — the deck and the works field gate
each other off, and both stop on tab-hidden. Preserve that.

Costs, roughly: WorksField + Chamber ●●●●● > ServicesDeck ●●●●○ ≈ FluidCursor ●●●●○ > sun ●●●○○.
`UnrealBloom` is the recurring expensive pass. Full breakdown in `docs/performance-ratings.md`.

## Nothing is configurable at runtime

**Deleted 2026-08-02, deliberately and by request.** There are no authoring routes, no `?tune`, no
`lil-gui`, no knob schemas, no writable tuning handles. One route ships: `/`.

What went: `/sun-lab` (the fractured-sun + black-hole editor), `/letters` and
`/letters/transition/[strategy]` (the glyph testbed and the mark→mark comparison rig),
`components/lab/**`, the chamber's `?tune` panel, `lib/tunerDock|tunerExport|tunerReset|tuneScrollLock`,
and the transition strategy registry/catalogue along with `shards`, the candidate that never shipped.
~10,900 lines. It is all in git if any of it is ever wanted back.

**Every value is now a named constant in the file that reads it**, and in most cases that file is the
only copy left:

| where | what it holds |
|---|---|
| `lib/chamberTuning.ts` | the room, the display rig, the showcase keys, the hologram |
| `ServicesDeck/deckTuning.ts` + `deckServices.ts` | the fleet's stage; the per-ship palettes |
| `WorksField/worksTuning.ts` | the camera path and where the mark sits |
| `WorksField/transitions/accretionTransition.ts` → `ACCRETION_TUNING` | the mark's ~60 look and choreography numbers |
| `Hero/SunModelCanvas.tsx` | the sun's Peaceful / Cracks / Collapse stages |
| `Contact/singularityScene.ts` | the collapse finale |

⚠ **Two pairs must not drift, and nothing enforces it any more.** `SunModelCanvas`'s COLLAPSE_* block
and `singularityScene`'s four geometry values are the same pose — the star you leave at works and the
star you come back to at contact. And `ACCRETION_TUNING`'s glow values were all graded against
`useWorksField`'s `BLOOM_THRESHOLD` of 0.6; moving that threshold re-grades the mark.

Many comments in those files explain a value by comparing it to what an editor showed, or by naming a
six-second round trip it was authored on. That history is worth keeping — but the editors are gone, so
read them as provenance, not as instructions to go and re-author something.

---

# PART 3 — Code style

## Naming

**Never abbreviate.** Every variable, parameter, destructured value and callback argument is named
for exactly what it is.

```ts
// ❌
const p = req.params;  const fn = (e: Event) => {};  const { s, t } = useScroll();
function animateParticles(p: ParticleConfig) {}

// ✅
const routeParams = req.params;  const handleSubmit = (event: Event) => {};
const { scrollProgress, scrollTarget } = useScroll();
function animateParticles(particleConfig: ParticleConfig) {}
```

**Files.** `.tsx` → PascalCase, named after the component it exports. `.ts` → camelCase: hooks are
verb-first (`useHeroAnimation.ts`), utilities/config/data describe their contents
(`measureUntransformedRect.ts`, `deckServices.ts`, `carouselLayout.ts`) — **never** `utils.ts` /
`helpers.ts` / `misc.ts`. If the name doesn't tell you what's inside, rename it.

**Hooks** are verb-first and action-describing. **Components** are PascalCase, named for what they
render.

## Exports

Pages & components → **default**. Hooks, utils, lib, types, registries → **named**.
`page.tsx` / `layout.tsx` → always default (required by Next).

## Comments

Comments explain **why**, or walk through the steps of complex logic. They should read like a human
wrote them — not generated documentation, not a narration of the obvious.

```ts
// ❌ Says what the code already says
brightness *= 1.5;   // Brighten the particle

// ✅ Explains the why
// Particles brighten as they lock in so the formed shape "pops" — this is what makes the
// reveal read as building, not just arriving
brightness *= 1.0 + gatherRaw * FORM_BRIGHTNESS_BOOST;
```

Number the steps in multi-step timelines and shaders. No JSDoc on every function — only where a
shared `lib/` helper is genuinely reusable and non-obvious.

**The codebase's comments carry hard-won traps** (composer buffer roles, transformed-rect
measurement, `transferControlToOffscreen` under StrictMode, the optimizer's `join`/`instance`
flags). When you fix something subtle, leave the reason behind.

## TypeScript

`interface` for object shapes, `type` for unions/computed. **No `any`** — use `unknown` and narrow.
Export shared contracts explicitly (`DeckService`, `WorksProject`, `CarouselLayout`, the `*Refs`
interfaces the hooks accept).

## Single responsibility

Every file has one job. A component renders UI and delegates animation to hooks. A hook manages one
concern. A shader file contains shader code — not scene setup, not React bindings. A config file
holds static values — not logic.

**Line count is a signal, not a rule.** A 300-line shader doing one thing well is fine; a 100-line
component doing both animation orchestration and layout is not.

## General rules

- **No magic numbers.** Named constants at the top of the file, never inline.
- No commented-out code in commits.
- Import order: external → `@/` aliases → relative.
- `'use client'` only where strictly necessary.
- **Three.js / WebGL is always dynamically imported** (`next/dynamic`, `ssr: false`) — it cannot run
  on the server.
- WebGL canvases render behind content and never block scroll or pointer events. (Exceptions: the
  deck canvas accepts drag; the works field accepts drag-to-look.)
- **Backticks inside a `/* glsl */` template literal terminate the string.** This has bitten twice,
  both times from a comment. Use plain words inside shader source.
- Every animation respects `prefers-reduced-motion` via `prefersReducedMotion()`.

## Verification

**The user runs the app.** Don't spin up a dev server or a browser to verify — run `npx tsc
--noEmit` and `npm run build`, self-review the diff, and hand off clearly stating what still needs
eyes on it.

---

# PART 4 — What is NOT built

Be accurate about this; the previous revision of this file was wrong in both directions.

| | |
|---|---|
| **Contact** | **BUILT** — the star dies here, then the page loops back to the hero. Form + footer are front-end only: `handleSubmit` prevents default and posts nowhere, and every address, social handle and legal route in `contactContent.ts` is an invented placeholder. The navbar is fully wired: all four items and the CTA route through `GOTO_SECTION_EVENT`. |
| **Process content** | The `process` meter key is wired to the Chamber, whose content is an FAQ hologram. **Decided:** process steps will be revealed on the chamber's walls as the camera tours. |
| **The collapse finale** | **BUILT** — ported into `components/sections/Contact/singularityScene.ts`, a SECOND star living inside the works renderer (the hero sun's canvas has no compositor and nothing behind it for lensing to bend). Collapse, flash, black hole, accretion and lensing all ship. See `docs/contact-singularity-plan.md`. |
| **Real content** | `worksProjects.ts` and `faqEntries.ts` are both explicitly placeholder. The deck ships 4 services; the brief names 6. The four **marks** are placeholders too — three stock SVG logos plus the company initial, and that initial extrudes in **helvetiker, not Syne** (`marks.ts` says why). |
| **Attribution** | `black_hole.glb` is *"Black Hole" by NestaEric*, CC-BY-4.0. **Now credited**, in the contact footer — the first place on the site that puts the model on screen. No link to the source page: the licence does not require one and none was to hand. |

⚠ **The `docs/` directory is nearly empty**, and most of this file's `docs/*.md` citations point at
files that are not in the tree. They are real history — they are in git — but do not send anyone to a
path without checking it exists first.
