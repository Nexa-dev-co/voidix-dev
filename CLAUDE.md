# CLAUDE.md

## Project Overview

Project Name: Voidix

Voidix is a premium software company specializing in:

- Custom Web Applications
- SaaS Platforms
- Enterprise CRM Systems
- Mobile Applications
- AI Solutions
- Digital Product Design

The name "Voidix" originates from orbital systems, gravitational movement, celestial mechanics, and interconnected ecosystems.

The website is not a marketing page.

The website itself must be a demonstration of Voidix's capabilities.

Every interaction, animation, transition, and visual element should communicate:

- Innovation
- Technical Excellence
- Precision Engineering
- Premium Quality
- Future Thinking

---

# Primary Objective

The goal of this project is not merely to build a beautiful website.

The goal is to create a website that can realistically compete on Awwwards.

Every design decision, animation, interaction, layout, component, and piece of content must be evaluated against this question:

"Would this feel impressive when compared against recent Awwwards winners?"

If the answer is no:

Do not implement it.

Instead propose something more original, memorable, immersive, or technically impressive.

---

# Creative Principles

## Principle 1: Avoid Generic Agency Design

Never generate:

- Generic hero sections
- Generic gradient backgrounds
- Generic floating cards
- Generic feature grids
- Generic SaaS landing page layouts
- Generic Framer-style templates
- Generic startup aesthetics

If a section resembles a typical agency website:

Reject it.

---

## Principle 2: Create Experiences, Not Pages

Every section should feel like an experience.

Examples:

- Orbital systems reacting to cursor movement
- Dynamic 3D worlds
- Interactive storytelling
- Scroll-driven transformations
- Immersive scene transitions
- Cinematic camera movements
- Environmental effects
- Particle systems
- Physics-driven interactions

The website should feel alive.

---

## Principle 3: Motion First

Motion is a core design language.

Every transition should have intention.

Avoid:

- Basic fade-ins
- Basic slide-ins
- Generic scroll reveals

Prefer:

- Morphing objects
- Spatial transitions
- Depth-based movement
- Camera travel
- Object transformation
- Procedural animation

Motion should communicate meaning.

---

## Principle 4: Use 3D Purposefully

3D should not be decoration.

Every 3D element must support the narrative.

Potential themes:

- Orbiting systems
- Planetary mechanics
- Connected ecosystems
- Data universes
- Artificial intelligence structures
- Digital galaxies
- Abstract technological architectures

3D must feel premium and cinematic.

---

## Principle 5: Design for Emotional Impact

Users should experience:

1. Curiosity
2. Wonder
3. Engagement
4. Trust
5. Excitement

The site should create moments that users want to share.

---

# Awwwards Evaluation Framework

Before implementing any feature, score it from 1-10 in the following categories:

## Creativity

Is it original?

## Innovation

Have users seen this before?

## Interaction

Does it create engagement?

## Visual Design

Does it look premium?

## Motion

Does animation elevate the experience?

## Technical Excellence

Does it demonstrate advanced engineering?

## Memorability

Will users remember it tomorrow?

Any concept scoring below 8 in any category should be redesigned.

---

# Voidix Brand Personality

Voidix is:

- Visionary
- Intelligent
- Precise
- Premium
- Futuristic
- Confident

Voidix is not:

- Corporate
- Boring
- Generic
- Minimal for the sake of minimalism
- Trend-following

Voidix should feel like a company that builds the future.

---

# Technical Standards

Framework:

- Next.js
- TypeScript

Preferred Technologies:

- React Three Fiber
- Three.js
- GSAP
- Framer Motion
- Lenis
- Motion Path Animations
- WebGL
- GLSL Shaders
- Custom Post Processing

Avoid unnecessary dependencies.

Favor custom implementations over generic libraries when they improve uniqueness.

---

# Content Standards

Never generate generic agency copy.

Avoid phrases such as:

- We build digital solutions
- We transform businesses
- We create innovative experiences
- Your trusted partner

Every headline should feel distinctive and memorable.

Every sentence should reinforce the Voidix universe.

---

# Performance Requirements

Awwwards-level visuals must not sacrifice performance.

Priorities:

1. Smooth 60fps interactions
2. Fast initial load
3. Progressive enhancement
4. Optimized assets
5. Efficient WebGL rendering

Visual ambition must coexist with engineering excellence.

---

# Decision Rule

Before proposing any feature, section, interaction, animation, or visual concept:

Ask:

