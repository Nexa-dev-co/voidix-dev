# Works — the accretion mark, the star's colour, and the collapsing sun

> ## ⚠ STATUS, 2026-07-31 — the sun half of this doc is REVERTED
>
> Everything below about the mark, the palette and the collapse rig still stands. **The sun work does
> not.** `WorksField/sunBackdrop.ts` and `lib/sunPlacement.ts` were deleted, and the DOM sun's
> `REVEAL_SUN_FADE` restored, because the site ended up with two sun images on screen at once and the
> in-render one could not be moved by the works camera.
>
> The rounds below are kept as a **record of what was tried and why**, not as a description of the
> code. For the current state — and the two conditions any third attempt has to meet — see the
> "shared sun" section of `CLAUDE.md`.

> **Round 4 (REVERTED) — the sun is now IN the render, and the text was decoupled.**
>
> The DOM approach was abandoned (see the reverted round below for why it cannot work) and replaced with
> `WorksField/sunBackdrop.ts`: a `THREE.CanvasTexture` of the sun's canvas, drawn as a clip-space quad
> inside the SPACE scene at `renderOrder -1000`. From there it is simply part of the picture — it rides
> the render onto the chamber's display with correct perspective, and the mark occludes it.
>
> - **Clip space, not a camera-attached quad**, because the works camera's fov is authored per stop
>   (36–46°) and a world-space quad would resize every time the lens did. The sun is meant to be
>   infinitely far away.
> - **Premultiplied blending and a manual sRGB decode.** The browser composites a canvas with
>   premultiplied alpha, and a raw `ShaderMaterial` gets no automatic decode — decoding it still
>   premultiplied would darken every soft pixel, which on a star is nearly all of them.
> - **It cross-fades with the DOM sun over `SUN_HANDOVER_WINDOW` (0.12)** — the same span
>   `REVEAL_SUN_FADE` takes the DOM sun out over, chosen because the display still FILLS the frame
>   there, so both images are the same size in the same place and the swap has nothing to see.
> - `lib/sunPlacement.ts` now owns `SUN_SCROLL_RISE`/`SUN_SCROLL_SCALE` and the screen-rect measurement,
>   imported by both the pin and the field, so the two copies of the sun cannot drift apart.
> - The texture upload only runs while the backdrop is visible, so it costs nothing across works.
>
> Also: `TEXT_IN_AT_SECONDS` went back to an ABSOLUTE 1.4s. As a fraction of a six-second change it put
> the copy back at 3.7s, leaving the section wordless for over three seconds. The label belongs to the
> stop you picked, not to how far the stone has got.
>
> **Round 5 — the star flared the moment the render took it over.** Predicted and confirmed: the sun's
> canvas already contains its own bloom, so dropping it into the space scene put a near-white core
> through the field's bloom pass as well.
>
> Fixed with a soft KNEE in `sunBackdrop`'s fragment shader rather than by dimming. Dimming is the
> obvious fix and the wrong one — it would fade the soft falloff, which is already correct and is most
> of what you actually see. Below the knee nothing changes; above it the value asymptotes to a ceiling
> set just under the field's `BLOOM_THRESHOLD`, which is passed in rather than hard-coded so re-grading
> the field's bloom cannot silently reintroduce the flare. Applied per channel, since luminance can
> never exceed the largest channel.
>
> ⚠ It cost one build: the shader comment used backticks around two uniform names, which terminates the
> `/* glsl */` template literal. CLAUDE.md warns about this and says it had already bitten twice; this
> was the third. `sunBackdrop.ts` now has an assertion-style note, and the rule is simply never to type
> a backtick inside shader source.

