'use client';

import { useEffect, type RefObject } from 'react';
import { pointOnRail } from '../railGeometry';

/**
 * Drives the orbit rail from the page's scroll position.
 *
 * ── ⚠ NOTHING HERE GOES THROUGH REACT STATE ──────────────────────────────────────────────────────
 * This runs on every scroll frame, and a `setState` per frame is a re-render per frame — the exact
 * trade `lib/hologramPose.ts` documents refusing for the FAQ panel. So the hook writes a CSS custom
 * property and moves two nodes with the DOM directly. The React tree renders once and then holds
 * still while the instrument moves inside it.
 *
 * Three things move, and each is written the cheapest way it can be:
 *
 *   --doc-progress   on <html>, like the pin's own --nav-progress-* vars. Read by the arc's
 *                    stroke-dashoffset AND by the phone's progress hairline, which is how one number
 *                    drives two completely different presentations with no second listener.
 *   the body         cx/cy on one <circle>. Two attribute writes; no layout, no style recalc beyond
 *                    the element itself.
 *   the active node  a `data-active` attribute, written ONLY on the frame the index actually changes.
 *
 * ── The measuring is separate from the scrolling, on purpose ──────────────────────────────────────
 * Section offsets are measured on mount, on resize and once the fonts have settled — never in the
 * scroll handler. `offsetTop` is a layout read, and doing one per section per frame is how a smooth
 * page becomes a janky one. The scroll path below touches no geometry at all.
 */

interface OrbitRailRefs {
  /** The rail's root. The arc, the body and the nodes are all found inside it. */
  railRef: RefObject<HTMLElement | null>;
  /** How many nodes there are — a dependency, so a page with a different section count re-binds. */
  sectionCount: number;
}

/** How far down the viewport a section has to reach before the rail calls it the one you are in. */
const ACTIVE_LINE_FRACTION = 0.4;

export function useOrbitRail({ railRef, sectionCount }: OrbitRailRefs) {
  useEffect(() => {
    const railElement = railRef.current;
    if (!railElement) return;

    const bodyElement = railElement.querySelector<SVGCircleElement>('[data-rail-body]');
    const nodeElements = Array.from(
      railElement.querySelectorAll<HTMLElement>('[data-rail-node]'),
    );

    // Measured, not per frame — see the header.
    let sectionOffsets: number[] = [];
    const measureSections = () => {
      sectionOffsets = Array.from(
        document.querySelectorAll<HTMLElement>('[data-doc-section]'),
      ).map((section) => section.getBoundingClientRect().top + window.scrollY);
    };

    let lastActiveIndex = -2; // -1 is a real value here (the masthead), so the initial miss is -2.
    let frameRequest = 0;

    const update = () => {
      frameRequest = 0;

      // The scrollable distance can be zero — a short page on a tall screen — and a page with nothing
      // to scroll is a page you are at the end of.
      const scrollableDistance = document.documentElement.scrollHeight - window.innerHeight;
      const progress =
        scrollableDistance > 0
          ? Math.min(1, Math.max(0, window.scrollY / scrollableDistance))
          : 1;

      document.documentElement.style.setProperty('--doc-progress', `${progress}`);

      if (bodyElement) {
        const { x, y } = pointOnRail(progress);
        bodyElement.setAttribute('cx', x.toFixed(2));
        bodyElement.setAttribute('cy', y.toFixed(2));
      }

      // The one you are in is the last one whose top has crossed the line — the same "last one that
      // has started" rule `orbitGeometry.currentSectionIndex` uses for the phone's dial.
      const activeLine = window.scrollY + window.innerHeight * ACTIVE_LINE_FRACTION;
      let activeIndex = -1;
      sectionOffsets.forEach((offset, index) => {
        if (offset <= activeLine) activeIndex = index;
      });

      if (activeIndex !== lastActiveIndex) {
        lastActiveIndex = activeIndex;
        nodeElements.forEach((node, index) => {
          node.setAttribute('data-active', String(index === activeIndex));
          // Everything behind you stays lit, so the rail reads as a journey travelled rather than as a
          // single lamp moving down a strip.
          node.setAttribute('data-passed', String(index <= activeIndex));
        });
      }
    };

    const requestUpdate = () => {
      if (frameRequest) return;
      frameRequest = window.requestAnimationFrame(update);
    };

    const remeasure = () => {
      measureSections();
      requestUpdate();
    };

    remeasure();

    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', remeasure);
    // Label widths — and therefore how many lines a heading takes, and therefore every offset below
    // it — change when the display font lands. The navbar's meters re-measure for the same reason.
    if (document.fonts?.ready) document.fonts.ready.then(remeasure);

    return () => {
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', remeasure);
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
      document.documentElement.style.removeProperty('--doc-progress');
    };
  }, [railRef, sectionCount]);
}
