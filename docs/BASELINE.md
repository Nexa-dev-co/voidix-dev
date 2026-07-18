# Voidix — Project Baseline (Frozen Reference)

> **Snapshot date:** 2026-06-25 · **Branch:** `enhancement`
>
> **The rule:** This document is a frozen, exhaustive inventory of the project *as it
> exists today* — every component, hook, exported signature, named constant **with its
> value**, custom event, CSS class, and behavioral contract. When edits are made later,
> **nothing described here should change unless that specific edit explicitly required it.**
> Any function that disappears, any constant whose value drifts, any event/contract that
> breaks without being asked for is a regression. Constants are listed with their literal
> values precisely so that drift shows up in a diff.
>
> **Accuracy note:** this reflects the *actual source*, which diverges from the older
> `CLAUDE.md` narrative. There are **no** `components/loaders/` registry, no `Marquee` /
> `Statement` / `WorkGrid` / `Process` / `CtaBanner` sections, and **no `/prototype` page**
> in the current code. The real surface is documented below.

---

## 1. Stack & Configuration

### `package.json`
- `name` `voidix` · `version` `0.1.0` · `private` true
- **Scripts:** `dev` → `next dev` · `build` → `next build` · `start` → `next start` ·
  `lint` → `next lint` · `optimize:models` → `node scripts/optimizeModels.mjs`
- **Dependencies:** `@gsap/react ^2.1.1`, `@types/three ^0.184.1`, `gsap ^3.12.5`,
  `lenis ^1.1.13`, `lil-gui ^0.21.0`, `lucide-react ^0.451.0`, `next ^14.2.35`,
  `ogl ^1.0.11`, `react ^18.3.1`, `react-dom ^18.3.1`, `three ^0.184.0`
- **DevDependencies:** `@types/node ^20.14.0`, `@types/react ^18.3.3`,
  `@types/react-dom ^18.3.0`, `autoprefixer ^10.4.20`, `postcss ^8.4.47`,
  `tailwindcss ^3.4.13`, `typescript ^5.5.4`

> Note: `lenis`, `lil-gui`, and `ogl` are dependencies but are **not currently imported**
> by any file under `app/`, `components/`, or `lib/`. WebGL is done with `three` directly
> and the fluid sim is a hand-rolled raw-WebGL port (no `ogl`).

### `tailwind.config.ts`
- `content`: `./app/**/*.{js,ts,jsx,tsx,mdx}`, `./components/**/*.{js,ts,jsx,tsx,mdx}`
- `theme.extend.colors`: `bg`, `fg`, `muted`, `accent`, `border`, `card` — each `var(--…)`
- `theme.extend.fontFamily`: `display` → `["var(--font-syne)", "sans-serif"]`;
  `body` → `["var(--font-dm-sans)", "sans-serif"]`
- `theme.extend.letterSpacing`: `eyebrow` → `3px`
- `plugins`: `[]`

### Other config
- `tsconfig.json`: `strict: true`, `noEmit: true`, `module/moduleResolution`: `esnext`/`bundler`,
  `jsx: preserve`, path alias `@/*` → `./*`, excludes `node_modules` and `temp`.
- `next.config.mjs`: `reactStrictMode: true` only.
- `postcss.config.js`: plugins `tailwindcss`, `autoprefixer`.

### Design tokens — `app/globals.css` `:root`
| Token | Value |
|---|---|
| `--bg` | `#060606` |
| `--fg` | `#ebe8e0` |
| `--muted` | `rgba(235, 232, 224, 0.38)` |
| `--accent` | `#00e5ff` |
| `--border` | `rgba(235, 232, 224, 0.08)` |
| `--card` | `#0d0d0d` |

Non-token colors that matter: hero section background `#e2dfd2` (cream); hero text glyph
color `--hero-invert-text: #c0c0c0` (set on `.hero-section`); `::selection` background
`var(--accent)` / color `#000`.

### Fonts (`app/layout.tsx`, `next/font/google`, `display: 'swap'`)
- **Syne** — weights `700`, `800` → `--font-syne` (display). Helper `.font-display`.
- **DM Sans** — weights `300`, `400`, `500` → `--font-dm-sans` (body, the `<body>` default).

### Z-index stack (exact)
| Layer | z-index | Source |
|---|---|---|
| Intro overlay (veil) | `10000` | `OVERLAY_Z_INDEX` in `IntroSequence` |
| Sun **during** intro | `10001` | `Z_DURING_INTRO` in `HeroSun` |
| Navbar `.nav-root` | `9999` | `globals.css` |
| Navbar `.nav-accent` | `9998` | `globals.css` |
| Sun **after** intro | `9500` | `Z_AFTER_INTRO` in `HeroSun` |
| Hero sun square `.hero-sun-card` | `20` | `globals.css` |
| Hero headline `.hero-mask` / tagline `.hero-sub` | `5` | `globals.css` |
| Fluid ink canvas | `3` | `INK_Z_INDEX` |
| Fluid invert canvas | `2` | `INVERT_Z_INDEX` |

