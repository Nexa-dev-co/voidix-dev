/**
 * The loop: contact → fall into the black hole → back out at the hero.
 *
 * ── Why this needs three signals and not one ─────────────────────────────────────────────────────
 * Because a loop on this site is a TELEPORT, not a scroll. The whole page is one pinned ScrollTrigger
 * with a fixed range and contact sits at pin progress 1, so there is no gesture that carries you from
 * there back to 0 — the pin has to be scrolled to the top outright, which reverses every scrubbed value
 * on the site in a single frame.
 *
 * That splits the move into three things that happen at three different moments:
 *
 *   LOOP_PROGRESS   the dive, scrubbed 0..1 like every other crossing. Reversible: scroll back and you
 *                   are at the contact form again. Its job is to be OPAQUE by the time it reaches 1.
 *   LOOP_RESET      fired once, underneath the cover, at the instant the scrollbar jumps. Everything
 *                   that EASES its way to a target has to be told to stop easing and be there now.
 *   LOOP_REQUEST    "take me back to the hero" from something that is not the scroll — the Travel in
 *                   time button. Routed through the pin so there is one commit path, not two.
 *
 * See docs/contact-loop-plan.md.
 */

/** The dive, 0 (standing at the contact form) → 1 (inside the horizon, screen black). */
export const LOOP_PROGRESS_EVENT = 'voidix:loop-progress';

export interface LoopProgressDetail {
  /** 0..1 across the dive; the boundary values are re-sent when the span is exited. */
  progress: number;
}

export function readLoopProgress(event: Event): number {
  const detail = (event as CustomEvent<LoopProgressDetail>).detail;
  return typeof detail?.progress === 'number' ? detail.progress : 0;
}

/**
 * The scrollbar has just been thrown back to the TOP. Be at the hero's state now — do not ease there.
 *
 * ⚠ This exists because several scenes deliberately CHASE their scrubbed target rather than reading it
 * — `chamberState.current`, `flightState.current`, the sun's `cracks` / `collapse` ramps, the finale's
 * sequence. That chase is what makes every crossing cinematic, and it is exactly wrong here: at the
 * teleport their targets drop to 0 instantly while their current values walk there over half a second
 * or more, so behind the cover the chamber re-assembles, the star un-dies and the shell re-cracks. Any
 * of it showing at the edge of the flood ruins the illusion.
 *
 * ⚠ IT IS THE HERO-ARRIVAL RESET, NOT A GENERAL "YOU WERE MOVED" SIGNAL, and the difference is not
 * academic — a stale revision of this comment described it as forcing `current = target`, which is what
 * a general signal would do. Read the handlers: every one of them writes ZERO. `useWorksField` zeroes
 * the reveal, the return, the dive and the flight and calls `singularity.reset()`; `SunModelCanvas`
 * zeroes all four ramps. That is correct for this event — the destination is progress 0 — and it means
 * the event cannot be reused for a jump that lands anywhere else. The reverse loop, which lands at the
 * BOTTOM, needs LOOP_SNAP_EVENT below.
 */
export const LOOP_RESET_EVENT = 'voidix:loop-reset';

/**
 * The pin has just been moved outright to somewhere that is NOT the top. Be at your current targets now.
 *
 * The direction-agnostic half of `LOOP_RESET_EVENT`: `current = target`, and nothing else. Every
 * handler pairs with a reset handler and does strictly less — it never writes a target, because by the
 * time this fires the targets are already right (the pin drives the crossings to the new position
 * before dispatching, precisely so that they are).
 *
 * ⚠ ORDER IS THE WHOLE CONTRACT. Dispatch this only AFTER the crossings have been applied at the new
 * position. Fire it first and every scene snaps to the targets it is leaving, which is worse than not
 * snapping at all — an eased value at least arrives eventually.
 */
export const LOOP_SNAP_EVENT = 'voidix:loop-snap';

/**
 * Commit the loop from outside the scroll (the Travel in time button).
 *
 * The pin owns the commit either way: a button that scrolled by itself would be a second path through
 * the same cinematic, and the two would drift the first time the dive's length changed.
 */
export const LOOP_REQUEST_EVENT = 'voidix:loop-request';

/**
 * The cream has closed over the screen — the hero may now build itself.
 *
 * Fired by the veil rather than timed by the pin, for the same reason `CHAMBER_HOLOGRAM_EVENT` is fired
 * by the chamber: only the thing doing the covering knows when it has finished. Hanging the arrival off
 * a constant here that had to be kept in step with `CREAM_FLOOD_SECONDS` over there is the timing
 * coupling this codebase keeps having to undo.
 *
 * Everything the hero shows is held staged and hidden between the teleport and this — otherwise the
 * entrance plays out UNDER the cream and the visitor gets a fully-built hero the instant it clears,
 * having watched none of it.
 */
export const LOOP_COVERED_EVENT = 'voidix:loop-covered';

/** The sun should come apart and gather again, as it does for the loader. */
export const SUN_REGATHER_EVENT = 'voidix:sun-regather';

/* ── The loop, run backwards: hero → contact ─────────────────────────────────────────────────────
 *
 * A visitor who has travelled in time can travel back. Three signals for the same reason the forward
 * loop needs three — the cover, the jump and the arrival happen at three different moments, and each
 * is announced by whoever actually knows it has happened rather than timed against the others.
 *
 *   REQUEST   the control was used, or the wheel was pushed up at the top of the page. Routed through
 *             the pin, which is the only thing that can say no.
 *   BEGIN     the pin said yes. Close the cover.
 *   COVERED   the cover has the screen. The pin teleports INSIDE this dispatch, synchronously.
 *
 * ⚠ And then nothing else is authored. The pin parks the scrollbar just inside the far end of the dive
 * and glides it back to contact, so what plays is the dive itself, scrubbed the other way — the whole
 * benefit of the rule that a crossing is a pure function of its progress. There is no reverse animation
 * anywhere in this codebase because there does not need to be one.
 */
export const LOOP_REVERSE_REQUEST_EVENT = 'voidix:loop-reverse-request';
export const LOOP_REVERSE_BEGIN_EVENT = 'voidix:loop-reverse-begin';
export const LOOP_REVERSE_COVERED_EVENT = 'voidix:loop-reverse-covered';

/**
 * A loop has completed — the visitor is standing on the hero having arrived there through the hole.
 *
 * The way back only exists once the way there has been taken, so this is what arms it: the hero's
 * return control does not render before this, and the wheel-up gesture does nothing. A first visit is
 * therefore untouched, which matters because the hero is the site's opening frame and because "scroll
 * up at the top does something" is a surprise that should be earned rather than sprung.
 */
export const LOOP_ARRIVED_EVENT = 'voidix:loop-arrived';
