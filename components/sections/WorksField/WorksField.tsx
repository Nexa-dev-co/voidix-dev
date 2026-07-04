'use client';

import dynamic from 'next/dynamic';
import { WORKS_PROJECTS } from './worksProjects';

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
  const activeProject = WORKS_PROJECTS[activeIndex];
  const isFirst = activeIndex === 0;
  const isLast  = activeIndex === WORKS_PROJECTS.length - 1;

  return (
    <section id="work" className="works-field">
      {/* Solid backdrop so the field reads on its own black — matches the filled square. */}
      <div className="works-backdrop" aria-hidden="true" />

      <FieldCanvas activeIndex={activeIndex} />

      <div className="works-overlay">
        <header className="works-head">
          <div className="works-head-intro">
            <p className="eyebrow">Selected Work</p>
            <h2 className="works-title font-display">
              Four fires.<br />One field.
            </h2>
          </div>

          {/* Active-project detail — keyed so it re-mounts and re-reveals on every change. */}
          <div className="works-detail" key={activeProject.index}>
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
