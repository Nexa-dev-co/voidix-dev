'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { noteJourneyRouteChange, startJourneyCollector } from '@/lib/journey/collector';

/**
 * Renders nothing. Starts the collector once, on the client.
 *
 * ── ⚠ WHY IT STARTS WITHOUT WAITING FOR CONSENT ────────────────────────────────────────────────
 * Because tier 1 does not need any. Nothing it records is written to the device — the session id
 * lives in a module variable and dies with the tab — and nothing in it can single a person out, so
 * there is no storage to consent to and no identifier to object to. That is not a convenient reading;
 * it is the property the whole two-tier design was built to have, and it is what lets the site
 * measure the visitors who leave during the loader, who by definition never answer a bar.
 *
 * Tier 2 is the part that waits, and it waits inside `record()` — the visitor id simply does not
 * exist until consent is given, so every event before that is tier 1 by construction rather than by
 * a flag someone could forget to check.
 *
 * ⚠ A VISITOR SENDING GPC STILL GETS TIER 1, and that is deliberate rather than an oversight.
 * Global Privacy Control is an objection to being tracked; `consent.ts` honours it by refusing to
 * create an identifier and by never showing them the bar. Anonymous counts with nothing stored are
 * not what that signal is about, and stopping them would cost the site its drop-off data for exactly
 * the most privacy-conscious slice of its traffic while protecting nobody from anything.
 *
 * ── ⚠ NOT GATED ON PRODUCTION, UNLIKE `TelemetryConsole` ───────────────────────────────────────
 * That component is a diagnostic and is compiled out of a production bundle. This is the opposite: it
 * is for production and is useless anywhere else. The two look similar and mean opposite things,
 * which is exactly why this does not live in `lib/telemetry*`.
 *
 * ⚠ StrictMode double-mounts every effect in development. `startJourneyCollector` is idempotent, so
 * the second call is a no-op rather than a second set of listeners and a doubled count.
 */
export default function JourneyCollector() {
  const pathname = usePathname();

  useEffect(() => {
    startJourneyCollector();
    // ⚠ NO CLEANUP, deliberately. The collector is a page-lifetime singleton whose last act is a
    // `pagehide` beacon; tearing it down on unmount would mean a route change in the App Router
    // silently ended measurement for the rest of the visit, and would drop whatever was buffered.
  }, []);

  // ⚠ AN APP ROUTER NAVIGATION IS NOT A PAGE LOAD, and the cursor tracker is the half that noticed.
  // Events re-read `location.pathname` every time one is built, but a cursor grid carries the route it
  // was OPENED on — so without this, walking from `/` to `/about` through a `next/link` filed the
  // `/about` heatmap under `/`. The collector closes the open summary before accepting the new route,
  // so each half lands where it was actually gathered.
  useEffect(() => {
    if (pathname) noteJourneyRouteChange(pathname);
  }, [pathname]);

  return null;
}