> **Round 6 — two suns, the wrong colour, and one ring in services.**
>
> - **Two suns.** The cross-fade window was the bug, not a stray element. Over `[0, 0.12]` the in-render
>   copy already shrinks with the display while the DOM copy is still fading at full size in front of
>   it, so they visibly drift apart. They only share pixels while the display still fills the frame,
>   which stops being true almost immediately — so the swap is now `0.03`, on both halves
>   (`SUN_HANDOVER_WINDOW` and `REVEAL_SUN_FADE`, which must stay in step).
> - **The yellowish copy.** The sun's canvas is a FINISHED image — rendered with ACES and encoded to
>   sRGB by its own renderer — so the works pipeline tone-mapped it a second time on the way out
>   (Neutral, exposure 1.15). Two tone maps in series is not a tone map. `sunBackdrop` now inverts the
>   below-knee branch of the output operator before the compression, which is the only branch it can
>   reach because the knee keeps every channel under the ceiling.
> - **One ring in services, three in works.** `RINGS` entries declare `formsOn` and a `share`; the
>   shader picks between two form ramps per grain via `aFormGroup`, so the services band erupts on the
>   hero→services scroll and the outer two erupt on the handoff. The shares are uneven on purpose — the
>   services ring keeps the ~700 grains it had when it was alone, which an even third would have
>   quietly thinned. Both windows widened so the eruptions read slower.
>
> **Round 7 — the freeze was changing the frame it froze on.**
>
> Symptoms: the star looked different on entering process, and part of it appeared to fly away. One root
> cause, found by auditing every section the sun appears in rather than by chasing the symptom.
>
> `covered` did two things. `moving = !covered` stopped the star turning — harmless. But it also passed
> `covered ? 0 : ringForm` into `sunParticles.update`, hard-cutting `uForm` to 0, which returns every
> grain to the launch knot inside the star and hides the layer. That was correct when freezing meant the
> sun was off screen. It is not correct now: the sun is sampled into the works render and shown on the
> chamber's display, so the frozen frame IS the picture on the tablet. The star visibly lost its rings
> the moment the reveal crossed the freeze point, and scrubbing across it flickered them on and off.
>
> **The rule this establishes: whatever the freeze does, it must not change the frame it freezes on.**
> The zeroing is gone, and `SUN_COVERED_CHAMBER_PROGRESS` moved 0.16 → 0.62, past `TOUR_START` — so the
> star is alive for the whole pull-back and freezes only once the tour has turned away and the screen is
> a small rectangle across the room.
>
> The same audit turned up a latent race nobody had hit: `createSunBackdrop` queries `.sun-canvas`, but
> `SunCanvas` is dynamically imported with `ssr: false`, so it mounts on its own schedule. It had always
> won that race, but losing it once would mean no sun on the table and nothing on screen to explain why.
> Creation is now retried from the render loop until it succeeds, capped so a viewport with no sun stops
> asking.
>
> **Round 8 — two suns: the cross-fade was running on two clocks.**
>
> Ruled out first, by reading rather than guessing: no reflection in the room, exactly one display
> showing the space feed, `spaceComposer.renderToScreen = false`, one present material, and the backdrop
> added to the scene exactly once. So the second sun could only be the DOM one — and it was.
>
> The two halves of the hand-over read DIFFERENT copies of the reveal's progress. The pin faded the DOM
> sun from the crossing's RAW value, applied instantly; the works field faded the backdrop in from
> `chamberState.current`, which is EASED toward that value at `CHAMBER_SMOOTHING`. About ten frames of
> disagreement — and shortening the window in round 6 made it worse, because the lag is fixed while the
> window got smaller. Scrolling back out of the room is the visible case: the raw progress leaves the
> window at once, snapping the DOM sun back on while the eased backdrop is still fully up.
>
> This is CLAUDE.md's ONE CLOCK rule. A cross-fade whose two halves read different copies of the same
> progress is not a cross-fade. Both halves now live together in `useWorksField`, computed from one
> `sunHandover` value, so they are exact complements on every frame. `REVEAL_SUN_FADE` is gone from the
> pin, which no longer touches the sun at all.
>
> **Round 9 — the cross-fade was the wrong shape. It is now a threshold.**
>
> Three separate attempts to fix "two suns" by adjusting the fade all failed, which was the real signal:
> the design made two-suns *reachable*. Two images of one sun existed simultaneously and exactly one was
> meant to be visible, arbitrated by animating opacity — so any desync, stale write or missed frame put
> both on screen. Rounds 6, 7 and 8 each moved the window; none removed it.
>
> Replaced by a single boolean, `renderOwnsSun`, which decides BOTH images in the same frame. The two
> are the same canvas at the same screen rectangle, so a hard swap has nothing to hide — a fade was only
> ever concealing a mismatch that should not exist. This makes the two states mutually exclusive **by
> construction** rather than by timing.
>
> Two other changes in the same direction:
>
> - The DOM sun is hidden with `visibility: hidden` on the OUTER `.hero-sun-layer`, not `opacity` on the
>   `.hero-sun-flight` inside it. Most complete hide available, takes the whole subtree, and it is a
>   property nothing else on that element writes. The canvas keeps rendering while hidden — CSS
>   visibility does not touch the drawing buffer — so the backdrop can still sample it.
> - The render owns the sun for the whole of **works AND the chamber**, not just the chamber, so the one
>   swap happens at the handoff (past `HANDOFF_FIELD_FADE`) instead of during the reveal, where every
>   previous attempt broke. As a bonus the sun is now correctly occluded by the mark and the debris
>   through all of works, which the billboard never was.
>
> ⚠ Costs the canvas upload for the whole works section rather than just the chamber. Worth watching.
>
> **This is also diagnostic.** If two suns survive hiding the entire DOM layer, the second one is
> definitively inside the render, and the search moves there.
>
> **Round 10 — "two suns" was never the hand-over. It was the collapse.**
>
> Four rounds were spent on the DOM↔render hand-over. The hand-over was fine. The second sun was the
> star's own **corona**, and the bug was in the collapse added back in round 1.
>
> `fractured_sun.glb` is not symmetric about its shell — its own code says so at `SunModelCanvas:715`:
> the `sunouter` glow sphere sits at x≈0 while the ten `Sphere_0_cell*` shards sit at x≈−0.25. That is
> the same asymmetry `SUN_FRAMING_NUDGE_X` exists to correct. At rest it is invisible, because the shell
> is large enough to enclose the halo either way.
>
> The collapse crushed **only the shards**, onto their own centroid. So at full collapse there was a
> small white-hot core at −0.25 sitting beside a full-size yellow halo at 0 — two objects, two colours,
> a quarter of a radius apart. Every reported symptom follows exactly: "two suns", the second one "more
> yellowish" (it is the halo), "part of it flies away" (the shell travelling to its own centre), and it
> only became obvious once the backdrop put the star alone on a dark tablet instead of behind the mark.
>
> Fixed by collapsing the whole star to one place:
> - `collapseCentre` is measured from the corona's bounding box (converted into the model's local frame,
>   since the model carries an authored rotation) and the shell is lerped onto it by `collapse`. At
>   collapse 0 it is exactly a no-op, so the cracked star is untouched.
> - The corona contracts with it (`COLLAPSE_CORONA_SCALE`), because a full-size halo around an imploded
>   core reads as a separate object rather than as that point's light.
>
> **The lesson worth keeping: four fixes in a row failing to move a symptom is evidence about the
> DIAGNOSIS, not the fix.** The hand-over was rebuilt three times because the symptom was assumed to be
> a duplication of the sun image, when it was one sun that had come apart.
>
> The `?sundebug` tint added to settle it has been removed.
>
> ⚠ **THE SUN-ON-THE-TABLE WORK BELOW WAS REVERTED, 2026-07-30** — kept as the record of why. Rounds 2 and 3 below tried to carry the sun
> into the chamber as a DOM overlay tracking the display's projected pose. It does not work, and the
> reason is architectural rather than a bug worth chasing further:
>
> - The room sets an opaque `scene.background` and the display's alpha closes over `OPAQUE_WINDOW`, so a
>   layer BEHIND the canvas is invisible past ~0.12 of the reveal.
> - Raised in FRONT, it is a flat circle over a screen the tour views at an angle — a 2D transform
>   cannot skew to match — and it is no longer occluded by anything in the scene.
> - `lib/screenPose.ts`, the `.hero-sun-screen` layer and the chamber's pose publish are all **deleted**.
>   `REVEAL_SUN_FADE` is restored, so the chamber behaves exactly as it did before this work.
>
> **The real fix, not yet done:** put the sun INSIDE the space render — a `THREE.CanvasTexture` of the
> sun's canvas (which already runs `preserveDrawingBuffer: true`, so its last frame is readable) drawn as
> a camera-attached backdrop in the works scene, replacing the show-through-the-canvas trick entirely.
> Then it lands on the table exactly as the mark does, with correct perspective and occlusion and no
> per-section special cases — and the collapse finale finally has a star on that screen to die on.
>
> Two open questions before building it: the per-frame canvas upload cost on the site's heaviest scene,
> and whether the sun should re-bloom through the field's pass (its canvas already carries its own bloom).

