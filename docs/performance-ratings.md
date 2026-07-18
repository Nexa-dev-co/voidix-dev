# Performance cost ratings — features & models

> **How to read this.** These are **relative estimates from reading the code** — shader complexity, number
> of render passes, texture resolutions, and shipped asset sizes — **not profiler numbers**. They tell you
> where the budget *concentrates* and what to reach for first, not exact milliseconds. Scale is `●` out of 5
> (`●●●●●` = heaviest on the site, `●○○○○` = negligible). Measure before trusting any single cell.

**Dimensions**
- **GPU/frame** — per-frame draw cost while the thing is on screen (shaders, passes, fill).
- **CPU/frame** — per-frame JS/DOM work.
- **VRAM** — resident GPU memory (textures, framebuffers, geometry).
- **Load** — download + decode cost the first time it's needed.
- **Gated** — does it already stop working when it can't be seen?

---

## 1. Features / effects

| Feature | GPU/frame | CPU/frame | VRAM | Load | Active in | Gated? |
|---|:---:|:---:|:---:|:---:|---|---|
| **WorksField + Chamber** | ●●●●● | ●●●○○ | ●●●●● | ●●●●○ | works, chamber | ✅ off-screen + tab-hidden |
| **ServicesDeck** | ●●●●○ | ●●●○○ | ●●●○○ | ●●●○○ | services | ✅ off-screen / parked / tab |
| **FluidCursor** (+ invert canvas) | ●●●●○ | ●●●○○ | ●●●○○ | ○○○○○ | hero | ✅ idle-when-still + off-hero |
| **SunCanvas** | ●●●○○ | ●○○○○ | ●○○○○ | ○○○○○ | hero (+ state ramps) | ✅ demand-render (new) |
| **ConstellationFrame** (2D) | ●●○○○ | ●●●○○ | ●○○○○ | ○○○○○ | hero | ✅ off-screen / services |
| **HeroInstruments HUD** (DOM) | ○○○○○ | ●●○○○ | ○○○○○ | ○○○○○ | hero (loops run through rest) | ⚠️ partial — see `performance-plan.md` §5a |
| **IntroSequence** | ●○○○○ | ●●○○○ | ○○○○○ | — | once, ~6s | n/a (one-shot) |
| **Navbar** | ○○○○○ | ●○○○○ | ○○○○○ | ○○○○○ | always | n/a |

### Why each lands where it does

- **WorksField + Chamber — the heaviest.** Two `EffectComposer` chains per drawn frame: the space
  (meteors + 260 instanced shards + 1400 star points + fire shader) → **UnrealBloom** (a multi-level blur
  pyramid, the single most expensive pass on the site) → then the screen composer (present quad *or* the
  chamber room with the podium/table models) → **OutputPass + SMAA**, all at 4× MSAA and adaptive DPR. Also
  the **VRAM king** (the podium — see §2). Already gated hard, so it costs nothing until you reach Works.
- **ServicesDeck — heavy, but contained.** One composer (RenderPass + UnrealBloom + SMAA), a ship model, a
  landing pad, 1200 stars, a PMREM environment, and a fresnel hull shader. Bloom again. Fully gated: it even
  drops its whole bloom pipeline when parked behind Works.
- **FluidCursor — the hero's hot-spot.** A GPU fluid solve every active frame (the ~27 velocity/pressure
  passes are cheap at 128², but the **1024² dye advection + full-viewport display + a full-viewport 2D
  `drawImage`/`fillRect` composite** are not) plus a second full-viewport canvas. Now idled when the pointer
  is still, so the cost only exists while you're actively moving the cursor on the hero.
- **SunCanvas — moderate, now mostly idle.** Cheap geometry (a 64² sphere) but a **5-octave 3D-simplex FBM
  with domain warp per fragment**, which gets real when the sun fills the viewport. Now demand-rendered, so
  it only draws while the calm hero sun churns or the state ramps — the frozen services/works/chamber span
  is free.
- **ConstellationFrame — CPU, not GPU.** A 2D-canvas starfield: a spatial hash rebuilt each frame + dots &
  links drawn with easing. Modest CPU, tiny GPU. Already has a low-power config and idles off-hero.
