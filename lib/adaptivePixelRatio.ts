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
/**
 * The most the browser may be asked to blow the render up when it composites it.
 *
 * ⚠ THE FLOOR HAS TO BE RELATIVE TO THE PANEL, and `MIN_PIXEL_RATIO` alone is not. 0.75 is 75 % of a
 * 1× display's density — softer, but honest. On a dpr 2.5 laptop it is 30 %, which the compositor then
 * scales up 3.3×, and that is not "softer", that is smeared. The same constant means two completely
 * different pictures.
 *
 * It never mattered while the controller could not see below 20 fps, because nothing ever reached the
 * floor. The moment the clamped-delta bug was fixed, a real machine walked 1.68 → 1.48 → 1.28 → 1.08
 * → 0.88 → 0.75 in 28 seconds and sat there.
 *
 * Capping the upscale at 2× keeps the meaning constant across displays: dpr 2.5 floors at 1.25,
 * dpr 2 at 1.0, and dpr 1 still floors at 0.75 — so the sub-native move this module's header wanted
 * on weak 1× machines survives, and only the dense panels are protected from it.
 */
const MAX_COMPOSITE_UPSCALE = 2;
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
 * Cap on how much ONE frame may contribute to the settle clocks — not to the frame rate itself.
 *
 * ⚠ Needed the moment `sampleFrame` started receiving RAW deltas. `slowFor` is meant to mean
 * "sustained below SLOW_FPS for 0.8 s", and with a clamped input each frame added at most 0.05 s, so
 * it took sixteen of them. Raw, a single 429 ms frame — and the profiler logs plenty, most of them
 * OUR OWN composer reallocations — adds 0.429 s, so two frames trip a threshold that is supposed to
 * mean "this has been going on for a while". That turns a self-inflicted stall into a resolution cut,
 * which causes another reallocation, which is the beginning of a feedback loop.
 *
 * The frame RATE still uses the raw value, because that is the measurement and it must stay honest.
 * This only governs how fast a duration accumulates.
 */
const SETTLE_SAMPLE_CAP_SECONDS = 0.1;

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
 * ── Why saturating a machine is the wrong target ─────────────────────────────────────────────────
 * A frame rate is an average and the thing a visitor notices is the tail. A machine solved to land
 * *exactly* on budget is one that drops a frame every time anything varies — a garbage collection, a
 * texture upload, a heavier moment in the scroll — because it had nothing spare to absorb it. The same
 * machine given a little room holds its rate solidly. Sizing to the average and being surprised by the
 * tail is the classic version of this mistake.
 *
 * Three things this absorbs, and the probe can see none of them:
 *
 *   · everything outside the works pipeline — the sun's own canvas and bloom, the compositor, the
 *     blend layers. `PIPELINE_FRAME_BUDGET_MS` nominally leaves ~7.7 ms for these; on a 4K laptop that
 *     was out by roughly six times.
 *   · frame-to-frame variance, which is what actually reads as stutter.
 *   · thermal decay. A laptop's first minute is not its tenth, and the probe only ever sees the first.
 *
 * ⚠ EXPRESSED AGAINST COST, NOT AGAINST THE RATIO, and the difference is not small. Cost scales with
 * the SQUARE of the ratio, so trimming the ratio by 15 % would remove 28 % of the pixels — nearly
 * double the intended margin. Applying it here, to milliseconds, means 15 % is 15 %: the solve simply
 * targets 7.65 ms instead of 9.
 *
 * ⚠ Deliberately NOT applied to `MAX_DRAWING_BUFFER_MEGAPIXELS`. That cap is what actually binds on a
 * dense panel, and on a machine measured not to be fill-bound a margin there is quality given away for
 * nothing — with no way back, since `fillBound` only ever restores up to the ceiling.
 */
const SAFETY_HEADROOM_FRACTION = 0.15;
const SPENDABLE_FRAME_BUDGET_MS = PIPELINE_FRAME_BUDGET_MS * (1 - SAFETY_HEADROOM_FRACTION);