> **BUILT, 2026-07-30.** `tsc --noEmit` and `next build` both pass. Four things went differently from
> the plan below, all of them discovered in the code:
>
> 1. **§2.6's density worry was overstated.** `markCapMesh.ts:119` pre-coarsens the base resample by the
>    subdivision factor, so the final edge length is `edgeFraction × size` regardless of how many rounds
>    run. Subdivisions buy interior quality, not raw count. The lab's floor settings were carried across
>    **verbatim** rather than backed off.
> 2. **No tuning was duplicated.** `create()` resolves `{ ...tuningDefaults(ACCRETION_CONTROLS), ...tuning }`,
>    so the section passes `{}` and inherits the lab's authored values by reference. The lab *is* the
>    tuning surface.
> 3. **The camera path had to be re-authored** (not in the plan). The body is now a slab 3.2 × 0.7, and
>    the old path parked stops at 90° and 270° where a logo is an unreadable bar. Stops now sit within
>    ~35° of face-on and transits arc *outward* instead of around — deliberately keeping the mark visible
>    through the middle of the change, because the crossing stone streams are the thing worth watching.
> 4. **A latent bug was fixed.** `SUN_COVERED_HANDOFF_PROGRESS` froze the sun for the whole works section
>    on the false premise that the field's backdrop covered it. It does not (globals.css forces that
>    backdrop transparent). The star was rendering one frozen frame for the entire section; a frozen
>    collapse would have been a still image. The gate now keys off the chamber reveal, which is what
>    actually hides the sun.
>
> **Round 2, same day — after the first visual review:**
>
> - Mark **smaller and lower**: `markTargetSize` 3.2 → 2.2, `markY` 0 → −1.1. Bounded by the frame, not
>   by taste — at the orbit's ~7 units and a 38° lens the visible half-height is ~2.4, so −1.1 already
>   puts the mark's bottom edge at y ≈ −2.2.
> - Change slowed to **6s** (`MARK_CHANGE_SECONDS`), with the camera hop deliberately left at 2.05s.
>   `TEXT_IN_AT_SECONDS` became a *fraction* of the change so the copy keeps its relationship if the
>   duration moves again. The pin's input lock had to become **per-section** (`stepHoldMs`) — a global
>   2.9s would have unlocked halfway through a 6s build while leaving the deck's 2.8s swap correct.
> - **The sun no longer vanishes at the chamber.** It was a fixed DOM billboard pinned to the viewport
>   while the display shrank away from it; the fast fade at `REVEAL_SUN_FADE` was a cover-up for that,
>   as its own comment admitted. `chamberScene` now publishes the display's projected pose
>   (`lib/screenPose.ts`) and `HeroSun` follows it down into the room via a dedicated `.hero-sun-screen`
>   layer. The room is opaque and the display writes the space's real alpha, so the star is **clipped to
>   the screen's true perspective shape for free** — no quad-corner maths needed. The fade is deleted.
>   This is also the prerequisite the planned collapse finale was missing: there is now a star on the
>   table's screen for it to die on.
> - `SUN_COVERED_CHAMBER_PROGRESS` moved 0.16 → 0.6, just past `TOUR_START`, so the star stays alive for
>   the whole pull-back and freezes only once it is a small rectangle across the room.

