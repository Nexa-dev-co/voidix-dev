# Services deck — the portal swap

> **Status:** `implemented` — `tsc` + `npm run build` pass. **Awaiting visual review.**
> The `?tune` folder is the one piece NOT built; see §8.
> **Written / built:** 2026-07-29
>
> Replaces the fleet's slide-off / slide-on carousel swap with a **gate pair**: two portals form, the
> craft turns to face one, flies through it, and the next craft comes out of the other.
>
> The landing pad is deliberately **not** touched — it is being removed later (see §7).

---

## 1. What the swap does today

`setStage(nextIndex)` in `useServicesDeck.ts`, on a GSAP clock (not scroll — the scroll glide between
two stops is invisible, so the swap *is* the transition the user sees):

```
 t 0.00 ────────────────────── 0.80 ─ 0.92 ──────────────────── 1.92 s
        exitShip(old)                 enterShip(new)
        x → -dir*3.6, y 0.55          x: dir*3.6 → 0
        bank ∓0.5, scale → 0.7        bank → 0, scale 0.6 → 1
        presence/lit → 0              presence/lit → 0 → 1
```

Direction convention (kept): **next (+1)** → old craft leaves screen-**left**, new arrives from
screen-**right**.

The rig is `stage → depart → lift → spin → vessel`. The swap owns **`stage`** only; `depart` is the
services→works handoff, `lift` carries the hover bob + turntable yaw + flight weave, `spin` holds
`BASE_YAW` + drag. That separation is what makes this feasible without touching the handoff.

---

## 2. The finding that decides the layout

**Fixed lateral offsets do not survive portrait.** The resting camera is at `(0, 1.7, 8.2)` looking
at `(0, 0.75, 0)` with a 34° vertical FOV, so the view distance to the pad plane is 8.255 and the
visible half-height there is `8.255 × tan(17°) = 2.52` — **constant**. Half-width is that × aspect:

| viewport | aspect | half-width at the pad | `SWAP_OFFSET_X = 3.6` is… |
|---|---|---|---|
| 21:9 | 2.33 | 5.88 | comfortably inside |
| 16:9 | 1.78 | 4.49 | inside |
| 16:10 | 1.60 | 4.04 | inside |
| 4:3 | 1.33 | 3.36 | **off-screen** |
| iPad portrait | 0.75 | 1.89 | **off-screen ×1.9** |
| phone portrait | 0.49 | 1.23 | **off-screen ×2.9** |

A craft *exiting* off-screen is fine — that is what an exit is. **A portal must be seen.** So portal
placement and size are expressed as fractions of the live half-width and recomputed on resize, never
as world constants.

That still leaves portrait genuinely cramped: every hull is normalised to `TARGET_SIZE = 2.3`, so its
half-extent (1.15) is already 93% of the phone's half-width. There is no room beside it. Fix in §4.4.

---

## 3. The choreography

Two gates, always at ∓X; only their **roles** swap with direction. For `next`, the craft leaves
through the left gate and its replacement arrives from the right.

```
 t 0.0            0.55        0.75            1.25  1.30            1.95        2.65 s
  │                │           │                │    │               │           │
  ├── PORTALS FORMING ─────────────────────────►│    │               │           │
  │   sparks → column → rim → fill → ready      │    │               │           │
  │                │           │                │    │               │           │
  ├─ craft AIMS ──►│           │                │    │               │           │
  │  turntable released,       │                │    │               │           │
  │  nose swings to the gate   │                │    │               │           │
  │                ├─ spool ──►│                │    │               │           │
  │                │           ├── FLIES IN ───►│    │               │           │
  │                │           │  arcs up to the gate's centre,      │           │
  │                │           │  shrinking as it goes away          │           │
  │                │           │                │    │               │           │
  │                │           │       craft gone ───┤               │           │
  │                │           │       next craft OUT of the far gate│           │
  │                │           │                     ├── flies to centre ───────►│
  │                │           │                     │  straightens to BASE_YAW  │
  │                │           │                     │               │           │
  │                │           │                     │               ├ COLLAPSE ►│
  └──────────────────────────────────────────────────────────────────────────────┘

        ╭─────╮                                              ╭─────╮
        │     │  ◄── gate A (exit)         gate B (entry) ──► │     │
        │  ◌  │            ✈ ──────►                          │  ◌  │ ──────► ✈
        │     │                                               │     │
        ╰──┬──╯                                               ╰──┬──╯
      ─────┴─────  ground flare                          ─────┴─────
```