---

## 2. App Pages

### `app/layout.tsx` — `RootLayout({ children })` (default export)
Exports `metadata` (title `voidix — software with gravity`, description, `metadataBase
https://voidix.studio`, OpenGraph). Renders `<html lang="en">` with both font variable
classes, `<body>` containing `<Navbar />` then `{children}`.

### `app/page.tsx` — `HomePage()` (default export)
Renders `<main>` with, in order: `<Hero />`, `<ServicesDeck />`, `<HeroSun />`,
`<IntroSequence />`.

### `app/services/page.tsx` — `ServicesPage()` (default export)
Exports `metadata` (title `voidix — the fleet`). Renders `<main><ServicesFleet /></main>`.

---

## 3. Layout — `components/layout/Navbar/Navbar.tsx`

`Navbar()` (default export), no props. Internal refs `navRef`, `accentRef`, `metersRef`;
calls `useNavbarAnimation({ navRef, accentRef, metersRef })`.

**Constants:**
- `NAV_ITEMS` (`as const`) — 4 items `{ key, number, label, href, enter }`:
  - `services` · `01` · `Services` · `/services` · `top`
  - `work` · `02` · `Work` · `#work` · `left`
  - `process` · `03` · `Process` · `#process` · `right`
  - `contact` · `04` · `Contact` · `#contact` · `bottom`
- `HOME_METER_KEY = 'home'`
- `METER_KEYS = [HOME_METER_KEY, ...NAV_ITEMS.map(i => i.key)]` → `['home','services','work','process','contact']`

**Sub-components:** `LinkArrow()` (13×13 SVG arrow), `OrbitalMark()` (26×26, static dashed
circle + center dot + spinning outer node).

**Structure:** an aria-hidden `.nav-accent` layer (cyan, never blended) holding
`.nav-accent-line`, `.nav-accent-logo` (`OrbitalMark` + ghost wordmark), and `.nav-meters`
(one `.nav-meter[data-meter]` per `METER_KEYS`, each with a `.nav-meter-fill` whose
`--meter-progress` aliases `var(--nav-progress-<key>, 0)`); plus the blended `.nav-root`
`<header>` holding the logo, `.nav-items` list, and the `.nav-cta` "Start Project" button
with four `.cta-corner` brackets.

---

## 4. Effects

### `components/effects/IntroSequence/introEvents.ts`
- `REVEAL_EVENT = 'voidix:reveal'` — fired when the sun lands in the hero square.

### `components/effects/IntroSequence/IntroSequence.tsx` — `IntroSequence()` (default export)
State: single `done` boolean (returns `null` when done but stays mounted). Refs: `rootRef`,
`veilRef`, `oSlotRef`, `cycleRef`, `counterRef`.

**Constants:**
- Selectors: `SUN_LAYER_SELECTOR = '.hero-sun-layer'`, `SUN_FLIGHT_SELECTOR = '.hero-sun-flight'`,
  `HERO_SQUARE_SELECTOR = '.hero-sun-card'`
- `CYCLE_WORDS = ['WORLDS','MOTION','ORBIT','STORIES','SIGNAL','STUDIO']`
- `ACCENT_WORD = 'ORBIT'`
- Timing (s): `COUNTER_DURATION = 1.95`, `WORD_STEP = 0.2`, `WORD_START = 0.15`,
  `RESOLVE_DURATION = 0.9`, `SUN_FADE_IN = 0.45`, `SUN_SOLO_HOLD = 0.2`,
  `HOLD_BEFORE_HANDOFF = 0.45`, `CHROME_FADE_OUT = 0.4`, `VEIL_FADE_OUT = 0.7`,
  `SUN_FLIGHT_DURATION = 1.1`, `SETTLE_AFTER_REVEAL = 0.4`, `REDUCED_MOTION_DELAY = 0.3`
- `SUN_IN_O_RATIO = 1.3`, `OVERLAY_Z_INDEX = 10000`
- `SCROLL_LOCK_CLASS = 'scroll-locked'`
- `SCROLL_BLOCK_KEYS = Set([' ','ArrowUp','ArrowDown','PageUp','PageDown','Home','End'])`