> **Round 3 — the sun's vanish, properly diagnosed.**
>
> Round 2 fixed the sun *drifting* out of the shrinking display, but it still disappeared. The reason is
> one line: `chamberScene.ts:208` sets `scene.background` to opaque black, and the display's own alpha
> closes over `OPAQUE_WINDOW` `[0, 0.12]`. **From 12% into the reveal the canvas is entirely opaque**, so
> a DOM element behind it cannot be seen anywhere — the tracking was computing a correct position for a
> sun with nothing to show through. It is also why the old fade was `[0, 0.12]`: it was matched to this
> window, hiding a cover-up rather than playing an effect.
>
> Fix: at `SUN_TO_FRONT_CHAMBER_PROGRESS` (0.12, kept in step with `OPAQUE_WINDOW`) the sun's layer is
> raised **in front of** the canvas, where the round-2 tracking transform places it onto the display. So
> it shows through from behind while the display is still a window, and is composited on top once the
> room closes — the star becomes the picture on the screen instead of being buried behind the room.
>
> ⚠ Worth watching: in front, the sun is no longer occluded by anything in the space. It sits high
> (lifted `SUN_SCROLL_RISE`) and the mark sits low (`markY`), so overlap should be small — but they are
> the two things now sharing a compositing layer.
>
> Also this round: mark to 2.6 / `markY` −0.6, and bloom strength 0.9 → **0.48** (low tier 0.55 → 0.3) in
> **both** `useWorksField` and `markLabRig`, so the lab keeps matching the section. Emissive is untouched
> on both sides — same heat, less bleed.

> **Not done, deliberately:** the mark's 3D colours were left alone. `CRYSTAL_COLOR` is `#ff8a1f` against
> `--sun-accent`'s `#ff8a1a` — the geode was already authored to the star's colour, so the cyan that
> needed removing was all in the section's CSS.

> **Status:** DESIGN, nothing built. Written 2026-07-30.
>
> Three changes to the works section, agreed with the user:
>
> 1. **The meteor rock is deleted.** The accretion mark from `/letters/transition/accretion` takes its
>    place — the same four SVG/letter marks, grown out of stone and finished with geode.
> 2. **The section stops being cyan.** The mark *and* the whole works overlay move onto the star's
>    palette (`--sun-accent`), which is what the loader, the hero and the deck already use.
> 3. **The sun becomes the sun-lab's Collapse state** while you are in works — its only state there —
>    with more rings, and a bigger canvas so the collapse's bloom is not clipped.
>
> Tuning is **hardcoded but responsive**. No `?tune` panel for the mark yet; it gets wired in later if
> the numbers need moving.

---

## 0 · The section, before and after

```
                        BEFORE                                    AFTER

  body        one carved rock, re-morphed per project   the accretion mark: ~200 stones
                                                        cut from the mark's own solid,
                                                        grown out of a core, geode on the rim

  change      spin to 1150 deg/s, swap inside the       stones let go, two streams cross,
              blur, spin down          (2.90 s)         next mark grows, geode finishes  (~2.4 s)

  motion      rock spins + floats; camera orbits        rock is STEADY; camera orbits
                                                        (the orbit was always there)

  colour      cyan UI, warm basalt rock                 sun-accent UI, cold stone + amber geode

  sun         Peaceful preset, 1 ring                   Collapse preset, 3 rings, bigger canvas
```

The camera path is unchanged and already circular — `PROJECT_VIEW_KEYS` in `worksTuning.ts` is a
radius-7 orbit with stops at 0°/90°/180°/270°. Removing the body's own spin is what makes the orbit
read as *the screen going around the model*, which is what it was always doing underneath the blur.

---

## 1 · What the meteor is actually doing today

Inventory first, because the mark has to inherit every one of these or something silently breaks.

