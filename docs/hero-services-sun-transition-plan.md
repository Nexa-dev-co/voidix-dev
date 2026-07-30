# Hero → Services: animating the sun between its two states

> **Status:** `implemented` — `npx tsc --noEmit` + `npm run build` pass. **Awaiting visual review.**
> **Written / built:** 2026-07-29
>
> The one junction on the homepage that never got the crossing treatment. Services→Works is a 180vh
> scrubbed span on one clock. Works→Chamber is a 140vh scrubbed span on one clock. Hero→Services was
> a boolean and a frame-rate-dependent chase.
>
> §3 records where the built design **differs from the original plan**, and why — the plan was wrong
> in two places that would have shipped bugs.

---

## 1. What already existed (and was good)

The sun has two fully authored states, and every difference between them is a pure function of one
value, `cracks`. None of this needed rebuilding:

| | Hero — "Peaceful" | Services — "Cracks" | Constant |
|---|---|---|---|
| shard fracture spread | 0 | 0.18 × shard radius | `CRACKS_FRACTURE_SPREAD` |
| body rotation | 6.2°/s | 20°/s | `CRACKS_ROTATE_DEGREES_PER_SECOND` |
| flare spin | 15°/s | 22°/s | `CRACKS_FLARE_SPIN_DEGREES_PER_SECOND` |
| core light inside the shell | 0 | 4 | `CRACKS_CORE_LIGHT_INTENSITY` |
| breathing pulse | — | 0.12 @ 0.3 Hz | `CRACKS_PULSE_AMOUNT` |
| orbital ring | absent | 700 grains, formed | `sunParticles.ts` |

**The ring already assembled.** `sunParticles.ts` §Forming: grains fall in from `2.1×` their final
orbit, arrivals staggered around the circumference (`FORM_STAGGER 0.55`) by start-angle sweep blended
with per-grain randomness (`FORM_SCATTER 0.45`), each easing out into its orbit. It was never a fade.

---

## 2. Why none of it read

```ts
let targetIntensity = 0;
const energise = () => { targetIntensity = 1; };        // ← boolean, on DECK_REVEAL_EVENT
...
intensity += (targetIntensity - intensity) * INTENSITY_LERP;   // ← 0.05 per FRAME
```

**a. A threshold, not a scrub.** The square filled for 120vh with a completely Peaceful sun, then the
frame `progress >= fillFraction` the star started cracking on its own clock. Nothing about the
transition was connected to scroll.

**b. Frame-rate dependent.** `× 0.05` per frame, not per second — ~2.4× faster on a 144Hz display.

**c. An exponential chase spends its life in the tail.** This is what hid the ring:

```
  uForm
   1.0 ┤                                    ╭──────────────────────────
       │                        ╭───────────╯
   0.8 ┤              ╭─────────╯
       │        ╭─────╯
   0.63┤   ╭────╯  ◄── 63% reached in the first 0.33s
       │  ╱
   0.4 ┤ ╱          the ENTIRE visible formation — grains travelling
       │╱           inward from 2.1× radius — happened in here
   0.2 ┤│           ▼▼▼▼▼
       ││
   0.0 ┼┴────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬────►
       0    0.3   0.6   0.9   1.2   1.5   1.8   2.1   2.4   2.7s
              ├──────┤ ├──────────────────────────────────────┤
              visible      ~80% of the duration spent creeping
              (~0.3s)      through the last few percent

```