/**
 * How long a queued resolution change may wait for an idle frame before it is applied anyway.
 *
 * ── ⚠ THE DEADLOCK THIS EXISTS TO BREAK ──────────────────────────────────────────────────────────
 * Both heavy scenes only ever re-size while they are NOT being drawn, because reallocating a composer
 * stalls a frame and a stall hidden behind a running tween makes the motion jump. Sound on its own.
 * But `useWorksField` hosts the chamber AND the contact singularity, so `worksShouldRender` goes true
 * at the services→works handoff and is set false in exactly one place: `LOOP_RESET_EVENT`.
 *
 * The works field therefore has NO idle frame between works and the teleport — and while a change is
 * queued the scenes also stop sampling, so the controller goes deaf at the same moment it goes mute:
 *
 *     hero ─ services ─╫─ works ── chamber ── contact ─╫─ LOOP ─ hero
 *                      ║  drawing, uninterrupted       ║
 *        deck idles ✓  ║  step down decided at 1 s…    ║  …applied HERE, 40 s later
 *
 * That is the whole of the "I have to scroll all the way round and Travel in Time before it gets
 * smooth" report. It was not the site warming up; it was one queued `setSize` finally draining.
 *
 * So a change gets its idle frame if one comes along, and otherwise takes the hitch. One dropped
 * frame beats a lap at 27 fps, and the crossings are still excluded by the caller's own guards — this
 * grace period only ever elapses while a scene is being browsed at rest.
 */
export const RATIO_APPLY_GRACE_SECONDS = 1.5;

/**
 * Smallest frame worth believing, in megapixels (~224²).
 *
 * A section measured before its first resize is drawing into a 1×1 buffer, which is instant and says
 * nothing about the machine. `> 0` would let that through.
 */
const MIN_PROBE_MEGAPIXELS = 0.05;

/**
 * The most pixels the heavy scenes may ever be asked to draw into, whatever the ratio works out as.
 *
 * ⚠ THE RATIO IS NOT THE COST. THE PIXEL COUNT IS. Everything else in this module reasons in ratios,
 * and a ratio means nothing without a panel behind it:
 *
 *     ratio 1.5 on a 1080p panel     →  3.1 Mpx
 *     ratio 2.0 on a 4K laptop       →  5.3 Mpx      ← 70 % more work, from a smaller-looking number
 *
 * `hardwareCeil` is `min(2, max(devicePixelRatio, 1.5))`, so a dense panel RAISES the ceiling — which
 * is exactly backwards. A 4K screen is a reason to render at a lower ratio, not a licence to render at
 * a higher one, because the CSS viewport is small and every ratio point costs four times what it costs
 * on a 1× panel.
 *
 * This was found on a 4K laptop at 250 % scaling: dpr 2.5, a 1528 px CSS viewport, `affordable 3.87`
 * from the probe, ceiling clamped to 2.0 — and a 5.26 Mpx drawing buffer that put the render targets
 * over 700 MB and the frame rate at 20 fps. The probe was not wrong about the GPU. It was answering a
 * question about ratios while the machine was failing on pixels.
 *
 * 3 Mpx is a little over a 1080p frame at 1.2×, and it keeps the site's render targets near 290 MB —
 * roughly where an integrated GPU stops evicting. It is a ceiling, not a target: a small window on the
 * same machine still renders at whatever ratio the probe allows.
 */
const MAX_DRAWING_BUFFER_MEGAPIXELS = 3;

let initialised = false;
let ceil = 1;
let floor = MIN_PIXEL_RATIO; // lowest density we'll drop to
let softCeil = 1;           // dynamic cap ≤ ceil; lowered when a higher level proves too expensive, so
                            // the controller settles instead of oscillating in and out of it
let pixelRatio = 1;
/** The most this panel could ever justify — the probe's own upper bound. */
let hardwareCeil = 1;
/** This panel's own density, unclamped. What "native" means on this machine. */
let nativeRatio = 1;
/**
 * The ratio at which THIS viewport hits `MAX_DRAWING_BUFFER_MEGAPIXELS`.
 *
 * Kept because it is the one probe-derived limit that stays true when the frame turns out not to be
 * fill-bound: a memory cap is about how much VRAM the render targets take, which does not care why
 * the frame is slow. `affordable` — the frame-cost solve — is exactly the part that stops meaning
 * anything, so `releaseCeilingToNative` drops that and keeps this.
 */
let pixelBudgetCeil = Infinity;
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
 * ── ⚠ RESOLUTION IS ONLY A LEVER IF THE FRAME IS FILL-BOUND, AND OFTEN IT IS NOT ────────────────
 *
 * This controller's whole premise is that fewer pixels means more frames. That is true of a GPU
 * saturated by fill, and false of a frame dominated by JavaScript, draw-call submission, or the
 * compositor — and when it is false, every step down is quality given away for nothing.
 *
 * Measured on a 4K laptop, both steps taken within a few seconds of each other:
 *
 *     [pixels] STEPPED DOWN 1.00 → 0.80  (−36% pixels)  at ~32 fps
 *     [pixels] STEPPED DOWN 0.80 → 0.75  (−12% pixels)  at ~26 fps
 *
 * A third of the pixels gone and the frame rate got WORSE. The controller then sat at the floor for
 * the rest of the session, rendering at ~30 % of that panel's native density — which is what "the
 * ships look low quality now" actually was.
 *
 * So a step down is now a HYPOTHESIS, and it gets checked. If the frame rate does not answer within
 * `STEP_DOWN_VERDICT_SECONDS`, the pixels go back and this controller stops cutting them for the rest
 * of the session. It cannot fix a frame that is not fill-bound, and the honest thing to do about a
 * lever that does not work is to stop pulling it.
 *
 * A genuinely fill-bound machine sees the gain, keeps `fillBound` true, and behaves exactly as before.
 */
