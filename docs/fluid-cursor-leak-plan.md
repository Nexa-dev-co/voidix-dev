# The ink trail leaks into other sections after a resize

> **Status: REPORTED, NOT YET INVESTIGATED.** Logged 2026-08-15 at the user's request, to be picked up
> after the reverse loop. Nothing in here has been verified against the code yet — it is the report
> plus the first places to look.

## The report

> "It happens when I have a small screen size — maybe minimise, or dev tools, regardless of the way.
> When I have the screen at max size (full screen) and I am **not** in the hero section, the cursor
> trail shows up in other sections and it stays there, **except for the FAQ section**. When I go back
> to the hero section and scroll, it gets fixed."

Reduced to its parts:

| | |
|---|---|
| **Trigger** | the viewport grows — restoring from a small window, closing dev tools. The *route* to the small size does not matter. |
| **Symptom** | `FluidCursor`'s ink renders over sections it is scoped out of. |
| **Persists** | yes — it stays until cleared. |
| **Exception** | the FAQ / chamber section does not show it. |
| **Recovery** | return to the hero and scroll. |

## Why each part is a clue

**"Regardless of the way" + a viewport *change* is the trigger.** So this is not about being small — it
is about **crossing a threshold** while somewhere other than the hero. `useIsLowPowerViewport` unmounts
`FluidCursor` below 760px and, unlike the other two viewport hooks, **reacts to resize** by design. So
a shrink unmounts it and a grow **re-mounts it — in whatever section the visitor is standing in.**

**Recovery by returning to the hero and scrolling.** That is the shape of a gate that is applied on a
*transition* rather than held as *state*: the trail's visibility is set when a boundary is crossed, so
a component that mounts already past the boundary never receives the event that would have hidden it.
Scrolling out of the hero crosses the boundary properly and fixes it.

**The FAQ exception is the sharpest clue and should be chased first.** The chamber is the one section
that draws an **opaque `scene.background`** over the whole frame (see `chamberScene` / the works→chamber
reveal). So the ink is very likely leaking there too and simply being painted over. If so, the FAQ is
not an exception at all and any theory that tries to explain it as one is the wrong theory.

## Where to look, in order

1. **`BLACK_STAGE_EVENT`.** This is the trail's gate, and `setStage` publishes it **only on a boundary
   crossing** — `if (wasBlack === isBlack) return;`. A `FluidCursor` mounted *after* the last crossing
   has therefore never heard it. That is the prime suspect and it matches every part of the report,
   recovery included.
2. **`useIsLowPowerViewport`'s resize behaviour** — confirm the unmount/remount actually happens at the
   sizes described, and in both directions.
3. **`.hero-section.is-services`** — whether the trail's canvases are also hidden in CSS, and whether
   that rule can lose to something the component writes inline on mount.

## The likely shape of the fix

A gate that is **state, not an edge**: something a newly-mounted consumer can *read* rather than
having had to be listening earlier. The codebase already prefers this where it matters — a `data-*`
attribute on `documentElement`, or a per-frame store like `lib/hologramPose.ts` — and
`BLACK_STAGE_EVENT` keeping its edge semantics for existing listeners while also publishing the current
value somewhere readable would fix this class of bug rather than this instance of it.

⚠ Note the same trap would apply to the **constellation freeze** and the **sun's z-index**, which read
the same event. Check whether they leak too before concluding the trail is special.
