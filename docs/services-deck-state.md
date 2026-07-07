# Services Deck â€” Current State & Tuning

> Living handoff doc for the homepage **Services** section (now a **landing-pad carousel**).
> Hand this to a fresh chat to bring it up to speed. For the original build rationale see
> [`services-deck-plan.md`](./services-deck-plan.md).

## What it is

A **single-pad carousel** on the homepage, after the hero. One spacecraft sits on a central
landing pad (`space_landing.glb`) under a starfield; the four service names run along the
bottom as a strip. The section **pins** while you scroll: each scroll notch snaps to the next
craft (the current one flies off the pad, the next flies on); after the last it unpins and the
page continues. You can also **drag the craft** to rotate it (it springs back on release) and
**flick it horizontally** to switch, or **click a name** in the strip to jump to a craft.

**Files** (`components/sections/ServicesDeck/`):
- `ServicesDeck.tsx` â€” section markup, `activeIndex` state, carousel strip, detail panel
- `deckServices.ts` â€” the four services + **per-ship colors** (see below)
- `DeckCanvas/DeckCanvas.tsx` â€” canvas wrapper + loading; props `{ activeIndex, onFlick }`
- `hooks/useServicesDeck.ts` â€” the Three.js scene (starfield, pad, one craft, swap, drag)
- `hooks/useDeckCarousel.ts` â€” pins the section, snaps scroll to each craft, owns `activeIndex`,
  exposes `goTo(index)` (used by label clicks + ship flicks via `ScrollToPlugin`)
- Styles: `.deck-*` / `.services-deck` block in `app/globals.css`
- Models: Draco-compressed `.glb` in `public/models`; decoder in `public/draco`; raw sources in
  `models-src/` (re-optimize with gltf-transform â€” see [`services-deck-plan.md`](./services-deck-plan.md))

> Retired in the refactor: `useDeckReveal.ts` and `useDeckSnap.ts` (the old `-100vh` overlap +
> guard-reveal + snap-assist) â€” replaced by the clean pinned section in `useDeckCarousel.ts`.

## Ship identities â€” graded palettes  â† edit `profile` in `deckServices.ts`

Each hull is **re-graded onto its own palette** instead of washed to one flat hue. The model's own
albedo *luminance* drives a three-tone map (`shadow` â†’ `hull` â†’ `highlight`), so panels, recesses,
and bright faces stay distinct â€” the ship reads as a real, multi-material machine, never one solid
colour. On top of that the brightest texels (engines/windows) are picked out as an `accent` glow
that feeds the bloom pass, and the silhouette catches a thin fresnel `rim`. The model's
normal/roughness/metalness maps are left untouched, so the PBR realism survives the recolour. This
all lives in `hullMaterial.ts` (`applyHullMaterials` â†’ `createHullMaterial` â†’ `applyGradedHull`).

Each `profile` is fully independent (no shared values). Fields: `shadow / hull / highlight / accent
/ rim` (hex), `metalness / roughness / clearcoat / clearcoatRoughness`, `iridescence (+ IOR)`,
`gradeMid` (shadowâ†’highlight pivot), `emitThreshold / emitStrength` (the glow pickout), `envIntensity`.

| # | Service | identity | hull | accent (glows) | finish | Model |
|---|---|---|---|---|---|---|
| 01 | Web Experiences | Ember Noir | full black `#060606` | faint red rim `#4a0f13` | matte; near-neutral light | `spaceship.glb` |
| 02 | Mobile Systems | Deep Navy | navy `#14233f` | cool white `#cfe0f5` | matte; reddish key light | `spaceship3.glb` |
| 03 | Enterprise Platforms | Gunmetal | gunmetal `#3a4856` | **warm amber `#ffb24d`** | brushed metal | `cargo_spaceship.glb` |
| 04 | Artificial Intelligence | Legacy (original) | purple `#7a4ad0` | â€” (no accent glow) | flat two-tone tint | `star_aventure_spaceship_starship_fighter.glb` |

