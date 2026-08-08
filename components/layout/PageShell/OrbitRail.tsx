'use client';

import { useRef, type CSSProperties } from 'react';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import type { DocSectionMeta } from './docSections';
import { RAIL_VIEW_BOX, nodeFraction, pointOnRail, railPath } from './railGeometry';
import { useOrbitRail } from './hooks/useOrbitRail';

/**
 * The document pages' position instrument — an orbit standing in the left gutter with one station per
 * numbered section and a body travelling it as you scroll.
 *
 * It is the one idea these pages borrow from the homepage rather than inventing: the navbar measures a
 * journey with meters under its items, and this measures a shorter one with an orbit. Where a scroll
 * bar would say "how much is left", this says "which station you are at, and how far between".
 *
 * ── ⚠ IT IS AN INSTRUMENT, SO IT IS ALSO A CONTROL ───────────────────────────────────────────────
 * The nodes are real buttons and pressing one travels to that section. A read-only indicator sitting
 * in a gutter that the eye has already learned to track is a control the visitor will try to press;
 * having it do nothing is worse than not drawing it.
 *
 * ── ⚠ ONE SOURCE OF PROGRESS, TWO PRESENTATIONS ──────────────────────────────────────────────────
 * Below 64em there is no gutter to stand in — that is what a gutter IS on a phone — so the arc is
 * hidden and the same `--doc-progress` drives a hairline under the navbar instead. Both are rendered
 * always and CSS picks; there is no second listener, no width branch in JavaScript, and nothing to
 * resynchronise when a window is dragged across the breakpoint.
 *
 * The geometry is in `railGeometry.ts` so the arc, the stations and the body cannot drift apart.
 */

interface OrbitRailProps {
  sections: readonly DocSectionMeta[];
}

export default function OrbitRail({ sections }: OrbitRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  useOrbitRail({ railRef, sectionCount: sections.length });

  // Travel to a station. Not a bare `#anchor` href, because smooth scrolling would have to be turned on
  // globally to make one glide — and `html { scroll-behavior: smooth }` is exactly the thing that
  // fights ScrollTrigger on the homepage, which shares this stylesheet. Scoped to the press instead.
  const travelToSection = (event: React.MouseEvent<HTMLAnchorElement>, key: string) => {
    const target = document.getElementById(key);
    if (!target) return; // Let the href do whatever a browser would do; better than swallowing it.
    event.preventDefault();
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.scrollY,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  return (
    <div ref={railRef} className="doc-rail" aria-hidden="true">
      {/* The phone's form of the same number. Fixed under the navbar; `aria-hidden` on the whole rail
          covers it, because a progress bar is not information a screen reader needs read to it. */}
      <span className="doc-rail-hairline" />

      <div className="doc-rail-arc-wrap">
        <svg
          className="doc-rail-arc"
          viewBox={`0 0 ${RAIL_VIEW_BOX.width} ${RAIL_VIEW_BOX.height}`}
          fill="none"
        >
          {/* The whole orbit, unlit. */}
          <path className="doc-rail-track" d={railPath()} />
          {/* ⚠ `pathLength="1"` normalises this path to one unit long, so the dash pair below is
              literally "progress travelled, the rest not" with no arc-length arithmetic — and none to
              redo if the arc's curvature is ever retuned. */}
          <path className="doc-rail-travelled" d={railPath()} pathLength={1} />
          <circle className="doc-rail-body" data-rail-body r="3.4" cx="0" cy="0" />
        </svg>

        {/* The stations. Positioned in the SVG's own units through a CSS var, so they scale with the
            arc rather than needing a second set of numbers in px. */}
        {sections.map((section, index) => {
          const point = pointOnRail(nodeFraction(index, sections.length));
          return (
            <a
              key={section.key}
              href={`#${section.key}`}
              className="doc-rail-node"
              data-rail-node
              data-active="false"
              data-passed="false"
              onClick={(event) => travelToSection(event, section.key)}
              // The rail is aria-hidden, so these carry no accessible name and are unreachable by
              // assistive tech — deliberately. Every section is already reachable by scrolling and by
              // its own heading; this is a shortcut for a pointer, not a second navigation to maintain.
              tabIndex={-1}
              style={
                {
                  '--node-x': `${point.x}`,
                  '--node-y': `${point.y}`,
                } as CSSProperties
              }
            >
              <span className="doc-rail-node-dot" />
              <span className="doc-rail-node-number">{section.number}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
