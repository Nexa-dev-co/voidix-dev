# Works → Chamber — "it was a screen all along"

> **Living state doc.** The reveal is built and working. This is what it is, why it's built the way it
> is, and every trap that cost us a round to find. Read §3 before changing anything.

Scroll past the last project and the camera **backs up**: the space you've been flying through for
three sections shrinks into a **screen laid flat in a table**, and the table turns out to be in a room
you've been standing in the whole time — with a ring-portal podium across from you. Then the camera
tours the room. One scroll, one continuous shot.

```
   what you thought you were doing          what you were actually doing
   ┌───────────────────────────┐            ┌───────────────────────────────┐
   │                           │            │      ((( ● )))                │
   │      ●  flying through    │    ───►    │       podium                  │
   │         deep space        │            │                    ╔════╗     │
   │                           │            │                    ║ ●  ║ ← the table
   └───────────────────────────┘            └───────────────────────────────┘
```

---

## 1. How it works

The space scene renders into a **texture** instead of onto the canvas. That texture is painted onto a
**quad**. The chamber camera starts at exactly the distance where the quad **fills the frustum**, and
then dollies away.

```
   progress 0               progress 0.4             progress 1
   ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
   │               │        │  ┌─────────┐  │        │  ((●))   ╔══╗ │
   │      ●        │        │  │    ●    │  │        │  podium  ║● ║ │
   │               │        │  └─────────┘  │        │          ╚══╝ │
   └───────────────┘        └───────────────┘        └───────────────┘
   the quad fills the        the table appears        you're in the room
   frame → pixel-identical   around it
   to the live scene
```

**There is no cross-fade and nothing is faked.** At progress 0 the quad covers the viewport exactly,
the texture is the canvas-resolution render of the very same scene, and the material is unlit — so the
pixels *are* the pixels. The reveal is nothing but the camera moving.

Because the display's aspect is set to the **viewport's** aspect, the distance that covers the frame
vertically also covers it horizontally. One number, exact at every aspect ratio:

```
  coverDistance = (displayHeight / 2) / tan(fov / 2)
```

---

## 2. The pieces

| File | Job |
|---|---|
| `lib/spacePresentMaterial.ts` | The shader that paints the space onto a surface. Raw passthrough — see §3.1. |
| `lib/chamberEvents.ts` | `CHAMBER_PROGRESS_EVENT` (the scrubbed reveal), `CHAMBER_STOP_EVENT`. |
| `lib/chamberTuning.ts` | Every number in the reveal + the showcase path, as **fixed constants**. The single source of truth. |
| `lib/performanceTier.ts` | Which texture tier to fetch, from **measured** frame times. |
| `lib/carouselLayout.ts` | The pin's stops/crossings, as data. |
| `lib/hooks/useHeroAnimation.ts` | The one pin. Owns the reveal crossing + the chamber section. |
| `components/sections/Chamber/chamberScene.ts` | The room: props, camera, showcase, spin, colour. |
| `components/sections/WorksField/hooks/useWorksField.ts` | Renders the space **and hosts the chamber**. |

### Why the chamber lives inside the works field

**A GPU texture cannot cross a WebGL context.** The deck (ship) and the works field are separate
canvases = separate renderers. The space is rendered by the works renderer, so anything that *displays*
it must be drawn by that same renderer. That is the whole reason `useWorksField` hosts the chamber
rather than the chamber having its own canvas. Do not "tidy" this.

### The render path

```
  space scene ──► spaceComposer (RenderPass + bloom) ──► texture, LINEAR HDR
                                                              │
                        ┌─────────────────────────────────────┘
                        ▼
     reveal == 0:  full-bleed quad ──┐
     reveal  > 0:  chamber scene   ──┴──► screenComposer (OutputPass + SMAA) ──► canvas
```

The split sits **before tone mapping**, and exactly one `OutputPass` exists, at the very end. Tone-map
into the texture and the screen pipeline tone-maps it *again* — the whole image shifts the instant the
reveal engages.

---

## 3. Traps — every one of these cost a round to find

### 3.1 `MeshBasicMaterial` would paint the sun out of the site
The works canvas is transparent; the pinned sun shows *through* the space. `MeshBasicMaterial` with
`transparent: false` compiles with three's `OPAQUE` define, which forces `gl_FragColor.a = 1.0`. Hence
the raw passthrough shader in `spacePresentMaterial.ts`. It also does no tone mapping and no colour-space
transform, which is what keeps the pixels identical.

### 3.2 EffectComposer's buffer roles are backwards from what they look like
`new EffectComposer(renderer, target)` makes `target` the **write** buffer and **clones a second one**
for the **read** buffer. `RenderPass` and `UnrealBloomPass` both draw into the **read** buffer and
neither swaps. So the finished image is in `composer.readBuffer`, *not* in the target you constructed it
with. Sampling the wrong one gives a fully transparent texture and the field renders as an empty void.
**Always read the output back off the composer.**

### 3.3 The crop must never be applied flat
At progress 0 the display must show the render **1:1**. Any crop there opens the reveal on a zoomed,
panned picture — a visible jump. The crop is therefore ramped in with the pull-back. If a prop's screen
doesn't match the render's shape, **stretch the prop** (its scale is per-axis) rather than distorting the
picture. That's why `tableScale*` is deliberately non-uniform and all four crops are 0.

