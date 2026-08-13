/**
 * The disciplines a visitor can start a conversation about.
 *
 * This is one vocabulary shared by three places that would otherwise each invent their own: the fleet
 * (which sells the discipline), the works field (which shows a project OF that discipline as its
 * highlighted type key), and the enquiry form (which arrives already knowing which one you came from).
 *
 * ⚠ The `label` is deliberately PLAINSPOKEN — "Web Development", not the fleet's "Web Experiences".
 * The deck's names are the brand talking; this is the line a visitor would write in an email, and it is
 * what lands in the form's subject. Both exist on purpose: `DECK_SERVICES` keeps its own poetry and
 * points at a discipline for the CTA.
 */

import type { PublishedDiscipline } from '@/lib/cms/publishedContent';

export type DisciplineId = 'web' | 'mobile' | 'enterprise' | 'ai';

export interface Discipline {
  /** Plain name of the work itself — the works field's type key, and the enquiry's subject. */
  label: string;
  /**
   * Seeds the form's "What you are building" field. Written in the VISITOR's voice and left mid-
   * sentence, so the field reads as a note they started rather than a message we wrote for them.
   */
  briefSeed: string;
}

export const DISCIPLINES: Record<DisciplineId, Discipline> = {
  web: {
    label: 'Web Development',
    briefSeed:
      "We need a web platform that doesn't move like anyone else's. Here's where we are so far: ",
  },
  mobile: {
    label: 'Mobile Development',
    briefSeed:
      "We need an app that feels native in the hand rather than a website in a frame. Here's where we are so far: ",
  },
  enterprise: {
    // Singular, unlike the fleet's "Enterprise Platforms" — this label also has to sit above ONE
    // project as its type key, where a plural reads as a category heading rather than a description.
    label: 'Enterprise Platform',
    briefSeed:
      "We need an operational core that pulls our tools into one orbit. Here's where we are so far: ",
  },
  ai: {
    label: 'Artificial Intelligence',
    briefSeed:
      "We want intelligence wired into the product itself, not bolted on as a demo. Here's where we are so far: ",
  },
};

/** What the form arrives already knowing. */
export interface EnquiryPrefill {
  /**
   * Shown as a chip at the head of the form, and submitted as the enquiry's `source` — which is
   * what the panel's inbox shows under "Sent from" and what becomes the lead's origin label.
   */
  subject: string;
  /** Initial value of the brief textarea. Editable — it is a starting point, not a commitment. */
  brief: string;
  /**
   * ⚠ CAREERS ONLY, and it is the role's identity rather than its name. The admin panel files an
   * application against a role by slug; the `subject` beside it is the role's TITLE, which is
   * display copy an editor can rewrite at any time and cannot be matched on.
   *
   * Absent for an open application, and absent for the placeholder roles this repo falls back to
   * when the panel has published none — both file as an open application, which is the honest
   * answer for a job that answers to no row in any database.
   */
  roleSlug?: string;
}

/**
 * What the two reference strings substitute.
 *
 * ⚠ It lives here rather than with the form's other strings because this is the file that does the
 * substituting, and `lib/` must not import from `components/`. `enquiryFormContent.ts` imports it
 * back the other way, which is the direction that is allowed.
 */
export const REFERENCE_TOKEN = '{project}';

/**
 * What the form arrives pre-filled with.
 *
 * ⚠ Takes the vocabulary rather than reading `DISCIPLINES` directly, because both are published by
 * the panel now and a module-scope read would pin this to the fallback copy forever — silently, since
 * the fallback is real prose and nothing would look wrong.
 *
 * `reference` is a project the visitor is pointing at, when the CTA came from the works field. It
 * LEADS the brief rather than replacing it: "this kind of work, in the orbit of that one".
 */
export function buildEnquiryPrefill(options: {
  discipline: DisciplineId;
  disciplines: Record<DisciplineId, Discipline>;
  referenceSubjectSuffix: string;
  referenceBriefPrefix: string;
  reference?: string;
}): EnquiryPrefill {
  const { discipline, disciplines, referenceSubjectSuffix, referenceBriefPrefix, reference } =
    options;
  const { label, briefSeed } = disciplines[discipline];

  if (!reference) {
    return { subject: label, brief: briefSeed };
  }

  return {
    subject: `${label} ${fillReference(referenceSubjectSuffix, reference)}`,
    // ⚠ No separator between the two: the prefix carries its own trailing space, and the seed is
    // itself left mid-sentence. Adding one here would double it.
    brief: `${fillReference(referenceBriefPrefix, reference)}${briefSeed}`,
  };
}

function fillReference(template: string, reference: string): string {
  return template.split(REFERENCE_TOKEN).join(reference);
}

/**
 * The panel's vocabulary, or this file's if it has published none.
 *
 * ⚠ A published `key` outside `DisciplineId` is IGNORED, not added. The union is what the site's
 * services and projects bind to, and `contentPayload.ts` makes `key` non-editable for exactly this
 * reason — but the payload is still just JSON, and a hand-edited release or a future migration could
 * carry one. Widening the type at runtime is not possible; dropping the entry and keeping the
 * fallback is the only honest answer.
 *
 * ⚠ Overlaid onto the fallback rather than replacing it wholesale, so a release that carries three of
 * the four disciplines leaves the fourth working instead of `undefined` — which would be a crash in
 * `buildEnquiryPrefill`, not a missing label.
 *
 * ⚠ `briefSeed` is NOT trimmed. It ends mid-sentence with a deliberate trailing space that the panel
 * strips on save and puts back at publish time (`continuationSeed`). Trimming here would undo that.
 */
export function resolveDisciplines(
  published: PublishedDiscipline[] | null,
): Record<DisciplineId, Discipline> {
  if (!published || published.length === 0) {
    return DISCIPLINES;
  }

  const resolved: Record<DisciplineId, Discipline> = { ...DISCIPLINES };

  for (const entry of published) {
    if (!isDisciplineId(entry.key)) {
      console.warn(`[cms] unknown discipline key "${entry.key}" ignored`);
      continue;
    }

    resolved[entry.key] = { label: entry.label, briefSeed: entry.briefSeed };
  }

  return resolved;
}

/**
 * Exported because the fleet and the field both have to validate a published `discipline` before
 * binding a CTA to it — three places asking the same question, one answer.
 */
export function isDisciplineId(key: string): key is DisciplineId {
  return Object.prototype.hasOwnProperty.call(DISCIPLINES, key);
}