let fillBound = true;
/**
 * ── ⚠ THE VERDICT IS PER PIPELINE, because the two scenes are not the same experiment ────────────
 *
 * It was global and latched for a day, and the field log shows exactly what that costs. The verdict
 * was reached at 31.6 s while the FLEET was on screen — a scene the frame rate genuinely does not
 * follow pixel count on — and it then bound the works field, which started eight seconds later and
 * whose bloom pyramid is the heaviest fill on the site:
 *
 *     31.6s  GAVE BACK 1.13 → 1.68  — cutting 54% changed nothing (32 → 31 fps)   ← measured on DECK
 *     39.4s  works · space 4.29 ms …                                              ← works arrives
 *     66.7s  works · space 39.06 ms, 12 fps                                        ← and cannot cut
 *
 * One scene proving resolution is not its lever says nothing about the other, and a controller that
 * has been told to stop pulling the only lever it has is worse than one that never had it.
 */
type PipelineKey = 'deck' | 'works';
const fillBoundByPipeline = new Map<PipelineKey, boolean>();
let activePipeline: PipelineKey | null = null;
let awaitingStepDownVerdict = false;
/** Set by `noteRatioApplied` — the next sample carries a reallocation stall and must be discarded. */
let dropNextSample = false;
let lastStepDownAt = -Infinity;
/** Real time the current trial began — the only clock that keeps running when sampling stops. */
let stepDownStartedAtMs = 0;
/** A cut has been decided but the scene has not re-allocated yet, so the trial has not begun. */
let stepDownAwaitingApply = false;
/** Consecutive cuts that were never measured. See MAX_UNVERIFIED_STEP_DOWNS. */
let unverifiedStepDowns = 0;
let fpsBeforeStepDown = 0;
/** Long enough for the EMA to have absorbed the new resolution, short enough to not sit ugly. */
const STEP_DOWN_VERDICT_SECONDS = 1.5;
/**
 * Wall-clock limit on a step-down trial. Past this the experiment is ABANDONED, not decided.
 *
 * ⚠ `STEP_DOWN_VERDICT_SECONDS` is counted in `elapsed`, which only advances while frames are being
 * sampled — and sampling stops during both crossings, during a portal swap, and for as long as a
 * ratio change is queued. On a site whose every section is a scrubbed cinematic that is most of the
 * time, so a "1.5 second" trial was measured taking twelve to fifteen seconds of real time:
 *
 *     27.4s  STEPPED DOWN 1.60 → 1.40 at ~30 fps      deck: 9 draws, 5.96 ms
 *     39.7s  GAVE BACK — "changed nothing (30 → 23)"  deck: 21 draws, 11.77 ms
 *
 * Those are not the same scene. The frame rate fell because the content got heavier, and the verdict
 * charged it to the resolution — then retired the controller's only lever on the strength of it.
 *
 * An experiment that could not be run cleanly has no result. Abandoning keeps the cut and leaves
 * `fillBound` alone, so the next step down gets a fresh trial; concluding from it is how we got two
 * days of confidently wrong answers.
 */
const STEP_DOWN_TRIAL_ABANDON_MS = 6000;
/**
 * How many cuts may be made without a single one being measured, before the controller stops.
 *
 * ⚠ THIS IS THE STOP. An abandoned trial used to mean "conclude nothing and carry on", which sounds
 * cautious and is not: it is permission to keep cutting forever on no evidence. Observed doing exactly
 * that — five steps to the floor in 28 seconds, every trial abandoned, not one measurement taken:
 *
 *     26.0s  STEPPED DOWN 1.68 → 1.48      31.6s  trial abandoned
 *     32.6s  STEPPED DOWN 1.48 → 1.28      39.8s  trial abandoned
 *     40.6s  STEPPED DOWN 1.28 → 1.08
 *     48.6s  STEPPED DOWN 1.08 → 0.88      52.9s  trial abandoned
 *     53.8s  STEPPED DOWN 0.88 → 0.75      61.8s  trial abandoned
 *
 * Two blind cuts is a reasonable amount of benefit of the doubt. After that the controller holds
 * until some trial actually completes, and a completed verdict — either way — resets the count.
 */
