/**
 * Everything `/about` says — now in two layers: what the admin panel publishes, and what this file
 * falls back to when it has published nothing. Same arrangement as `careersContent.ts`.
 *
 * The voice is the site's: a claim, then the thing that backs it up. No agency boilerplate, no "we
 * transform businesses", no "your trusted partner".
 *
 * ── ⚠ THIS IS THE FALLBACK NOW, NOT THE SOURCE OF TRUTH ──────────────────────────────────────────
 * `/about` reads the panel through `resolveAboutContent`. `ABOUT_FALLBACK` below is what ships when
 * the panel has published nothing, is unreachable, or is simply not configured — which is the state
 * of every fresh clone. Editing it changes what an unconfigured site says and NOTHING about what a
 * connected one says: for that, edit the copy in the panel and publish. Keep it in voice anyway; it
 * is what a visitor sees if the panel is down.
 *
 * ⚠ `ABOUT_SECTIONS` is deliberately NOT in the panel and must stay here. Each entry's `key` is
 * simultaneously the section's anchor id and the station the orbit rail scrolls to — structure, not
 * copy. An editor renaming one would break in-page navigation with nothing to catch it.
 *
 * ── ⚠ WHAT IS INVENTED HERE, AND WHAT IS NOT ─────────────────────────────────────────────────────
 * There is deliberately NO founding year, NO headcount, NO office, NO named person and NO client logo
 * wall on this page. Those are the four things an about page usually leads with and they are all things
 * this site has no way to back — `contactContent.ts` sets the precedent that we do not ship a claim we
 * cannot hold.
 *
 * `instruments` below is the one place that looks like a track record and is not: every figure in it is
 * a COMMITMENT, and three of the four are already stated elsewhere on the site (`faqEntries` 07 and 02,
 * and the frame budget the whole of `docs/lag-and-freeze-diagnosis.md` exists to defend). If you replace
 * them — here or in the panel — keep that property: "37 products shipped" is precisely the sentence
 * this page is arranged to avoid.
 *
 * `stack` is drawn from what this site itself is built out of. Check it against what the studio actually
 * sells before shipping; it is the one list here that could quietly become a lie by omission.
 */

import type { DocSectionMeta } from '@/components/layout/PageShell/docSections';
import type { Claim } from '@/components/layout/PageShell/ClaimRow';
import type { Phase } from '@/components/layout/PageShell/PhaseTrack';
import type { PublishedAbout } from '@/lib/cms/publishedContent';

export interface Instrument {
  label: string;
  value: string;
}

/**
 * Every word `/about` renders, as one object.
 *
 * One shape for both sources is the point: the page cannot accidentally read a published field for
 * one thing and a hardcoded constant for another, because after `resolveAboutContent` there is only
 * ever one of these.
 */
export interface AboutContent {
  /* Just the document's name — same reasoning as the careers eyebrow: the navbar's wordmark sits
     directly above the masthead, so repeating "Voidix" here is the brand introducing itself twice
     in one glance. */
  eyebrow: string;
  /** One entry per sentence. ⚠ Never a single string with a <br/> — see PageMasthead's header. */
  title: readonly string[];
  lead: string;
  premiseParagraphs: readonly string[];
  premiseQuote: string;
  principles: readonly Claim[];
  buildPhases: readonly Phase[];
  /** ⚠ Commitments, not measurements. See the file header before changing any of them. */
  instruments: readonly Instrument[];
  instrumentsNote: string;
  stack: readonly string[];
  stackNote: string;
  closingTitle: string;
  closingLead: string;
  /** The cross-link to the other document page. Both pages carry one to the other. */
  careersInvite: string;
}

/**
 * The numbered sections, in order.
 *
 * ⚠ This is what the orbit rail draws its stations from AND what each section's anchor id comes from.
 * Adding a section here and forgetting to render it leaves the rail with a station that scrolls
 * nowhere; rendering one that is not here leaves it invisible to the rail. One list, both jobs.
 */
export const ABOUT_SECTIONS: readonly DocSectionMeta[] = [
  { key: 'premise', number: '01', title: 'The premise' },
  { key: 'made-of', number: '02', title: 'What we are made of' },
  { key: 'how-a-build-runs', number: '03', title: 'How a build runs' },
  { key: 'instruments', number: '04', title: 'The instruments' },
  { key: 'what-we-work-in', number: '05', title: 'What we work in' },
];

