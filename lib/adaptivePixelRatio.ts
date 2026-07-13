/**
 * Shared dynamic resolution for the heavy WebGL scenes (the services fleet + the works field).
 *
 * A single controller watches real frame times *while those scenes are drawing* and eases one shared
 * pixel ratio between a floor and the device ceiling: it drops the backing-store density when frames
 * run slow — protecting smoothness on a weak GPU, even below 1× on a non-retina panel where there's
 * nothing else to give — and climbs back toward crisp when there's sustained headroom.
 *
 * Scenes call `sampleFrame(dt)` on frames they actually rendered (so idle frames never fake headroom)
 * and read `getPixelRatio()` each frame, re-sizing their renderer + composer when it changes.
 *
 * Deliberately biased toward smoothness: it drops quickly but climbs slowly, and leaves a dead zone
 * between the two frame-rate thresholds, so it settles instead of oscillating between two levels.
 */

// Quality-first + "spend power for quality": never render BELOW native (base 1×, so models are always
// at least crisp), and let a capable GPU render ABOVE native (super-sampling → down-sampled = extra
// clean) up to the cap. Starts at the BASE (fast, light first paint) and climbs toward the cap only
// if there's headroom.
const BASE_PIXEL_RATIO = 1;    // floor — 1 device pixel per CSS pixel; never softer than native
const SUPERSAMPLE_CEIL = 1.5;  // minimum ceiling: even a 1× panel may render up to 1.5× for crispness
const MAX_PIXEL_RATIO = 2;     // hard cap (retina native)
const STEP = 0.2;               // how far the ratio moves per adjustment
const SLOW_FPS = 30;            // sustained below this → step down. 30 = "cinematic" floor: hold the
                                // higher resolution/quality unless the GPU genuinely can't keep up
const FAST_FPS = 58;            // sustained above this → step up (dead zone 30–58 = hold, no change)
const SETTLE_DOWN_SECONDS = 0.8; // react to slowness fairly quickly (protect the frame rate)
const SETTLE_UP_SECONDS = 2;     // …reclaim sharpness after a shorter-but-still-cautious calm stretch
const RECENT_STEP_UP_SECONDS = 3.5; // a drop this soon after a step-up means that level was too costly
const SOFT_CEIL_PROBE_SECONDS = 20; // after this long pinned + calm, cautiously re-test one step higher
const EMA_ALPHA = 0.1;           // smoothing on the measured frame time (rejects one-frame spikes)
const MAX_SANE_DT = 0.5;         // ignore absurd deltas (tab-restore, breakpoints)

let initialised = false;
let ceil = 2;
let floor = BASE_PIXEL_RATIO; // lowest density we'll drop to (base 1×)
let softCeil = 2;           // dynamic cap ≤ ceil; lowered when a higher level proves too expensive, so
                            // the controller settles instead of oscillating in and out of it
let pixelRatio = 1;
let emaFrameSeconds = 1 / 60;
let slowFor = 0;
let fastFor = 0;
let elapsed = 0;            // accumulated sampled time, for the oscillation + probe windows
let lastStepUpAt = -Infinity;
let lastSoftCeilProbeAt = 0;

function ensureInitialised(): void {
  if (initialised) return;
  initialised = true;
  const deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  ceil = Math.min(MAX_PIXEL_RATIO, Math.max(deviceRatio, SUPERSAMPLE_CEIL));
  floor = BASE_PIXEL_RATIO;
  softCeil = ceil;
  // Start at the BASE (native 1×) so the first reveal is light and loads fast — already sharp, since
  // the floor is native — then climb toward the super-sampled ceiling only if the GPU has the headroom.
  pixelRatio = floor;
}

/** The current shared pixel ratio. Read once per frame; apply to renderer + composer when it moves. */
export function getPixelRatio(): number {
  ensureInitialised();
  return pixelRatio;
}

/** A read-only view of what this controller has actually MEASURED on this machine. */
export interface PerformanceSnapshot {
  /** Seconds of real, drawn frames sampled so far. 0 = nothing measured yet, so nothing to conclude. */
  sampledSeconds: number;
  /** Smoothed frame rate across those samples. */
  framesPerSecond: number;
  /** True once the GPU has proven a density too expensive to hold (the controller capped itself). */
  hasHitLimit: boolean;
  /** True while still pinned at the lowest density — it never found any headroom at all. */
  isAtFloor: boolean;
}

/**
 * What the frame-time samples say about this machine. Exposed so callers can make their own quality
 * decisions off real measurements rather than a device sniff — the chamber picks its texture tier this
 * way (see lib/performanceTier.ts), and by the time it asks, the heavy scenes have been drawing for a
 * minute. This module only reports; deciding what to do about it belongs to the caller.
 */
export function getPerformanceSnapshot(): PerformanceSnapshot {
  ensureInitialised();
  return {
    sampledSeconds: elapsed,
    framesPerSecond: 1 / emaFrameSeconds,
    hasHitLimit: softCeil < ceil,
    isAtFloor: pixelRatio <= floor,
  };
}

/**
 * Feed one real render frame time (seconds). Call only on frames a heavy scene actually drew, so idle
 * (gated-off) frames can't trick the controller into ramping the resolution up.
 */
export function sampleFrame(dtSeconds: number): void {
  ensureInitialised();
  if (dtSeconds <= 0 || dtSeconds > MAX_SANE_DT) return;
  elapsed += dtSeconds;
  emaFrameSeconds += (dtSeconds - emaFrameSeconds) * EMA_ALPHA;
  const fps = 1 / emaFrameSeconds;

  if (fps < SLOW_FPS) {
    slowFor += dtSeconds;
    fastFor = 0;
  } else if (fps > FAST_FPS) {
    fastFor += dtSeconds;
    slowFor = 0;
  } else {
    slowFor = 0;
    fastFor = 0;
  }

  const effectiveCeil = Math.min(ceil, softCeil);

  if (slowFor >= SETTLE_DOWN_SECONDS && pixelRatio > floor) {
    // A drop this soon after a step-up means that higher level was too expensive — cap below it so we
    // don't climb straight back into it. This turns endless oscillation into a single detect-and-settle.
    if (elapsed - lastStepUpAt < RECENT_STEP_UP_SECONDS) {
      softCeil = Math.max(floor, pixelRatio - STEP);
    }
    pixelRatio = Math.max(floor, pixelRatio - STEP);
    slowFor = 0;
    fastFor = 0;
  } else if (fastFor >= SETTLE_UP_SECONDS && pixelRatio < effectiveCeil) {
    pixelRatio = Math.min(effectiveCeil, pixelRatio + STEP);
    lastStepUpAt = elapsed;
    slowFor = 0;
    fastFor = 0;
  } else if (
    // Pinned at the soft ceiling and calm for a long stretch → cautiously lift the cap to re-test a
    // higher level (conditions may have improved). If it's still too costly the block above re-caps it.
    softCeil < ceil &&
    pixelRatio >= softCeil &&
    fastFor > 0 &&
    elapsed - lastSoftCeilProbeAt > SOFT_CEIL_PROBE_SECONDS
  ) {
    softCeil = Math.min(ceil, softCeil + STEP);
    lastSoftCeilProbeAt = elapsed;
  }
}
