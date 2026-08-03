/**
 * Shared dynamic resolution for the heavy WebGL scenes (the services fleet + the works field).
 *
 * Two mechanisms, and they answer different questions.
 *
 *  1 · **A measurement, once, at the loader.** `reportProbedFrameCost` is handed the real cost of one
 *      real frame of the works field (see `lib/gpuProbe.ts`) and SOLVES for the ratio this machine can
 *      afford. That decides the ceiling and where we start.
 *  2 · **A live controller, for the rest of the session.** `sampleFrame(dt)` watches real frame times
 *      while those scenes are drawing and eases the shared ratio between the floor and that ceiling,
 *      so thermal throttling or a heavier section is still caught.
 *
 * Scenes call `sampleFrame(dt)` on frames they actually rendered (so idle frames never fake headroom)
 * and read `getPixelRatio()` each frame, re-sizing their renderer + composer when it changes.
 *
 * ── Why the measurement had to exist ─────────────────────────────────────────────────────────────
 * This module used to guess UPWARD: it let any machine climb to 1.5× — 2.25× the pixels and 2.25× the
 * render-target memory, through bloom and post — and relied on the controller to claw that back. Two
 * problems. The claw-back only happens after the composers have already been reallocated at the
 * larger size, on precisely the machine that could not afford it. And the controller's dead zone
 * (below) is wide enough that a laptop holding 38 fps never trips it, so the guess was never
 * corrected — it just sat there being slow. Rendering above native is now something a GPU has to
 * earn on the evidence of its own frame time.
 *
 * ⚠ CLAUDE.md used to state that nothing on this site picks quality from measured performance, and
 * pointed at a deleted `performanceTier.ts` as the thing that had tried. This is that capability,
 * rebuilt deliberately — but it is NOT that design. `performanceTier` classified into 'low' | 'high'
 * off the live controller's own samples, which is circular; this solves a ratio from a single
 * independent measurement taken before the first real frame is ever drawn.
 *
 * The live controller is deliberately biased toward smoothness: it drops quickly but climbs slowly,
 * and leaves a dead zone between the two frame-rate thresholds, so it settles instead of oscillating.
 */

// ── The range ──
// The floor is genuinely BELOW native. That is the point of having one: on a weak GPU at dpr 1 a floor
// of 1 leaves the controller with no move left — it detects the slowness and can do nothing about it,
// which is the state this module spent its whole life in. 0.75 is ~44% fewer pixels; visibly softer,
// and the only thing left to give on the machines that reach it.
const MIN_PIXEL_RATIO = 0.75;
const SUPERSAMPLE_CEIL = 1.5;  // the most a 1× panel may ever be allowed — and only if PROBED able
const MAX_PIXEL_RATIO = 2;     // hard cap (retina native)
const STEP = 0.2;               // how far the ratio moves per adjustment
// ⚠ 45, not 30. The old value left a 28 fps-wide band (30–58) in which the controller measured the
// slowness, agreed it was slow, and did nothing — and 35–45 fps is exactly where a struggling laptop
// sits. "Cinematic floor" is a defensible stance for a film; it is not one for a site whose scroll is
// scrubbed over 1.8 s, where anything under ~45 stops reading as smooth and starts reading as lag.
const SLOW_FPS = 45;            // sustained below this → step down
const FAST_FPS = 58;            // sustained above this → step up (dead zone 45–58 = hold, no change)
const SETTLE_DOWN_SECONDS = 0.8; // react to slowness fairly quickly (protect the frame rate)
const SETTLE_UP_SECONDS = 2;     // …reclaim sharpness after a shorter-but-still-cautious calm stretch
const RECENT_STEP_UP_SECONDS = 3.5; // a drop this soon after a step-up means that level was too costly
const SOFT_CEIL_PROBE_SECONDS = 20; // after this long pinned + calm, cautiously re-test one step higher
const EMA_ALPHA = 0.1;           // smoothing on the measured frame time (rejects one-frame spikes)
const MAX_SANE_DT = 0.5;         // ignore absurd deltas (tab-restore, breakpoints)

/**
 * How much of a frame the heaviest scene may spend, in milliseconds — the budget the probe solves
 * against.
 *
 * Not 16.7. Three things share that frame: the works field (what is measured), the sun's own canvas
 * and its bloom, and the browser's compositor with a handful of `mix-blend-mode` layers over the top.
 * 9 ms leaves room for the other two and for the probe's own pessimism — `gpuProbe` drains the
 * pipeline either side of the frame it times, so it reports rather more than a pipelined frame
 * actually costs.
 */
const PIPELINE_FRAME_BUDGET_MS = 9;

