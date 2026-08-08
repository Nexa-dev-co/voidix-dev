import { telemetryEnabled } from '@/lib/telemetryEnabled';

/**
 * Shared render resolution for the heavy WebGL scenes (the services fleet + the works field).
 *
 * ── THREE PHASES, AND ONLY ONE OF THEM MOVES ─────────────────────────────────────────────────────
 *
 *   1 · PROBE      — `reportProbedFrameCost` times one drained frame of the works pipeline during the
 *                    loader (see `lib/gpuProbe.ts`) and solves a CEILING from it. What the machine
 *                    *says* it can do.
 *   2 · CALIBRATE  — the first few seconds of real rendering are measured, and the ratio this machine
 *                    *actually* sustains is solved from that, minus a safety margin. Set once.
 *   3 · LOCKED     — that number holds for the session. Nothing eases, nothing steps, nothing
 *                    oscillates. One coarse emergency move exists and is deliberately hard to reach.
 *
 * ── Why the eased controller was removed ─────────────────────────────────────────────────────────
 * This module used to run a live controller for the whole session: step down 0.2 when slow, step up
 * when fast, with a dead zone and a soft ceiling meant to make it settle. It did not settle. Measured
 * on a dpr 2.5 laptop, one session:
 *
 *     27.2s  STEPPED DOWN 1.68 → 1.48        35.3s  STEPPED DOWN 1.48 → 1.28
 *     41.2s  STEPPED DOWN 1.28 → 1.25        44.3s  GAVE BACK    1.25 → 1.68
 *     79.0s  STEPPED DOWN 1.68 → 1.48        82.7s  GAVE BACK    1.48 → 1.68
 *
 * Every one of those is a full composer reallocation — the bloom pyramid, the ping-pong targets, the
 * SMAA buffers — and the visitor watches the site change sharpness, repeatedly, forever. The reason it
 * could never converge is structural rather than a matter of tuning: the site's frame cost is
 * dominated by which SECTION is on screen, and the controller kept reading that as a verdict on the
 * resolution it had just changed. Four separate attempts to make the trial reliable (raw deltas, a
 * per-pipeline verdict, anchoring the trial to the apply, abandoning contaminated trials) each fixed a
 * real bug and none of them fixed that.
 *
 * A measurement taken ONCE, on real frames, and then honoured, has none of that failure mode.
 *
 * ── ⚠ Why the probe cannot simply be the answer ──────────────────────────────────────────────────
 * Because it is not reproducible. Four loads of the same page on the same machine:
 *
 *     0.5 ms → affordable 3.91      2.3 ms → affordable 1.82
 *     3.0 ms → affordable 1.60      7.5 ms → affordable 1.01
 *
 * An eightfold spread, because it runs seconds after `buildField` has spent two seconds burning the
 * CPU and the machine has not settled. It also times the works pipeline ALONE, on a quiet stage, while
 * the real frame carries the sun's own canvas and bloom, the compositor and its blend layers. It is a
 * useful upper bound and a terrible target — so it sets the ceiling, and the calibration decides where
 * inside that ceiling we actually sit.
 *
 * Scenes call `sampleFrame(dt)` on frames they actually rendered, and read `getPixelRatio()` each
 * frame, re-sizing renderer + composer when it changes.
 */

// ── The range ──────────────────────────────────────────────────────────────────────────────────────

/** The absolute lowest, for a 1× panel where there is genuinely nothing else left to give. */
const MIN_PIXEL_RATIO = 0.75;

/**
 * The most the browser may be asked to blow the render up when it composites it.
 *
 * ⚠ THE FLOOR HAS TO BE RELATIVE TO THE PANEL, and `MIN_PIXEL_RATIO` alone is not. 0.75 is 75 % of a
 * 1× display's density — softer, but honest. On a dpr 2.5 laptop it is 30 %, which the compositor then
 * scales up 3.3×, and that is not "softer", that is smeared. The same constant means two completely
 * different pictures.
 *
 * Capping the upscale keeps the meaning constant across displays, so the sub-native move weak 1×
 * machines need survives while dense panels are protected from the smear.
 *
 * ── ⚠ TIGHTENED 2.5 → 2.17 ON 2026-08-06, AS A DELIBERATE QUALITY PURCHASE ──────────────────────
 *
 * This is the ONLY dial that can raise quality on a machine whose burn-in lands under the floor, and
 * on a 4K laptop at 250 % scaling that is every machine. Measured there: the burn-in solved 0.64 and
 * was clamped up to a floor of exactly 1.00, so the site rendered at 40 % of the panel's density —
 * and `RESOLUTION_PRIORITY` was completely inert, because all three of its settings solve below 1.00
 * too. Making the frame cheaper would not have helped either: the solve would still land under the
 * floor and still clamp to it.
 *
 *     dpr 2.5   floor 1.00 → 1.15      dpr 3   floor 1.20 → 1.38
 *     dpr 2     floor 0.80 → 0.92      dpr 1   floor 0.75 (unchanged, held by MIN_PIXEL_RATIO)
 *
 * ⚠ IT COSTS +32 % PIXELS, because cost is the square of the ratio. That was funded rather than
 * simply spent — `BLOOM_MSAA_SAMPLES_BY_TIER` in `useWorksField` went to 0 and the fluid cursor's ink
 * canvas came down to 1.25 in the same change. See `docs/performance-cost-inventory.md` §6.
 *
 * ⚠ IT RAISES THE FLOOR ON PHONES TOO, by the same proportion, and phones can least afford it — a
 * dpr 3 handset goes 1.20 → 1.38. That is not scoped away here on purpose: one constant, one meaning.
 * If it bites, the fix is to read `isLowPowerDevice()` when computing the floor rather than to move
 * this number back, or the desktop purchase goes with it.
 */
const MAX_COMPOSITE_UPSCALE = 2.17;

/**
 * The most a 1× panel could ever be allowed, if anything were allowed to supersample.
 *
 * ⚠ NOTHING SPENDS IT, and the comment here used to imply otherwise ("only if PROBED able"). The
 * field's `ceil` includes `deviceRatio`, so it is capped at native and never reaches this; `sunCeiling`
 * now does the same, deliberately, and its header records why a probe-gated exception was rejected.
 * All this constant does today is keep `hardwareCeil` off the floor on a low-density display.
 */
const SUPERSAMPLE_CEIL = 1.5;
const MAX_PIXEL_RATIO = 2;    // hard cap (retina native)
const MAX_SANE_DT = 0.5;      // ignore absurd deltas (tab-restore, breakpoints)
const EMA_ALPHA = 0.1;        // smoothing on the measured frame time (rejects one-frame spikes)

/**
 * How long a queued resolution change may wait for an idle frame before it is applied anyway.
 *
 * Both heavy scenes only re-size while they are NOT being drawn, because reallocating a composer
 * stalls a frame and a stall hidden behind a running tween makes the motion jump. But `useWorksField`
 * hosts the chamber AND the contact singularity, so it has NO idle frame between works and the
 * teleport — a change queued there would wait a whole lap. So: take an idle frame if one comes, and
 * otherwise take the hitch.
 *
 * Far less load-bearing than it was, now that the ratio is set once rather than eased continuously.
 */
export const RATIO_APPLY_GRACE_SECONDS = 1.5;

