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

/**
 * The dock's element id, declared HERE rather than in `tunerDock.ts`.
 *
 * The pin has to be able to recognise the dock to leave its scrolling alone (see
 * {@link isInsideTunerDock}), and it cannot import the dock module to ask: that module pulls lil-gui's
 * whole authoring surface, and CLAUDE.md is explicit that none of it may reach the default bundle. So
 * the one thing both ends need is the one thing that lives in this tiny, dependency-free file.
 */
export const TUNER_DOCK_ID = 'voidix-tuner-dock';

/**
 * Did this gesture start inside the tuner's own column?
 *
 * ⚠ This is what makes the dock scrollable at all. The dock is a fixed column with `overflow-y: auto`,
 * so the browser would happily scroll it — except the pin binds `wheel` on `window` with
 * `{ passive: false }` and calls `preventDefault()` for every gesture in the carousel region, which
 * cancels the dock's scroll along with the page's. It did so in BOTH lock states, so freezing the pin
 * did not help: locked it prevented deliberately, unlocked it prevented as part of stepping the
 * carousel. Either way a panel taller than the viewport had no way to be reached.
 *
 * Reads false on any normal load — there is no such element.
 */
export function isInsideTunerDock(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`#${TUNER_DOCK_ID}`) !== null;
}

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
