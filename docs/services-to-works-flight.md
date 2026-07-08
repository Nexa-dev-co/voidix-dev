# Services → Works — the "left-flight"

> The cinematic that carries you from the services fleet into the works field. The ship **launches up
> off the pad, banks left, then flies left across space** while the stars streak and debris drifts in
> from the left — until the camera settles on the first project's meteor. One continuous,
> scroll-scrubbed move, fully reversible.

This doc is the **design spec**. Implementation follows it in ordered steps; nothing here is code.

---

## 1. The idea

You're parked on the space-station pad at the end of services: the **ship**, the **pad**, and the
**sun** are all in view. As you scroll, the ship **leaves** — but the pad and the sun **hold still**,
so it reads as *you* departing, not the world sliding. The ship rises, banks left, and flies left
through space; the star-streaks sell the speed, stray debris floats past, and you arrive looking at
the first project. The sun stays **pinned** the whole way — the fixed centre of the orbit you're
moving through.

Two commitments that shape everything:

- **The sun is pinned.** It never fades, never hides, never drifts — it stays fixed on screen as the
  one far-away anchor. (It's a flat billboard, and that's fine: a fixed billboard *is* a pinned,
  infinitely-far sun.)
- **The camera is to the side.** It watches the ship fly left (a tracking shot), rather than sitting
  behind it. You see the ship in profile as it passes left.

---

## 2. The pieces (and why the sun is pinned)

Three separate WebGL canvases, composited as stacked layers over the near-black page:

```
  ┌───────────────────────────────────────┐
  │  Deck canvas (transparent)  ← SHIP + pad │   on top during the flight
  ├───────────────────────────────────────┤
  │  Works canvas (transparent) ← DEBRIS,    │
  │                                METEORS,  │
  │                                STREAK-STARS │
  ├───────────────────────────────────────┤
  │  the SUN (fixed DOM billboard, pinned)   │   shows through the transparent canvases
  ├───────────────────────────────────────┤
  │  page background (near-black)            │
  └───────────────────────────────────────┘
```

The ship and pad live in the **deck** canvas; the debris, meteors, and the **streaking** starfield
live in the **works** canvas. The sun is a `position:fixed` DOM canvas *behind* both. It's normally
covered by the works field's opaque backdrop — the one change needed to keep it visible during the
flight is to make **that backdrop transparent** so the pinned sun shows through.

Both 3D cameras are driven from **one shared pose** (`lib/handoffFlightPath.ts`) off the same
`0..1` progress, offset-aligned so the ship (deck) and the debris/meteor (works) sit in one space.

---

## 3. The shared world frame

`+X` = right, `+Y` = up, `−Z` = into the screen. The ship starts on the pad at the origin, rises and
banks **left** (`−X`), then flies **left** across to the first meteor, which sits **to the left**.

Top-down (looking down `+Y`):

```
                              −Z (into screen)
                               ▲
                               │
     ●meteor01      · · debris · ·        ┌─ pad (STAYS) ─┐
       ◄───────────────────────────────── ✈ ship flies LEFT
   −X ◄─────────────────────────────────────────────────────────▶ +X
                               │
                               │        ◎ SUN — pinned on screen (fixed), far away
                               ▼
                              +Z
```

Side view of the launch (Phase A) — pad + sun hold, ship rises:

```
     ✈  ← rises up + banks left, nose to screen-left
     │
   ══╪══ pad (stays put)          ◎ sun (pinned)
     camera holds still, watching
```

---

## 4. The timeline (progress `p` = 0..1)

Everything is scroll-scrubbed and reverses on scroll-up. Windows are starting points for tuning.

