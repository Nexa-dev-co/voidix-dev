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
//
// ⚠ `chamber` and `singularity` joined them on 2026-08-06, and that is a change of KIND, not just of
// count. Everything above is on the wire because the opening needs it. Those two are not: the room is
// a minute of scrolling away and the black hole is two. They are here because of what happens when
// they are NOT here — `ensureChamber()` fires at HANDOFF_PROGRESS and `ensureSingularity()` at
// CHAMBER_PROGRESS, so on a first visit `table.glb` is parsed, built and compiled DURING the
// services→works crossing and `black_hole.glb` (2.37 MB, the largest asset on the site) during the
// works→chamber reveal. `prefetchWhenAssetsReady` put those bytes in the HTTP cache, which removed
// the download from the crossing and nothing else: the parse, the geometry upload, the material
// compile and the first draw all still landed mid-scrub. That is what "heavy the first time, smooth
// on the second lap" was.
//
// The price is honest and it is the one the brief accepted: a cold first visit now downloads ~10.8 MB
// before the hero instead of ~7.9 MB. `SkipToLite` is the way out for anyone who cannot afford it.
const ENTRY_SOURCES = ['deck', 'works', 'sun'] as const;
const PREFLIGHT_SOURCES = ['chamber', 'singularity'] as const;
const EXPECTED_SOURCES = [...ENTRY_SOURCES, ...PREFLIGHT_SOURCES] as const;
export type AssetSource = (typeof EXPECTED_SOURCES)[number];

/**
 * The same list, exported, so the intro's gate can ask about every source rather than hard-coding
 * three strings a second time. Naming a set of sections in two files is how one of them gets a fourth
 * added and the other does not.
 */
export const ASSET_SOURCES: readonly AssetSource[] = EXPECTED_SOURCES;

/**
 * The sources that go on the wire FIRST — the ones the opening itself is made of.
 *
 * ⚠ It exists because rung 3 cannot be started by a check that includes rung 3. `useWorksField` only
 * builds the chamber and the contact star once these are in (so they compete with neither the star
 * nor the fleet), and `prefetchWhenAssetsReady` waits on the same signal. Asking `areAssetsReady()`
 * there instead would be a deadlock: the two would each be waiting for the other.
 */
export function areEntrySourcesReady(): boolean {
  return ENTRY_SOURCES.every((source) => (progressBySource.get(source) ?? 0) >= 1);
}

// Weight the combined progress by each source's rough download weight so the counter climbs at an
// honest pace — an unweighted average would leap to 50% the instant the lighter source finished, then
// crawl. Weights sum to 1.
//
//   deck   ~0.03 MB — vessel.glb: nine named clusters of one ship, Draco + a single 512² ETC1S map
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
//   chamber      ~0.48 MB — table.glb, plus building the room, its ground shader and the display rig
//   singularity  ~2.37 MB — black_hole.glb (fractured_sun is already in cache by the time it asks)
//
// ⚠ RE-WEIGHED 2026-08-11, and this is the largest re-weigh the file has ever taken. The services
// section stopped shipping four whole ships and started shipping ONE, split into nine named clusters
// that it assembles as you scroll (docs/services-vessel-assembly-plan.md): 5.15 MB → 30 KB. The deck
// went from the heaviest source on the page to the lightest by two orders of magnitude, and the total
// download fell from ~10.76 MB to ~5.6 MB.
//
// Leaving `deck: 0.47` in place would have been exactly the failure this file's own history records —
// the counter would have sprinted to ~47% on a 30 KB file and then crawled through everything else.
// Byte shares of the new ~5.6 MB total are deck .005 / works .17 / sun .23 / chamber .09 /
// singularity .42; below keeps the same "move some weight onto `works` for the CPU time it spends
// cutting the marks" adjustment the note above describes.
const SOURCE_WEIGHTS: Record<AssetSource, number> = {
  deck: 0.01,
  works: 0.3,
  sun: 0.22,
  chamber: 0.09,
  singularity: 0.38,
};

/**
 * The last slice of the counter, reserved for the work that happens AFTER the last byte lands.
 *
 * ── ⚠ Why the counter used to lie at exactly the wrong moment ────────────────────────────────────
 * This value was the download fraction and nothing else, so the loader reached 100 % the instant the
 * bytes were in — and then held, visibly, for everything that still had to happen before the site
 * could open: two scenes compiling their programs, allocating composers, uploading every map, and now
 * the burn-in that measures what this machine can actually sustain (up to 1.5 s on its own).
 *
 * A counter that reads 100 % and then makes you wait is the exact dishonesty the weighting at the top
 * of this file exists to prevent — it was just being honest about one half of the wait and silent
 * about the other.
 *
 * ⚠ Re-weigh this the same way as SOURCE_WEIGHTS, and for the same reason: it is a guess at the
 * proportion of the wait, and the burn-in changed that proportion once already.
 */
const WARMUP_SHARE = 0.15;

/**
 * The warm fraction, high-watermarked.
 *
 * ⚠ Monotonic BY FORCE, and it has to be. The fraction below is measured over the sources that have
 * ARRIVED, because a source still downloading cannot be expected to have compiled — which means its
 * denominator GROWS as the load proceeds. Without the watermark, one source arriving unwarmed after
 * another had already warmed would drop the fraction and walk the counter backwards.
 */
