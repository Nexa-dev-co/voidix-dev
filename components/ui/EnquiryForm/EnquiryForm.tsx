'use client';

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FocusEvent,
  type FormEvent,
} from 'react';
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
 * ── The two variants ─────────────────────────────────────────────────────────────────────────────
 * `'enquiry'` is the original: only the email required, everything else an invitation — there is
 * exactly one thing the form cannot do its job without, a way to reply, and a required-field wall in
 * front of a first message costs more conversations than the tidier inbox is worth.
 *
 * `'application'` is careers'. A job application without a name or any work to read is not an
 * application, so it requires name, email, and THE WORK — a link and/or one PDF ≤ 5 MB, at least one
 * of the two. ⚠ The either-of rule cannot be a `required` attribute (marking both would demand both),
 * so it is checked on submit and told to the visitor in a `role="alert"` line under the fieldset.
 *
 * ── ⚠ VALIDATION IS OURS NOW, AND THE FORM CARRIES `noValidate` ──────────────────────────────────
 * This file used to say "native constraint validation only". That is no longer true and the attribute
 * is the reason: with the browser's own checking left on, a bad email produced a NATIVE BUBBLE at
 * submit while the same field's inline message sat underneath it — two answers to one mistake, in two
 * visual languages, one of which cannot be styled or translated by us.
 *
 * So the browser's submit-time UI is suppressed and every message is drawn in the panel. `required`
 * and `type="email"` STAY on the inputs regardless: they are what tell assistive tech the field is
 * mandatory and what puts the right keyboard up on a phone. Only the browser's popup is given up.
 *
 * Fields validate on BLUR, never per keystroke — an error thrown while someone is halfway through
 * typing their address is the form calling them wrong for not having finished. Once a field is showing
 * an error it re-checks on every change, so the message clears the moment it is fixed rather than
 * waiting for another blur.
 *
 * ── ⚠ FRONT END ONLY, AND IT SAYS SO OUT LOUD ────────────────────────────────────────────────────
 * There is no endpoint until the admin dashboard is connected (see `careersContent.ts`'s header for
 * the payload contract). What this must never do is LOOK like it worked. A silent button is bad; a
 * fake "thank you" on a job application is worse, because the person walks away believing they
 * applied. So submission runs the whole validation path and then reports `not-connected` in plain
 * words. Wiring it is a `fetch` where `SUBMIT_TARGET` is marked, plus deleting one branch.
 */

/** The CV's ceiling. 5 MB holds any honest CV; past it is usually a portfolio that belongs in the link. */
const CV_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * ⚠ DELIBERATELY LOOSE. Something before an @, something after it, a dot, and at least two more
 * characters. It is not RFC 5322 and must not become it: the full grammar permits quoted strings and
 * bracketed IP literals, and every "strict" regex in circulation rejects real addresses — a plus sign,
 * an apostrophe, a new TLD. The only authority on whether an address exists is a message arriving at
 * it, so this catches the typo (`name@gmail`, a stray space) and lets everything else through.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * ⚠ COUNTED, NOT PATTERNED, and this file previously argued for no phone check at all — "there is no
 * format on earth that covers every country's numbers, and a pattern that rejects a real number is
 * worse than no pattern at all". That reasoning still stands and this respects it: nothing here
 * demands a shape. It strips the separators people legitimately type (`+ ( ) - .` and spaces) and
 * asks only whether what remains could be a phone number at all.
 *
 * E.164 caps a full international number at 15 digits. The floor is 6 rather than a national minimum,
 * because being generous costs a typo getting through and being strict costs a real applicant.
 */
const PHONE_ALLOWED_CHARACTERS = /^[+\d\s().-]+$/;
const PHONE_MIN_DIGITS = 6;
const PHONE_MAX_DIGITS = 15;

/**
 * Where the form is in its own lifecycle.
 *
 * `not-connected` is the temporary one and the only one that should ever be deleted — see the header.
 * `sending` / `sent` / `error` are already wired to the button and the live region, so connecting the
 * endpoint changes the handler and nothing else.
 */
type SubmitStatus = 'idle' | 'sending' | 'sent' | 'error' | 'not-connected';

