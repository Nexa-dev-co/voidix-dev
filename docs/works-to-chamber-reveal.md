# The Reveal — "it was a screen all along"

> The camera backs up. The space you have been flying through for the last three sections turns out to
> be a **feed on a screen**, and the screen is mounted in a **cloning-tank chamber** you have been
> standing in the whole time. Same image, same instant — you just weren't where you thought you were.

This doc is the **design spec**. Implementation follows it in ordered steps; nothing here is code.

---

## 1. Why this is the right call

The cockpit plan needed a first-person camera system, an interior that no model in the project
actually has, a hull dissolve, and a whole new way of showing content. This needs **one camera move**.

It is also the better *idea*. A cockpit is a place you go. A screen is a **reframe of everything you
already saw** — it re-reads three sections retroactively. That's a genuine plot twist, and it costs
less code than the thing it replaces.

```
   what you thought you were doing          what you were actually doing
   ┌───────────────────────────┐            ┌───────────────────────────────┐
   │                           │            │  ┌─┐                          │
   │      ●  flying through    │            │  │ │   ╔═══════════╗   ┌─┐    │
   │         deep space        │    ───►    │  │ │   ║  ●        ║   │ │    │
   │                           │            │  │ │   ╚═══════════╝   │ │    │
   │                           │            │  └─┘   a screen, in a  └─┘    │
   └───────────────────────────┘            │        cloning chamber        │
                                            └───────────────────────────────┘
```

---

## 2. The trick, and why the seam is free

Render the space scene into a **texture** instead of onto the canvas. Put that texture on a **quad**.
Start the chamber camera at the exact distance where the quad **fills the frustum**. Dolly back.

```
   p = 0                    p = 0.4                  p = 1
   ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
   │               │        │  ┌─────────┐  │        │ ▐  ┌─────┐  ▌ │
   │      ●        │        │  │    ●    │  │        │ ▐  │  ●  │  ▌ │
   │               │        │  └─────────┘  │        │ ▐  └─────┘  ▌ │
   └───────────────┘        └───────────────┘        └───────────────┘
   quad fills the frame     bezel appears            the chamber
   → pixel-identical to     around it                around it
     the live scene
```

**There is no cross-fade and no cheat.** At `p = 0` the quad covers the viewport exactly, the texture
is the canvas-resolution render of the very same scene, and the material is unlit — so the pixels
*are* the pixels. The reveal is nothing but the camera moving. That's what makes it feel like a trick
rather than a transition.

Two things must hold for that to be true, and both are cheap:

- **The screen material is unlit** (`MeshBasicMaterial`, `toneMapped: false`). Otherwise the room's
  lighting would tint the feed.
- **The chamber's bloom ramps in from zero.** The space scene already blooms its own fire; if the
  chamber's bloom hit the quad at `p = 0` we'd be blooming it twice and the image would shift.

---

## 3. ⚠ The blocker I found: a texture cannot cross a WebGL context

**This decides the whole architecture, so it goes first.**

The space you see today is composited from **two separate canvases** — the works field (meteors,
debris, stars) and the deck (the ship). Two canvases means two `WebGLRenderer`s means **two WebGL
contexts**, and a GPU texture rendered by one context **cannot be sampled by another**. There is no
flag for this; it's how the browser works.

So whatever ends up on the tablet screen has to be rendered by **one renderer**.

```
   TODAY                                  WHAT THE REVEAL NEEDS
   ┌────────────────┐                     ┌────────────────────────────┐
   │ deck canvas    │ ← the ship          │  ONE renderer              │
   ├────────────────┤                     │   ├─ space scene → texture │
   │ works canvas   │ ← the field         │   └─ chamber scene → canvas│
   └────────────────┘                     │        (quad samples it)   │
   two contexts. cannot                   └────────────────────────────┘
   share a texture.
```

The works field can render itself into a texture today with no trouble. **The ship cannot** — it
lives in the other context. Which forces a question only you can answer (see §8).

