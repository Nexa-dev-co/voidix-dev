'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FocusEvent,
  type FormEvent,
} from 'react';
import type { EnquiryPrefill } from '@/lib/enquirySubjects';
import { useSiteContent } from '@/lib/cms/SiteContentProvider';
import { useStepTransition } from './useStepTransition';

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
 * ⚠ They are LAID OUT the same way — one grid on `.enquiry-form`. `enquiry-field--half` marks a field
 * as PAIRABLE (Name and Mobile always; Email only in the application, where the aside fills the cell
 * beside it), and a single custom property decides whether pairing actually happens. **The enquiry's
 * default is a field per row**; it pairs only below 608px of viewport height, where a row has to come
 * out of the stack. The application pairs at every height — seven fields are too tall for any frame.
 * This used to be a variant modifier that swapped flex for grid, which made it the sole owner of
 * pairing and left a short screen unable to ask for the same thing.
 *
 * ── ⚠ THE APPLICATION IS TWO STEPS, AND THE REASON IS A HEIGHT BUDGET ────────────────────────────
 * Pairing bought the application one row. It was still ~780px of content in a dialog that is ~370px
 * tall on a landscape phone, so it scrolled — inside a modal, under a sticky bar, which is the worst
 * place on the site to hide the thing a person came to press. Splitting it is the only give left that
 * is structural rather than a few pixels of rhythm:
 *
 *     STEP 01 · You          name*, mobile, email*, and why you
 *     STEP 02 · Your work    what you are looking for, a link, a CV
 *
 * The split is BALANCED rather than tidy — "why you" is a sentence about the work and would file under
 * step 02 on meaning alone. It sits in 01 because 02 carries the drop zone, which is the tallest single
 * control in the form, and two steps that do not fit are worse than one that reads slightly off.
 *
 * ⚠ BOTH STEPS STAY MOUNTED. The inactive one is `hidden`, never unmounted: this is ONE `<form>` posting
 * ONE `FormData`, so a field that stopped existing would stop being sent, and every value already typed
 * would be gone the moment someone stepped back to check it. The endpoint sees a single submit carrying
 * every field — the steps are a layout, not two requests. `hidden` also takes the step out of the tab
 * order and out of the accessibility tree, which is the whole reason not to hide it with opacity.
 * ⚠ `.enquiry-step[hidden]` restores `display: none` — the step is a grid, and a `display` declaration
 * beats the attribute's UA style.
 *
 * ⚠ A fault can therefore land on a step you are not standing on — your own (go back, clear your email,
 * come forward, send) or the server's, since a 422 names fields from both steps. Either way the form
 * moves to that step FIRST and focuses the field once it is on screen: focusing something inside a
 * `hidden` subtree silently does nothing, which would leave the visitor pressing a button that appears
 * to do nothing at all.
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
 * ── WHERE IT POSTS ───────────────────────────────────────────────────────────────────────────────
 * To this site's own routes — `/api/enquiry` and `/api/application` — which forward to the admin
 * panel. Never straight to the panel: its intake is authenticated with a shared secret, and a form
 * that posts from the browser ships that secret to every visitor.
 *
 * ⚠ The two variants have genuinely different endpoints, not one endpoint with a flag. An
 * application is not a lead — the panel keeps candidates and prospects in separate tables with no
 * path between them, because a CV is far more sensitive than an enquiry and the two have opposite
 * relationships to the studio. Do not merge them.
 *
 * ⚠ The whole form is sent as `FormData`, including for the enquiry variant which carries no file.
 * One submit path is easier to reason about than two, and the enquiry route reads form fields just
 * as happily as the application one.
 *
 * ── ⚠ IT MUST NEVER LOOK LIKE IT WORKED WHEN IT DID NOT ─────────────────────────────────────────
 * The rule this file was written under, back when there was no endpoint at all, and it still holds
 * now that there is: a fake "thank you" on a job application is worse than a visible failure,
 * because the person walks away believing they applied. Every failure below says something true and
 * leaves the form filled in so nothing has to be retyped.
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
 * `rate-limited` is separate from `error` because it is the one failure that is both temporary and
 * the visitor's own doing — telling them to try again in a moment is true, where "that did not
 * send" would send them looking for a mistake they have not made.
 */
