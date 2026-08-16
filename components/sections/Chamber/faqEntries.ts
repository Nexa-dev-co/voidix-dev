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
    question: 'What do you actually build?',
    answer: [
      'Software with weight to it. Trading surfaces, clinical records, storefronts that behave like film, retrieval systems that answer from live data — the kind of product a company runs on rather than demos once.',
      'The site you are standing in is the honest answer. Every scene here is the same stack we ship to clients: WebGL, custom shaders, scroll choreography that survives a fast flick on a cheap laptop.',
    ],
  },
  {
    index: '02',
    question: 'How long does a build take?',
    answer: [
      'A focused product surface takes six to ten weeks. A platform — many surfaces, real data, real users — runs three to six months.',
      'We do not pad that. The first fortnight is spent proving the hardest part works, so the estimate you get in week three is one we can actually hold.',
    ],
  },
  {
    index: '03',
    question: 'What does it cost?',
    answer: [
      'Engagements start around the price of one senior hire for the same period, and scale with the surface area of the thing being built.',
      'You get a fixed scope and a fixed number, or a rate and an honest burn-down. What you never get is a change-request desk that bills you for the ambiguity in your own brief.',
    ],
  },
  {
    index: '04',
    question: 'Do you work alongside an in-house team?',
    answer: [
      'Often. We come in on the parts nobody in-house has time to invent — the render pipeline, the interaction model, the performance budget — and leave behind code your team can actually read.',
      'Handover is a deliverable, not a favour. Documented, commented, and walked through until someone on your side can defend every decision in it.',
    ],
  },
  {
    index: '05',
    question: 'What happens after launch?',
    answer: [
      'We stay for a stabilisation window — real traffic finds things no staging environment will — and then hand you the keys.',
      'If you want us on retainer after that, the door is open. If you never call again because it simply works, that is the better outcome and we will take it.',
    ],
  },
  {
    index: '06',
    question: 'Will it run on a phone?',
    answer: [
      'Yes, and not as a stripped-down apology. Scenes reframe rather than stretch, the renderer measures its own frame times and trades resolution for smoothness before you ever feel a stutter, and heavy assets ship at the tier the device has earned.',
      'The rule is simple: if it cannot hold sixty frames on hardware people actually own, it is not finished.',
    ],
  },
  {
    index: '07',
    question: 'How do we start?',
    answer: [
      'Tell us what the thing is for and what breaks today. Not a spec — a problem.',
      'We come back inside a week with a shape for it: what we would build, what we would refuse to build, and what it takes. If the shape is wrong, you have lost a week and nothing else.',
    ],
  },
];
