/**
 * The contact section's copy, in one place — exactly as `deckServices.ts`, `worksProjects.ts` and
 * `faqEntries.ts` are for their sections. Swapping the words touches no component.
 *
 * The voice is the one the rest of the site speaks in: a claim, then the thing that backs it up. No
 * agency boilerplate, no "let's build something amazing together".
 */

export const CONTACT_TITLE = 'Tell us what you are building.';

/**
 * ⚠ Placeholder-adjacent: the words are on-voice but the PROMISE in them is real. Do not ship "you
 * will get an answer from the people who would build it" unless that is true — the rest of the copy on
 * this site is careful never to claim something it cannot back, and this is the one line a visitor can
 * hold us to.
 */
export const CONTACT_LEAD =
  'A paragraph is enough — what it is, who it is for, and what has to be true on the day it ships. You will get an answer from the people who would build it, not a sales desk.';

export interface ContactFooterLink {
  label: string;
  href: string;
  /** Off-site links open in a new tab and carry `rel="noreferrer"`. */
  external?: boolean;
}

export interface ContactFooterGroup {
  /** The small uppercase kicker over the group. */
  title: string;
  links: ContactFooterLink[];
}

/**
 * ⚠ EVERY DESTINATION BELOW IS INVENTED — EXCEPT THE TWO IN `Studio`, WHICH ARE REAL ROUTES.
 *
 * `hello@voidix.studio` is not a verified address, the social handles are not claimed accounts, and
 * `/privacy` and `/terms` do not exist. They are here so the footer has its real shape and spacing.
 *
 * Do not ship any of them. A dead social link on a studio site reads worse than no social link, and a
 * mailto that bounces is worse than a form. Replacing these is the same job as wiring the form's
 * endpoint (docs/contact-black-hole-plan.md §7b).
 *
 * `/about` and `/careers` are the exception: they are pages, they exist, and they are the only links
 * in here you can currently click without being lied to.
 *
 * ── ⚠ THIS ARRAY NOW FEEDS TWO FOOTERS ───────────────────────────────────────────────────────────
 * The contact section's, and `components/layout/PageShell/PageFooter` on the document routes. That is
 * deliberate — one list of links on the site rather than two that agree today and drift the first time
 * a handle changes — but it means an edit here lands in two places with very different space budgets.
 * The contact footer shares ONE pinned viewport with a form and a black hole, and `globals.css` has an
 * entire `@media (max-width: 30em)` block about the ~150px it once overran by. **Check a change here
 * against a 360px phone on the homepage**, not only on `/about` where there is room to spare.
 *
 * Links are grouped rather than listed flat for that same reason: four short columns cost a few lines,
 * where one flat list of ten would cost far more.
 */
export const CONTACT_FOOTER_GROUPS: ContactFooterGroup[] = [
  {
    // First, because these are the only two entries that go anywhere real, and because a visitor
    // looking for "who are you" in a footer looks left before they look anywhere else.
    title: 'Studio',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Careers', href: '/careers' },
    ],
  },
  {
    title: 'Direct',
    links: [{ label: 'hello@voidix.studio', href: 'mailto:hello@voidix.studio' }],
  },
  {
    title: 'Elsewhere',
    links: [
      { label: 'X', href: 'https://x.com/voidixstudio', external: true },
      { label: 'LinkedIn', href: 'https://linkedin.com/company/voidixstudio', external: true },
      { label: 'GitHub', href: 'https://github.com/voidixstudio', external: true },
      { label: 'Dribbble', href: 'https://dribbble.com/voidixstudio', external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
];

/**
 * The black hole model's attribution.
 *
 * CC-BY-4.0 requires the title, the author and the licence to travel with the work wherever it is
 * shown. `CLAUDE.md` has recorded that this credit "is currently nowhere" since the model was added;
 * the contact footer is where it lands, because contact is the first section that puts it on screen.
 *
 * There is deliberately NO link to the model's source page: the licence does not require one, and a
 * URL invented from memory would be worse than its absence. Add the real one when it is to hand.
 */
export const MODEL_ATTRIBUTION = {
  prefix: 'Black hole model: ',
  title: 'Black Hole',
  author: 'NestaEric',
  licence: 'CC BY 4.0',
  licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
} as const;