// ── Phase 1 · the probe ────────────────────────────────────────────────────────────────────────────

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
 * How much of that budget is deliberately LEFT UNSPENT.
 *
 * ⚠ EXPRESSED AGAINST COST, NOT AGAINST THE RATIO. Cost scales with the SQUARE of the ratio, so
 * trimming the ratio by 15 % would remove 28 % of the pixels — nearly double the intended margin.
 * Applied here, to milliseconds, 15 % is 15 %: the solve targets 7.65 ms instead of 9.
 */
const SAFETY_HEADROOM_FRACTION = 0.15;
const SPENDABLE_FRAME_BUDGET_MS = PIPELINE_FRAME_BUDGET_MS * (1 - SAFETY_HEADROOM_FRACTION);

/** Smallest frame worth believing, in megapixels (~224²). A 1×1 buffer says nothing about a machine. */
const MIN_PROBE_MEGAPIXELS = 0.05;

/**
 * The most pixels the heavy scenes may ever be asked to draw into, whatever the ratio works out as.
 *
 * ⚠ THE RATIO IS NOT THE COST. THE PIXEL COUNT IS:
 *
 *     ratio 1.5 on a 1080p panel     →  3.1 Mpx
 *     ratio 2.0 on a 4K laptop       →  5.3 Mpx      ← 70 % more work, from a smaller-looking number
 *
 * `hardwareCeil` rises with `devicePixelRatio`, which is exactly backwards — a 4K screen is a reason
 * to render at a LOWER ratio, because the CSS viewport is small and every ratio point costs four times
 * what it costs on a 1× panel. Found on a 4K laptop at 250 % scaling: `affordable 3.87`, ceiling
 * clamped to 2.0, a 5.26 Mpx drawing buffer, render targets over 700 MB, 20 fps.
 *
 * 3 Mpx is a little over a 1080p frame at 1.2×, and keeps the render targets near 290 MB — roughly
 * where an integrated GPU stops evicting.
 */
const MAX_DRAWING_BUFFER_MEGAPIXELS = 3;

// ── Phase 2 · the calibration ──────────────────────────────────────────────────────────────────────

/**
 * Sampled seconds thrown away before the measurement starts.
 *
 * The first frames after the loader are not the site running — they are the tail of it starting: the
 * last texture uploads, the first compiles, the mark buffers being handed to the GPU. The profiler
 * routinely logs 300–500 ms frames in that window. Measuring there would report every machine as far
 * weaker than it is and cut the resolution on the strength of it.
 */
const CALIBRATION_WARMUP_SECONDS = 1;

/** Sampled seconds the measurement is averaged over. Long enough to cross a stop, short enough to be early. */
const CALIBRATION_SECONDS = 3;

/**
 * One frame may not contribute more than this to the calibration mean.
 *
 * A garbage collection or a composer reallocation inside the window is not the steady-state cost of
 * the frame, and at 25 fps a single 400 ms sample is worth sixteen real ones.
 */
const CALIBRATION_MAX_SAMPLE_MS = 200;

/**
 * ── ⚠ THE ONE DIAL. What this site is willing to trade, and in which direction. ───────────────────
 *
 * Resolution and frame rate are the same budget spent two ways, and there is no measurement that can
 * tell you which one matters more — that is a decision about the site, not about the machine. This is
 * where it is written down, so it is one word rather than an archaeology dig through four constants.
 *
 *   'quality'    — hold the pixels, accept 24 fps. Sharpest, and the first to drop a frame.
 *   'smoothness' — aim for 40, and give up whatever resolution that costs.
 *   'balanced'   — 30. The rate this site is authored to, and what everything below is sized against.
 *
 * ⚠ LOWER TARGET FPS MEANS MORE PIXELS. The two are the same budget spent two ways, so 'quality' is
 * the SLOWEST setting, not the fastest. That reads backwards at a glance and is worth saying out loud.
 *
 * ── ⚠ RETARGETED 50 → 30 ON 2026-08-07 ───────────────────────────────────────────────────────────
 * 'balanced' was 50, so every solve on the site aimed at a 20 ms frame. Against a 30 fps budget that
 * is a 33.3 ms frame, and since cost is the square of the ratio the difference is worth
 * √(33.3 ÷ 20) = **1.29× the ratio, or 1.67× the pixels, on every machine with room above the floor.**
 * It is the single largest quality change available to this file and it is one number.
 *
 * 30 is not a compromise here — it is what the site is FOR. Every crossing is a scrubbed cinematic
 * and nothing on the page is timed in frames, so the visitor's experience of 30 vs 50 is a slightly
 * softer sample of a camera move against a visibly sharper image. The brief asks for as much quality
 * as the machine can give at 30, and this is where that number is written down.
 *
 * ⚠ IT CANNOT PUSH PAST THE FLOOR, and on a dense panel the floor is usually what binds. If this is
 * set to 'quality' and the picture is still softer than you want, the constant you actually want is
 * `MAX_COMPOSITE_UPSCALE` above — that is what decides how far below your display's density the site
 * is ever allowed to render, and no target frame rate can override it.
 */
type ResolutionPriority = 'quality' | 'balanced' | 'smoothness';
const RESOLUTION_PRIORITY: ResolutionPriority = 'balanced';

const PRIORITY_TARGET_FPS: Record<ResolutionPriority, number> = {
  quality: 24,
  balanced: 30,
  smoothness: 40,
};

/** The frame time the calibration solves toward. Lower target fps → more pixels kept. */
const CALIBRATION_TARGET_FRAME_MS = 1000 / PRIORITY_TARGET_FPS[RESOLUTION_PRIORITY];

/**
 * Held back from whatever the machine proved it could sustain.
 *
 * A frame rate is an average, and what a visitor notices is the tail. A machine set to land exactly on
 * what it measured drops a frame every time anything varies — a collection, a texture upload, a
 * heavier moment in the scroll — because it had nothing spare to absorb it.
 */
const CALIBRATION_SAFETY_FRACTION = 0.1;

// ── Phase 3 · the one emergency move ───────────────────────────────────────────────────────────────

/**
 * ⚠ These exist so a badly wrong calibration is survivable, NOT so the controller comes back.
 *
 * Every threshold here is deliberately far outside anything normal: the frame rate has to be dire (or
 * excellent) and stay that way for six seconds, the move is coarse rather than a nudge, there are at
 * most two of them in a session, and once one has gone in a direction the opposite direction is locked
 * out for good. That last rule is what makes oscillation impossible by construction rather than by
 * tuning — which is the thing four rounds of tuning never achieved.
 */
const EMERGENCY_SLOW_FPS = 22;
const EMERGENCY_FAST_FPS = 58;
const EMERGENCY_SETTLE_SECONDS = 6;
/** A move halves or doubles the PIXELS — so the ratio moves by √2, not by a 0.2 nudge. */
const EMERGENCY_PIXEL_FACTOR = 0.5;
const MAX_EMERGENCY_MOVES = 2;
/** One frame may not contribute more than this to the settle clock, so a single stall cannot trip it. */
const SETTLE_SAMPLE_CAP_SECONDS = 0.1;

// ── Extras (MSAA), bought with observed frame rate at full quality ─────────────────────────────────

const EXTRA_QUALITY_FPS = 50;
const EXTRA_QUALITY_SECONDS = 4;