**Behavior:** locks scroll on mount (`history.scrollRestoration='manual'`, `scrollTo(0,0)`,
add `scroll-locked`, `preventDefault` on `wheel`/`touchmove` non-passive + scroll keys).
Runs one GSAP timeline: (1) frame + chrome settle; (2) ghost counter 0→100; (3) 6-word
slot-machine cycle; (4) wordmark container + sun fade in alone in the "o" (`parkSunInO`
offsets `.hero-sun-flight` into the `o` slot); (5) "rbix" letters spring in (`back.out(1.7)`,
random rotation, stagger from center) + underline draws; (6) handoff — chrome/frame/counter/
wordmark fade, veil lifts, sun flies back to the square; (7) `revealHero()` dispatches
`REVEAL_EVENT` ~0.1s before landing, then `onComplete` unlocks scroll and sets `done`.
Reduced-motion path: counter=100, sun home, reveal+unlock after `REDUCED_MOTION_DELAY`.
The `i` glyph and `ORBIT` cycle word render in `var(--accent)`.

### `components/effects/FluidCursor/FluidCursor.tsx` — `FluidCursor()` (default export)
Renders two bare sibling `<canvas>` elements (no wrapper), both `position:absolute; inset:0;
pointer-events:none`. Constants `INVERT_Z_INDEX = 2` (mixBlendMode `difference`),
`INK_Z_INDEX = 3` (mixBlendMode `normal`). Calls `useFluidCursor(inkCanvasRef, invertCanvasRef)`.

### `components/effects/FluidCursor/fluidConfig.ts`
- `interface FluidConfig` (8 fields).
- `FLUID_CONFIG`: `simulationResolution: 128`, `dyeResolution: 1024`,
  `densityDissipation: 3.2`, `velocityDissipation: 3.0`, `pressure: 0.8`,
  `pressureIterations: 20`, `curl: 4`, `splatForce: 1600`
- `MIN_BLOB_RADIUS_PX = 15`, `MAX_BLOB_RADIUS_PX = 30`, `SPEED_FOR_MAX_RADIUS = 2.2`
- `INK_COLOR = [0.02, 0.02, 0.03]`, `INK_PEAK_ALPHA = 0.82`, `DYE_TO_PRESENCE = 4.0`,
  `DYE_SPLAT_AMOUNT = 0.3`
- `STAR_CELL_SIZE_PX = 46`, `STAR_FILL_RATIO = 0.55`, `STAR_BRIGHTNESS = 0.85`,
  `STAR_TWINKLE_SPEED = 1.6`, `STAR_PALETTE = [[1,1,1], [0.2,0.4,1]]`

### `components/effects/FluidCursor/fluidSimulation.ts`
- `interface FluidSimulation` — `splat(uvX, uvY, forceX, forceY, radiusPixels): void`,
  `frame(deltaSeconds, elapsedSeconds): void`, `resize(): void`, `dispose(): void`.
- `createFluidSimulation(canvas: HTMLCanvasElement, config: FluidConfig): FluidSimulation | null`
  — hand-rolled raw-WebGL GPU fluid solver (Navier–Stokes: curl → vorticity → divergence →
  pressure → gradient-subtract → advect), renders dark ink + procedural stars.

### `components/effects/FluidCursor/fluidShaders.ts` (10 GLSL string exports)
`BASE_VERTEX_SHADER`, `CLEAR_SHADER`, `SPLAT_SHADER`, `ADVECTION_SHADER`, `DIVERGENCE_SHADER`,
`CURL_SHADER`, `VORTICITY_SHADER`, `PRESSURE_SHADER`, `GRADIENT_SUBTRACT_SHADER`,
`DISPLAY_SHADER`.

---

## 5. Hero

### `components/sections/Hero/Hero.tsx` — `Hero()` (default export)
Refs `heroSectionRef`, `heroCardRef`; calls `useHeroAnimation({ sectionRef: heroSectionRef,
heroCardRef })`. Renders `.hero-section` containing `<FluidCursor />`, the title group
(`.hero-line-top` "we build"; `.hero-line-bottom` = masked `W` + `.hero-sun-card`
[`data-hero-card`, holds `.hero-sun-fill`] + masked `rlds`), and tagline `.hero-sub`
"software with its own gravity". aria-label "we build worlds".

### `components/sections/Hero/HeroSun.tsx` — `HeroSun()` (default export)
Constants: `HERO_SQUARE_SELECTOR = '.hero-sun-card'`, `Z_DURING_INTRO = 10001`,
`Z_AFTER_INTRO = 9500`. Fixed `.hero-sun-layer` (initial inline `175×175`, `opacity:0`,
`zIndex:10001`, `pointerEvents:none`) wrapping `.hero-sun-flight` wrapping a dynamically
imported `<SunCanvas />` (`ssr:false`). On mount syncs the layer to the square's bounding
rect (also on `resize`); on `REVEAL_EVENT` drops `zIndex` to `9500`.