| Beat | `p` | What happens |
|------|-----|--------------|
| **Rest** | `0.00` | Ship on the pad; pad + sun in view. (Unchanged from services.) |
| **A — Launch** | `0.00–0.30` | The ship **rises up (dominant) with a little left**, banking so its nose points **screen-left**, on a near-linear ramp: **40% up / 0% left → 70% / 20% → 100% / 30%**. The **pad stays put** and the **sun stays pinned** — the anchors that make the motion read. The contact shadow fades as the ship lifts off. **No debris, no meteor, no works field yet.** Camera **holds** the resting pose. |
| **B — Fly left** | `0.30–0.75` | The ship **flies left** across the frame (nose screen-left, gentle weave). The camera **tracks left** (side profile). The works field fades in: the **stars streak** along the travel (the warp-streak effect) selling the speed, and partway through, **debris drifts in from the left**, standing still as you **approach** it. The deck's own stars fade out so the streaking works-stars are the only ones. **Sun still pinned. Still no meteor.** |
| **C — Arrive** | `0.75–1.00` | The camera **turns to frame the first meteor** (project 01) and settles into the works resting framing; the ship eases to its park spot (still on screen); the project's info fades in. Sun still pinned. |
| **Browse** | `1.00` | Normal works field — cycle the project meteors. Ship parked & visible. |

Reverse scroll runs it backward: ship flies back right and lands on the pad, debris recedes left,
the works field fades out, the deck stars return, the pad is back under the ship.

---

## 5. The sun (pinned — one sun, always)

There is exactly one sun: the plasma billboard (`SunCanvas`). It is **not** duplicated and **not**
faded. It stays fixed on screen the entire flight — the fixed orbital centre. The only work is to
stop the works field's opaque backdrop from covering it:

```
  services / rest        flight (A→C)              browse projects
  ┌───────────────┐      ┌───────────────┐        ┌───────────────┐
  │ sun visible    │  →   │ sun PINNED,    │   →    │ sun stays in   │
  │                │      │ works backdrop │        │ the background │
  │                │      │ transparent    │        │ (recommended)  │
  └───────────────┘      └───────────────┘        └───────────────┘
```

Because it's a flat billboard it does **not** parallax or turn with the camera — accepted, since it's
meant to read as an infinitely-far pinned sun. (A sun that truly turns with you would need the unified
single-scene rebuild, which is deferred.)

---

## 6. Anchors & motion cues

- **Pad + sun stay put** → the ship's departure reads as *you* moving. The pad no longer sinks; the
  camera simply leaves it behind as it tracks left.
- **Star-streaks** → the works starfield elongates along the camera's travel while it dollies left —
  the "you'll know it's moving left because of the stars" effect.
- **Debris from the left** → the shards sit still, positioned along the left corridor; flying left
  brings them into frame from the left and past you, so they read as real objects you approach.

---

## 7. Reduced motion & resize

- **`prefers-reduced-motion`:** skip the flight — snap from the fleet to the first project (no launch,
  no tracking), matching how the rest of the site degrades.
- **Resize:** the flight is derived from `p` + named constants (no cached pixel boxes), so a resize
  just re-derives it. The pinned sun keeps its existing resize hide/settle logic — don't fight it.

---

## 8. Tuning knobs (named constants)

**`lib/handoffFlightPath.ts`:** the up/left rise ramp, the left-fly distance, the camera hold→track→turn
keyframes, the ship's nose-left yaw, the meteor's left position, per-beat windows.
**`useServicesDeck.ts`:** shadow-fade + deck-star-fade timing, the flight weave.
**`useWorksField.ts`:** debris corridor placement / reveal window, streak strength.
**`useHeroAnimation.ts`:** the field/works-UI fade windows, `HANDOFF_SCROLL_VH`.
**`app/globals.css`:** the `is-handoff` works-backdrop transparency.

---

## 9. Implementation order (review gate between each)

1. **This doc.** ✅
2. **Flight path + deck** — redesign the shared path (rise-up-left → fly-left → frame-meteor, nose-left,
   meteor to the left); pad stays, shadow + deck-stars fade, camera holds→tracks.
3. **Pin the sun** — make the works backdrop transparent during the flight; confirm one sun, always visible.
4. **Works on the shared path** — left-aligned camera, debris-from-the-left, streaking stars, meteor
   framed at the end; retune the fade windows. Validate the composite.
5. **Polish** — debris timing, streak consistency, shadow fade, reduced-motion, resize, browsing seam,
   reverse-scroll.