/**
 * Smallest frame worth believing, in megapixels (~224²).
 *
 * A section measured before its first resize is drawing into a 1×1 buffer, which is instant and says
 * nothing about the machine. `> 0` would let that through.
 */
const MIN_PROBE_MEGAPIXELS = 0.05;

let initialised = false;
let ceil = 1;
let floor = MIN_PIXEL_RATIO; // lowest density we'll drop to
let softCeil = 1;           // dynamic cap ≤ ceil; lowered when a higher level proves too expensive, so
                            // the controller settles instead of oscillating in and out of it
let pixelRatio = 1;
/** The most this panel could ever justify — the probe's own upper bound. */
let hardwareCeil = 1;
/** True once a believable measurement has been acted on, so a second scene's probe cannot re-decide. */
let probed = false;
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
  // The most this panel could ever justify: its own density, or a little super-sampling on a 1× panel
  // — but ONLY as a bound the probe is allowed to reach, never as a starting assumption.
  hardwareCeil = Math.min(MAX_PIXEL_RATIO, Math.max(deviceRatio, SUPERSAMPLE_CEIL));
  floor = MIN_PIXEL_RATIO;
  // Until something is measured, native is the answer. Rendering above native is a real cost paid for
  // a subtle gain and nothing yet says this machine can afford it; rendering below it is a real
  // quality loss and nothing yet says it is needed.
  //
  // Floored as well as capped, so `floor <= ceil` holds even on a browser zoomed far enough out to
  // report a device ratio under the floor — otherwise the controller would have a range it cannot sit in.
  ceil = Math.max(floor, Math.min(MAX_PIXEL_RATIO, deviceRatio));
  softCeil = ceil;
  pixelRatio = Math.min(ceil, 1);
}

/**
 * Hand the controller a real measurement of one frame of the heaviest pipeline, and let it solve for
 * the density this machine can actually hold.
 *
 * Cost scales with pixel count, which scales with the SQUARE of the ratio — so if the probe drew
 * `megapixels` in `milliseconds` at `probeRatio`, the ratio that lands on budget is
 *
 *     affordable = probeRatio × √(budget ÷ measured)
 *
 * A machine that drew the field in 4 ms at 1× can afford 1.5×. One that took 22 ms can afford 0.64 and
 * gets the floor. Both answers arrive before a single visible frame has been drawn, which is the whole
 * point: the expensive configuration is never allocated on a machine that cannot hold it.
 *
 * Ignored when `milliseconds` is null — `gpuProbe` reports null rather than a number it does not
 * believe, and native then stands, which is the safe answer either way.
 *
 * ⚠ `megapixels` is a VALIDITY GUARD, not a term in the solve. The budget is already "this pipeline,
 * on this canvas, at this ratio", so the frame's area is baked into `milliseconds` — but a reading
 * taken off a 1×1 canvas (a section measured before its first resize) would be meaninglessly fast and
 * has to be thrown out rather than believed.
 *
 * Called once, from the works field's warm-up. Later calls are ignored so two scenes cannot argue.
 */
export function reportProbedFrameCost(
  milliseconds: number | null,
  megapixels: number,
  probeRatio: number,
): void {
  ensureInitialised();
  if (probed || milliseconds === null) return;
  if (megapixels < MIN_PROBE_MEGAPIXELS || probeRatio <= 0) return;
  probed = true;

  const affordable = probeRatio * Math.sqrt(PIPELINE_FRAME_BUDGET_MS / milliseconds);
  ceil = Math.min(hardwareCeil, Math.max(floor, affordable));
  softCeil = ceil;

  // ── Say what was decided, in development ──
  // This one measurement sets the resolution every heavy scene runs at for the whole session, and its
  // effect is silent: a site that is uniformly soft and a site that is uniformly slow look like
  // "something is wrong" rather than like a number. Reading it should not require adding a log first.
  // Stripped from production builds by the bundler's dead-code elimination.
  if (process.env.NODE_ENV === 'development') {
    console.debug(
      `[voidix] gpu probe: ${milliseconds.toFixed(1)} ms for ${megapixels.toFixed(2)} Mpx ` +
        `at ratio ${probeRatio} → affordable ${affordable.toFixed(2)}, ` +
        `ceiling ${ceil.toFixed(2)} (floor ${floor}, hardware max ${hardwareCeil})`,
    );
  }
  // Land on it rather than climb to it. A step-up reallocates every composer on the site, and paying
  // that stall to reach a level we have just MEASURED as affordable is a stall for nothing. A machine
  // measured as not capable starts low, which is the entire reason to measure before the first frame.
  pixelRatio = ceil;
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