**Total ≈ 2.65s**, against 1.92s today. That is the "longer animation" asked for, and it is the
number §5.1 has to be kept in step with.

The portals reach *ready* at 1.25 and the craft enters at 1.30 — so it flies **while they finish
forming**, exactly as specified.

---

## 4. Build

### 4.1 `ServicesDeck/portalGate.ts` — new, one file

One `PlaneGeometry` quad per gate with a procedural shader. Inline GLSL, self-contained, the same
shape as `sunParticles.ts` (the closest precedent for a self-contained effect that owns its shaders).

Everything is driven by **one `uFormation` uniform, 0..1**, which walks the ten reference stages:

```
 0.00 ─┬─ 0.12 ─┬─ 0.25 ─┬─ 0.38 ─┬─ 0.50 ─┬─ 0.62 ─┬─ 0.75 ─┬─ 0.88 ─┬─ 1.00
       │        │        │        │        │        │        │        │
    sparks   gather   shaping    rim      rim     energy  stabil-   ready
                               forming  stable    flow    ising
       ·        ┆        │        ◠        ◯        ◯        ◍        ◉
    a few    column    bright   the line  ellipse  interior  swirl   full
    points   of        vertical bows into firms,   begins    fills   gate
    at base  sparks    line     an ellipse filaments to fill
                                          settle
```

Composed from, cheapest first: an ellipse SDF for the rim, an fbm-warped copy of it for the
lightning filaments, an interior swirl gated on the later stages, a vertical gaussian for the early
column, a base flare with ground streaks, and hash-noise sparks for stage 1. Additive, `depthWrite`
off, `depthTest` on.

**No bloom.** `BLOOM_ENABLED = false` on this deck, deliberately — with every stage light at 0 the
ships are lit only by the cracked sun, and blooming their accents read as haze. The gate is
self-bright (a hot core plus its own falloff) so it needs nothing from the composer, exactly as
`sunParticles` does. Re-enabling bloom for the gate would re-bloom the whole fleet.

**Each gate also carries a `PointLight`** whose intensity follows `uFormation`. That is not
decoration: every rig light on this deck is 0, so without it the craft flies into and out of a bright
gate completely unlit by it.

### 4.2 The aim

The craft's yaw comes from three groups at once, and the turntable on `lift` accumulates forever, so
an aim written anywhere underneath it will not hold. The file already solves exactly this for the
handoff and the same proven shape is reused:

- a `swapGrip` 0..1 that scales `AUTO_ROTATE_SPEED` down to nothing (mirroring `departGrip`),
- settle `lift.rotation.y` onto the nearest multiple of 2π (mirroring `TURNTABLE_SETTLE`),
- write the aim to **`stage.rotation.y`**, which the swap already owns and which nothing else reads.

The heading formula is the file's own: `atan2(dx, dz) + HEADING_PHASE`. `HEADING_PHASE`'s "2.0 = nose
screen-left" datum is empirical, and the hulls are third-party models with inconsistent orientations,
so the aim gets a **tunable offset** rather than a derived constant — it is a number to dial in
`?tune`, not one to guess at from here.

### 4.3 Sequencing

A single GSAP timeline per swap, killed and rebuilt if a swap interrupts another (as
`gsap.killTweensOf` already does for the ships). The gates' `formation` is a plain tweened object, so
an interrupted swap re-tweens from wherever it was rather than snapping.

### 4.4 Portrait — one gate, in depth

Frame-relative placement fixes *visibility*; it cannot create *room*. On a phone the hull already
spans 93% of the frame width, so two gates beside it is not a tuning problem, it is geometrically
impossible.

**Depth is not constrained by aspect.** A gate set back in −Z is in frame at any viewport, at any
width, with the camera exactly where it was. So on a narrow viewport the pair collapses to **one
gate, behind the craft**, and the fleet cycles through that single gateway: the craft turns away from
the camera, flies back into it and shrinks out of sight, and its replacement grows back out of the
same gate toward you.

