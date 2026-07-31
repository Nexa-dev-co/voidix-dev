/**
 * The chamber → contact return: the scrubbed stretch of the hero pin between standing at the podium and
 * the end of the page. `detail.progress` runs 0..1 (0 = in the room, 1 = back inside the screen, falling
 * toward the black hole).
 *
 * The move is the chamber's own pull-back run BACKWARDS — from the podium, back to the display, until it
 * fills the frustum exactly and the canvas is once again indistinguishable from the live space. So there
 * is no second camera path to author: this progress simply unwinds the reveal's.
 *
 * ── Why this is its own event, and not just the chamber's progress scrubbed back ─────────────────
 * Because both crossings run on every pin update. `applyCrossings` calls each crossing whose own
 * progress moved, so if the return also published CHAMBER_PROGRESS_EVENT there would be two writers of
 * one number and the last dispatch of the frame would win — a race decided by the order of an array.
 * That is exactly the class of bug the single-clock rule exists to prevent.
 *
 * Instead each crossing owns its own signal (as handoffEvents and chamberEvents already do), and the
 * works field combines them into the ONE value it eases:
 *
 *     effectiveChamber = revealProgress × (1 − contactProgress)
 *
 * ── What this span owns, beyond the camera ──
 * The finale. The reveal's turn away from the star UNWINDS across it (`revealPanRadians` reads the
 * combined value), so the camera swings back onto where the star was; `RETURN_SUN_RESTORE` brings the
 * star back, unchanged, early in the span; and the sun's own singularity then runs off this progress.
 *
 * ⚠ An earlier revision of this file asserted the opposite — that the camera held its angle and the
 * star stayed dead, "the one irreversible event on this site". That was a different ending, and it was
 * discarded because arriving at a black hole that was always there is not a finale: you have to see
 * the star alive, and then watch it go. Nothing here is irreversible. Scrub back and the hole unwinds
 * into a star, exactly like every other crossing on this site.
 */
export const CONTACT_PROGRESS_EVENT = 'voidix:contact-progress';

export interface ContactProgressDetail {
  /** 0..1 across the return span; the boundary values are re-sent when the span is exited. */
  progress: number;
}

/** Safely pull the progress out of a {@link CONTACT_PROGRESS_EVENT} listener's event. */
export function readContactProgress(event: Event): number {
  const detail = (event as CustomEvent<ContactProgressDetail>).detail;
  return typeof detail?.progress === 'number' ? detail.progress : 0;
}
