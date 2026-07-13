> ## ⚠ SUPERSEDED (2026-07-13) — see `works-to-chamber-reveal.md`
>
> The cockpit was dropped before it was finished. Instead of *entering* the ship, the camera now backs
> up and reveals that the whole space journey was a **feed on a screen** in a cloning-tank chamber.
> That needs one camera move instead of a first-person camera system, an interior no model has, and a
> hull dissolve — and the ship's return was dropped with it.
>
> Kept for the reasoning, not the plan. Two things in here are still worth reading: **§1's finding that
> the ship ends the handoff *behind* the camera** (dot product −1.39, out of frustum), and the verified
> boarding keyframes in §3 — if the ship's return is ever wanted again, they work.

# Works → Process — "the boarding"

> The ship that flew you from services to works **comes back for you**. It rises from behind your
> shoulder, overtakes you, and parks under the lens. Then the camera **descends into the canopy** —
> the hull dissolves around you — and you are **inside the cockpit**, in first person, looking out at
> the field you were just flying through. That cockpit *is* the Process section.

This doc is the **design spec**. Implementation follows it in ordered steps; nothing here is code.

---

## 0. Why this works (the narrative)

The site's whole spine is one continuous journey:

```
  intro          hero            services         works            PROCESS
  ┌──────┐       ┌──────┐        ┌──────┐         ┌──────┐         ┌──────┐
  │ sun  │──────►│square│───────►│ pad  │────────►│ field│────────►│inside│
  │  in  │       │fills │        │+fleet│  fly    │      │ board   │ ship │
  │ "o"  │       │screen│        │      │  left   │      │         │      │
  └──────┘       └──────┘        └──────┘         └──────┘         └──────┘
                                    you WATCH the ship        you BECOME the ship
```

Services→works was a **third-person chase** — you watched the craft fly. Works→process is the
payoff: **you get in.** Every prior section is something you observed from outside; Process is the
first thing you experience from *inside the machine*. That is the correct place to put "how we work"
— you are literally at the controls.

---

## 1. The two hard facts I verified in the code first

**Fact 1 — where the ship actually ends up.** At handoff = 1 the deck ship sits at shared-frame
`(−16, −3.2, 7)` (`SHIP_POSITION_KEYS` end `(−14, 0.3, −2)` + `EXIT_DELTA (−2, −3.5, 9)`), and the
camera is at `(−15, 1.0, 5)` looking toward `(−15, 0, −2)`.

```
                 camera forward ≈ (0, −0.14, −0.99)
                 camera→ship    = (−1, −4.2, 2)
                 dot            = −1.39   ← NEGATIVE
```

**The ship finishes BEHIND the camera**, below and a little left — out of frustum. That is precisely
the "where it finished" the boarding must bring it back from, and it's why the deck stops drawing at
`DECK_PARKED_THRESHOLD = 0.999`.

**Fact 2 — the trap.** That parked spot is **world-fixed near project 01**. But you board from
**project 04**, whose rest camera is `(4.6, 3.7, −6.5)` in works coords — roughly **17 units away**.
A world-space boarding path would fly the ship in from an arbitrary patch of dark space, from a
direction that means nothing on screen.

```
        ✗ WORLD-SPACE (wrong)                    ✓ CAMERA-LOCAL (right)

     ●01 ✈..........                            ●01
         `-.                                              ●04
            `-.        ●04   ← you                          ↑ you
               `-. ✈──►│                                    │
                       │                            ✈ ──────┘  from behind YOUR lens
     ship trekking across the field           the ship has been shadowing you
     from a place you left long ago           all along — it comes from behind
```

### ► The central decision: the boarding is authored in CAMERA-LOCAL space

The ship's poses are offsets from the camera's own basis (`right` / `up` / `forward`), not world
coordinates. So "it comes back from behind-below the lens and parks under you" is **true no matter
which project you board from, at any viewport, at any aspect ratio**. It is also the physically
honest reading: *the ship is your ride.* It never left. It's been station-keeping just off your
shoulder while you browsed the projects.

Everything else in this design falls out of that one choice.

---

## 2. The pieces (and what is 3D vs DOM)

```
  ┌───────────────────────────────────────────────┐
  │  COCKPIT  (DOM / SVG, fixed on screen)        │  ← canopy struts, dashboard,
  │           the process content lives here       │    process copy, HUD glass
  ├───────────────────────────────────────────────┤
  │  Deck canvas   ← the SHIP exterior (dissolves) │  ← only during the boarding
  ├───────────────────────────────────────────────┤
  │  Works canvas  ← the WORLD (stars, meteors)    │  ← what you see out the window
  ├───────────────────────────────────────────────┤
  │  the SUN  (fixed DOM billboard, pinned)        │  ← seen through the canopy
  ├───────────────────────────────────────────────┤
  │  page background (near-black)                  │
  └───────────────────────────────────────────────┘
