import { telemetryEnabled } from '@/lib/telemetryEnabled';

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
/**
 * The ratio the probe solved this machine could afford — BEFORE it was clamped to the panel's own
 * density or to the floor.
 *
 * Kept separately from `ceil` because the two answer different questions and the clamps destroy the
 * one we need here. A desktop that measured able to afford 2.4× is capped to `ceil = 1` by its 1×
 * panel, and reading `ceil` back would say "native, same as everyone" about a machine with 5× the
 * headroom of the laptop next to it. The unclamped number is the only honest capability signal the
 * site takes, and it is what decides whether MSAA is affordable — see `getProbedAffordableRatio`.
 */
let probedAffordableRatio: number | null = null;
let emaFrameSeconds = 1 / 60;
let slowFor = 0;
let fastFor = 0;
let elapsed = 0;            // accumulated sampled time, for the oscillation + probe windows
let lastStepUpAt = -Infinity;
let lastSoftCeilProbeAt = 0;

/**
 * Say out loud when the site changes how many pixels it draws — development only.
 *
 * This is the quietest thing that happens on the whole site and one of the most consequential. It is
 * also half the answer to "why is the lap after Travel in Time so much smoother": a first pass that
 * struggles steps this DOWN, `softCeil` then stops it climbing back, and every later lap renders
 * fewer pixels. That reads as the site warming up. It is the site giving up resolution.
 *
 * Nothing resets it on the loop, deliberately — see the module header. Being able to watch it happen
 * is what turns that from a surprise into a decision.
 */
function logRatioChange(what: string, from: number, fps: number, note: string): void {
  if (!telemetryEnabled) return;
  const megapixelChange = ((pixelRatio * pixelRatio) / (from * from) - 1) * 100;
  console.log(
    `%c[pixels] ${what}%c ${from.toFixed(2)} → ${pixelRatio.toFixed(2)}` +
      ` (${megapixelChange > 0 ? '+' : ''}${megapixelChange.toFixed(0)}% pixels)` +
      ` at ~${fps.toFixed(0)} fps${note}` +
      `\n  floor ${floor}, ceiling ${ceil.toFixed(2)}, soft ceiling ${softCeil.toFixed(2)}`,
    what.startsWith('STEP') ? 'color:#ff5c5c;font-weight:700' : 'color:#5bd6a0;font-weight:700',
    'color:#888',
  );
}

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
  if (probed) return;

  // ── ⚠ A REFUSED PROBE HAS TO SAY SO ──
  // Both of these used to be silent early returns, and that made the instrument useless on exactly
  // the machines it exists for: a weak laptop reported nothing, and the console gave no way to tell
  // "the warm-up never ran" apart from "it ran and the reading was thrown out". The only visible
  // symptom was a `ceiling` that happened to equal the device pixel ratio — which is what the
  // UNPROBED default also looks like.
  //
  // Silence is the one thing a diagnostic may never do when it fails.
  const rejection =
    milliseconds === null
      ? 'unbelievable reading — see MIN/MAX_BELIEVABLE_MILLISECONDS in gpuProbe'
      : megapixels < MIN_PROBE_MEGAPIXELS
        ? `frame too small to mean anything (${megapixels.toFixed(3)} Mpx)`
        : probeRatio <= 0
          ? `nonsense probe ratio (${probeRatio})`
          : null;

  if (rejection !== null) {
    if (telemetryEnabled) {
      console.log(
        `[voidix] gpu probe REFUSED: ${rejection}` +
          `\n  native stands — ceiling ${ceil.toFixed(2)}, and nothing downstream may earn an upgrade.`,
      );
    }
    return;
  }
  probed = true;

  // Narrowed by the rejection ladder above — `milliseconds === null` is the first case it catches.
  const believableMilliseconds = milliseconds as number;
  const affordable = probeRatio * Math.sqrt(PIPELINE_FRAME_BUDGET_MS / believableMilliseconds);
  probedAffordableRatio = affordable;
  ceil = Math.min(hardwareCeil, Math.max(floor, affordable));
  softCeil = ceil;

  // ── Say what was decided ──
  // This one measurement sets the resolution every heavy scene runs at for the whole session, and its
  // effect is silent: a site that is uniformly soft and a site that is uniformly slow look like
  // "something is wrong" rather than like a number. Reading it should not require adding a log first.
  // Stripped from the public build by the bundler's dead-code elimination.
  //
  // ⚠ A dev server is the WRONG place to read this. The probe times one real frame, and on a dev
  // build that frame is competing with an unminified bundle and StrictMode's second scene. A preview
  // is where the number means something — which is why the gate is `telemetryEnabled`.
  if (telemetryEnabled) {
    console.log(
      `[voidix] gpu probe: ${believableMilliseconds.toFixed(1)} ms for ${megapixels.toFixed(2)} Mpx ` +
        `at ratio ${probeRatio} → affordable ${affordable.toFixed(2)}, ` +
        `ceiling ${ceil.toFixed(2)} (floor ${floor}, hardware max ${hardwareCeil})`,
    );
  }
  // Land on it rather than climb to it. A step-up reallocates every composer on the site, and paying
  // that stall to reach a level we have just MEASURED as affordable is a stall for nothing. A machine
  // measured as not capable starts low, which is the entire reason to measure before the first frame.
  pixelRatio = ceil;
}

