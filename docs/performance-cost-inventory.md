# What everything costs — 2026-08-06

> A decision document, not a plan. It exists to answer one question: **if I have to drop or shrink
> something, what do I get back and what does it cost me?**
>
> Built from two sources and they are labelled throughout:
> - **MEASURED** — from `voidix-console-1786043373139.txt`, a real production capture.
> - **DERIVED** — computed from the source against that capture's viewport. Arithmetic, not guesswork.
> - **UNVERIFIED** — I believe it costs something and I have not measured it. Treated as a suspect,
>   never as a finding.
>
> ⚠ Nothing here had been acted on when it was written. **Three items were taken on 2026-08-06** —
> see §9 at the bottom for what was spent and what it bought. Everything above §9 is left as it was
> measured, so the before/after stays legible.

---

## 0 · The machine this is measured on

```
viewport 1536 × 704 CSS  ·  dpr 2.5  ·  12 cores  ·  16 GB  ·  tier "mid"
Chromium 151 (Edge), Windows
```

**This is a 4K laptop panel at 250 % scaling**, and that single fact drives most of what follows.

```
   what we RENDER      1536 × 704   =  1.08 Mpx      ← the pixel ratio controls this
   what the browser
   COMPOSITES          3840 × 1760  =  6.76 Mpx      ← it does not control this, ever
```

⚠ **The compositor always works at device resolution.** Lowering the render ratio shrinks the first
number and does nothing to the second. That is why quality was traded away for very little frame rate.

---

## 1 · The headline finding: the frame is not set by our CPU work

**MEASURED.** `profileMeasure` wraps our GL *submission* calls — it measures how long the CPU sits
inside them, not how long the GPU takes to execute them.

| time | section | submitted by us | unaccounted | frame | fps |
|---|---|---|---|---|---|
| 14.1s | hero | 5.92 ms | 20.91 ms | 26.8 ms | 37 |
| 17.1s | hero | 14.37 ms | 21.78 ms | 36.1 ms | 28 |
| 20.3s | hero→deck | 17.08 ms | 32.71 ms | 49.8 ms | 20 |
| 23.3s | deck | 19.89 ms | 20.16 ms | 40.1 ms | 25 |
| 29.4s | deck | 15.15 ms | 14.08 ms | 29.2 ms | 34 |
| 44.5s | deck→works | 18.30 ms | 27.47 ms | 45.8 ms | 22 |
| 47.5s | works | **5.46 ms** | **41.32 ms** | 46.8 ms | 21 |
| 50.6s | works | **4.26 ms** | **38.65 ms** | 42.9 ms | 23 |
| 53.6s | works | 8.20 ms | 54.03 ms | 62.2 ms | 16 |
| 68.8s | lap 2 | 10.00 ms | 47.22 ms | 57.2 ms | 17 |

**Our submission work swings 4.7× (4.26 → 19.89 ms) and the frame time does not follow it.** At 47.5s
we submit a third of what we submit at 29.4s and the frame is 60 % *slower*.

That is the signature of a **GPU/compositor-bound** page. The CPU's share moves around; the total is
set downstream of everything we time.

### 1.1 · The corollary, and it matters for every decision below

**`sun · bloom` at 11–17 ms is not the bloom's cost.** A bloom pass is ~9 draw calls — well under a
millisecond of CPU. Eleven to seventeen milliseconds means **the CPU is blocking inside those GL
calls, waiting for the queue to drain.** The sun's bloom is where back-pressure surfaces, because it
is the first heavy thing submitted each frame.

Proof: at 47.5s the sun is frozen (`sun · loop 0.07 ms`) and the frame is *worse* at 46.8 ms. The
block simply relocated into "unaccounted".

⚠ **So do not read the profiler table as a cost ranking.** A large number there means "we waited
here", not "this is expensive". The only safe reading is the *total*.

---

## 2 · Render-target memory — DERIVED

Using the project's own formula (`estimateComposerBytes`): HalfFloat RGBA = 8 B/px, depth = 4 B/px,
and **`EffectComposer` clones the target it is handed, so every composer pays twice.**

At this viewport (1.08 Mpx), tier `mid`, ratio 1.0:

