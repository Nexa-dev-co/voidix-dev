'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useSiteContent, useSiteSections } from '@/lib/cms/SiteContentProvider';
import { useSectionArrival, type ArrivalGroup } from '@/lib/hooks/useSectionArrival';
import { useIsNarrowViewport } from '@/lib/hooks/useIsNarrowViewport';
import { buildEnquiryPrefill } from '@/lib/enquirySubjects';
import Drawer from '@/components/ui/Drawer/Drawer';
import EnquiryButton from '@/components/ui/EnquiryButton/EnquiryButton';
import EnquiryPanel from '@/components/ui/EnquiryPanel/EnquiryPanel';

// The viewer owns a WebGL context, so keep it out of the server graph.
const DeckCanvas = dynamic(() => import('./DeckCanvas/DeckCanvas'), { ssr: false });

// A covered nav jump lands you here with the craft already replaying its entrance (DECK_REVEAL_EVENT)
// but the copy simply present, because the crossing that fades it in was scrubbed behind the cover.
// So the overlay locks into formation around the craft: the two head blocks close in from their own
// sides and the carousel comes up under them.
//
// Hoisted out of the component: the hook holds this in a dependency array, and an array rebuilt every
// render would tear its listener down and re-add it on each one.
const ARRIVAL_GROUPS: readonly ArrivalGroup[] = [
  { selector: '.deck-head-intro > *', from: 'left', tighten: true },
  { selector: '.deck-detail > *', from: 'right' },
  { selector: '.deck-carousel, .deck-stepper', from: 'bottom' },
];

/** Which sheet the narrow layout has up. One at a time — two stacked sheets is not a state. */
type OpenSheet = 'none' | 'details' | 'enquiry';

interface ServicesDeckProps {
  /** Craft currently on the pad — driven by the hero pin's carousel phase. */
  activeIndex: number;
  /** Jump to a craft (label click / flick); scrolls the page to its snap point. */
  goTo: (index: number) => void;
}