/**
 * How much MORE ratio the burn-in's solve had to be worth than the ratio we actually took, before an
 * extra may be bought with the difference.
 *
 * ── ⚠ Why the licence can be granted here at all ─────────────────────────────────────────────────
 * The runtime version of this test — 50 fps held for four seconds — is a good test and it cannot
 * possibly be met before the first visible frame. So on a first lap the raise it gates (4× MSAA on
 * the space stage) was BY CONSTRUCTION a mid-session `dispose()` and reallocation of both composer
 * ping-pong targets, several seconds into the fleet. It is one of the few remaining things a second
 * lap gets for free that a first lap pays for, which is the whole complaint this work exists to
 * answer.
 *
 * The burn-in already produces the number that licence was standing in for: a median frame cost at a
 * known ratio, taken on real pipelined frames with the star drawing alongside. If the ratio it solves
 * is clipped by the ceiling, the machine proved it could afford more than the site is able to spend —
 * and THAT surplus, not a guess, is what buys the extra.
 *
 * ⚠ 1.25 on the RATIO is 1.56 on the PIXELS, and pixels are what an extra costs. It is deliberately
 * the same figure CLAUDE.md records for the probe-based version of this gate.
 *
 * ⚠ It cannot spend resolution. The ratio is already assigned by the time this is consulted, and the
 * rule this module exists to enforce is that resolution is the priority and samples are the leftover.
 * A surplus of exactly 1 means there was no leftover, and nothing is bought.
 */
const EXTRA_QUALITY_BURN_IN_SURPLUS = 1.25;

/**
 * How much sharper than the section's models the star may ever be allocated.
 *
 * ── ⚠ WHY A CAP EXISTS AT ALL: THE STAR'S MEASUREMENT IS A LOWER BOUND ───────────────────────────
 * The burn-in's phase B does not measure the star this site actually draws. It runs before
 * `SUN_ASSEMBLE_EVENT`, and `SunModelCanvas` has already called `positionShards(0, 0)` at model-land,
 * which resolves `coronaGrowth` to 0 and sets `visible = false` on every one of `coronaParts` — the
 * core sphere, the outer glow, the flares and the twenty corona planes. `sunParticles` is at
 * `ringForm` 0, collapsed into its launch knot.
 *
 * So phase B times TEN TUMBLING SHARDS, several straddling the frame edge. And the corona is not
 * incidental to the star's cost, it IS the cost — twenty additive overlapping planes are the overdraw
 * that `docs/per-section-quality-budget-plan.md` §1c blames for a 0.28 Mpx canvas reaching 9–22 ms.
 *
 *     starMilliseconds  understated  →  starSolved  overstated by its square root
 *
 * `MIN_CREDIBLE_STAR_MS` guards the NOISE version of this ("would divide by very nearly nothing and
 * hand the star its ceiling") at 0.6 ms. A shard-only star measuring 1.5 ms passes it comfortably and
 * the conclusion is wrong anyway. The check asks *is this a real difference*; it cannot ask *is this
 * the star we are budgeting for*.
 *
 * ── ⚠ HOW BAD IT ACTUALLY IS, WHICH IS LESS THAN IT SOUNDS ───────────────────────────────────────
 * Worked on the log's own example (field 12.4 ms @ 1.15, real star 6.1 ms, measured 1.5 ms, dpr 2.5):
 * the star clamps to its ceiling of 2.0 and then costs 18.5 ms where 4.5 was budgeted — **4× its
 * allocation**. But it draws at `SUN_IDLE_STRIDE`, so it spends 9.2, and the frame lands at 28.1 ms
 * against a 33.3 budget. THE FRAME SURVIVES. The bias is ~2× after the square root and the stride is a
 * 2× margin, and they very nearly cancel.
 *
 * That is the honest severity: the error does not blow the budget, it EATS THE MARGINS — both of the
 * conservatisms §8d earmarked for other jobs, including the one meant to absorb the chamber, which is
 * measured with SMAA off and never re-checked with the room in frame.
 *
 * ── What this constant is therefore for ──
 * Two things, and it would be worth having for the second even if the measurement were perfect:
 *
 *   1 · a bound on an upper bound. Using `starSolved` directly spends a number we know is inflated.
 *   2 · COMPOSITING COHERENCE. The star is composited over the fleet and the marks. Past roughly this
 *       much extra density it stops reading as "sharper" and starts reading as pasted on — a crisp
 *       star over a soft field is a compositing error, not a quality win.
 *
 * ⚠ It bites hardest exactly where it should: on a 1× panel, where `ceil` holds the field to native
 * 1.0 while `sunCeiling()` would let the star supersample. Elsewhere (dpr 2 – 2.5) it trims only a few
 * hundredths, because the field's own ceiling is already close. Remove the bias — see §3's options for
 * measuring the star in its real state — and this can be relaxed or dropped.
 */
const STAR_RAISE_OVER_MODELS = 1.35; // 1.35 on the ratio is 1.82 on the pixels

// ── State ──────────────────────────────────────────────────────────────────────────────────────────

type ControllerPhase = 'calibrating' | 'locked';

/**
 * The two heavy scenes, measured separately — because they are not the same load.
 *
 * ⚠ THE SITE MUST BE SIZED FOR ITS HEAVIEST SCENE, and the first one a visitor reaches is the lighter
 * one. Measured on a dpr 2.5 laptop at the same ratio: the fleet ran 23–26 fps, the works field 13–17.
 * A single calibration taken on the fleet is therefore optimistic by nearly half, and works pays for
 * it for the rest of the visit.
 *
 * So each scene gets ONE measurement the first time it draws, and the settled ratio is the LOWER of
 * them. Two changes per session, both inside the first few seconds of each section, then nothing
 * moves again. Relying on the emergency valve instead would cost the same two changes and make the
 * second one a blunt halving rather than a measurement.
 */
type PipelineKey = 'deck' | 'works';

let initialised = false;
/**
 * ⚠ Starts CALIBRATING, not waiting for the probe.
 *
 * The probe is a nice-to-have: it narrows the ceiling. If it never arrives — the works warm-up throws,
 * a context is lost, the reading is refused — a controller that waited for it would sit at its default
 * ratio for the whole session with no measurement ever taken, and say nothing about it. Calibrating
 * unconditionally means the only thing a missing probe costs is a slightly loose ceiling.
 */
let phase: ControllerPhase = 'calibrating';
let ceil = 1;
let floor = MIN_PIXEL_RATIO;
let pixelRatio = 1;
let hardwareCeil = 1;
/**
 * The panel's own density, unmodified.
 *
 * Kept separately because `hardwareCeil` has already been raised to `SUPERSAMPLE_CEIL` on a 1× display
 * and can therefore no longer answer "what is native here" — which is the question `sunCeiling()` needs
 * to ask.
 */
let deviceRatioNative = 1;
let pixelBudgetCeil = Infinity;
let probed = false;
let probedAffordableRatio: number | null = null;