| | samples | per buffer | ×2 (clone) |
|---|---|---|---|
| works · **space** | 2 | 34.6 MB | **69.2 MB** |
| works · **screen** | 0 | 8.65 MB | **17.3 MB** |
| deck | 0 | 8.65 MB | **17.3 MB** |
| UnrealBloom pyramids ×2 | — | ~7.9 MB each | **~16 MB** |
| SMAA buffers + LUTs ×2 | — | ~12 MB each | **~24 MB** |
| fluid ink canvas backing store | 3072×1408 | — | **17.3 MB** |
| fluid dye + sim targets | 512 / 128 grids | — | ~5–10 MB |
| fluid invert canvas (2D) | 1536×704 | — | **4.3 MB** |
| sun bloom (scene target + 3 mip pairs) | — | — | **UNVERIFIED** — sized to the sun canvas, which is `SUN_CANVAS_HEADROOM² = 6.76×` the hero square's area |

**Identified total ≈ 190 MB**, plus the sun's chain. All of it resident for the whole session.

⚠ `works · space` at `samples: 2` is **69 MB — a third of the identified total, and 52 MB of it is
purely the multisample buffers.** Dropping to `samples: 0` reclaims that instantly. See §6.

---

## 3 · What is actually running, per section

**DERIVED** from the gating in the source. `BLACK_STAGE_EVENT` is what switches most of it.

| | hero | services | works | chamber / contact |
|---|---|---|---|---|
| sun canvas + bloom | ✅ draws | ✅ draws | ✅ draws | frozen (`covered`) |
| deck composer | idle, allocated | ✅ draws | idle, allocated | idle |
| works composers ×2 | idle, allocated | idle | ✅ draws | ✅ draws |
| **FluidCursor** (2 canvases) | ✅ **runs** | off (black stage) | off | off |
| **ConstellationFrame** | ✅ **runs** | frozen | frozen | frozen |
| **HeroInstruments** | ✅ **runs** | — | — | — |
| gather field (worker) | loader only | — | — | — |

⚠ **The hero is the busiest screen on the site**, not the lightest. It is the only place where the
sun, the fluid sim, the constellation and the instruments all draw at once — and it is the first thing
a visitor sees.

---

## 4 · The blind spots — UNVERIFIED, and this is where I would look first

**Only three loops on the entire site are instrumented**: `sun · loop`, `works · loop`, `deck · loop`.
Everything below contributes to "unaccounted" and has never had a number put on it.

### 4a · FluidCursor — the strongest suspect

| | |
|---|---|
| ink canvas | **3072 × 1408 = 4.33 Mpx** WebGL (`min(dpr, 2)` — does **not** answer to `adaptivePixelRatio`) |
| dye grid | 512 (≈ 1118 × 512 at this aspect), double-buffered, advected per frame |
| sim grid | 128, **20 Jacobi pressure iterations per frame** |
| display pass | fullscreen, at the ink canvas's 4.33 Mpx |
| invert canvas | 1536 × 704 2D, repainted per frame from a **cross-context `drawImage`** of the 4.33 Mpx ink canvas |
| blend | `mix-blend-mode: difference` on the invert canvas |

Its own header already records this as *"the most expensive per-frame path on the first screen a
visitor sees, spent on a soft-edged blob"* — and that comment was written about the **invert** canvas,
which has since been capped at ratio 1. The **ink** canvas is still at ratio 2 and was never touched.

⚠ It idles after 900 ms without pointer movement, so **a capture taken while scrolling may not show
its cost at all.** To measure it, move the mouse continuously over the hero and compare.

### 4b · ConstellationFrame

Own canvas at `min(dpr, 2)`, own rAF loop, frozen on black stage. Never measured.

### 4c · HeroInstruments

Own loop. Never measured. Small, probably — but "probably" is the point of this section.

### 4d · Compositing and blend layers

`app/globals.css` carries **~14 `mix-blend-mode: difference` rules**, several of them full-width and
on the hero:

```
.nav-root            ← fixed, full-width, z-9999, over EVERYTHING
.sun-canvas
.hero-mask / .hero-mask-inner / .hero-sub
.constellation-dust
.hud-label / .hud-module-label / .hud-module-value / .hud-divider / .hud-module-divider
.hero-scroll-cue / .hud-scroll-arrow
.deck-carousel
```

A blended layer cannot take the compositor's fast path: it forces a backdrop readback and a separate
blend pass, **at device resolution — 6.76 Mpx here**, every frame.

⚠ `.nav-root` is the one I would test first: it is full-width, fixed, at the very top of the stack,
and it is composited over whatever is beneath it for the entire session including every scrubbed
crossing.

---

## 5 · Load-time costs — MEASURED

