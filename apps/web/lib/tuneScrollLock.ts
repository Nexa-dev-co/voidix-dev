/**
 * Freeze the page while a `?tune` panel is being used.
 *
 * The homepage's one pin binds the wheel and touch directly: past the fill, every gesture steps the
 * carousel exactly one stop. That is right for a visitor and completely wrong for authoring — you
 * reach for the scroll wheel to look at something and the craft you were tuning is replaced by the
 * next one.
 *
 * So the tuner can freeze the pin outright. While locked, the pin swallows wheel and touch without
 * moving: you stay exactly where you are, and the panel's own free-fly controls keep working because
 * they're on the keyboard and on drag, neither of which this touches.
 *
 * A module-level flag rather than a prop or an event, for the same reason the hologram's pose is one:
 * the two ends have entirely different lifetimes and neither can hold a reference to the other. The
 * pin is built once at reveal; the panel is a lazily-imported chunk that may never load at all.
 *
 * Only ever set by a tuner, so on a normal page load this reads false forever and costs one boolean
 * check per gesture.
 */

let locked = false;
const listeners = new Set<(locked: boolean) => void>();

export function isTuneScrollLocked(): boolean {
  return locked;
}

export function setTuneScrollLocked(next: boolean): void {
  if (next === locked) return;
  locked = next;
  listeners.forEach((listener) => listener(locked));
}

/** Subscribe to lock changes (the dock's button reflects the state); returns an unsubscribe fn. */
export function onTuneScrollLockChange(
  listener: (locked: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