/**
 * The star's OWN resolution, once the allocator has solved one. `null` until then, and while it is
 * null the star tracks the shared ratio exactly as it always did.
 *
 * ⚠ `SunModelCanvas`'s header records why the star was brought UNDER the shared ratio in the first
 * place — it was the last renderer answering to nothing, and on a dpr 2.5 laptop it drew at 2.0 with
 * MSAA while the field beside it drew at 1.01, costing 10–21 ms. Giving it its own number again is not
 * a return to that. The old number was `min(devicePixelRatio, 2)` — a guess that had measured nothing.
 * This one is what is left of a 30 fps frame after the section's models have taken theirs, from a
 * measurement of the star's actual marginal cost. The objection was never "the star should not have
 * its own ratio"; it was "two renderers cannot both guess how fast the machine is".
 */
let sunPixelRatio: number | null = null;

let emaFrameSeconds = 1 / 60;
let dropNextSample = false;

let calibrationWarmupSeconds = 0;
let calibrationSeconds = 0;
let calibrationMilliseconds = 0;
let calibrationFrames = 0;
/** The ratio the calibration frames were actually drawn at. */
let calibrationRatio = 1;
/** Which scene's frames are arriving right now. */
let activePipeline: PipelineKey | null = null;
/** Scenes that have had their one measurement. */
const calibratedPipelines = new Set<PipelineKey>();

let emergencySlowFor = 0;
let emergencyFastFor = 0;
let emergencyMoves = 0;
/** Once a move has gone one way, the other way is closed for the session. */
let emergencyDirection: 'none' | 'down' | 'up' = 'none';

let extraQualityFor = 0;
let extraQualityEarned = false;

function logPixels(what: string, body: string, good = false): void {
  if (!telemetryEnabled) return;
  console.log(
    `%c[pixels] ${what}%c ${body}`,
    good ? 'color:#5bd6a0;font-weight:700' : 'color:#ff5c5c;font-weight:700',
    'color:#888',
  );
}

/**
 * Throw away whatever has been measured so far and start the window again.
 *
 * ⚠ Called when the probe lands, because the probe can move `pixelRatio` — and a calibration whose
 * frames were drawn at two different resolutions is not a measurement of either.
 */
function resetCalibration(): void {
  calibrationWarmupSeconds = 0;
  calibrationSeconds = 0;
  calibrationMilliseconds = 0;
  calibrationFrames = 0;
}

function ensureInitialised(): void {
  if (initialised) return;
  initialised = true;
  const deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  deviceRatioNative = deviceRatio;
  hardwareCeil = Math.min(MAX_PIXEL_RATIO, Math.max(deviceRatio, SUPERSAMPLE_CEIL));
  floor = Math.max(MIN_PIXEL_RATIO, deviceRatio / MAX_COMPOSITE_UPSCALE);

  // ── ⚠ THE BUFFER BUDGET APPLIES EVEN WITHOUT A PROBE ────────────────────────────────────────────
  // `pixelBudgetCeil` used to stay `Infinity` until `reportProbedFrameCost` solved it from the frame it
  // measured — so a REFUSED probe silently removed `MAX_DRAWING_BUFFER_MEGAPIXELS` from the system
  // altogether. `docs/per-section-quality-budget-plan.md` §3 flags exactly this, and it is the one
  // constant standing between a 4K laptop at 250 % scaling and the 5.26 Mpx / 700 MB / 20 fps case its
  // own header records.
  //
  // ⚠ Retargeting to 30 fps WIDENED that hole rather than leaving it where it was. The solve is
  // `ratio × √(budget ÷ measured)`, so the frame time at which a machine reaches an unbounded ceiling
  // of 2.0 moved from ~4.0 ms to ~6.1 ms — a materially larger band of machines. A hole nobody falls
  // into is a footnote; this change made it wider, so it gets closed here.
  //
  // The heavy scenes are full-viewport, so the viewport IS their CSS area. The probe refines this with
  // the canvas it actually measured; this is the floor of correctness underneath it.
  const viewportMegapixels =
    typeof window !== 'undefined'
      ? (window.innerWidth * window.innerHeight) / 1_000_000
      : 0;
  if (viewportMegapixels > 0) {
    pixelBudgetCeil = Math.sqrt(MAX_DRAWING_BUFFER_MEGAPIXELS / viewportMegapixels);
  }

  ceil = Math.max(floor, Math.min(MAX_PIXEL_RATIO, deviceRatio, pixelBudgetCeil));
  // Until something is measured, native — never above it, and never below the floor.
  pixelRatio = Math.min(ceil, Math.max(floor, 1));
}

/**
 * Hand the controller a real measurement of one frame of the heaviest pipeline, and let it solve for
 * the CEILING this machine may sit under.
 *
 * Cost scales with pixel count, which scales with the SQUARE of the ratio — so if the probe drew
 * `megapixels` in `milliseconds` at `probeRatio`, the ratio that lands on budget is
 *
 *     affordable = probeRatio × √(budget ÷ measured)
 *
 * ⚠ `megapixels` is a VALIDITY GUARD, not a term in the solve. The budget is already "this pipeline,
 * on this canvas, at this ratio", so the frame's area is baked into `milliseconds` — but a reading
 * taken off a 1×1 canvas has to be thrown out rather than believed.
 *
 * ⚠ This sets a CEILING and starts the calibration. It does NOT decide where we render — see the
 * module header for the eightfold spread that makes it unfit to be a destination.
 */
export function reportProbedFrameCost(
  milliseconds: number | null,
  megapixels: number,
  probeRatio: number,
): void {
  ensureInitialised();
  if (probed) return;

  // ── ⚠ A REFUSED PROBE HAS TO SAY SO ──
  // Both of these used to be silent early returns, which made the instrument useless on exactly the
  // machines it exists for: the only visible symptom was a ceiling that happened to equal the device
  // pixel ratio — which is what the UNPROBED default also looks like.
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
          `\n  native stands as the ceiling — the calibration below still runs and still decides.`,
      );
    }
    // A refused probe costs us the ceiling, not the measurement that matters — the calibration was
    // already running and carries on untouched, since nothing moved the ratio.
    return;
  }
  probed = true;

  const believableMilliseconds = milliseconds as number;
  const affordable = probeRatio * Math.sqrt(SPENDABLE_FRAME_BUDGET_MS / believableMilliseconds);
  probedAffordableRatio = affordable;

  // The probe reports the area it drew AND the ratio it drew at, so the CSS-pixel area falls out — and
  // from that, the ratio at which this particular viewport hits the buffer budget.
  const cssMegapixels = megapixels / (probeRatio * probeRatio);
  pixelBudgetCeil = Math.sqrt(MAX_DRAWING_BUFFER_MEGAPIXELS / cssMegapixels);

  ceil = Math.max(floor, Math.min(hardwareCeil, pixelBudgetCeil, affordable));
  // ⚠ Clamped DOWN to the new ceiling, never raised to it. Landing on the probe's number is the
  // "guess upward and claw back" mistake this module was rewritten to stop making — and the probe's
  // eightfold spread (see the header) is exactly why. The calibration below is what may raise it, and
  // it will have measured a real frame before it does.
  pixelRatio = Math.min(ceil, pixelRatio);
  // The ratio may have just moved, so any frames already banked were drawn at the old one.
  resetCalibration();

  if (telemetryEnabled) {
    console.log(
      `[voidix] gpu probe: ${believableMilliseconds.toFixed(1)} ms for ${megapixels.toFixed(2)} Mpx ` +
        `at ratio ${probeRatio} → affordable ${affordable.toFixed(2)}, ceiling ${ceil.toFixed(2)}` +
        `\n  bound by ${
          ceil === floor
            ? 'the floor'
            : pixelBudgetCeil < Math.min(hardwareCeil, affordable)
              ? `the ${MAX_DRAWING_BUFFER_MEGAPIXELS} Mpx buffer budget (hit at ${pixelBudgetCeil.toFixed(2)})`
              : hardwareCeil < affordable
                ? `the panel (hardware max ${hardwareCeil})`
                : 'the measurement'
        }` +
        `\n  this is a CEILING, not a destination — calibrating against real frames next.`,
    );
  }
}