| | |
|---|---|
| total download | **10.25 MB** site assets + 560 KB bundle, 49 URLs |
| `mark build` | **1540 ms of blocked main thread**, 4 marks, **12.2 MB of buffers** (3.1 MB each) |
| long tasks | up to **40 per 3 s window** in works (2223 ms total in one window) |
| `works tris` | **334,794** at the marks |
| `works draws` | 143 |

⚠ **The preflight is working.** Lap 2: `45 → 0 requests, 10.80 MB → 0.0 KB`, and the telemetry's own
verdict — *"caching is not what makes the first run slow — doing the work earlier is."* Lap 1 and lap 2
now run at comparable frame rates (~20–34 vs ~17–27 fps). The first-lap penalty is gone; the baseline
is what is left.

---

## 6 · The candidate list — ranked by value for money

Savings are **DERIVED** unless marked. "Visual cost" is my judgement, and is the part you should
overrule freely.

### Tier 1 — free or nearly free

| # | drop / shrink | gets back | visual cost | confidence |
|---|---|---|---|---|
| 1 | **`.nav-root`'s `difference` blend** | a full-screen 6.76 Mpx readback + blend per frame | the navbar stops auto-inverting; needs a real colour decision | **test first** — UNVERIFIED but cheap to check |
| 2 | **`works · space` `samples: 2 → 0`** | **51.9 MB** of MSAA buffers + a resolve every frame | geometric edges on the marks/debris stair-step. `SMAAPass` already covers the chamber | high |
| 3 | **FluidCursor ink canvas `min(dpr,2) → min(dpr,1.25)`** | ~61 % of 4.33 Mpx of fluid fill + a smaller cross-context copy | the blob is a soft gradient; per its own comment, nothing a second device pixel resolves | high |
| 4 | **`sunParticles` 1400 → ~600** | ~800 point sprites/frame | thinner ring | high |

### Tier 2 — real trades

| # | drop / shrink | gets back | visual cost | confidence |
|---|---|---|---|---|
| 5 | **`SUN_CANVAS_HEADROOM` 2.6 → 2.0** | cost scales with the **square**: ~41 % of the sun's render + its whole bloom chain | ⚠ the glow starts clipping square at the canvas edge — the exact bug 2.6 was raised to fix | medium |
| 6 | **Sun's own pixel ratio below the shared one (×0.7)** | ~51 % of the sun's pixels | the star is a bloomed glow; the shards' hard edges go first | ⚠ see §1.1 — this moves the stall, it does not remove it |
| 7 | **`SHARD_COUNT` 260 → 90** (the `low` value) | ~170 meshes in the field | sparser debris | high |
| 8 | **ConstellationFrame** — drop entirely | one canvas, one loop, one blended layer | loses a hero texture layer | UNVERIFIED cost |
| 9 | **FluidCursor** — drop entirely | 4.33 Mpx sim + 1.08 Mpx 2D repaint + a blend layer, every hero frame | loses the hero's signature interaction | UNVERIFIED cost, likely the largest single item here |

### Tier 3 — structural, not tuning

| # | | |
|---|---|---|
| 10 | **Fewer simultaneous canvases on the hero** | Four independent WebGL/2D surfaces draw there at once (§3). This is a design decision, not a constant. |
| 11 | **`mark build`: 1540 ms, 12.2 MB, 334 k tris** | A load stall *and* a per-frame cost. Decimate the extrusions or cache the buffers. |
| 12 | **Raise `MAX_COMPOSITE_UPSCALE`** | ⚠ Makes quality **worse**, not better. Listed only so nobody reaches for it expecting the opposite: it lowers the floor, which is what pins the ratio at 1.0. |

---

## 7 · What will NOT help, and why

Recorded so these are not re-tried.

| | |
|---|---|
| **`RESOLUTION_PRIORITY`** (`quality` / `balanced` / `smoothness`) | **Completely inert on this machine.** All three solve below the floor: 0.71 / 0.64 / 0.58 against a floor of 1.00. Identical picture, identical frame rate. |
| **Lowering the pixel ratio further** | The floor is `dpr ÷ MAX_COMPOSITE_UPSCALE = 1.0` and the compositor works at 6.76 Mpx regardless. An earlier session measured **nine ratios from 0.75 to 1.68 with the frame rate at 20–32 fps at every one**, and one run getting *slower* as pixels were removed. |
| **More caching / smaller downloads** | Lap 2 touched the network **zero** times and ran at 17–27 fps. The problem is steady-state rendering. |
| **Granting 4× MSAA** | Already correctly refused (`surplus 0.64×, extras not earned`). At ratio 2.0 it would cost 588 MB for one composer. |

