'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useSiteContent, useSiteSections } from '@/lib/cms/SiteContentProvider';
import { useWorksTextTransition } from './hooks/useWorksTextTransition';
import { WORKS_FIELD_PHRASE, worksCountPhrase } from './worksProjects';
import { useSectionArrival, type ArrivalGroup } from '@/lib/hooks/useSectionArrival';
import { useIsNarrowViewport } from '@/lib/hooks/useIsNarrowViewport';
import { buildEnquiryPrefill } from '@/lib/enquirySubjects';
import Drawer from '@/components/ui/Drawer/Drawer';
import EnquiryButton from '@/components/ui/EnquiryButton/EnquiryButton';
import EnquiryPanel from '@/components/ui/EnquiryPanel/EnquiryPanel';

// What comes to rest when a covered nav jump lands here: both head blocks line by line, then the
// arrows. The mark itself needs nothing — the glide settled it on the way in.
//
// The display lines TIGHTEN as they land, their letter-spacing closing from wide, so the words lock
// together the way the stones do. That is the section's own idea, borrowed for its copy.
//
// Hoisted out of the component: the hook holds this in a dependency array, and an array rebuilt every
// render would tear its listener down and re-add it on each one.
const ARRIVAL_GROUPS: readonly ArrivalGroup[] = [
  { selector: '.works-head-intro > *', from: 'bottom', tighten: true },
  { selector: '.works-detail > *', from: 'bottom' },
  { selector: '.works-nav', from: 'bottom' },
];

// The field owns a WebGL context, so keep it out of the server graph.
const FieldCanvas = dynamic(() => import('./FieldCanvas/FieldCanvas'), { ssr: false });

