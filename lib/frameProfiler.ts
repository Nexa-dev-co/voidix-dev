import {
  getDetectedRefreshHz,
  getRenderStride,
  getTotalDrawCount,
  isMissingCadence,
  TARGET_FRAME_RATE,
} from '@/lib/renderClock';
import { telemetryEnabled } from '@/lib/telemetryEnabled';

/**
 * Where the frame actually goes — a named breakdown, printed on an interval.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * Two laptops both measured 2.3 ms for one drained frame of the works pipeline (`gpuProbe`) and both
 * ran the works section at 23–27 fps. At 27 fps the frame is ~37 ms, and even scaled to the ratio they
 * were rendering at, the pipeline that was measured accounts for well under a fifth of it. The
 * resolution controller then proved the rest by experiment: it cut 22 % of the pixels and the frame
 * rate got WORSE, so it put them back and set `fillBound = false`.
 *
 * At that point every instrument on the site had said its piece and none of them could say where the
 * other ~30 ms was going. That is the gap this fills.
 *
 * ── ⚠ WHAT IT CAN AND CANNOT SEE ─────────────────────────────────────────────────────────────────
 * WebGL is asynchronous. Timing across `composer.render()` measures the CPU cost of BUILDING and
 * SUBMITTING the frame — walking the scene graph, uploading uniforms, issuing draw calls — and NOT
 * the GPU executing it. A scene can therefore report 2 ms here and still be what the frame is waiting
 * on.
 *
 * So read the `unaccounted` line as the interesting one. It is
 *
 *     rAF-to-rAF delta  −  everything the spans below add up to
 *
 * and it contains: GPU execution, compositing (including every `mix-blend-mode` layer), style and
 * layout, and any JavaScript nobody has wrapped in a span. A large `unaccounted` with small spans
 * means the bottleneck is NOT in our JavaScript — which is exactly the state worth being able to prove
 * rather than infer.
 *
 * ⚠ To split `unaccounted` further you need `EXT_disjoint_timer_query_webgl2`, which is the only way
 * to get real per-pass GPU time. `gpuProbe`'s header explains why the SHIPPING path may not depend on
 * it — it is missing on plenty of drivers — but as a diagnostic, when present, it is the right next
 * instrument. Nothing here uses it yet.
 *
 * ⚠ The profiler runs its OWN rAF, deliberately. There are three render loops on this page (the deck,
 * the works field, the sun) and none of them is "the frame" — asking one of them to own the timing
 * would mean the total disappeared whenever that scene happened to be gated off.
 *
 * Silent in production: `telemetryEnabled` is decided at build time, so the bundler drops all of this.
 * On a Vercel PREVIEW it is on automatically.
 */

/** How often the breakdown prints. Long enough to average out a scroll, short enough to watch live. */
const REPORT_INTERVAL_SECONDS = 3;

/** Deltas above this are a tab-restore or a debugger pause, not a frame. */
const MAX_SANE_FRAME_MS = 500;

/** A frame this far above the median is worth naming on its own — a stall, not a slow frame. */
const STALL_FRAME_MS = 50;

interface SpanTotals {
  milliseconds: number;
  calls: number;
  /**
   * A breakdown of time already counted by an enclosing span — shown indented, and NOT added to the
   * total. Without this the composer spans would be counted twice: once inside their loop's span and
   * once on their own, and `unaccounted` would come out too small by exactly the amount we care about.
   */
  nested: boolean;
}

const spans = new Map<string, SpanTotals>();
/** Latest value of a named gauge — draw calls, triangles, the pixel ratio. Not accumulated. */
const gauges = new Map<string, number | string>();

let running = false;
let frames = 0;
/** Time inside SAMPLED frames — the denominator for the per-frame averages. */
let windowMilliseconds = 0;
/**
 * Wall clock across the whole window, including the frames thrown out as insane.
 *
 * ⚠ These two are NOT the same number and the difference is itself a finding. A frame over
 * `MAX_SANE_FRAME_MS` is discarded from the average (it is a tab-restore or a multi-second stall, not
 * a frame rate), but the time still passed. The first version of this printed the sampled figure and
 * called it the window, which produced a report claiming 9158 ms of long tasks "over 3.3 s" — the
 * long-task total was right and the window was a sixth of the truth. `dropped` now says so out loud.
 */
