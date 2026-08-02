'use client';

import { useRef, useState } from 'react';
import { useServicesDeck, type DeckStatus } from '../hooks/useServicesDeck';

interface DeckCanvasProps {
  /** Index of the craft currently on the pad. */
  activeIndex: number;
  /** A horizontal flick on the craft asks to switch: +1 = next, -1 = previous. */
  onFlick: (direction: number) => void;
}

export default function DeckCanvas({ activeIndex, onFlick }: DeckCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<DeckStatus>({ isLoading: true, percent: -1 });

  useServicesDeck({ canvasRef, activeIndex, onFlick, onStatus: setStatus });

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
            ? `Bringing the fleet online · ${status.percent}%`
            : 'Bringing the fleet online'}
        </span>
      </div>
    </div>
  );
}
