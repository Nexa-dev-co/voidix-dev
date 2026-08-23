/**
 * The per-tab id that stitches one visit's events together.
 *
 * ── ⚠ THIS IS NOT AN IDENTIFIER, AND THE DIFFERENCE IS THE WHOLE TIER 1 PROMISE ─────────────────
 * It is generated in memory, never written to localStorage, never written to a cookie, and gone the
 * moment the tab closes. Two visits by the same person share nothing — not the id, not anything
 * derived from it — so it cannot recognise anybody, which is exactly why tier 1 needs no consent
 * while `visitorId` does.
 *
 * ⚠ A module-level `let`, deliberately, and NOT `sessionStorage` — which sounds like the obvious home
 * for a per-session value and is not. `sessionStorage` survives a reload and is restored on a
 * back-navigation, so it would quietly turn "this tab, right now" into "this tab, across however many
 * page loads", which is a weaker promise than the one the privacy notice makes. It also persists to
 * disk, which is the thing tier 1 says it does not do.
 *
 * ⚠ The consequence is real and is accepted: a reload is a NEW SESSION. Visit counts therefore count
 * page loads that reached the loader rather than people, and every figure the dashboard draws off
 * this is honest about being that.
 */

import { createUuid } from './uuid';

let sessionId: string | undefined;

/**
 * Returns undefined only where `crypto` is unavailable — in which case nothing can be recorded at
 * all, which the collector treats as a reason to stay switched off rather than to invent an id.
 */
export function getSessionId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  if (!sessionId) sessionId = createUuid();
  return sessionId;
}