/** Which panel is up. One at a time — two stacked sheets is not a state. */
type OpenSheet = 'none' | 'details' | 'enquiry';


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
  const overlayRef   = useRef<HTMLDivElement>(null);

  useSectionArrival({
    sectionKey: 'work',
    containerRef: overlayRef,
    profile: 'settle',
    groups: ARRIVAL_GROUPS,
  });

  // The copy on screen trails the committed project: the old text has to shear away before the new
  // text can arrive, and the rock re-carves in the gap between them. See useWorksTextTransition.
  const displayedIndex = useWorksTextTransition({
    leftRef: headIntroRef,
    rightRef: detailRef,
    activeIndex,
  });

  // ⚠ NOT copy only, and it used to be. `useWorksField` read `WORKS_PROJECTS` directly for its
  // `markId`, because the body a project grows into was geometry this repo owned. A project now
  // carries its own mark and its own place on a generated camera path, so this list is the whole
  // truth about the section and the scene is handed it rather than importing a constant.
  const { disciplines, enquiryForm } = useSiteContent();
  const { projects } = useSiteSections();

  const activeProject = projects[displayedIndex];
  // The arrows reflect where the pin has COMMITTED, not what's still on screen — otherwise the "next"
  // arrow stays enabled for half a second after you've already reached the last project.
  const isFirst = activeIndex === 0;
  const isLast  = activeIndex === projects.length - 1;

  // ── The narrow layout ──
  // A phone keeps only what names the thing on screen — the project's title and the year — and moves
  // the client, the paragraph and the tags into a drawer. The arrows go out to the frame's edges, with
  // the counter and the drawer's button stacked between them.
  const isNarrow = useIsNarrowViewport();
  const [openSheet, setOpenSheet] = useState<OpenSheet>('none');

  // Both panels describe one project, so neither can outlive the selection. ⚠ Keyed off `activeIndex`,
  // the COMMITTED project — not `displayedIndex`, which trails it while the copy shears out. Closing on
  // the displayed one would leave a panel up for the length of the text transition, showing the old
  // project's copy over the new project's mark.
  useEffect(() => setOpenSheet('none'), [activeIndex]);
  // ⚠ ANY width change, not just leaving the narrow layout — the enquiry swaps its whole shell across
  // the breakpoint (sheet ↔ dialog), so an open panel is a different element on the other side of it.
  useEffect(() => setOpenSheet('none'), [isNarrow]);

  // The type key above the title, and the same word the enquiry arrives already knowing.
  const discipline = disciplines[activeProject.discipline];
  // Named, so the brief opens "in the orbit of Aphelion" rather than as a cold start — this CTA is
  // pressed while looking at a specific piece of work, and that is the useful part of it.
  const enquiryPrefill = buildEnquiryPrefill({
    discipline: activeProject.discipline,
    disciplines,
    referenceSubjectSuffix: enquiryForm.referenceSubjectSuffix,
    referenceBriefPrefix: enquiryForm.referenceBriefPrefix,
    reference: activeProject.title,
  });

  return (
    <section id="work" className="works-field">
      {/* Solid backdrop so the field reads on its own black — matches the filled square. */}
      <div className="works-backdrop" aria-hidden="true" />

      <FieldCanvas activeIndex={activeIndex} projects={projects} />

      <div ref={overlayRef} className="works-overlay">
        <header className="works-head">
          {/* Both blocks shear away and back on every project change (their direct children are the
              lines that stagger). The copy here is static — it leaves and returns unchanged — because
              the gesture is the whole overlay resetting around the new rock, not just the detail. */}
          <div className="works-head-intro" ref={headIntroRef}>
            <p className="eyebrow">Selected Work</p>
            {/* ⚠ Spans, not a <br/> — the same trap the deck's title fell into. A hard break is a
                DESKTOP instruction, and on a 360px screen it compounds with the natural wrap into four
                ragged lines out of two words each. Each sentence now wraps on its own terms and
                `text-wrap: balance` evens whatever lines it needs. */}
            {/* ⚠ The count is spelled from the live list, not written into the markup. It used to
                read "Four fires." while the panel could publish any number of projects, so the
                heading was one edit away from contradicting the section under it — and nothing on
                either side would have said so. */}
            <h2 className="works-title font-display">
              <span className="works-title-line">{worksCountPhrase(projects.length)}</span>{' '}
              <span className="works-title-line">{WORKS_FIELD_PHRASE}</span>
            </h2>
          </div>

          {/* Active-project detail. NOT keyed: GSAP owns the entrance now, so the nodes have to be
              stable — remounting them would tear the running tween off its targets mid-flight. */}
          <div className="works-detail" ref={detailRef}>
            {/* The type key. It leads the block rather than joining the tag row below because it
                answers a different question: the tags are what the work was made OF, this is what the
                work WAS — and it is the one piece of the detail that survives onto a phone, where the
                paragraph and the tags are both hidden. Same vocabulary the fleet sells in. */}
            <p className="works-detail-type">{discipline.label}</p>
            <p className="works-detail-title font-display">{activeProject.title}</p>
            {/* The client is wrapped so a phone can drop it and keep the year — "name and date" is
                what identifies the project at a glance; who it was for is drawer material. Split with
                spans rather than by swapping the string, so the node set stays identical at every
                width and the shear transition never has to re-target. */}
            <p className="works-detail-meta">
              <span className="works-detail-client">{activeProject.client}</span>
              <span className="works-detail-meta-sep" aria-hidden="true"> · </span>
              {activeProject.year}
            </p>
            <p className="works-detail-copy">{activeProject.description}</p>
            <ul className="works-detail-tags">
              {activeProject.tags.map((tag) => (
                <li key={tag} className="works-detail-tag">{tag}</li>
              ))}
            </ul>

            {/* The actions, in the same wrapper and the same order the fleet uses — a visitor meets
                this pairing twice and it should be one control, not two similar ones. ⚠ "Details" USED
                TO LIVE IN THE NAV, under the counter; it moved here so both sections put their actions
                with the copy they belong to, and so the nav row goes back to arrows-and-a-number. */}
            <div className="detail-actions">
              {isNarrow && (
                <button
                  type="button"
                  className="drawer-open"
                  onClick={() => setOpenSheet('details')}
                >
                  <span>Details</span>
                  <ChevronUp />
                </button>
              )}

              <EnquiryButton
                // Shorter on a phone, where this shares a ~310px row with the Details button.
                label={isNarrow ? 'Start a build' : 'Start one like this'}
                onClick={() => setOpenSheet('enquiry')}
              />
            </div>
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
            data-journey="Works: previous project"
          >
            <ArrowGlyph direction="left" />
          </button>

          {/* Just the counter now — the "Details" button that used to be stacked under it moved up
              into the detail block's action row, beside the CTA. The wrapper stays: it is what keeps
              the number centred while the arrows are pushed out to the frame's edges on a phone. */}
          <span className="works-nav-centre">
            <span className="works-counter">
              <span className="works-counter-current">{activeProject.index}</span>
              <span className="works-counter-sep" aria-hidden="true">/</span>
              <span className="works-counter-total">{String(projects.length).padStart(2, '0')}</span>
            </span>
          </span>

          <button
            type="button"
            className="works-arrow"
            onClick={() => goTo(activeIndex + 1)}
            disabled={isLast}
            aria-label="Next project"
            data-journey="Works: next project"
          >
            <ArrowGlyph direction="right" />
          </button>
        </nav>
      </div>

      {/* Narrow only — nothing can open it otherwise. Reads the DISPLAYED project, so the sheet always
          matches the copy and the mark that are actually on screen. */}
      {isNarrow && (
        <Drawer
          open={openSheet === 'details'}
          onClose={() => setOpenSheet('none')}
          eyebrow={`${activeProject.index} — ${activeProject.year}`}
          title={activeProject.title}
        >
          <p className="drawer-meta">{activeProject.client}</p>
          <p className="drawer-copy">{activeProject.description}</p>
          <ul className="drawer-tags">
            {activeProject.tags.map((tag) => (
              <li key={tag} className="drawer-tag">{tag}</li>
            ))}
          </ul>
        </Drawer>
      )}

      {/* Mounted at every width, unlike the details sheet — this one has a shell for both (a dialog on
          a wide screen, the same bottom sheet on a phone) and picks between them itself. */}
      <EnquiryPanel
        open={openSheet === 'enquiry'}
        onClose={() => setOpenSheet('none')}
        eyebrow={`${activeProject.index} — ${activeProject.title}`}
        title="Start one like this"
        prefill={enquiryPrefill}
      />
    </section>
  );
}

function ChevronUp() {
  return (
    <span className="drawer-open-glyph" aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
        <path
          d="M2 7l3.5-3.5L9 7"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
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
