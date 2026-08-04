import { getSourceProgress, onAssetProgress } from './assetLoadProgress';

/**
 * Hold a heavy section's downloads until the star is in — rung 1 of the download ladder.
 *
 * ── Why anything yields at all ───────────────────────────────────────────────────────────────────
 * `fractured_sun.glb` is 1.28 MB and is on screen AT THE REVEAL: the hero opens on it and the
 * loader's finale is its ten shards flying in. The fleet's four vessels are 5.15 MB and the works
 * field's surfaces another 0.85 MB, and neither is wanted until the visitor has scrolled — tens of
 * seconds away.
 *
 * Started together they simply share the pipe, so the star finishes at about the same FRACTION of
 * the total download as the cargo does: right at the end. That is the whole of the reported bug —
 * the site opened with a hole where the sun goes, and the star faded in 30–60 s later.
 *
 * ── Why this replaced a flat deadline ────────────────────────────────────────────────────────────
 * The fleet used to hold on `setTimeout(start, 6000)`. A deadline cannot tell SLOW from BROKEN, and
 * it guessed wrong in exactly the case it existed for: 1.28 MB inside 6 s needs ~1.7 Mbps sustained,
 * so on a weak connection the cap expired with the star at ~60 %, 5.15 MB of vessels joined the wire,
 * and the star was starved the rest of the way. The hold bought six seconds and then reproduced the
 * original bug.
 *
 * A STALL DETECTOR asks the question the deadline was trying to ask. Hold while the star is moving;
 * release when it stops moving, or fails. Every case lands where it should:
 *
 *   fast connection   star completes in well under a second → released immediately, as before
 *   slow connection   star keeps reporting → held, and it gets the whole pipe instead of a third
 *   star 404s         the error path reports it done → released at once, not six seconds later
 *   star truly stalls no progress for STALL_RELEASE_MS → released, and the section loads anyway
 *
 * ⚠ The cap is not optional in any form. A star that never arrives must never mean a fleet that
 * never loads: the deck would sit empty forever and the intro's gate would wait out its own timeout
 * on a source that had no reason to be late.
 */

/**
 * Longest the star may report NOTHING before the wire is handed back.
 *
 * Not a download budget — a silence budget. With a `Content-Length` the star reports many times a
 * second while it streams, so this much total silence genuinely means stalled rather than slow, and
 * a download of any length is held as long as it keeps moving.
 *
 * ⚠ It degrades to a plain deadline when the server sends no `Content-Length` (chunked or
 * compressed): `SunModelCanvas` has nothing honest to report mid-flight in that case and jumps
 * straight from 0 to 1, so nothing resets this and it fires. That is no worse than the 6 s deadline
 * it replaces, and the `<link rel="preload">` in `app/layout.tsx` still gives the star its head
 * start — but it is why this number is generous rather than tight.
 */
const STALL_RELEASE_MS = 5000;

/**
 * Call `release` once the star has finished downloading, stalled, or failed.
 *
 * Returns a teardown that must be called from the hook's cleanup — it clears the pending timer and
 * unsubscribes. `release` is called at most once by this helper, and callers are expected to be
 * idempotent anyway (both are: they latch a `started` flag).
 */
export function yieldToStarDownload(release: () => void): () => void {
  // Already in — a warm reload serves the star from cache before this ever runs.
  if (getSourceProgress('sun') >= 1) {
    release();
    return () => {};
  }

  let finished = false;
  let lastStarProgress = getSourceProgress('sun');
  let stallTimer = 0;
  // Assigned below rather than declared there, so `fire` does not have to reach forward to a const
  // that is initialised after it.
  let unsubscribe = () => {};

  const fire = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(stallTimer);
    unsubscribe();
    release();
  };

  unsubscribe = onAssetProgress(() => {
    if (finished) return;
    const starProgress = getSourceProgress('sun');
    // ⚠ Only the STAR's own movement counts. `onAssetProgress` fires for every source, so watching
    // the notification alone would let the other section's download keep resetting this timer — and
    // a dead star would then be waited on forever by whichever section was still streaming.
    if (starProgress <= lastStarProgress) return;
    lastStarProgress = starProgress;
    if (starProgress >= 1) {
      fire();
      return;
    }
    // Still moving: give it another full silence budget.
    window.clearTimeout(stallTimer);
    stallTimer = window.setTimeout(fire, STALL_RELEASE_MS);
  });

  stallTimer = window.setTimeout(fire, STALL_RELEASE_MS);

  return () => {
    finished = true; // stop a pending timer from calling back into a torn-down scene
    window.clearTimeout(stallTimer);
    unsubscribe();
  };
}