> Ships 01â€“03 use the **graded** treatment. **Ship 04 is the original pre-overhaul look** â€” a flat
> two-tone tint (`LegacyProfile`: `colorCore` purple `#7a4ad0` â†’ `colorEdge` cyan `#36e6ff`, native
> metalness/roughness, no graded palette/clearcoat/iridescence), kept on request. The treatment is
> chosen per ship by `profile.kind` (`'graded'` default / `'legacy'`); see `hullMaterial.ts`.
>
> The graded ships are deliberately **low-gloss** (matte/painted metal: low `metalness`, higher
> `roughness`, light `clearcoat`, reduced `envIntensity` â‰ˆ0.4â€“0.7 so the studio env doesn't read as
> mirror reflections; ships 01 + 02 are the least reflective at `envIntensity` 0.4 / `metalness` 0.25).
> Upgrade to `MeshPhysicalMaterial` is skipped on the low-power path; the grade
> still applies. The `?tune` panel exposes `metalness / roughness / clearcoat / envMapIntensity` for
> live tuning (graded ships; legacy ship 04 only responds to metalness/roughness).

> **Dial it in live:** open the deck with `?tune` for a `lil-gui` panel exposing the centred ship's
> palette/PBR + the bloom (strength/radius/threshold). Tune by eye, then bake the values back into
> `deckServices.ts` / the constants. The panel never loads without the flag.

## Tuning knobs

### Hull brightness / glow â€” `useServicesDeck.ts` (`â”€â”€ Powered-on look â”€â”€` / `â”€â”€ Engine glow pulse â”€â”€`)
| Constant | Value | Effect |
|---|---|---|
| `DORMANT_BRIGHTNESS` | `0.4` | hull brightness as a craft **leaves** the pad |
| `ACTIVE_BRIGHTNESS` | `1.0` | hull brightness on the **centred** craft |
| `LIT_EMISSIVE_INTENSITY` | `1.3` | any **native** emissive map's intensity when centred |
| `EMIT_PULSE_AMPLITUDE` / `_SPEED` | `0.22` / `1.6` | engine-glow breathing on the centred craft |

> The old `FRESNEL_POWER` is gone; the rim now lives in `hullMaterial.ts` as `RIM_POWER` / `RIM_STRENGTH`,
> in the per-ship `rim` colour.

### Bloom + per-ship rim light â€” `useServicesDeck.ts`
`BLOOM_STRENGTH` `0.85` (`_LOW` `0.5` on weak devices) Â· `BLOOM_RADIUS` `0.5` Â· `BLOOM_THRESHOLD` `0.7`
(only the bright accents/highlights bleed) Â· `BLOOM_MSAA_SAMPLES` `4` (composer-target MSAA, since
`antialias:true` is ignored once a composer renders). Pipeline: `RenderPass â†’ UnrealBloomPass â†’
OutputPass`.

**Per-ship lighting** (`applyShipLighting`, `RIM_LIGHT_TWEEN` `0.5`s): on each swap the **rim light**
eases to the ship's `rim` colour, and the **key light** eases to the ship's optional `light`
override (`{ color, intensity? }` in `deckServices.ts`) â€” so each craft feels lit for itself. Ships
that omit `light` keep the default warm key (`KEY_LIGHT_COLOR` / `KEY_LIGHT_INTENSITY`). Current
overrides: **01 Ember Noir** â†’ near-neutral warm key `#c9c2bc` + neutral fill `#4a4644` (so the black
hull reads black, not red-washed); **02 Deep Navy** â†’ reddish `#ff5e47` (warm/cool contrast
against the navy hull). **03 / 04** omit it (unchanged warm key). A `light.fill` override (per-ship
fill colour) and a `modelRotation` (per-ship base rotation, in degrees) are also available â€” ship 04
uses `modelRotation: { x: -180 }` to flip its mis-oriented hull.

### Low-power path â€” `useServicesDeck.ts`
`LOW_POWER_MAX_WIDTH` `760`. Coarse pointer **or** viewport narrower than this â†’ keep
`MeshStandardMaterial` (skip clearcoat/iridescence), softer bloom, no MSAA. The grade/accent/rim
still apply, so the look stays consistent â€” just cheaper. Reduced motion additionally drops the
idle animation (float bob + turntable spin + engine pulse).

### Idle animation (centred craft) â€” `useServicesDeck.ts`
The centred craft continuously **floats** up/down (`FLOAT_AMPLITUDE` `0.1` Â· `FLOAT_SPEED` `1.1`),
**spins** slowly like a turntable (`AUTO_ROTATE_SPEED` `0.35` rad/s on `lift.rotation.y`, paused
while dragging so manual rotate stays precise), and its engines **breathe**
(`EMIT_PULSE_AMPLITUDE` / `_SPEED`). Parked/off-stage craft don't animate. All of it is gated behind
reduced motion.