```
        WIDE  (aspect ≥ 1)                     NARROW  (aspect < 1)

     ╭───╮               ╭───╮                        ╭───╮
     │ ◌ │ ◄── ✈    ✈ ──►│ ◌ │                        │ ◌ │   gate, set back in −Z
     ╰─┬─╯               ╰─┬─╯                        ╰─┬─╯   and standing on the ground
    ───┴───            ───┴───                       ───┴───
     exit               entry                           ▲ │
                                                        │ ▼
                                                        ✈     craft turns away, flies
                                                              back in, next one grows out
```

**The switchover is measured, not a device sniff.** Two gates need
`halfWidth > shipHalfExtent + 2 × gateHalfWidth + clearances` = 2.98, and half-height is a constant
2.52 — so the threshold lands at **aspect 1.182** (the plan's earlier estimate of 1.0 dropped the
clearance terms). Verified against the shipped constants:

```
 viewport        aspect  halfWidth  layout        gateX   clear of hull  clear of frame
 21:9             2.33      5.88    PAIR           3.65        1.83           1.57
 16:9             1.78      4.49    PAIR           2.78        0.97           1.04
 16:10            1.60      4.04    PAIR           2.50        0.69           0.87
 3:2              1.50      3.79    PAIR           2.35        0.53           0.77
 4:3              1.33      3.36    PAIR           2.17        0.35           0.53
 5:4              1.25      3.15    PAIR           2.17        0.35           0.32
 square           1.00      2.52    SINGLE (−Z)    ±0.55   on-screen half-width 16% of frame
 iPad portrait    0.75      1.89    SINGLE (−Z)    ±0.55   …22%
 phone portrait   0.49      1.23    SINGLE (−Z)    ±0.55   …34%
```

The lone gate reads *larger* the narrower the frame gets, which is the right way round — the gate is
a fixed world size at a fixed depth, so it takes up more of a narrow frame exactly where it needs to.
At the square boundary it is only 16%, which is small but is also the one aspect nobody uses.

Only two things differ between the two layouts — where the gates sit, and the craft's flight vector.
One layout function returns both; the timeline, the shader, the aim and the collapse are shared.

**The camera dolly from the previous draft is dropped.** It existed only to make room for two lateral
gates on a phone, and the depth gate makes room without moving anything — so the resting shot is now
untouched at every viewport, and there is one less system that could fight the handoff camera.

A short beat (`SWAP_GAP`, 0.12s, already in the file) separates the craft going in from the next
coming out, so a single gate never reads as two ships occupying one hole.

---

## 5. Side effects — traced, with what each needs

| # | Risk | Action |
|---|---|---|
| 1 | **`STAGE_STEP_HOLD_MS = 1400`** in `useHeroAnimation` locks input per step, and its comment says to keep it in step with `SWAP_*`. It is *already* short (the swap is 1.92s); at 2.65s a second gesture would cut the portal in half. | Raise to ~2800. Cross-file, mandatory. |
| 2 | **Adaptive pixel ratio** is frozen during the handoff because reallocating the composer stalls a frame and tweens keep advancing through it, so the motion visibly jumps. A 2.65s portal swap is exactly that case. | Extend the `!handoffActive` freeze to cover an active swap. |
| 3 | **The handoff** must never see a gate. `setStage` only fires on an index change and the handoff is a crossing, so they cannot overlap — but an interrupted swap could leave a gate up. | Force `formation → 0` when `departState.engaged`. |
| 4 | **`replayEntrance`** (`DECK_REVEAL_EVENT`) flies the craft in with no exit, every time the section is scrolled back into view. | Use the arrival half only — one gate, craft steps out. Consistent, and reuses the same code. |
| 5 | **Reduced motion** — `snapToCenter`, no gates at all, no dolly. | Gate the whole system on `reduceMotion`. |
| 6 | **Interrupted swap** leaves gates mid-formation and a ship mid-flight. | The timeline is killed and rebuilt; `formation` tweens from where it is. |
| 7 | **Draw gating** — `deckShouldRender` skips `composer.render()` when the deck is hidden. Gates are in the scene, so they inherit it. Their uniform writes are a handful of floats. | Nothing needed; confirmed. |
| 8 | **Pad glow cross-fade** (`glowTransitionSeconds: 0.9`) starts with the swap and will now finish while the craft is still flying to the gate. | Harmless, and the pad is going away. Noted, not changed. |
| 9 | **`?tune`** — this is a general editor, not a one-shot. | New "Portal" folder: size, offset, depth, colour, formation timing, light intensity, aim offset, dolly. |