---

## 4. The screen, and the one honest compromise

I inspected both models rather than guessing:

| | verts | textures | note |
|---|---|---|---|
| `sci-fi_screen` | **497**, 1 mesh, 1 material | 3 PNG (1.2 MB) | a hollow **frame** — no display surface at all |
| `cloning_tank_chamber` | **6,952**, 15 meshes | **36 images, 29 MB** | geometry is nothing; it's *all* texture |

The screen model has **no screen** — it's a bezel with an empty middle. So we supply the display
ourselves as a quad, which is what we wanted anyway (we control its aspect).

**The compromise:** the quad must be the *viewport's* aspect (that's what makes `p = 0` pixel-exact
and free). The bezel's opening is roughly **1.157** (nearly square). Those don't match.

The fix, in order of preference, applied automatically:

1. **Stretch the bezel** to the viewport's aspect. On desktop that turns a squarish frame into a
   widescreen one — which is exactly what a sci-fi console looks like. The frame is 497 verts of
   simple geometry; it takes the stretch without complaint.
2. **Clamp the stretch** so a phone can't squash it into nonsense.
3. **A black backing plate** fills whatever the clamp leaves over, so the screen letterboxes inside
   its housing instead of showing a hole through to the room. Perfectly believable on a device.

The quad's exact placement inside the bezel gets dialled in with the existing `?tune` panel and baked
into constants — the same way the deck and the field were tuned.

---

## 5. Performance — this section should make the site *faster*

The user's instinct is right: this is the cheap option.

- **The chamber's 29 MB is all texture, and it must not ship as-is.** Move both models to
  `models-src/` and run `npm run optimize:models`. The existing pipeline (Draco + WebP + a texture
  cap) is built for exactly this. At a 512 cap the chamber should land near ~3 MB. Its *geometry*
  (6,952 verts) is free.
- **Lazy-load the chamber.** It's needed at the very end of the page and nowhere else — it must not
  join the intro's asset gate or the first paint. Load it when the user reaches Works.
- **Rendering to a texture costs the same as rendering to the canvas.** We're not adding a pass, we're
  redirecting one. The chamber itself is 15 meshes.
- **After the reveal settles, shrink the texture.** Once you're back in the room the feed occupies a
  small part of the screen, so it doesn't need canvas resolution. Drop the target then — on a settled,
  idle frame, never mid-motion (the composer realloc blocks for a frame, and this codebase has already
  been bitten by exactly that).
- **The deck canvas is already dormant** by this point (it parks itself once the handoff completes),
  so nothing is competing.

---

## 6. The scroll

Same rule as always: **one pin**. The reveal is another crossing inside it.

```
  fill ─┬─ craft 0..3 ══HANDOFF══ proj 0..3 ══REVEAL══ chamber 0..N
                         (180vh)              (~140vh)
```

Which means the stop layout has to stop being hardcoded — it currently bakes in *one* crossing and
*three* meter keys, and this is the second crossing with a Contact section still to come. That's the
small data-driven refactor of `useHeroAnimation` from before: sections and crossings become a list,
and everything derives from it. It ships on its own, proves the live site is unchanged, and then the
reveal lands on clean ground.