### `components/sections/Hero/SunCanvas.tsx` — `SunCanvas()` (default export)
Renders `<canvas className="sun-canvas" />`. Constants: `SUN_RADIUS = 0.76`,
`CAMERA_FOV = 35`, `CAMERA_Z = 3`, `ROTATION_SPEED = 0.0018`, `SUN_COLOR_CORE = 0xd8f6ff`,
`SUN_COLOR_MID = 0x00d9ff`, `SUN_COLOR_DEEP = 0x012b52`, `NOISE_SCALE = 2.4`,
`FLOW_SPEED = 0.5`, `SURFACE_CONTRAST = 1.35`. `THREE.SphereGeometry(0.76, 64, 64)` with a
`ShaderMaterial` (uniforms `uTime`, `uColorCore/Mid/Deep`, `uNoiseScale`, `uFlowSpeed`,
`uContrast`); renderer DPR-clamped to 2; rotates on Y each frame; `ResizeObserver` on parent.

### `components/sections/Hero/sunShaders.ts`
- `SUN_VERTEX_SHADER`, `SUN_FRAGMENT_SHADER`. Fragment constants: `FBM_OCTAVES = 5`,
  `FBM_INITIAL_AMP = 0.5`, `FBM_LACUNARITY = 2.0`, `FBM_GAIN = 0.5`, `WARP_FREQUENCY = 1.6`,
  `WARP_STRENGTH = 0.35`, `HEAT_DEEP_EDGE = 0.05`, `HEAT_MID_EDGE = 0.55`,
  `FLARE_FREQUENCY = 2.1`, `FLARE_SHARPNESS = 3.0`, `FLARE_INTENSITY = 0.6`,
  `LIMB_DARKEN_FLOOR = 0.45`, `LIMB_DARKEN_POWER = 2.0`, `RIM_POWER = 3.5`,
  `RIM_INTENSITY = 0.9`. Uses Ashima Arts 3D simplex noise. Fully procedural (no texture map).

---

## 6. Services Deck (homepage carousel)

### `components/sections/ServicesDeck/ServicesDeck.tsx` — `ServicesDeck()` (default export)
State `activeIndex` (0). Dynamically imports `DeckCanvas` (`ssr:false`). Calls
`useDeckCarousel(sectionRef, setActiveIndex, DECK_SERVICES.length)` → `{ goTo }`.
`handleFlick(direction) = goTo(activeIndex + direction)`. Renders `.services-deck` with
`.deck-backdrop`, `<DeckCanvas activeIndex onFlick={handleFlick} />`, and `.deck-overlay`
(header eyebrow "The Fleet" + title "One craft at a time. Bring it online.", a keyed
`.deck-detail` panel, and a `.deck-carousel` `<nav>` of 4 buttons → `goTo(index)`).

### `components/sections/ServicesDeck/deckServices.ts`
- Vessel path consts: `WEB_VESSEL = '/models/spaceship.glb'`,
  `MOBILE_VESSEL = '/models/spaceship3.glb'`,
  `ENTERPRISE_VESSEL = '/models/cargo_spaceship.glb'`,
  `AI_VESSEL = '/models/star_aventure_spaceship_starship_fighter.glb'`
- `interface DeckService` (index, name, eyebrow, description, capabilities[], modelPath,
  colorCore, colorEdge).
- `DECK_SERVICES` (4):
  1. `01` **Web Experiences** — WEB_VESSEL — core `#2f6ad0` / edge `#22ecff`
  2. `02` **Mobile Systems** — MOBILE_VESSEL — core `#1aa79c` / edge `#6cf2d0`
  3. `03` **Enterprise Platforms** — ENTERPRISE_VESSEL — core `#4a6a9a` / edge `#9fe6ff`
  4. `04` **Artificial Intelligence** — AI_VESSEL — core `#7a4ad0` / edge `#36e6ff`

### `components/sections/ServicesDeck/DeckCanvas/DeckCanvas.tsx` — `DeckCanvas({ activeIndex, onFlick })` (default export)
Props `activeIndex: number`, `onFlick: (direction: number) => void`. State `status: DeckStatus`
(initial `{ isLoading: true, percent: -1 }`). Calls `useServicesDeck({ canvasRef, activeIndex,
onFlick, onStatus: setStatus })`. Renders `.deck-canvas-wrap` → `.deck-canvas` + `.deck-loading`.

### `components/sections/ServicesDeck/hooks/useDeckCarousel.ts`
- `DECK_REVEAL_EVENT = 'deck:reveal'` (fired on every section reveal/re-entry).
- Constants: `VIEWPORTS_PER_STEP = 1`, `REVEAL_DURATION = 0.6`, `HIDE_DURATION = 0.4`,
  `GOTO_DURATION = 0.6`, `SNAP_DURATION = 0.5`, `REVEAL_FALLBACK_MS = 7000`,
  `CANVAS_WRAP_SELECTOR = '.deck-canvas-wrap'`, `OVERLAY_SELECTOR = '.deck-overlay'`.