let wallClockStartedAt = 0;
let droppedFrames = 0;
let worstFrameMilliseconds = 0;
let stallCount = 0;
let lastFrameAt = 0;
let longTaskCount = 0;
let longTaskMilliseconds = 0;
/**
 * `getTotalDrawCount()` as the window opened.
 *
 * ⚠ THE HEADLINE USED TO COUNT TICKS, AND UNDER A CAP THAT IS NOT THE FRAME RATE. This module runs its
 * own animation frame and counted every one of them, which was the delivered rate right up until the
 * site started skipping draws on purpose: a 60 Hz panel drawing every other tick still TICKS at 60, so
 * the report would have read "60 fps" on a site delivering 30 and the cap would have looked like it
 * never shipped. Differencing the clock's own draw counter over this window gives the rate a visitor
 * actually sees, averaged over exactly the same window as everything else in the report.
 */
let drawsAtWindowStart = 0;

function ensureRunning(): void {
  if (running || !telemetryEnabled || typeof window === 'undefined') return;
  running = true;

  // ⚠ Long tasks are the other half of the picture and they are invisible to the spans: a 120 ms
  // script block does not live inside anyone's render call, it happens BETWEEN frames. Chromium only.
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskCount += 1;
        longTaskMilliseconds += entry.duration;
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // Safari and Firefox do not implement `longtask`. Everything else here still works.
  }

  const tick = () => {
    requestAnimationFrame(tick);
    const now = performance.now();
    if (lastFrameAt !== 0) {
      const delta = now - lastFrameAt;
      if (delta > 0 && delta < MAX_SANE_FRAME_MS) {
        frames += 1;
        windowMilliseconds += delta;
        if (delta > worstFrameMilliseconds) worstFrameMilliseconds = delta;
        if (delta > STALL_FRAME_MS) stallCount += 1;
      } else if (delta >= MAX_SANE_FRAME_MS) {
        droppedFrames += 1;
      }
    }
    lastFrameAt = now;
    if (wallClockStartedAt === 0) wallClockStartedAt = now;

    if (windowMilliseconds >= REPORT_INTERVAL_SECONDS * 1000) report();
  };
  requestAnimationFrame(tick);
}

function reset(): void {
  spans.clear();
  frames = 0;
  windowMilliseconds = 0;
  worstFrameMilliseconds = 0;
  stallCount = 0;
  droppedFrames = 0;
  longTaskCount = 0;
  longTaskMilliseconds = 0;
  wallClockStartedAt = performance.now();
  drawsAtWindowStart = getTotalDrawCount();
}

