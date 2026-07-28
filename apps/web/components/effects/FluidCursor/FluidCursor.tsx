'use client';

import { useRef } from 'react';
import { useFluidCursor } from '@/lib/hooks/useFluidCursor';

// Two stacked canvases fed by one fluid sim, covering the hero section:
//   1. invert layer (mix-blend-mode: difference) — inverts the hero beneath the
//      fluid, so the cream turns to ink and the dark tagline glows light through it.
//   2. ink layer — the dark ink + stars, semi-transparent so the inverted text
//      shows through it (the backlit-in-dark-water look).
// Rendered as bare siblings (not wrapped) so each stays in the hero's stacking
// context and the difference layer blends against the hero's content. Both are
// absolute within the (isolated, position:relative) hero, ignore pointer events, and
// sit above the tagline (z 1) and below the headline/sun (z 4).
const INVERT_Z_INDEX = 2;
const INK_Z_INDEX = 3;

export default function FluidCursor() {
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const invertCanvasRef = useRef<HTMLCanvasElement>(null);

  useFluidCursor(inkCanvasRef, invertCanvasRef);

  const sharedStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  };

  return (
    <>
      <canvas
        ref={invertCanvasRef}
        aria-hidden="true"
        style={{ ...sharedStyle, zIndex: INVERT_Z_INDEX, mixBlendMode: 'difference' }}
      />
      <canvas
        ref={inkCanvasRef}
        aria-hidden="true"
        style={{ ...sharedStyle, zIndex: INK_Z_INDEX, mixBlendMode: 'normal' }}
      />
    </>
  );
}