1. Is this unique?
2. Is this memorable?
3. Is this technically impressive?
4. Does it strengthen the Voidix identity?
5. Could this appear on Awwwards?

If not:

Do not proceed.

Create something better.

# CLAUDE.md — voidix

This file defines how code should be written, structured, and named in this codebase. Follow these rules in every suggestion, generation, and edit. This is a **pure frontend** Next.js project — no backend, no API routes, no database.

voidix is a cinematic, single-page **web-studio portfolio**: a long-scroll homepage composed of animated sections, gated behind an intro loading screen, plus an isolated **orbital-map navigation prototype** at `/prototype`.

---

## Stack

**Framework:** Next.js 14 (App Router), TypeScript, Tailwind CSS

**Animation & graphics:**

- `gsap` + `gsap/ScrollTrigger` + `gsap/ScrollToPlugin` — imported and used **directly** (no `@gsap/react` / `useGSAP` wrapper, no scoped `useGsap` hook). Scroll-driven pins, scrubs, timelines, snapping. Each animation lives in its own hook under `lib/hooks/` (`useHeroAnimation`, `useNavbarAnimation`) or co-located with its scene (`useServicesDeck`).
- `Three.js` — WebGL scenes: the shared sun (`SunCanvas`) and the homepage services fleet (`useServicesDeck`).

**Icons:** `lucide-react` (a dependency; reach for it when an icon is needed).

**Dev tooling:** `lil-gui` — a dependency for runtime tweak panels while tuning shaders/scenes (never shipped in a visible/default-on state).