### 3.4 A rig's `position` is local to its PARENT
Measure a centre in world space, assign it to a rig nested inside another rig, and the origin lands
offset by the parent's own centre. **The mesh still draws in the right place** — the two errors cancel —
so nothing looks wrong until you *rotate* it, and then it swings around a point out in space. Use
`parent.worldToLocal(...)`. This bit us on the spinning core ring.

### 3.5 The models' bounding boxes lie
The cloning-tank chamber's box was 1635 units tall but its walkable room only ~410 — dominated by a floor
slab dropping 600 below and a ceiling slab rising 600 above. Normalising by it buried the camera *inside
the floor*. **Place models from measured coordinates, not their bbox.** (That model is no longer used, but
the lesson stands.)

### 3.6 The set is lit ENTIRELY by its own emissives
Every light is at **zero** — `screenLight`, `ambient`, `keyLight`, `envIntensity`. That is deliberate: in
a black room the only thing throwing light is the screen you're looking at. Adding a key light or an
environment washes it out instantly. It also means **tinting a colour only works if you tint the
emissive** — the cables' colour *is* their glow.

### 3.7 The optimizer's `join` fuses meshes that share a material
It welded all three concentric rings into one object, so there was no core ring to spin alone. The podium
is built with **`join: false`** for that reason (`scripts/optimizeModels.mjs`). The three rings are the
same geometry at different **node scales**, so their raw vertex bounds are identical — the core can only
be found by measuring the *placed* size, with world matrices refreshed first.

### 3.8 Everything is a pure function of scroll — except the two GSAP moves
The reveal is scrubbed. The showcase is a GSAP timeline fired when the reveal *lands*. Do not add a third
clock. (This site has already been rebuilt once because a crossing ran on three clocks and fast scroll
desynced them — see `docs/services-to-works-flight.md`.)

---

## 4. The scroll

```
  fill ─┬─ craft 0..3 ══HANDOFF══ proj 0..3 ══REVEAL══ chamber
                        (180vh)              (140vh)   (1 stop)
```

The chamber is **one stop**. The reveal is a scrubbed crossing (`CHAMBER_PROGRESS_EVENT`); when it
reaches 1, the chamber scene plays the **whole showcase** as one GSAP timeline. One gesture, one shot.

`REVEAL_SETTLE_MS` (in `useHeroAnimation`) locks input across the reveal **plus** the tour. If
`showcaseSeconds` grows past ~3s, raise it or a second scroll will cut the tour short.

### The hand-off has no seam because there is nothing to seam
The reveal's resting pose **is** showcase key 0. Literally the same pose twice. Don't let `camX/camY/camZ`
drift from it — those are only the fallback for a room with no showcase.

---

## 5. The set

Two models, both from `models-src` via `npm run optimize:models -- <file>`:

| | raw | shipped | VRAM |
|---|---|---|---|
| `podium-512 / -1024` | **153 MB** (27 × 4096² maps!) | 988 KB / 1.4 MB | 2298 MB → **31 MB** |
| `table` | 10.9 MB | 636 KB | 3 MB |

The podium is not a podium — it's a **whole set**: a ground plane, a small plinth, a ring portal, cabling,
and two pyramids 27 units back and 41 wide. Its pieces are rigged as **one assembly** (`Rings` + `Turbine`
+ `Cables` + `Cable_Joiners`) so they move together; the **core ring** spins alone inside that.

The chamber-room and sci-fi-screen models were **dropped** (`chamber-*.glb`, `screen.glb` deleted). Their
recipes remain in the optimizer if they're ever wanted back.

---

## 6. Tuning

**The numbers are now fixed constants.** There was once an on-screen `ChamberTuner` panel (with HOLD,
a free-fly scout camera, pose recording, per-part ▣/⌖ helpers, and a JSON export) that wrote to a live
store; it and the store's editable layer have been removed. `chamberScene` reads the values once and
the FAQ hologram reads its `holo*` values — both via `getChamberTuning()`.

To retune, edit `CHAMBER_TUNING` / `SHOWCASE_KEYS` in `lib/chamberTuning.ts` directly. (If you need the
old drag-to-place/record workflow back, restore `ChamberTuner.tsx` and the store from git history.)

---

## 7. What's still open

1. **The seam has never been confirmed by eye.** Everything is built so the image should sit still while
   the camera retreats. Nobody has said out loud that it does. If it *jumps* at the very first frame, the
   pipeline split is wrong and that's a correctness bug, not a cosmetic one.
2. **The hologram.** Every showcase pose already carries the screen's own position/rotation/size, so the
   feed can **lift out of the table and settle into the ring portal** as the camera walks to it. That's
   what the portal is for. It just needs the poses re-recorded with the screen ▣'d into the rings.
3. **What the room is FOR.** The chamber is one stop. The Process content — steps on the podium? on the
   table's screen? a DOM overlay? — is undecided.
4. **Reduced motion / portrait** have not been exercised on this section.
