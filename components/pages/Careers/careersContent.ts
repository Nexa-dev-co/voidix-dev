/**
 * Everything `/careers` says, in one place — same arrangement as `aboutContent.ts` and, before it,
 * `deckServices.ts` and `faqEntries.ts`.
 *
 * ── ⚠ EVERY ROLE BELOW IS INVENTED ───────────────────────────────────────────────────────────────
 * The four openings, their locations, their terms and every bullet in them are mock data — written
 * on-voice so the page has its real shape and rhythm, but describing no vacancy that exists. This is
 * the same warning `contactContent.ts` carries about its invented addresses, and it matters more here:
 * a person can waste an afternoon on a job posting in a way they cannot waste one on a footer link.
 *
 * Do not ship these as they stand. Replace them with real openings, or cut the section to the open
 * application at the bottom, which is the honest version of "we are always interested".
 *
 * ── ⚠ AND THE APPLY BUTTON POSTS NOWHERE ─────────────────────────────────────────────────────────
 * It opens the site's shared `EnquiryForm`, which prevents its own submit and has no endpoint — the
 * deliberate front-end-only state `CLAUDE.md` PART 4 records for the contact form. Dropping a project
 * enquiry silently is bad; dropping a job application silently is worse, because the person is left
 * believing they applied. When the contact form gets an endpoint, this needs one in the SAME change.
 */

import type { DocSectionMeta } from '@/components/layout/PageShell/docSections';
import type { Claim } from '@/components/layout/PageShell/ClaimRow';
import type { Phase } from '@/components/layout/PageShell/PhaseTrack';

export const CAREERS_EYEBROW = 'Careers — Voidix';

/** One entry per sentence. ⚠ Never a single string with a <br/> — see PageMasthead's header. */
export const CAREERS_TITLE = [
  'We hire the person',
  'who reads the shader.',
] as const;

export const CAREERS_LEAD =
  'Small studio, short chain of command, work that ships with your name still on the commit. If what you want is to be the third pair of eyes on somebody else’s spec, this is the wrong door — and we would rather say so on the way in.';

export const CAREERS_SECTIONS: readonly DocSectionMeta[] = [
  { key: 'what-it-is-like', number: '01', title: 'What it is like here' },
  { key: 'open-roles', number: '02', title: 'Open roles' },
  { key: 'how-hiring-runs', number: '03', title: 'How hiring runs' },
  { key: 'nothing-fits', number: '04', title: 'Nothing fits?' },
];

export const WORKING_HERE: readonly Claim[] = [
  {
    index: '01',
    claim: 'You own the surface.',
    backing:
      'Not a ticket queue. A thing with edges, a date, and your judgement in the middle of it — including the judgement to say the plan was wrong.',
  },
  {
    index: '02',
    claim: 'The bar is the frame budget.',
    backing:
      'Nothing ships that cannot hold sixty frames on the laptop in the client’s bag. It is the most useful argument-ender we have, and it does not care whose idea it was.',
  },
  {
    index: '03',
    claim: 'You will be read.',
    backing:
      'Every line goes past someone who will ask why. It is the job’s best part and its first week’s worst, in that order.',
  },
];

export interface CareerRole {
  /** Two-digit ordinal down the left of the row. */
  index: string;
  title: string;
  location: string;
  commitment: string;
  /** What the person would be responsible for. */
  owns: readonly string[];
  /** What we would need to see to take the application seriously. */
  needs: readonly string[];
  /** Genuinely optional — labelled as such, because "nice to have" lists are why good people don't apply. */
  bonus: readonly string[];
  /**
   * Seeds the application form's long field. In the APPLICANT's voice and left mid-sentence, so it
   * reads as a note they started rather than a message we wrote for them — the same rule
   * `lib/enquirySubjects.ts` sets for the project briefs.
   */
  briefSeed: string;
}

