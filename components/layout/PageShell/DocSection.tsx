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
        <span className="doc-section-number" aria-hidden="true">
          {meta.number}
        </span>
        <h2 id={`${meta.key}-heading`} className="eyebrow doc-section-title">
          {meta.title}
        </h2>
        <span className="doc-section-rule" aria-hidden="true" />
      </div>

      <div className="doc-section-body">{children}</div>
    </section>
  );
}
