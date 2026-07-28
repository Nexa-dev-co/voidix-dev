# CLAUDE.md

> **Rewritten 2026-07-28** against the actual source. The previous revision described a project
> with only a Hero and a ServicesDeck and told you Work/Process/Contact "are not built yet" — three
> sections and two labs had landed since. If you find this file disagreeing with the code again,
> the code is right: fix this file as part of the change.

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
| `lil-gui` | The `?tune` authoring panels only. Dynamically imported, never in the default bundle. |
| `lucide-react` | Icons — **labs only** at present. |

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
--accent: #00e5ff;                    /* signature electric cyan    */
--border: rgba(235, 232, 224, 0.08);  /* hairlines                  */
--card: #0d0d0d;                      /* elevated surfaces          */
```

Non-token colours that matter: the hero's cream `#e2dfd2` and `--hero-invert-text: #c0c0c0`.

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
  sun-lab/          # authoring tool (noindex)
  letters/          # glyph testbed (noindex)

components/
  layout/Navbar/
  sections/
    Hero/           # Hero, HeroSun, SunModelCanvas, HeroInstruments/
    ServicesDeck/   # the fleet carousel + DeckCanvas + hullMaterial + tuner
    WorksField/     # the project field + FieldCanvas + meteor/mark systems + tuner
    Chamber/        # the room, its walls/ground, FaqHologram/, tuner
  effects/
    IntroSequence/  # loader: GatherCanvas, gather.worker, LoaderTelemetry/
    FluidCursor/    # hero ink trail (hand-rolled WebGL fluid sim)
    ConstellationFrame/
  lab/
    SunLab/         # /sun-lab — the fractured-sun + black-hole editor
    PadLab/         # /pad-lab — the landing-pad (champion_astro_ring) editor
    LetterLab/      # /letters

lib/                # shared: the pin's layout maths, events, perf systems, tuner plumbing
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
  │dust │───►│square───►│4 craft│── craft flies ──►│4 rocks│── camera ────►│ room │
  │→ sun│    │fills │   │on pad │   becomes the    │one    │   backs out   │ + FAQ│
  └─────┘    └─────┘    └──────┘   project meteor  │re-carve│  of "screen" │ holo │
                                                   └──────┘                └──────┘
   fillFraction ──┤├── carousel: stops separated by wide CROSSINGS ──────────────┤
```

**The layout is data, not arithmetic spread through the file.** `useHeroAnimation` declares a list
of sections; `lib/carouselLayout.ts` derives everything else from it:

```ts
const carouselSections = [
  { key: 'services', stopCount: craftCount,   setActiveStop: …, crossingAfter: { scrollVh: 180, apply: applyServicesToWorksHandoff } },
  { key: 'work',     stopCount: projectCount, setActiveStop: …, crossingAfter: { scrollVh: 140, apply: applyWorksToChamberReveal   } },
  { key: 'process',  stopCount: 1 },   // the chamber — its beats run off the reveal landing
];
```

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
model authored in `/sun-lab`, and its constants **are** the lab's "Peaceful" preset — keep them in
step with `sunLabPresets.ts` rather than drifting a second copy.

The intro only *drives* it via `.hero-sun-layer` (outer: opacity + scroll transform) and
`.hero-sun-flight` (inner: the o → square flight). Its z-index walks `10001` (during intro, above
the veil) → `9500` (after) → `-1` (services, so the fleet and its labels paint in front).

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
| `deck:reveal` / `deck:hide` | `DECK_REVEAL_EVENT` / `DECK_HIDE_EVENT` | useHeroAnimation | Fleet enters/leaves; drives `is-services`, the sun's z-index, the fluid cursor gate. |
| `voidix:goto-services` | `GOTO_SERVICES_EVENT` | Navbar | Nav "Services" scrolls the pin to the revealed fleet. |
| `voidix:handoff-progress` | `HANDOFF_PROGRESS_EVENT` | useHeroAnimation | The services→works crossing, `0..1`. |
| `voidix:chamber-progress` | `CHAMBER_PROGRESS_EVENT` | useHeroAnimation | The works→chamber reveal, `0..1`. |
| `voidix:chamber-hologram` | `CHAMBER_HOLOGRAM_EVENT` | chamberScene | The tour has arrived; the FAQ panel may unseal. |

## Navbar & the per-section meters

Two stacked fixed layers: `.nav-root` uses `mix-blend-mode: difference` (auto-inverts against
whatever scrolls under it); `.nav-accent` sits behind holding everything that must stay brand-cyan
(top line, orbital mark, the meters), so the blend never turns it red.

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

## The `?tune` authoring panels

The deck, the works field and the chamber each ship a `lil-gui` tuning panel, **dynamically
imported only when the URL has `?tune`** — nothing reaches the default bundle. Shared plumbing:
`lib/tunerDock.ts` (the column), `tunerExport.ts` (prints a paste-ready constants block to the
console), `tunerReset.ts`, `tuneScrollLock.ts`.

**These are general editors, not one-shot wizards.** When extending a lab or panel, give full
control over the thing being edited rather than wiring a path to one preconceived outcome.

## The labs (`/sun-lab`, `/pad-lab`, `/letters`)

Authoring tools, `robots: noindex`, separate routes — nothing reaches the homepage bundle.

- **`/sun-lab`** — a full editor for `fractured_sun.glb` and `black_hole.glb`: grouped object tree,
  per-material controls, snapshot presets, and a **complete five-phase sun→black-hole finale**
  (flash, shard implosion, gravitational redshift, spin-up + tremor, screen-space lensing, a
  120k-particle accretion spiral). See `docs/sun-lab-remaining-work.md`.
- **`/pad-lab`** — the services deck's landing pad (`champion_astro_ring.glb`). Per-part pose and
  per-material colour/emissive, plus the **lights the pad casts** and a real craft from
  `DECK_SERVICES` to judge them against. That light rig is the point: every rig light on the deck is
  now `0`, so the pad is the only thing lighting a hull from underneath. Copy button emits the stage
  literal plus the live material/part values.
- **`/letters`** — extruded-glyph testbed.

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
| **Contact** | No section, no CSS, no copy. Nav item 04 (`#contact`) points at nothing and the `nav-cta` "Start Project" button has **no handler**. |
| **Process content** | The `process` meter key is wired to the Chamber, whose content is an FAQ hologram. **Decided:** process steps will be revealed on the chamber's walls as the camera tours. |
| **The collapse finale** | Built and tuned in `/sun-lab`, never ported to the site. **Decided:** the star dies on the table's screen after the chamber, and the black hole carries into the Contact/footer section. |
| **Real content** | `worksProjects.ts` and `faqEntries.ts` are both explicitly placeholder. The deck ships 4 services; the brief names 6. |
| **Attribution** | `black_hole.glb` is *"Black Hole" by NestaEric*, CC-BY-4.0. **Credit is legally required wherever it ships and is currently nowhere.** |

**Current plan of record: `docs/site-completion-plan.md`.** Section state docs:
`services-deck-state.md`, `works-to-chamber-reveal.md`, `sun-lab-remaining-work.md`,
`loader-sun-assembly-plan.md`.
