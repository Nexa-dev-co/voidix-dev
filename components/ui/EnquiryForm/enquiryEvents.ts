/**
 * The contact funnel, narrated — opened, started, stepped, sent, refused.
 *
 * ── ⚠ THE FORM SAYS WHAT HAPPENED; IT DOES NOT SAY WHAT IT MEANS ────────────────────────────────
 * Every event here carries only what this component genuinely knows. It does not know which section
 * the visitor was standing in when they opened it, and it must not go looking: `EnquiryPanel` is
 * rendered from seven places across four routes, and the pin already publishes where the journey is.
 * Whoever listens derives the origin. That is the same division `STOP_COMMIT_EVENT` draws — the
 * component narrates, the listener does the arithmetic.
 *
 * ⚠ `enquiry:error` reports the ROUTE'S OWN REASON and never a field value. The three below are
 * exactly the branches `handleSubmit` already distinguishes, and none of them can carry a word the
 * visitor typed — which is the one thing the journey layer may never transport.
 */

/** The panel was opened. Not fired by the contact section's form, which is never opened — it is there. */
export const ENQUIRY_OPEN_EVENT = 'voidix:enquiry-open';

/** The first keystroke in any field. Fired once per mounted form — see the guard in `EnquiryForm`. */
export const ENQUIRY_START_EVENT = 'voidix:enquiry-start';

/** A step boundary was crossed, in either direction. `index` is the step LANDED ON, 0-based. */
export const ENQUIRY_STEP_EVENT = 'voidix:enquiry-step';

/** The panel accepted it. */
export const ENQUIRY_SUBMIT_EVENT = 'voidix:enquiry-submit';

/** It did not send. */
export const ENQUIRY_ERROR_EVENT = 'voidix:enquiry-error';

export type EnquiryVariant = 'enquiry' | 'application';

/** ⚠ Mirrors the `enquiry:error` reasons in `lib/journey/events.ts`. Change one, change the other. */
export type EnquiryErrorReason = 'invalid' | 'rate-limited' | 'unavailable';

export interface EnquiryVariantDetail {
  variant: EnquiryVariant;
}

export interface EnquiryStepDetail {
  index: number;
}

export interface EnquiryErrorDetail {
  reason: EnquiryErrorReason;
}

export function readEnquiryVariant(event: Event): EnquiryVariant {
  const detail = (event as CustomEvent<EnquiryVariantDetail>).detail;
  return detail?.variant === 'application' ? 'application' : 'enquiry';
}

export function readEnquiryStep(event: Event): number | null {
  const detail = (event as CustomEvent<EnquiryStepDetail>).detail;
  return typeof detail?.index === 'number' ? detail.index : null;
}

export function readEnquiryErrorReason(event: Event): EnquiryErrorReason {
  const detail = (event as CustomEvent<EnquiryErrorDetail>).detail;
  const reason = detail?.reason;
  // ⚠ Anything unrecognised is 'unavailable' rather than dropped. A funnel that silently loses its
  // failures reads as a funnel where nothing fails, which is the most flattering possible lie.
  return reason === 'invalid' || reason === 'rate-limited' ? reason : 'unavailable';
}
