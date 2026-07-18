# Voidix — rebrand, mobile perf, and the chamber rebuild

> **Plan, not state.** Nothing here is built yet. Five independent workstreams, ordered so the risky
> ones land last and each can be reviewed on its own.
>
> **Decisions already taken** (from the brief): rename reaches internal event names too; the loading
> screen is untouched; the podium AND the ring portal both go; the mobile cutoff is coarse-pointer OR
> `< 760px`; the chamber gets its tuning panel back so the new camera keys can be authored by eye.

---

## 0. The order, and why

```
  1. Rename            orbix → voidix          mechanical, zero behaviour change
  2. Mobile perf       stop mounting the       pure deletion of work
                       hero effects on phones
  3. Ground            shader plane            new, self-contained, nothing depends on it
  4. Strip the set     podium + rings out      breaks the tour — must precede 5
  5. Tuning panel      re-author the tour      needs 3+4 in place to aim at
```

4 breaks the existing showcase on purpose: every camera key walks to a podium that will no longer
exist. So 5 is not optional polish — it is how the tour gets rebuilt. Between 4 and 5 the chamber is
*deliberately* in a broken state, and that is fine, because nothing ships from the middle of this list.

---

## 1. Rename — orbix → voidix

17 occurrences, across three categories. The loading screen is excluded entirely.

| Where | Change | Note |
|---|---|---|
| `package.json:2` | `"orbix"` → `"voidix"` | |
| `app/layout.tsx:21,26` | title `orbix — software with gravity` → `voidix — …` | |
| `app/layout.tsx:24` | `https://orbix.studio` → the real voidix domain | **needs the exact domain from you** |
| `introEvents.ts` ×2 | `orbix:reveal`, `orbix:intro-active` | |
| `deckEvents.ts` | `orbix:goto-services` | |
| `assetLoadProgress.ts` | `orbix:assets-warmup` | |
| `chamberEvents.ts` ×2 | `orbix:chamber-progress`, `orbix:chamber-hologram` | |
| `handoffEvents.ts` | `orbix:handoff-progress` | |
| `IntroSequence.tsx:451` | `orbix™` corner chrome | **SKIPPED — loading screen** |

Every event name is a `const` exported from one module and imported everywhere else, so the 8 event
renames are 8 single-line edits with no call-site churn. Nothing constructs these strings dynamically —
I checked; there are no template literals building an `orbix:` name.

Also in scope: `CLAUDE.md` and `PRODUCT.md` say "Orbix" throughout, and `HeroInstruments.tsx:16`
mentions "the Orbix Core's own OS" in a comment. Prose only, but it's the kind of thing that gets
copy-pasted into user-visible copy later.

**Not renamed:** the repo folder (`orbix-dev`) and the git remote — say the word if you want those too.

---

## 2. Mobile perf — stop the work, don't just hide it

### The actual problem

```
                          MOUNTED?  rAF RUNNING?  VISIBLE?   COST
  HeroInstruments   now │    yes    │    yes     │    no    │  wasted
                   plan │    no     │    no      │    no    │  none

  FluidCursor       now │    yes    │    yes     │   yes    │  full N-S solve
                   plan │    no     │    no      │    no    │  none
```

`globals.css:917` already does `.hero-hud { display: none }` at ≤51.25em. That hides the pixels and
saves nothing: `HeroInstruments` still mounts, and both `useCoreTelemetry` and `useEnvironmentTelemetry`
keep their rAF loops running, writing telemetry into a subtree with `display: none`. The fluid cursor is
worse — it isn't hidden at all, so phones run a full Navier–Stokes solve (1024² dye, 128² velocity, 20
pressure iterations per frame) for an ink trail that needs a pointer the device doesn't have.

### The change

A new `lib/useIsLowPowerViewport.ts` — a hook returning a boolean, matching the rule the 3D scenes
already use inline:

```ts
window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 760
```

`Hero.tsx` then gates the two mounts:

```tsx
{!isLowPower && <FluidCursor />}
{!isLowPower && <HeroInstruments />}
```

Three details that matter:

1. **It must be a hook with state, not a bare read.** Reading `matchMedia` during render breaks SSR
   (`window` is undefined on the server) and would hydration-mismatch. So: `useState(false)` +
   `useEffect` to set the real value. First paint assumes desktop, then corrects — which is the safe
   direction, because unmounting a canvas is clean and mounting one late is also clean.
2. **`useHeroInstruments` must stay called unconditionally.** It's a hook in `Hero`, and hooks can't be
   conditional. It already no-ops safely when its query selectors find nothing (`if (!ringInner)`
   guards throughout) — but the ring it animates, `.hero-sun-frame-inner`, is *not* part of
   `HeroInstruments`; it lives in the hero card markup. So the ring keeps working on mobile, which is
   what the CSS comment at `globals.css:915` says it wants.
