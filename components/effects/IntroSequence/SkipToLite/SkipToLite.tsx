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

/**
 * How far out the WHOLE PAGE has to look before an exit is worth offering.
 *
 * ⚠ Measured against the page, not the star — and that alone moves it a long way earlier. The star is
 * ~18 % of the weighted download and lands early, so a star-based estimate reported four seconds while
 * the fleet still had 5.3 MB to go. Now that the gate holds for every source, the page's estimate is
 * the visitor's actual wait.
 *
 * Still well above `SHAPE_ONSET_ETA_SECONDS` (4), because filling a wait and apologising for one are
 * different acts: four seconds is a beat worth decorating, ten is a wait worth escaping.
 */
const OFFER_AFTER_ETA_SECONDS = 10;

/**
 * The backstop, for when no estimate can be formed at all.
 *
 * A server sending no `Content-Length` — chunked or compressed — leaves the fraction pinned at 0 with
 * bytes arriving perfectly healthily, so `secondsRemaining()` stays `null` however long it takes. That
 * is exactly the visitor this exists for, and an ETA-only trigger would never reach them.
 */
const OFFER_AFTER_ELAPSED_MS = 12_000;

const POLL_MS = 1000;

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
    const ticker = window.setInterval(() => {
      pageEta.sample();
      const remaining = pageEta.secondsRemaining();
      const longEnough =
        (remaining !== null && remaining >= OFFER_AFTER_ETA_SECONDS) ||
        performance.now() - startedAt >= OFFER_AFTER_ELAPSED_MS;
      if (!longEnough) return;
      // Latched: the estimate wobbling back under the threshold must not take the offer away again
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
