import { measureUntransformedRect } from '@/lib/measureUntransformedRect';
import { SUN_CANVAS_HEADROOM } from '@/components/effects/IntroSequence/gatherShader';

/**
 * Where the sun sits on screen once the hero pin has finished placing it.
 *
 * ── Why this is shared ───────────────────────────────────────────────────────────────────────────
 * Two things need the same answer and neither can be allowed to guess it. `useHeroAnimation` PUTS the
 * sun there (it owns the pin's transform), and `useWorksField` has to draw a copy of the sun in exactly
 * the same place inside the space render — because the DOM sun cannot survive the chamber and the
 * render can (see `sunBackdrop.ts`). The two images cross-fade, so a disagreement of a few pixels is a
 * visible jump at the one moment the reveal is trying to be seamless.
 *
 * So the placement lives here, once, and both import it.
 */

/** The sun grows to this as the square fills, and holds. */
export const SUN_SCROLL_SCALE = 1.1;
/** Pixels the sun lifts above the square's centre, and holds. */
export const SUN_SCROLL_RISE = 200;

const HERO_SQUARE_SELECTOR = '.hero-sun-card';

export interface SunScreenRect {
  /** Centre in CSS pixels from the top-left of the viewport. */
  centerX: number;
  centerY: number;
  /** Size in CSS pixels — the whole layer, which is mostly transparent headroom around the star. */
  width: number;
  height: number;
}

/**
 * Measure it, or null if the hero square isn't in the DOM.
 *
 * The square is measured UNTRANSFORMED. Its scroll transform scales it up to fill the screen, and a
 * plain `getBoundingClientRect` includes that — reading it mid-scroll is the mistake that used to make
 * the sun balloon on resize, and it would put this copy somewhere quite different from the real one.
 */
export function measureSunScreenRect(): SunScreenRect | null {
  const square = document.querySelector<HTMLElement>(HERO_SQUARE_SELECTOR);
  if (!square) return null;
  const rect = measureUntransformedRect(square);
  // The layer is the square padded by the canvas headroom, then scaled by the pin, and parked at the
  // viewport's centre lifted by the rise. Every one of those is applied by the pin except the headroom,
  // which `HeroSun` bakes into the element's own width.
  const width = rect.width * SUN_CANVAS_HEADROOM * SUN_SCROLL_SCALE;
  const height = rect.height * SUN_CANVAS_HEADROOM * SUN_SCROLL_SCALE;
  return {
    centerX: window.innerWidth / 2,
    centerY: window.innerHeight / 2 - SUN_SCROLL_RISE,
    width,
    height,
  };
}