```

### Why the cockpit is DOM/SVG, not 3D geometry

This looks like a shortcut. It is actually the *more correct* answer, for three independent reasons:

1. **It is physically right.** When you sit inside a vehicle, the cockpit is your reference frame —
   it does not move relative to your eyes. **The world moves behind it.** A cockpit fixed on screen
   with the starfield drifting past is not a cheat; it is what being inside a ship *is*. The
   immersion comes from the works canvas, which already drifts its stars, floats its meteors, and
   burns its fire.

2. **Process is content-heavy.** Text in WebGL means SDF fonts or canvas textures — blurry,
   unselectable, inaccessible, and a responsiveness nightmare. Every other section of this site
   already renders its copy as a DOM overlay above its canvas (`.deck-overlay`, `.works-overlay`).
   The cockpit is the same pattern, just shaped like a canopy.

3. **It costs nothing.** No third WebGL context, no third bloom composer, no new asset, no new
   entry in `assetLoadProgress`. SVG struts stay crisp at any DPR and reflow at portrait.

The ships are exterior hulls with **no interior geometry** — flying a camera inside one shows
backfaces or nothing. So an interior has to be *authored* regardless. Authoring it in DOM is
strictly better than authoring it in Three.

> **The one thing that must be 3D is the approach** — the ship flying in and dissolving. That ship
> already exists, fully rigged, in the deck canvas.

---

## 3. The beat sheet (progress `b` = 0..1 across the boarding span)

Everything is scroll-scrubbed and reverses on scroll-up. Windows are starting points for tuning.

| Beat | `b` | What happens |
|------|-----|--------------|
| **Rest** | `0.00` | Works browsing, project 04 focused. Ship out of frustum behind-below the lens. Deck not drawing. |
| **A — It comes back** | `0.00–0.30` | The ship **rises from behind your shoulder** and overtakes you: it crosses the lens plane from below and swings up into the bottom of frame. You see its **rear first — engines lit** (the accent glow + bloom already exist). It decelerates hard. Works UI (project detail, arrows) fades out over `[0.02, 0.18]`. **This is the "as if we scrolled back to services" read** — it returns the way it left. |
| **B — It parks under you** | `0.30–0.55` | The ship settles **ahead and below the lens**, banks level, and **turns its canopy up toward you**. Engine glow eases down to an idle. It is now station-keeping: holding a fixed camera-local pose. |
| **C — You go in** | `0.55–0.85` | The camera **pushes forward and descends into the canopy**. As it crosses the canopy plane the ship's **exterior hull fades out** (`presence` → 0, machinery already in `useServicesDeck`) and the **cockpit frame scales up from the canopy's screen position** and fades in. FOV widens a touch through the dive, then settles. **The camera never clips through hull backfaces — the exterior dissolves before it gets there.** |
| **D — Seated** | `0.85–1.00` | Camera arrives at the pilot's eye point. The cockpit is fully formed; the world is framed by the canopy. Process content fades in on the glass over `[0.88, 1.00]`. Deck canvas parks again (ship invisible) → **only the works canvas draws for the whole Process section.** |
| **Browse** | `1.00` | Process steps cycle. The pose at `b = 1` **is** the Process resting pose, by construction. |

### Side view of the boarding

```
   A — it comes back                B — parks under you
   ┌────────────────────┐           ┌────────────────────┐
   │      ·   ✦    ·    │           │      ·   ✦    ·    │
   │   ·          ·     │           │   ·          ·     │
   │        ●04         │           │        ●04         │
   │                    │           │                    │
   │      ╱▔▔▔╲         │           │                    │
   │  ✈──►     engines  │           │     ╭────────╮     │  ← canopy up,
   └──╱─────────────────┘           └─────┤  ✈✈✈✈  ├─────┘    nose forward
     ╱ from behind the lens               ╰────────╯

   C — you go in                    D — seated
   ┌────────────────────┐           ┌────────────────────┐
   │   ╲   ·  ✦   ·  ╱  │           │╲__   ·   ✦   ·  __╱│  ← canopy struts
   │    ╲___________╱   │           │   ╲______________╱ │
   │     ╲ hull    ╱    │           │    │            │  │
   │      ╲ fades ╱     │           │    │   ●04      │  │  ← the world, framed
   │       ╲_____╱      │           │ ┌──┴────────────┴┐ │
   └────────────────────┘           │ │ ▪ ▪ dashboard  │ │  ← process content
      camera descends               └─┴────────────────┴─┘