- `useDeckCarousel(sectionRef, setActiveIndex, count): { goTo: (index) => void }`. Registers
  `ScrollTrigger`+`ScrollToPlugin`. Arms the pin on `REVEAL_EVENT` (or fallback): pins the
  section, `end = steps*VIEWPORTS_PER_STEP*100%` (`steps = max(count-1,1)`), snaps to `1/steps`,
  `onEnter`→reveal (fades stage in, dispatches `DECK_REVEAL_EVENT`), `onLeaveBack`→hide,
  `onUpdate`→`setActiveIndex(round(progress*steps))`. `goTo` scrolls to a craft's snap point
  (or sets index directly before the pin exists). `goTo` is stable across renders.

### `components/sections/ServicesDeck/hooks/useServicesDeck.ts`
- `interface DeckStatus { isLoading; percent }`; internal `DeckShip` (stage/lift/spin/
  materials/colorCore/colorEdge/litState/presence) and `PreparedVessel`.
- `useServicesDeck({ canvasRef, activeIndex, onFlick, onStatus }): void`.
- **Constants (exact):**
  - Framing: `CAMERA_FOV = 34`, `CAMERA_DISTANCE = 8.2`, `CAMERA_HEIGHT = 1.7`, `CAMERA_LOOK_Y = 0.75`
  - Pad: `GROUND_Y = 0`, `PAD_MODEL_PATH = '/models/space_landing.glb'`,
    `PAD_TARGET_WIDTH = 5.0`, `PAD_Y_OFFSET = 0.6`, `PAD_COLOR = 0x16222b`,
    `PAD_EMISSIVE_COLOR = 0x0b3a45`, `PAD_EMISSIVE_INTENSITY = 0.55`
  - Starfield: `STAR_COUNT = 1200`, `STAR_INNER_RADIUS = 18`, `STAR_OUTER_RADIUS = 60`,
    `STAR_SIZE = 0.16`, `STAR_OPACITY = 0.85`, `STAR_DRIFT = 0.006`
  - Fleet: `DRACO_DECODER_PATH = '/draco/'`, `TARGET_SIZE = 2.3`, `BASE_YAW = -0.6`,
    `SHIP_HOVER = 0.05`, `FLOAT_AMPLITUDE = 0.06`, `FLOAT_SPEED = 1.1`
  - Shadow: `SHADOW_TEXTURE_PX = 256`, `SHADOW_SIZE = 2.2`, `SHADOW_OPACITY = 0.5`, `SHADOW_LIFT = 0.01`
  - Lighting: `KEY_LIGHT_COLOR = 0xfff2e2`, `KEY_LIGHT_INTENSITY = 2.6`,
    `FILL_LIGHT_COLOR = 0x9aa7bb`, `FILL_LIGHT_INTENSITY = 0.5`, `RIM_LIGHT_COLOR = 0x00e5ff`,
    `RIM_LIGHT_INTENSITY = 0.7`, `AMBIENT_INTENSITY = 0.16`, `ENV_MAP_INTENSITY = 1.2`,
    `TONE_MAPPING_EXPOSURE = 1.18`
  - Hull: `FRESNEL_POWER = 2.2`, `DORMANT_BRIGHTNESS = 0.5`, `ACTIVE_BRIGHTNESS = 1.2`,
    `LIT_EMISSIVE_INTENSITY = 1.3`
  - Swap: `SWAP_OUT_DURATION = 0.5`, `SWAP_GAP = 0.06`, `SWAP_IN_DURATION = 0.62`,
    `SWAP_OFFSET_X = 3.6`, `SWAP_OFFSET_Y = 0.55`, `SWAP_BANK = 0.5`,
    `SWAP_ENTER_SCALE = 0.6`, `SWAP_EXIT_SCALE = 0.7`
  - Drag/flick: `DRAG_YAW_SENSITIVITY = 0.006`, `DRAG_PITCH_SENSITIVITY = 0.004`,
    `DRAG_YAW_CLAMP = 1.0`, `DRAG_PITCH_CLAMP = 0.45`, `SPRING_DURATION = 0.9`,
    `FLICK_DISTANCE_PX = 110`
- **Rig hierarchy:** `stage` (carousel fly-on/off) → `lift` (hover + float bob) → `spin`
  (BASE_YAW + drag yaw/pitch) → loaded vessel group. Renderer uses `NeutralToneMapping`,
  `RoomEnvironment` PMREM IBL, key/fill/rim directional lights + ambient. Only the centred
  craft floats. Internal helpers: `createShadowTexture`, `createStarfield`, `collectMaterials`,
  `setupHullTint` (two-color fresnel mix via `onBeforeCompile`), `prepareVessel`,
  `applyLitState`, `applyOpacity`, `parkShip`, `enterShip`, `exitShip`, `snapToCenter`,
  `setStage`, `replayEntrance` (on `DECK_REVEAL_EVENT`). Setup effect runs once; a second
  effect calls `setStageRef.current(activeIndex)` on index change.

---

## 7. Services Fleet (`/services` page)

