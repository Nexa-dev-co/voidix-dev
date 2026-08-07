import { telemetryEnabled } from '@/lib/telemetryEnabled';

/**
 * ONE render cadence for the whole page: the site draws at a fixed rate, and this decides which
 * animation-frame ticks are draw ticks.
 *
 * ── Why a fixed cadence at all ───────────────────────────────────────────────────────────────────
 * Measured on one dpr 2.5 laptop, one lap, at a settled resolution: hero 42 fps, fleet 35, works 32,
 * chamber 43, contact 49 — and the hero alone ramped 21 → 44 over its first thirty seconds while the
 * star's own cost never moved. Every one of those numbers is "fine". Together they are a site whose
 * motion changes character at every section boundary, which on a scrubbed cinematic reads as the
 * machine struggling rather than as the work being authored.
 *
 * A rate that is the SAME everywhere is worth more here than a rate that is occasionally higher.
 * Nothing on this site is timed in frames — the crossings are pure functions of scroll progress and
 * the idle motion is delta-timed — so drawing less often changes how often the picture is sampled and
 * changes nothing about where anything is or how fast it moves.
 *
 * The cadence is also a budget. Capping delivery frees whatever the machine was spending above it, and
 * `adaptivePixelRatio` spends that on resolution instead, which is the trade CLAUDE.md already calls
 * the priority.
 *
 * ── ⚠ ONE CLOCK, NOT THREE ───────────────────────────────────────────────────────────────────────
 * There are three heavy render loops on this page (the sun, the fleet, the works field) and each runs
 * its own `requestAnimationFrame`. If each did its own `% 2` they would land on DIFFERENT ticks: some
 * frames would carry one scene, some would carry three, and the frame cost would come out lumpier than
 * no cap at all. That is the opposite of the point.
 *
 * They are kept in phase without a scheduler, and the trick is worth naming because it looks like a
 * coincidence: **every animation-frame callback scheduled for the same tick receives the identical
 * `timestamp` argument.** So the decision is memoised on that timestamp — the first loop to ask
 * computes it, the other two get the same answer for free, and it does not matter which order they
 * registered in or how many of them are currently mounted.
 *
 * ⚠ THAT IS WHY CALLERS MUST PASS THE ANIMATION-FRAME TIMESTAMP and never `performance.now()`. Two
 * loops passing their own clock reading would each get a fresh decision, each advance the counter, and
 * the phase would be nonsense within a second.
 *
 * ── ⚠ EXACTLY 30 IS A PROPERTY OF THE DISPLAY, NOT A CHOICE ──────────────────────────────────────
 * Frames arrive on the panel's refresh. An even cadence therefore means drawing every Nth tick for
 * INTEGER N, and 30 only divides some panels:
 *
 *     60 Hz → every 2nd → 30.0        120 Hz → every 4th → 30.0       240 Hz → every 8th → 30.0
 *     90 Hz → every 3rd → 30.0        144 Hz → every 5th → 28.8       165 Hz → every 6th → 27.5
 *
 * A wall-clock 33.3 ms accumulator would average 30.0 on a 144 Hz panel by alternating 4- and 5-tick
 * gaps — a 4 ms wobble on every frame, which is judder, and judder is the thing the fixed cadence
 * exists to remove. A steady 28.8 is visibly smoother than a jittery 30.0, and because nothing here is
 * frame-timed the 1.2 fps costs nothing but the number. Integer stride, always.
 *
 * `Math.ceil` rather than `Math.round` so the cadence is never FASTER than the target — under, never
 * over, which is what "not more than 30" has to mean on a panel that cannot divide it.
 *
 * ── ⚠ THE STRIDE IS DERIVED FROM THE VBLANK, AND THE VBLANK IS THE FLOOR OF THE DELTAS ───────────
 * The obvious reading — median tick delta — is wrong on exactly the machines this matters for. A
 * 60 Hz panel that is GPU-bound at 45 fps delivers a MIX of 16.7 ms and 33.3 ms gaps, and its median
 * is ~22 ms, which reads as a 45 Hz display and sets a stride that would deliver 22.5 fps. The panel
 * did not change; the site was just slow.
 *
 * Vsync-locked deltas are always integer multiples of one vblank, so the SHORTEST gaps are the vblank
 * and the long ones are missed frames. A low percentile reads the hardware; the median reads the load.
 *
 * The happy consequence is that a machine which genuinely cannot reach 30 detects a low refresh, lands
 * on stride 1, and is never capped at all — the cap can only ever take away frames a machine had
 * spare. And as `adaptivePixelRatio` spends its quality down and the machine speeds up, the percentile
 * falls and the stride rises on its own.
 */

