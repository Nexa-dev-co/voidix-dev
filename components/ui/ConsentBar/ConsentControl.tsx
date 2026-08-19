'use client';

import { useEffect, useState } from 'react';
import {
  getJourneyConsent,
  hasGlobalPrivacyControl,
  setJourneyConsent,
  subscribeJourneyConsent,
  type JourneyConsent,
} from '@/lib/journey/consent';
import { withdrawJourneyConsent } from '@/lib/journey/withdraw';

/**
 * Where a decision is changed — the other half of the consent bar, and the half that makes it real.
 *
 * ── ⚠ WITHDRAWAL HAS TO BE AS EASY AS GRANTING, AND THIS IS THE ONLY PLACE IT LIVES ─────────────
 * The bar asks once and never returns; without a permanent control somewhere, a yes would be
 * effectively irrevocable and the "you can change your mind" line in the privacy notice would be
 * false. It sits on `/privacy` because that is the page a person looking for it would open, and
 * because every footer on the site already links there — so it is reachable from everywhere without
 * putting a privacy control into the navbar of a site whose navbar is a design element.
 *
 * ⚠ It renders its own state rather than a toggle with an assumed default. "Not decided", "on" and
 * "off" are three different things here and a two-state switch would have to lie about one of them —
 * the same argument `motionPreference` makes for having three states instead of a boolean.
 *
 * ⚠ A client island on an otherwise fully server-rendered route. `LegalPage` is a Server Component
 * specifically so the legal pages ship no component JavaScript; this is the one exception and it is
 * scoped to itself rather than pushing `'use client'` up into the page.
 */

const LABELS: Record<JourneyConsent, string> = {
  unset: 'Not decided',
  granted: 'On',
  denied: 'Off',
};

export default function ConsentControl() {
  // ⚠ Starts at the server's answer — `getJourneyConsent()` returns `unset` with no `window` — and is
  // corrected in an effect. Reading localStorage during render would hydrate a different string than
  // the server sent. Same trap, same fix, as the bar and `MotionPrompt`.
  const [consent, setConsent] = useState<JourneyConsent>('unset');
  const [isGlobalOptOut, setIsGlobalOptOut] = useState(false);

  useEffect(() => {
    const sync = () => {
      setConsent(getJourneyConsent());
      setIsGlobalOptOut(hasGlobalPrivacyControl());
    };
    sync();
    return subscribeJourneyConsent(sync);
  }, []);

  return (
    <div className="consent-control">
      <p className="consent-control-state">
        Recognising you between visits is currently{' '}
        <strong className="consent-control-value" data-state={consent}>
          {LABELS[consent]}
        </strong>
      </p>

      {isGlobalOptOut && consent !== 'granted' ? (
        /* ⚠ Said out loud rather than silently obeyed. A visitor sending Global Privacy Control has
           already opted out of everything, everywhere, and this site honours it without asking — but
           a site that quietly did the right thing and never mentioned it is indistinguishable from
           one that ignored the signal. They can still switch it on here; it just will not be asked
           for. Same principle as MotionPrompt acknowledging the OS motion setting. */
        <p className="consent-control-note">
          Your browser sends Global Privacy Control, so we have treated that as a no and did not ask.
          You can still turn it on here if you want to.
        </p>
      ) : null}

      <div className="consent-control-actions">
        {/* ⚠ `withdrawJourneyConsent`, NOT `setJourneyConsent('denied')`. The latter erases the id
            locally and leaves every cursor path on the server — see withdraw.ts, where the ordering
            that makes this real is enforced. */}
        <button
          type="button"
          className="consent-bar-button"
          disabled={consent === 'denied'}
          onClick={withdrawJourneyConsent}
        >
          Turn off
        </button>
        <button
          type="button"
          className="consent-bar-button consent-bar-button--accept"
          disabled={consent === 'granted'}
          onClick={() => setJourneyConsent('granted')}
        >
          Turn on
        </button>
      </div>

      <p className="consent-control-note">
        Turning it off deletes the identifier from this device immediately. Anonymous counts, which
        cannot identify anyone, continue either way — there is nothing to switch off there because
        there is nothing stored.
      </p>
    </div>
  );
}
