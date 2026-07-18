# Services Deck — Build Plan

> Four dormant spacecraft that power on. Homepage section after the hero.
> This document is the source of truth for the build. Each step is self-contained,
> reviewable, and ordered so the section is testable as early as possible.

---

## Context

The homepage (`app/page.tsx`) currently ends after the hero with a `100vh` placeholder.
The next section is **Services**. Per `CLAUDE.md`, it must *demonstrate* Voidix rather than
list bullets: a landing **deck** of four spacecraft sitting dormant, each labelled with a
service. Hovering a ship ignites its lights; clicking it powers the ship up — it steps
forward, lifts into a floating hover, tracks the mouse, and reveals that service's
description. One ship is "active" at a time.

The existing `/services` page (`ServicesFleet`, a single-ship six-service swapper) is
**unrelated and stays untouched**. This is a new, separate experience built for the
homepage under `components/sections/ServicesDeck/`.

### Hard technical gate — Draco

The models were just re-compressed with **Draco** geometry (`npm run optimize:models`,
~3.4 MB total, ~80 MB VRAM for all four). The existing `GLTFLoader` in `useFleetViewer`
has **no `DRACOLoader`**, so it would silently fail to decode the new GLBs. The new
section **must** wire a `DRACOLoader` with a decoder served from `/public/draco/`. This is
Step 1 and is non-negotiable — nothing renders without it.

---

## Locked decisions

| Topic | Decision |
| --- | --- |
| **Location** | New homepage section, replaces the `100vh` placeholder in `app/page.tsx`. |
| **Services (4 of 6)** | Web Experiences, Mobile Systems, Enterprise Platforms, Artificial Intelligence — reusing existing copy from `01 Custom Web Applications`, `04 Mobile Applications`, `03 Enterprise CRM Systems`, `05 AI Solutions` in `servicesData.ts`. Short display names above; rich eyebrow/description/capabilities reused verbatim. |
| **Activation** | Single-active (radio). Clicking another ship returns the current one. Re-clicking the active ship powers it down. |
| **Active framing** | Active ship steps forward / gets emphasis; the others dim and recede. |
| **Hover** | *Any* ship (dormant included) lights up while the pointer is over it; lights fade off on pointer-leave (unless it is the active ship). |
| **Model map (default, one-line tunable)** | Web → `spaceship.glb`, Mobile → `helicopter_space_ship.glb`, Enterprise → `spaceship2.glb`, AI → `ship_lkj.glb`. `episode_77_-_spaceship.glb` held spare. |

---

## State machine (per ship)

- **Dormant** — resting on the ground plane, lights off, slightly dimmed/desaturated.
- **Hover** — engine/emissive glow + per-ship cyan engine light ramp **on**; tiny lift hint.
  Pointer-leave ramps them back off (skipped if the ship is active).
- **Active (clicked)** — eases forward toward the camera + slightly toward centre; the other
  ships dim and ease back; it lifts into a continuous float (sin bob) and yaws/pitches
  toward the mouse; lights stay on; the description panel reveals. Re-clicking it powers it
  down (back to dormant, no active service).

`activeIndex` and `hoverIndex` live in React (`ServicesDeck.tsx`); single-active is enforced
there. The canvas hook receives both and tweens the scene toward the implied per-ship
targets.

---

## Patterns to reuse (do not reinvent)

- **Scene scaffolding** — copy the proven structure from
  `components/sections/ServicesFleet/hooks/useFleetViewer.ts`: renderer
  (`ACESFilmicToneMapping`, `SRGBColorSpace`, `setPixelRatio(min(dpr, 2))`, `alpha:true`),
  `RoomEnvironment` IBL via `PMREMGenerator`, `prepareVessel` (centre + normalise to a
  target size), `ResizeObserver`, and the nested-group rig (`placement → pivot → spin`).
- **Scroll reveal** — `gsap.registerPlugin(ScrollTrigger)` and the lazy/ref pattern from
  `lib/hooks/useHeroAnimation.ts`.
- **Reduced motion** — `prefersReducedMotion()` from `@/lib/prefersReducedMotion`. When
  true: final placement, no float/parallax/step, but hover-lights + activation +
  description still work via instant `gsap.set`.
- **Design tokens** — `--bg`, `--fg`, `--muted`, `--accent` (`#00e5ff`), `--border`. Never
  hardcode a color. `.eyebrow` + `font-display` helpers for labels.
- **Naming / structure rules** — full descriptive names (no abbreviations), named constants
  at top of file (no magic numbers), each component in its own folder, `'use client'` only
  where needed, dynamic `ssr:false` import for anything pulling in `three`.

---

## File map

