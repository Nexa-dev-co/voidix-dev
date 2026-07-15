/**
 * The works → chamber reveal: the scrubbed stretch of the hero pin between the last project stop and
 * the chamber. The pin dispatches this on every scroll update whose reveal progress changed, with
 * `detail.progress` in 0..1 (0 = browsing project 04 full-screen, 1 = standing in the room).
 *
 * The works field listens (it hosts the chamber — see the note in useWorksField about why the room has
 * to be drawn by the same renderer that renders the space into a texture), smoothing the raw value per
 * frame so the camera move stays cinematic under scrubbed, snapped or jumped scroll.
 *
 * Mirrors handoffEvents.ts — one module per crossing, so each owns its own signal.
 */
export const CHAMBER_PROGRESS_EVENT = 'orbix:chamber-progress';

export interface ChamberProgressDetail {
  /** 0..1 across the reveal span; the boundary values are re-sent when the span is exited. */
  progress: number;
}

/** Safely pull the progress out of a {@link CHAMBER_PROGRESS_EVENT} listener's event. */
export function readChamberProgress(event: Event): number {
  const detail = (event as CustomEvent<ChamberProgressDetail>).detail;
  return typeof detail?.progress === 'number' ? detail.progress : 0;
}

/**
 * The FAQ hologram: open, or sealed.
 *
 * Dispatched by the chamber SCENE, not by the pin — and that is the whole point of it existing. The
 * panel opens when the showcase tour finishes walking you up to the podium, and only the scene knows
 * when that is: the tour is a GSAP timeline that plays off the reveal landing, so its end is a moment in
 * time, not a scroll position. The pin cannot name it.
 *
 * It closes the moment the reveal is scrubbed back off its end, so scrolling away re-seals the panel.
 */
export const CHAMBER_HOLOGRAM_EVENT = 'orbix:chamber-hologram';

export interface ChamberHologramDetail {
  open: boolean;
}

export function readHologramOpen(event: Event): boolean {
  const detail = (event as CustomEvent<ChamberHologramDetail>).detail;
  return detail?.open === true;
}
