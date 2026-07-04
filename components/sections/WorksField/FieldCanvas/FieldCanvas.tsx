'use client';

import { useRef, useState } from 'react';
import { useWorksField, type FieldStatus } from '../hooks/useWorksField';

interface FieldCanvasProps {
  /** The focused project — drives the camera + which meteor burns. */
  activeIndex: number;
}

export default function FieldCanvas({ activeIndex }: FieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<FieldStatus>({ isLoading: true, percent: -1 });

  useWorksField({ canvasRef, activeIndex, onStatus: setStatus });

  return (
    <div className="field-canvas-wrap">
      <canvas ref={canvasRef} className="field-canvas" />

      <div
        className={`field-loading ${status.isLoading ? 'is-visible' : ''}`}
        aria-hidden={!status.isLoading}
      >
        <span className="field-loading-ring" />
        <span className="field-loading-label">
          {status.percent >= 0 ? `Charting the field · ${status.percent}%` : 'Charting the field'}
        </span>
      </div>
    </div>
  );
}