type SubmitStatus = 'idle' | 'sending' | 'sent' | 'error' | 'rate-limited';

/**
 * ⚠ The ONLY message still written here, and it must stay here. The sent and failed lines are the
 * panel's now (`enquiryFormContent.ts`); this one answers a specific status from the intake route
 * rather than being section copy, and an editor softening it into something reassuring would be
 * rewriting a system message about a limit that is still in force.
 */
const RATE_LIMITED_MESSAGE = 'That is a few too many in one go. Try again in a little while.';

/** Where each variant posts. See the header on why an application does not share the enquiry's route. */
const ENQUIRY_ENDPOINT = '/api/enquiry';
const APPLICATION_ENDPOINT = '/api/application';

/**
 * The hidden field a bot fills in and a person never sees.
 *
 * ⚠ Named to look worth filling in, and it must stay spelled exactly as the panel expects — a typo
 * turns the trap off silently, because the check still runs and simply never finds anything.
 *
 * It is `hidden` rather than merely off-screen, and it carries `tabIndex={-1}` and
 * `autoComplete="off"`, so nothing lands on it by tab and no password manager helpfully fills it.
 */
const HONEYPOT_FIELD = 'website';

/** What the routes answer with when the panel named a field. Keys match this form's input names. */
interface SubmitFailure {
  reason?: string;
  fieldErrors?: Record<string, string>;
}

type ValidatedField = 'name' | 'email' | 'phone';
type FieldErrors = Partial<Record<ValidatedField, string>>;

/**
 * The application's two steps, in order — see the header for why the split falls where it does.
 *
 * ⚠ These names are NOT the panel's, and that is the one string in this file's neighbourhood that
 * stays here on purpose. They name a STRUCTURE this component owns — the same reason "The work — at
 * least one of the two" is still written below rather than fetched. An editor renaming step 02 would
 * be renaming a layout decision they cannot see.
 */
const APPLICATION_STEPS = [
  { key: 'you', name: 'You' },
  { key: 'work', name: 'Your work' },
] as const;

/** Which validated fields belong to step 01, so a fault on step 02 never sends anyone backwards. */
const STEP_ONE_FIELDS: readonly ValidatedField[] = ['name', 'email', 'phone'];