- **HeroInstruments HUD — small CPU, currently un-gated.** Two rAF loops doing pointer math + a few
  `textContent` writes; no GPU. They keep running through services/works/chamber where the HUD is hidden —
  the one remaining easy invisible win (`performance-plan.md` §5a).

---

## 2. Models & textures

Per-frame draw cost is already folded into the scene ratings above; this table is about **VRAM + load**,
where the models actually weigh.

| Asset | Used by | Shipped size | VRAM | Load | Notes |
|---|---|---|:---:|:---:|---|
| **podium-512 / -1024** | Chamber | 0.99 MB / 1.4 MB | ●●●●● | ●●●●○ | The heavyweight — **entirely because of textures, not geometry or screen size**. It carries **27 maps at 4096²** ≈ **2.3 GB** of VRAM as authored. The resolution cap does all the work: **512 → ~36 MB**, **1024 → ~144 MB**, and the runtime picks the tier from *measured* fps (`performanceTier.ts`) — the one true device-adaptive asset decision on the site. Its 144k verts are a rounding error next to that. ⚠️ `performanceTier.ts`'s comment still quotes "36 maps / ~192 MB", which are the **dropped cloning-tank chamber's** numbers, not the podium's. |
| **table.glb** | Chamber | 0.64 MB | ●●○○○ | ●●○○○ | Geometry-heavy (raw 10.9 MB), one small map. ~3 MB VRAM. |
| **meteor.glb** | WorksField | Draco | ●○○○○ | ●●○○○ | One shared body, normalized to unit radius and cloned for all 4 projects. |
| **ship glbs ×4** (`spaceship`, `spaceship3`, `cargo_spaceship`, `star_…fighter`) | ServicesDeck | Draco each | ●●○○○ | ●●●○○ | Loaded per active craft on swap, not all at once. |
| **space_landing.glb** (pad) | ServicesDeck | Draco | ●○○○○ | ●○○○○ | Small. |
| **meteor textures** (`stone`, `stone2`, `normal`, `fire_meteor`) | WorksField | ~few MB total | ●●○○○ | ●●○○○ | Streamed; the intro's loader gate waits on them. |
| **Sun** | Hero | — | ○○○○○ | ○○○○○ | **Fully procedural** — no model, no texture. |

All models are **Draco-compressed** (`scripts/optimizeModels.mjs`) and loaded lazily per-section, off the
first paint.

---

## 3. Per-section rollup — what's actually running where

```
   SECTION        heaviest things live at once                 relative total
  ─────────────  ───────────────────────────────────────────  ───────────────
   Intro          IntroSequence (once) + Sun (churning)         ●●○○○
   HERO           FluidCursor + Sun + Constellation + HUD        ●●●●○   ← most simultaneous on a weak GPU
   Services       ServicesDeck (bloom) + Sun (frozen→idle)       ●●●●○
   Works          WorksField (bloom, meteors, shards)            ●●●●●
   Chamber        WorksField pipeline + podium/table + hologram  ●●●●●   ← + peak VRAM (podium)
  ─────────────────────────────────────────────────────────────────────────
   (Sun/Fluid/Constellation are gated off or idled outside the hero; Deck & Works
    gate each other off — so only ONE heavy 3D scene draws at a time past the hero.)
```

---

## 4. Takeaways

1. **Peak GPU is Works/Chamber; peak "simultaneous load on a weak device" is the Hero** — several effects
   run together there. That's exactly why the recent work targeted the hero (Sun demand-render, Fluid idle).
2. **Peak VRAM is the podium**, and it's the one asset already chosen adaptively from real frame-times.
3. **Bloom (UnrealBloom) is the recurring expensive pass** — in both the deck and works. It's essential to
   the look (the fire, the ship glow), so it stays; it's already reduced in strength + MSAA on low-power.
4. **Only one heavy 3D scene ever draws at a time** past the hero, thanks to the mutual gating — the
   architecture is already doing the biggest structural thing right.
5. Remaining cheap invisible wins are small (HUD loop gating, a works allocation hoist) — see
   `performance-plan.md` §5.

> Ratings are static estimates. To turn them into numbers: Chrome DevTools Performance (or `?tune` +
> the adaptive-resolution snapshot) on a throttled profile, per section.