const MAX_UNVERIFIED_STEP_DOWNS = 2;
/** The frame rate has to improve by at least this much for the pixels to have been worth giving up. */
const STEP_DOWN_MIN_GAIN = 1.08;

/**
 * ── Extras are bought with OBSERVED frame rate, at full resolution, or not at all ────────────────
 *
 * The rule, stated by the person who has to look at it: *quality over MSAA — we can have MSAA if the
 * frame rate is above 50 at high quality.* Both halves matter and the second is the one that keeps
 * getting lost.
 *
 * The probe cannot answer this. It times one pipeline on a quiet stage before the site exists, and its
 * spread on a single machine was ninefold (see `gpuProbe`). Worse, spending its number on samples is
 * how the resolution came to be traded away for MSAA twice in one day — first against the raw ratio,
 * then against a "spare capacity" that turned out to be what the memory cap was withholding.
 *
 * Sustained frame rate has none of those problems. It is the real thing, measured on the real site, at
 * the real resolution, over seconds rather than one draw.
 *
 * ⚠ `pixelRatio >= fullQualityRatio` is the "at high quality" half, and it is not optional. A machine
 * holding 55 fps because it has already given up a third of its pixels has not earned anything — it is
 * coping. Extras are only ever bought on top of full quality, never instead of it.
 *
 * ⚠ And "full quality" stops at NATIVE. Since the landing was split there (see
 * `reportProbedFrameCost`), above-native is itself an extra — so gating this on the supersampled
 * ceiling would make one extra the entry fee for another, and on a 1× panel with probed headroom
 * MSAA could never be earned without first climbing to 1.5. A machine whose measured ceiling is
 * BELOW native still has to reach that ceiling.
 */
const EXTRA_QUALITY_FPS = 50;
/** Long enough that a quiet stretch between sections cannot pass for headroom. */
const EXTRA_QUALITY_SECONDS = 4;
let extraQualityFor = 0;
let extraQualityEarned = false;

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

/**
 * Retire the probe's frame-cost ceiling and go back to this panel's own density.
 *
 * Called once, when a step down has been measured to change nothing. Both remaining bounds are still
 * honoured: `hardwareCeil` because a panel cannot show more than it has, and `pixelBudgetCeil`
 * because the render targets still have to fit in VRAM — a memory limit does not stop being true
 * just because the bottleneck turned out to be elsewhere.
 */
function releaseCeilingToNative(): void {
  // ⚠ An UNPROBED session has no `pixelBudgetCeil`: that number is derived from the area the probe
  // reported, so without it this function has no idea how many megapixels "native" implies and would
  // release straight past `MAX_DRAWING_BUFFER_MEGAPIXELS`. On a dpr 2.5 panel that is 4.27 Mpx against
  // a 3 Mpx budget — the exact failure the buffer budget exists to prevent, arrived at from the other
  // direction. Unmeasured falls back to this module's own unmeasured default, which is native-or-1.
  const target = probed ? nativeRatio : Math.min(nativeRatio, 1);
  ceil = Math.max(floor, Math.min(hardwareCeil, pixelBudgetCeil, target));
  softCeil = ceil;
  pixelRatio = ceil;
}