/**
 * The loader's burn-in: the median cost of real, pipelined frames of the works pipeline, measured
 * during the loader with everything else already running.
 *
 * ── ⚠ WHY THIS EXISTS ALONGSIDE `reportProbedFrameCost` ──────────────────────────────────────────
 * They measure different things and only one of them is the frame the visitor gets.
 *
 * `gpuProbe` times three DRAINED frames — `gl.finish()` either side — of the works pipeline ALONE, on
 * a quiet stage: no pipelining, no star, no compositor. Its spread across four loads of the same page
 * on one machine was eightfold (0.5 / 2.3 / 3.0 / 7.5 ms → affordable 3.91 / 1.82 / 1.60 / 1.01).
 * That is why it may set a ceiling and must never pick a destination.
 *
 * This is rAF-to-rAF across real frames, with the star's own context rendering alongside (it
 * auto-rotates throughout the loader) and the compositor doing real work. It costs the loader up to
 * ~1.5 s, taken deliberately: the first lap is then right from its first frame instead of being
 * corrected four seconds into the fleet, which is what "it feels heavy the first time" was.
 *
 * ⚠ What it measures is not exactly the works section, and the two errors run opposite ways. The
 * loader's dust field is composited during the burn-in and will not be there later (over-counts); the
 * works canvas and the section's own DOM are not (under-counts). Comparable layer counts, so the net
 * is small — and `CALIBRATION_SAFETY_FRACTION` is sized to absorb exactly this sort of drift.
 *
 * ⚠ It marks BOTH scenes calibrated. The runtime per-scene calibration stays as the fallback for a
 * burn-in that never ran — a lost context, a scene that failed to build, too few usable samples — and
 * must not run on top of one that did.
 */
export function reportBurnIn(medianFrameMilliseconds: number, ratio: number): void {
  ensureInitialised();
  if (phase === 'locked') return;
  if (!(medianFrameMilliseconds > 0) || !(ratio > 0)) return;

  const sustainable = ratio * Math.sqrt(CALIBRATION_TARGET_FRAME_MS / medianFrameMilliseconds);
  const solved = sustainable * (1 - CALIBRATION_SAFETY_FRACTION);
  const from = pixelRatio;

  pixelRatio = Math.min(ceil, Math.max(floor, solved));
  phase = 'locked';
  calibratedPipelines.add('works');
  calibratedPipelines.add('deck');

  // What the machine proved it could afford, over what the site was able to spend. See the constant.
  const surplus = solved / pixelRatio;
  if (surplus >= EXTRA_QUALITY_BURN_IN_SURPLUS) extraQualityEarned = true;

  if (telemetryEnabled) {
    const bound =
      solved > ceil ? 'the probe ceiling' : solved < floor ? 'the floor' : 'the measurement';
    console.log(
      `%c[pixels] BURN-IN%c ${from.toFixed(2)} → ${pixelRatio.toFixed(2)} — decided during the loader,` +
        ` locked before the first visible frame.` +
        `\n  priority "${RESOLUTION_PRIORITY}" → aiming for ${PRIORITY_TARGET_FPS[RESOLUTION_PRIORITY]} fps` +
        `\n  measured ${medianFrameMilliseconds.toFixed(1)} ms/frame ` +
        `(${(1000 / medianFrameMilliseconds).toFixed(0)} fps) at ratio ${ratio.toFixed(2)}` +
        `\n  sustains ${sustainable.toFixed(2)}, less ` +
        `${(CALIBRATION_SAFETY_FRACTION * 100).toFixed(0)}% safety → ${solved.toFixed(2)}, ` +
        `bound by ${bound}` +
        `\n  floor ${floor.toFixed(2)}, ceiling ${ceil.toFixed(2)} — runtime calibration stood down;` +
        ` only ${EMERGENCY_SLOW_FPS}–${EMERGENCY_FAST_FPS} fps for ${EMERGENCY_SETTLE_SECONDS}s moves this.` +
        `\n  surplus ${surplus.toFixed(2)}× over what was spent — extras ` +
        `${extraQualityEarned ? 'EARNED, decided here rather than four seconds into the fleet' : `not earned (needs ${EXTRA_QUALITY_BURN_IN_SURPLUS}×)`}.`,
      'color:#5bd6a0;font-weight:700',
      'color:#888',
    );
  }
}

/** What the burn-in's two phases separated out. All four are needed to solve anything. */
export interface SectionCostSplit {
  /** Median frame ms with the FIELD drawing and the star dark. Contains the fixed cost too. */
  fieldMilliseconds: number;
  /** The star's own marginal cost, in ms — phase B minus phase A, at full draw rate. */
  starMilliseconds: number;
  /** The ratio the field was drawn at while it was measured. */
  fieldRatio: number;
  /** The ratio the star was drawn at while it was measured. */
  starRatio: number;
}

/**
 * ── THE QUALITY ALLOCATOR ────────────────────────────────────────────────────────────────────────
 *
 * Spend a 30 fps frame across the two things that share it, in priority order: **the section's models
 * take what they can afford, and whatever is left goes to the star.**
 *
 * This is the thing `docs/per-section-quality-budget-plan.md` §1a says is missing — *"the split
 * between the star and the scene behind it is decided by their canvas areas and nothing else — no
 * budget, no priority, no section"* — and it supersedes §3's "Per-section sun ratio: unnecessary and
 * risky". §3 was ruling on a design that changed the star's ratio AS YOU SCROLLED, which would put a
 * composer reallocation at a section boundary. Nothing here does that: all of it is solved once, in
 * the loader, behind the veil, and then held for the session exactly like every other number in this
 * file.
 *
 * ── How the split is obtained at all ──
 * WebGL is asynchronous, so no span around a render call measures what the GPU spends — `unaccounted`
 * is 70–95 % of every frame on this site and both subjects live inside it. The only instrument that
 * can see them is a DIFFERENCE between two sets of drawing things, which is why the burn-in now runs
 * two phases and why the star's draw permit had to be moved off `BURN_IN_EVENT`.
 *
 * ── The solve ──
 * Cost is the square of the ratio, so a pipeline measured at `c` ms while drawn at `r` costs
 * `c × (r'/r)²` at any other ratio. Then, in order:
 *
 *     1.  reserve the star's FLOOR      — the centrepiece is never starved to nothing
 *     2.  the models take the rest      — up to their own ceiling, never past it
 *     3.  the star takes what remains   — up to its own ceiling
 *
 * Step 2 capping at the ceiling is what makes step 3 meaningful: on a machine strong enough to run the
 * field at full density there is real budget left over, and the star gets all of it. That is the
 * brief's *"if the device can handle more, the sun can get the highest"* — as an outcome of
 * measurement rather than as a fixed value anywhere.
 *
 * ── ⚠ Two deliberate conservatisms, both in the same direction ──
 * `fieldMilliseconds` contains the FIXED cost (compositor, blend layers, DOM) as well as the field's,
 * and scaling the whole thing by `(r'/r)²` therefore over-charges the field for pixels the fixed part
 * never spends. And the star is measured at FULL rate here, while in the two sections where it
 * actually competes it draws at `SUN_IDLE_STRIDE` — every other frame — so its real cost there is half
 * what is budgeted for it.
 *
 * Both make the allocation land under the budget rather than over it, which is the correct direction
 * for a number that can only be applied once. The star's 2× margin is also what makes the HERO safe
 * without a separate measurement: there the star draws at full rate, but the field is not drawing at
 * all, so the whole of `fieldSpent` is free.
 */