export const ABOUT_FALLBACK: AboutContent = {
  eyebrow: 'About',

  title: ['Most software is weightless.', 'We build the other kind.'],

  lead: 'Voidix is a small engineering studio. We take the surface that has to be fast, legible and alive at the same time — the trading floor, the clinical record, the storefront that behaves like film — and we build it properly, with the people who will maintain it in the room.',

  premiseParagraphs: [
    'Weightless is the default, and mostly that is fine. Software loads, it works, it is forgotten between openings. Nobody was ever meant to feel anything about the expenses tool.',
    'Gravity is the opposite property, and it is not decoration. A product has it when leaving costs something: when the number lands where the eye already was, when the motion is carrying information rather than apologising for a wait, when the thing is quick enough that nobody has to think about the thing. That is an engineering result before it is a design one, which is why the two are not separate jobs here.',
  ],

  premiseQuote:
    'A product earns its gravity in the first four hundred milliseconds, and keeps it over the next four hundred days.',

  principles: [
    {
      index: '01',
      claim: 'The hard part first.',
      backing:
        'The first fortnight goes on whatever the project is most likely to die of — the render path, the data volume, the thing nobody has built before. An estimate given before that is a guess in a suit.',
    },
    {
      index: '02',
      claim: 'One team, all the way down.',
      backing:
        'The people who design the interaction write the shader that draws it. Nothing is thrown over a wall, because there is no wall to throw it over.',
    },
    {
      index: '03',
      claim: 'Performance is a design decision.',
      backing:
        'Sixty frames on hardware people actually own is a constraint we design inside, not a pass we run at the end. It has killed features here, and it should have.',
    },
    {
      index: '04',
      claim: 'Handover is a deliverable.',
      backing:
        'Documented, commented, and walked through until someone on your side can defend every decision in it. If you never need to call us again, that is the better outcome and we will take it.',
    },
  ],

  buildPhases: [
    {
      span: 'Week 1–2',
      name: 'Prove',
      detail: 'We build the riskiest part first and find out whether it survives contact with real data.',
    },
    {
      span: 'Week 2–3',
      name: 'Shape',
      detail: 'You get a shape: what we would build, what we would refuse to build, and what it takes.',
    },
    {
      span: '6–24 weeks',
      name: 'Build',
      detail: 'Something working every week, on the real stack. Not a demo that becomes a rewrite.',
    },
    {
      span: 'Then the door stays open',
      name: 'Hand over',
      detail: 'Keys, docs and a stabilisation window while live traffic finds what staging never did.',
    },
  ],

  instruments: [
    { label: 'First reply', value: 'Under 5 days' },
    { label: 'First proof', value: '2 weeks' },
    { label: 'Frame budget', value: '16.7 ms' },
    { label: 'Handover', value: 'Fully documented' },
  ],

  instrumentsNote:
    'These are commitments, not a scoreboard. They are the four numbers we will be held to before a line of code exists.',

  stack: [
    'TypeScript',
    'React & Next.js',
    'WebGL / GLSL',
    'Three.js',
    'Realtime streams',
    'iOS & Android',
    'Design systems',
    'Performance budgets',
  ],

  stackNote:
    'The list is short on purpose. We would rather be the studio that knows eight things completely than the one that lists forty.',

  closingTitle: 'Tell us what you are building.',

  closingLead:
    'A paragraph is enough — what it is, who it is for, and what has to be true on the day it ships.',

  careersInvite: 'Or come and build it with us',
};

/**
 * The published copy if there is any, this repo's copy if there is not.
 *
 * ⚠ ALL OR NOTHING, PER SECTION — deliberately. Merging field by field (published title, fallback
 * principles) would build a page nobody wrote: an editor who shortens the principles list to three
 * would get a fourth back from a file they cannot see, and the page would disagree with the panel
 * while both looked correct. `null` here means the panel has never saved this section, which is a
 * state with one honest answer, and it is this file.
 */
export function resolveAboutContent(published: PublishedAbout | null): AboutContent {
  if (!published) {
    return ABOUT_FALLBACK;
  }

  return {
    eyebrow: published.eyebrow,
    title: published.title,
    lead: published.lead,
    premiseParagraphs: published.premiseParagraphs,
    premiseQuote: published.premiseQuote,
    principles: published.principles,
    buildPhases: published.buildPhases,
    instruments: published.instruments,
    instrumentsNote: published.instrumentsNote,
    stack: published.stack,
    stackNote: published.stackNote,
    closingTitle: published.closingTitle,
    closingLead: published.closingLead,
    careersInvite: published.careersInvite,
  };
}