```

**Reverse scroll runs it exactly backward:** you rise out of the cockpit, the hull re-forms around
you, the ship drops back and falls away behind the lens, the works UI returns.

---

## 4. Non-negotiable: ONE clock

The services→works handoff was rebuilt once already because it ran on **three clocks at once**
(a scrubbed pose, a time-based ship whoosh, a time-based meteor arrival) and fast scroll desynced
them. That lesson is load-bearing here:

> **Every visual in the boarding is a pure function of `b`.** No `gsap.to(...)` with a duration, no
> sentinels, no "arrived" flags. Each scene eases its own copy of `b` per frame (exactly as
> `DEPART_SMOOTHING` / `FLIGHT_CAMERA_SMOOTHING` do today) and derives everything from it.

Consequences that follow automatically: it cannot be outrun, it cannot be skipped, it reverses
perfectly, and a resize just re-derives it.

### Ownership of the ship rig (no two systems writing the same transform)

The two crossings are **disjoint in scroll** — the handoff sits before all the works stops, the
boarding after them — so `handoff === 1` whenever `boarding > 0`. That gives a clean precedence
with no ambiguity:

```
  ship.depart transform:   boarding > 0  ?  boarding  :  handoff
  works camera:            boarding > 0  ?  boarding  :  handoff engaged ? handoff : focus-follow
```

---

## 5. The scroll: a second crossing inside the ONE pin

The homepage stays on a **single pinned ScrollTrigger** (non-negotiable). Today the stop layout is:

```
  fill ──┬─ craft 0 ─ craft 1 ─ craft 2 ─ craft 3 ═══HANDOFF═══ proj 0 ─ proj 1 ─ proj 2 ─ proj 3
         │                                 (180vh)
       120vh          100vh apart                        100vh apart
```

It becomes:

```
  fill ──┬─ craft 0..3 ═══HANDOFF═══ proj 0..3 ═══BOARDING═══ step 0..N
                          (180vh)                  (~180vh)
