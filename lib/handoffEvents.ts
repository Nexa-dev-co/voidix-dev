/**
 * The services → works handoff: the long scrubbed stretch of the hero pin between the last
 * craft stop and the first project stop. The pin dispatches this event on every scroll update
 * whose handoff progress changed, with `detail.progress` in 0..1 (0 = craft resting on the pad,
 * 1 = project 01 fully arrived). Both WebGL scenes listen — the deck flies its craft off to the
 * right, the works field grows its first meteor in — each smoothing the raw value per frame so
 * the choreography stays cinematic under scrubbed, snapped, or jumped scroll. Lives in lib/
 * because the one signal is shared by the hero pin and both scene hooks.
 */
export const HANDOFF_PROGRESS_EVENT = 'orbix:handoff-progress';

export interface HandoffProgressDetail {
  /** 0..1 across the handoff span; the boundary values are re-sent when the span is exited. */
  progress: number;
}

/** Safely pull the progress out of a {@link HANDOFF_PROGRESS_EVENT} listener's event. */
export function readHandoffProgress(event: Event): number {
  const detail = (event as CustomEvent<HandoffProgressDetail>).detail;
  return typeof detail?.progress === 'number' ? detail.progress : 0;
}

/**
 * The "ship has arrived" sentinel. Fired by the deck the instant the flight's auto-exit whoosh
 * finishes — i.e. the ship has reached the meteor spot AND left the screen. The works field waits a
 * short beat, then flies meteor 01 in from far. {@link SHIP_RETURNED_EVENT} is its mirror, fired when
 * the ship flies back on (scroll-back), so the works field recedes the meteor again.
 */
export const SHIP_ARRIVED_EVENT  = 'orbix:ship-arrived';
export const SHIP_RETURNED_EVENT = 'orbix:ship-returned';