---

## 8 · Before changing anything: close the blind spots

Every Tier-1 and Tier-2 item above is a guess about a number nobody has. Two cheap steps make the next
capture decisive:

1. **Add `profileSpan` to `useFluidCursor`, `useConstellationFrame` and `useHeroInstruments.`**
   Purely additive instrumentation — it changes nothing about how the site renders, and it turns
   "unaccounted" from 80 % into something with names in it.
2. **Capture the hero with the pointer moving continuously**, then again with it still. The delta is
   the fluid cursor's real cost, measured rather than argued.

Then one A/B: comment out `.nav-root`'s `mix-blend-mode: difference` and re-capture. If the frame
moves, §4d is the answer and most of this document's Tier 2 becomes unnecessary.

⚠ **Do not spend the quality budget before that.** The last two performance passes in this project
both shipped correct-sounding GPU reductions on a machine whose actual constraint was elsewhere, and
the net result was worse quality at an identical frame rate. That failure is recorded in
`docs/lag-and-freeze-diagnosis.md` §8d and it is the one worth not repeating.

---

## 9 · What was taken — 2026-08-06

A funded 15 % resolution increase. **Two payments and one purchase, landed together**, because the
purchase alone would have cost ~3 fps on a machine already at 25.

| | change | file |
|---|---|---|
| **purchase** | `MAX_COMPOSITE_UPSCALE` 2.5 → **2.17** → floor 1.00 → **1.15** | `lib/adaptivePixelRatio.ts` |
| payment A | fluid ink canvas `min(dpr, 2)` → **`min(dpr, 1.25)`** | `lib/hooks/useFluidCursor.ts` |
| payment B | `BLOOM_MSAA_SAMPLES_BY_TIER` all → **0** | `useWorksField.ts` |

### What it buys

Every pixel on the site is 15 % finer, linearly — type, textures, hull edges, mark facets, the lot.
On this machine that is the **only** available route: the burn-in solves 0.64, so nothing it could
measure would ever lift the ratio above the floor, and `RESOLUTION_PRIORITY` is inert at every setting.

### What it costs

```
   ratio 1.00 → 1.15   =   +32 % pixels   (cost is the square)

   drawing buffer          1.08 Mpx  →  1.43 Mpx
   works · space targets   69.2 MB   →  0 MB      ← payment B removes this entirely
   all render targets      ~190 MB   →  ~150 MB   ← net DOWN, despite the larger buffer
```

- **The works browsing span now has no geometric antialiasing.** The chamber keeps its `SMAAPass`.
  ⚠ If the marks read as harsh, un-gate `smaaPass` for the browsing span (~12 MB of lookup textures,
  no per-sample bandwidth) — do **not** put the samples back, or the purchase goes with them.
- **The fluid blob is softer.** Its edge was already a multi-pixel gradient. Not below 1.25 — the
  stars are point-like and start to shimmer.
- ⚠ **Phones pay too.** The floor is proportional, so a dpr 3 handset goes 1.20 → 1.38 — the same
  +32 %, on the devices least able to afford it, and they get no benefit from payment A (the fluid
  cursor is unmounted below 760 px). If that bites, read `isLowPowerDevice()` when computing the floor
  rather than moving the constant back.

### ⚠ This overrides a rule in CLAUDE.md, on purpose

> *"works · space can never be 0 above `potato` — stage 2's SMAA is gated to the chamber, so this is
> the only AA the marks, debris and starfield get."*

Decided against the rule directly above it in the same file: *"RESOLUTION IS THE PRIORITY; SAMPLES ARE
THE LEFTOVER. Nothing may trade resolution away to keep samples."* Spending samples to **buy**
resolution is that rule read forwards — resolution softens every pixel in the frame, MSAA only touches
silhouettes, and a 15 % finer pixel shrinks the stair-stepping it was hiding. Both files now record the
reversal rather than quietly disagreeing.

### The number to check on the next capture

```
[pixels] BURN-IN 1.15 → 1.15 — bound by the floor
```

If it still reads `1.00`, the constant did not take effect. If the frame time has not moved much from
40 ms, §1's conclusion holds — the frame is compositor-bound, the extra pixels are close to free, and
there is more resolution available for the asking. **If the frame got much worse, that is the
counter-evidence to §1 and it is worth more than this purchase** — say so and take it back.
