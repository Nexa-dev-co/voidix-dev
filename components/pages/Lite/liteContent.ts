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

export const LITE_SECTIONS: readonly DocSectionMeta[] = [
  { key: 'build', number: '01', title: 'What we build' },
  { key: 'work', number: '02', title: 'Selected work' },
  { key: 'questions', number: '03', title: 'Questions' },
];

export const LITE_CLOSING_TITLE = 'The flight is still there.';

export const LITE_CLOSING_LEAD =
  'Nothing on this page is a summary. It is the same words, without the scene they normally arrive in — so when you are on a connection that will carry it, the full site is still worth the ten megabytes.';

export const LITE_FULL_SITE_INVITE = 'Take the full site';