function ensureInitialised(): void {
  if (initialised) return;
  initialised = true;
  const deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  nativeRatio = deviceRatio;
  // The most this panel could ever justify: its own density, or a little super-sampling on a 1× panel
  // — but ONLY as a bound the probe is allowed to reach, never as a starting assumption.
  hardwareCeil = Math.min(MAX_PIXEL_RATIO, Math.max(deviceRatio, SUPERSAMPLE_CEIL));
  floor = Math.max(MIN_PIXEL_RATIO, deviceRatio / MAX_COMPOSITE_UPSCALE);
  // Until something is measured, native is the answer. Rendering above native is a real cost paid for
  // a subtle gain and nothing yet says this machine can afford it; rendering below it is a real
  // quality loss and nothing yet says it is needed.
  //
  // Floored as well as capped, so `floor <= ceil` holds even on a browser zoomed far enough out to
  // report a device ratio under the floor — otherwise the controller would have a range it cannot sit in.
  ceil = Math.max(floor, Math.min(MAX_PIXEL_RATIO, deviceRatio));
  softCeil = ceil;
  // Native-by-default, but never under the floor — on a dense panel the floor is now above 1.
  pixelRatio = Math.min(ceil, Math.max(floor, 1));
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
  const affordable = probeRatio * Math.sqrt(SPENDABLE_FRAME_BUDGET_MS / believableMilliseconds);
  probedAffordableRatio = affordable;

  // ── The pixel ceiling, which no ratio can express ──
  // The probe reports the area it drew AND the ratio it drew at, so the CSS-pixel area falls out —
  // and from that, the ratio at which this particular viewport hits the buffer budget. On a 4K panel
  // that lands well below `hardwareCeil`; on a 1080p one it never binds at all.
  const cssMegapixels = megapixels / (probeRatio * probeRatio);
  const pixelBudgetRatio = Math.sqrt(MAX_DRAWING_BUFFER_MEGAPIXELS / cssMegapixels);
  pixelBudgetCeil = pixelBudgetRatio;

  ceil = Math.max(floor, Math.min(hardwareCeil, pixelBudgetRatio, affordable));
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
        `at ratio ${probeRatio} → affordable ${affordable.toFixed(2)}, ceiling ${ceil.toFixed(2)}` +
        `
  solved against ${SPENDABLE_FRAME_BUDGET_MS.toFixed(2)} ms of a ${PIPELINE_FRAME_BUDGET_MS} ms budget` +
        ` (${(SAFETY_HEADROOM_FRACTION * 100).toFixed(0)}% held back)` +
        `\n  bound by ${
          ceil === floor
            ? 'the floor'
            : pixelBudgetRatio < Math.min(hardwareCeil, affordable)
              ? `the ${MAX_DRAWING_BUFFER_MEGAPIXELS} Mpx buffer budget (this viewport hits it at ${pixelBudgetRatio.toFixed(2)})`
              : hardwareCeil < affordable
                ? `the panel (hardware max ${hardwareCeil})`
                : 'the measurement'
        }` +
        `\n  drawing buffer at the ceiling: ${(cssMegapixels * ceil * ceil).toFixed(2)} Mpx` +
        ` (floor ${floor}, hardware max ${hardwareCeil})`,
    );
  }
  // ── ⚠ NEVER START ABOVE NATIVE. The ceiling is a CAP, not a destination. ────────────────────────
  //
  // This was `pixelRatio = ceil` — land on the measurement rather than climb to it — justified on the
  // grounds that a step-up reallocates every composer and paying that stall to reach a level we had
  // just MEASURED as affordable was a stall for nothing.
  //
  // The measurement is not that good, and every log said so. The probe times ONE works-field frame on
  // a quiet stage; the real frame also carries the sun's own canvas and bloom, the compositor, and the
  // blend layers over the top. `PIPELINE_FRAME_BUDGET_MS` assumes all of that fits in the ~7.7 ms it
  // leaves spare, and on a 4K laptop it was out by roughly six times. So landing on the ceiling meant
  // the controller walked it straight back down, on essentially every load:
  //
  //     gpu probe: 0.6 ms → affordable 3.87, ceiling 2.00
  //     [pixels] STEPPED DOWN 2.00 → 1.80 at ~20 fps
  //     [pixels] STEPPED DOWN 1.80 → 1.60 at ~22 fps
  //
  // Which is precisely what this module's own header says does not work — *"the claw-back only happens
  // after the expensive configuration has already been allocated on the machine that could not afford
  // it"*. Landing on an optimistic number IS guessing upward; it just has a number attached.
  //
  // So: start at native or at the ceiling, whichever is LOWER, and let the live controller climb into
  // anything above it. The reallocation the old comment wanted to avoid happens either way — the
  // difference is its direction. Climbing reads as the site sharpening; walking down reads as it
  // giving up, which is the thing that was actually being reported.
  //
  // ── …and then it was put BACK, once the verdict existed ──
  //
  // Starting at native was a workaround for having no way to tell whether a step down helped. It cost
  // real quality to buy that safety: on a dpr-2.5 panel, 1.0 is ~40 % of the panel's density, and the
  // site visibly opened softer than it had the day before. Reported as exactly that.
  //
  // `fillBound` is the proper fix. A cut is now a hypothesis that gets checked, and a machine that
  // cannot convert pixels into frames takes ONE step and gets them back. With that in place, landing on
  // the ceiling is safe again — and it is the better default, because on the machines where the probe
  // IS right (which is most of them) it arrives at full quality immediately instead of spending four
  // seconds climbing into it.
  //
  // ⚠ A machine measured as NOT capable still starts below native. `ceil` carries that; nothing here
  // raises it.
  //
  // ── …and then the landing was split AT NATIVE, because the ceiling's two halves mean different
  //    things ──
  //
  // The verdict makes landing on a wrong ceiling SURVIVABLE; a cold run on the Vercel preview showed
  // it does not make it cheap. A dpr-1 laptop probed 2.2 ms on the loader's quiet stage → ceiling
  // 1.50, opened at 2.25× native pixels, and spent the entire services section paying the guess
  // back: the EMA had to converge down from 60 before the first cut could even fire, the first trial
  // was abandoned (sampling kept pausing), and the verdict that finally freed it compared 41 → 17
  // fps across the services→works handoff — the crossing arriving, not the cut failing. Four
  // reallocations and ~30 s at 27–39 fps, to arrive at NATIVE — exactly where it could have started.
  //
  //   · At or below native, the ceiling is a measured INABILITY. Land on it, exactly as before — a
  //     machine that measured unable to hold native must not open above what it can afford, and
  //     `fillBound` remains the check on that measurement being pessimistic.
  //   · Above native, the ceiling is measured HEADROOM for a subtle gain. Supersampling is an
  //     EXTRA, and extras on this site are bought with OBSERVED frame rate (see EXTRA_QUALITY_FPS),
  //     never with the probe's one quiet-stage frame — the frame that carries neither the sun's
  //     bloom nor the compositor. The step-up path is the purchase: sustained > FAST_FPS at the real
  //     workload climbs into the headroom one checked step at a time, and a climb that never happens
  //     is a grant the machine could not afford.
  pixelRatio = Math.max(floor, Math.min(ceil, nativeRatio));
}