3. **Keep the CSS rule.** It's the 760–820px band's answer: between the JS cutoff and the layout
   breakpoint the HUD is mounted but would crowd the headline, so `display: none` still earns its place.

**Expected saving on a phone:** one full fluid simulation per frame, plus two telemetry rAF loops.
This is the single largest always-on cost on mobile.

---

## 3. The ground — a shader plane

Recommendation as given: **one plane, one custom shader, radial fade to black.** No model, no texture,
two triangles, one draw call, zero bytes on the asset gate.

```
   camera's view, standing in the room

        ╱ ────────────────────────────── ╲    ← grid dissolves before it
      ╱                                    ╲     reaches any edge, so the
     │        ┌───┬───┬───┬───┬───┐         │    room has no measurable
     │        ├───┼───┼───┼───┼───┤         │    size — it just stops
     │        ├───┼───█───┼───┼───┤         │
     │        ├───┼───┼───┼───┼───┤         │  █ = brightest directly
      ╲       └───┴───┴───┴───┴───┘        ╱       under the hologram
        ╲ ────────────────────────────── ╱
                 ▔▔▔▔▔▔▔▔▔▔▔▔
                  pure black
```

### Why a shader and not a material

Every light in `chamberTuning` is `0` — `screenLight`, `ambient`, `keyLight`, `envIntensity`. That is
deliberate (the docstring at line 209: *"the set is lit entirely by its own emissive maps and by the
display"*). A `MeshStandardMaterial` floor under those conditions renders **pure black**. The floor has
to emit, so it has to be a shader.

### The shader, in three parts

```glsl
1. grid      — fract() on world XZ, line width kept constant in SCREEN space
               (derivative-based) so distant lines thin out instead of aliasing
               into moiré. This is the part that goes wrong if done naively.
2. falloff   — smoothstep on distance from the room's centre → alpha to 0
3. pool      — a soft radial lift under the hologram anchor, so the panel
               appears to cast light onto the floor
```

The anti-aliasing point is load-bearing. A naive `fract()` grid shimmers violently under a moving
camera, and this camera moves the entire time. Using `fwidth()` to keep the line one pixel wide at any
distance is what makes it read as a floor rather than as noise.

### Placement

Added by `chamberScene.ts` alongside the display, at `y = 0` (the props sit at `y ≈ 0.05`). It gets its
own tuning block — `showGround`, `groundY`, `groundFade`, `groundColor`, `groundOpacity`, `groundCell` —
so it's dialled in the same panel as everything else.

### Cost

One unlit full-screen-ish quad. It is cheaper than any single mesh currently in the room, and it
replaces two of them.

---

## 4. Strip the set — podium and rings out

### What actually gets deleted

```
  BEFORE                              AFTER
  ┌──────────────────────────┐        ┌──────────────────────────┐
  │  podium.glb   (0.9/1.3MB)│        │  table.glb      (0.61MB) │
  │   ├─ rings      ┐        │        │  ground shader  (0 bytes)│
  │   ├─ turbine    ├ portal │  ──►   │                          │
  │   ├─ cables     │        │        │  hologram → over the     │
  │   └─ joiners    ┘        │        │             table        │
  │  table.glb      (0.61MB) │        └──────────────────────────┘
  └──────────────────────────┘
```

### Code that becomes dead and gets removed

This is the part worth being careful about — the podium isn't one flag, it's threaded through the file:

| Location | What goes |
|---|---|
| `chamberScene.ts:46-47` | `PODIUM_MODEL_LOW` / `PODIUM_MODEL_HIGH` consts |
| `chamberScene.ts:291` | `PODIUM_ASSEMBLIES` |
| `chamberScene.ts:295-301` | `Assembly` interface, `assemblies` map |
| `chamberScene.ts:315` | `ringsSpinRig`, `lastSpinFrame` |
| `chamberScene.ts:327-378` | `rigMeshes`, `rigAssembly`, `placeAssembly` — all three exist only for the rings |
| `chamberScene.ts:466-497` | the whole `if (model === 'podium')` rigging block, incl. the core-ring measurement |
| `chamberScene.ts:509` | the `loadProp('podium', …)` call and its tier pick |
| `chamberScene.ts:1014-1024` | `placeAssembly('rings', …)` + the spin |
| `chamberTuning.ts` | `showPodium`, `podium*` (13 fields), `showRings`, `rings*` (9), `cablesColor`, `cablesGlow`, `paintJoiners`, `joiners*` |

**`performanceTier.ts` becomes unused.** Its entire reason for existing is picking between
`podium-512.glb` and `podium-1024.glb` — its own docstring says so. With the podium gone there is no
two-tier asset left. I'd keep the module (it's well-built and the ground/future props may want it) but
mark it unused, or delete it — your call, flagging rather than deciding.

