import type { DocSectionMeta } from '@/components/layout/PageShell/docSections';

/**
 * The words `/lite` adds — and there are deliberately very few of them.
 *
 * ── ⚠ THIS PAGE INVENTS NO CONTENT ───────────────────────────────────────────────────────────────
 * Everything a visitor came for already exists, written in the site's voice, in the homepage's own
 * content files: `DECK_SERVICES`, `WORKS_PROJECTS`, `FAQ_ENTRIES`. `/lite` re-presents those. It does
 * not summarise them, paraphrase them or write a shorter version — a second copy of the site's words
 * is a second thing to keep in step, and the first time one of them is edited alone the two pages
 * start disagreeing about what the studio does.
 *
 * So the only new copy is the frame: a masthead that says what this page is, and a close that points
 * back. Both are written to the house pattern — a claim, then the thing that backs it up.
 */

export const LITE_EYEBROW = 'No download required';

/** One entry per sentence — see PageMasthead on why this is never a string with a break in it. */
export const LITE_TITLE = [
  'Everything the site says.',
  'None of what it had to load.',
] as const;

export const LITE_LEAD =
  'The homepage is a ten-megabyte argument for what we can build — four WebGL scenes and one continuous flight through them. This is the same argument in text. Same services, same work, same answers, nothing to download and nothing to wait for.';

/**
 * ── ⚠ THE KEYS ARE THE NAVBAR'S KEYS, AND THAT IS LOAD-BEARING ───────────────────────────────────
 *
 * `services` / `work` / `faq`, not the `build` / `work` / `questions` they read as prose. A `key` is
 * only the anchor id and the React key — the TITLES are what a visitor sees, and those are unchanged —
 * so naming them after the navbar costs nothing here and buys the one thing this page most needed:
 * the bar's four items can stay on this page instead of fetching the ten megabytes `/lite` exists to
 * avoid. See lib/inPageSectionRoutes.ts.
 *
 * The alternative was a translation table from nav key to anchor id, and this file is the wrong place
 * for one: `navItems.ts` and `docSections.ts` both open by arguing that the moment two places name a
 * section, one of them gets renamed alone. A map between them would have been a third.
 *
 * ⚠ So a rename here silently unhooks a nav item. It cannot break the page — `scrollToSection` falls
 * through to the `href` and the visitor ends up on the homepage's own section — but it is a quiet
 * downgrade rather than an error, which is exactly the kind that survives a review.
 */
export const LITE_SECTIONS: readonly DocSectionMeta[] = [
  { key: 'services', number: '01', title: 'What we build' },
  { key: 'work', number: '02', title: 'Selected work' },
  { key: 'faq', number: '03', title: 'Questions' },
];

/**
 * The close's anchor — where the navbar's `04 Contact` and its CTA land on this page.
 *
 * ⚠ NOT a fourth `DocSection`, and that is deliberate. The close is the page ENDING rather than a
 * fourth thing the page has to say, which is why it carries no rail station (same rule as About's).
 * Giving it a station to make the navigation tidier would put a number on the site's sign-off.
 *
 * It holds the real *Start a project* button and its `EnquiryPanel`, so landing here is landing on the
 * thing a visitor pressing Contact came for — not on a link to it.
 */
export const LITE_CLOSE_ANCHOR = 'contact';

export const LITE_CLOSING_TITLE = 'The flight is still there.';

export const LITE_CLOSING_LEAD =
  'Nothing on this page is a summary. It is the same words, without the scene they normally arrive in — so when you are on a connection that will carry it, the full site is still worth the ten megabytes.';

export const LITE_FULL_SITE_INVITE = 'Take the full site';