export function reportSectionCosts(split: SectionCostSplit): void {
  ensureInitialised();
  if (phase === 'locked') return;
  const { fieldMilliseconds, starMilliseconds, fieldRatio, starRatio } = split;
  if (!(fieldMilliseconds > 0) || !(starMilliseconds > 0)) return;
  if (!(fieldRatio > 0) || !(starRatio > 0)) return;

  // The frame every section is being sized to fit inside.
  //
  // ⚠ THE SAFETY MARGIN IS APPLIED TO THE RATIO BELOW, NOT TO THIS BUDGET, AND THE TWO ARE NOT THE
  // SAME THING. Cost is the square of the ratio, so 10 % off the ratio is 19 % off the pixels while
  // 10 % off the budget is 10 % off the pixels — nearly double the margin, from the same constant.
  // `SAFETY_HEADROOM_FRACTION` above argues the milliseconds reading is the more honest one, and it is
  // probably right; but `reportBurnIn` and `calibrate` have both always taken it off the ratio, and
  // those are the two paths that run whenever this one does not. A visitor must not get a measurably
  // different picture depending on which solver happened to answer, so this matches its siblings.
  // Changing the convention is a one-line change in three places, and it belongs in its own pass.
  const budgetMs = 1000 / PRIORITY_TARGET_FPS[RESOLUTION_PRIORITY];

  const starFloor = floor;
  const starCeil = sunCeiling();

  // ── 1 · Reserve the star's floor ──
  const costAt = (measuredMs: number, measuredRatio: number, wantedRatio: number) =>
    measuredMs * (wantedRatio / measuredRatio) ** 2;
  const starFloorCost = costAt(starMilliseconds, starRatio, starFloor);

  // ── 2 · The models take what they can afford, capped by their own ceiling ──
  const fieldBudget = Math.max(0, budgetMs - starFloorCost);
  const fieldSolved =
    fieldRatio * Math.sqrt(fieldBudget / fieldMilliseconds) * (1 - CALIBRATION_SAFETY_FRACTION);
  const newFieldRatio = Math.min(ceil, Math.max(floor, fieldSolved));

  // ── 3 · The star takes the remainder, bounded by what the models got ──
  const fieldSpent = costAt(fieldMilliseconds, fieldRatio, newFieldRatio);
  const remainingMs = Math.max(0, budgetMs - fieldSpent);
  const starSolved =
    starRatio * Math.sqrt(remainingMs / starMilliseconds) * (1 - CALIBRATION_SAFETY_FRACTION);
  // ⚠ `starSolved` is an upper bound, not a value — phase B measured the star without its corona. See
  // STAR_RAISE_OVER_MODELS for the whole finding and for the compositing argument that would justify
  // this cap even with a perfect measurement.
  //
  // ⚠ The floor is applied to the ALLOWANCE as well as to the solve, so it holds however the two
  // ceilings move. Today it cannot bind here — `newFieldRatio >= floor` and `starFloor === floor`, so
  // the allowance is at least `floor × 1.35` — but that is an invariant across three other constants
  // rather than something this line should be relying on.
  const starAllowance = Math.max(
    starFloor,
    Math.min(starCeil, newFieldRatio * STAR_RAISE_OVER_MODELS),
  );
  const newStarRatio = Math.min(starAllowance, Math.max(starFloor, starSolved));

  const fieldFrom = pixelRatio;
  const starFrom = getSunPixelRatio();
  pixelRatio = newFieldRatio;
  sunPixelRatio = newStarRatio;
  phase = 'locked';
  calibratedPipelines.add('works');
  calibratedPipelines.add('deck');

  // Same licence the burn-in grants, on the same evidence: what the machine proved it could afford
  // over what the site was able to spend. ⚠ Read off the FIELD, because that is what the samples buy.
  const surplus = fieldSolved / newFieldRatio;
  if (surplus >= EXTRA_QUALITY_BURN_IN_SURPLUS) extraQualityEarned = true;

  if (telemetryEnabled) {
    const boundBy = (solved: number, low: number, high: number) =>
      solved > high ? 'its ceiling' : solved < low ? 'the floor' : 'the measurement';
    // The star has a third thing that can bind it, and reporting a capped star as "the measurement"
    // would hide the one number this line exists to expose.
    const starBoundBy =
      starSolved < starFloor
        ? 'the floor'
        : starSolved > starAllowance
          ? starAllowance < starCeil
            ? `the models (×${STAR_RAISE_OVER_MODELS})`
            : 'its ceiling'
          : 'the measurement';
    const starShare = ((budgetMs - fieldSpent) / budgetMs) * 100;
    console.log(
      `%c[pixels] ALLOCATED%c a ${budgetMs.toFixed(1)} ms frame ` +
        `(${PRIORITY_TARGET_FPS[RESOLUTION_PRIORITY]} fps), models first, each ratio less ` +
        `${(CALIBRATION_SAFETY_FRACTION * 100).toFixed(0)}% safety.` +
        `\n  measured   field ${fieldMilliseconds.toFixed(1)} ms @ ${fieldRatio.toFixed(2)}` +
        `  ·  star ${starMilliseconds.toFixed(1)} ms @ ${starRatio.toFixed(2)}` +
        ` (${((starMilliseconds / (fieldMilliseconds + starMilliseconds)) * 100).toFixed(0)}% of the frame)` +
        `\n  1 · reserved the star's floor          ${starFloorCost.toFixed(1)} ms` +
        `\n  2 · models  ${fieldFrom.toFixed(2)} → ${newFieldRatio.toFixed(2)}` +
        `  spending ${fieldSpent.toFixed(1)} ms, bound by ${boundBy(fieldSolved, floor, ceil)}` +
        `\n  3 · star    ${starFrom.toFixed(2)} → ${newStarRatio.toFixed(2)}` +
        `  from the ${remainingMs.toFixed(1)} ms left (${starShare.toFixed(0)}% of the budget),` +
        ` bound by ${starBoundBy}` +
        (starSolved > starAllowance
          ? `  (wanted ${starSolved.toFixed(2)})`
          : '') +
        `\n  ⚠ the star is budgeted at FULL rate; through services and works it draws at` +
        ` SUN_IDLE_STRIDE, so it actually spends half of this.` +
        `\n  ⚠ the star's ${starMilliseconds.toFixed(1)} ms is a LOWER BOUND — phase B runs before the` +
        ` assembly, so the corona is not drawn.` +
        `\n     Compare it against \`sun · bloom\` per call on the hero at the same ratio;` +
        ` the quotient is the bias. See STAR_RAISE_OVER_MODELS.` +
        `\n  surplus ${surplus.toFixed(2)}× — extras ` +
        `${extraQualityEarned ? 'EARNED' : `not earned (needs ${EXTRA_QUALITY_BURN_IN_SURPLUS}×)`}.`,
      'color:#5bd6a0;font-weight:700',
      'color:#888',
    );
  }
}