**Assets to delete:** `podium-512.glb`, `podium-1024.glb` (2.3 MB). Plus the 4 unused ship models found
in the earlier audit (7 MB) if you want that swept at the same time.

### What this breaks, deliberately

All 8 `SHOWCASE_KEYS` walk to `z ≈ -0.6` to stand at a podium at `z = -5.9`. After this step they walk
to an empty spot. The tour is broken until step 5 re-authors it. **This is expected** — don't review
step 4 by looking at the chamber, review it by confirming nothing crashes.

`hiddenParts` also needs its `podium:*` entries dropped, or they're just dead strings.

---

## 5. The tuning panel — re-author the tour

### Why it has to come back

`chamberTuning.ts:8` — *"The panel is gone; these are the shipped numbers."* The old keys were authored
against a panel that no longer exists, and step 4 invalidates all of them. Typing 8 keys × 13 channels
of camera coordinates by hand is not feasible. The panel is the tool that makes step 4 survivable.

### Shape

Follows the pattern already proven twice (`useServicesDeck.ts:1002`, `useWorksField.ts:1155`): gated
behind `?tune`, `import('lil-gui')` dynamically so it never enters the normal bundle.

```
  ┌─ Chamber ─────────────────┐
  │ ▸ Display    rig x/y/z,   │   live-mutates the tuning object, which
  │              yaw/pitch/   │   chamberScene already reads every frame
  │              roll, height │   (`const tuning = getChamberTuning()` —
  │ ▸ Table      scale/pos/rot│    a stable object, mutated in place)
  │ ▸ Ground     fade, cell,  │
  │              colour, glow │
  │ ▸ Hologram   x/y/z, width │
  │ ▸ Showcase                │
  │   [ record key ]          │   ← appends current camera pose as a
  │   [ copy all keys ]       │     ShowcaseKey, formatted ready to paste
  │   key index: ◂ 3 ▸        │
  └───────────────────────────┘
```

### The one hard part

To *record* a camera pose you must be able to *move* the camera, and right now the camera is a pure
function of scroll progress — it has no free mode. So the panel needs a free-fly override:

```
  tuning panel open + "free fly" on
        │
        └─► chamberScene.update() skips its pose calculation entirely,
            and the camera is driven by pointer-drag (orbit) + WASD (dolly)
```

Without this, "record key" can only ever record poses the existing tour already visits — useless for
authoring a new one. It is maybe 60 lines, entirely inside the `?tune` branch, and ships to nobody.

**`getChamberTuning()` returns `Readonly<ChamberTuning>`** — the panel needs a mutable handle. Cleanest
is a second export, `getChamberTuningForTuning()`, that returns the same object untyped-readonly, used
only by the panel. The scene keeps reading through the readonly view.

### The handoff

You fly, frame, and record; the panel prints a `ShowcaseKey[]` literal; you paste it to me; I bake it
into `chamberTuning.ts` as the new `SHOWCASE_KEYS` and delete nothing else. Same for `holoX/Y/Z`.

---

## 6. Traps I already know about

1. **`TOUR_START = 0.55` assumes a walk exists.** `chamberScene.ts:116` splits the reveal glide into
   3.2s of pull-back and 2.6s of tour. If the new tour is much shorter (the hologram is now *at* the
   table, so there may be barely any walk), this split and `REVEAL_STEP_DURATION = 5.8` in
   `useHeroAnimation.ts:129` both want retuning, or the reveal will feel padded.

2. **The hologram must not clip the display.** The panel is going "behind the table" — but the display
   *is* the table's screen (`rigPitch: 90`, laid flat into the surface). Anchor the panel too low and
   the table occludes it. The panel is DOM drawn *over* the canvas, so it won't z-fight — it will
   simply float in front of a table it should be behind, which looks worse. Needs checking by eye.

3. **`publishHologram` hides the panel when the anchor is behind the camera** (`chamberScene.ts:856`).
   With the panel now near the table — where the camera *starts* — it may be visible far earlier in the
   reveal than before. `canPlaceHologram` is gated on `inTour`, so it can't appear during the
   pull-back; worth confirming that gate still holds with the new geometry.

4. **`OPAQUE_WINDOW` / `REVEAL_SUN_FADE` must stay paired.** `chamberScene.ts:70` and
   `useHeroAnimation.ts:124` are both `[0.0, 0.12]` and the comments on each point at the other. Not
   touched by this plan, but any reveal-timing change must move both.

5. **Removing the podium changes what `envIntensity` affects.** It's `0` today, so nothing. Noting it
   because the ground shader is unlit-by-design and must not accidentally get wired to the environment.

---

## 7. What I need from you

- **The voidix domain** for `metadataBase` (step 1).
- **After step 4 lands:** fly the chamber with `?tune`, record the new keys, send them back.
- **A call on `performanceTier.ts`** — keep as unused, or delete.
- **Whether to sweep the 4 unused ship models** (7 MB) while we're deleting assets.