| # | Job | Where |
|---|---|---|
| 1 | One `Group` at `(meteorX, meteorY, meteorZ)` holding one `Mesh` | `useWorksField.ts:766` `buildMeteor` |
| 2 | Re-carved per project from `worksProjects.ts`'s `ProjectRock` (seed, sizeScale, colour, repeat) | `:775` |
| 3 | Changes shape by GPU vertex morph — `attachMorphTarget` + a 1.0 s `uMorph` tween, then `bakeMorphTarget` | `:924` `stageProject` |
| 4 | Spins on Y at `meteorSpin` and bobs on `FLOAT_SPEED` / `FLOAT_AMPLITUDE` | `:1242` |
| 5 | **Arrives from the far dark** at the end of the services→works flight — from `+(0, 0.5, −42)` behind its spot, fading up, fully reversible | `:1267` |
| 6 | Material props pushed live from `worksTuning` every frame (emissive, roughness, metalness, tint) | `:1248` |
| 7 | Blooms — the lava veins are the only thing over `BLOOM_THRESHOLD` | `:171` |

**⚠ Correcting a stale note:** the ship does **not** become the meteor. The ship flies left and off
screen, and *then* the rock flies in from behind and fades up. `docs/services-to-works-flight.md`
describes the flight; the arrival is `METEOR_ARRIVE_*` in `useWorksField`. So the mark is a genuine
drop-in — **nothing about the handoff needs redesigning.** (`docs/services-to-works-flight.md` and the
`services-to-works-launch` memory both need this correction; see §6.)

Jobs 1, 4, 5, 6, 7 carry over. Jobs 2 and 3 are what accretion replaces.

---

## 2 · Part A — the mark replaces the meteor

### 2.1 · The shape of the swap

```
   useWorksField
   ├── buildField()
   │   ├── buildMeteor()            ✗ DELETE
   │   ├── buildMark()              ✚ NEW — async; awaits prepared marks + the strategy
   │   ├── shard debris             ✓ unchanged
   │   └── starfield                ✓ unchanged
   │
   ├── stageProject(index)          ✎ REWRITE — was morph-tween, now drives setTransition
   └── render loop
       ├── spin + float             ✎ float stays, SPIN GOES
       ├── arrival lerp             ✓ unchanged, retargeted at the mark group
       └── camera orbit             ✓ unchanged
```

### 2.2 · One mark loader, shared with the lab

`useTransitionLab.ts:143` has a private `prepareMarks()` that fetches the four SVGs, loads the
typeface and returns `PreparedMark[]`. The field needs exactly the same thing.

**Extract it to `components/sections/WorksField/prepareMarks.ts`** and have both call it. The lab
already imports `marks.ts`, `markBody.ts` and `transitions/*` out of `WorksField/`, so this direction
of dependency is the established one — and it guarantees the lab and the section are comparing and
shipping the *same outlines*. Two copies is one `curveSegments` change away from the lab lying.

### 2.3 · Driving a pure function from a timeline

`setTransition(from, to, progress)` is pure by contract — no timers, no flags. The section's project
change is a GSAP tween. Those compose cleanly:

```ts
// One piece of state, one tween. No "arrived" flag, no second clock.
const markState = { from: 0, to: 0, progress: 0 };

// every frame
strategy.setTransition(markState.from, markState.to, markState.progress);

// on a project change
gsap.to(markState, {
  progress: 1,
  duration: MARK_TRANSITION_SECONDS,
  ease: 'none',                       // the curves live INSIDE the shader; easing here double-eases
  overwrite: true,
  onComplete: () => { markState.from = markState.to; markState.progress = 0; },
});
```

**Interrupting is free** — and this is the real win over the morph. `settleMorph()` exists because a
morph caught mid-flight had to be *baked* into the geometry before a new one could start. A pure
function has no such state: re-target by setting `from` to the mark currently dominant, `to` to the
new one, `progress` back to 0, and restart the tween. Nothing to settle, nothing to bake.

`from === to` is legal and means "sit still on this mark" (`ACCRETION_MODE.settled`), which is the
resting state between changes and during the arrival.

### 2.4 · Re-timing the change

The current 2.90 s exists to hide a hard cut behind a blur. With the blur gone, the timeline is the
accretion beat itself, and the overlay text has to move with it:

```
   BEFORE (2.90 s)                          AFTER (~2.40 s)
   0    0.6      1.15 1.45          2.90    0    0.55        1.4              2.40
   ├─────┼────────┼────┼─────────────┤      ├─────┼───────────┼────────────────┤
   │text OUT│                        │      │text OUT│                        │
   │  spin up    │▓▓│  spin down     │      │  stones retract │ streams cross  │
   │          peak  swap             │      │            grow │ geode finishes │
   │              │  │text IN │      │      │                 │text IN │       │
```

`worksTransition.ts` is the file both halves import so they cannot disagree — it stays that role.
`SPIN_RAMP_SECONDS`, `SPIN_PEAK_HOLD_SECONDS`, `SPIN_DECAY_SECONDS`, `SPIN_PEAK_DEGREES_PER_SECOND`,
`MORPH_SWELL_UNITS`, `MORPH_EMISSIVE_FLARE` and `SWAP_AT_SECONDS` all become dead and go. The text
constants stay; `TEXT_IN_AT_SECONDS` re-derives off the new schedule.

`ENVIRONMENT_COUNTER_SPIN_DEGREES_PER_SECOND` also goes: it exists so the field whirls *against* the
rock and the two rates add. With a steady mark there is nothing to counter, and a field spinning on
its own reads as the camera rolling — which is exactly what its own comment warns about.