/**
 * What the probe found this machine could afford, unclamped — or `null` if it never produced a
 * believable reading (see `gpuProbe`, which returns null rather than a number it does not trust).
 *
 * ⚠ This is a CAPABILITY figure, not a resolution. `1.0` means "this machine can hold the heaviest
 * pipeline at native and has nothing spare"; `1.4` means it has roughly twice the pixel budget it is
 * using. It is deliberately not clamped to the panel, because a 1× monitor caps what is worth
 * RENDERING without saying anything about what the GPU can afford — and MSAA is bought out of that
 * headroom rather than out of the resolution.
 *
 * **Resolution is the priority; samples are the leftover.** Rendering below native softens the whole
 * frame — type, textures, every edge — while dropping MSAA only stair-steps geometric silhouettes,
 * and SMAA covers much of that for a fraction of the memory. So nothing on this site may trade
 * resolution away to keep samples, and the way that is enforced is that samples are only ever raised
 * from a measurement taken AFTER the ratio has been settled.
 *
 * `null` must be read as "not earned". A machine we could not measure is not a machine we may guess
 * about — the whole reason this module stopped guessing upward is in the header.
 */
export function getProbedAffordableRatio(): number | null {
  return probedAffordableRatio;
}

/**
 * What is left AFTER the resolution has taken its share — the number anything else must be paid from.
 *
 * ⚠ Read this, not `getProbedAffordableRatio`, before granting any extra. The probe's raw figure is
 * spent the instant it arrives: `reportProbedFrameCost` LANDS on the ceiling it solves, so a machine
 * that measured 1.32 is immediately rendering at 1.32 and has nothing spare. Comparing an extra
 * against the raw number therefore spends the same headroom twice.
 *
 * That is not hypothetical — it shipped for an afternoon. A laptop measured `affordable 1.32`, took
 * all of it as resolution, was then granted 4× MSAA against that same 1.32, fell to 23 fps and gave
 * the resolution straight back:
 *
 *     gpu probe: affordable 1.32, ceiling 1.32
 *     msaa: earned 4x
 *     [pixels] STEPPED DOWN 1.32 -> 1.12 at ~25 fps
 *     [pixels] STEPPED DOWN 1.12 -> 0.92 at ~23 fps
 *
 * Expressed as a multiple: `1` means "fully spent on pixels, nothing to give", `2.8` means "could
 * have drawn nearly three times the pixels it settled for". The gap opens when the PANEL is the
 * binding constraint rather than the GPU — a 1× monitor caps `ceil` at 1.5 however fast the card is,
 * and that surplus is real and is exactly what an extra should be bought with.
 */
export function getProbedSpareCapacity(): number | null {
  if (probedAffordableRatio === null || ceil <= 0) return null;
  return probedAffordableRatio / ceil;
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
    const recap = elapsed - lastStepUpAt < RECENT_STEP_UP_SECONDS;
    if (recap) {
      softCeil = Math.max(floor, pixelRatio - STEP);
    }
    const from = pixelRatio;
    pixelRatio = Math.max(floor, pixelRatio - STEP);
    logRatioChange('STEPPED DOWN', from, fps, recap ? ` — and capped here (that level cost too much)` : '');
    slowFor = 0;
    fastFor = 0;
  } else if (fastFor >= SETTLE_UP_SECONDS && pixelRatio < effectiveCeil) {
    const from = pixelRatio;
    pixelRatio = Math.min(effectiveCeil, pixelRatio + STEP);
    lastStepUpAt = elapsed;
    logRatioChange('stepped up', from, fps, '');
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
