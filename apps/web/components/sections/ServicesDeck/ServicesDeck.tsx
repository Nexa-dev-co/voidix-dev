'use client';

import dynamic from 'next/dynamic';
import { DECK_SERVICES } from './deckServices';

// The viewer owns a WebGL context, so keep it out of the server graph.
const DeckCanvas = dynamic(() => import('./DeckCanvas/DeckCanvas'), { ssr: false });

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
  // A horizontal flick on the craft moves one along; clamped inside goTo.
  const handleFlick = (direction: number) => goTo(activeIndex + direction);

  const activeService = DECK_SERVICES[activeIndex];

  return (
    <section id="services" className="services-deck">
      {/* Solid black stage behind the fleet — matches the hero's filled square so the craft
          reads as materialising on the same black. */}
      <div className="deck-backdrop" aria-hidden="true" />

      <DeckCanvas activeIndex={activeIndex} onFlick={handleFlick} />

      <div className="deck-overlay">
        <header className="deck-head">
          <div className="deck-head-intro">
            <p className="eyebrow">The Fleet</p>
            <h2 className="deck-title font-display">
              One craft at a time.<br />Bring it online.
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
          </div>
        </header>

        {/* Carousel strip — the four craft as a row of names along the bottom. Drag the ship or
            scroll to cycle; clicking a name jumps straight to that craft. */}
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
      </div>
    </section>
  );
}
