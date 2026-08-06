'use client';

import { useEffect, useState } from 'react';
import { areAssetsReady } from '@/lib/assetLoadProgress';
import { createPageEtaEstimator } from '../downloadEta';

/**
 * The way out of a long load — offered, not imposed.
 *
 * ── Why it is here at all ────────────────────────────────────────────────────────────────────────
 * The gate waits for the star, and on a weak connection that is a minute of loader for someone who
 * may only want to know what the studio does. `/lite` is the same services, work and answers as a
 * document. This is the only place the visitor is told it exists, because it is the only place the
 * cost is being paid.
 *
 * ── ⚠ It owns its own timing, and deliberately does not touch the gate ───────────────────────────
 * Unlike `MotionPrompt`, nothing here HOLDS anything: it is a link, and pressing it is an ordinary
 * navigation that tears the whole page down. So it needs none of the gate's release machinery, and
 * wiring it in would put a second decision inside a sequence whose beats are already serial and
 * load-bearing. Its own interval, its own latch, no events.
 *
 * ⚠ It renders OUTSIDE the intro's root element, for the reason `MotionPrompt` documents: that root
 * is `aria-hidden` with `pointer-events: none`, and neither can be undone from a descendant. An
 * interactive control has to be a sibling.
 *
 * ⚠ Its state is its own. `IntroSequence` must not re-render while the intro runs — a re-render would
 * re-apply its JSX inline styles over the values GSAP is driving — and a child re-rendering itself is
 * not the loader re-rendering.
 */

// ── ⚠ TWO CONDITIONS, BOTH REQUIRED, AND THEN HELD ──────────────────────────────────────────────
//
// This used to be one test: a page ETA over ten seconds. That fires on a fast connection with a big
// payload — which is not the visitor this is for. Somebody on fibre pulling 10.8 MB is having a
// perfectly good time and does not need to be offered the text version of the site.
//
// The visitor this is for is on a SLOW PIPE with a LONG WAIT, and those are two different facts. A
// slow connection with little left to fetch will be fine; a fast connection with a lot left will also
// be fine. Requiring both, and then requiring them to persist, is what separates "this is genuinely
// going to be painful" from "the first few seconds looked bad".

/**
 * Below this the connection itself is the problem, in bytes per second.
 *
 * ⚠ Derived from a fraction rate against `TOTAL_PAYLOAD_BYTES`, so it is an order-of-magnitude
 * figure rather than a measurement — see `bytesPerSecond` in downloadEta. That is the right precision
 * for this question: the difference between 480 and 520 KB/s does not change whether someone should
 * be offered a way out, and the difference between 500 and 5 000 does.
 */
const OFFER_BELOW_BYTES_PER_SECOND = 500 * 1024;

/** …and there has to be enough left to fetch that the slow pipe actually costs them something. */
const OFFER_AFTER_ETA_SECONDS = 20;

/**
 * How long both conditions have to hold before the offer appears.
 *
 * Throughput is spiky and the estimate is at its worst early — the first samples are dominated by
 * connection setup, not by the connection. Without this dwell, one bad second during TLS negotiation
 * would put an escape hatch on screen for someone who is about to load the site in four seconds.
 * ⚠ The dwell resets the moment either condition stops holding, so it measures a SUSTAINED state
 * rather than accumulating unrelated bad moments.
 */
const OFFER_SUSTAINED_MS = 3000;

/**
 * The backstop, for when no estimate can be formed at all.
 *
 * A server sending no `Content-Length` — chunked or compressed — leaves the fraction pinned at 0 with
 * bytes arriving perfectly healthily, so both readings above stay `null` however long it takes. That
 * is exactly the visitor this exists for, and a measurement-only trigger would never reach them.
 *
 * ⚠ Raised well past the two conditions plus their dwell, so it stays a BACKSTOP. At its old 12 s it
 * would now usually fire first, and the conditions above would never decide anything.
 */
const OFFER_AFTER_ELAPSED_MS = 30_000;

const POLL_MS = 500;

interface NavigatorWithConnection extends Navigator {
  connection?: { saveData?: boolean };
}

export default function SkipToLite() {
  // Starts false and is decided in an effect: the server cannot know the connection, so the first
  // client render has to match the `null` it sent.
  const [isOffered, setIsOffered] = useState(false);

  useEffect(() => {
    // Already in — there is no wait left to escape.
    if (areAssetsReady()) return;

    // ⚠ An INSTRUCTION, not a hint. `deviceTier` and `prefetchWhenAssetsReady` both honour this
    // already; someone who has asked their browser to spend less should be shown the cheap route
    // immediately rather than after twenty seconds of proving it.
    if ((navigator as NavigatorWithConnection).connection?.saveData) {
      setIsOffered(true);
      return;
    }

    const pageEta = createPageEtaEstimator();
    const startedAt = performance.now();
    /** When the two conditions most recently STARTED holding together, or 0 while they are not. */
    let strugglingSince = 0;

    const ticker = window.setInterval(() => {
      pageEta.sample();

      const bytesPerSecond = pageEta.bytesPerSecond();
      const remaining = pageEta.secondsRemaining();
      // ⚠ `null` is not "fine", it is "not knowable yet" — and it must not be read as either
      // condition being met. Whatever it is hiding is the backstop's problem, below.
      const isSlowPipe =
        bytesPerSecond !== null && bytesPerSecond < OFFER_BELOW_BYTES_PER_SECOND;
      const isLongWait = remaining !== null && remaining >= OFFER_AFTER_ETA_SECONDS;

      if (isSlowPipe && isLongWait) {
        if (strugglingSince === 0) strugglingSince = performance.now();
      } else {
        // Reset rather than pause: the dwell has to measure a SUSTAINED state, not a total of
        // unrelated bad seconds spread across a load that is otherwise going fine.
        strugglingSince = 0;
      }

      const sustained =
        strugglingSince !== 0 && performance.now() - strugglingSince >= OFFER_SUSTAINED_MS;
      const strandedWithNoEstimate = performance.now() - startedAt >= OFFER_AFTER_ELAPSED_MS;
      if (!sustained && !strandedWithNoEstimate) return;

      // Latched: the estimate wobbling back under a threshold must not take the offer away again
      // while somebody is reaching for it.
      setIsOffered(true);
      window.clearInterval(ticker);
    }, POLL_MS);

    return () => window.clearInterval(ticker);
  }, []);

  if (!isOffered) return null;

  return (
    <div className="intro-skip">
      <span className="intro-skip-copy">Ten megabytes still to come.</span>
      {/* A plain link on purpose. Pressing it is a real navigation that tears this page down — which
          is the whole point: nothing further is downloaded, and the models in flight are abandoned. */}
      <a className="intro-skip-action" href="/lite">
        Read the site in text
        <span aria-hidden="true"> →</span>
      </a>
    </div>
  );
}