// The deck is an overlay inside the hero section: hidden until the square fills the screen,
// then revealed on the black. Scroll drives the active craft (the hero pin maps its carousel
// phase to an index); flicks and label clicks jump by scrolling the page (see goTo).
export default function ServicesDeck({ activeIndex, goTo }: ServicesDeckProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useSectionArrival({
    sectionKey: 'services',
    containerRef: overlayRef,
    profile: 'formation',
    groups: ARRIVAL_GROUPS,
  });

  // A horizontal flick on the craft moves one along; clamped inside goTo.
  const handleFlick = (direction: number) => goTo(activeIndex + direction);

  // ⚠ The COPY comes from here; the STRUCTURE does not. `useServicesDeck` and `deckTuning` keep
  // reading `DECK_SERVICES` directly for `profile`, `modelPath` and placement — none of which the
  // panel owns — and `resolveDeckServices` pins the two lists to the same length, so an index means
  // the same vessel on both sides.
  const { disciplines, enquiryForm } = useSiteContent();
  const { services } = useSiteSections();

  const activeService = services[activeIndex];

  // ── The narrow layout ──
  // Four craft names in a row do not fit a phone, and the description that sits beside the ship on a
  // desktop has nowhere to be. So the strip becomes a STEPPER (arrows, the index, and only the craft
  // you are actually on) and the description moves into a drawer, leaving the capability keys and one
  // button on the screen itself.
  const isNarrow = useIsNarrowViewport();
  const [openSheet, setOpenSheet] = useState<OpenSheet>('none');

  // Changing craft while a panel is up would leave you reading one service's copy — or briefing one
  // service's project — under another one's name. Closing on the commit is the only honest option: both
  // panels describe a selection, so neither can outlive it.
  useEffect(() => setOpenSheet('none'), [activeIndex]);
  // ⚠ Closed on ANY width change, not just on leaving the narrow layout. The details sheet only exists
  // when narrow, and the enquiry swaps its whole shell across the breakpoint (sheet ↔ dialog) — either
  // way the open panel is a different element on the other side of a resize, and animating one out
  // while mounting the other reads as a glitch.
  useEffect(() => setOpenSheet('none'), [isNarrow]);

  const isFirst = activeIndex === 0;
  const isLast = activeIndex === services.length - 1;

  // The enquiry arrives already knowing which craft it was opened from — the discipline picks the copy,
  // and the visitor never has to restate a choice they made by clicking.
  const enquiryPrefill = buildEnquiryPrefill({
    discipline: activeService.discipline,
    disciplines,
    referenceSubjectSuffix: enquiryForm.referenceSubjectSuffix,
    referenceBriefPrefix: enquiryForm.referenceBriefPrefix,
  });

  return (
    <section id="services" className="services-deck">
      {/* Solid black stage behind the fleet — matches the hero's filled square so the craft
          reads as materialising on the same black. */}
      <div className="deck-backdrop" aria-hidden="true" />

      <DeckCanvas activeIndex={activeIndex} onFlick={handleFlick} />

      <div ref={overlayRef} className="deck-overlay">
        <header className="deck-head">
          <div className="deck-head-intro">
            <p className="eyebrow">The Fleet</p>
            {/* ⚠ The line break is a DESKTOP instruction, and these spans are what let a phone ignore
                it. Hard-wrapped with a <br/>, a 360px screen broke this into "One craft at / a time. /
                Bring it / online." — four ragged lines out of two sentences. Each sentence is now its
                own inline block that wraps on its own terms, and `text-wrap: balance` in the CSS
                evens out whatever lines it does end up needing. */}
            <h2 className="deck-title font-display">
              <span className="deck-title-line">One craft at a time.</span>{' '}
              <span className="deck-title-line">Bring it online.</span>
            </h2>
          </div>

          {/* Active-craft detail — keyed so it re-mounts and re-reveals on every change. */}
          <div className="deck-detail" key={activeService.index}>
            <p className="deck-detail-eyebrow font-display">{activeService.eyebrow}</p>
            <p className="deck-detail-copy">{activeService.description}</p>
            <ul className="deck-detail-tags">
              {activeService.capabilities.map((capability) => (
                <li key={capability} className="deck-detail-tag">{capability}</li>
              ))}
            </ul>

            {/* The actions. One wrapper at every width, so the arrival stagger — which walks
                `.deck-detail > *` — sees the same set of children on a phone and on a desktop.
                ⚠ It deliberately does NOT re-enable pointer events itself: the overlay is
                `pointer-events: none` and the buttons turn it back on individually, because a wrapper
                with `auto` would also swallow the gaps between them, and those gaps are over a canvas
                that accepts drag. */}
            <div className="detail-actions">
              {/* Narrow only: the copy above is hidden by CSS at this width and lives in the sheet
                  instead, so the keys need something to lead on to. */}
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
                label={isNarrow ? 'Start a build' : 'Start this build'}
                onClick={() => setOpenSheet('enquiry')}
              />
            </div>
          </div>
        </header>

        {/* Carousel strip — the four craft as a row of names along the bottom. Drag the ship or
            scroll to cycle; clicking a name jumps straight to that craft.

            On a phone this is a stepper instead: the same jumps, but two arrows and one name rather
            than four names competing for ~310px of usable width. */}
        {isNarrow ? (
          <nav className="deck-stepper" aria-label="Fleet">
            <button
              type="button"
              className="deck-stepper-arrow"
              onClick={() => goTo(activeIndex - 1)}
              disabled={isFirst}
              aria-label="Previous craft"
            >
              <StepperArrow direction="left" />
            </button>

            <span className="deck-stepper-current">
              <span className="deck-stepper-index">
                <span className="deck-stepper-number">{activeService.index}</span>
                <span className="deck-stepper-sep" aria-hidden="true">/</span>
                <span className="deck-stepper-total">
                  {String(services.length).padStart(2, '0')}
                </span>
              </span>
              {/* Keyed so the name re-mounts and replays its fade on every change. The four-name strip
                  signalled a change by moving which one was lit; with a single name on screen, nothing
                  else would say it had changed at all. */}
              <span key={activeService.index} className="deck-stepper-name font-display">
                {activeService.name}
              </span>
            </span>

            <button
              type="button"
              className="deck-stepper-arrow"
              onClick={() => goTo(activeIndex + 1)}
              disabled={isLast}
              aria-label="Next craft"
            >
              <StepperArrow direction="right" />
            </button>
          </nav>
        ) : (
          <nav className="deck-carousel" aria-label="Fleet">
            {services.map((service, index) => {
              const isActive = activeIndex === index;
              return (
                <button
                  key={service.index}
                  type="button"
                  className={`deck-carousel-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => goTo(index)}
                  aria-current={isActive}
                >
                  <span className="deck-carousel-number">{service.index}</span>
                  <span className="deck-carousel-name font-display">{service.name}</span>
                  <span className="deck-carousel-line" aria-hidden="true" />
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {/* Mounted only at narrow widths — nothing can open it otherwise, and an unmounted sheet is one
          fewer portal and one fewer set of listeners on every desktop session. */}
      {isNarrow && (
        <Drawer
          open={openSheet === 'details'}
          onClose={() => setOpenSheet('none')}
          eyebrow={`${activeService.index} — ${activeService.name}`}
          title={activeService.eyebrow}
        >
          <p className="drawer-copy">{activeService.description}</p>
          <ul className="drawer-tags">
            {activeService.capabilities.map((capability) => (
              <li key={capability} className="drawer-tag">{capability}</li>
            ))}
          </ul>
        </Drawer>
      )}

      {/* Mounted at every width, unlike the details sheet — this one has a shell for both (a dialog on
          a wide screen, the same bottom sheet on a phone) and picks between them itself. */}
      <EnquiryPanel
        open={openSheet === 'enquiry'}
        onClose={() => setOpenSheet('none')}
        eyebrow={`${activeService.index} — ${activeService.name}`}
        title="Start this build"
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

function StepperArrow({ direction }: { direction: 'left' | 'right' }) {
  const path = direction === 'left' ? 'M11 4.5l-4 4 4 4M7 8.5h6' : 'M5 4.5l4 4-4 4M9 8.5H3';
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
