'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { DECK_SERVICES } from './deckServices';
import { useSectionArrival, type ArrivalGroup } from '@/lib/hooks/useSectionArrival';
import { useIsNarrowViewport } from '@/lib/hooks/useIsNarrowViewport';
import Drawer from '@/components/ui/Drawer/Drawer';

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

  const activeService = DECK_SERVICES[activeIndex];

  // ── The narrow layout ──
  // Four craft names in a row do not fit a phone, and the description that sits beside the ship on a
  // desktop has nowhere to be. So the strip becomes a STEPPER (arrows, the index, and only the craft
  // you are actually on) and the description moves into a drawer, leaving the capability keys and one
  // button on the screen itself.
  const isNarrow = useIsNarrowViewport();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Changing craft while the sheet is up would leave you reading one service's copy under another
  // one's name. Closing on the commit is the only honest option — the sheet describes a selection, so
  // it cannot outlive it.
  useEffect(() => setIsDrawerOpen(false), [activeIndex]);
  // …and the layout swapping out from under an open sheet would leave it with no button to reopen it.
  useEffect(() => {
    if (!isNarrow) setIsDrawerOpen(false);
  }, [isNarrow]);

  const isFirst = activeIndex === 0;
  const isLast = activeIndex === DECK_SERVICES.length - 1;

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

            {/* Narrow only: the copy above is hidden by CSS at this width and lives in the sheet
                instead, so the keys need something to lead on to. */}
            {isNarrow && (
              <button
                type="button"
                className="drawer-open deck-detail-more"
                onClick={() => setIsDrawerOpen(true)}
              >
                <span>Details</span>
                <ChevronUp />
              </button>
            )}
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
                  {String(DECK_SERVICES.length).padStart(2, '0')}
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
            {DECK_SERVICES.map((service, index) => {
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
          open={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
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
