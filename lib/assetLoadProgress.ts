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
// never "ready" until every one of them has registered and finished.
//
// ⚠ `sun` was NOT here until 2026-08-03, and its absence was a real bug rather than an oversight in
// bookkeeping. `fractured_sun.glb` is 1.3 MB, it is the subject of the hero, and the loader's entire
// finale is its ten shards flying in — yet the gate counted the fleet and the field, called that 100 %,
// and handed off. On a fast connection the sun happened to be there; on a slow one the reveal landed on
// a hero with a HOLE where its star should be, and the star faded in 30–60 s later when its download
// finally finished behind 5.3 MB of vessels nobody needed yet. The counter was lying by ~17 % of the
// page's weight, about the one asset the page cannot open without.
const EXPECTED_SOURCES = ['deck', 'works', 'sun'] as const;
export type AssetSource = (typeof EXPECTED_SOURCES)[number];

// Weight the combined progress by each source's rough download weight so the counter climbs at an
// honest pace — an unweighted average would leap to 50% the instant the lighter source finished, then
// crawl. Weights sum to 1.
//
//   deck   ~5.3 MB — four vessels (2.5 + 2.1 + 0.4 + 0.3), Draco-compressed
//   works  ~0.95 MB — the basalt its debris wears (0.41), the geode the mark's cavities open onto
//          (0.39), the black stone of the mark's body (0.07), three logo outlines and a typeface (0.06)
//   sun    ~1.3 MB — fractured_sun.glb, ten shards and a corona; 10k verts and the rest textures
//
// ⚠ RE-WEIGH THESE whenever any side's assets change size, and note that SHRINKING one is just as
// invalidating as growing it. They have been 0.93/0.07, then 0.71/0.29, then 0.55/0.45 as the field's
// maps grew to two 3.3 MB PNGs — and then those PNGs were re-encoded to WebP (~0.4 MB the pair, a 94%
// cut) and the weights were not moved with them, so the counter sprinted to ~45%, stopped dead, and
// crawled through the fleet's 5.3 MB. That is precisely the dishonesty this file exists to prevent.
//
// Not the raw byte ratio (deck would take 0.70): the works source's last stretch is not a download at
// all — it covers preparing the outlines and CUTTING four marks, real CPU time the visitor waits
// through (see WORKS_TEXTURE_SHARE in useWorksField). The extra weight pays for that.
const SOURCE_WEIGHTS: Record<AssetSource, number> = { deck: 0.62, works: 0.2, sun: 0.18 };

const progressBySource = new Map<AssetSource, number>();
const warmedSources = new Set<AssetSource>();
const listeners = new Set<() => void>();

/**
 * Fired by the intro once its wordmark has finished animating: the stage is still, so a scene may
 * spend a frame compiling without anybody seeing it.
 *
 * ⚠ It does NOT mean "the assets are in" any more, and the rename would be more trouble than the
 * clarity is worth. Each scene knows about its own assets; what it cannot know is whether the loader
 * is mid-flourish. Both halves are required before a warm-up runs — see either scene hook.
 */
export const ASSETS_WARMUP_EVENT = 'voidix:assets-warmup';

/**
 * …and the same fact as STATE, because an event is a race.
 *
 * Both heavy scenes are behind `next/dynamic`, so on a slow connection their chunks can arrive after
 * the intro's timeline has already dispatched. A scene that mounts a moment too late would wait
 * forever on a signal that had already been and gone, never warm, and hold the gate to its cap.
 * A scene therefore reads this at setup AND listens for the event; whichever order they happen in,
 * the answer is the same.
 */
let stageIsQuiet = false;

/** The loader's animation has settled (or there is no loader). Idempotent; notifies listeners. */
export function markStageQuiet(): void {
  if (stageIsQuiet) return;
  stageIsQuiet = true;
  listeners.forEach((listener) => listener());
}

/** True once the loader's stage has settled — safe to read at any time, including before mount. */
export function isStageQuiet(): boolean {
  return stageIsQuiet;
}

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