const STEP_CONTINUE_LABEL = 'Continue';
const STEP_BACK_LABEL = 'Back';

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
  // ⚠ The FIELD labels and the status lines are the panel's, site-wide — six places render this form
  // and they must not disagree about what the email box is called. `briefLabel` and `submitLabel`
  // stay props because they are genuine per-section overrides: contact says "Send it", the FAQ asks
  // for a question, an application asks for something else again.
  const { enquiryForm: formContent } = useSiteContent();

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
  // The application is the only thing that steps today, but the mechanism below is keyed on THIS rather
  // than on the variant, so a second stepped form would not have to re-read the variant's meaning.
  const isStepped = isApplication;
  const lastStepIndex = APPLICATION_STEPS.length - 1;

  const asksCommitment = Boolean(commitmentOptions && commitmentOptions.length > 0);
  const cvInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [workError, setWorkError] = useState<string | null>(null);
  const [cvFile, setCvFile] = useState<{ name: string; size: number } | null>(null);
  const [isDraggingCv, setIsDraggingCv] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [stepIndex, setStepIndex] = useState(0);

  /**
   * What to focus once the new step is on screen — a field name when a fault was found behind us,
   * `null` when the step itself should take focus so its name is announced.
   *
   * ⚠ It cannot be done in the handler that changes the step: the destination is still `hidden` at that
   * moment and `focus()` on a hidden element is a no-op. So the intent is recorded and spent in the
   * effect below, which runs after React has swapped the attribute.
   */
  const pendingFocusRef = useRef<ValidatedField | null>(null);
  /** Suppresses the focus move on mount — nothing has stepped yet, and stealing focus on open is rude. */
  const hasSteppedRef = useRef(false);
  /** Which way we are going, so the incoming step slides in from the side it came from. */
  const [stepDirection, setStepDirection] = useState<1 | -1>(1);

  // The panel is sized by its content, so the two steps are two different heights and swapping them
  // would jump — see the hook for why the outgoing height has to be read before React commits.
  const { capturePreviousHeight } = useStepTransition({
    stepsRef,
    stepIndex,
    direction: stepDirection,
  });

  useEffect(() => {
    if (!hasSteppedRef.current) return;

    const pendingField = pendingFocusRef.current;
    pendingFocusRef.current = null;

    if (pendingField) {
      const target = formRef.current?.elements.namedItem(pendingField);
      if (target instanceof HTMLElement) target.focus();
      return;
    }

    // The step group carries the step's name, so focusing it is what tells a screen reader where the
    // form now is. Focusing the first FIELD instead would be worse on a phone: the keyboard would open
    // over a panel whose whole point is that it fits the screen.
    stepsRef.current?.querySelector<HTMLElement>('.enquiry-step:not([hidden])')?.focus();
  }, [stepIndex]);

  const goToStep = (nextIndex: number) => {
    if (nextIndex === stepIndex) return;
    hasSteppedRef.current = true;
    capturePreviousHeight();
    setStepDirection(nextIndex > stepIndex ? 1 : -1);
    // A message about the last press does not survive the press that follows it.
    setStatus('idle');
    setStepIndex(nextIndex);
  };

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

  /**
   * Everything step 01 asks for, judged on its own.
   *
   * Shared by `Continue` and by submit, so the two can never disagree about what a finished step 01
   * looks like — and it returns the fault rather than acting on it, because the two callers do
   * different things with the answer.
   */
  const checkStepOne = (
    formData: FormData,
  ): { errors: FieldErrors; firstInvalid?: ValidatedField } => {
    const readField = (name: string) => String(formData.get(name) ?? '');

    const errors: FieldErrors = {};
    const nameError = validateName(readField('name'), isApplication);
    const emailError = validateEmail(readField('email'));
    const phoneError = validatePhone(readField('phone'));
    if (nameError) errors.name = nameError;
    if (emailError) errors.email = emailError;
    if (phoneError) errors.phone = phoneError;

    return { errors, firstInvalid: STEP_ONE_FIELDS.find((field) => errors[field]) };
  };

  /**
   * Takes the visitor to a step-01 field that is complaining while step 02 is on screen.
   *
   * Returns whether it did anything, so the caller can fall through to ordinary focus when the form is
   * not stepped or the fault is on the step already showing.
   */
  const reachBackToStepOne = (field: ValidatedField | undefined): boolean => {
    if (!isStepped || !field || stepIndex === 0) return false;
    pendingFocusRef.current = field;
    goToStep(0);
    return true;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const readField = (name: string) => String(formData.get(name) ?? '');

    // ── The stepped form's `Continue` IS a submit ──
    // Deliberately, and it is what makes Enter behave: a text input's Enter fires the form's submit,
    // so a `type="button"` next control would advance on a press and send on a keystroke. Landing both
    // here means one path forward and one definition of "step 01 is finished".
    if (isStepped && stepIndex < lastStepIndex) {
      const { errors, firstInvalid } = checkStepOne(formData);
      setFieldErrors(errors);

      if (firstInvalid) {
        const target = formRef.current?.elements.namedItem(firstInvalid);
        if (target instanceof HTMLElement) target.focus();
        return;
      }

      goToStep(stepIndex + 1);
      return;
    }

    const { errors: nextErrors, firstInvalid: firstInvalidField } = checkStepOne(formData);
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

    if (firstInvalidField || nextWorkError) {
      // ⚠ Focus moves to the first thing wrong. Without the browser's own submit UI (see the header)
      // nothing else would take the visitor to it — in a panel that scrolls, the message they need to
      // read can easily be off screen at the moment they press the button. On a stepped form it may
      // also be a step away, which `reachBackToStepOne` handles before focus is attempted.
      if (reachBackToStepOne(firstInvalidField)) return;

      const target = firstInvalidField
        ? formRef.current?.elements.namedItem(firstInvalidField)
        : cvInputRef.current;
      if (target instanceof HTMLElement) target.focus();
      return;
    }

    setStatus('sending');

    try {
      const response = await fetch(isApplication ? APPLICATION_ENDPOINT : ENQUIRY_ENDPOINT, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        setStatus('sent');
        // ⚠ Cleared only on success, and only here. A failed submit must leave every word where it
        // is — the visitor has to be able to press the button again without retyping a brief they
        // spent two minutes on, and a job application is worse still to lose.
        formElement.reset();
        setCvFile(null);
        return;
      }

      if (response.status === 429) {
        setStatus('rate-limited');
        return;
      }

      // 422 means the server disagreed with something this form thought was fine — a link the panel
      // will not take, a field over a length this form does not police. Showing it beside the input
      // is the difference between a fixable mistake and a dead button.
      if (response.status === 422) {
        const failure = (await response.json().catch(() => null)) as SubmitFailure | null;
        const serverErrors = failure?.fieldErrors ?? {};

        const nextFieldErrors: FieldErrors = {};
        for (const field of ['name', 'email', 'phone'] as const) {
          if (serverErrors[field]) nextFieldErrors[field] = serverErrors[field];
        }
        setFieldErrors(nextFieldErrors);

        // The panel reports the "a link or a CV" rule against `workLink`, and `whyYou` is the long
        // field this form calls the brief — neither name means anything to the visitor, so both
        // land in the one place on screen that is about the work.
        const workMessage = serverErrors.workLink ?? serverErrors.cvFile ?? null;
        setWorkError(workMessage);

        // ⚠ Nothing was stored, so saying nothing would read as success to anyone who did not
        // notice a small red line further up the panel.
        if (Object.keys(nextFieldErrors).length === 0 && !workMessage) {
          setStatus('error');
          return;
        }

        // ⚠ The server names fields from BOTH steps, and it answered a press made on step 02 — so a
        // complaint about the email would otherwise be drawn on a step that is not on screen, leaving
        // a form that says nothing and does nothing. `goToStep` clears the status itself, which is the
        // same idle this branch wants.
        if (reachBackToStepOne(STEP_ONE_FIELDS.find((field) => nextFieldErrors[field]))) return;

        setStatus('idle');
        return;
      }

      setStatus('error');
    } catch {
      // A dropped connection, a navigation mid-flight, an offline phone. Same answer as a 502: it
      // did not send, and trying again is the right advice.
      setStatus('error');
    }
  };

  const statusMessage =
    status === 'sent'
      ? formContent.sentMessage
      : status === 'error'
        ? formContent.errorMessage
        : status === 'rate-limited'
          ? RATE_LIMITED_MESSAGE
          : null;

  /** Every validated field is drawn the same way, down to the wiring between input and message. */
  const fieldProps = (field: ValidatedField) => ({
    onBlur: handleFieldBlur(field),
    onChange: handleFieldChange(field),
    'aria-invalid': fieldErrors[field] ? true : undefined,
    'aria-describedby': fieldErrors[field] ? errorIdFor(field) : undefined,
  });

  /**
   * ⚠ THE FIELDS ARE LIFTED OUT OF THE JSX, and the stepped variant is why: it wraps them in two group
   * elements and the plain one does not. The alternative to a variable is these seven fields written
   * out twice, which is exactly how two variants of one form drift apart.
   *
   * The subject rides along at the top of step 01. On the plain form that is where it has always been;
   * on the application only the hidden inputs render (`showSubject` is false there), and a hidden input
   * inside a `hidden` step is still submitted — `hidden` governs painting and focus, not FormData.
   */
  const youStepContent = (
    <>
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
          {/* Careers only. The subject above is the role's TITLE and is what the applicant reads;
              this is what files the application against the right role, and it survives an editor
              rewriting that title. */}
          {prefill.roleSlug && (
            <input type="hidden" name="roleSlug" value={prefill.roleSlug} readOnly />
          )}
        </>
      )}

      <div className="enquiry-field enquiry-field--half">
        <label className="enquiry-label" htmlFor={nameId}>
          {formContent.nameLabel}
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

      {/* ⚠ DIRECTLY AFTER Name, because those two are the pair — see `.enquiry-form`'s grid. They have a
          row each until the frame is too short for four of them, and then they are the ones that share:
          they are the two shortest answers in the form and the two a visitor gives without thinking,
          whereas Email is the one that has to be right and keeps its own line as long as there is one.

          `type="tel"` rather than `text`: it is what puts the numeric keypad up on a phone. It carries
          no `pattern` — the check is in `validatePhone`, which counts digits rather than demanding a
          shape, for the reason set out beside that constant. */}
      <div className="enquiry-field enquiry-field--half">
        <label className="enquiry-label" htmlFor={phoneId}>
          {formContent.phoneLabel}
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

      {/* ⚠ PAIRABLE ONLY IN THE APPLICATION, and the asymmetry is the point. The enquiry is four fields,
          so on a short frame exactly one row has to go and Name + Mobile are it; marking Email too would
          leave it half width with an EMPTY CELL beside it, which reads as a missing input rather than as
          a deliberate line. The application has the aside below to fill that cell, so there it pairs. */}
      <div className={`enquiry-field${isApplication ? ' enquiry-field--half' : ''}`}>
        <label className="enquiry-label" htmlFor={emailId}>
          {formContent.emailLabel}
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

      {/* Fills the cell beside Email, and earns it: three asterisks scattered down a seven-field form
          read as "most of this is compulsory", which is the opposite of true here. */}
      {isApplication && (
        <p className="enquiry-aside enquiry-field--half">
          Only your name, your email and one piece of work are required.
        </p>
      )}

      {/* ⚠ IN STEP 01 ON THE APPLICATION, which is a balance call rather than a semantic one — "why you"
          is a sentence about the work and files under step 02 on meaning alone. Step 02 carries the drop
          zone, the tallest control in the form, so it is the step with no room to lend. */}
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
    </>
  );

  /** Step 02 — the evidence. Empty on the plain enquiry form, which asks for neither of these. */
  const workStepContent = (
    <>
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
    </>
  );

  const isOnLastStep = !isStepped || stepIndex === lastStepIndex;

  return (
    <form
      ref={formRef}
      // ⚠ Two modifiers, two jobs. `--application` still carries no layout: it sets
      // `--enquiry-half-span: 1`, the one knob deciding whether pairable fields pair. `--stepped` is the
      // layout one — it turns the form from a grid into a STACK of grids, because each step is its own
      // grid. Only the application asks for it today; the class is named for what it does anyway, so the
      // variant never quietly comes to mean "and it is stepped".
      className={[
        'enquiry-form',
        isApplication ? 'enquiry-form--application' : '',
        isStepped ? 'enquiry-form--stepped' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onSubmit={handleSubmit}
      // ⚠ Suppresses the browser's submit-time bubbles ONLY — the attributes stay on the inputs. See
      // the header: with both running, one mistake produced two messages in two visual languages.
      noValidate
      // ⚠ The application carries a file, and the default urlencoded encoding would send the filename
      // rather than the PDF.
      {...(isApplication ? { encType: 'multipart/form-data' } : {})}
    >
      {/* ⚠ THE HONEYPOT. A person never sees it, a bot that fills every input it finds fills it, and
          a submission carrying anything here is answered with a success that stores nothing. It is
          `hidden` rather than merely moved off-screen, so it is out of the tab order and out of the
          accessibility tree — and `autoComplete="off"` keeps a password manager from filling it in
          on a real visitor's behalf, which would silently discard their message.
          ⚠ A child of the FORM, never of a step: it belongs to the submission rather than to anything
          the visitor is being asked, and it must be in the FormData whichever step was on screen. */}
      <input
        type="text"
        name={HONEYPOT_FIELD}
        hidden
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        defaultValue=""
      />

      {isStepped ? (
        <>
          {/* Where you are, in the two registers this site already uses for it: the navbar's meter and
              the section numbers. Not a row of clickable tabs — step 02 is only reachable through a
              finished step 01, and a control that refuses half the time is worse than no control. */}
          <p className="enquiry-stepper">
            <span className="enquiry-stepper-index" aria-hidden="true">
              {String(stepIndex + 1).padStart(2, '0')}
            </span>
            <span className="enquiry-stepper-name">
              {APPLICATION_STEPS[stepIndex].name}
              {/* The track beside this says "one of two" to the eye far better than words do, and says
                  nothing at all to anyone who cannot see it. `.sr-only` rather than a rule of this
                  component's own — the site has one way of doing this now. */}
              <span className="sr-only">
                {` — step ${stepIndex + 1} of ${APPLICATION_STEPS.length}`}
              </span>
            </span>
            <span className="enquiry-stepper-track" aria-hidden="true">
              {APPLICATION_STEPS.map((step, index) => (
                <span
                  key={step.key}
                  className="enquiry-stepper-segment"
                  data-reached={index <= stepIndex}
                />
              ))}
            </span>
          </p>

          <div className="enquiry-steps" ref={stepsRef}>
            {APPLICATION_STEPS.map((step, index) => (
              <div
                key={step.key}
                className="enquiry-step"
                // ⚠ `hidden`, not unmounted — see the header. It is also what keeps the other step out
                // of the tab order, which `opacity: 0` would not.
                hidden={index !== stepIndex}
                // Focused on arrival (see the effect above), so the group's name is what gets read out.
                tabIndex={-1}
                role="group"
                aria-label={`${step.name}, step ${index + 1} of ${APPLICATION_STEPS.length}`}
              >
                {index === 0 ? youStepContent : workStepContent}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {youStepContent}
          {workStepContent}
        </>
      )}

      {/* ⚠ STICKY, and it is the fix for the whole panel. The application form is ~780px of content in a
          panel that is ~510px tall on a laptop, so the submit button used to sit below the fold inside
          a modal — reachable only by finding a scrollbar nobody looks for. Here it never leaves.
          ⚠ Splitting the application in two took most of that overflow away, but the bar stays sticky:
          a 200% font setting still overflows, and this is the shell that keeps the button reachable. */}
      <div className="enquiry-actions">
        {isStepped && stepIndex > 0 && (
          <button type="button" className="enquiry-back" onClick={() => goToStep(stepIndex - 1)}>
            {STEP_BACK_LABEL}
          </button>
        )}

        {/* ⚠ `submit` on BOTH steps, and deliberately — see `handleSubmit`. A `type="button"` here would
            advance on a press and SEND on an Enter keystroke, because a text field's Enter fires the
            form's submit regardless of what the visible control says. */}
        <button type="submit" className="enquiry-send" disabled={status === 'sending'}>
          {!isOnLastStep
            ? STEP_CONTINUE_LABEL
            : status === 'sending'
              ? formContent.sendingLabel
              : submitLabel}
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