### `components/sections/ServicesFleet/ServicesFleet.tsx` — `ServicesFleet()` (default export)
State `activeIndex` (0), `selectionToken` (0, bumped on every pick). Dynamically imports
`FleetViewer` (`ssr:false`). `selectService(index)` sets index + bumps token; index buttons
fire it on **both** click and `mouseEnter`. Renders `.services-page` → `<FleetViewer
modelPath selectionToken />` + `.services-overlay` (head "Six disciplines, one gravity.",
`.services-index` list of 6, keyed `.services-detail`, footer counter `NN / 06` + hint).

### `components/sections/ServicesFleet/servicesData.ts`
- `interface FleetService` (index, name, eyebrow, description, capabilities[], modelPath).
- `PLACEHOLDER_VESSEL = '/models/spaceship.glb'`.
- `FLEET_SERVICES` (6): `01` Custom Web Applications → PLACEHOLDER_VESSEL ·
  `02` SaaS Platforms → `/models/episode_77_-_spaceship.glb` ·
  `03` Enterprise CRM Systems → `/models/helicopter_space_ship.glb` ·
  `04` Mobile Applications → `/models/star_aventure_spaceship_starship_fighter.glb` ·
  `05` AI Solutions → `/models/ship_lkj.glb` ·
  `06` Digital Product Design → `/models/starship3.glb`

### `components/sections/ServicesFleet/FleetViewer/FleetViewer.tsx` — `FleetViewer({ modelPath, selectionToken })` (default export)
State `status: FleetViewerStatus` (initial `{ isLoading: true, percent: -1 }`). Calls
`useFleetViewer({ canvasRef, modelPath, selectionToken, onStatus: setStatus })`. Renders
`.fleet-viewer` → `.fleet-viewer-glow` + `.fleet-canvas` + `.fleet-loading`.

### `components/sections/ServicesFleet/hooks/useFleetViewer.ts`
- `interface FleetViewerStatus { isLoading; percent }`; internal `PreparedVessel`.
- `useFleetViewer({ canvasRef, modelPath, selectionToken, onStatus }): void`. Module-level
  `vesselCache = new Map<string, PreparedVessel>()` (persists across remounts; not disposed).
- **Constants:** `CAMERA_FOV = 32`, `CAMERA_DISTANCE = 6.2`, `CAMERA_HEIGHT = 0.5`,
  `TARGET_SIZE = 2.6`, `DESKTOP_OFFSET_X = 0.95`, `DESKTOP_MIN_ASPECT = 1`,
  `AUTO_ROTATE_SPEED = 0.0024`, `FLOAT_AMPLITUDE = 0.09`, `FLOAT_SPEED = 0.85`,
  `PARALLAX_STRENGTH = 0.28`, `PARALLAX_EASE = 0.055`, `STAR_COUNT = 700`,
  `STAR_FIELD_SIZE = 26`, `STAR_DRIFT_SPEED = 0.008`, `EXIT_DURATION = 0.45`,
  `ENTRANCE_DURATION = 1.05`, `ENTRANCE_SPIN = Math.PI * 0.6`, `ENTRANCE_SCALE_FROM = 0.72`.
- Renderer uses `ACESFilmicToneMapping`, exposure `1.05`, `RoomEnvironment` IBL; lights
  key `0xffffff @2.2`, fill `0x6f8cff @0.6`, rim `0x00e5ff @1.6`, ambient `0xffffff @0.25`.
  Rig `placement → pivot (parallax + float) → spin (auto-rotate) → vessel`. `swapTo` fades
  the outgoing vessel out then loads/mounts the next (token-guarded against races); re-picking
  the same path replays the entrance. Persistent effect once; selection effect on
  `[modelPath, selectionToken]`.

---

## 8. Lib

### `lib/prefersReducedMotion.ts`
- `prefersReducedMotion(): boolean` — true when `(prefers-reduced-motion: reduce)` matches
  (SSR-safe).

### `lib/hooks/useFluidCursor.ts`
- `useFluidCursor(inkCanvasRef, invertCanvasRef): void`. Constants `MAX_DEVICE_PIXEL_RATIO = 2`,
  `MAX_FRAME_SECONDS = 1/60`. Bails on reduced motion / missing canvases / no 2D context.
  Sizes both canvases to viewport×DPR, creates the sim from `FLUID_CONFIG`, idles when the
  hero is off-screen (`IntersectionObserver`), splats on `mousemove`/`touchmove` (blob radius
  from cursor speed, force from `splatForce`), and each frame renders the sim then copies the
  ink silhouette to the invert canvas as a white `source-in` mask.

### `lib/hooks/useHeroAnimation.ts`
- `interface HeroAnimationRefs { sectionRef; heroCardRef }`. `useHeroAnimation(refs): void`.
  Registers `ScrollTrigger`. Helper `measureCardLayout`.