---

## 6. Files

| File | Change |
|---|---|
| `ServicesDeck/portalGate.ts` | **new** — geometry, shader, the two gates, `update(formation)` |
| `ServicesDeck/hooks/useServicesDeck.ts` | the swap timeline, the aim, the dolly, gate wiring |
| `ServicesDeck/deckTuning.ts` | a `portal` block |
| `ServicesDeck/deckTunerPanel.ts` | the Portal folder |
| `lib/hooks/useHeroAnimation.ts` | `STAGE_STEP_HOLD_MS` 1400 → ~2800 (§5.1) |

Gate placement, the layout threshold and the flight vectors are all derived from the live frame, so
there is no breakpoint to keep in sync with CSS.

No CSS. No change to the handoff, the crossings, the pin's layout, or any other scene.

---

## 7. Explicitly out of scope

The **landing pad** stays exactly as it is. It is being removed later, so wiring the gates to it
would be work thrown away — and its `padGlow` is currently the only thing lighting a hull, which is
why §4.1 gives each gate its own light instead of leaning on the pad.

---

## 8. Built, and not built

**Built.** The gate and its shader, the frame-derived layout with the depth fallback, the aim, the
timeline, the turntable grip, the handoff guard, the pixel-ratio freeze, and the `STAGE_STEP_HOLD_MS`
change.

**One extra fix the build turned up.** `renderer.compileAsync` walks only *visible* objects, and a
gate hides itself at formation 0 — so the portal shader would not have been compiled during the
asset warm-up, and the first swap would have stalled compiling it. That is exactly the stall the
warm-up exists to prevent. The gates are now held at `PORTAL_PREWARM_FORMATION` across the compile
and cleared on every exit path.

**Not built: the `?tune` folder** (§5.9). The portal's numbers are still module constants rather than
`DeckTuning` fields, so wiring the panel means moving them first. Left deliberately: it is worth
seeing the gate on screen before deciding which of ~12 candidate knobs are the ones actually worth
exposing, rather than shipping a folder full of sliders nobody reaches for.

---

## 9. Post-review fixes (2026-07-29)

### 9.1 The glow was cut into a rectangle

The gate's own halo was still burning at **49–60% of its peak** when it reached the edge of its quad,
and an additive glow cut flat on black draws a lit rectangle — the same trap `sunParticles` documents
for the sun's ring. Three changes, smallest blast radius first:

| | before | after |
|---|---|---|
| ellipse inside the quad (`PORTAL_GATE_RADIUS_X/Y`) | 0.40 / 0.78 | **0.34 / 0.66** — more room to fade |
| halo gain / falloff length | 0.30 / 0.34 | **0.15 / 0.22** |
| ground streak reach | `exp(-|x| × 2.2) × 0.5` | **`exp(-|x| × 3.6) × 0.4`** (it hit the side edges) |
| `EDGE_FADE` border mask | — | **new, hard guarantee** |

`EDGE_FADE` is the one that matters: everything is multiplied by a mask that reaches zero before the
quad's border, so no term can be cut by it whatever anyone tunes later. Measured at the border:
`0.181 → 0.0000`.

### 9.2 The gate is smaller

`GATE_SIZE_FRACTION` 1.32 → **1.05**, on top of the smaller ellipse. The ring goes from
`1.33 × 2.60` world units to **`0.90 × 1.75`** — about a third smaller — and its centre drops from
y 1.30 to 0.87, so the craft arcs up less to reach it.

The layout re-derives itself, and the pair now fits on *more* screens than before (threshold aspect
1.182 → **1.011**), because a narrower gate needs less lateral room.

### 9.3 A dark shape overlapping the craft — self-inflicted

`hullMaterial` sets `transparent = true` but never touches `depthWrite`, so it keeps three's default
**`true`**: a hull at `opacity = 0` draws nothing but still stamps its silhouette into the depth
buffer.