let warmHighWater = 0;

const progressBySource = new Map<AssetSource, number>();
const warmedSources = new Set<AssetSource>();
const listeners = new Set<() => void>();

/**
 * When each source last showed a sign of life, for stall detection.
 *
 * ⚠ Separate from `progressBySource` on purpose, and the reason is a real deployment case: when the
 * server sends no `Content-Length` (chunked or compressed) a loader has no honest FRACTION to report
 * and jumps straight from 0 to 1. Anything watching the fraction for staleness would then see a
 * perfectly healthy 78-second download as "stalled at 0" and give up on it. Bytes are always known
 * even when the total is not, so activity is recorded on its own clock.
 */
const lastActivityAt = new Map<AssetSource, number>();

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

/**
 * Note that a source is still moving, whether or not its fraction could be updated.
 *
 * Call this on EVERY progress event — including the ones carrying no usable total. It is what lets
 * the loader tell "slow" apart from "dead" without punishing a server that does not send a length.
 */
export function reportSourceActivity(source: AssetSource): void {
  lastActivityAt.set(source, performance.now());
}

/**
 * Milliseconds since this source last showed life, or `null` if it has never reported at all.
 *
 * `null` is genuinely different from "a long time": before a dynamically imported scene has mounted
 * there is nothing to be stalled yet, and treating that as a stall would give up on a download that
 * had not begun.
 */
export function getMillisecondsSinceActivity(source: AssetSource): number | null {
  const last = lastActivityAt.get(source);
  return last === undefined ? null : performance.now() - last;
}

/** True once this one source has finished downloading. */
export function isSourceLoaded(source: AssetSource): boolean {
  return (progressBySource.get(source) ?? 0) >= 1;
}

/**
 * True when every source that has FINISHED DOWNLOADING has also reported its warm-up.
 *
 * The difference from requiring EVERY source to be warm matters only on a slow connection, and it
 * matters a lot there. The
 * reveal now waits for the star rather than for the whole page (see IntroSequence), so the fleet can
 * still be streaming when the star is ready — and a scene that has not downloaded cannot possibly
 * have compiled. Requiring it to would make every slow load sit out the warm stage's full cap for a
 * scene that is not going to be on screen for another minute.
 *
 * On a fast load all three finish downloading before this is ever consulted, so it is identical to
 * demanding all three — which is what the gate used to do, and what it still effectively does
 * whenever the connection allows.
 */
export function areArrivedWarmupsDone(): boolean {
  return EXPECTED_SOURCES.every(
    (source) => !isSourceLoaded(source) || warmedSources.has(source),
  );
}

/**
 * Combined 0..1 across every expected source, weighted by download size (missing source = 0).
 *
 * ⚠ DOWNLOADS ONLY, and it has to stay that way. `useLoaderTelemetry` samples the DELTAS of this to
 * compute the throughput readout in KB/s — so folding the warm-up into it would have the counter
 * report several hundred phantom kilobytes the moment a scene finished compiling. The wait's other
 * half lives in `getEntryProgress` instead.
 */
export function getAssetProgress(): number {
  let progress = 0;
  for (const source of EXPECTED_SOURCES) {
    progress += (progressBySource.get(source) ?? 0) * SOURCE_WEIGHTS[source];
  }
  return progress;
}

/**
 * How close the page is to being ENTERABLE, 0..1 — the number the loader's counter should show.
 *
 * ── ⚠ Why it is the COMBINED download and no longer the star's ───────────────────────────────────
 * It was the star's, on the reasoning that the gate waited for the star alone — so a counter on the
 * combined total would have handed off at "18" and the visitor would have watched it fail to finish.
 * That reasoning was correct and its premise is now gone: the gate waits for every source (see
 * `isGateSatisfied` in IntroSequence), because a site that opens while the fleet is still streaming is
 * a site that opens before it is loaded. The counter follows the gate; it always did.
 *
 * ── ⚠ …and why it is not the downloads alone either ──────────────────────────────────────────────
 * Because the last byte stopped being the end of the wait. After it the two scenes still compile their
 * programs, allocate composers, upload every map, and run the burn-in that decides the session's
 * resolution — up to 1.5 s on its own. A counter that reads 100 and then makes you wait through all of
 * that is exactly the dishonesty the weighting in this file exists to prevent; it was simply being
 * honest about one half of the wait and silent about the other.
 */
export function getEntryProgress(): number {
  // Measured over what has ARRIVED, mirroring `areArrivedWarmupsDone` — the gate does not wait for a
  // scene that is still downloading to have compiled, so the counter must not either.
  let arrivedWeight = 0;
  let warmWeight = 0;
  for (const source of EXPECTED_SOURCES) {
    if (!isSourceLoaded(source)) continue;
    arrivedWeight += SOURCE_WEIGHTS[source];
    if (warmedSources.has(source)) warmWeight += SOURCE_WEIGHTS[source];
  }
  if (arrivedWeight > 0) {
    warmHighWater = Math.max(warmHighWater, warmWeight / arrivedWeight);
  }

  return getAssetProgress() * (1 - WARMUP_SHARE) + warmHighWater * WARMUP_SHARE;
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

/** Subscribe to progress changes; returns an unsubscribe fn. */
export function onAssetProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
