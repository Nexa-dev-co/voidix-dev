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
 * The scrollbar has just been thrown back to the top. Snap, do not ease.
 *
 * ⚠ This exists because several scenes deliberately CHASE their scrubbed target rather than reading it
 * — `chamberState.current`, `flightState.current`, the sun's `cracks` / `collapse` ramps, the finale's
 * sequence. That chase is what makes every crossing cinematic, and it is exactly wrong here: at the
 * teleport their targets drop to 0 instantly while their current values walk there over half a second
 * or more, so behind the cover the chamber re-assembles, the star un-dies and the shell re-cracks. Any
 * of it showing at the edge of the flood ruins the illusion.
 *
 * Every owner of an eased value listens for this and forces `current = target` in one step. The
 * alternative — holding the cover up long enough for the eases to finish — is a timing fix, and timing
 * fixes are the class of bug this codebase keeps having to undo.
 */
export const LOOP_RESET_EVENT = 'voidix:loop-reset';

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
