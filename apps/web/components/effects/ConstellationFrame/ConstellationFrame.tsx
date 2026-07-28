'use client';

import { useRef } from 'react';
import { useConstellationFrame } from '@/lib/hooks/useConstellationFrame';

// A single 2D canvas covering the hero: muted graphite stars in a border band, connected by faint
// lines into loose asterisms. All the behaviour (placement, bloom-from-centre, drift, twinkle,
// reveal/services gating) lives in useConstellationFrame. Rendered as a bare, non-interactive layer
// inside the hero — z-index 4 (above the ink trail at z3, below the headline/HUD/sun) so it never
// blocks pointer events or disturbs the headline's difference blend. Normal blend (dark on cream).
const DUST_Z_INDEX = 4;

export default function ConstellationFrame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useConstellationFrame(canvasRef);

  return (
    <canvas
      ref={canvasRef}
      className="constellation-dust"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: DUST_Z_INDEX,
        pointerEvents: 'none',
      }}
    />
  );
}
