/**
 * Turning recognition off, properly — on this device AND on the server.
 *
 * ── ⚠ THE ORDER IS THE ENTIRE POINT OF THIS FILE ───────────────────────────────────────────────
 * `setJourneyConsent('denied')` erases the visitor id from localStorage SYNCHRONOUSLY, which is
 * correct and is what the privacy notice promises. It also means that by the time it returns there is
 * nothing left to tell the server about — so a naive implementation deletes the local copy and leaves
 * every cursor path on the server forever, with the control reporting success.
 *
 * So: read the id, send it, and only then withdraw. Nothing else in the codebase enforces this, which
 * is why the two steps live in one function that callers use instead of `setJourneyConsent` directly.
 *
 * ⚠ The request is NOT awaited before withdrawing locally. The visitor's own device is the copy they
 * can see, and it should go immediately rather than after a network round trip that might fail. The
 * id has already been captured into the request body by then, so the erase cannot race it.
 */

import { JOURNEY_INTAKE_PATH } from './events';
import { setJourneyConsent } from './consent';
import { getVisitorId } from './visitorId';

const FORGET_PATH = `${JOURNEY_INTAKE_PATH}/forget`;

export function withdrawJourneyConsent(): void {
  if (typeof window === 'undefined') return;

  // ⚠ Captured BEFORE the withdrawal. See the header.
  const visitorId = getVisitorId();

  if (visitorId) {
    void fetch(FORGET_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorId }),
      // Survives the page being closed in the same gesture — someone may well withdraw and leave.
      keepalive: true,
    }).catch(() => {
      // Silent here on purpose. The local erase below has already happened and is the half the
      // visitor can verify; the panel logs a failed withdrawal loudly at its own end.
    });
  }

  setJourneyConsent('denied');
}