/** ⚠ DELETE WITH THE `not-connected` BRANCH once the dashboard endpoint exists. */
const NOT_CONNECTED_MESSAGE =
  'Nothing was sent — this form is not connected yet. Please try again once we are live.';

const SENT_MESSAGE = 'Sent. You will hear back from a person, either way.';
const ERROR_MESSAGE = 'That did not send. Try again in a moment.';

type ValidatedField = 'name' | 'email' | 'phone';
type FieldErrors = Partial<Record<ValidatedField, string>>;

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
  /** `'application'` adds the work fieldset and the stricter required rules — see the header. */
  variant?: 'enquiry' | 'application';
  /**
   * Whether to PRINT the subject. It is always submitted; this only governs the visible box, which the
   * application hides because the dialog's own title already says the role. See EnquiryPanel.
   */
  showSubject?: boolean;
  /**
   * Offered only where the answer isn't already known — the OPEN application. A posted role states its
   * own terms in the row you opened it from, so asking there would be the form doubting the page.
   */
  commitmentOptions?: readonly string[];
  commitmentLabel?: string;
}

/** Bytes as something a person reads. Files this size are always MB, so there is no unit table. */
function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateName(value: string, isRequired: boolean): string | undefined {
  if (!isRequired) return undefined;
  return value.trim() ? undefined : 'We need something to call you.';
}

function validateEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'We need an address to reply to.';
  if (!EMAIL_PATTERN.test(trimmed)) return 'That does not look like an email address.';
  return undefined;
}

/** Optional everywhere, so an empty value is always fine — see the constants for what "valid" means. */
function validatePhone(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!PHONE_ALLOWED_CHARACTERS.test(trimmed)) {
    return 'Numbers only — digits, spaces and + ( ) - are fine.';
  }
  const digitCount = trimmed.replace(/\D/g, '').length;
  if (digitCount < PHONE_MIN_DIGITS) return 'That looks too short for a phone number.';
  if (digitCount > PHONE_MAX_DIGITS) return 'That looks too long for a phone number.';
  return undefined;
}

