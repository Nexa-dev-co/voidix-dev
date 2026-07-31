/**
 * How far the sun should be pushed off its authored place, this frame.
 *
 * ── The problem this exists to solve ─────────────────────────────────────────────────────────────
 * The sun is a `position: fixed` DOM billboard behind the works canvas. Everything in the works scene
 * — the mark, the debris, the starfield — belongs to a 3D camera the visitor can drag. The sun does
 * not. So dragging swung the entire field around a star that stayed nailed to the glass, which read as
 * a sticker on the lens rather than as something out in the space.
 *
 * It cannot be fixed by moving the sun into the scene: it is a separate WebGL context (its own
 * renderer, its own tone mapping, its own bloom) and it has to keep drawing through the intro, the
 * hero and services, none of which the works renderer touches. So instead the scene says where a
 * distant object would have gone, and the DOM follows.
 *
 * ── Why a store, not an event ────────────────────────────────────────────────────────────────────
 * Same reason as `hologramPose`: this is written EVERY FRAME, the two ends have different lifetimes
 * and neither can hold a reference to the other. A CustomEvent or React state per frame would be a
 * re-render per frame. The consumer reads it in its own rAF and writes `style.transform` directly.
 *
 * ── What the numbers mean ────────────────────────────────────────────────────────────────────────
 * CSS pixels, and they are a DELTA — the offset from wherever the hero pin has parked the sun, never
 * an absolute position. The pin owns where the sun is; this only ever nudges it from there. Keeping it
 * a delta is what lets the two coexist without either needing to know the other's number.
 *
 * The pose object is stable and mutated in place. Read it, never mutate it.
 */

export interface SunParallaxPose {
  /**
   * The works camera is driving the sun right now.
   *
   * False has to be said out loud rather than inferred from a zeroed offset, because the works field
   * stops publishing entirely when it isn't on screen — and a consumer that couldn't tell "not driving"
   * from "driving, at rest" would keep applying the last offset through the hero and services.
   */
  active: boolean;
  /** CSS pixels to shift the sun by, relative to where the pin parked it. */
  offsetX: number;
  offsetY: number;
}

const pose: SunParallaxPose = {
  active: false,
  offsetX: 0,
  offsetY: 0,
};

/** The live pose. Read every frame by the sun; never mutate the result. */
export function getSunParallaxPose(): Readonly<SunParallaxPose> {
  return pose;
}

export function publishSunParallaxPose(offsetX: number, offsetY: number): void {
  pose.active = true;
  pose.offsetX = offsetX;
  pose.offsetY = offsetY;
}

/**
 * Nothing is driving the sun — it belongs to the pin alone.
 *
 * Published rather than simply stopping, so the consumer can ease back to rest instead of freezing on
 * the last offset the works field happened to leave behind.
 */
export function clearSunParallaxPose(): void {
  pose.active = false;
  pose.offsetX = 0;
  pose.offsetY = 0;
}
