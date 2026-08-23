'use client';

import { useRef, type ReactNode } from 'react';
import type { DocSectionMeta } from './docSections';
import PageMasthead from './PageMasthead';
import OrbitRail from './OrbitRail';
import PageFooter from './PageFooter';
import { useScrollReveal } from './hooks/useScrollReveal';

/**
 * The frame both document pages are built in — `/about` and `/careers`.
 *
 * ── ⚠ THIS IS NOT A SECTION OF THE HOMEPAGE, AND MUST NOT BECOME ONE ─────────────────────────────
 * The homepage is ONE pinned ScrollTrigger and every "section" in it is an overlay inside that pin.
 * These pages are the opposite by design: ordinary documents on native scroll, no pin, no WebGL, and
 * not a line of animation-library code. The site's rule is "one pin, and new transitions go inside it"
 * — the way to honour that is to keep pages that are genuinely prose out of it entirely, rather than
 * building a second one. `docs/about-careers-plan.md` §0 has the reasoning.
 *
 * ⚠ "Not a line of GSAP" is true of the code and NOT of the bundle: the root layout's `Navbar` imports
 * it for the bar's entrance, so ~69 KB of gsap + ScrollTrigger lands on these routes unused. Measured,
 * recorded in docs/about-careers-plan.md §6, and fixable in one hook — don't re-derive it.
 *
 * ── What the frame is ────────────────────────────────────────────────────────────────────────────
 *
 *   ┌──────────────────────────────────────────┐
 *   │ ▮ navbar (from the root layout)          │
 *   │                                          │   .doc-field   — a fixed backdrop: two star
 *   │   ABOUT — VOIDIX                         │                  layers and one amber bloom,
 *   │   Big display title                      │                  all CSS gradients. No canvas.
 *   │   ──────                                 │
 *   │              lead, hung to the right     │   .doc-masthead
 *   │                                          │
 *   │  ╷ 01   01 · THE PREMISE ─────────────   │   OrbitRail + the page's DocSections
 *   │  ●      …                                │
 *   │  ╵ 02   02 · WHAT WE ARE MADE OF ─────   │
 *   │                                          │
 *   │  Voidix          Studio Direct Legal     │   PageFooter, off the homepage's own link data
 *   └──────────────────────────────────────────┘
 *
 * ── ⚠ THE BACKDROP IS GRADIENTS, NOT A CANVAS, AND THAT IS A BUDGET DECISION ─────────────────────
 * A starfield is four lines of WebGL and this site has the machinery to draw a beautiful one. It is
 * still the wrong call here: the homepage already spends its entire GPU budget on four real scenes, a
 * visitor who opens About has usually just come from that, and a second context costs a compile and an
 * allocation to decorate a page of prose. Three `radial-gradient`s composite for free and drift under a
 * CSS animation — which also means the reduced-motion blanket rule already stops them with no new code.
 */

/**
 * ⚠ THE NO-JAVASCRIPT NET, AND IT IS NOT OPTIONAL.
 *
 * Every revealed element starts at `opacity: 0` in the stylesheet and is brought in by a class that
 * `useScrollReveal` adds. No script, no class — and the page is a screenful of nothing. That is a page
 * of real copy about a real studio, so it has to be legible without the observer ever running.
 *
 * `globals.css` covers this with `@media (scripting: none)`, which is the modern answer and which older
 * browsers ignore entirely. This is the other half: `<noscript>` has been understood by everything for
 * twenty years, and between the two there is no browser that gets the invisible version.
 *
 * It is only ever parsed when scripting is off, so it costs a live visitor nothing but its bytes.
 */
const NO_SCRIPT_REVEAL_CSS = `
  .doc-page [class*='doc-'] {
    opacity: 1 !important;
    transform: none !important;
    clip-path: none !important;
  }
  .doc-role-panel { visibility: visible !important; grid-template-rows: 1fr !important; }
`;

interface PageShellProps {
  /** The kicker over the title. */
  eyebrow: string;
  /** One entry per sentence — see PageMasthead on why this is never a string with a break in it. */
  title: readonly string[];
  lead: string;
  /** Feeds the rail's stations. The page renders the matching sections itself. */
  sections: readonly DocSectionMeta[];
  children: ReactNode;
}

export default function PageShell({
  eyebrow,
  title,
  lead,
  sections,
  children,
}: PageShellProps) {
  const pageRef = useRef<HTMLElement>(null);

  useScrollReveal(pageRef);

  return (
    <main ref={pageRef} className="doc-page">
      <noscript>
        <style>{NO_SCRIPT_REVEAL_CSS}</style>
      </noscript>

      {/* Fixed, behind everything, and it never scrolls — the page moves THROUGH the field rather than
          carrying it, which is the difference between a background and a place. */}
      <div className="doc-field" aria-hidden="true">
        <span className="doc-field-stars doc-field-stars--fine" />
        <span className="doc-field-stars doc-field-stars--coarse" />
        <span className="doc-field-bloom" />
      </div>

      {/* ⚠ NOT a centred container — it is a stacking lift and nothing else. It held
          `max-width: 76rem` until 2026-08-21, which made every one of these routes a 1216px island on
          any screen wider than that while `/` ran edge to edge. The homepage has no such wrapper
          anywhere; see the block on `.doc-inner` in globals.css for what holds the copy instead. */}
      <div className="doc-inner">
        <PageMasthead eyebrow={eyebrow} title={title} lead={lead} />

        <div className="doc-body">
          <OrbitRail sections={sections} />
          <div className="doc-flow">{children}</div>
        </div>

        <PageFooter />
      </div>
    </main>
  );
}