/**
 * The cadence the site is authored to deliver, everywhere, on every machine.
 *
 * ⚠ This is a CEILING that the resolution controller also treats as a TARGET, and both halves are
 * needed. Capping alone gives "never more than 30" on a fast machine and says nothing about a slow
 * one; `adaptivePixelRatio` reads `getCadencePeriodMilliseconds()` and spends resolution down until
 * the frame fits inside it, which is the only mechanism that can move a slow machine UP toward 30.
 */
export const TARGET_FRAME_RATE = 30;

/**
 * Refresh rates a real panel actually runs at.
 *
 * A measured vblank is never exactly 1000/60 — it is 16.68, or 16.61, or whatever the compositor's
 * clock drifted to — and `1000 / 16.61` is 60.2, which would snap a hair over any threshold expressed
 * in raw hertz. Snapping to the nearest real refresh first means the stride is derived from an
 * integer, so it cannot flicker between two values because a delta moved by a tenth of a millisecond.
 */
const KNOWN_REFRESH_RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 200, 240, 360];

/** How far a reading may sit from a known refresh and still be called that refresh. */
const REFRESH_SNAP_TOLERANCE = 0.06;

/** Ticks kept for the vblank estimate. Half a second at 60 Hz — long enough to hold several gaps. */
const TICK_WINDOW = 30;

/**
 * Ticks required before this module is willing to cap anything.
 *
 * ⚠ Sized for the LOADER, which is where a wrong answer would be latched. On a warm cache the whole
 * load compresses into a couple of seconds of saturated main thread — measured there, single frames
 * take 850 ms — and a stride derived from that would be 1 (correct, as it happens) but derived from
 * nothing. Until the window is full the site runs uncapped, which is also exactly what the loader's
 * burn-in needs, since it must measure this machine's true uncapped cost.
 */
const MIN_TICKS_BEFORE_CAPPING = 20;

/** A gap this long is a tab-restore or a debugger pause, not a frame. It invalidates the window. */
const MAX_SANE_TICK_MS = 200;

/** Where in the sorted deltas the vblank is read from. See the header — low, not middle. */
const VBLANK_PERCENTILE = 0.15;

/**
 * Consecutive evaluations a new stride must survive before it is adopted.
 *
 * Changing stride changes the cadence, and a cadence that changes is the judder this module exists to
 * remove — so a genuine event (the window dragged to a second monitor with a different refresh, a
 * laptop panel dropping to a power-saving refresh) is allowed through in about a fifth of a second,
 * and a burst of slow frames is not allowed through at all.
 */
const STRIDE_CHANGE_CONFIRMATIONS = 12;

/** How far past its due time a draw may land before it counts as missed. */
const MISS_TOLERANCE = 1.5;

/** Draws kept for the miss ratio. */
const MISS_WINDOW = 24;

/** Missed fraction of that window at which the machine is declared unable to hold the cadence. */
const MISS_FRACTION_TO_DECLARE = 0.34;

/** Window the delivered rate is counted over. */
const DELIVERED_WINDOW_MS = 1000;

// ── State ──────────────────────────────────────────────────────────────────────────────────────────

const tickDeltas: number[] = [];
let lastTickAt = 0;
let vblankMilliseconds = 0;
let refreshHz = 0;

let stride = 1;
let candidateStride = 1;
let candidateHeldFor = 0;

