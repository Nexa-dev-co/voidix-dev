/**
 * The shape both legal routes are written in — `/privacy` and `/terms`.
 *
 * ── ⚠ WHY THESE TWO SHARE A COMPONENT WHEN `/about` AND `/careers` DO NOT ────────────────────────
 * About and Careers are separate components because they render genuinely different things: a phase
 * track, an instruments grid, a roles list, a claim ladder. The two legal pages render the same thing
 * twice — numbered sections of prose, some of which carry a list. One component driven by this shape
 * is the honest reading of that, and it is not a mini-CMS: there are exactly three fields and no
 * `kind` discriminator, because the moment a legal page needs a fifth kind of block it should be
 * asking whether it is still a legal page.
 *
 * ⚠ `points` covers both a plain enumeration and a definition list. `term` is what makes it the
 * latter, and it is optional for exactly that reason — the privacy ledger ("what we collect, and
 * where it goes") and the terms' bulleted caveats are the same object with and without a lead-in.
 */

import type { DocSectionMeta } from '@/components/layout/PageShell/docSections';

export interface LegalPoint {
  /**
   * The thing being defined, set in the display face. Omit for a plain bullet.
   *
   * ⚠ Not a heading element. These sit inside a section that already owns an `<h2>`, and a legal
   * document whose every bullet is an `<h3>` produces an outline no screen-reader user asked for.
   */
  term?: string;
  detail: string;
}

export interface LegalSection {
  /** Anchor id, ordinal and heading — the same object the orbit rail's stations are built from. */
  meta: DocSectionMeta;
  paragraphs: readonly string[];
  points?: readonly LegalPoint[];
  /** A closing caveat, quieter than body copy. For the thing the section is honest about. */
  note?: string;
}

export interface LegalDocument {
  /** The kicker over the title — the document's own name. */
  eyebrow: string;
  /** One entry per sentence. ⚠ Never one string with a break in it — see PageMasthead. */
  title: readonly string[];
  lead: string;
  /**
   * ⚠ THE DATE THIS WAS LAST READ BY A HUMAN, not the date the file was last edited.
   *
   * A fixed string rather than a build date, and deliberately so: a legal document that silently
   * re-dates itself on every deploy tells a visitor it was reviewed when it was only rebuilt. Change
   * it when the words change and at no other time.
   */
  lastReviewed: string;
  sections: readonly LegalSection[];
  /** The close — one line, and the address to write to. Not a numbered section. */
  closingTitle: string;
  closingLead: string;
}

/**
 * The section list, for the orbit rail.
 *
 * ⚠ The rail and the sections must be built from ONE list or a station will scroll to an anchor that
 * does not exist — which fails by jumping to the top of the page, silently. This derives the rail's
 * input from the document itself so the two cannot drift.
 */
export const railSectionsOf = (document: LegalDocument): readonly DocSectionMeta[] =>
  document.sections.map((section) => section.meta);
