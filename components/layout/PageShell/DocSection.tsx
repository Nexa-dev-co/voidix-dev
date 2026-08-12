import type { ReactNode } from 'react';
import type { DocSectionMeta } from './docSections';

/**
 * One numbered section of a document page — the heading, its hairline, and whatever it holds.
 *
 * ⚠ `data-doc-section` is not decoration: `useOrbitRail` measures every element carrying it to work
 * out which station you are at. A section rendered any other way is a section the rail cannot see.
 *
 * ⚠ `id` is the anchor a rail node travels to, and it comes from the same `key` the node was built
 * from — which is the point of both reading one `DocSectionMeta`. A node whose href resolves to
 * nothing falls back to ordinary anchor behaviour and jumps to the top of the page, silently.
 *
 * ── ⚠ THE HEADING IS DISPLAY TYPE, NOT AN EYEBROW, AND THAT WAS A FIX ────────────────────────────
 * It used to carry the site's `.eyebrow` class: tiny, uppercase, wide-tracked, over every section on
 * both routes. Four of those down a page is not a kicker, it is scaffolding — the section headings had
 * less presence than the body copy under them, and every section looked like every other one. The
 * numeral is what carries the tracked-caps register now, and it is large enough to be a design element
 * rather than a label.
 *
 * ⚠ The numbering itself is NOT decoration bolted on: this site numbers things everywhere — the
 * navbar's meters, the orbit rail's stations, the fleet, the claim rows, the roles. Making these
 * numerals bigger commits to a system the site already has. Do not read it as licence to number a
 * fifth thing that has no sequence.
 */

interface DocSectionProps {
  meta: DocSectionMeta;
  children: ReactNode;
  /** Widens the section to the full measure — for the ones holding a track or a grid rather than prose. */
  wide?: boolean;
}

export default function DocSection({ meta, children, wide = false }: DocSectionProps) {
  return (
    <section
      id={meta.key}
      className="doc-section"
      data-doc-section
      data-wide={wide}
      data-reveal
      aria-labelledby={`${meta.key}-heading`}
    >
      <div className="doc-section-head">
        <span className="font-display doc-section-number" aria-hidden="true">
          {meta.number}
        </span>
        <h2 id={`${meta.key}-heading`} className="font-display doc-section-title">
          {meta.title}
        </h2>
        <span className="doc-section-rule" aria-hidden="true" />
      </div>

      <div className="doc-section-body">{children}</div>
    </section>
  );
}
