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

const FLOOR = 0.7;              // lowest density — upscaled, softer, but a big fill saving
const STEP = 0.2;               // how far the ratio moves per adjustment
const SLOW_FPS = 45;            // sustained below this → step down
const FAST_FPS = 58;            // sustained above this → step up (dead zone 45–58 = no change)
const SETTLE_DOWN_SECONDS = 0.8; // react to slowness fairly quickly (protect the frame rate)
const SETTLE_UP_SECONDS = 2;     // …reclaim sharpness after a shorter-but-still-cautious calm stretch
const RECENT_STEP_UP_SECONDS = 3.5; // a drop this soon after a step-up means that level was too costly
const SOFT_CEIL_PROBE_SECONDS = 20; // after this long pinned + calm, cautiously re-test one step higher
const EMA_ALPHA = 0.1;           // smoothing on the measured frame time (rejects one-frame spikes)
const MAX_SANE_DT = 0.5;         // ignore absurd deltas (tab-restore, breakpoints)

let initialised = false;
let ceil = 2;
let softCeil = 2;            // dynamic cap ≤ ceil; lowered when a higher level proves too expensive, so
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
  ceil = Math.min(deviceRatio, 2);
  softCeil = ceil;
  // Start conservative (near 1×, never above the device ceiling) so the first heavy reveal is smooth
  // on a weak machine; the controller then climbs toward `ceil` only if the frame budget allows.
  pixelRatio = Math.min(ceil, 1);
}

/** The current shared pixel ratio. Read once per frame; apply to renderer + composer when it moves. */
export function getPixelRatio(): number {
  ensureInitialised();
  return pixelRatio;
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

  if (slowFor >= SETTLE_DOWN_SECONDS && pixelRatio > FLOOR) {
    // A drop this soon after a step-up means that higher level was too expensive — cap below it so we
    // don't climb straight back into it. This turns endless oscillation into a single detect-and-settle.
    if (elapsed - lastStepUpAt < RECENT_STEP_UP_SECONDS) {
      softCeil = Math.max(FLOOR, pixelRatio - STEP);
    }
    pixelRatio = Math.max(FLOOR, pixelRatio - STEP);
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