/** ⚠ Mock data. See the file header — none of these openings exists. */
export const CAREER_ROLES: readonly CareerRole[] = [
  {
    index: '01',
    title: 'Senior Creative Engineer — WebGL',
    location: 'Remote (CET ±3)',
    commitment: 'Full-time',
    owns: [
      'The render path on one client product, from the first shader to the frame budget it ships against.',
      'Scene architecture: what gets drawn, what gets culled, and what never gets built because it cannot be afforded.',
      'The performance story told to the client — in numbers they can check.',
    ],
    needs: [
      'Shipped WebGL that survived real users on hardware you did not choose.',
      'GLSL you can read at speed and debug without a printf.',
      'A worked example of something you made faster, and how you knew.',
    ],
    bonus: ['Compute or GPGPU', 'Native graphics (Metal, Vulkan)', 'A rendering blog nobody asked you to write'],
    briefSeed:
      'The last thing I built that I would defend line by line is ',
  },
  {
    index: '02',
    title: 'Product Designer — Interaction',
    location: 'Remote (CET ±3)',
    commitment: 'Full-time',
    owns: [
      'The interaction model for a product surface — the motion language, not the icon set.',
      'Prototypes in the real medium. We do not hand engineers a video of an idea.',
      'The design system that keeps it coherent after you have moved on to the next one.',
    ],
    needs: [
      'Work where the motion was carrying meaning, and you can say what meaning.',
      'Enough code to prototype in the browser without waiting for anyone.',
      'Opinions about type at 13px that you can defend.',
    ],
    bonus: ['Motion or film background', 'Data-dense interfaces', 'An eye for a bad easing curve at ten paces'],
    briefSeed:
      'The interaction I am proudest of, and what it was actually solving: ',
  },
  {
    index: '03',
    title: 'Full-stack Engineer — Platform',
    location: 'Remote (CET ±3)',
    commitment: 'Full-time',
    owns: [
      'The spine under the surface: data models, realtime transport, and the boring parts staying boring.',
      'Deciding what belongs on the client and what has no business being there.',
      'The handover documentation, as a first-class piece of the work rather than a last week of it.',
    ],
    needs: [
      'TypeScript you have maintained, not just written.',
      'Realtime experience where correctness mattered — money, health, or anything with an audit trail.',
      'A story about a system you simplified rather than one you scaled.',
    ],
    bonus: ['Streaming data at volume', 'Postgres beyond the ORM', 'Having been on call for your own design'],
    briefSeed:
      'A system I built and would now build differently, and why: ',
  },
  {
    index: '04',
    title: 'Engineering Intern — Six months',
    location: 'Remote',
    commitment: 'Fixed term, paid',
    owns: [
      'A real slice of a real project, with your name on it, shipped to a real client.',
      'One thing that is entirely yours by month three.',
    ],
    needs: [
      'Something you have built that you cannot stop talking about. It does not have to be good.',
      'The ability to say "I do not know that yet" without flinching.',
    ],
    bonus: ['Graphics, games or simulation', 'A repository we can actually read'],
    briefSeed:
      'The thing I built that I cannot stop talking about is ',
  },
];

export const HIRING_PHASES: readonly Phase[] = [
  {
    span: 'Day 0',
    name: 'You write',
    detail: 'A note and a link. No cover letter, no form with nine required fields.',
  },
  {
    span: 'Inside 48 hours',
    name: 'We read the work',
    detail: 'The work, not the CV. You get an answer either way, from a person.',
  },
  {
    span: 'Week 1',
    name: 'Two conversations',
    detail: 'One about the craft, one about everything else. No whiteboard algorithms.',
  },
  {
    span: 'Week 2',
    name: 'A paid trial piece',
    detail: 'A real slice of real work, paid at the rate. You keep it either way.',
  },
];

export const OPEN_APPLICATION_TITLE = 'Then write anyway.';

export const OPEN_APPLICATION_LEAD =
  'The list above is what we know we need. It has been wrong before — twice the best application arrived for a role that did not exist yet. Tell us what you do and what you would want to own.';

/** The subject the open application carries, in place of a role title. */
export const OPEN_APPLICATION_SUBJECT = 'Open application';

export const OPEN_APPLICATION_SEED = 'What I do, and what I would want to own: ';

/** Names the long field. The form asks for a brief by default; an applicant is answering a different question. */
export const APPLICATION_BRIEF_LABEL = 'Why you';

export const APPLICATION_SUBMIT_LABEL = 'Send it';

/** The cross-link to the other document page. Both pages carry one to the other. */
export const CAREERS_ABOUT_INVITE = 'Read what the studio is first';
