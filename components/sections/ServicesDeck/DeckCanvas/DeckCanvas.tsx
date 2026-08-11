'use client';

import { useRef, useState } from 'react';
import { useServicesDeck, type DeckStatus } from '../hooks/useServicesDeck';

interface DeckCanvasProps {
  /** A horizontal flick on the vessel asks to switch stop: +1 = next, -1 = previous. */
  onFlick: (direction: number) => void;
}

// ⚠ No `activeIndex`. The scene used to take it because the deck swapped between four hulls on every
// stop change; there is one vessel now and its state is the scrubbed assembly progress, which arrives
// as an event straight from the pin. The index still drives the COPY — that stays in ServicesDeck.
export default function DeckCanvas({ onFlick }: DeckCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<DeckStatus>({ isLoading: true, percent: -1 });

  useServicesDeck({ canvasRef, onFlick, onStatus: setStatus });

  return (
    <div className="deck-canvas-wrap">
      <canvas ref={canvasRef} className="deck-canvas" />

      <div
        className={`deck-loading ${status.isLoading ? 'is-visible' : ''}`}
        aria-hidden={!status.isLoading}
      >
        <span className="deck-loading-ring" />
        <span className="deck-loading-label">
          {status.percent >= 0
            ? `Machining the vessel · ${status.percent}%`
            : 'Machining the vessel'}
        </span>
      </div>
    </div>
  );
}
