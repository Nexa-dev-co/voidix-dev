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
  /** Shown as a chip at the head of the form, and carried as a hidden field for a future endpoint. */
  subject: string;
  /** Initial value of the brief textarea. Editable — it is a starting point, not a commitment. */
  brief: string;
}

/**
 * @param reference A project the visitor is pointing at, when the CTA came from the works field. It
 *   leads the brief rather than replacing it: "this kind of work, in the orbit of that one".
 */
export function buildEnquiryPrefill(discipline: DisciplineId, reference?: string): EnquiryPrefill {
  const { label, briefSeed } = DISCIPLINES[discipline];
  return {
    subject: reference ? `${label} — like ${reference}` : label,
    brief: reference ? `In the orbit of ${reference}. ${briefSeed}` : briefSeed,
  };
}
