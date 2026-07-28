/**
 * The questions the hologram answers.
 *
 * The FAQ copy as authored in code, exactly as `deckServices.ts` is for the fleet and
 * `worksProjects.ts` is for the field — the seed for the database and the fallback when nothing is
 * published. The list's LENGTH is free — the hologram measures its own content and the frames move
 * to fit (see FaqHologram), so adding a question costs nothing.
 *
 * Placeholder copy for now. The voice is the one the rest of the site speaks in — a claim, then the
 * thing that backs it up — not agency boilerplate.
 *
 * The shape these entries satisfy lives in ../types.
 */

import type { FaqEntry } from '../types';

export const DEFAULT_FAQ_ENTRIES: FaqEntry[] = [
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