### Landing pad + stars â€” `useServicesDeck.ts`
`PAD_TARGET_WIDTH` `5.0` (pad footprint) Â· `PAD_Y_OFFSET` `0.6` (raise pad so its platform comes up
under the craft â€” the model's bbox is taller than the visible deck) Â· `SHIP_HOVER` `0.05` (height
the craft sits above the pad) Â· `TARGET_SIZE` `2.3` (craft scale). **Pad colour:** `PAD_COLOR`
`0x16222b` (dark slate, multiplies the texture) Â· `PAD_EMISSIVE_COLOR` `0x0b3a45` /
`PAD_EMISSIVE_INTENSITY` `0.55` (faint cyan glow in the recesses). Stars: `STAR_COUNT` `1200` Â·
`STAR_INNER/OUTER_RADIUS` `18`/`60` Â· `STAR_SIZE` `0.16` Â· `STAR_DRIFT` `0.006`.

### Carousel swap (sequenced) â€” `useServicesDeck.ts` (`â”€â”€ Carousel swap â”€â”€`)
The outgoing craft **fully clears the pad before** the incoming one arrives (no collision at
centre): `SWAP_OUT_DURATION` `0.5` (exit) Â· `SWAP_GAP` `0.06` (empty beat) Â· `SWAP_IN_DURATION`
`0.62` (entrance, arrives at `enterDelay = OUT + GAP`). Each banks + warps scale for flair:
`SWAP_OFFSET_X` `3.6` Â· `SWAP_OFFSET_Y` `0.55` Â· `SWAP_BANK` `0.5` (roll) Â· `SWAP_ENTER_SCALE` `0.6`
Â· `SWAP_EXIT_SCALE` `0.7`. Direction decides which side each enters/leaves from.

### Drag-to-rotate + flick â€” `useServicesDeck.ts` (`â”€â”€ Drag-to-rotate + flick â”€â”€`)
`DRAG_YAW_SENSITIVITY` `0.006` rad/px Â· `DRAG_PITCH_SENSITIVITY` `0.004` Â· `DRAG_YAW_CLAMP` `1.0`
Â· `DRAG_PITCH_CLAMP` `0.45` Â· `SPRING_DURATION` `0.9` (ease back on release, `elastic.out`) Â·
`FLICK_DISTANCE_PX` `110` (horizontal travel past this, and horizontally dominant, = a switch).

### Pin & cycle â€” `useDeckCarousel.ts`
`VIEWPORTS_PER_STEP` `1` (scroll height between adjacent craft â†’ `end: '+=300%'` for four) Â·
`REVEAL_DURATION` `0.6` (fade the stage in at pin-start) Â· `HIDE_DURATION` `0.4` (fade the stage
out on `onLeaveBack` â€” scrolling up out of the section; the reveal replays on re-entry) Â·
`GOTO_DURATION` `0.6` (programmatic scroll on label/flick) Â· `SNAP_DURATION` `0.5` (settle onto the
nearest craft) Â· `REVEAL_FALLBACK_MS` `7000`. Trigger creation is gated behind the hero
`REVEAL_EVENT` + a rAF + `ScrollTrigger.refresh()`. The section is pulled up `margin-top:-100vh`
(globals.css) so its pin begins where the hero's pin ends â€” no empty black scroll between them.

### Framing / lighting â€” `useServicesDeck.ts`
`CAMERA_*` (FOV `34`, distance `8.2`, height `1.7`, look-Y `0.75`) Â· `TARGET_SIZE` `2.3` (hull
scale) Â· `BASE_YAW` `-0.6` (resting 3/4 view) Â· `KEY_LIGHT_*` (warm `#fff2e2`, `2.4`) Â·
`FILL` / `RIM` (`0.8`, recoloured per ship) / `AMBIENT` Â· `TONE_MAPPING_EXPOSURE` `1.18`
(**Neutral** tone mapping). Environment reflection strength is now **per ship** (`profile.envIntensity`).

### Sun (hero) â€” `lib/hooks/useHeroAnimation.ts`
`SUN_SCROLL_SCALE` `1.1` (size) Â· `SUN_SCROLL_RISE` `200` (px raised above the square center).

## How the key behaviors work (brief)

