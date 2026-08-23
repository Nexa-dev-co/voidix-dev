'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { MOTION_CHOICE_EVENT, shouldAskMotionChoice } from '@/lib/motionPreference';
import {
  setJourneyConsent,
  shouldAskJourneyConsent,
  subscribeJourneyConsent,
} from '@/lib/journey/consent';

/**
 * The one thing this site asks a visitor for, and it asks once.
 *
 * ── ⚠ IT APPEARS DURING THE LOADER, AND THAT IS A REVERSAL WORTH RECORDING ──────────────────────
 * The first cut waited for `REVEAL_EVENT` and then some, to keep the hero's opening move untouched.
 * This asks during the download instead, and the argument is `MotionPrompt`'s own, which was already
 * sitting three files away: *the loader is the one beat on this site where the visitor is already
 * waiting, so asking costs nothing.* It also fixes something the deferred version could not — a
 * visitor who abandons during the 8.8 MB download never reached the old bar at all, so tier 2 was
 * structurally unreachable for exactly the population the analytics most wants to understand.
 *
 * ── ⚠ TWO THINGS ALREADY LIVE IN THE LOADER, AND NEITHER MAY COLLIDE WITH THIS ──────────────────
 * `.intro-skip` (the offer of `/lite`) and `.intro-motion-prompt` both sit at z 10001, above the
 * intro veil's 10000. The motion prompt is anchored at `bottom: 11–14rem`, so it would stack directly
 * on top of a bar pinned to `bottom: 0` — two questions on screen at once, in the first ten seconds,
 * on a site whose whole argument is an uninterrupted opening.
 *
 * So this WAITS FOR THE MOTION QUESTION TO BE SETTLED whenever one is owed. That is also what keeps
 * it clear of the reload: choosing "Reduce motion" can end in `window.location.reload()`, and a
 * consent bar drawn into that window would be destroyed mid-decision, with the visitor watching their
 * own click evaporate. Most loads owe no motion choice — it is asked once — so most visitors see this
 * arrive on its own.
 *
 * ── ⚠ THE STACKING ORDER CHANGES WHEN THE INTRO ENDS, AND IT HAS TO ─────────────────────────────
 * During the intro the bar must clear the veil (10000) or it is drawn behind the loader and is simply
 * invisible — so it takes 10001, alongside the other two controls that had to solve this already.
 * Afterwards it drops to 9700, BELOW the transition covers (`LoopVeil`, `SectionJumpVeil`, both
 * 10000): a cover that hides a jump has to hide this too, or a section change travels behind a black
 * screen with a consent bar floating on top of it. `data-intro` carries the switch; the CSS owns the
 * two values.
 *
 * ── ⚠ `REVEAL_EVENT` IS ONLY EVER FIRED ON THE HOMEPAGE ─────────────────────────────────────────
 * Nothing dispatches it on `/about`, `/careers`, `/privacy`, `/terms` or `/lite` — `IntroSequence` is
 * its sole source and mounts on `/` alone. This is the exact bug `useNavbarAnimation` shipped and
 * CLAUDE.md records: off the homepage the bar was invisible until a 7.2 s fallback lapsed. Hence
 * `isHomepage`, taken the way `Navbar` takes it, and a plain short delay everywhere else.
 *
 * ── ⚠ IT PORTALS TO `body` ──────────────────────────────────────────────────────────────────────
 * Two independent reasons, either of which alone would be enough. ScrollTrigger wraps the hero pin in
 * a TRANSFORMED spacer, and a transformed ancestor stops `position: fixed` being fixed. And the
 * intro's own root is `aria-hidden` with `pointer-events: none`, neither of which can be undone from a
 * descendant — `MotionPrompt`'s header records that an interactive control in the loader has to be a
 * SIBLING of that root, not a child of it. Portalling satisfies both at once.
 *
 * ── ⚠ NO FOCUS TRAP ────────────────────────────────────────────────────────────────────────────
 * `role="region"`, not a dialog. Trapping focus for a question the visitor did not ask would fight the
 * loader's own skip control for the whole time the bar is up, and it is the pattern that makes consent
 * banners hated. Reachable by Tab, dismissible by Escape, never blocking.
 */

/**
 * How long into the loader before it appears.
 *
 * Not zero: arriving in the same frame as the page reads as a pop-up rather than as part of the
 * loader, and the dust field needs a moment to establish what the visitor is looking at first.
 */
const SETTLE_IN_LOADER_MS = 1500;

/** After a motion choice, when one was owed. Long enough that the two never read as one queue. */
const SETTLE_AFTER_MOTION_MS = 900;

/** The document routes have no loader — just enough that it does not arrive with the page. */
const SETTLE_OFF_HOMEPAGE_MS = 1200;