```

Same shape, same rules: one gesture from the last project commits a long cinematic glide across the
boarding span (mirroring `HANDOFF_STEP_DURATION = 4.0`), input locked for the flight so it can't be
cut short.

### ► This is where the code gets cleaned, not dirtied

`useHeroAnimation.ts` is already 830 lines and **hardcodes** its stop layout, its one crossing, and
its three meter keys (`home`, `services`, `work`). Copy-pasting a second crossing into it produces a
~1100-line pile of special cases — and there is still a **Contact** section to come after this.

So **Step 1 is a behaviour-preserving refactor** that turns the layout into data:

```ts
// The carousel is a list of SECTIONS separated by CROSSINGS.
[
  { section: 'services', stops: craftCount,   setActive: setActiveCraft   },
  { crossing: 'handoff',  vh: 180, event: HANDOFF_PROGRESS_EVENT  },
  { section: 'work',     stops: projectCount, setActive: setActiveProject },
  { crossing: 'boarding', vh: 180, event: BOARDING_PROGRESS_EVENT },
  { section: 'process',  stops: stepCount,    setActive: setActiveStep    },
]
```

From that one list you *derive* the stop offsets, the crossing spans, the nav-meter spans, the
`commitStop` dispatch, and the "does this step cross a crossing?" test — all generically. Contact
then costs two lines instead of another copy-paste.

This refactor ships **on its own, with no new behaviour**, and is verified against the current site
before a single line of boarding is written.

---

## 6. File plan

**New**

| File | Job |
|------|-----|
| `lib/boardingFlightPath.ts` | The shared camera-local choreography. Pure, allocation-free, mirrors `handoffFlightPath.ts`. |
| `lib/boardingEvents.ts` | `BOARDING_PROGRESS_EVENT` + detail + reader. Mirrors `handoffEvents.ts`. |
| `components/sections/Cockpit/Cockpit.tsx` | The DOM/SVG canopy + dashboard + process content. |
| `components/sections/Cockpit/processSteps.ts` | Single source of truth for the process copy. |

**Changed**

| File | Change |
|------|--------|
| `lib/hooks/useHeroAnimation.ts` | §5 refactor, then the boarding crossing + process stops. |
| `components/sections/ServicesDeck/hooks/useServicesDeck.ts` | Boarding owns the ship rig + camera; hull dissolve; draw gate + DPR freeze extended to the boarding. |
| `components/sections/WorksField/hooks/useWorksField.ts` | Boarding owns the camera (precedence above). |
| `components/sections/Hero/Hero.tsx` | Render `<Cockpit/>`; `activeStep` state. |
| `app/globals.css` | `.is-boarding` layering + cockpit styles. |

**Unchanged (worth noting)**

- `Navbar` — the `process` meter **auto-feeds** the moment the pin publishes `--nav-progress-process`. Zero navbar changes.
- `assetLoadProgress` — no new asset source. The cockpit is DOM.

---

## 7. Traps I already know about

| Trap | Guard |
|------|-------|
| Deck is **parked** at works browse (`DECK_PARKED_THRESHOLD`) → ship invisible during boarding | Draw gate becomes `!parkedAtWorks \|\| boardingActive` |
| Adaptive DPR reallocates the composer mid-dive → a visible **jump** on the far side of the stall | Extend the existing `!handoffActive` freeze to cover the boarding |
| Deck must render **over** the works field while the ship flies | Extend the `.is-handoff` z-index lift (new `.is-boarding`) |
| The two cameras drift apart → the ship **shimmers** against the field | Boarding must ease both cameras at the **same rate** (as `0.09 == 0.09` does today) |
| Ship gets **cut off horizontally** at portrait | Scale the ship's park distance by aspect, like `distanceScale` in `useWorksField` |
| Text on raw starfield is **unreadable** | A subtle dark glass scrim inside the canopy, behind the copy |
| `prefers-reduced-motion` | Skip the boarding — snap straight to the seated cockpit |

---

## 8. Decisions (locked 2026-07-13)

- **Cockpit = DOM/SVG**, fixed on screen; the works canvas is what you see through the glass. The
  seated pilot's canopy *should not* parallax against the world — the world moves, not the frame.
- **`useHeroAnimation` is refactored to data-driven sections/crossings FIRST**, as a standalone
  behaviour-preserving change, before any boarding code is written. Contact then costs two lines.

### Still open (can be decided after the boarding lands)

1. **Process content** — what are the steps, and what does scroll *do* once seated? (Rotate the ship
   so the world swings past the canopy? Push forward through space? Light up dashboard panels in
   turn?) The boarding lands on a stable pose either way.
2. **The AI ship flies you in.** Only the *last* craft can enter the handoff, so the vessel you board
   is always craft 04 — "Artificial Intelligence", the purple/cyan legacy hull. Its palette can tint
   the cockpit so it feels like *that* ship's flight deck. Happy accident, or do you want a
   dedicated shuttle?

---

## 9. Implementation order (review gate between each)

1. **This doc.** ← you are here
2. **Refactor `useHeroAnimation` to data-driven sections/crossings.** No new behaviour. Verify the
   live site is unchanged.
3. **The boarding path + the deck.** `boardingFlightPath.ts` + `boardingEvents.ts`; the ship flies
   in and parks. Camera-local, scrubbed, reversible. **No cockpit yet** — validate the flight alone.
4. **The dive + the hull dissolve.** Camera enters; exterior fades. Still no cockpit — validate that
   the entry never clips.
5. **The cockpit.** DOM/SVG canopy + dashboard, scaling in from the canopy plane. Land the seated pose.
6. **The Process stops.** Content + what scroll does inside the ship.
7. **Polish.** Reduced motion, portrait, reverse-scroll seams, the works-UI fade windows.
