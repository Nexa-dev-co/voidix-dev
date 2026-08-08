/**
 * Per-frame delta and elapsed time, without three's deprecated `Clock`.
 *
 * ── Why not `THREE.Clock` ────────────────────────────────────────────────────────────────────────
 * three r184 deprecates it, and the warning it prints carries a ~100-line React stack — three render
 * loops build one, StrictMode doubles that, and the console the site's own telemetry writes to is
 * unreadable before the loader has finished.
 *
 * ── Why not `THREE.Timer` either ─────────────────────────────────────────────────────────────────
 * It is the sanctioned replacement, but it is not a drop-in: it applies its own max-delta and it wants
 * an explicit `update()` whose omission is silent. What these three loops actually need is delta and
 * elapsed, which is a dozen lines of `performance.now()` — and `gatherRenderer` already hand-rolls
 * exactly this for the loader, for its own documented reasons. One pattern, no engine dependency.
 *
 * ── The bug it removes ───────────────────────────────────────────────────────────────────────────
 * `Clock.getElapsedTime()` calls `getDelta()` internally, so READING the elapsed time ADVANCES the
 * clock — call both in one frame and the second one eats the first's delta. `useServicesDeck` carries
 * a comment warning about precisely this, and `SunModelCanvas` was doing it anyway (and again from
 * outside the loop, in the regather handler, where it stole the delta from the next frame). Here,
 * `tick()` advances and `elapsed()` only ever reads, so the trap does not exist.
 */

export interface FrameTimer {
  /** Advance to now and return this frame's delta in seconds, clamped. First call returns 0. */
  tick: () => number;
  /** Total seconds since the first tick. Reading NEVER advances anything. */
  elapsed: () => number;
  /**
   * The most recent delta with NO clamp applied. Reading never advances anything.
   *
   * ── ⚠ FOR MEASUREMENT. NEVER FOR INTEGRATION. ────────────────────────────────────────────────────
   * Integrating this is what the clamp exists to prevent: a tab-restore hands you a delta of several
   * seconds and an animation steps that far in one frame.
   *
   * But a clamp is a lie told deliberately, and it must not reach anything that is trying to find out
   * how fast the machine is. `adaptivePixelRatio.sampleFrame` was fed the CLAMPED value for its whole
   * life, and `useWorksField` clamps at 0.05 s — so the resolution controller could not perceive a
   * frame slower than 20 fps, on a section measured at 9–18 fps. Its "has this step down helped?"
   * test compares two frame rates and needs an 8 % difference; both were pinned at the clamp, so the
   * answer was *always* "cutting the pixels changed nothing", and the controller switched itself off
   * on precisely the machines it exists for. The log that caught it shows 16 → 29 fps across a cut the
   * controller then described as no change.
   */
  lastRawDelta: () => number;
}

/**
 * @param maxDeltaSeconds Cap on the value `tick()` RETURNS — for tab-restores and breakpoints, where
 *   a real delta of several seconds would otherwise be integrated into an animation in one step.
 *   Unbounded by default, which is what `Clock` did.
 *
 * ⚠ The cap does not apply to `elapsed()`, deliberately: it accumulates the RAW delta, so elapsed
 * stays true wall-clock and anything reading it as a phase (a drift, a sway) does not slip behind
 * every time a frame is dropped. This is exactly how `Clock` behaved with a `Math.min` at the call
 * site, which is what all three loops were doing by hand.
 */
export function createFrameTimer(
  maxDeltaSeconds: number = Number.POSITIVE_INFINITY,
): FrameTimer {
  let lastMilliseconds = 0;
  let started = false;
  let elapsedSeconds = 0;
  let rawDeltaSeconds = 0;

  return {
    tick: () => {
      const now = performance.now();
      // The first frame has no previous timestamp to difference against — same as Clock's autoStart.
      if (!started) {
        started = true;
        lastMilliseconds = now;
        return 0;
      }
      const rawSeconds = (now - lastMilliseconds) / 1000;
      lastMilliseconds = now;
      elapsedSeconds += rawSeconds;
      rawDeltaSeconds = rawSeconds;
      return Math.min(rawSeconds, maxDeltaSeconds);
    },
    elapsed: () => elapsedSeconds,
    lastRawDelta: () => rawDeltaSeconds,
  };
}
