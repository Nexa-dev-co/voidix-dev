/**
 * What a document page's numbered sections are, as data.
 *
 * The page's content file declares this list once and it feeds three things that would otherwise each
 * invent their own copy: the section headings themselves, the orbit rail's nodes, and the anchor a rail
 * node scrolls to. The same argument `navItems.ts` makes for the navbar — the moment two places name a
 * section, one of them is going to get renamed alone.
 */

export interface DocSectionMeta {
  /** Anchor id and React key. Kebab-case, and it is what a rail node scrolls to. */
  key: string;
  /** Two-digit ordinal, shown by the heading and by the rail node. */
  number: string;
  /** The heading itself. */
  title: string;
}
