'use client';

import { useRef, useState } from 'react';
import { useWorksField, type FieldStatus } from '../hooks/useWorksField';
import type { WorksProject } from '../worksProjects';

interface FieldCanvasProps {
  /** The focused project — drives the camera + which meteor burns. */
  activeIndex: number;
  /**
   * The resolved projects. Passed down rather than read from the content context here because this
   * component is dynamically imported with `ssr: false`, and the scene needs the list at setup —
   * `WorksField` already holds it and is the one place that can guarantee it has arrived.
   */
  projects: WorksProject[];
}

export default function FieldCanvas({ activeIndex, projects }: FieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<FieldStatus>({ isLoading: true, percent: -1 });

  useWorksField({ canvasRef, activeIndex, projects, onStatus: setStatus });

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