> **Listed-but-unused dependencies (do not assume they're wired in):** `lenis` (smooth scroll), `ogl`, and `@gsap/react` are in `package.json` but currently imported **nowhere**. The site uses **native scroll** today — there is no Lenis instance, no GSAP-ticker-driven scroll loop. If you need smooth scroll, wire Lenis up deliberately; don't write code that assumes it already exists.

There is **no** shadcn/ui, Framer Motion, form library, or validation library in this project. Don't introduce one without being asked.

---

## Design System — Tokens

These are the canonical design tokens, defined as CSS variables in `app/globals.css` and exposed to Tailwind via `tailwind.config.ts`. Use them everywhere. **Never hardcode a color.**

### Colors

```css
:root {
  --bg: #060606; /* page background — near-black */
  --fg: #ebe8e0; /* foreground text — warm off-white */
  --muted: rgba(235, 232, 224, 0.38); /* secondary / metadata text */
  --accent: #00e5ff; /* signature electric cyan — CTAs, highlights, selection */
  --border: rgba(235, 232, 224, 0.08); /* hairline dividers, card borders */
  --card: #0d0d0d; /* elevated surfaces / cards */
}
```

Tailwind exposes these as `bg-bg`, `text-fg`, `text-muted`, `bg-accent`, `border-border`, `bg-card`, etc. (see `tailwind.config.ts`). Prefer the Tailwind token classes over raw `var(--…)` in JSX, and use `var(--…)` directly in CSS / inline canvas styles.

### Typography

Two fonts, loaded via `next/font/google` in `app/layout.tsx` with `display: "swap"`:

```css
--font-syne     /* Syne   — display / headings (weights 700, 800) */
--font-dm-sans  /* DM Sans — body / UI         (weights 300, 400, 500) */
```

**Usage rules:**

- Display (Syne) → headings, hero text, section titles. Apply via the `font-display` Tailwind class or the `.font-display` helper.
- Body (DM Sans) → paragraphs, nav, labels. This is the `<body>` default.
- `.eyebrow` helper → small uppercased, letter-spaced kicker labels above headings.

---

## Responsiveness — non-negotiable

**Everything built in this project must be responsive.** No fixed-width layouts, no desktop-only sections, no "we'll do mobile later". Every new section, component, animation, and 3D scene ships working from small phones to large desktops in the same change.

Follow the patterns already in the codebase:

- **Fluid by default.** Size type, spacing, and layout with `clamp()` / viewport units, not fixed pixels — see the `--fs-*` tokens in `globals.css` and the `clamp(...)` font sizes/padding throughout. Reach for a breakpoint only when fluid scaling alone can't fix the layout.
- **Breakpoint convention.** The existing stacked-layout breakpoint is `@media (max-width: 51.25em)` (≈820px) — reuse it for consistency unless a component genuinely needs its own.
- **3D / canvas scenes must reframe, not just stretch.** Update camera aspect on resize, keep subjects framed at portrait aspect ratios, and clamp DPR (`Math.min(devicePixelRatio, 2)`) for performance.
- **Scroll-driven (pinned/scrubbed) animation must survive resize.** Recompute geometry on `ScrollTrigger` refresh (`invalidateOnRefresh` + function-based tween values), measure base boxes with `measureUntransformedRect` (never a transformed `getBoundingClientRect`), and use `ScrollTrigger.config({ ignoreMobileResize: true })` so a mobile address bar showing/hiding doesn't re-pin or jitter the scene.
- **Touch matters.** Pointer-driven interactions (drag-to-rotate, flick) should degrade gracefully on touch; scroll/snap and tap-to-select must always work.
- Verify changes at a narrow viewport before considering them done.

---

## Intro Loading Screen

Every load of the homepage is gated behind a single fullscreen intro: `components/effects/IntroSequence/IntroSequence.tsx`. It is **one component running one GSAP timeline** (~6s) — there is **no loader-variant registry, no `?loader=` URL switch, and no `PageLoader` orchestrator**. (Earlier docs described a multi-variant loader system; that does not exist in the code.)

The intro: paints an opaque `--bg` veil over the hero, runs a counter → slot-machine word cycle → "voidix" wordmark resolve, then **hands off** by flying the one shared sun from the wordmark's "o" into the hero square. It locks scroll for its entire duration and dispatches `REVEAL_EVENT` (`voidix:reveal`) right before the sun lands — the single "site is ready" signal the hero and navbar wait for. Honours `prefers-reduced-motion` by resolving fast. See the **Intro & Hero Animation Timeline** section below for the contracts that protect it.

---

## Project Structure

**Single-page site.** Everything renders from `app/page.tsx` — there are **no other routes** (a former `/services` page was removed). There is **no `View` wrapper** between the page and its sections. The codebase is intentionally small right now — most of the sections the creative brief envisions (Work, Process, Contact, Footer) are **not built yet**.

```
app/
  layout.tsx          # root layout — fonts (Syne + DM Sans), Navbar, global CSS
  globals.css         # design tokens + all component CSS (class-based, not CSS Modules)
  page.tsx            # the only route — renders <Hero/> + <HeroSun/> + <IntroSequence/>

components/
  layout/
    Navbar/           # Navbar.tsx — blended bar + cyan accent layer + per-section scroll meters
  sections/
    Hero/             # Hero.tsx (hero + owns the services-deck overlay), HeroSun.tsx, SunCanvas.tsx, sunShaders.ts
    ServicesDeck/     # homepage services: ServicesDeck.tsx, deckServices.ts, deckEvents.ts,
                      #   DeckCanvas/DeckCanvas.tsx, hooks/useServicesDeck.ts
  effects/
    IntroSequence/    # IntroSequence.tsx + introEvents.ts (REVEAL_EVENT)
    FluidCursor/      # FluidCursor.tsx + fluidConfig + fluidSimulation (hero ink trail)

lib/
  hooks/
    useHeroAnimation.ts    # the hero→services single-pin transition (fill → reveal → carousel)
    useNavbarAnimation.ts  # navbar entrance + per-section meter positioning
    useFluidCursor.ts      # drives the FluidCursor WebGL sim + difference-blend invert canvas
  prefersReducedMotion.ts  # standalone helper — `prefersReducedMotion()` (NOT a hook, NOT inside useGsap)
  measureUntransformedRect.ts # reads an element's base box with its live transform stripped

public/
  models/             # Draco-compressed .glb vessels (some referenced models are missing — see below)
  draco/              # Draco decoder (js + wasm) for GLTFLoader
  textures/           # planet + sun textures

scripts/
  optimizeModels.mjs  # `npm run optimize:models` — gltf-transform Draco compression
docs/                 # living handoff docs — services-deck-state.md is the accurate one
```

### Component file convention

- **Each component lives in its own folder named after it**, containing its `.tsx` plus anything it owns (co-located config, events, sub-hooks, shaders). E.g. `components/sections/Hero/Hero.tsx`, not a loose `Hero.tsx`.
- Category folders (`layout`, `sections`, `effects`) are grouping only; the per-component folder sits inside its category.
- A component that owns a WebGL scene co-locates its scene hook (e.g. `ServicesDeck/hooks/useServicesDeck.ts`); cross-component animation hooks live in `lib/hooks/`.
- Only promote something to `lib/` when it's shared across components.

---

## The Page (`/`)

`app/page.tsx` renders just three things: `<Hero/>`, `<HeroSun/>`, and `<IntroSequence/>`. The whole hero→services experience is **one continuous pinned scroll**, not a stack of sections:

- **`Hero`** — cream-coloured hero (`#e2dfd2`): masked headline "we build worlds" where the "o" is the shared sun, tagline "software with its own gravity", and a scoped `FluidCursor` ink trail. The hero section also **owns the `ServicesDeck` overlay**.
- **`HeroSun`** — the single shared sun for the whole page (one WebGL canvas, `SunCanvas`). The intro flies it from the loader "o" into the hero square; hero scroll then expands it.
- **`useHeroAnimation`** — one pinned `ScrollTrigger` runs three phases: **(1) fill** (scrubbed: the black square grows to fill the viewport, sun rises), **(2) reveal** (at full fill, the `ServicesDeck` overlay appears on the now-full-black screen, `DECK_REVEAL_EVENT` fires), **(3) carousel** (snapped: scroll cycles the four service "craft"). There is no second pinned section glued on with a margin.
- **`ServicesDeck`** — landing-pad carousel: one 3D vessel on a pad under a starfield, four services as a bottom strip. Scroll / drag-flick / click-a-name to switch craft. `deckServices.ts` is the single source of truth for the services copy + per-ship model/colours. Detailed tuning lives in `docs/services-deck-state.md`.

---

## Naming Rules

### Variables & Parameters

**Never use abbreviations.** Names must describe exactly what the value is. This applies to every variable, parameter, destructured value, and callback argument without exception.

```ts
// ❌ Wrong
const p = req.params;
const u = await getUser(id);
const fn = (e: Event) => {};
const d = new Date();
const ref = useRef<HTMLDivElement>(null); // only if "ref" is vague — prefer descriptive names
const { s, t } = useScroll();

// ✅ Correct
const routeParams = req.params;
const currentUser = await getUserById(userId);
const handleSubmit = (event: Event) => {};
const createdAt = new Date();
const heroContainerRef = useRef<HTMLDivElement>(null);
const { scrollProgress, scrollTarget } = useScroll();
```

When a parameter is a bag of options or data, name it after what it contains — not a generic shorthand:

```ts
// ❌
function animateParticles(p: ParticleConfig) {}
function buildScene(opts: SceneOptions) {}

// ✅
function animateParticles(particleConfig: ParticleConfig) {}
function buildScene(sceneOptions: SceneOptions) {}
```

### Files

- **`.tsx` files → PascalCase**, named after what they render: `Hero.tsx`, `Navbar.tsx`, `SunCanvas.tsx`, `IntroSequence.tsx`. A `.tsx` file that exports a component is named after that component.
- **`.ts` files** keep their idiomatic casing:
  - **hooks** → `camelCase`, verb-first: `useHeroAnimation.ts`, `useNavbarAnimation.ts`, `useServicesDeck.ts`.
  - **utilities / config / data** → `camelCase`, describing what the file does or contains: `measureUntransformedRect.ts`, `prefersReducedMotion.ts`, `deckServices.ts` — never `utils.ts` / `helpers.ts` / `misc.ts`.
- File names must describe what the file **does or contains**. If the name alone doesn't tell you what's inside, rename it.

### Hooks

Verb-first, action-describing names. The hooks that actually exist:

```ts
useHeroAnimation();   // the hero→services single-pin transition (fill → reveal → carousel)
useNavbarAnimation(); // navbar entrance (on REVEAL_EVENT) + per-section meter positioning
useFluidCursor();     // drives the hero ink-trail WebGL sim + its difference-blend invert canvas
useServicesDeck();    // the homepage fleet Three.js scene (co-located in ServicesDeck/hooks/)
```

### Components

PascalCase, named after what they render: `Hero` / `Navbar` / `IntroSequence` / `ServicesDeck`.

---

## Exports

- **Pages & components** → `default export`
- **Hooks, utils, lib, types, registries** → `named export`
- **Next.js `page.tsx` and `layout.tsx`** → always `default export` (required)

---

## Animation Philosophy

Every animation must feel **purposeful and cinematic**, not decorative.

Rules:

1. **The intro (`IntroSequence`) gates the homepage.** It locks scroll and dispatches `REVEAL_EVENT` when the sun lands — don't bypass it with code edits, and don't build hero/sun scroll animation that runs before that event (see Contract 2 below).
2. **Scroll reveals use GSAP `ScrollTrigger`** in a dedicated hook — not hand-rolled Intersection Observers. Register plugins once (`gsap.registerPlugin(ScrollTrigger, ScrollToPlugin)`) and kill triggers/timelines in the effect cleanup.
3. **Scroll is native today.** There is no Lenis/smooth-scroll layer wired in. If you add one, do it deliberately and re-sync ScrollTrigger to it — don't assume it already exists.
4. **WebGL canvases render behind content.** Never block scroll or pointer events (the one exception: the deck canvas accepts the pointer for dragging the craft).
5. Animations respect `prefers-reduced-motion`. Use the standalone helper, then gate decorative motion behind it:

```ts
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";

if (!prefersReducedMotion()) {
  // run decorative GSAP / WebGL motion
}
```

---

## Comments

Comments explain **why** something is done or walk through **steps in complex logic**. They should read like a human wrote them — not like generated documentation or a narration of obvious code.

```ts
// ❌ Obvious — says what the code already says
// Brighten the particle
brightness *= 1.5;

// ❌ Robotic — generated doc style
// This function calculates the orbital position based on angle and radius
function getOrbitalPosition(angle: number, radius: number) {}

// ✅ Explains the why
// Particles brighten as they lock in so the formed shape "pops" — this is what
// makes the reveal read as building, not just arriving
brightness *= 1.0 + gatherRaw * FORM_BRIGHTNESS_BOOST;

// ✅ Human and contextual
// We delay the hero reveal by one frame so the loader exit finishes painting
// before GSAP tries to measure element positions — measuring mid-transition
// gives wrong values and breaks the stagger
requestAnimationFrame(() => timeline.play());
```

For multi-step complex functions (especially animation timelines and shaders), number the steps:

```ts
// 1. Intro — elements fade in / settle (anticipation)
// 2. Build — staggered reveal ramps in
// 3. Resolve — final polish, then hand off / reveal the site
```

No JSDoc on every function. Only add JSDoc where a utility is genuinely reusable and non-obvious (e.g. a shared `lib/` helper used across multiple components).

---

## TypeScript

- Prefer `interface` for object shapes, `type` for unions and computed types.
- No `any`. Use `unknown` and narrow it.
- Type shared contracts explicitly and export them (e.g. `DeckService` in `deckServices.ts`, the `*Refs` interfaces the animation hooks accept).
- Generic hooks should be parameterised over the element type where it helps callers.

---

## Single Responsibility

Every file has **one job**. If a file is doing two different things, it needs to be split.

- A component renders UI — it delegates animation logic to hooks, not inline in JSX
- A hook manages one concern — scroll, cursor, GSAP lifecycle, etc.
- A shader file contains shader code — not scene setup, not React bindings
- A config/constants file holds static values — not logic, not side effects

**Line count is a signal, not a rule.** A 300-line shader that does one thing well is fine. A 100-line component doing both animation orchestration and layout is not. When a file starts owning two clearly different concerns, split it.

Example — animation hook that also handles DOM measurement is doing two jobs:

```ts
// ❌ One file doing two things
function useHeroAnimation(containerRef) {
  // measures DOM — one concern
  const bounds = containerRef.current.getBoundingClientRect();

  // runs animation — different concern
  gsap.from(containerRef.current, { opacity: 0, y: 40 });
}

// ✅ Separated
function useElementBounds(ref) { ... }   // measures DOM
function useHeroAnimation(ref) {         // runs animation, calls useElementBounds internally
  const bounds = useElementBounds(ref);
  ...
}
```

---

## Intro & Hero Animation Timeline (read before adding or animating hero / scroll effects)

The site is gated behind `IntroSequence` (the loading screen). It plays a single GSAP
timeline, drives the one shared sun, then hands off to the hero. Two hard contracts
protect it — break either and the sun will fight the scroll.

### Phases (one GSAP timeline in `IntroSequence.tsx`, ~6s; durations come from the named constants there)

1. **Frame in** — editorial frame scales in (0.7s) + corner chrome fades/staggers in (0.5s).
2. **Counter** — ghost percentage climbs 0 → 100 (1.95s), running under everything.
3. **Word cycle** — slot-machine of 6 words rips through the centre (0.2s each, ~1.2s total).
4. **Sun solo** — wordmark container appears and the shared sun fades in alone inside the "o" (0.45s) + a short hold (0.2s).
5. **Wordmark resolve** — "rbix" letters spring in from the centre (0.9s) + accent underline draws (0.7s).
6. **Hold** before handoff (0.45s).
7. **Handoff** — chrome/frame/counter/wordmark fade out (0.4s); the dark veil lifts (0.7s); the sun shrinks and flies from the "o" into the hero square (1.1s).
8. **Reveal** — ~0.1s before the flight lands, `REVEAL_EVENT` fires → the hero reveals (headline rises from its masks, the black square "pours" in, tagline settles, 0.4s) → the timeline's `onComplete` unlocks scroll and the intro unmounts.

### Contract 1 — scroll is locked for the entire intro

`IntroSequence` locks scroll on mount (`html.scroll-locked` → `overflow:hidden`, plus
`wheel` / `touchmove` / scroll-key `preventDefault`, plus `history.scrollRestoration =
'manual'` and `scrollTo(0, 0)`) and releases it exactly once in the timeline's
`onComplete`. The component returns `null` when done but **stays mounted**, so never rely
on the effect cleanup to unlock — unlock where the intro actually finishes.

### Contract 2 — no scroll-driven hero animation may exist during the intro

The hero's pinned/scrubbed scroll-expansion ScrollTrigger is created **only when
`REVEAL_EVENT` fires** (after the sun has landed), never on mount. Any new scroll-driven
animation on the hero or the sun must be gated the same way — build it inside the reveal
handler, or create it `disable()`d and `enable()` it on `REVEAL_EVENT`. Otherwise a
restored or stray scroll moves the sun while the loader is still up.

### The shared sun

There is exactly one sun: `HeroSun` → `SunCanvas`. The intro only *drives* it via
`.hero-sun-layer` (outer — opacity + the scroll transform) and `.hero-sun-flight` (inner —
the o → square flight). `REVEAL_EVENT` is the single handoff signal from intro → hero;
anything that must wait for "site ready" should listen for it (with a fallback timeout).

---

## Navbar — entrance & per-section scroll meters

The navbar (`components/layout/Navbar`) is two stacked fixed layers: `.nav-root` holds the
text/links and uses `mix-blend-mode: difference` (auto-inverts against whatever scrolls
under it); `.nav-accent` sits behind it holding everything that must stay brand-cyan (top
line, logo orbital mark, the scroll meters) so the blend never turns it red.

### Entrance (`useNavbarAnimation`)

Plays on `REVEAL_EVENT` — in lockstep with the hero headline — not on mount (with a
fallback timeout if the intro is bypassed). The items converge from four directions at
once, set per item via `data-enter` on the `<li>`: Services `top`, Work `left`, Process
`right`, Contact `bottom`. Logo scales/fades in, CTA slides from the right.

### Per-section scroll meters (the cyan lines)

The old single scroll-progress bar is replaced by one cyan meter per nav item plus one
under the logo. Each meter is a faint always-on track with a fill that scales to its own
section's scroll progress.

How it's wired, so a section "just works" once built:

1. The nav item carries `data-key="<key>"` (see `NAV_ITEMS` in `Navbar.tsx`); the logo's
   meter uses the key `home`.
2. The meter fill scales to `--nav-progress-<key>` (0..1), aliased through `--meter-progress`.
3. **A section feeds its meter by setting `--nav-progress-<key>` on
   `document.documentElement`** from its own ScrollTrigger `onUpdate` (`self.progress`).
   The hero does this for `home` in `useHeroAnimation` — copy that pattern.
4. `useNavbarAnimation` positions each meter under its item by measuring the live layout
   (re-run on resize and once fonts are ready), so no manual coordinates are needed.

Current keys: `home` → hero (wired). `work` / `process` / `contact` → their homepage
sections (just set the var when those are built — no navbar changes needed). `services`
is the deck overlay that lives inside the hero: its nav link has `href="/#services"` but on
the homepage `handleNavClick` intercepts it and dispatches `GOTO_SERVICES_EVENT`, which the
hero pin listens for and scrolls to the revealed fleet (a plain anchor would just jump to the
top of the hero). Its meter isn't fed yet — wire it from the carousel phase if you want one.

---

## General Rules

- No magic numbers. Named constants only — declare them at the top of the file, never inline.
- No commented-out code left in commits.
- Import order: external packages → internal aliases (`@/`) → relative imports.
- `'use client'` only where strictly necessary. Prefer Server Components for static markup; Client Components for animation-heavy or interactive sections.
- Three.js / WebGL imports are **dynamic** (`next/dynamic` with `ssr: false`) when they'd otherwise enter the server graph — they can't run on the server.
- Keep prototype code (`components/prototype/`, `/prototype`) isolated from the live homepage bundle.