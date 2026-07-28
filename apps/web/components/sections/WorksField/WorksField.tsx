'use client';

import dynamic from 'next/dynamic';
import { useRef } from 'react';
import { WORKS_PROJECTS } from './worksProjects';
import { useWorksTextTransition } from './hooks/useWorksTextTransition';

// The field owns a WebGL context, so keep it out of the server graph.
const FieldCanvas = dynamic(() => import('./FieldCanvas/FieldCanvas'), { ssr: false });

interface WorksFieldProps {
  /** The focused project — driven by the hero pin's works stops. */
  activeIndex: number;
  /** Jump to a project (arrow click); scrolls the hero pin to its stop. */
  goTo: (index: number) => void;
}

// The works field is an overlay INSIDE the hero section (like ServicesDeck): hidden until the
// fleet carousel finishes, then revealed on the same black. Scroll drives the focused project (the
// hero pin maps its works stops to an index); the arrows jump by scrolling the pin (see goTo).
export default function WorksField({ activeIndex, goTo }: WorksFieldProps) {
  const headIntroRef = useRef<HTMLDivElement>(null);
  const detailRef    = useRef<HTMLDivElement>(null);

  // The copy on screen trails the committed project: the old text has to shear away before the new
  // text can arrive, and the rock re-carves in the gap between them. See useWorksTextTransition.
  const displayedIndex = useWorksTextTransition({
    leftRef: headIntroRef,
    rightRef: detailRef,
    activeIndex,
  });

  const activeProject = WORKS_PROJECTS[displayedIndex];
  // The arrows reflect where the pin has COMMITTED, not what's still on screen — otherwise the "next"
  // arrow stays enabled for half a second after you've already reached the last project.
  const isFirst = activeIndex === 0;
  const isLast  = activeIndex === WORKS_PROJECTS.length - 1;

  return (
    <section id="work" className="works-field">
      {/* Solid backdrop so the field reads on its own black — matches the filled square. */}
      <div className="works-backdrop" aria-hidden="true" />

      <FieldCanvas activeIndex={activeIndex} />

      <div className="works-overlay">
        <header className="works-head">
          {/* Both blocks shear away and back on every project change (their direct children are the
              lines that stagger). The copy here is static — it leaves and returns unchanged — because
              the gesture is the whole overlay resetting around the new rock, not just the detail. */}
          <div className="works-head-intro" ref={headIntroRef}>
            <p className="eyebrow">Selected Work</p>
            <h2 className="works-title font-display">
              Four fires.<br />One field.
            </h2>
          </div>

          {/* Active-project detail. NOT keyed: GSAP owns the entrance now, so the nodes have to be
              stable — remounting them would tear the running tween off its targets mid-flight. */}
          <div className="works-detail" ref={detailRef}>
            <p className="works-detail-title font-display">{activeProject.title}</p>
            <p className="works-detail-meta">{activeProject.client} · {activeProject.year}</p>
            <p className="works-detail-copy">{activeProject.description}</p>
            <ul className="works-detail-tags">
              {activeProject.tags.map((tag) => (
                <li key={tag} className="works-detail-tag">{tag}</li>
              ))}
            </ul>
          </div>
        </header>

        {/* Navigation — two arrows step the focus; drag the field to look around. */}
        <nav className="works-nav" aria-label="Projects">
          <button
            type="button"
            className="works-arrow"
            onClick={() => goTo(activeIndex - 1)}
            disabled={isFirst}
            aria-label="Previous project"
          >
            <ArrowGlyph direction="left" />
          </button>

          <span className="works-counter">
            <span className="works-counter-current">{activeProject.index}</span>
            <span className="works-counter-sep" aria-hidden="true">/</span>
            <span className="works-counter-total">{String(WORKS_PROJECTS.length).padStart(2, '0')}</span>
          </span>

          <button
            type="button"
            className="works-arrow"
            onClick={() => goTo(activeIndex + 1)}
            disabled={isLast}
            aria-label="Next project"
          >
            <ArrowGlyph direction="right" />
          </button>
        </nav>
      </div>
    </section>
  );
}

function ArrowGlyph({ direction }: { direction: 'left' | 'right' }) {
  const path = direction === 'left' ? 'M11 4.5l-4 4 4 4M7 8.5h6' : 'M5 4.5l4 4-4 4M9 8.5H3';
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
