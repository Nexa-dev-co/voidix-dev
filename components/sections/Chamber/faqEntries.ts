/**
 * The questions the hologram answers.
 *
 * The list's LENGTH is free — the hologram measures its own content and the frames move to fit (see
 * FaqHologram), so adding a question costs nothing. That is what makes this the one homepage list the
 * panel can genuinely grow: the fleet and the field are both pinned to a count by their geometry.
 *
 * ── ⚠ THIS IS THE FALLBACK NOW, NOT THE SOURCE OF TRUTH ──────────────────────────────────────────
 * The hologram reads the panel through `resolveFaqEntries`, the same arrangement `aboutContent.ts`
 * and `careersContent.ts` use. `FAQ_ENTRIES` below is what ships when the panel has published
 * nothing, is unreachable, or is not configured — the state of every fresh clone. Editing it changes
 * what an unconfigured site says and NOTHING about what a connected one says.
 *
 * Placeholder copy. The voice is the one the rest of the site speaks in — a claim, then the thing
 * that backs it up — not agency boilerplate. Keep it that way; it is what a visitor sees if the
 * panel is down.
 */

import type { PublishedFaqEntry } from '@/lib/cms/publishedContent';

export interface FaqEntry {
  /** Two-digit ordinal, shown down the left of each row. */
  index: string;
  question: string;
  /** One or more paragraphs. Long answers scroll inside the hologram rather than growing it forever. */
  answer: string[];
}

/**
 * The panel's questions, or this file's if it has published none.
 *
 * ⚠ An EMPTY published list falls back, deliberately — and this is the opposite of the rule
 * `PublishedCareers.roles` follows. "No openings" is a decision a careers page has a designed state
 * for; "no questions" is not a state the chamber has, because the hologram would unseal onto an empty
 * frame with the tour already committed to arriving at it. Emptying the FAQ is therefore not
 * something the panel can express, and an editor who wants fewer questions deletes them down to one.
 */
export function resolveFaqEntries(published: PublishedFaqEntry[] | null): FaqEntry[] {
  if (!published || published.length === 0) {
    return FAQ_ENTRIES;
  }

  return published.map((entry) => ({
    index: entry.index,
    question: entry.question,
    answer: entry.answer,
  }));
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    index: '01',
    question: 'What does Voidix build?',
    answer: [
      'Voidix builds custom digital products and business software, including websites, web applications, CRM systems, mobile applications, SaaS platforms, AI-powered tools, automation systems, and software integrations.',
    ],
  },
  {
    index: '02',
    question: 'Does Voidix work with businesses in the United States?',
    answer: [
      'Yes. Voidix is positioned as a technology partner for businesses in the United States and can work with B2B companies that need custom software, digital products, automation, or AI solutions.',
    ],
  },
  {
    index: '03',
    question: 'Can you build a custom CRM for our business?',
    answer: [
      'Yes. A custom CRM can be designed around your sales pipeline, customer data, team workflows, reporting requirements, integrations, and automation needs.',
    ],
  },
  {
    index: '04',
    question: 'Can you turn our idea into a SaaS product?',
    answer: [
      'Yes. Voidix can help take a software concept through planning, UX/UI design, development, integrations, deployment, and continued product development.',
    ],
  },
  {
    index: '05',
    question: 'Can you integrate AI into software we already use?',
    answer: [
      'Yes. AI capabilities can be integrated into existing websites, CRMs, SaaS products, internal systems, and business workflows depending on the technology and use case.',
    ],
  },
  {
    index: '06',
    question: 'Can you automate our existing business processes?',
    answer: [
      'Yes. We can analyze repetitive workflows and identify opportunities to connect systems, automate data movement, trigger actions, and reduce manual work.',
    ],
  },
  {
    index: '07',
    question: 'Do you build mobile apps?',
    answer: [
      'Yes. Voidix develops mobile applications for businesses and digital products, including customer-facing and internal business applications.',
    ],
  },
  {
    index: '08',
    question: 'Can you connect our CRM, website, and other software?',
    answer: [
      'Yes. Software integrations can connect websites, CRMs, payment systems, databases, APIs, communication tools, and other business platforms.',
    ],
  },
  {
    index: '09',
    question: 'How much does custom software development cost?',
    answer: [
      "The cost depends on the product's scope, complexity, integrations, number of users, design requirements, and development requirements. Voidix evaluates the project before providing a development proposal.",
    ],
  },
  {
    index: '10',
    question: 'How do we start a project?',
    answer: [
      'Tell us what you are building, who it is for, and what the software needs to accomplish. We will review the requirements and determine the appropriate next step.',
    ],
  },
];
