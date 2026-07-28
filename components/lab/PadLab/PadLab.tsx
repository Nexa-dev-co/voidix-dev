'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePadLabScene, type PadLabHandle, type PadLabStatus } from './hooks/usePadLabScene';

/**
 * The landing-pad authoring tool.
 *
 * The panel is created only once the model has loaded, because its Parts and Materials folders are
 * built FROM the model — there is nothing to show controls for until the file is here. `handledRef`
 * keeps that to a single build: React Strict Mode runs effects twice in dev, and a second panel
 * would dock on top of the first.
 */
export default function PadLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handledRef = useRef(false);
  const cleanupsRef = useRef<(() => void)[]>([]);
  const [status, setStatus] = useState<PadLabStatus>({ isLoading: true, error: null });

  const handleReady = useCallback((handle: PadLabHandle) => {
    if (handledRef.current) return;
    handledRef.current = true;
    // Dynamically imported so lil-gui stays out of the initial chunk, exactly as the site's `?tune`
    // panels do — this page is a tool, but it is still a route that can be loaded cold.
    import('./padLabPanel').then(({ createPadLabPanel }) => {
      createPadLabPanel({
        handle,
        onDispose: (cleanup) => cleanupsRef.current.push(cleanup),
      });
    });
  }, []);

  useEffect(
    () => () => {
      cleanupsRef.current.forEach((cleanup) => cleanup());
      cleanupsRef.current = [];
      handledRef.current = false;
    },
    [],
  );

  usePadLabScene({ canvasRef, onReady: handleReady, onStatus: setStatus });

  return (
    <div className="pad-lab">
      <canvas ref={canvasRef} className="pad-lab-canvas" />

      {status.isLoading && (
        <p className="pad-lab-note">Loading the pad…</p>
      )}
      {status.error && (
        <p className="pad-lab-note pad-lab-note--error">
          Could not load /models/champion_astro_ring.glb — {status.error}
        </p>
      )}

      <p className="pad-lab-hint">
        drag to orbit · scroll to zoom · orbit under the pad to judge the light on the hull
      </p>
    </div>
  );
}
