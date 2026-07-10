/**
 * Combined asset-load progress for the intro loader.
 *
 * The homepage's two heavy WebGL scenes (the services fleet and the works field) each report their
 * own 0..1 load fraction here as their models/textures stream in. The intro (`IntroSequence`) reads
 * the combined value to drive its counter honestly, and holds the reveal until everything the entry
 * needs is actually in — instead of revealing on a fixed timer into a half-built scene.
 *
 * Module-level state (one page, one load). Progress is monotonic per source, so a React Strict-Mode
 * remount or an out-of-order progress event can never make the loader jump backwards.
 */

// The sources the loader waits for. A source that hasn't reported yet counts as 0, so the loader is
// never "ready" until BOTH the fleet and the field have registered and finished.
const EXPECTED_SOURCES = ['deck', 'works'] as const;
export type AssetSource = (typeof EXPECTED_SOURCES)[number];

const progressBySource = new Map<AssetSource, number>();
const listeners = new Set<() => void>();

/**
 * The intro fires this at its static pre-handoff hold, once assets are loaded, asking each scene to
 * compile its shaders + bloom pipeline during that still beat — so the (synchronous) compile stall
 * is invisible instead of janking the loading animation or hitching the reveal.
 */
export const ASSETS_WARMUP_EVENT = 'orbix:assets-warmup';

/** Record a source's load fraction (0..1). Monotonic: a lower value than already seen is ignored. */
export function reportAssetProgress(source: AssetSource, value: number): void {
  const clamped = Math.min(1, Math.max(0, value));
  const previous = progressBySource.get(source) ?? 0;
  if (clamped <= previous) return;
  progressBySource.set(source, clamped);
  listeners.forEach((listener) => listener());
}

/** Combined 0..1 across every expected source (a source that hasn't reported yet counts as 0). */
export function getAssetProgress(): number {
  let total = 0;
  for (const source of EXPECTED_SOURCES) total += progressBySource.get(source) ?? 0;
  return total / EXPECTED_SOURCES.length;
}

/** True once every expected source has fully loaded. */
export function areAssetsReady(): boolean {
  return EXPECTED_SOURCES.every((source) => (progressBySource.get(source) ?? 0) >= 1);
}

/** Subscribe to progress changes; returns an unsubscribe fn. */
export function onAssetProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