let tickCounter = 0;

/** The memoised decision, and the timestamp it belongs to. See the header — this is what shares phase. */
let decisionTimestamp = Number.NEGATIVE_INFINITY;
let decisionForThisTick = true;

let lastDrawAt = 0;
const drawMisses: boolean[] = [];
let missingCadence = false;

const deliveredDrawTimes: number[] = [];
/** Monotonic count of draw ticks, so an observer can average over its OWN window by differencing. */
let totalDraws = 0;

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function snapToKnownRefresh(measuredHz: number): number {
  let closest = measuredHz;
  let closestError = Number.POSITIVE_INFINITY;
  for (const known of KNOWN_REFRESH_RATES) {
    const error = Math.abs(known - measuredHz) / known;
    if (error < closestError) {
      closestError = error;
      closest = known;
    }
  }
  return closestError <= REFRESH_SNAP_TOLERANCE ? closest : measuredHz;
}

/**
 * Scratch space for the sort, reused.
 *
 * This runs on every animation frame for the life of the page — at 144 Hz a `slice()` here would be
 * 144 short-lived arrays a second, forever, on a site whose whole problem is frame consistency. One
 * allocation, sorted in place.
 */
const sortScratch: number[] = [];

function updateStride(): void {
  sortScratch.length = 0;
  for (const delta of tickDeltas) sortScratch.push(delta);
  sortScratch.sort((left, right) => left - right);
  const estimate = percentile(sortScratch, VBLANK_PERCENTILE);
  if (!(estimate > 0)) return;

  vblankMilliseconds = estimate;
  refreshHz = snapToKnownRefresh(1000 / estimate);

  const wanted = Math.max(1, Math.ceil(refreshHz / TARGET_FRAME_RATE));
  if (wanted === stride) {
    candidateStride = stride;
    candidateHeldFor = 0;
    return;
  }
  if (wanted === candidateStride) {
    candidateHeldFor += 1;
  } else {
    candidateStride = wanted;
    candidateHeldFor = 1;
  }
  if (candidateHeldFor < STRIDE_CHANGE_CONFIRMATIONS) return;

  const from = stride;
  stride = wanted;
  candidateHeldFor = 0;
  // A new cadence makes every banked miss a judgement about the old one.
  drawMisses.length = 0;
  missingCadence = false;

  if (telemetryEnabled) {
    console.log(
      `%c[clock] ${from} → ${stride}%c — ${refreshHz.toFixed(0)} Hz panel ` +
        `(vblank ${estimate.toFixed(2)} ms), drawing every ${stride === 1 ? 'tick' : `${stride}th tick`}` +
        ` → ${(refreshHz / stride).toFixed(1)} fps` +
        (stride === 1
          ? `\n  uncapped: this machine is not delivering ${TARGET_FRAME_RATE} fps worth of ticks, so there is nothing to cap.`
          : `\n  target ${TARGET_FRAME_RATE} fps; ${(refreshHz / stride).toFixed(1)} is the closest even cadence this panel can hold.`),
      'color:#7cc4ff;font-weight:700',
      'color:#888',
    );
  }
}

function observeTick(timestamp: number): void {
  if (lastTickAt > 0) {
    const delta = timestamp - lastTickAt;
    if (delta > 0 && delta < MAX_SANE_TICK_MS) {
      tickDeltas.push(delta);
      if (tickDeltas.length > TICK_WINDOW) tickDeltas.shift();
    } else {
      // A tab-restore or a multi-second stall. Everything banked describes a page that was not
      // running; keeping it would let a paused tab decide the cadence for the one that resumes.
      tickDeltas.length = 0;
      lastDrawAt = 0;
      drawMisses.length = 0;
    }
  }
  lastTickAt = timestamp;
  if (tickDeltas.length >= MIN_TICKS_BEFORE_CAPPING) updateStride();
}

