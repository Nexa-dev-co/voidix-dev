/**
 * The enquiry form's shared strings.
 *
 * ── Why these are not on any one section ─────────────────────────────────────────────────────────
 * There is ONE form on this site and six places open it: the services deck, the works field, the FAQ
 * hologram, the contact section, `/about` and `/careers`. These strings belong to the form itself.
 * Putting them on Contact would say they were Contact's, and the next person to change them would
 * wonder why the works form moved too. The panel models them the same way, in `enquiry_form_content`.
 *
 * What a section genuinely overrides stays with that section — `ContactContent.briefLabel` and
 * `CareersContent.applicationBriefLabel` are both real overrides and both live where they belong.
 *
 * ⚠ These were `const` declarations inside `EnquiryForm.tsx` until 2026-08-13, which is why the panel
 * could publish them and nothing read them. A field the panel offers and the site ignores is worse
 * than no field at all.
 *
 * ⚠ `RATE_LIMITED_MESSAGE` is deliberately NOT here and must stay out of the payload. It answers a
 * specific status from the intake route rather than being section copy, and an editor softening it
 * into something reassuring would be rewriting a system message about a limit that is still in force.
 */

import type { PublishedEnquiryForm } from '@/lib/cms/publishedContent';
import { REFERENCE_TOKEN } from '@/lib/enquirySubjects';

/**
 * ⚠ `REFERENCE_TOKEN` is defined in `lib/enquirySubjects.ts`, where the substitution happens, and
 * re-exported here so the form's strings and their placeholder can be read in one place. The panel's
 * copy for both reference fields is free text, so the token can go missing — an editor rewriting
 * "— like {project}" into "— something like yours" produces a sentence that is grammatical and has
 * quietly stopped naming the project the visitor clicked. `resolveEnquiryFormContent` checks for it
 * and falls back per field rather than substituting into nothing.
 */
export { REFERENCE_TOKEN };

export interface EnquiryFormContent {
  nameLabel: string;
  emailLabel: string;
  phoneLabel: string;
  /** Replaces the submit label while the request is in flight. */
  sendingLabel: string;
  sentMessage: string;
  errorMessage: string;
  /** Appended to the discipline for the subject line. Carries `REFERENCE_TOKEN`. */
  referenceSubjectSuffix: string;
  /** Leads the brief when the visitor came from a project. Carries `REFERENCE_TOKEN`. */
  referenceBriefPrefix: string;
}

export const ENQUIRY_FORM_FALLBACK: EnquiryFormContent = {
  nameLabel: 'Name',
  emailLabel: 'Email',
  // "Mobile", not "Phone" — the field asks for the number a person actually answers.
  phoneLabel: 'Mobile',
  sendingLabel: 'Sending…',
  sentMessage: 'Sent. You will hear back from a person, either way.',
  errorMessage: 'That did not send. Try again in a moment.',
  referenceSubjectSuffix: `— like ${REFERENCE_TOKEN}`,
  // ⚠ Trailing space. It runs straight into the discipline's own seed, which is itself left
  // mid-sentence for the visitor to finish.
  referenceBriefPrefix: `In the orbit of ${REFERENCE_TOKEN}. `,
};

export function resolveEnquiryFormContent(
  published: PublishedEnquiryForm | null,
): EnquiryFormContent {
  if (!published) {
    return ENQUIRY_FORM_FALLBACK;
  }

  return {
    nameLabel: published.nameLabel,
    emailLabel: published.emailLabel,
    phoneLabel: published.phoneLabel,
    sendingLabel: published.sendingLabel,
    sentMessage: published.sentMessage,
    errorMessage: published.errorMessage,
    referenceSubjectSuffix: withToken(
      published.referenceSubjectSuffix,
      ENQUIRY_FORM_FALLBACK.referenceSubjectSuffix,
    ),
    referenceBriefPrefix: withToken(
      published.referenceBriefPrefix,
      ENQUIRY_FORM_FALLBACK.referenceBriefPrefix,
    ),
  };
}

/**
 * Per-field fallback, not whole-object: everything else the panel published is still good, and one
 * malformed reference string is no reason to discard a rewritten error message alongside it.
 */
function withToken(published: string, fallback: string): string {
  if (published.includes(REFERENCE_TOKEN)) {
    return published;
  }

  console.warn(
    `[cms] a reference string is missing its ${REFERENCE_TOKEN} placeholder and was ignored`,
  );

  return fallback;
}