/**
 * Tell the controller that a scene has just re-allocated at a new ratio, so the frame carrying that
 * stall is not counted as evidence about the new ratio.
 *
 * ⚠ Without this the controller marks its own homework with the cost of doing the work. Applying a
 * ratio rebuilds a composer, its bloom pyramid and its ping-pong targets — the profiler logs those as
 * frames of 150–400 ms — and the very next frame is the first one sampled at the new ratio. So a step
 * DOWN is immediately followed by the worst frame in the window, which pushes the frame rate the wrong
 * way at precisely the moment `STEP_DOWN_MIN_GAIN` is about to ask whether the cut helped. The cut
 * then reads as useless, `fillBound` goes false, and the controller retires the only lever it has.
 */
export function noteRatioApplied(): void {
  dropNextSample = true;

  // ⚠ THE TRIAL STARTS HERE, not at the decision — this is the fix for every trial being abandoned.
  // A cut is decided, and then the scene waits for an idle frame or up to RATIO_APPLY_GRACE_SECONDS
  // before it re-allocates; sampling is off for all of that. Starting the clock at the decision meant
  // the trial spent its first 1.5 s unable to measure anything, needed 1.5 s of sampling after that,
  // and blew its wall-clock budget on nearly every attempt. Anchored to the apply, the whole budget
  // is available for the measurement it exists to take.
  if (stepDownAwaitingApply) {
    stepDownAwaitingApply = false;
    lastStepDownAt = elapsed;
    stepDownStartedAtMs = performance.now();
  }
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
 * spent the instant it arrives: `reportProbedFrameCost` lands on the ceiling it solves (capped at
 * native since the landing split — a 2× panel that measured 1.32 is immediately rendering at 1.32)
 * and has nothing spare. Comparing an extra against the raw number therefore spends the same
 * headroom twice.
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

/**
 * True once this machine has held `EXTRA_QUALITY_FPS` at its full resolution for long enough to mean
 * it — the only gate anything optional may be switched on behind.
 *
 * Latched: it is a licence, not a live reading. Something that allocated on the strength of it must
 * not be torn down again the moment a scroll dips the frame rate, because the tearing down is itself
 * a stall. If conditions genuinely worsen, the resolution controller is what responds.
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
 * Feed one real render frame time (seconds). Call only on frames a heavy scene actually drew, so idle
 * (gated-off) frames can't trick the controller into ramping the resolution up.
 */
export function sampleFrame(dtSeconds: number, pipeline: PipelineKey): void {
  ensureInitialised();
  if (dtSeconds <= 0 || dtSeconds > MAX_SANE_DT) return;
  // The reallocation's own stall — see `noteRatioApplied`.
  if (dropNextSample) {
    dropNextSample = false;
    return;
  }

  // ── Whose frame is this? ──
  // Only one heavy scene ever draws at a time, so a change here is a handover rather than a clash.
  // The incoming pipeline gets its OWN verdict — untested means `true`, i.e. allowed to try cutting —
  // and the settle clocks restart so a run-up measured on the outgoing scene cannot trip a decision
  // about the incoming one.
  if (pipeline !== activePipeline) {
    activePipeline = pipeline;
    fillBound = fillBoundByPipeline.get(pipeline) ?? true;
    slowFor = 0;
    fastFor = 0;
    awaitingStepDownVerdict = false;
    // ⚠ A pipeline already judged not fill-bound wants its pixels BACK on arrival. `fillBound: false`
    // blocks stepping up as well as down, so without this a scene that had been released to native
    // would inherit whatever the OTHER scene cut its way down to and have no way to climb out of it.
    if (!fillBound) releaseCeilingToNative();
  }

  elapsed += dtSeconds;
  emaFrameSeconds += (dtSeconds - emaFrameSeconds) * EMA_ALPHA;
  const fps = 1 / emaFrameSeconds;

  // See SETTLE_SAMPLE_CAP_SECONDS — the rate above is raw, the durations below are capped.
  const settleSeconds = Math.min(dtSeconds, SETTLE_SAMPLE_CAP_SECONDS);

  if (fps < SLOW_FPS) {
    slowFor += settleSeconds;
    fastFor = 0;
  } else if (fps > FAST_FPS) {
    fastFor += settleSeconds;
    slowFor = 0;
  } else {
    slowFor = 0;
    fastFor = 0;
  }

  const effectiveCeil = Math.min(ceil, softCeil);
  // "Full quality" for the extras gate — native, or the measured ceiling where that is lower. See
  // the ⚠ note above EXTRA_QUALITY_FPS for why it is NOT the supersampled ceiling.
  const fullQualityRatio = Math.min(effectiveCeil, nativeRatio);

  // ── Has this machine earned an extra, on top of full quality? ──
  if (!extraQualityEarned) {
    if (fps >= EXTRA_QUALITY_FPS && pixelRatio >= fullQualityRatio) {
      extraQualityFor += dtSeconds;
      if (extraQualityFor >= EXTRA_QUALITY_SECONDS) {
        extraQualityEarned = true;
        if (telemetryEnabled) {
          console.log(
            `%c[pixels] EARNED EXTRA QUALITY%c held ${fps.toFixed(0)} fps at ratio ` +
              `${pixelRatio.toFixed(2)} (full quality) for ${EXTRA_QUALITY_SECONDS}s` +
              `\n  anything optional may now be switched on — the resolution is already paid for.`,
            'color:#5bd6a0;font-weight:700',
            'color:#888',
          );
        }
      }
    } else {
      // Any dip, or any resolution given up, and the clock restarts. This has to mean SUSTAINED.
      extraQualityFor = 0;
    }
  }

  // ── The trial drifted across a section change: no result, rather than a wrong one ──
  if (
    awaitingStepDownVerdict &&
    performance.now() - stepDownStartedAtMs > STEP_DOWN_TRIAL_ABANDON_MS
  ) {
    awaitingStepDownVerdict = false;
    // Also covers the never-applied case: a stray apply later must not resurrect a dead trial.
    stepDownAwaitingApply = false;
    unverifiedStepDowns += 1;
    // ⚠ And make the NEXT cut earn its own evidence. `slowFor` has been accumulating throughout the
    // abandoned trial, so leaving it charged means the following step down fires on the very next
    // frame — cuts would chain every four seconds with nothing ever measured, straight to the floor.
    slowFor = 0;
    if (telemetryEnabled) {
      console.log(
        `%c[pixels] trial abandoned%c — the step down to ${pixelRatio.toFixed(2)} could not be judged` +
          ` within ${STEP_DOWN_TRIAL_ABANDON_MS / 1000}s of real time (sampling kept pausing).` +
          `\n  Keeping the cut, concluding nothing — ${unverifiedStepDowns}/${MAX_UNVERIFIED_STEP_DOWNS}` +
          ` unmeasured cuts` +
          (unverifiedStepDowns >= MAX_UNVERIFIED_STEP_DOWNS
            ? `. HOLDING HERE until a trial completes.`
            : `.`),
        'color:#e0b341;font-weight:700',
        'color:#888',
      );
    }
  }

  // ── Did the last step down actually buy anything? ──
  // If it did not, this frame is not fill-bound and every pixel given up from here is pure loss.
  if (
    awaitingStepDownVerdict &&
    !stepDownAwaitingApply &&
    elapsed - lastStepDownAt >= STEP_DOWN_VERDICT_SECONDS
  ) {
    awaitingStepDownVerdict = false;
    // A real measurement, whichever way it went — the benefit of the doubt is restored.
    unverifiedStepDowns = 0;
    if (fps < fpsBeforeStepDown * STEP_DOWN_MIN_GAIN) {
      fillBound = false;
      if (activePipeline) fillBoundByPipeline.set(activePipeline, false);
      const from = pixelRatio;
      // ── ⚠ ALL of them back, not one step ─────────────────────────────────────────────────────
      //
      // This used to hand back a single STEP and stop, which left the session pinned at whatever
      // `ceil` the probe had produced — and the probe is the thing that has just been shown not to
      // describe this frame. Measured on a dpr 2.5 panel across two loads of the SAME page:
      //
      //     load 1:  gpu probe 2.3 ms → affordable 1.82, ceiling 1.68
      //     load 2:  gpu probe 7.5 ms → affordable 1.01, ceiling 1.01
      //
      // A 3.3× spread, because the probe runs seconds after `buildField` has burned the CPU cutting
      // four marks and the median of three consecutive drains is three samples of the same
      // disturbance. On the unlucky load the whole session then rendered at ~40 % of the panel's
      // density — reported, correctly, as "the quality is low now" — while the frame rate sat at 30
      // either way. Thirty at 1.01 and thirty at 0.81 is the site's own proof that none of it bought
      // anything.
      //
      // So when the lever is measured not to work, the pixels go back to NATIVE, and the only limits
      // kept are the ones that stay true regardless of why the frame is slow: the panel's own density
      // and the drawing-buffer memory budget. `affordable` is dropped, because it is a frame-cost
      // solve and frame cost has just been shown not to follow pixel count here.
      //
      // ⚠ Native, NOT `hardwareCeil`. Not-fill-bound is not a licence to supersample — it means stop
      // paying for a reduction that buys nothing. A 1× panel goes back to 1.0, not to 1.5.
      releaseCeilingToNative();
      logRatioChange(
        'GAVE BACK',
        from,
        fps,
        ` — cutting ${((1 - (from * from) / (pixelRatio * pixelRatio)) * 100).toFixed(0)}% of the` +
          ` pixels changed nothing (${fpsBeforeStepDown.toFixed(0)} → ${fps.toFixed(0)} fps).` +
          `\n  This frame is not fill-bound; resolution is not the lever, so the probe's ceiling is` +
          ` retired and the pixels go back to native. Holding here.`,
      );
      slowFor = 0;
      fastFor = 0;
    } else if (activePipeline) {
      // The cut DID buy frames — this pipeline is fill-bound, and resolution is a lever for it.
      fillBoundByPipeline.set(activePipeline, true);
    }
  }

  // ⚠ `!awaitingStepDownVerdict` — ONE step at a time while a cut is on trial.
  //
  // Without it the controller reached the floor before it ever learned the lever does not work:
  // `SETTLE_DOWN_SECONDS` (0.8) is shorter than `STEP_DOWN_VERDICT_SECONDS` (1.5), so the second cut
  // fired first and reset the verdict clock onto itself. The measured result was 1.00 → 0.80 → 0.75
  // with no verdict in between — every pixel given away, then judged.
  //
  // Now a cut is a single hypothesis: take one step, wait for the frame rate to answer, and either
  // continue or put it back. At most one step of quality is ever on trial.
  if (
    fillBound &&
    !awaitingStepDownVerdict &&
    // ⚠ The stop. Two cuts on faith is the limit; see MAX_UNVERIFIED_STEP_DOWNS for the run to the
    // floor this prevents.
    unverifiedStepDowns < MAX_UNVERIFIED_STEP_DOWNS &&
    slowFor >= SETTLE_DOWN_SECONDS &&
    pixelRatio > floor
  ) {
    // A drop this soon after a step-up means that higher level was too expensive — cap below it so we
    // don't climb straight back into it. This turns endless oscillation into a single detect-and-settle.
    const recap = elapsed - lastStepUpAt < RECENT_STEP_UP_SECONDS;
    if (recap) {
      softCeil = Math.max(floor, pixelRatio - STEP);
    }
    const from = pixelRatio;
    pixelRatio = Math.max(floor, pixelRatio - STEP);
    logRatioChange('STEPPED DOWN', from, fps, recap ? ` — and capped here (that level cost too much)` : '');
    // Watch this one. If the frame rate does not answer, the next block puts the pixels back.
    // ⚠ Set here as a DEADLINE and reset by `noteRatioApplied` as a START. If the scene applies
    // promptly the trial gets its full budget from that moment; if it somehow never applies at all,
    // this is what eventually retires the trial instead of leaving the controller waiting forever on
    // a verdict that can no longer come — which would silently stop it adapting for the session.
    stepDownStartedAtMs = performance.now();
    fpsBeforeStepDown = fps;
    awaitingStepDownVerdict = true;
    stepDownAwaitingApply = true;
    slowFor = 0;
    fastFor = 0;
  } else if (fillBound && fastFor >= SETTLE_UP_SECONDS && pixelRatio < effectiveCeil) {
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