export default function EnquiryForm({
  prefill,
  briefLabel = 'What you are building',
  submitLabel = 'Send it',
  variant = 'enquiry',
  showSubject = true,
  commitmentOptions,
  commitmentLabel = 'What you are looking for',
}: EnquiryFormProps) {
  const fieldId = useId();
  const nameId = `${fieldId}-name`;
  const emailId = `${fieldId}-email`;
  const phoneId = `${fieldId}-phone`;
  const briefId = `${fieldId}-brief`;
  const commitmentLegendId = `${fieldId}-commitment`;
  const workLegendId = `${fieldId}-work-legend`;
  const workLinkId = `${fieldId}-work-link`;
  const cvFileId = `${fieldId}-cv-file`;
  const workErrorId = `${fieldId}-work-error`;

  const isApplication = variant === 'application';
  const asksCommitment = Boolean(commitmentOptions && commitmentOptions.length > 0);
  const cvInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [workError, setWorkError] = useState<string | null>(null);
  const [cvFile, setCvFile] = useState<{ name: string; size: number } | null>(null);
  const [isDraggingCv, setIsDraggingCv] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>('idle');

  const errorIdFor = (field: ValidatedField) => `${fieldId}-${field}-error`;

  const checkField = (field: ValidatedField, value: string): string | undefined => {
    if (field === 'name') return validateName(value, isApplication);
    if (field === 'email') return validateEmail(value);
    return validatePhone(value);
  };

  const setFieldError = (field: ValidatedField, message: string | undefined) => {
    setFieldErrors((current) => {
      if (current[field] === message) return current;
      const next = { ...current };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  };

  /** On blur: the visitor has finished with the field, so it is fair to judge it. */
  const handleFieldBlur =
    (field: ValidatedField) => (event: FocusEvent<HTMLInputElement>) => {
      setFieldError(field, checkField(field, event.target.value));
    };

  /**
   * On change: only ever CLEARS. A field that is not yet complaining stays quiet while it is being
   * typed into; one that is complaining re-checks every keystroke, so the message disappears the
   * instant the address is right rather than making them blur to find out.
   */
  const handleFieldChange =
    (field: ValidatedField) => (event: ChangeEvent<HTMLInputElement>) => {
      if (!fieldErrors[field]) return;
      setFieldError(field, checkField(field, event.target.value));
    };

  /**
   * The one place a chosen file is judged, whichever way it arrived — the picker or a drop.
   *
   * Rejecting here rather than at submit matters: by submit the visitor has moved on, and the
   * correction costs them a scroll back to a field they thought they had finished. A rejected file is
   * also CLEARED, so the "either of" check below can trust whatever the input still holds.
   */
  const adoptCvFile = (chosenFile: File | undefined): void => {
    if (!chosenFile) {
      setCvFile(null);
      setWorkError(null);
      return;
    }

    const clearInput = () => {
      if (cvInputRef.current) cvInputRef.current.value = '';
      setCvFile(null);
    };

    // ⚠ Tested by TYPE and by extension. A PDF dragged out of some file managers arrives with an empty
    // `type`, and rejecting it would be rejecting a perfectly good CV for its courier's sake.
    const looksLikePdf =
      chosenFile.type === 'application/pdf' || chosenFile.name.toLowerCase().endsWith('.pdf');

    if (!looksLikePdf) {
      clearInput();
      setWorkError('The CV needs to be a PDF.');
      return;
    }
    if (chosenFile.size > CV_FILE_MAX_BYTES) {
      clearInput();
      setWorkError(`That file is ${formatFileSize(chosenFile.size)} — the limit is 5 MB.`);
      return;
    }

    setCvFile({ name: chosenFile.name, size: chosenFile.size });
    setWorkError(null);
  };

  const handleCvFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    adoptCvFile(event.target.files?.[0]);
  };

  const handleCvDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingCv(false);

    const droppedFile = event.dataTransfer.files?.[0];
    if (!droppedFile) return;

    // ⚠ The input's own `files` is assigned from the drop's DataTransfer, not just read out of it.
    // Without this the file would live in React state and be missing from the FormData the endpoint
    // eventually posts — a CV that the visitor can see attached and the studio never receives.
    if (cvInputRef.current) cvInputRef.current.files = event.dataTransfer.files;
    adoptCvFile(droppedFile);
  };

  const clearCvFile = () => {
    if (cvInputRef.current) cvInputRef.current.value = '';
    setCvFile(null);
    setWorkError(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const readField = (name: string) => String(formData.get(name) ?? '');

    const nextErrors: FieldErrors = {};
    const nameError = validateName(readField('name'), isApplication);
    const emailError = validateEmail(readField('email'));
    const phoneError = validatePhone(readField('phone'));
    if (nameError) nextErrors.name = nameError;
    if (emailError) nextErrors.email = emailError;
    if (phoneError) nextErrors.phone = phoneError;
    setFieldErrors(nextErrors);

    let nextWorkError: string | null = null;
    if (isApplication) {
      const workLink = readField('workLink').trim();
      const submittedCv = formData.get('cvFile');
      const hasCvFile = submittedCv instanceof File && submittedCv.size > 0;
      if (!workLink && !hasCvFile) {
        nextWorkError = 'We need something to read — a link, a CV, either will do.';
      }
    }
    setWorkError(nextWorkError);

    const firstInvalidField = (['name', 'email', 'phone'] as const).find(
      (field) => nextErrors[field],
    );

    if (firstInvalidField || nextWorkError) {
      // ⚠ Focus moves to the first thing wrong. Without the browser's own submit UI (see the header)
      // nothing else would take the visitor to it — in a panel that scrolls, the message they need to
      // read can easily be off screen at the moment they press the button.
      const target = firstInvalidField
        ? formRef.current?.elements.namedItem(firstInvalidField)
        : cvInputRef.current;
      if (target instanceof HTMLElement) target.focus();
      return;
    }

    // ── SUBMIT_TARGET ──
    // The endpoint goes here: `setStatus('sending')`, POST the FormData (multipart — see the form's
    // encType), then `setStatus('sent')` or `setStatus('error')`. Until then the form refuses to
    // pretend, for the reason in the header.
    setStatus('not-connected');
  };

  const statusMessage =
    status === 'sent'
      ? SENT_MESSAGE
      : status === 'error'
        ? ERROR_MESSAGE
        : status === 'not-connected'
          ? NOT_CONNECTED_MESSAGE
          : null;

  /** Every validated field is drawn the same way, down to the wiring between input and message. */
  const fieldProps = (field: ValidatedField) => ({
    onBlur: handleFieldBlur(field),
    onChange: handleFieldChange(field),
    'aria-invalid': fieldErrors[field] ? true : undefined,
    'aria-describedby': fieldErrors[field] ? errorIdFor(field) : undefined,
  });

  return (
    <form
      ref={formRef}
      className={isApplication ? 'enquiry-form enquiry-form--application' : 'enquiry-form'}
      onSubmit={handleSubmit}
      // ⚠ Suppresses the browser's submit-time bubbles ONLY — the attributes stay on the inputs. See
      // the header: with both running, one mistake produced two messages in two visual languages.
      noValidate
      // ⚠ The application carries a file, and the default urlencoded encoding would send the filename
      // rather than the PDF. Stated now, while nothing posts, so connecting the dashboard's endpoint
      // is one attribute rather than one bug.
      {...(isApplication ? { encType: 'multipart/form-data' } : {})}
    >
      {/* The subject is stated rather than editable: it is the answer to "which of your things is this
          about", and the visitor already answered it by choosing where to click. The hidden field runs
          whether or not the box is drawn — see `showSubject`. */}
      {prefill && (
        <>
          {showSubject && (
            <p className="enquiry-subject">
              <span className="enquiry-subject-label">About</span>
              <span className="enquiry-subject-value">{prefill.subject}</span>
            </p>
          )}
          <input type="hidden" name="subject" value={prefill.subject} readOnly />
        </>
      )}

      {/* ⚠ `--pair` is a HEIGHT affordance, not a width one, and it does nothing at all until the
          frame is short: the two shortest labels in the form are the two that step into one row when
          a landscape phone leaves width as the only resource left. See the SHORT FRAMES block in
          globals.css. It marks the fields that MAY pair — the media query decides whether they do. */}
      <div className="enquiry-field enquiry-field--pair">
        <label className="enquiry-label" htmlFor={nameId}>
          Name
          {isApplication && (
            <span className="enquiry-required" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <input
          id={nameId}
          name="name"
          type="text"
          className="enquiry-input"
          autoComplete="name"
          required={isApplication}
          {...fieldProps('name')}
        />
        {fieldErrors.name && (
          <p className="enquiry-field-error" id={errorIdFor('name')}>
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div className="enquiry-field enquiry-field--pair">
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
          {...fieldProps('email')}
        />
        {fieldErrors.email && (
          <p className="enquiry-field-error" id={errorIdFor('email')}>
            {fieldErrors.email}
          </p>
        )}
      </div>

      {/* `type="tel"` rather than `text`: it is what puts the numeric keypad up on a phone. It carries
          no `pattern` — the check is in `validatePhone`, which counts digits rather than demanding a
          shape, for the reason set out beside that constant. */}
      <div className="enquiry-field enquiry-field--half">
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
          {...fieldProps('phone')}
        />
        {fieldErrors.phone && (
          <p className="enquiry-field-error" id={errorIdFor('phone')}>
            {fieldErrors.phone}
          </p>
        )}
      </div>

      {/* Fills the cell beside Mobile, and earns it: three asterisks scattered down a seven-field form
          read as "most of this is compulsory", which is the opposite of true here. */}
      {isApplication && (
        <p className="enquiry-aside enquiry-field--half">
          Only your name, your email and one piece of work are required.
        </p>
      )}

      {/* ⚠ RADIOS, NOT A `<select>`, and with three options that is the textbook call rather than a
          preference: every choice is visible without a press, choosing costs one tap instead of two,
          and a native dropdown's list is drawn by the OS — on a translucent dark panel it arrives as a
          white system menu that no stylesheet on this site can reach. A select earns its place at
          five-plus options; this has three. */}
      {asksCommitment && (
        <fieldset className="enquiry-choice">
          <legend className="enquiry-label" id={commitmentLegendId}>
            {commitmentLabel}
          </legend>
          <div className="enquiry-choice-options">
            {commitmentOptions?.map((option) => (
              <label key={option} className="enquiry-choice-option">
                <input
                  type="radio"
                  name="commitment"
                  value={option}
                  className="enquiry-choice-input"
                />
                <span className="enquiry-choice-chip">{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* The work — the one thing an application cannot arrive without, and the process copy's own
          promise ("a note and a link") made into fields. ⚠ `type="text"` on the link, not `type="url"`:
          native url validation demands a scheme, and "behance.net/me" failing with a cryptic message
          costs more applications than an unvalidated string ever will — the same reasoning as the
          phone field above. */}
      {isApplication && (
        <div
          className="enquiry-work"
          role="group"
          aria-labelledby={workLegendId}
          aria-describedby={workError ? workErrorId : undefined}
        >
          <p className="enquiry-label" id={workLegendId}>
            The work — at least one of the two
            <span className="enquiry-required" aria-hidden="true">
              *
            </span>
          </p>

          <div className="enquiry-work-fields">
            <div className="enquiry-field">
              <label className="enquiry-label enquiry-work-sublabel" htmlFor={workLinkId}>
                A link — portfolio, repository, something shipped
              </label>
              <input
                id={workLinkId}
                name="workLink"
                type="text"
                inputMode="url"
                className="enquiry-input"
                autoComplete="url"
                onChange={() => setWorkError(null)}
              />
            </div>

            <div className="enquiry-field">
              <p className="enquiry-label enquiry-work-sublabel">Or a CV — one PDF, up to 5 MB</p>

              {/* ⚠ The input is a REAL file input laid transparently over the whole zone, not a hidden
                  one triggered by script: it keeps the native picker, the tab stop and the screen
                  reader's "button, file upload" without a line of ARIA. The label under it is what the
                  eye reads, and it must not intercept the pointer. */}
              <div
                className="enquiry-drop"
                data-dragging={isDraggingCv}
                data-filled={cvFile !== null}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingCv(true);
                }}
                onDragLeave={() => setIsDraggingCv(false)}
                onDrop={handleCvDrop}
              >
                <input
                  ref={cvInputRef}
                  id={cvFileId}
                  name="cvFile"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="enquiry-drop-input"
                  onChange={handleCvFileChange}
                />
                <label className="enquiry-drop-label" htmlFor={cvFileId}>
                  {cvFile ? (
                    <>
                      <span className="enquiry-drop-file">{cvFile.name}</span>
                      <span className="enquiry-drop-size">{formatFileSize(cvFile.size)}</span>
                    </>
                  ) : (
                    <>
                      <span className="enquiry-drop-lead">Drop a PDF here</span>
                      <span className="enquiry-drop-hint">or choose a file</span>
                    </>
                  )}
                </label>

                {/* Sits ABOVE the transparent input so a press removes rather than reopening the
                    picker — which is the one thing this button must not do. */}
                {cvFile && (
                  <button
                    type="button"
                    className="enquiry-drop-clear"
                    onClick={clearCvFile}
                    aria-label={`Remove ${cvFile.name}`}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {workError && (
            <p className="enquiry-work-error" id={workErrorId} role="alert">
              {workError}
            </p>
          )}
        </div>
      )}

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

      {/* ⚠ STICKY, and it is the fix for the whole panel. The application form is ~780px of content in a
          panel that is ~510px tall on a laptop, so the submit button used to sit below the fold inside
          a modal — reachable only by finding a scrollbar nobody looks for. Here it never leaves. */}
      <div className="enquiry-actions">
        <button type="submit" className="enquiry-send" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : submitLabel}
        </button>

        {/* Polite, not assertive: it follows a press the visitor made, so it is an answer rather than
            an interruption. Always rendered, so the region exists before it has anything to say. */}
        <p className="enquiry-status" data-status={status} role="status" aria-live="polite">
          {statusMessage}
        </p>
      </div>
    </form>
  );
}