That was always true and never showed, because parked craft sat off to the side at `(3.6, 0.55, 0)`.
The portal rewrite removed the off-stage parking spot — a craft leaves through a gate now — and
parked every hull at the **origin**, stacking three invisible ships on the visible one. All four are
transparent, so they sort by view depth, which is now identical; whichever drew first won, and where
a parked hull's surface was nearer, the visible craft's fragments failed the depth test and the black
background showed through. Different models, different silhouettes — hence a ship-shaped bite.

**Fix:** `applyOpacity` now sets `stage.visible = presence > 0.001`, so a faded-out craft is not
drawn at all. Cheaper than drawing a fully transparent hull, and it removes the depth write entirely.

**And the trap that fix sets:** `compileAsync` walks only visible objects, so parked hulls would no
longer have had their shaders compiled during the asset warm-up — the same hazard §8 records for the
gates. `prewarmPipeline` now shows every hull for the compile and restores them afterwards.

### 9.4 The craft now flies THROUGH a gate, not past it

With the gates on the pad's own plane the craft slid sideways into them and shrank. The cause is that
a gate is **billboarded to face the camera**: at `z = 0` the craft's travel was **71° off the gate's
normal**, so it grazed the face instead of passing through it.

Setting the gates back (`GATE_DEPTH = 5`) swings that round. Measured on 16:9:

```
  depth 0  →  71°     depth 4  →  27°
  depth 2  →  41°     depth 5  →  23°   ← shipped
  depth 3  →  33°     depth 8  →  16°   (diminishing: +3 units buys 7°)
```

**Depth alone would have broken the framing**, though — a gate placed from the frame at the *pad's*
depth would crowd inward on screen and shrink as it moved away. So `computePortalLayout` now measures
everything at **the gate's own depth**: `frameAt(-GATE_DEPTH)` gives its size and its x, and the
clearance test moved from world units into **screen fractions**, because the hull and the gates now
sit at different depths and their world x says nothing about whether they overlap in frame.

The result is that depth is a free choice — screen position and screen size are invariant to it:

```
  depth   0   2   3   4   5   6   8
  screen pos    62% 62% 62% 62% 62% 62% 62%
  screen size   10% 10% 10% 10% 10% 10% 10%
```

Shipped, across viewports:

```
 viewport         aspect  layout   entry angle   screen pos   screen half-width
 21:9              2.33   PAIR        26°           62%             8%
 16:9              1.78   PAIR        23°           62%            10%
 4:3               1.33   PAIR        20°           62%            13%
 square            1.00   PAIR        18°           75%            18%
 iPad portrait     0.75   SINGLE       4°           18%            24%
 phone portrait    0.49   SINGLE       3°           18%            37%
```

The narrow layout comes out at **3–4°** — near dead square, because a gate directly behind the craft
is the only placement where the travel and the camera-facing normal can actually agree. That is why
it read better there in the first place. It is also now noticeably more prominent on a phone (24–37%
of half-width, up from 15–23%), since it is sized from the frame at its own depth like everything else.

`LIGHT_INTENSITY` went 6 → 10 to cover the extra distance: with a decay of 2 the craft now only
really catches the gate's light as it closes on it, which is the right behaviour but needs the
headroom to read at all from the pad.

### 9.5 Neon, not bloom — and the quad stops showing

`EDGE_FADE` alone was never going to be enough, and the measurement says why: it turns a *hard*
rectangle into a *soft* one, and a soft rectangular gradient over a still-bright glow is still a
visible rectangle. At the quad's border there was **~19/255 of light left** to fade.

Two changes, and the second is what actually makes the first safe:

**The shader now works in its own space.** The ring's semi-axes are `ELLIPSE_RADIUS_X/Y` and the
quad's border sits at `±QUAD_MARGIN` (1.7). Every other number in the shader — filament thickness,
halo falloff, base flare, spark column — is expressed against the *ring*, so the quad can be widened
by changing one constant and nothing else needs retuning. `PORTAL_GATE_RADIUS_*` are now *derived*
through the margin, so the deck's placement maths and the shader can never disagree about how big the
visible ring is.

**Neon rather than haze.** Halo gain `0.15 → 0.05` and its falloff `0.22 → 0.10`; filament thickness
`0.030 → 0.024` (rim) and `0.095 → 0.070` (outermost). A hot line with a tight glow, not a broad one.

Measured at the quad's border:

