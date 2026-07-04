# Works Section — "The Field" · Implementation Plan

> The homepage **Works** section: projects as a navigable field of meteors in space.
> Sibling to [`services-deck-plan.md`](./services-deck-plan.md). Built by **adapting** the
> proven `ServicesDeck` scene + the hero sun's shader, not net-new WebGL.

---

## 1. The idea in one picture

A dark field of drifting **shards** (irregular debris) and **meteors** (clean textured rocks).
Each project is one meteor. The **focused** project's meteor is on **fire** — churning with the
hero sun's *motion* (flow + flares + bloom), but warm and driven by `fire_meteor.jpg`, not the
sun's cyan plasma. Left/Right arrows swap projects; the camera roams the field to reveal more.

```
                          . ·  ✦        ·        ✦   ·  .          (starfield)
              ◹            ▲                              ◺
         ◺        ◹     ▲     ◹        ◹                        ◹     shards
                                                                     (irregular,
     ◹     ◈ (stone)            ((( ☼ )))            ◈ (stone)       instanced,
                                   FIRE                              tumbling)
              ◺        ◹     active project #01    ◹        ◺
         ◹                  ▲            ◺                    ◹
    ◄ prev            ·        ✦                   ·               next ►
   ┌───────────────────────────────────────────────────────────────────┐
   │ WORKS / SELECTED WORK                                       01 / 04 │
   │ Project Title                                                       │
   │ Client · 2026                                                       │
   │ One-paragraph description of the project…                          │
   │ [ Next.js ]  [ WebGL ]  [ Realtime ]                               │
   └───────────────────────────────────────────────────────────────────┘
        ◈ = clean "sapphire" meteor (a project, cool/stone)
      ☼   = the active project's meteor, on fire (sun-style motion)
    ◹ ◺ ▲ = irregular shards (ambient debris — NOT projects)
```

**Locked decisions (from Q&A):**

| Topic | Decision |
|---|---|
| Fire look | **Warm molten** (white-hot → amber → ember) over `fire_meteor.jpg`, sun *motion* only |
| Textures | `public/textures/meteor/` → `fire_meteor.jpg` (active), `stone.jpg` / `stone2.webp` (inactive), `normal.jpg` (bumps) |
| Shapes | Meteors = clean gem shape allowed; **shards = irregular** (so not all perfect) |
| Nav | **◄ Left = prev / Right = next ►**; only the active project's data changes |
| Camera | Roams the field (drag-to-look + travel between meteors) to "see more projects" |
| Projects | **4 placeholders** in a single-source-of-truth file |
| Transition | **Phased** — scene first; ship→meteor / 180° camera handoff second. Sun explosion deferred. |

---

## 2. Interaction model — scroll + arrows converge on one `activeProject`

Mirrors the deck's scroll + flick + label pattern: one source of truth, three ways to drive it.

```
        SCROLL (pinned section)            ARROWS (◄ ►)            DRAG (pointer)
              │                               │                       │
      camera flies through           goTo(prev / next)        orbit/pan camera a
      the field, SNAPS to     ─────► scrolls pin to that ◄──── clamped amount to peek;
      each project meteor            project's snap point        springs back on release
              │                               │                       │
              └───────────────┬───────────────┘                      (look only —
                              ▼                                    does not change project)
                     setActiveProject(i)
                              │
             ┌────────────────┼────────────────────┐
             ▼                ▼                     ▼
   cool old meteor → stone   ignite new → fire   detail panel re-mounts
   (emissive fades out)      (flow + flares +     (keyed to index →
                              bloom ramp in)       re-reveals copy)
             │
             ▼
   feed  --nav-progress-work  (navbar meter fills for free)
```

- **Pin:** own `ScrollTrigger` (not glued to the hero pin). Scroll progress 0→1 across the 4
  meteors with `snap`; after the last it releases and the page continues.
- **Arrows** call the same `goTo` the deck uses (`ScrollToPlugin` jump), so scroll stays the
  single source of truth — no divergent state.
- **Ignite / cool** is a cross-fade of the meteor material (emissive + fire-shader mix), the
  Works analog of the deck's ship swap.

---

## 3. Scene anatomy (the WebGL layer)

