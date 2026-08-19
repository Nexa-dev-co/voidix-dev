/**
 * The tier 2 identifier — the one thing consent actually buys.
 *
 * ── ⚠ THIS IS THE ONLY FILE ON THE SITE THAT CAN RECOGNISE A PERSON ─────────────────────────────
 * Everything else the journey layer records is a count. This is the exception, it exists only with
 * permission, and it is deliberately the smallest possible thing that could do the job: one random
 * UUID, generated on this device, meaning nothing anywhere else.
 *
 * It is not derived from anything. No fingerprint, no hash of an address, no canvas, no font list,
 * nothing about the machine at all — so it cannot be reconstructed after it is deleted, and two
 * visitors who clear their storage are two new people rather than the same two coming back. That is
 * the property that makes the delete on withdrawal real rather than cosmetic.
 *
 * ── ⚠ NEVER CALL THIS WITHOUT CHECKING CONSENT — AND IT CHECKS ANYWAY ───────────────────────────
 * `getVisitorId` returns `undefined` unless consent is `granted`, and it will not create an id in
 * passing. The collector is expected to check too; this is the second lock, on the door that matters.
 * A caller that "just needs an id for a moment" is describing tier 2 whether it means to or not.
 */

import {
  isJourneyConsentGranted,
  JOURNEY_VISITOR_STORAGE_KEY,
} from './consent';
import { createUuid } from './uuid';

/**
 * The id for this visitor, creating one on first use — but only ever with consent.
 *
 * Returns `undefined` for every tier 1 visitor, which is what the collector puts in the payload:
 * absent, never null and never a placeholder. See `events.ts` on why that distinction is the whole
 * guarantee rather than a stylistic preference.
 */
export function getVisitorId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  if (!isJourneyConsentGranted()) return undefined;

  try {
    const existing = window.localStorage.getItem(JOURNEY_VISITOR_STORAGE_KEY);
    if (existing) return existing;

    const created = createUuid();
    if (!created) return undefined;

    window.localStorage.setItem(JOURNEY_VISITOR_STORAGE_KEY, created);
    return created;
  } catch {
    // Safari private browsing throws. A visitor who consented but cannot persist simply stays
    // effectively tier 1 rather than the site failing — the same survivable-degradation choice
    // `motionPreference` makes for the same reason.
  }
  return undefined;
}

/**
 * ⚠ Exported for completeness and for tests, NOT as the withdrawal path.
 *
 * Withdrawal goes through `setJourneyConsent('denied')`, which erases this key itself — deliberately,
 * so that revoking consent and destroying the identifier cannot come apart. If a caller could
 * withdraw without deleting, or delete without withdrawing, there would be a state where the site
 * believes it has permission it has lost, or holds an id it has no permission for.
 */
export function clearVisitorId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(JOURNEY_VISITOR_STORAGE_KEY);
  } catch {
    // See getVisitorId.
  }
}
