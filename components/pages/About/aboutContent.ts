/**
 * Everything `/about` says, in one place — exactly as `deckServices.ts` is for the fleet,
 * `worksProjects.ts` for the field and `faqEntries.ts` for the hologram. Swapping the words touches no
 * component.
 *
 * The voice is the site's: a claim, then the thing that backs it up. No agency boilerplate, no "we
 * transform businesses", no "your trusted partner".
 *
 * ── ⚠ WHAT IS INVENTED HERE, AND WHAT IS NOT ─────────────────────────────────────────────────────
 * There is deliberately NO founding year, NO headcount, NO office, NO named person and NO client logo
 * wall on this page. Those are the four things an about page usually leads with and they are all things
 * this site has no way to back — `contactContent.ts` sets the precedent that we do not ship a claim we
 * cannot hold.
 *
 * `INSTRUMENTS` below is the one place that looks like a track record and is not: every figure in it is
 * a COMMITMENT, and three of the four are already stated elsewhere on the site (`faqEntries` 07 and 02,
 * and the frame budget the whole of `docs/lag-and-freeze-diagnosis.md` exists to defend). If you replace
 * them, keep that property — "37 products shipped" is precisely the sentence this file is arranged to
 * avoid.
 *
 * `STACK` is drawn from what this site itself is built out of. Check it against what the studio actually
 * sells before shipping; it is the one list here that could quietly become a lie by omission.
 */

import type { DocSectionMeta } from '@/components/layout/PageShell/docSections';
import type { Claim } from '@/components/layout/PageShell/ClaimRow';
import type { Phase } from '@/components/layout/PageShell/PhaseTrack';

export const ABOUT_EYEBROW = 'About — Voidix';

/** One entry per sentence. ⚠ Never a single string with a <br/> — see PageMasthead's header. */
export const ABOUT_TITLE = [
  'Most software is weightless.',
  'We build the other kind.',
] as const;

export const ABOUT_LEAD =
  'Voidix is a small engineering studio. We take the surface that has to be fast, legible and alive at the same time — the trading floor, the clinical record, the storefront that behaves like film — and we build it properly, with the people who will maintain it in the room.';

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

export const PREMISE_PARAGRAPHS: readonly string[] = [
  'Weightless is the default, and mostly that is fine. Software loads, it works, it is forgotten between openings. Nobody was ever meant to feel anything about the expenses tool.',
  'Gravity is the opposite property, and it is not decoration. A product has it when leaving costs something: when the number lands where the eye already was, when the motion is carrying information rather than apologising for a wait, when the thing is quick enough that nobody has to think about the thing. That is an engineering result before it is a design one, which is why the two are not separate jobs here.',
];

export const PREMISE_QUOTE =
  'A product earns its gravity in the first four hundred milliseconds, and keeps it over the next four hundred days.';

export const PRINCIPLES: readonly Claim[] = [
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
];

export const BUILD_PHASES: readonly Phase[] = [
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
];

export interface Instrument {
  label: string;
  value: string;
}

/** ⚠ Commitments, not measurements. See the file header before changing any of them. */
export const INSTRUMENTS: readonly Instrument[] = [
  { label: 'First reply', value: 'Under 5 days' },
  { label: 'First proof', value: '2 weeks' },
  { label: 'Frame budget', value: '16.7 ms' },
  { label: 'Handover', value: 'Fully documented' },
];

export const INSTRUMENTS_NOTE =
  'These are commitments, not a scoreboard. They are the four numbers we will be held to before a line of code exists.';

export const STACK: readonly string[] = [
  'TypeScript',
  'React & Next.js',
  'WebGL / GLSL',
  'Three.js',
  'Realtime streams',
  'iOS & Android',
  'Design systems',
  'Performance budgets',
];

export const STACK_NOTE =
  'The list is short on purpose. We would rather be the studio that knows eight things completely than the one that lists forty.';

export const ABOUT_CLOSING_TITLE = 'Tell us what you are building.';

export const ABOUT_CLOSING_LEAD =
  'A paragraph is enough — what it is, who it is for, and what has to be true on the day it ships.';

/** The cross-link to the other document page. Both pages carry one to the other. */
export const ABOUT_CAREERS_INVITE = 'Or come and build it with us';