```
 useWorksField.ts  (Three.js scene — adapted from useServicesDeck.ts)
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Renderer  (DPR ≤ 2, alpha, NeutralToneMapping)                        │
 │  Camera rig:  dolly ──▶ (scroll travel)                                │
 │               orbit ──▶ (drag-to-look, clamped, springs back)          │
 │  IBL: RoomEnvironment (reused)   Lights: key / fill / rim (reused)     │
 │                                                                        │
 │  Starfield  (createStarfield — reused verbatim)                        │
 │                                                                        │
 │  Shards   → ONE InstancedMesh, ~hundreds, displaced low-poly           │
 │             (Icosahedron/Tetrahedron + per-vertex jitter), random      │
 │             scale/rotation/drift. Stone-tinted. Ambient only.          │
 │                                                                        │
 │  Meteors  → 4 project bodies (faceted octa/icosphere), stone.jpg +     │
 │             normal.jpg, cool tint. A few larger non-project meteors    │
 │             for depth.                                                  │
 │                                                                        │
 │  Active meteor → the fire MATERIAL swaps onto the focused body:        │
 │             fireMeteorShaders.ts (see §5) → bloom.                     │
 │                                                                        │
 │  Post: RenderPass → UnrealBloomPass → OutputPass  (reused pipeline)    │
 └──────────────────────────────────────────────────────────────────────┘
```

---

## 4. File structure (new — mirrors `components/sections/ServicesDeck/`)

```
components/sections/WorksField/
├── WorksField.tsx            # section markup: ◄ ► arrows, keyed detail panel, canvas mount, activeIndex state
├── worksProjects.ts          # 4 placeholder projects (SSOT) + per-project accent/light
├── worksEvents.ts            # WORKS_REVEAL_EVENT (replay field entrance at pin-start)
├── FieldCanvas/
│   └── FieldCanvas.tsx        # next/dynamic ssr:false wrapper + load status  (≈ DeckCanvas)
├── meteorMaterial.ts         # build stone (inactive) + fire (active) materials; ignite/cool; dispose
├── fireMeteorShaders.ts      # sun-style flow/flare/fresnel shader sampling fire_meteor.jpg
└── hooks/
    ├── useWorksField.ts       # the scene: starfield, shards, meteors, fire, camera, drag, bloom, dispose
    └── useWorksScroll.ts      # pin + snap-to-project + activeIndex + --nav-progress-work + goTo
```

**Wiring:**
- `app/page.tsx` → add `<WorksField />` after `<Hero />` / `<HeroSun />` (normal flow, own pin).
- `app/globals.css` → new `.works-field` / `.works-*` block (tokens only, responsive,
  `@media (max-width: 51.25em)`).
- **Navbar:** no change — `work` key already stubbed in `NAV_ITEMS`; the scroll hook just sets
  `--nav-progress-work` and its meter works.

---

## 5. The one new shader — `fireMeteorShaders.ts`

Reuses the sun's *motion recipe*, recolored warm and textured.

```
 sample fire_meteor.jpg (base albedo)
        │
        ▼
 domain-warp UV / coords with snoise(uTime)   ◄── reused from sunShaders.ts (Ashima snoise/fbm)
        │        (surface churns/flows like the sun)
        ▼
 add fbm flares / hot-spots  +  fresnel rim   ◄── reused flare + limb/rim logic
        │
        ▼
 WARM emissive ramp: ember → amber → white-hot ◄── the ONLY real change vs the sun (color)
        │
        ▼
 bright output → UnrealBloomPass → glow
```

- Idle→flare **rhythm** knob like the sun's `SUN_IDLE_SECONDS` / `SUN_SPIN_SECONDS` envelope, so
  the active meteor "breathes" then flares.
- Inactive bodies: plain `MeshStandardMaterial` (stone map + `normal.jpg`, cool tint) from
  `meteorMaterial.ts`. **Ignite/cool** cross-fades emissive strength + the fire mix.
- `/* glsl */`-tagged template, named constants at top, no magic numbers — same house style as
  `sunShaders.ts`.

---

## 6. Reuse map (adapt, don't reinvent)

