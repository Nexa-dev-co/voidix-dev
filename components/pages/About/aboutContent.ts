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

  title: ['One technology partner.', 'Multiple connected systems.'],

  lead: 'Voidix is a custom software development company building digital products and business systems for companies across the United States. We turn new ideas, outdated tools, manual processes, and disconnected systems into working software.',

  premiseParagraphs: [
    'Off-the-shelf software asks your business to adapt to the product. Custom software works the other way around: it is designed around your processes, customers, data, and goals.',
    'Your website should communicate with your CRM. Your CRM should communicate with your applications. Your applications should communicate with your internal systems. Automation should connect the work between them. We build that technology layer as one system.',
  ],

  premiseQuote: 'Your business → Your workflow → Your software.',

  principles: [
    {
      index: '01',
      claim: 'Replace manual processes.',
      backing:
        'Move repetitive work out of spreadsheets, emails, and disconnected tools and into systems that can carry it reliably.',
    },
    {
      index: '02',
      claim: 'Replace outdated software.',
      backing:
        'Modernize legacy systems and replace software that no longer fits the way your business operates.',
    },
    {
      index: '03',
      claim: 'Launch a new product.',
      backing:
        'Turn an idea into an MVP, SaaS platform, web application, mobile product, or connected customer experience.',
    },
    {
      index: '04',
      claim: 'Connect your systems.',
      backing:
        'Integrate your CRM, website, applications, APIs, databases, payment systems, and business tools.',
    },
    {
      index: '05',
      claim: 'Add AI where it helps.',
      backing:
        'Identify practical uses for AI in customer service, operations, sales, internal knowledge, documents, and data-heavy workflows.',
    },
    {
      index: '06',
      claim: 'Build a competitive product.',
      backing:
        'Create technology around your customers and operating model instead of relying on generic software to define both.',
    },
  ],

  buildPhases: [
    {
      span: '01',
      name: 'Discover',
      detail: 'We learn your business, users, current technology, workflows, and objectives before deciding what to build.',
    },
    {
      span: '02',
      name: 'Architect',
      detail: 'We turn the requirements into a roadmap covering product structure, data, integrations, automation, and priorities.',
    },
    {
      span: '03',
      name: 'Design',
      detail: 'We design the interfaces and workflows around the people who will use the product and the decisions they need to make.',
    },
    {
      span: '04',
      name: 'Build',
      detail: 'We turn the approved architecture and designs into working software, with progress visible throughout development.',
    },
    {
      span: '05',
      name: 'Launch',
      detail: 'We test, deploy, integrate, and prepare the product for real users and real business operations.',
    },
    {
      span: '06',
      name: 'Evolve',
      detail: 'We can continue improving the product, adding features, connecting systems, and introducing automation or AI as the business grows.',
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
    'Websites',
    'Web applications',
    'CRM platforms',
    'Mobile apps',
    'SaaS products',
    'AI software',
    'Business automation',
    'Software integrations',
  ],

  stackNote:
    'A project can begin with one system and grow into a connected digital ecosystem without rebuilding the foundation each time.',

  closingTitle: "Tell us what you're building.",

  closingLead:
    "You don't need a perfect technical specification. Tell us what it should do, who will use it, and what needs to be true when it launches.",

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
