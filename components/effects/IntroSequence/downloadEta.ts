import { getSourceProgress, type AssetSource } from '@/lib/assetLoadProgress';

/**
 * How much longer a source has left, estimated from how fast its own fraction is moving.
 *
 * The loader no longer gives up on the star after a fixed twelve seconds — it waits for as long as
 * the star is actually arriving (see IntroSequence's gate). That is the right behaviour and it is
 * unbearable without telling the visitor what they are waiting for, so the loader shows a countdown
 * and offers a way out. This is where the number comes from.
 *
 * ── Why a rate rather than bytes ─────────────────────────────────────────────────────────────────
 * `assetLoadProgress` stores fractions, not bytes, and deliberately: it is the one place that knows
 * about several sources of very different sizes. Differentiating the fraction gives "fractions per
 * second", and the remaining fraction divided by that is a time — no file size needed anywhere, and
 * it stays correct if the model is ever re-exported at a different weight.
 *
 * ⚠ It reports `null` far more readily than it reports a number. A countdown that appears instantly,
 * reads 4 s, and then climbs to 70 s is worse than no countdown at all — so nothing is shown until
 * there is enough of a sample to mean something, and a rate that collapses to zero goes back to
 * `null` rather than to Infinity.
 */

/** Ignore the first moments: early samples are dominated by connection setup, not throughput. */
const MIN_SAMPLE_SECONDS = 1.5;
/** …and by this much real progress, so a single early chunk cannot set the pace. */
const MIN_SAMPLE_FRACTION = 0.02;
/** Smoothing on the measured rate. Low: throughput is spiky and the number is read by a human. */
const RATE_EMA_ALPHA = 0.15;
/** Below this the rate is indistinguishable from stopped, and dividing by it produces nonsense. */
const MIN_BELIEVABLE_RATE = 1e-5;

export interface DownloadEtaEstimator {
  /** Fold in the source's current progress. Safe to call as often as you like. */
  sample: () => void;
  /** Seconds remaining, or `null` while that cannot honestly be answered yet. */
  secondsRemaining: () => number | null;
}

export function createDownloadEtaEstimator(source: AssetSource): DownloadEtaEstimator {
  const startedAt = performance.now();
  const startProgress = getSourceProgress(source);

  let lastAt = startedAt;
  let lastProgress = startProgress;
  let ratePerSecond = 0;

  const sample = () => {
    const now = performance.now();
    const progress = getSourceProgress(source);
    const elapsedSeconds = (now - lastAt) / 1000;
    if (elapsedSeconds <= 0) return;

    const gained = progress - lastProgress;
    lastAt = now;
    lastProgress = progress;
    // Only advances count. Progress is monotonic, so a zero here means "no new fraction this tick" —
    // which on a chunked response is the normal state and must not be read as a rate of zero.
    if (gained <= 0) return;

    const instantRate = gained / elapsedSeconds;
    ratePerSecond =
      ratePerSecond === 0
        ? instantRate
        : ratePerSecond + (instantRate - ratePerSecond) * RATE_EMA_ALPHA;
  };

  const secondsRemaining = () => {
    const progress = getSourceProgress(source);
    if (progress >= 1) return 0;
    if ((performance.now() - startedAt) / 1000 < MIN_SAMPLE_SECONDS) return null;
    if (progress - startProgress < MIN_SAMPLE_FRACTION) return null;
    if (ratePerSecond < MIN_BELIEVABLE_RATE) return null;
    return (1 - progress) / ratePerSecond;
  };

  return { sample, secondsRemaining };
}