/**
 * The star's resolution.
 *
 * Until the allocator has run this is the shared ratio capped at the panel — byte-for-byte what
 * `SunModelCanvas` used to compute for itself, so a load where the split never arrives behaves
 * exactly as it did before.
 */
export function getSunPixelRatio(): number {
  ensureInitialised();
  return sunPixelRatio ?? Math.min(pixelRatio, MAX_PIXEL_RATIO);
}

/**
 * What the probe found this machine could afford, unclamped — or `null` if it never produced a
 * believable reading. A CAPABILITY figure, not a resolution.
 */
export function getProbedAffordableRatio(): number | null {
  return probedAffordableRatio;
}

/**
 * The most resolution the star may ever be given.
 *
 * The panel's own ceiling, same as the field's — but deliberately NOT `pixelBudgetCeil`, and that is
 * the one asymmetry worth naming. That budget exists because a full-viewport drawing buffer at a high
 * ratio is where render-target memory explodes (§`MAX_DRAWING_BUFFER_MEGAPIXELS`). The star's canvas is
 * ~0.21 Mpx of CSS pixels against the field's ~1.5, so even at 2× it is under a megapixel and the
 * budget has nothing to say about it. What bounds the star in practice is the measurement, which is
 * the intent — its cost is overdraw, not area.
 *
 * ── ⚠ A SECOND ASYMMETRY, WHICH WAS NOT INTENDED ─────────────────────────────────────────────────
 * This used to be `min(hardwareCeil, MAX_PIXEL_RATIO)` and omitted `deviceRatio`, which the field's
 * `ceil` includes. `hardwareCeil` is `min(2, max(deviceRatio, SUPERSAMPLE_CEIL))`, so on a **1×
 * panel** it is 1.5 — and the star could therefore be allocated 1.5 while the field was held to native
 * 1.0 by that same `deviceRatio` term. The star SUPERSAMPLED on the one class of machine least able to
 * afford it, and that is the regime the biased measurement above escapes into.
 *
 * So the star is capped at NATIVE, by the same term the field is capped by. On a 1× panel there is no
 * sharpness above native to win anyway — only supersample antialiasing, at 2.25× the pixels, on the
 * most overdraw-heavy surface on the site, against a field that stays at 1.0 and would then be visibly
 * softer than the thing composited over it.
 *
 * ⚠ Gating it on `SUPERSAMPLE_CEIL`'s *"only if PROBED able"* was tried here first and REJECTED, and
 * the reason is in this file's own header: the probe has an **eightfold spread across four loads of
 * the same page** (0.5 ms → 3.91, 7.5 ms → 1.01). A binary gate on a number that unstable supersamples
 * the star on some loads and not others, which is precisely the failure CLAUDE.md refuses for MSAA —
 * *"AA that differs between two loads of the same page is worse than not having it"* — and resolution
 * is more visible than AA. If the site ever wants to supersample the star, that should be a decision
 * written down, not an emergent property of a coin flip.
 *
 * The cost is real and narrow: a strong machine on a 1080p panel leaves some quality unspent. On a weak
 * one the same unspent budget becomes frame-rate headroom, which is the better outcome there.
 *
 * ⚠ Changes NOTHING on a dpr 2 or 2.5 panel, where both readings are 2. Only displays below
 * `SUPERSAMPLE_CEIL` are affected, which is the case it exists for.
 */
function sunCeiling(): number {
  return Math.max(floor, Math.min(hardwareCeil, MAX_PIXEL_RATIO, deviceRatioNative));
}

/** What is left after the resolution has taken its share. `1` means fully spent. */
export function getProbedSpareCapacity(): number | null {
  if (probedAffordableRatio === null || ceil <= 0) return null;
  return probedAffordableRatio / ceil;
}

/**
 * True once this machine has held `EXTRA_QUALITY_FPS` for long enough to mean it, at its settled
 * resolution — the only gate anything optional may be switched on behind. Latched: a licence, not a
 * live reading.
 */
export function hasEarnedExtraQuality(): boolean {
  return extraQualityEarned;
}

/**
 * The frame rate THIS CONTROLLER believes it is seeing, for cross-checking against a real measurement.
 *
 * Worth exposing because the two disagreeing is what hid the clamped-delta bug for so long: the frame
 * profiler reported 9–18 fps while this module was acting on a number pinned at its input's clamp. If
 * these two ever drift apart again, something is lying to `sampleFrame`.
 */
export function getControllerFps(): number {
  return 1 / emaFrameSeconds;
}

/** The current shared pixel ratio. Read once per frame; apply to renderer + composer when it moves. */
export function getPixelRatio(): number {
  ensureInitialised();
  return pixelRatio;
}

/**
 * Tell the controller that a scene has just re-allocated at a new ratio, so the frame carrying that
 * stall is not counted as evidence about the new ratio.
 *
 * Applying a ratio rebuilds a composer, its bloom pyramid and its ping-pong targets — the profiler
 * logs those as frames of 150–400 ms — and the very next frame is the first one sampled at the new
 * ratio. Counting it would charge the new resolution with the cost of switching to it.
 */
export function noteRatioApplied(): void {
  dropNextSample = true;
}

/**
 * Feed one real render frame time (seconds). Call only on frames a heavy scene actually drew, so idle
 * (gated-off) frames can't fake headroom.
 *
 * ⚠ Pass the RAW delta, never a clamped animation delta. `useWorksField` clamps at 0.05 s so a
 * tab-restore cannot fling the animation, and feeding that clamp here made this module unable to
 * perceive anything slower than 20 fps — on a section that runs at 9. See `FrameTimer.lastRawDelta`.
 */
export function sampleFrame(dtSeconds: number, pipeline: PipelineKey): void {
  ensureInitialised();
  if (dtSeconds <= 0 || dtSeconds > MAX_SANE_DT) return;
  // The reallocation's own stall — see `noteRatioApplied`.
  if (dropNextSample) {
    dropNextSample = false;
    return;
  }

  // ── A scene we have never measured has just taken over ──
  // Only one heavy scene draws at a time, so this is a handover rather than a clash. The incoming one
  // gets its own measurement, and the warm-up skip inside `calibrate` means the crossing that brought
  // it here is not what gets measured.
  if (pipeline !== activePipeline) {
    activePipeline = pipeline;
    if (phase === 'calibrating') {
      // ⚠ ANY handover restarts the window, not just one that arms it. Across the services→works
      // crossing BOTH scenes draw — the craft flies out over the field fading in — so the pipeline
      // alternates frame to frame. Without this, a window could complete on a mix of the two and be a
      // measurement of neither. Restarting means the window only ever closes on a settled section.
      resetCalibration();
    } else if (!calibratedPipelines.has(pipeline)) {
      phase = 'calibrating';
      resetCalibration();
    }
  }

  emaFrameSeconds += (dtSeconds - emaFrameSeconds) * EMA_ALPHA;
  const fps = 1 / emaFrameSeconds;

  // ── Extras, on top of whatever resolution we settled at ──
  if (!extraQualityEarned && phase === 'locked') {
    if (fps >= EXTRA_QUALITY_FPS) {
      extraQualityFor += dtSeconds;
      if (extraQualityFor >= EXTRA_QUALITY_SECONDS) {
        extraQualityEarned = true;
        logPixels(
          'EARNED EXTRA QUALITY',
          `held ${fps.toFixed(0)} fps at ratio ${pixelRatio.toFixed(2)} for ` +
            `${EXTRA_QUALITY_SECONDS}s — anything optional may now be switched on.`,
          true,
        );
      }
    } else {
      extraQualityFor = 0;
    }
  }

  if (phase === 'calibrating') {
    calibrate(dtSeconds);
    return;
  }
  if (phase === 'locked') watchForEmergency(dtSeconds, fps);
}

