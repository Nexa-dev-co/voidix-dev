'use client';

import { useId, type FormEvent } from 'react';
import type { EnquiryPrefill } from '@/lib/enquirySubjects';

/**
 * The site's one contact form, wherever it appears — the contact section's panel, its phone sheet, and
 * the enquiry dialog every service and every project opens.
 *
 * ── ⚠ WHY THE IDS COME FROM `useId` ──────────────────────────────────────────────────────────────
 * Every section past the hero is an overlay inside ONE pin, so they are all mounted at once — and each
 * of them can hold a copy of this form (contact's, the fleet's, the field's). Hard-coded ids would
 * therefore exist three times in one document, and a `<label for>` pointing at three elements resolves
 * to whichever came first: every label on the page would focus the contact section's field. This is the
 * same trap the contact section documented when it had only two copies to worry about.
 *
 * ── ⚠ ONLY THE EMAIL IS REQUIRED ─────────────────────────────────────────────────────────────────
 * Every other field is optional, deliberately. There is exactly one thing this form cannot do its job
 * without — a way to reply — and a required-field wall in front of a first message costs more
 * conversations than the tidier inbox is worth. The asterisk marks the one that matters; the rest are
 * invitations. (`required` on the email also carries that to assistive tech, so the mark is decorative
 * and `aria-hidden`.)
 *
 * ── ⚠ FRONT END ONLY ─────────────────────────────────────────────────────────────────────────────
 * Native constraint validation only (`required`, `type="email"`) — this project has no validation
 * library and CLAUDE.md is explicit that this is deliberate. Submission is PREVENTED rather than left
 * to navigate: there is no endpoint yet, and a form that navigated would throw the page out of the pin.
 * It deliberately does not fake a success state the visitor would believe.
 */

interface EnquiryFormProps {
  /**
   * What the visitor was looking at when they opened this. Absent on the contact section, where the
   * form is the destination rather than a follow-on from something — and in the chamber, where the
   * question they are asking IS the subject.
   */
  prefill?: EnquiryPrefill;
  /** Names the long field. The chamber asks for a question, not for a brief. */
  briefLabel?: string;
  /** Wording of the submit button — the enquiry dialog asks for something more specific than "Send it". */
  submitLabel?: string;
}

export default function EnquiryForm({
  prefill,
  briefLabel = 'What you are building',
  submitLabel = 'Send it',
}: EnquiryFormProps) {
  const fieldId = useId();
  const nameId = `${fieldId}-name`;
  const emailId = `${fieldId}-email`;
  const phoneId = `${fieldId}-phone`;
  const briefId = `${fieldId}-brief`;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  return (
    <form className="enquiry-form" onSubmit={handleSubmit}>
      {/* The subject is stated rather than editable: it is the answer to "which of your things is this
          about", and the visitor already answered it by choosing where to click. Carried as a hidden
          field so whatever endpoint this eventually posts to receives it too. */}
      {prefill && (
        <p className="enquiry-subject">
          <span className="enquiry-subject-label">About</span>
          <span className="enquiry-subject-value">{prefill.subject}</span>
          <input type="hidden" name="subject" value={prefill.subject} readOnly />
        </p>
      )}

      <div className="enquiry-field">
        <label className="enquiry-label" htmlFor={nameId}>
          Name
        </label>
        <input id={nameId} name="name" type="text" className="enquiry-input" autoComplete="name" />
      </div>

      <div className="enquiry-field">
        <label className="enquiry-label" htmlFor={emailId}>
          Email
          <span className="enquiry-required" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          className="enquiry-input"
          autoComplete="email"
          required
        />
      </div>

      {/* `type="tel"` rather than `text`: it is what puts the numeric keypad up on a phone, and it does
          NOT validate — there is no format on earth that covers every country's numbers, and a pattern
          that rejects a real number is worse than no pattern at all. */}
      <div className="enquiry-field">
        <label className="enquiry-label" htmlFor={phoneId}>
          Mobile
        </label>
        <input
          id={phoneId}
          name="phone"
          type="tel"
          inputMode="tel"
          className="enquiry-input"
          autoComplete="tel"
        />
      </div>

      <div className="enquiry-field">
        <label className="enquiry-label" htmlFor={briefId}>
          {briefLabel}
        </label>
        {/* `defaultValue`, not `value` — the seed is a starting point the visitor immediately edits, so
            the field has to be theirs from the first keystroke. ⚠ That makes it a MOUNT-TIME value:
            whoever renders this must re-key the form when the prefill changes, or a second service's
            dialog would open holding the first one's sentence. See EnquiryPanel. */}
        <textarea
          id={briefId}
          name="brief"
          className="enquiry-input enquiry-textarea"
          rows={3}
          defaultValue={prefill?.brief ?? ''}
        />
      </div>

      <button type="submit" className="enquiry-send">
        {submitLabel}
      </button>
    </form>
  );
}