function report(): void {
  if (frames === 0) {
    reset();
    return;
  }

  const averageFrameMilliseconds = windowMilliseconds / frames;
  const fps = 1000 / averageFrameMilliseconds;

  // Grouped by owner, groups ordered by cost — so the answer to "what does it consume" is the first
  // block, and a nested row always sits under the span it is part of rather than wherever its own
  // magnitude would have sorted it.
  // `Array.from`, not spread — this project's tsconfig target predates downlevel Map iteration.
  const entries = Array.from(spans.entries());
  const ownerOf = (name: string) => name.split(' · ')[0];
  const ownerCost = new Map<string, number>();
  for (const [name, totals] of entries) {
    if (!totals.nested) ownerCost.set(ownerOf(name), totals.milliseconds);
  }
  const rows = entries.sort((left, right) => {
    const leftOwner = ownerCost.get(ownerOf(left[0])) ?? 0;
    const rightOwner = ownerCost.get(ownerOf(right[0])) ?? 0;
    if (leftOwner !== rightOwner) return rightOwner - leftOwner;
    if (left[1].nested !== right[1].nested) return left[1].nested ? 1 : -1;
    return right[1].milliseconds - left[1].milliseconds;
  });

  let measuredPerFrame = 0;
  const lines = rows.map(([name, totals]) => {
    const perFrame = totals.milliseconds / frames;
    if (!totals.nested) measuredPerFrame += perFrame;
    const share = (perFrame / averageFrameMilliseconds) * 100;
    const label = totals.nested ? `  ↳ ${name}` : name;
    return (
      `\n  ${label.padEnd(22)}${perFrame.toFixed(2).padStart(7)} ms  ` +
      `${share.toFixed(1).padStart(5)}%   ${totals.calls} calls`
    );
  });

  const unaccounted = Math.max(0, averageFrameMilliseconds - measuredPerFrame);
  const gaugeLine = Array.from(gauges.entries())
    .map(([name, value]) => `${name} ${typeof value === 'number' ? value.toFixed(2) : value}`)
    .join(' · ');

  // The two rates are different questions and the report now answers both: `drawn` is what the visitor
  // sees, `ticks` is the wall clock every span and `unaccounted` figure below is a fraction of.
  const wallClockSeconds = Math.max(0.001, (performance.now() - wallClockStartedAt) / 1000);
  const drawnFps = (getTotalDrawCount() - drawsAtWindowStart) / wallClockSeconds;
  const stride = getRenderStride();
  const refreshHz = getDetectedRefreshHz();

  console.log(
    `%c[frame] ${drawnFps.toFixed(0)} fps drawn · ${fps.toFixed(0)} Hz ticks · ` +
      `${averageFrameMilliseconds.toFixed(1)} ms/tick · ` +
      `worst ${worstFrameMilliseconds.toFixed(0)} ms · ${stallCount} stalls over ${STALL_FRAME_MS} ms` +
      `%c   (${frames} frames sampled in ${(windowMilliseconds / 1000).toFixed(1)} s` +
      ` of ${((performance.now() - wallClockStartedAt) / 1000).toFixed(1)} s wall clock` +
      (droppedFrames > 0 ? `, ${droppedFrames} dropped over ${MAX_SANE_FRAME_MS} ms` : '') +
      `)` +
      lines.join('') +
      `\n  ${'─'.repeat(46)}` +
      `\n  ${'submitted by us'.padEnd(20)}${measuredPerFrame.toFixed(2).padStart(7)} ms  ` +
      `${((measuredPerFrame / averageFrameMilliseconds) * 100).toFixed(1).padStart(5)}%` +
      `\n  ${'unaccounted'.padEnd(20)}${unaccounted.toFixed(2).padStart(7)} ms  ` +
      `${((unaccounted / averageFrameMilliseconds) * 100).toFixed(1).padStart(5)}%` +
      `   ← GPU execution + compositing + untimed JS` +
      (longTaskCount > 0
        ? `\n  long tasks: ${longTaskCount} (${longTaskMilliseconds.toFixed(0)} ms total)`
        : '\n  long tasks: none') +
      `\n  cadence: ${
        stride === 1
          ? `UNCAPPED — ${refreshHz > 0 ? `${refreshHz.toFixed(0)} Hz panel, ` : ''}this machine has no spare frames to give back`
          : `every ${stride}th tick of a ${refreshHz.toFixed(0)} Hz panel → ${(refreshHz / stride).toFixed(1)} fps` +
            (isMissingCadence() ? ' · ⚠ MISSING — draws are landing late' : ' · held')
      }` +
      (gaugeLine ? `\n  ${gaugeLine}` : ''),
    // Graded against the cadence the site is actually trying to deliver, not against 50 — under a cap
    // "below 50" is the normal, correct, intended state and colouring it red says nothing.
    drawnFps < TARGET_FRAME_RATE * 0.9
      ? 'color:#ff5c5c;font-weight:700'
      : 'color:#5bd6a0;font-weight:700',
    'color:#888',
  );

  reset();
}

/**
 * Record that `name` cost `milliseconds` on this frame.
 *
 * Safe to call from anywhere; the whole module folds away in production.
 */
export function profileSpan(name: string, milliseconds: number, nested = false): void {
  if (!telemetryEnabled) return;
  ensureRunning();
  const existing = spans.get(name);
  if (existing) {
    existing.milliseconds += milliseconds;
    existing.calls += 1;
  } else {
    spans.set(name, { milliseconds, calls: 1, nested });
  }
}

/**
 * `performance.now()`, or 0 when telemetry is off.
 *
 * For loops that schedule themselves on their first line and so cannot be wrapped in
 * `profileMeasure` without being split in two. Pair it with `profileSpan` at the end of the body —
 * when telemetry is off both sides are free and the subtraction feeds a no-op.
 */
export function profileNow(): number {
  return telemetryEnabled ? performance.now() : 0;
}

/**
 * Time one synchronous piece of work under `name`.
 *
 * ⚠ In production this is a bare call through with no timing at all — `telemetryEnabled` is a
 * build-time constant, so the branch folds and `performance.now()` never appears in the bundle. That
 * matters here specifically: this wraps things that run 60 times a second.
 */
export function profileMeasure<T>(name: string, run: () => T, nested = false): T {
  if (!telemetryEnabled) return run();
  const startedAt = performance.now();
  const result = run();
  profileSpan(name, performance.now() - startedAt, nested);
  return result;
}

/** Record the latest value of a gauge (draw calls, triangles, the pixel ratio). Not accumulated. */
export function profileGauge(name: string, value: number | string): void {
  if (!telemetryEnabled) return;
  ensureRunning();
  gauges.set(name, value);
}