export default function ConsentBar() {
  const pathname = usePathname();
  const isHomepage = pathname === '/';

  // ⚠ All of these start at their SSR answers and are corrected in effects. `shouldAskJourneyConsent`
  // reads localStorage and returns false without a `window`, so branching on it during render would
  // give a visitor with a stored decision a different first paint than the server sent — the
  // hydration trap `MotionPrompt` documents and takes the same way out of.
  const [isMounted, setIsMounted] = useState(false);
  const [shouldAsk, setShouldAsk] = useState(false);
  const [isDue, setIsDue] = useState(false);
  // Drives the stacking order only. Starts true on the homepage because the intro is already up by
  // the time this mounts — there is no frame of `/` without it.
  const [isIntroActive, setIsIntroActive] = useState(false);

  useEffect(() => setIsMounted(true), []);

  // Whether a decision is owed — and it can change under us, because the control on `/privacy` writes
  // the same value. Someone withdrawing consent in another tab must not be re-asked here.
  useEffect(() => {
    const sync = () => setShouldAsk(shouldAskJourneyConsent());
    sync();
    return subscribeJourneyConsent(sync);
  }, []);

  // When it may appear, and how high it sits. Two different answers for the two kinds of route.
  useEffect(() => {
    if (!isHomepage) {
      const timer = window.setTimeout(() => setIsDue(true), SETTLE_OFF_HOMEPAGE_MS);
      return () => window.clearTimeout(timer);
    }

    setIsIntroActive(true);

    let settleTimer = 0;
    const arm = (delayMs: number) => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => setIsDue(true), delayMs);
    };

    // ⚠ The motion question is asked once per visitor, so this branch is the uncommon one — but it is
    // the one where getting it wrong puts two prompts on screen together.
    const isMotionChoicePending = shouldAskMotionChoice();
    const onMotionChoice = () => arm(SETTLE_AFTER_MOTION_MS);

    if (isMotionChoicePending) {
      window.addEventListener(MOTION_CHOICE_EVENT, onMotionChoice);
    } else {
      arm(SETTLE_IN_LOADER_MS);
    }

    // Only ever lowers the bar's stacking. It does NOT hide it: once shown, it stays until answered,
    // so a visitor who reaches the site proper still has the question in front of them.
    const onReveal = () => setIsIntroActive(false);
    window.addEventListener(REVEAL_EVENT, onReveal);

    return () => {
      window.removeEventListener(MOTION_CHOICE_EVENT, onMotionChoice);
      window.removeEventListener(REVEAL_EVENT, onReveal);
      window.clearTimeout(settleTimer);
    };
  }, [isHomepage]);

  /**
   * ⚠ ESCAPE RECORDS A DENIAL RATHER THAN LEAVING THE QUESTION OPEN, and that is the
   * privacy-protective reading rather than a shortcut. Under the GDPR the absence of an answer is not
   * consent, so dismissing can only mean no — and treating it as "ask again next time" would turn a
   * visitor's attempt to be rid of the bar into a reason to show it to them again. The control on
   * `/privacy` is how anyone changes their mind, in either direction.
   */
  useEffect(() => {
    if (!shouldAsk || !isDue) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setJourneyConsent('denied');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shouldAsk, isDue]);

  if (!isMounted || !shouldAsk || !isDue) return null;

  return createPortal(
    <section
      className="consent-bar"
      data-intro={isIntroActive}
      role="region"
      aria-label="Cookie choice"
    >
      <div className="consent-bar-copy">
        <p className="consent-bar-title font-display">
          We&rsquo;d like to recognise you if you come back.
        </p>
        {/* ⚠ "Stored on this device" rather than "a cookie". The button says cookies because that is
            the phrase everybody knows and the law treats the two the same ("cookies or similar
            technologies") — but the sentence that carries the actual disclosure should describe what
            is really there, which is one localStorage entry. `/privacy` §03 says the same thing at
            length, and the two must not drift. */}
        <p className="consent-bar-detail">
          Anonymous counts happen either way and never identify anyone. Saying yes adds one thing: a
          random id stored on this device, so a second visit is not read as a stranger.{' '}
          <a className="consent-bar-link" href="/privacy" data-journey="Privacy notice (consent bar)">
            What we collect
          </a>
        </p>
      </div>

      <div className="consent-bar-actions">
        {/* Declining first: the answer that costs the visitor nothing should be the easy one to reach
            for, which is the ordering argument MotionPrompt makes about its own two options. */}
        <button
          type="button"
          className="consent-bar-button"
          onClick={() => setJourneyConsent('denied')}
          data-journey="Consent: no thanks"
        >
          No thanks
        </button>
        <button
          type="button"
          className="consent-bar-button consent-bar-button--accept"
          onClick={() => setJourneyConsent('granted')}
          data-journey="Consent: allow"
        >
          Allow cookies
        </button>
      </div>
    </section>,
    document.body,
  );
}