```
                        distance   halo      widest filament   total
 BEFORE (tight quad)      0.224    0.05409       0.01979       0.074   ~19/255
 AFTER  (margin 1.7)      0.306    0.00235       0.00266       0.005    ~1/255
```

The ring's **world size is unchanged** — `GATE_SIZE_FRACTION` went 1.05 → 1.51 to absorb the margin
exactly, so the quad grew 4.24 → 6.10 world units while the ring stayed at `1.44 × 2.80`. The extra
quad is pure fade room and carries nothing; where it reaches past the edge of frame, there is nothing
in it to clip.

### 9.6 The gates sit low

They were placed standing on the ground, which put their centre at y 1.39 — above the craft, at eye
level. There is no ground five units behind the pad to stand on anyway, and what matters is where
they land in shot, so they are now placed in the **frame** vertically as they already were
horizontally: the camera's aim line at the gate's depth, offset by `GATE_Y_FRACTION`.

```
 GATE_Y_FRACTION   centre y    ring spans          craft sits at y 0.05
      +0.30 (old)    1.39      -0.01 .. 2.79       towers over the craft
      −0.22 (now)   −0.72      -2.12 .. 0.68       sits low, craft descends into it
```

`GATE_Y_FRACTION` is the single knob for this — more negative drops them further.

### 9.7 The flare on appear and collapse — a real bug in the ellipse maths

Not tuning. The distance function was wrong.

The standard first-order distance to an ellipse is `(k1 − 1) · k1 / k2`, where `k1 = |p/r|` and
`k2 = |p/r²|`. It was written as `(k1 − 1) / k2` — **the `· k1` factor was missing**.

Near the rim `k1 ≈ 1`, so a formed gate looked correct and it never showed. But stages 2–4 are a
*nearly collapsed* ellipse — `rx` is floored at `LINE_HALF_WIDTH` (0.014) while `ry` is already full
(0.78), a 56:1 sliver — and out at the quad's border `k1` reaches **~70**. The distance was therefore
under-reported by that factor, so **every point in the quad reported as sitting on the rim** and the
whole quad lit up.

That is the flare, and it explains the collapse too: `power2.in` starts slow and ends fast, so the
formation drops *through* exactly that range on its way out.

With the factor restored the formula is **exact on both axes** and degrades gracefully in between,
including when one axis collapses to a line — which is precisely what the early stages are. Spot
checks: `p=(0.05,0)` against `rx=0.014` gives 0.036, the exact answer; `p=(0.6,0)` against `rx=0.40`
gives 0.200, the exact answer.

Two smaller things went with it:

- **An `EMERGENCE_FADE` master.** The sparks are live from formation 0, so they arrived at full
  brightness on the frame `visible` flipped. A short fade over the first 5% of the range kills the
  pop, and being a function of formation it covers the collapse at the other end for free.
- **`BASE_EARLY_GAIN` (0.55).** The base was lit by `max(rimPower, columnRise)`, and `columnRise`
  hits 0.92 by f=0.25 while `rimPower` is only 0.16 — so the base burned at near-full strength while
  the ring was barely there.

Measured by integrating the light over the whole quad through a formation sweep (mean alpha per
pixel — the metric that matters, because a term lighting the *whole* quad barely moves peak
brightness but dominates the integral):

```
  formation   0.00    0.25    0.30    0.35    0.50    1.00
  BEFORE     0.0068  0.1457  0.2246  0.2205  0.0388  0.0970
  AFTER      0.0000  0.0084  0.0120  0.0155  0.0247  0.0858
```

- worst point in the sweep: **0.264 → 0.086**, and the old worst was **2.7× brighter than the fully
  formed gate**
- at f=0.25: **17.4× less light**
- at f=0.00: **0.0068 → 0.0000** (the pop is gone)
- at f=1.00: 0.097 → 0.086 — the gate itself is preserved

The profile is now **monotone**: it rises steadily to the formed gate and falls back the same way,
instead of humping over a peak brighter than its own destination.

### 9.8 Note for next time

This was the third backtick-in-a-glsl-literal in this session, all three from comments — the exact
trap `CLAUDE.md` records as having bitten twice before. Worth an automated check rather than eyes:

```
awk '/\/\* glsl \*\//{inb=1} inb && /`/{print NR": "$0} /^`;$/{inb=0}' <file>
```

Only the fences themselves should ever print.