The formation was real. It was spent where the eye cannot see it — the *identical* failure documented
in `positionShards` for the shard assembly, from a different cause (there, perspective; here, the
driver's curve).

**d. Two dead limbs.** `SERVICES_SUN_SCALE = 1` makes HeroSun's 1.1s "swell" tween a no-op. Its
z-index flips `9500 → -1` in one frame. Both left alone — see §6.

---

## 3. The built design (and where the plan was wrong)

### 3.1 Two corrections the plan got wrong

**The plan ended both windows at `carouselStart`.** That was wrong, because that is not a region the
user scrubs:

| pin progress | vh | who is driving |
|---|---|---|
| 0 → 0.1154 (`fillFraction`) | 0–120 | **free native scroll** |
| 0.1154 → 0.1685 (`carouselStart`) | 120–175 | 0.5s programmatic glide, input locked |
| 0.1685 (stop 0) | 175 | fleet on screen |

Ending there would have put **half the cracks ramp and 82% of the ring ramp on a scripted 0.5s
glide** — reintroducing the exact "runs on its own clock" problem being fixed.

**The plan opened the ring window at 0.90 of the fill,** on a guess about when the black square
covers the sun. Solved properly — canvas is `SUN_CANVAS_HEADROOM` (1.6×) the square, centred, and the
sun *rises* 200px away from the square's centre as both grow:

```
        80(1 + 4.625e) ≥ 200e + 128(1 + 0.1e)   →   e ≥ 0.305   →   t ≈ 0.39
        └── square half-h ──┘   └─ rise ─┘└ canvas half-h ┘
```

Checked at 1440×900, 1920×1080 and 360×740: coverage lands at **t ≈ 0.31–0.40 of the fill**, not
0.90. The planned window would have squeezed the formation into almost nothing.

### 3.2 What shipped

One scrubbed signal carrying **two** fractions, and two windows that live in different ones.

```
 pin progress ────────────────────────────────────────────────────────────────►
 0.0                    0.035           0.093    0.1154            0.1685
   │                       │               │        │                 │
   │◄────────── the square fills (120vh) ───────────►│◄ settle 55vh ──►│
   │        free native scroll                       │  0.5s glide     │
   │                       │               │        │                 │
   │   cream hero,         │               │    screen fully      craft 01
   │   headline up         │               │    black, headline   arrives
   │                       │               │    cut instantly        │
   │                       ├──── CRACKS ────────────►│                 │
   │                       │  shell parts, rotation  │                 │
   │                       │  winds up, core light   │                 │
   │                       │  kindles                │                 │
   │                       │               │        │                 │
   │                       │               ├──── RING EJECTION ───────►│
   │                       │               │  700 grains erupt from one │
   │                       │               │  point and sweep around    │
   │                       │               │                           │
   fill:      0 ───────── 0.30 ──────────────────► 1                   │
   progress:  0 ─────────────────────────── 0.55 ─────────────────────► 1
```

**Why two fractions.** The span contains a landmark the sun needs but cannot derive: the moment the
square finishes covering the viewport. It sits partway through `progress` (currently ~0.68) at a
position that falls out of the carousel layout and would silently drift if a section were added. So
the pin publishes both, and each effect picks the space it actually lives in:

- **`fill`** — 0 → 1 as the square covers the viewport. `CRACKS_WINDOW = [0.30, 1.0]` uses it, so the
  star finishes opening on the exact frame the page goes black. A landmark, not a magic number.
- **`progress`** — 0 → 1 from page top to the fleet. `RING_WINDOW = [0.55, 1.0]` uses it, so the ring
  completes on the fleet, a beat after the cracks.

**Why the ring is late and in the other space.** The grains are **additively blended**, and over the
cream hero that washes out and reads as broken. Coverage is at ~0.31–0.40 of the fill, so anything
from ~0.45 up is safely on black.

*(A second constraint — the forming grains reaching past the "rlds" glyphs — applied to the original
fall-in and no longer exists. See §3.3.)*

**This does not break the one-clock rule.** Both values are pure functions of the same pin progress
over different windows of it. Both reverse exactly. `sunParticles.ts`'s comment arguing against a
second clock was updated to say so rather than being silently contradicted.

### 3.3 The ring is EJECTED, not gathered

The original ring fell **inward** from 2.1× its final orbit. It looked fine and was caused by
nothing — the shell opening and the dust arriving were two unrelated events that happened to
overlap. It is now thrown **out** of the star, which makes the ring the consequence of the cracks:

```
  form 0.0          form 0.25            form 0.6              form 1.0
  ┌────────┐        ┌────────┐          ┌────────┐           ┌────────┐
  │   ( )  │        │   ( )∙ │          │  ,(‾)· │           │ ,·-‾-·,│
  │   ⬤ ←knot      │   ⬤ ⁚  │          │ ·⬤   ˙ │           │( ⬤    )│
  │  buried│        │  bursts│          │ arc wraps          │ ˙·-_-·˙│
  └────────┘        └────────┘          └────────┘           └────────┘
   all grains at    erupts through      arc stretches         band closed,
   one point,       the limb, hot       forward around        orbiting, sheared
   inside the star                      the orbit
```

Each grain erupts from one point *under* the surface, climbs out (radially first, so it clears the
limb before it starts travelling), and sweeps **forward** around the orbit into its place. Fresh
ejecta runs `FORM_EJECT_HEAT` hotter and cools as it climbs, so the launch reads as the star throwing
something off rather than as grains fading up.

**Two bugs were found and fixed by simulating the vertex shader on the CPU** (the scratch harness
checks the boundary conditions numerically; it is not committed):

1. **Teleporting grains.** Computing the angular travel as `mod(orbitAngle − launchNow, 2π)` puts
   `uTime` inside the mod, so the argument drifts and every grain's travel wraps 2π→0 roughly once a
   minute, jumping it `travel × sweep` around the ring mid-flight.
2. **Time-proportional whipping.** The first fix — interpolating the angular *velocity*
   (`uTime × mix(launchSpin, ownSpin, sweep)`) — removed the teleport but made the extra rotation
   during formation proportional to elapsed time: fine 10s after load, **2.4 extra turns after five
   minutes** on the hero, fourteen after thirty. Measured worst single-frame step was **49× the
   smooth motion**.

The shipped form interpolates toward the grain's offset from the knot **reduced into one turn**:

```glsl
float settledAngle = aOrbit.y + uTime * aOrbit.z;
float knotAngle    = uLaunchAngle + uTime * uLaunchSpin;
float offset       = mod(settledAngle - knotAngle, TWO_PI);
float angle        = knotAngle + offset * sweep;
```

Verified numerically:

| check | result |
|---|---|
| `form = 1` vs the settled ring, at t = 0 … 9999s | **identical** (2.6e-13) |
| `form = 0` knot spread | 3.6% of the ring radius — a knot, not a smear |
| time-invariance (t = 0, 12, 60, 300, 1800s) | identical behaviour |
| seam relocations per formation | **3 grains of 700 (0.43%)**, on 15 frames of 750 |
| radius ever exceeding the resting ring | **never** — see below |

The seam is topologically unavoidable (any map from a circle to a path has one) and costs 0.43% of
the field once, mid-formation. At `sweep = 1` the jump is exactly 2π, so the settled ring is
unaffected forever.

**It also removed a risk.** The ejection never travels further out than the resting band, where the
fall-in started at 2.1× it. In screen terms the ring now peaks at `0.443 × square` against the
square's own half-width of `0.5 × square` — so it stays inside the square's original footprint and
**cannot reach the "rlds" glyphs at all**. The headline-overlap concern is gone, not mitigated.

### 3.4 The strain (planned Step 5) — dropped, and why

The plan was to shape the spread through a curve dipping slightly negative so the shell **tightens
before it bursts**. `applyCracks` does support a negative spread. It does not survive contact:

- The shards at `home` form an **assembled sphere**. Negative spread makes them **interpenetrate** —
  z-fighting on a bloomed, emissive surface.
- At an amplitude small enough to avoid that, the dip is **~2% of total travel**. Invisible.

Better idea for later, once the base is on screen: do the strain with **light instead of geometry** —
let `coreLight` lead the spread (`pow(cracks, 0.6)`) while the spread lags (`pow(cracks, 1.4)`), so
pressure builds inside the shell before the gaps give. Zero interpenetration risk, ~2 lines. Left out
deliberately until the mechanism has been seen working.

---

## 4. What shipped, file by file

| File | Change |
|---|---|
| `lib/heroServicesEvents.ts` | **new** — the contract, mirroring `handoffEvents.ts` |
| `lib/hooks/useHeroAnimation.ts` | `applyHeroServicesProgress`, called above the fill's early return |
| `components/sections/Hero/SunModelCanvas.tsx` | the driver; fps-independent ease; `skipAssembly` → `reduceMotion` |
| `components/sections/Hero/sunParticles.ts` | the ejection (§3.3) — new launch constants, rewritten vertex shader, fast master fade |

No CSS. No change to the pin's layout, the stepper, the crossings, or either other scene.

The ease keeps the codebase's "each scene eases its own copy" pattern but as a **rate**:

```ts
const stateEase = reduceMotion ? 1 : 1 - Math.exp(-STATE_EASE_RATE * delta);
```

`STATE_EASE_RATE = 6` reproduces the feel of the crossings' `0.09`-per-frame at 60Hz **on every
display** instead of only on that one. Same form as `useServicesDeck`'s `HEADING_EASE_RATE`.

---

## 5. Side effects traced

| Risk | Verdict |
|---|---|
| `DECK_REVEAL` / `DECK_HIDE` orphaned by removing `energise` | **No** — still consumed by `HeroSun` (z-index), `useServicesDeck`, `useConstellationFrame`, `useFluidCursor` |
| The `covered` freeze (works + chamber stay cheap) | **Holds.** Past `SUN_COVERED_HANDOFF_PROGRESS` both targets are saturated at 1 and both eased copies have arrived, so `animating` is false exactly as before |
| Cost during the fill | Negligible. The sun already drew every frame (`moving = !covered`); this adds 10 Vector3 writes plus, late in the fill, 700 points in one draw call on a ~280px canvas — the cheapest part of the page |
| Reduced motion | `stateEase = 1` (snap), matching the crossings' `reduceMotion ? 1 : …`. Ring is still skipped entirely, breath still 0 |
| Divide-by-zero on the two fractions | `fillFraction` (0.115) and `carouselStart` (0.168) are non-zero for any positive `fillScrollVh` |
| Dedupe dropping a needed dispatch | Both fractions rise and saturate together (`fill` hits 1 first, inside `carouselStart`), so deduping on the transition alone cannot miss a change |
| Sun state on a jump from anywhere in the page | Published above the fill's early return, so any progress lands the right state |
| Events before the pin exists (intro) | None dispatched; targets stay 0 = Peaceful. Unchanged |

---

## 6. What must not break — checked, untouched

1. **The difference-blend flash.** `.is-services` hides `.hero-mask` / `.hero-sub` / `.hero-hud` /
   `.hero-sun-frame` with `transition: none` and `!important`, *deliberately*: the hero bg goes
   transparent in one frame and against black the difference blend flips those grey glyphs to BRIGHT
   grey, so a fade there reads as the headline flashing over the services screen. **Not touched.**
2. **The z-index flip stays.** z-index cannot be tweened. It flips at the frame the square covers the
   viewport, when nothing is in front of the sun yet, so it is unobservable. Left on `DECK_REVEAL`.
3. **`SERVICES_SUN_SCALE`'s no-op tween left in place.** It is dead code, but its comment says it is a
   deliberately-kept knob for re-adding a swell. Deleting it was in the plan and was dropped — it is
   not part of this goal, and removing the affordance costs more than the dead line does.
4. **The assembly owns shard positions until it lands.** `if (assembly >= 1) applyCracks(...)` —
   exactly one owner at any time. Unchanged.
5. **`AUTO_ROTATE_DEGREES_PER_SECOND` still imported** from `heroReadouts.ts`, not inlined — the HUD
   displays that exact rate.

---

## 7. Needs your eyes

Three judgement calls I cannot make from here. Each is one constant.

1. **The star now visibly opens while the cream hero and headline are still on screen** (from 0.30 of
   the fill). Intended — the star straining is the *reason* the void grows — but it is the one change
   that alters what the hero looks like. Too busy? Raise `CRACKS_WINDOW[0]`.
2. **The eruption's brightness.** 700 grains converge on one point at launch, and fresh ejecta runs
   `FORM_EJECT_HEAT` (1.6×) hot on an additive, bloomed material. They are buried inside the star for
   the first ~12% of each grain's flight, which should keep the peak off screen — but if the launch
   blows out into a white blob, pull `FORM_EJECT_HEAT` first, then `FORM_LAUNCH_RADIUS` (lower buries
   them longer).
3. **Ramp lengths.** Cracks gets 84vh of free scroll, the ring 54vh. If the formation still feels
   quick, widen `RING_WINDOW` downward — but not below ~0.45, which is the additive-over-cream floor
   from §3.2.