**⚠ One knob to re-check, not re-tune blind:** `moltenCool` is documented as *"a span of PROGRESS, not
seconds — 0.17 is one second at the lab's six-second round trip"*. At a ~2.4 s transition the same
0.17 is ~0.4 s. Judge it at the section's real duration before touching it.

### 2.5 · Size, and the one number nothing may disagree on

| | Lab | Field |
|---|---|---|
| mark size | `MARK_LAB_TARGET_SIZE = 2.6` | must fill what a ⌀3.4 rock filled (`meteorRadius: 1.7`) |
| camera | fov 38, distance 6.2 | fov 36–42, orbit radius 7 |
| lighting | key `0xdfe7ff`@2.1, fill `0x2a3550`@0.6, amb 0.18, exposure 1.15 | **identical** |
| bloom | 0.9 / 0.55 / 0.6, MSAA 4 | **identical** |

The lighting and bloom already match exactly — `markLabRig.ts:31` says so on purpose (*"Matched to
the works field so a mark is lit the way it would ship"*). **So a judgement made in the lab transfers,
and only the size needs deciding.** It becomes `markTargetSize` in `worksTuning`, starting ~3.2.

### 2.6 · ⚠ Build cost is the one real risk

The lab's shipped defaults are at or near their heaviest settings, and `accretionTransition.ts:164`
says so in as many words:

> *"At the floor, and the floor is dense: edge length is `capEdgeFraction × targetSize`, so 0.008 asks
> for ~0.021 world units on a 2.6 mark, and each subdivision quadruples what that produced. Paired
> with a 0.04 rim spacing this is by far the heaviest setting in the file. **Watch the rig's triangle
> and build-time read-outs before carrying it into the section.**"*

```
   capEdgeFraction  0.008   ← the slider's FLOOR
   capSubdivisions  2       ← each one quadruples the triangle count
   rimSpacing       0.04    ← the slider's FLOOR
```

So **step 1 of the build is measurement, not code**: open the lab, read triangles / build ms / bytes
per mark off the panel that already reports them, and decide the section's defaults from real numbers.
The plan's estimate is ~6.4k triangles and ~1 MB per mark; at these settings it will be well above
that. Two budgets it lands in:

- **The loader.** `assetLoadProgress.ts` weights a `works` source already; four mark builds at
  50–150 ms each (likely more at these settings) must be inside it or the intro's counter lies.
  `SOURCE_WEIGHTS` gets re-weighed — CLAUDE.md flags this as a standing requirement.
- **The frame.** The works field is already the most expensive scene on the site (`●●●●●` in
  `docs/performance-ratings.md`), and it hosts the chamber. Draw calls go 1 → 5 (two stone, two
  crystal, one core), which is fine; vertex count is what needs watching.

### 2.7 · Fading the mark in

The meteor fades up out of the far dark via `material.transparent = true` and a driven `opacity`. The
accretion materials are opaque. The mark's arrival needs the same treatment applied across **stone +
crystal + core** materials.

Set `transparent: true` **once at build** and leave it — do not toggle it per frame. Toggling
`transparent` invalidates the program and triggers a shader recompile, which is a stutter at exactly
the moment the section is trying to look expensive. This is what the meteor already does.

### 2.8 · Dead code to remove, not leave lying

`meteorMorph.ts` (whole file), the `ProjectRock` half of `worksProjects.ts`, the meteor knobs in
`worksTunerPanel.ts` / `worksTuning.ts`, and the spin constants in `worksTransition.ts`. An audit pass
at the end — `createMeteorMaterial` and `createStoneMaterial` both stay (accretion and the debris use
them), so this is a careful removal, not a folder delete.

---

## 3 · Part B — the section stops being cyan

### 3.1 · What the palette actually is

```
  --accent        #00e5ff   brand cyan   — navbar, and (still) works
  --sun-accent    #ff8a1a   the star     — loader, hero, deck
  loader dust ramp          #d92a05 ember  →  #ffeeb8 starlight
                            (lifted from the sun-lab spiral — gatherShader.ts:96)
```

`globals.css:14-19` states the split: the sun's palette is *"deliberately NOT the brand cyan"*. The
hero already aliases `--hero-accent: var(--sun-accent)`. **Works is the last section still on cyan.**

### 3.2 · The change

Mirror the hero's pattern — add a `--works-accent` alias rather than sprinkling `--sun-accent`
through 40 rules, so the section can be re-pointed in one line later:

```css
.works-field {
  --works-accent: var(--sun-accent);
  --works-accent-rgb: var(--sun-accent-rgb);
}
```

Then repoint, in `globals.css` ≈ lines 1283–1451: `.field-loading-ring`, `.field-loading-label`,
`.works-head-intro`, the project counter, the arrow nav, the tag pills and the panel rules. Raw
`rgba(0, 229, 255, …)` literals become `rgb(var(--works-accent-rgb) / …)`.

### 3.3 · The mark barely moves — and that is the finding

| | current | `--sun-accent` |
|---|---|---|
| `CRYSTAL_COLOR` | `#ff8a1f` | `#ff8a1a` |

**One digit apart.** The geode was authored to the star's colour already. So Part B is almost entirely
CSS. The only 3D question is whether the cavity and molten-fracture colours should be pulled onto the
loader's exact ramp (`#d92a05` → `#ffeeb8`) so the mark, the loader dust and the eventual accretion
spiral are provably one material. Cheap, and worth doing — it is the same argument `gatherShader.ts`
already makes for the loader.

**⚠ Do not raise brightness to compensate.** `accretionTransition.ts:98-113` documents at length that
`NeutralToneMapping` desaturates toward *white* past the knee, so an over-bright amber clips to white
rather than to a hotter amber. Keep a lit surface's peak channel under ~0.75 linear.

---

## 4 · Part C — the sun

### 4.1 · The canvas is too small for a Collapse-grade bloom

`SUN_CANVAS_HEADROOM = 1.6` is the single number both sides read: `HeroSun` grows the layer by it,
`SunModelCanvas` pulls the camera back by it. **The star's on-screen size is invariant** — the extra
pixels are pure headroom for light to fall off in.

```
        headroom 1.6                    headroom 2.6
   ┌──────────────────┐          ┌────────────────────────────┐
   │ ▁▂▃▅███▅▃▂▁      │          │                            │
   │ ▂▃▅█████▅▃▂ ← cut│          │      ▁▂▃▅███▅▃▂▁           │
   │ ▃▅███████▅▃  flat│          │     ▂▃▅█████▅▃▂            │
   │ ▂▃▅█████▅▃▂  at  │          │      ▃▅███████▅▃           │
   │ ▁▂▃▅███▅▃▂▁  edge│          │       ▂▃▅█████▅▃▂          │
   └──────────────────┘          │        ▁▂▃▅███▅▃▂▁         │
                                 │                            │
     Collapse bloom is           └────────────────────────────┘
     strength 2.5 / radius 1        room for the falloff AND
     vs Peaceful's 1.26 / 0.92      for wider rings
```

**Raise `SUN_CANVAS_HEADROOM` to ~2.6.** One constant; both sides follow it by construction.

Cost is real and must be stated: canvas area grows as headroom², so 1.6 → 2.6 is **~2.6× the pixels**
for the sun's own render *and* its bloom pass. Mitigation is the existing DPR clamp; if it bites, the
honest lever is a lower DPR on the sun canvas specifically, not a smaller canvas.

Verification points: the intro's `parkSunInO` measures the "o" glyph live, so a larger canvas with an
unchanged star size should land identically — but the flight is the one thing that must be eyeballed.
The layer is `pointer-events: none` and z-indexed below the navbar, so a bigger footprint should not
intercept anything.

### 4.2 · Collapse is the existing rig, pushed negative

`SunModelCanvas` already owns everything Collapse needs. `:520`:

```ts
const distance = (CRACKS_FRACTURE_SPREAD - breath) * cracks * shardRadius;
```

Ten shards, each with its own outward axis, driven by a `cracks` 0→1 ramp — plus a core light, a
bloom pass and the magma materials. **Collapse is not new machinery.** It is a second ramp that
carries the same values past zero:

| | Peaceful (today) | Collapse (`sunLabPresets.ts:93`) |
|---|---|---|
| `fractureSpread` | `0.18` at full cracks | **`−0.5`** — crushed *inward* |
| `modelScale` | 1 | **0.5** |
| `autoRotateSpeed` | 16 °/s | **45 °/s** |
| `flareSpinSpeed` | 15 | **40** |
| core light | `#ffb060` @ 4 | **`#ffe6c8` @ 18** |
| bloom | 1.26 / 0.92 / 0.59 | **2.5 / 1 / 0.42** |
| exposure | 1.42 | **1.6** |
| magma emissive | 2.4 | **5** |

**Driven off `HANDOFF_PROGRESS_EVENT`** — the 0→1 the services→works crossing already publishes. That
makes the collapse a pure function of the crossing's scrub: it eases in as you fly to works, holds at
1 for the whole section, and **reverses perfectly on scroll-back** for free. No flags, no timers, no
second clock. `SunModelCanvas` already listens to that event, so this is one more consumer of a value
it has in hand.

This is **the only sun state in works** — it does not advance per project.

```
   HERO ──── fill ────▶ SERVICES ══ handoff 0→1 ══▶ WORKS ═ reveal ═▶ CHAMBER
   Peaceful   cracks     cracked        COLLAPSING     Collapse,      (unchanged)
              open       open           ───────▶       held           sun fades out
```

**The finale is untouched.** The star still dies after the chamber and the black hole still carries
into contact, exactly as `CLAUDE.md` §4 and `docs/sun-to-blackhole-finale-plan.md` have it. Collapse
(stage 3) is a *pose*; Singularity (stage 4) is the finale, and it is not being spent here.

### 4.3 · More rings

`sunParticles.ts` keeps a `RINGS` list that is currently one entry, cut down from three. Its comments
explain the cut as a clipping ceiling at **1.383 body radii** — and **those comments are stale.** They
quote `1 / 0.723`, the value from before the headroom bump. The live ceiling is
`1 / SUN_BODY_FILL = 1 / (0.723 / 1.6) = 2.21` body radii, rising to **3.60 at headroom 2.6**.

So the room is already there, and more room is coming. Restore a crossing set:

```
                      ╭───────────────────╮        ring 0   r 1.18  tilt +20   ccw
                 ╭────┼───────────────────┼────╮   ring 1   r 1.52  tilt −24   cw
                 │    │      ▟███▙        │    │   ring 2   r 1.95  tilt +8    ccw, slow
                 │    │     ███████       │    │
                 ╰────┼───────────────────┼────╯   opposite tilts on 0/1 cross into an X —
                      ╰───────────────────╯        which is what the original three drew
```

`PARTICLE_COUNT` goes back up from 700 (it was cut to 700 *because* of the drop to one band) toward
~1100, still one draw call and still zero per-frame CPU — every orbit is a pure function of `uTime`
and the grain's own attributes.

Sizing stays resize-safe by construction: radii are fractions of the live `uFrameExtent`, so the
rings follow the headroom change automatically. Keep real headroom under the ceiling —
`SUN_FRAMING_NUDGE_X` shifts the whole field 5% sideways, so a ring flush to the edge clips on one
side only. **Fix the stale comments as part of this**, per CLAUDE.md's rule about docs that disagree
with the code.

---

## 5 · Build order

Each step ends somewhere you can look at it, and the risky measurement happens first.

| # | Step | Ends with |
|---|---|---|
| **1** | **Measure in the lab.** Read triangles, build ms and bytes/mark off the panel at the shipped defaults. Decide the section's density from real numbers. | A table of numbers, and defaults chosen — no code |
| **2** | Extract `prepareMarks()` to `WorksField/prepareMarks.ts`; lab imports it | Lab works exactly as now |
| **3** | Swap the body: delete `buildMeteor`, add `buildMark`, wire `stageProject` to `setTransition`, keep float + arrival | The mark on screen, changing between projects |
| **4** | Drop the spin; re-time the change; re-derive the text schedule | Steady mark, camera orbiting, text in step |
| **5** | Fold the mark build into `assetLoadProgress`; re-weigh `SOURCE_WEIGHTS` | Honest loader counter |
| **6** | Colour: `--works-accent`, repoint the CSS, align cavity/molten to the loader ramp | Section off cyan |
| **7** | `SUN_CANVAS_HEADROOM` → 2.6; verify the intro's o→square flight still lands | Bloom no longer clipped |
| **8** | Collapse ramp off `HANDOFF_PROGRESS_EVENT` | Sun collapses into works, reverses on scroll-back |
| **9** | Restore the ring set; fix the stale ceiling comments | More rings |
| **10** | Dead-code audit; `tsc --noEmit` + `next build`; update the docs in §6 | Clean tree |

Steps 3 and 8 are the two that can look wrong rather than break, so both want eyes on them before
moving on.

---

## 6 · Documentation this change has to fix

CLAUDE.md's own rule: *"If you find this file disagreeing with the code again, the code is right: fix
this file as part of the change."* Found while planning:

- **`docs/services-to-works-flight.md`** + the `services-to-works-launch` memory — both imply the ship
  becomes the meteor. It does not (§1).
- **`sunParticles.ts:29, 57, 66`** — the 1.383 ceiling and the "0.90 of the frame" figure are
  pre-headroom (§4.3).
- **`CLAUDE.md`** — the structure tree omits `TransitionLab`, `transitions/`, and the
  `/letters/transition/[strategy]` route; §4 needs the works section's new body.
- **`docs/mark-transition-comparison.md`** — accretion is no longer a candidate under evaluation once
  this ships; mark it as the one that landed and say why the other three were not built.
- **`docs/works-field-plan.md`** — describes the meteor as the section's body.

---

## 7 · What could still be wrong

Named now so they get checked rather than discovered:

- **Density.** The lab's defaults may be several times too heavy for a section that also hosts the
  chamber. Soft failure — the silhouette gets slightly less precise as the rim spacing rises — but it
  is the most likely thing to need backing off. §2.6 exists for this.
- **The mark may read as too *still*.** The meteor spun; taking that away leaves the camera orbit as
  the only motion, and between changes the mark is genuinely motionless. If it reads as dead, the fix
  is a very slow drift, not the spin coming back.
- **Four placeholder logos.** `MARKS` is a signal square, a compass, a shield and a "V", paired with
  projects arbitrarily. That is fine for building, but the section ships looking like a logo test until
  real marks exist — and the "V" is rendered in **helvetiker, not Syne** (`marks.ts` documents why).
- **Collapse bloom against the field's own bloom.** Two bloom passes in one frame — the sun canvas's
  and the works field's — both getting stronger. Watch the low tier.
- **The chamber shares the works renderer.** Anything that costs frame time here costs it in the room
  as well. The reveal freezes adaptive resolution during the crossing, so a heavier scene shows up as
  a lower resting resolution rather than as a stutter — which is easy to miss.