function noteDraw(timestamp: number): void {
  if (lastDrawAt > 0 && vblankMilliseconds > 0) {
    const interval = timestamp - lastDrawAt;
    const due = stride * vblankMilliseconds;
    drawMisses.push(interval > due * MISS_TOLERANCE);
    if (drawMisses.length > MISS_WINDOW) drawMisses.shift();
    if (drawMisses.length === MISS_WINDOW) {
      const missed = drawMisses.reduce((total, miss) => total + (miss ? 1 : 0), 0);
      missingCadence = missed / MISS_WINDOW >= MISS_FRACTION_TO_DECLARE;
    }
  }
  lastDrawAt = timestamp;
  totalDraws += 1;

  deliveredDrawTimes.push(timestamp);
  while (deliveredDrawTimes.length > 0 && timestamp - deliveredDrawTimes[0] > DELIVERED_WINDOW_MS) {
    deliveredDrawTimes.shift();
  }
}

/**
 * Is this animation-frame tick a draw tick?
 *
 * ⚠ Pass the timestamp the browser handed your callback, not `performance.now()`. The header explains
 * what breaks otherwise, and it breaks quietly.
 *
 * ⚠ This is the cadence, not permission. A loop that must draw regardless — a resize, a tab-restore,
 * a context restore — should `shouldDrawThisFrame(timestamp) || forceRender`, because those frames are
 * about correctness rather than about motion and there is no cadence to protect on a frame the visitor
 * has just changed the shape of.
 */
export function shouldDrawThisFrame(timestamp: number): boolean {
  if (timestamp === decisionTimestamp) return decisionForThisTick;
  decisionTimestamp = timestamp;

  observeTick(timestamp);
  decisionForThisTick = tickCounter % stride === 0;
  tickCounter += 1;
  if (decisionForThisTick) noteDraw(timestamp);
  return decisionForThisTick;
}

/** Ticks per draw. 1 means the cadence is not capping anything. */
export function getRenderStride(): number {
  return stride;
}

/** The panel's refresh as measured, or 0 before enough ticks have been seen to say. */
export function getDetectedRefreshHz(): number {
  return refreshHz;
}

/** The cadence actually being delivered — `refresh ÷ stride`, or 0 before it is known. */
export function getCadenceFrameRate(): number {
  return refreshHz > 0 ? refreshHz / stride : 0;
}

/**
 * How long one cadence period is, in milliseconds — the frame budget every scene is being asked to
 * fit inside.
 *
 * ⚠ This is `stride × vblank`, NOT `1000 / TARGET_FRAME_RATE`. On a 144 Hz panel the site delivers
 * 28.8 fps and the budget is 34.7 ms, and a resolution controller solving against 33.3 there would be
 * asking for 4 % more than the cadence will ever demand. Returns 0 until the panel is known, which
 * callers must read as "no budget decided yet" rather than as "no time".
 */
export function getCadencePeriodMilliseconds(): number {
  return vblankMilliseconds > 0 ? stride * vblankMilliseconds : 0;
}

/** Draws actually delivered in the last second. What the visitor is getting, right now. */
export function getDeliveredFrameRate(): number {
  return deliveredDrawTimes.length;
}

/**
 * Every draw tick since the page loaded.
 *
 * For observers that want the delivered rate averaged over THEIR window rather than over the last
 * second — difference it across the window and divide by the window's own wall clock.
 */
export function getTotalDrawCount(): number {
  return totalDraws;
}

/** True while draws are being skipped — i.e. the machine has spare frames and the cap is taking them. */
export function isCadenceCapping(): boolean {
  return stride > 1;
}

/**
 * True when draws are consistently landing late — the machine cannot hold the cadence it was given.
 *
 * ⚠ This is the ONLY honest frame-rate signal once the cap is on, and `adaptivePixelRatio` is built
 * around that. A capped machine that is coping reports exactly the cadence by construction, so its
 * frame time says nothing about how much headroom it has; a capped machine that is MISSING is
 * reporting a real measurement of a frame that costs too much. Holding means nothing, missing means
 * spend less.
 */
export function isMissingCadence(): boolean {
  return missingCadence;
}