- **Reveal:** the section is a normal-flow pinned block right after the hero (pulled up
  `margin-top:-100vh` to sit over the hero's tail), with a solid `--bg` backdrop. As you scroll in,
  the black panel fills and pins (`start: 'top top'`); at pin-start `onEnter` fades the canvas +
  overlay in (`REVEAL_DURATION`) **and dispatches `DECK_REVEAL_EVENT`** â†’ `useServicesDeck`
  replays the centred craft's full entrance (`replayEntrance`). Gated behind `REVEAL_EVENT` so it
  builds after the hero pin exists.
- **Scroll-up hide + replay:** scrolling back up out the top (`onLeaveBack`) fades the section out
  over `HIDE_DURATION` (0.4 s) and flips the `hasRevealed` latch, so scrolling back down replays
  the whole reveal (DOM fade + the craft's warp-in) from scratch.
- **Pin & cycle:** while pinned, scroll progress 0â†’1 maps across the four craft with `snap`;
  `onUpdate` rounds progress to an index and sets `activeIndex` (React de-dupes, so it only
  re-stages on a crossing). After the last craft the pin releases and the page continues.
- **Swap:** changing `activeIndex` flies the current craft off the pad and the next one on
  (`SWAP_*`), dimming/fading the one that leaves.
- **Drag:** pointer-down on the canvas grabs the centred craft; dragging rotates it (clamped). On
  release a big horizontal flick (`FLICK_DISTANCE_PX`) calls `onFlick` â†’ `goTo(Â±1)`; otherwise it
  springs back to the resting view. `goTo` scrolls the page to that craft's snap point, so **scroll
  stays the single source of truth**.
- **Strip:** the four names along the bottom; the active one is lit; clicking one â†’ `goTo(i)`.

## Open / next
- **Touch:** drag-to-rotate uses pointer events (works with mouse). On touch, the pin still cycles
  via scroll and labels still tap, but rotate-vs-scroll on the same surface isn't tuned yet.
- **Seam:** confirm there's no sliver between the hero unpin and the deck pin; tune `end` / the
  hero pin length if a gap shows.
- Reduced motion: instant swaps, no drag/float; scroll-cycle (pin/snap) + label clicks still switch.

## Services -> Works handoff (added 2026-07)

The old instant cross-fade between the fleet and the works field is replaced by a **cinematic
departure**: one wide scrubbed span (`HANDOFF_SCROLL_VH` = 380, vs 100 per normal stop) between
the last craft stop and project 01, owned by the hero pin (`lib/hooks/useHeroAnimation.ts`).

**The beats (all fractions of the 0..1 handoff, all reversible by scrolling back):**
1. `0.05-0.24` deck UI fades out; craft swells toward camera (`DEPART_GROW_WINDOW` 0.03-0.35)
2. `0.12-0.48` craft yaws/banks to face screen-right; pad+shadow sink, deck stars fade (0.1-0.5)
3. `0.3-0.5` works field (backdrop + canvas) fades in UNDER the craft
4. `0.4-0.86` project 01's meteor rides in from deep field-left, tiny -> full size, igniting from
   55% of the ride (`ARRIVAL_*` in `useWorksField.ts`)
5. `0.45-0.97` craft accelerates off the right edge (`DEPART_EXIT_WINDOW`); works UI settles 0.8-0.94

**Plumbing:**
- The pin lays the stops out **non-uniformly** (vh offsets -> progress values); snap targets the
  laid-out positions with a distance-scaled duration (`SNAP_DURATION` 0.5 -> `SNAP_DURATION_MAX` 2.2),
  so a flick glides through the whole cinematic.
- The pin dispatches `HANDOFF_PROGRESS_EVENT` (`lib/handoffEvents.ts`, detail 0..1) on every change;
  BOTH scenes listen and ease toward the target per frame (`DEPART_SMOOTHING` / `ARRIVAL_SMOOTHING`
  0.09) - scenes stay smooth even under jumped scroll.
- Deck rig gained a `depart` group (stage -> **depart** -> lift -> spin) so the departure scrub
  never fights the carousel swap tweens; the turntable spin is gripped/settled as departure ramps
  (`DEPART_GRIP_SPAN`, `TURNTABLE_SETTLE`).
- Mid-handoff the hero section carries `.is-handoff`, raising `.services-deck` (z 35) above
  `.works-field` (z 30) so the craft flies OVER the incoming meteors (globals.css).
- `WORKS_REVEAL_EVENT` / `worksEvents.ts` were **removed**: entering/leaving works is always a trip
  through this span, so the scrub IS the replayed entrance/ignition.
- `DEPART_TURN` (2.2 rad) assumes glTF +Z-forward hulls; if a craft reads as flying backwards
  during departure, tune it in `useServicesDeck.ts`.