- Constants: `SCROLL_SCRUB = 1.8`, `SCROLL_END = '+=220%'`, `SUN_SCROLL_SCALE = 1.1`,
  `SUN_SCROLL_RISE = 200`, `TEXT_WIPE_DURATION = 0.9`, `TEXT_WIPE_STAGGER = 0.12`,
  `SQUARE_FILL_DURATION = 1.1`, `SUB_FADE_DURATION = 0.6`, `FILL_START = 0.25`,
  `FULL_CLIP = 'inset(0% 0 0 0)'`, `EMPTY_CLIP = 'inset(100% 0 0 0)'`,
  `REVEAL_FALLBACK_MS = 7000`, `SUN_LAYER_SELECTOR = '.hero-sun-layer'`.
- On mount hides text (`yPercent:115`), square fill (EMPTY_CLIP), subline. On `REVEAL_EVENT`
  (or fallback) builds the pinned scroll-expansion (square → fullscreen, sun → centre, scale
  `1.1`, rise `200`, feeding `--nav-progress-home` from `self.progress`) and plays the reveal
  timeline (headline rises `power4.out`; square "water fill" `power2.inOut`; tagline fades).

### `lib/hooks/useNavbarAnimation.ts`
- `interface NavbarAnimationRefs { navRef; accentRef; metersRef }`. `useNavbarAnimation(refs): void`.
  Helper `enterOffset(direction)`. Constants `ENTRANCE_DURATION = 0.85`, `ENTER_DISTANCE = 36`,
  `ENTRANCE_FALLBACK_MS = 7200`, `HOME_METER_KEY = 'home'`. `positionMeters()` measures each
  item / the logo wordmark to set each `.nav-meter` `left`/`width` (on mount, `resize`, and
  `document.fonts.ready`). `playEntrance()` on `REVEAL_EVENT` (or fallback): fades nav+accent,
  scales the logo in, converges items from their `data-enter` directions (`expo.out`), slides
  the CTA in, then positions + reveals the meters.

---

## 9. Public Assets