| Reuse from | What it gives Works |
|---|---|
| `ServicesDeck/hooks/useServicesDeck.ts` | renderer + DPR clamp, `RoomEnvironment` IBL, light rig, **bloom pipeline** (HalfFloat + MSAA), `createStarfield`, low-power path (`pointer:coarse` / `<760px`), reduced-motion gating, `ResizeObserver` resize, `?tune` `lil-gui`, **full dispose block** |
| `Hero/sunShaders.ts` | Ashima `snoise`/`fbm`, domain-warp, flares, fresnel rim → the fire motion |
| `lib/hooks/useHeroAnimation.ts` | single pinned trigger, `invalidateOnRefresh` + `onRefreshInit`, `snap` to indices, `onUpdate` → active + meter, `goTo` via `ScrollToPlugin`, clean kill |
| `ServicesDeck/ServicesDeck.tsx` | markup shape: `dynamic` canvas, keyed detail panel, control strip → the ◄ ► arrows; drag/flick handler shape |
| `lib/measureUntransformedRect.ts`, `lib/prefersReducedMotion.ts` | reused directly |

---

## 7. Data model — `worksProjects.ts` (SSOT, 4 placeholders)

```ts
export interface WorksProject {
  index: string;        // "01"
  title: string;        // display name
  client: string;       // client / context
  year: string;         // "2026"
  description: string;  // one paragraph
  tags: string[];       // capability chips
  accent?: string;      // per-project emissive tint (defaults warm)
  // (meteor uses stone.jpg / stone2.webp when inactive; fire_meteor.jpg when active)
}
export const WORKS_PROJECTS: WorksProject[] = [ /* 4 placeholders */ ];
```

Real copy swapped in later — same discipline as `deckServices.ts`.

---

## 8. Responsiveness · performance · reduced motion (non-negotiable)

- Fluid CSS (`clamp()`/vw); camera reframes on resize (aspect + keep meteors framed at portrait);
  DPR clamped `≤2`.
- **Shards = `InstancedMesh`** → one draw call for hundreds of fragments.
- Low-power path: fewer shards, cheaper fire shader (fewer fbm octaves), softer bloom, no MSAA.
- Reduced motion: static field (no tumble/flow), instant ignite/cool, no drag; scroll-snap +
  arrows still switch.
- Scroll-driven pin survives resize (`invalidateOnRefresh`, function-based values,
  `measureUntransformedRect`; `ignoreMobileResize` already global).

---

## 9. Contracts preserved

- **Intro/hero contracts untouched.** Works sits far below the hero; its `ScrollTrigger` never
  runs during the intro (page scroll-locked at top), so no `REVEAL_EVENT` gating needed — but it
  must not assume the hero pin's scroll length before a `ScrollTrigger.refresh()`.
- **One shared sun only** — Works adds no second sun; its fire is a meteor material.
- Feed `--nav-progress-work` from the pin's `onUpdate` (documented "section feeds its meter"
  pattern); no navbar edits.
- Kill every trigger/timeline/tween; dispose every geometry/material/texture/target on cleanup
  (incl. `bloomPass.dispose()`), copying the deck's discipline.

---

## 10. Phasing

```
PHASE 1  (this plan)                          PHASE 2  (separate change, later)
────────────────────────────                  ─────────────────────────────────
• field: shards + meteors                     • ship 04 ignites + flies away at
• fire material (active meteor)                 the services carousel tail
• ◄ ► arrow nav + drag-to-look                • camera pull-far + 180° into the field
• scroll pin + snap + goTo                     • (visual continuity: ship → fire meteor)
• keyed detail panel                          • sun explosion STILL deferred
• --nav-progress-work meter
• responsive + reduced-motion + low-power
• self-contained camera intro on reveal
→ ships as a working, standalone section
```

---

## 11. Verification

- `npx tsc --noEmit` + `next build` pass (typed SSOT + `*Refs` interfaces; no `any`).
- Drive the real flow (`/run` + browser tools): intro → hero → services → scroll into Works;
  confirm the field reveals, one meteor burns with sun-style motion, shards drift, **◄ ►** swap
  prev/next and only the active detail panel changes, drag looks around, the `work` meter fills,
  scrolling past releases the pin cleanly.
- **Narrow viewport (~375px):** field reframes, arrows/detail readable, no horizontal scroll,
  low-power path active.
- `prefers-reduced-motion`: static field, instant swaps, arrows still work.
- `?tune` opens fire/bloom knobs; never loads without the flag.

---

## 12. Open items (tune during build, not blockers)

- Field spread across depth (how scattered) — dial by eye with `?tune`.
- Inactive meteors: one stone texture vs alternating `stone.jpg` / `stone2.webp` (leaning:
  alternate, for a less uniform field).
```