```
public/
  draco/                         # NEW — Three's bundled Draco decoder (Step 1)
    draco_decoder.wasm
    draco_decoder.js
    draco_wasm_wrapper.js

components/sections/ServicesDeck/ # NEW
  ServicesDeck.tsx                # section markup + overlay + state (default export)
  deckServices.ts                 # DECK_SERVICES data + model map (named export)
  DeckCanvas/
    DeckCanvas.tsx                # canvas wrapper + loading indicator (default export)
  hooks/
    useServicesDeck.ts            # the Three.js scene (named export)

app/page.tsx                      # EDIT — placeholder → <ServicesDeck/>
app/globals.css                   # EDIT — .services-deck / .deck-* token-based styles
```

---

## Steps

> Build in order. Each step ends at a reviewable, testable checkpoint. **Review the diff
> against this document before moving on.**

### Step 1 — Draco decoder available from `/public`  *(unblocks everything)*

- Create `public/draco/` and copy the three files from
  `node_modules/three/examples/jsm/libs/draco/gltf/`:
  `draco_decoder.wasm`, `draco_decoder.js`, `draco_wasm_wrapper.js`.
- **Checkpoint:** files exist under `public/draco/`. (No UI yet.)
- **Why first:** the optimized GLBs are Draco-compressed; without this, every later step
  renders nothing and fails silently.

### Step 2 — Service data (`deckServices.ts`)

- Export `interface DeckService { index; name; eyebrow; description; capabilities; modelPath }`
  and `const DECK_SERVICES: DeckService[]` with the four entries.
- Reuse the existing eyebrow/description/capabilities strings from `servicesData.ts`; set
  short display `name`s (Web Experiences, Mobile Systems, Enterprise Platforms, Artificial
  Intelligence); apply the model map via named path constants at the top.
- **Checkpoint:** `import { DECK_SERVICES }` type-checks; array length 4.

### Step 3 — Section shell + DOM (`ServicesDeck.tsx`) with a placeholder canvas

- `'use client'`. State: `activeIndex: number | null`, `hoverIndex: number | null`.
- Markup: section wrapper, full-width canvas mount area (dynamic import of `DeckCanvas`,
  `ssr:false`), a 4-column **label grid** (number + short name + thin cyan underline),
  and a **description panel** in the lower empty band, `key`ed by active index so it
  re-mounts/re-reveals.
- Wire pointer enter/leave/click on each label → `hoverIndex` / `activeIndex` (radio +
  re-click-to-deactivate). Pass both indices down to the canvas (props).
- For this step `DeckCanvas` can render an empty `<canvas>` so layout/CSS can be tuned
  before WebGL lands.
- Add the `.services-deck` / `.deck-*` CSS block in `globals.css` (tokens only).
- Replace the placeholder div in `app/page.tsx` with `<ServicesDeck/>`.
- **Checkpoint:** scroll past hero → labels + description panel render and respond to
  hover/click in the DOM (underline fills, description swaps). No ships yet.

### Step 4 — Canvas wrapper (`DeckCanvas.tsx`) + hook skeleton (`useServicesDeck.ts`)

- `DeckCanvas.tsx` mirrors `FleetViewer.tsx`: `<canvas ref>` + loading indicator; calls
  `useServicesDeck({ canvasRef, activeIndex, hoverIndex, onStatus })`.
- `useServicesDeck.ts`: persistent setup effect — renderer, scene, camera, IBL, lights,
  ground plane, `ResizeObserver`, render loop, full cleanup. No models yet; just prove a
  lit empty stage renders behind the DOM.
- **Checkpoint:** one WebGL context, empty stage renders, resizes cleanly, disposes on
  unmount (no context-leak warnings).

### Step 5 — Load the four ships (Draco) and place them on the deck

- `GLTFLoader` + `DRACOLoader` (`setDecoderPath('/draco/')`, `setDRACOLoader`). Cache
  prepared vessels by path. Load all four on mount; report progress via `onStatus`.
- Per ship a rig: `slot (worldX, z) → lift (y) → spin (mouse yaw/pitch) → model`. Place
  ships across X at screen fractions `(i + 0.5) / 4`, unprojected to the ship plane so they
  line up **under their DOM labels by construction**; recompute on resize.
- Add a faint token-tinted ground plane + a soft radial contact-shadow sprite under each
  ship for the "landed" read.
- **Checkpoint:** four dormant ships sit in a row, each beneath its label, dim and unlit.
  Resize keeps them aligned.

### Step 6 — Lights: hover ignites, leave extinguishes

- Per ship: emissive-intensity ramp (`material.emissiveIntensity` / emissive color) **plus**
  a small cyan engine `PointLight`. Named constants for off/on intensities and ramp
  durations.
- Drive from `hoverIndex` (through a ref, like `swapToRef`): hovered ship tweens lights on
  + a tiny lift hint; on leave tween off — **unless** it is the active ship.
- **Checkpoint:** hovering any of the four (dormant included) ignites its lights and they
  fade off on leave; active ship keeps its lights.

### Step 7 — Activation: step forward, float, mouse-track; others recede

