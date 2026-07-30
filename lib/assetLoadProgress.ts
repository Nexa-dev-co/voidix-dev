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

// Weight the combined progress by each source's rough download weight so the counter climbs at an
// honest pace — an unweighted average would leap to 50% the instant the lighter source finished, then
// crawl. Weights sum to 1.
//
//   deck   ~8.5 MB of vessels
//   works  ~7.0 MB — the basalt its debris wears (3.5), the geode druse the mark's cavities open
//          onto (3.4), the black stone of the mark's body, three logo outlines and a typeface
//
// RE-WEIGH THESE if either side's assets change size. They were 0.93/0.07 when the field was ~0.6 MB
// of small maps, then 0.71/0.29 when it was ~3.5 MB; leaving them at an old value after the field
// grows parks the counter near the top for the whole of the largest download on the site — which is
// exactly what "the counter is honest because of this" is supposed to prevent.
const SOURCE_WEIGHTS: Record<AssetSource, number> = { deck: 0.55, works: 0.45 };

const progressBySource = new Map<AssetSource, number>();
const warmedSources = new Set<AssetSource>();
const listeners = new Set<() => void>();

/**
 * The intro fires this at its static pre-handoff hold, once assets are loaded, asking each scene to
 * compile its shaders + bloom pipeline during that still beat — so the (synchronous) compile stall
 * is invisible instead of janking the loading animation or hitching the reveal.
 */
export const ASSETS_WARMUP_EVENT = 'voidix:assets-warmup';

/** Record a source's load fraction (0..1). Monotonic: a lower value than already seen is ignored. */
export function reportAssetProgress(source: AssetSource, value: number): void {
  const clamped = Math.min(1, Math.max(0, value));
  const previous = progressBySource.get(source) ?? 0;
  if (clamped <= previous) return;
  progressBySource.set(source, clamped);
  listeners.forEach((listener) => listener());
}

/** Combined 0..1 across every expected source, weighted by download size (missing source = 0). */
export function getAssetProgress(): number {
  let progress = 0;
  for (const source of EXPECTED_SOURCES) {
    progress += (progressBySource.get(source) ?? 0) * SOURCE_WEIGHTS[source];
  }
  return progress;
}

/** One source's own 0..1 fraction (0 if it hasn't reported yet) — for per-module loader readouts. */
export function getSourceProgress(source: AssetSource): number {
  return progressBySource.get(source) ?? 0;
}

/** True once every expected source has fully loaded. */
export function areAssetsReady(): boolean {
  return EXPECTED_SOURCES.every((source) => (progressBySource.get(source) ?? 0) >= 1);
}

/** A scene reports here once its shaders + bloom pipeline have actually finished compiling, so the
 *  intro can hold the reveal until it's genuinely smooth rather than guessing at a delay. */
export function reportWarmupDone(source: AssetSource): void {
  if (warmedSources.has(source)) return;
  warmedSources.add(source);
  listeners.forEach((listener) => listener());
}

/** True once every expected source has reported its shaders compiled. */
export function areWarmupsDone(): boolean {
  return EXPECTED_SOURCES.every((source) => warmedSources.has(source));
}

/** Subscribe to progress changes; returns an unsubscribe fn. */
export function onAssetProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