/**
 * Measure what this machine ACTUALLY sustains, solve the ratio from it, set it once, and stop.
 *
 * ⚠ Every sample that reaches here is already known to be at `pixelRatio`, because the scenes only
 * call `sampleFrame` on frames where their applied ratio equals the controller's. That is what makes
 * the solve valid without any extra bookkeeping about when the apply landed.
 */
function calibrate(dtSeconds: number): void {
  if (calibrationWarmupSeconds < CALIBRATION_WARMUP_SECONDS) {
    calibrationWarmupSeconds += dtSeconds;
    return;
  }
  if (calibrationFrames === 0) calibrationRatio = pixelRatio;

  calibrationSeconds += dtSeconds;
  calibrationMilliseconds += Math.min(dtSeconds * 1000, CALIBRATION_MAX_SAMPLE_MS);
  calibrationFrames += 1;
  if (calibrationSeconds < CALIBRATION_SECONDS) return;

  const measuredFrameMs = calibrationMilliseconds / calibrationFrames;
  // Same square law the probe uses, but against a REAL frame instead of one pipeline on a quiet stage.
  const sustainable = calibrationRatio * Math.sqrt(CALIBRATION_TARGET_FRAME_MS / measuredFrameMs);
  const solved = sustainable * (1 - CALIBRATION_SAFETY_FRACTION);
  const from = pixelRatio;

  // ⚠ `Math.min(pixelRatio, …)` on the SECOND scene: a measurement may only ever lower the settled
  // ratio, never raise it. The site has to be sized for its heaviest section, and a later scene
  // measuring faster than an earlier one means the earlier one was the constraint — not that we now
  // have room. Without this, reaching a light section would undo the cut the heavy one earned.
  const measured = Math.min(ceil, Math.max(floor, solved));
  pixelRatio = calibratedPipelines.size === 0 ? measured : Math.min(pixelRatio, measured);
  if (activePipeline) calibratedPipelines.add(activePipeline);
  phase = 'locked';

  if (telemetryEnabled) {
    const bound =
      solved > ceil ? 'the probe ceiling' : solved < floor ? 'the floor' : 'the measurement';
    console.log(
      `%c[pixels] CALIBRATED (${activePipeline})%c ${from.toFixed(2)} → ${pixelRatio.toFixed(2)}` +
        (calibratedPipelines.size < 2
          ? ` — holding here until the other scene is measured too.`
          : ` — both scenes measured, locked for the session.`) +
        `\n  priority "${RESOLUTION_PRIORITY}" → aiming for ${PRIORITY_TARGET_FPS[RESOLUTION_PRIORITY]} fps` +
        `\n  measured ${measuredFrameMs.toFixed(1)} ms/frame (${(1000 / measuredFrameMs).toFixed(0)} fps)` +
        ` at ratio ${calibrationRatio.toFixed(2)}, over ${calibrationFrames} frames` +
        `\n  sustains ${sustainable.toFixed(2)}, less ${(CALIBRATION_SAFETY_FRACTION * 100).toFixed(0)}%` +
        ` safety → ${solved.toFixed(2)}, bound by ${bound}` +
        `\n  floor ${floor.toFixed(2)}, ceiling ${ceil.toFixed(2)} — nothing steps from here unless the` +
        ` frame rate goes outside ${EMERGENCY_SLOW_FPS}–${EMERGENCY_FAST_FPS} fps for ${EMERGENCY_SETTLE_SECONDS}s.`,
      'color:#5bd6a0;font-weight:700',
      'color:#888',
    );
  }
}

/** The survival valve. See the constant block — it is meant to be hard to reach and impossible to loop. */
function watchForEmergency(dtSeconds: number, fps: number): void {
  if (emergencyMoves >= MAX_EMERGENCY_MOVES) return;
  const settleSeconds = Math.min(dtSeconds, SETTLE_SAMPLE_CAP_SECONDS);

  if (fps < EMERGENCY_SLOW_FPS) {
    emergencySlowFor += settleSeconds;
    emergencyFastFor = 0;
  } else if (fps > EMERGENCY_FAST_FPS) {
    emergencyFastFor += settleSeconds;
    emergencySlowFor = 0;
  } else {
    emergencySlowFor = 0;
    emergencyFastFor = 0;
    return;
  }

  const wantsDown = emergencySlowFor >= EMERGENCY_SETTLE_SECONDS && pixelRatio > floor;
  const wantsUp = emergencyFastFor >= EMERGENCY_SETTLE_SECONDS && pixelRatio < ceil;
  // ⚠ One direction per session. This is what makes a loop impossible rather than unlikely.
  if (wantsDown && emergencyDirection === 'up') return;
  if (wantsUp && emergencyDirection === 'down') return;
  if (!wantsDown && !wantsUp) return;

  const from = pixelRatio;
  const factor = wantsDown
    ? Math.sqrt(EMERGENCY_PIXEL_FACTOR)
    : Math.sqrt(1 / EMERGENCY_PIXEL_FACTOR);
  pixelRatio = Math.min(ceil, Math.max(floor, pixelRatio * factor));
  // ⚠ THE STAR MOVES WITH IT. Once the allocator has given the star its own number, this valve stops
  // being the whole picture: an emergency cut would otherwise halve the field's pixels while the star
  // — which the allocator may have handed a large share of the frame precisely because the machine
  // looked capable — carried on at full price. The valve exists for a machine that is drowning, and a
  // drowning machine has to be able to put down the heaviest thing it is holding.
  if (sunPixelRatio !== null) {
    sunPixelRatio = Math.min(sunCeiling(), Math.max(floor, sunPixelRatio * factor));
  }
  emergencyDirection = wantsDown ? 'down' : 'up';
  emergencyMoves += 1;
  emergencySlowFor = 0;
  emergencyFastFor = 0;
  extraQualityFor = 0;

  logPixels(
    wantsDown ? 'EMERGENCY CUT' : 'EMERGENCY RAISE',
    `${from.toFixed(2)} → ${pixelRatio.toFixed(2)} — ${fps.toFixed(0)} fps held for ` +
      `${EMERGENCY_SETTLE_SECONDS}s, well outside the calibrated range.` +
      `\n  ${emergencyMoves}/${MAX_EMERGENCY_MOVES} moves used; only "${emergencyDirection}" is` +
      ` permitted for the rest of the session.`,
    !wantsDown,
  );
}