Everything in the reveal is a **pure function of the scrubbed progress** — no timed tweens, no
sentinels. It can't be outrun, it can't be skipped, and it reverses for free. (This is the lesson from
the handoff's multi-clock rebuild; it is not negotiable.)

---

## 7. What the chamber is *for*

Once you're standing in the room, the room is the stage for what comes next (Process, then Contact).
The content can live on the chamber's own surfaces — the tank glass, wall panels, the screen itself —
or as a DOM overlay, exactly like every other section. **Not decided here**; the reveal lands on a
stable camera pose either way, so this is a later conversation.

---

## 8. Decisions (locked 2026-07-13)

**No ship.** The reveal runs straight off the last project — the screen shows project 04's burning
meteor. Nothing has to move between renderers, the deck canvas is already dormant by then, and the
twist lands just as hard: it's the *reframe* that shocks, not the ship. The cockpit plan
(`works-to-process-boarding.md`) is superseded.

**Texture resolution scales with the machine.** Not a fixed cap and not a `deviceMemory` guess — by
the time anyone reaches the chamber, `lib/adaptivePixelRatio.ts` has been measuring this machine's
*real* frame times for a minute (the deck and the field have been rendering the entire way down the
page). So the tier is picked from observed performance on this exact GPU:

```
   the build emits two variants        the lazy load picks one, late
   ┌──────────────────────────┐        ┌───────────────────────────────┐
   │ chamber-512.glb   ~3 MB  │        │  measured frames say the GPU  │
   │ chamber-1024.glb  ~6 MB  │  ───►  │  has headroom  → 1024         │
   └──────────────────────────┘        │  …or it's struggling → 512    │
                                       └───────────────────────────────┘
   only ONE is ever downloaded — the choice is made at the Works section,
   long before the chamber is needed, off real data rather than a sniff.
```

This needs one small addition to the adaptive module: it already tracks a smoothed frame time and a
soft ceiling, so it can expose a performance tier without any new measurement.

---

## 9. Implementation order (review gate between each)

1. **This doc.** ✅
2. **Compress the models.** ✅ `chamber-512.glb` (813 KB / ~48 MB VRAM), `chamber-1024.glb` (2.57 MB /
   ~192 MB VRAM), `screen.glb` (156 KB). 29.4 MB → under 1 MB at the default tier. Geometry verified
   intact (nothing decimated; `join` actually cut the chamber from 15 meshes to 12). The optimizer now
   takes per-model recipes and explicit filename args — **do not re-run it over everything**, the
   `models-src` copy of `star_aventure` is already an optimized file and would be double-compressed.
   *(The tier is still chosen manually — the measured-performance selector lands with the lazy load in
   step 5, where it's actually used.)*
3. **Data-driven sections/crossings** in `useHeroAnimation`. ✅ Proved bit-for-bit identical to the old
   hardcoded arithmetic across six section configurations (`Object.is`, not an epsilon compare).
4. **Space → texture.** ✅ The works scene now renders into `spaceTarget` and a second pipeline paints
   it back out full-bleed. See §2 for why the split sits *before* tone mapping.
5. **The chamber + the dolly.** ✅ The room, the bezel, the display, the pull-back, the reveal crossing
   in the pin, the sun's exit, and the lazy tiered load. **Needs tuning by eye** — see below.
6. **Polish.** Whatever the first look throws up (framing, bezel fit, room lighting), plus: bloom on the
   room, texture downscale once the reveal settles, reduced motion, reverse-scroll, portrait.

---

## 10. Numbers to tune (all named constants in `chamberScene.ts`)

Nothing here could be judged without seeing it, so it's all one-line knobs:

| Constant | What it does |
|---|---|
| `DISPLAY_HEIGHT` | how big the display is in the room — and therefore how far back `coverDistance` starts |
| `REST_DISTANCE` | how far the camera ends up; i.e. how much room you see around the display |
| `REST_RISE` | how far it lifts on the way back (brings the floor into view) |
| `REVEAL_EASE_POWER` | how much it creeps off the display before committing to the pull-back |
| `ROOM_WIDTH` / `ROOM_Z_OFFSET` | the room's scale, and how far back it sits so the camera ends up *inside* it |
| `BEZEL_OVERSIZE` / `BEZEL_Z` | how far the frame oversteps the display, and how it sits against it |
| `SCREEN_LIGHT_*` | the display lighting the room — the reveal falls flat if the room isn't lit by it |
| `OPAQUE_WINDOW` | how fast the dark of space stops being see-through (keep in step with `REVEAL_SUN_FADE`) |
