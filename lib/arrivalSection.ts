import { findNavItem } from '@/components/layout/Navbar/navItems';

/**
 * The section named in the URL when the homepage was opened — `/#work`, `/#faq`, and so on.
 *
 * ── Why this is its own module ───────────────────────────────────────────────────────────────────
 * Three places need the answer and they cannot each go and read `location.hash`, because reading it
 * is not free: the hash has to be SPENT. Left in the URL it re-triggers the journey on a reload — and
 * on the loop's teleport back to the hero, which would take a visitor who has just come full circle
 * and immediately fling them back to the section they arrived at weeks of scrolling ago. So the first
 * reader consumes it and every later reader gets the memoised answer.
 *
 * The three, and why each needs it:
 *   · `introEvents.minimumLoaderMs` — an arrival gets a shorter floor on the show (see there).
 *   · `IntroSequence` — the finale hands off to the destination instead of to the hero.
 *   · `useHeroAnimation` — the hero is settled rather than played, and a net covers a missing intro.
 *
 * They mount in an order React decides and this file does not want to know about. Whoever asks first
 * spends the hash; the rest agree with them.
 *
 * ── ⚠ It is a NAV KEY, not any hash ──────────────────────────────────────────────────────────────
 * Validated through `findNavItem`, so `/#pricing` or a stray fragment from somewhere else is `null`
 * and the site opens on the hero exactly as it always has. An unrecognised hash must not put the
 * loader into a branch whose whole job is to travel somewhere.
 */

/** `undefined` = not asked yet. `null` = asked, and there was nothing there. */
let resolvedArrivalSection: string | null | undefined;

export function readArrivalSection(): string | null {
  // No memo on the server: there is no URL to read and no history to rewrite, and caching `null` here
  // would answer for the client too if this module were ever evaluated in both.
  if (typeof window === 'undefined') return null;
  if (resolvedArrivalSection !== undefined) return resolvedArrivalSection;

  const key = window.location.hash.slice(1);
  resolvedArrivalSection = key && findNavItem(key) ? key : null;

  if (resolvedArrivalSection) {
    // Spend it. `replaceState` rather than clearing `location.hash`, which would push a history entry
    // and put a back button on the page that appears to do nothing.
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
  }

  return resolvedArrivalSection;
}