- `public/draco/`: `draco_decoder.js`, `draco_decoder.wasm`, `draco_wasm_wrapper.js`
  (path `/draco/`, used by the deck's `DRACOLoader`).
- `public/models/`: `spaceship.glb`, `spaceship2.glb`, `spaceship3.glb`, `cargo_spaceship.glb`,
  `space_landing.glb`, `star_aventure_spaceship_starship_fighter.glb`,
  `helicopter_space_ship.glb`, `episode_77_-_spaceship.glb`, `wip_weird_sh_ship.glb`.
- `public/textures/planets/`: `2k_ceres_fictional.jpg`, `2k_eris_fictional.jpg`,
  `2k_haumea_fictional.jpg`, `2k_makemake_fictional.jpg`, `2k_moon.jpg`.
- `public/textures/sun/`: `Gemini_Generated_Image_4t1f6s4t1f6s4t1f.png`.

> **Model assignments are in flux — not part of the freeze.** Model→service mapping lives in
> `deckServices.ts` (DECK) and `servicesData.ts` (FLEET); these `modelPath` values are expected
> to change as vessels are reassigned, so they are **data, not a frozen contract**. The hooks
> (`useServicesDeck`, `useFleetViewer`) and their constants are what's frozen, not the paths.
>
> **Current state to be aware of (don't silently "fix"):**
> - `FLEET_SERVICES` references `/models/ship_lkj.glb` (05) and `/models/starship3.glb` (06),
>   **neither of which exists** in `public/models/` — those picks hit `GLTFLoader`'s error path.
>   These are known placeholders slated to be reassigned.
> - `spaceship2.glb` and `spaceship3.glb` have been **changed to different vessels** than they
>   were originally; don't assume their visual identity from the filename. `spaceship3.glb` is
>   referenced by the DECK's `MOBILE_VESSEL`; `spaceship2.glb` is currently **unreferenced**.
> - `wip_weird_sh_ship.glb` and the `public/textures/*` images are **not referenced** by any
>   current source file. `SunCanvas` is fully procedural and does **not** use the sun texture.

---

## 10. Cross-Cutting Contracts (do not break without intent)

### Custom events
| Event | Constant | Fired by | Listened by |
|---|---|---|---|
| `voidix:reveal` | `REVEAL_EVENT` | `IntroSequence` (sun lands) | `useHeroAnimation`, `useNavbarAnimation`, `useDeckCarousel`, `HeroSun` |
| `deck:reveal` | `DECK_REVEAL_EVENT` | `useDeckCarousel` (section reveal/re-entry) | `useServicesDeck` (replays staged craft entrance) |

### Scroll-lock (intro)
`IntroSequence` locks scroll on mount (`scroll-locked` class on `<html>` → `overflow:hidden`,
plus non-passive `wheel`/`touchmove` blockers, scroll-key blockers, `scrollRestoration='manual'`,
`scrollTo(0,0)`) and releases it **exactly once** in the timeline `onComplete` (the component
returns `null` but stays mounted — do not rely on effect cleanup to unlock). Reduced-motion and
the cleanup path also unlock.

### No scroll-driven hero animation during the intro
The hero's pinned/scrubbed scroll-expansion `ScrollTrigger` is created **only** inside the
`REVEAL_EVENT` handler (`createScrollExpansion`), never on mount — with a 7s fallback. Any new
scroll-driven hero/sun animation must be gated the same way.

### Single shared sun
There is exactly one sun: `HeroSun` → `SunCanvas`. The intro only *drives* it via
`.hero-sun-layer` (outer: opacity + scroll transform) and `.hero-sun-flight` (inner: o→square
flight). `REVEAL_EVENT` is the single intro→hero handoff signal.

### Navbar per-section scroll meters
Each section sets `--nav-progress-<key>` (0..1) on `document.documentElement` from its own
ScrollTrigger `onUpdate`. Keys: `home` → hero (wired in `useHeroAnimation`); `work` / `process`
/ `contact` are reserved (their sections don't exist yet, so those meters auto-hide via
`positionMeters`). `services` points at `/services` and has no meter. `useNavbarAnimation`
positions meters by live measurement — no hardcoded coordinates.

### Reduced motion
Every major animation checks `prefersReducedMotion()` (or the media query directly) and
skips/simplifies: intro resolves fast, hero/navbar present their end states, the deck snaps
without swaps and disables drag, the fleet skips entrance/parallax, and `FluidCursor` is
**disabled entirely**. `globals.css` also force-shortens all animations/transitions under
`prefers-reduced-motion: reduce`.

### Dynamic / SSR boundaries
`SunCanvas`, `DeckCanvas`, and `FleetViewer` are imported via `next/dynamic` with `ssr:false`
so `three` and WebGL stay out of the server graph. WebGL canvases sit behind content and never
block scroll/pointer (except the deck canvas, which accepts pointer drag).

---

## 11. Homepage CSS surface (`app/globals.css`) — class index

Base/typography: `.font-display`, `.eyebrow`, `html.scroll-locked`, `::selection`.
Keyframes: `orbital-node-spin` (6s), `fleet-spin` (0.9s), `fleet-detail-in` (0.6s),
`deck-detail-in` (0.6s).
Navbar: `.nav-root` (z 9999, `mix-blend-mode:difference`), `.nav-accent` (z 9998),
`.nav-accent-line`, `.nav-accent-logo`, `.nav-ghost`, `.nav-mark-spacer` (26×26),
`.nav-logo`, `.nav-wordmark`, `.orbital-mark`/`.orbital-static`/`.orbital-spinning`,
`.nav-items`, `.nav-item`, `.nav-link` (+ `-text`/`-label`/`-number`/`-arrow`), `.nav-cta`
(+ `.cta-corner` `.cta-tl/tr/bl/br`), `.nav-meters`, `.nav-meter`, `.nav-meter-fill`.
Hero: `.hero-section` (`#e2dfd2`, `--hero-invert-text:#c0c0c0`), `.hero-main`,
`.hero-title-group`, `.hero-line-top`, `.hero-line-bottom`, `.hero-letter`,
`.hero-sun-card` (175×175, z 20), `.hero-sun-fill`, `.sun-canvas`, `.hero-mask`/`-inner`
(z 5, difference), `.hero-sub` (z 5, difference).
Services (`/services`): `.services-page`, `.fleet-viewer`, `.fleet-canvas`,
`.fleet-viewer-glow`, `.fleet-loading`(`.is-visible`)/`-ring`/`-label`, `.services-overlay`,
`.services-head`, `.services-title`, `.services-body`, `.services-index`,
`.services-index-item`(`.is-active`)/`-number`/`-name`/`-line`, `.services-detail`(+ `-eyebrow`/
`-copy`), `.services-tags`/`.services-tag`, `.services-foot`, `.services-counter`(+ `-current`/
`-divider`/`-total`), `.services-hint`.
Services Deck: `.services-deck` (`margin-top:-100vh`), `.deck-backdrop`, `.deck-canvas-wrap`
(opacity 0 initial), `.deck-canvas`, `.deck-loading`(`.is-visible`)/`-ring`/`-label`,
`.deck-overlay`, `.deck-head`/`-intro`, `.deck-title`, `.deck-detail`(+ `-eyebrow`/`-copy`/
`-tags`/`-tag`), `.deck-carousel` (`mix-blend-mode:difference`), `.deck-carousel-item`
(`.is-active`)/`-number`/`-name`/`-line`.
Responsive: `@media (max-width: 820px)` restyles `.services-*` and `.deck-*` overlays.