- Driven by `activeIndex`. Per-ship target `{ lit, lifted, forward, dim }` → GSAP tweens to
  `lift.position.y` (rise), `slot.position.z` + scale (forward step), light/emissive on, and
  a dim factor on the non-active ships (color multiply or reduced env contribution).
- Render loop: active ship floats (`sin` bob) and eases `spin.rotation` toward the
  normalised pointer (reuse `useFleetViewer`'s `PARALLAX_EASE` approach). Dormant ships sit
  still (optional faint idle bob).
- Single-active + re-click-to-deactivate already enforced in `ServicesDeck.tsx`.
- **Checkpoint:** click a ship → steps forward, lifts, floats, tracks mouse; others dim and
  recede; description reveals. Click another → previous returns. Re-click active → powers
  down.

### Step 8 — Scroll reveal + reduced motion + polish pass

- Stagger the four ships settling onto the deck when the section scrolls into view
  (`ScrollTrigger`, pattern from `useHeroAnimation.ts`).
- Reduced motion: final placement, no float/parallax/step; hover-lights + activation +
  description still work via instant `gsap.set`.
- Polish: description-panel reveal timing, label underline easing, loading indicator,
  starfield (optional, cheap), exposure/light tuning.
- **Checkpoint:** full end-to-end run passes the verification list below.

---

## Verification

1. `npm run dev`, scroll past the hero → four ships rest on the deck with labels beneath.
2. Hover each ship/label → its lights ignite and fade off on leave; confirm **all four**
   (dormant included) respond.
3. Click a ship → it steps forward, lifts, floats, tracks the mouse; others dim; the
   description panel reveals that service. Click another → previous returns, new one
   activates. Re-click active → powers down.
4. **Draco proof:** no `DRACOLoader` console error; ships are actually visible (confirms the
   `/draco/` decoder is served and wired).
5. Resize / portrait → labels stay aligned under their ships; layout re-centres.
6. DevTools → emulate `prefers-reduced-motion: reduce` → no float/step animation, but
   hover-lights, activation, and description still work.
7. Throttle CPU → verify ~60fps with all four loaded; confirm a single WebGL context and
   clean disposal on navigation away.

---

## Follow-up steps (queued after Steps 6–8 — user-requested refinements)

These were requested mid-build and are to be done **after** hover/activation/polish land.
They mostly expand and replace the current CSS-class reveal.

### Step 9 — Per-element GSAP reveal (replaces the CSS-class reveal)

- Today the deck reveals as one CSS-class flip (`.is-revealed`). Replace it with **individual,
  staggered GSAP entrances** — the header eyebrow, the title, the glow gradient, **each of
  the four ships**, and each label animate in on their own beat, sequenced over a timeline.
- The **whole section — including the glow gradient** — stays fully hidden until the user has
  scrolled to it **and the hero's black square has fully filled** (tighten the trigger from
  `top 8%` toward "fully scrolled / square at 100%"; depends on Step 10's auto-complete so
  the trigger point is reliably reachable).
- Ships fade/rise individually: drive per-ship material opacity (the materials are already
  collected with `baseOpacity` in `useServicesDeck`) from a staggered GSAP timeline, instead
  of fading the whole canvas wrap at once.

### Step 10 — Scroll auto-complete (snap to the reveal)

- If the user **stops partway** into the deck, after **0.7s** of idle it should **keep
  scrolling on its own** to complete the section (snap the deck fully into place, which also
  fires the reveal). Implement against Lenis + ScrollTrigger (the project's single scroll
  loop) — a snap/auto-scroll to the section end, not a second scroll loop.

### Step 12 — Model color / lighting pass (deferred — needs a screenshot)

- User likes the float but dislikes the **texture / light colour** of the hulls. Levers:
  the cyan **rim light** (`RIM_LIGHT_INTENSITY 1.4` — currently tints every hull cyan),
  `toneMappingExposure`, environment intensity (`PMREMGenerator.fromScene(..., 0.04)`),
  a material colour tint, and the emissive. Tune against a real screenshot **after** 9–11.

### Step 11 — Sun resize + reposition

- `SUN_SCROLL_SCALE` `2 → 1.5` (smaller sun at the end of the hero scroll).
- Raise the sun ~100–150px via a new `SUN_SCROLL_RISE` constant applied to the sun layer's
  final `y` in `createScrollExpansion`. User will fine-tune the exact px after it's wired.
- Both live in `lib/hooks/useHeroAnimation.ts` (see "Sun constant locations" note below).

## Out of scope / notes

- **Navbar meter:** per `CLAUDE.md`, the `services` nav item points at `/services` and has
  no scroll meter — the navbar stays untouched. Optional later: drive a
  `--nav-progress-services` from this section's ScrollTrigger if we want one.
- `/services` (`ServicesFleet`) and all its files are untouched.
- Model→service assignment is one line each in `deckServices.ts` — trivial to swap, and the
  spare `episode_77` model is available.
