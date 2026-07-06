import { RefObject, useEffect } from 'react';
import {
  CONSTELLATION_CONFIG,
  CONSTELLATION_CONFIG_LOW_POWER,
  LOW_POWER_MAX_WIDTH,
  DOT_PALETTE,
  LINE_RGB,
  type ConstellationConfig,
} from '@/components/effects/ConstellationFrame/constellationConfig';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT } from '@/components/sections/ServicesDeck/deckEvents';

const MAX_DEVICE_PIXEL_RATIO = 2;
const REVEAL_FALLBACK_MS = 7000;
// Only these four neighbour directions, so each undirected star pair is considered once.
const FORWARD_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
];

// Deterministic per-cell hash (ported from the FluidCursor DISPLAY_SHADER starField): stable across
// frames + resizes, so a star's placement, colour, drift phase and fill noise never jump.
function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

interface Star {
  cellX: number;
  cellY: number;
  baseX: number;
  baseY: number;
  driftPhaseX: number;
  driftPhaseY: number;
  twinklePhase: number;
  /** Position in the fill sequence (0 = first to light, ~1 = last). Sides fill first, then the top
   *  and bottom close toward their centres; a per-star noise offset makes the front seep like liquid. */
  fillOrder: number;
  paletteIndex: number;
  // Per-frame scratch.
  x: number;
  y: number;
  reveal: number;
  twinkle: number;
}

/**
 * Drives the hero's constellation frame: a photo-frame border of connected blue "zodiac" stars. The
 * screen starts empty; on REVEAL_EVENT the frame fills in with a liquid-like flowing front that
 * starts at the left & right sides and closes at the top-centre and bottom-centre over ~growthSeconds,
 * then holds with gentle drift + twinkle. Frozen over the services/works overlays, idled off-screen,
 * reduced-motion safe (one static, fully-filled frame).
 */
export function useConstellationFrame(canvasRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowPower =
      window.matchMedia('(pointer: coarse)').matches || window.innerWidth < LOW_POWER_MAX_WIDTH;
    const config: ConstellationConfig = lowPower
      ? CONSTELLATION_CONFIG_LOW_POWER
      : CONSTELLATION_CONFIG;

    const pixelRatio = () => Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);

    // Front travels a touch past 1 so the last (centre) stars fully clear the feathered front.
    const revealCeiling = 1 + config.fillFeather + config.fillNoise;

    let viewportWidth = 0;
    let viewportHeight = 0;

    // ── Soft neon dot sprites — one per palette colour, built once at device resolution ──
    const buildDotSprite = (rgb: string) => {
      const ratio = pixelRatio();
      const cssSize = config.starRadiusPx * config.haloRadiusMultiple * 2;
      const sprite = document.createElement('canvas');
      sprite.width = Math.ceil(cssSize * ratio);
      sprite.height = Math.ceil(cssSize * ratio);
      const spriteContext = sprite.getContext('2d');
      if (spriteContext) {
        const centre = sprite.width / 2;
        const gradient = spriteContext.createRadialGradient(centre, centre, 0, centre, centre, centre);
        gradient.addColorStop(0, `rgb(${rgb} / 1)`);
        gradient.addColorStop(0.32, `rgb(${rgb} / 0.5)`);
        gradient.addColorStop(1, `rgb(${rgb} / 0)`);
        spriteContext.fillStyle = gradient;
        spriteContext.fillRect(0, 0, sprite.width, sprite.height);
      }
      return sprite;
    };
    let spriteCssSize = config.starRadiusPx * config.haloRadiusMultiple * 2;
    let colourSprites = DOT_PALETTE.map(buildDotSprite);
    const rebuildSprites = () => {
      spriteCssSize = config.starRadiusPx * config.haloRadiusMultiple * 2;
      colourSprites = DOT_PALETTE.map(buildDotSprite);
    };

    // ── Placement — deterministic cells, perimeter band, with a fill-order for the liquid reveal ──
    let stars: Star[] = [];
    const cellIndex = new Map<number, Star>();
    const cellKey = (cellX: number, cellY: number) => cellX * 100000 + cellY;

    // Sides light first (from their mid-height outward), then the top & bottom edges close from the
    // corners toward their centres. Continuous across the corners (both formulas meet there).
    const fillOrderFor = (x: number, y: number) => {
      const halfWidth = viewportWidth / 2;
      const halfHeight = viewportHeight / 2;
      const distTop = y;
      const distBottom = viewportHeight - y;
      const distLeft = x;
      const distRight = viewportWidth - x;
      const nearest = Math.min(distTop, distBottom, distLeft, distRight);
      if (nearest === distLeft || nearest === distRight) {
        // Side edge: mid-height (0) out to the corners (sideFillFraction).
        return config.sideFillFraction * (Math.abs(y - halfHeight) / halfHeight);
      }
      // Top/bottom edge: corners (sideFillFraction) in to the centre (1).
      return config.sideFillFraction + (1 - config.sideFillFraction) * (1 - Math.abs(x - halfWidth) / halfWidth);
    };

    const placeStars = () => {
      stars = [];
      cellIndex.clear();
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;

      const cell = config.cellSizePx;
      const bandX = viewportWidth * config.bandRatioX;
      const bandY = viewportHeight * config.bandRatioY;
      const columns = Math.ceil(viewportWidth / cell) + 1;
      const rows = Math.ceil(viewportHeight / cell) + 1;

      for (let cellX = 0; cellX < columns; cellX += 1) {
        for (let cellY = 0; cellY < rows; cellY += 1) {
          if (hash(cellX, cellY) >= config.fillRatio) continue;

          const baseX = (cellX + hash(cellX + 1.7, cellY + 9.2)) * cell;
          const baseY = (cellY + hash(cellX + 5.3, cellY + 2.9)) * cell;

          // Keep only the perimeter band — the centre stays clear for the headline.
          const inBand =
            baseX < bandX ||
            baseX > viewportWidth - bandX ||
            baseY < bandY ||
            baseY > viewportHeight - bandY;
          if (!inBand) continue;

          const noiseOffset = (hash(cellX + 11.1, cellY + 3.3) * 2 - 1) * config.fillNoise;
          const fillOrder = Math.min(Math.max(fillOrderFor(baseX, baseY) + noiseOffset, 0), 1);

          const star: Star = {
            cellX,
            cellY,
            baseX,
            baseY,
            driftPhaseX: hash(cellX + 4.3, cellY + 7.1) * Math.PI * 2,
            driftPhaseY: hash(cellX + 8.9, cellY + 1.3) * Math.PI * 2,
            twinklePhase: hash(cellX + 2.1, cellY + 8.7) * Math.PI * 2,
            fillOrder,
            paletteIndex: Math.min(
              DOT_PALETTE.length - 1,
              Math.floor(hash(cellX + 3.7, cellY + 6.1) * DOT_PALETTE.length),
            ),
            x: baseX,
            y: baseY,
            reveal: 0,
            twinkle: 1,
          };
          stars.push(star);
          cellIndex.set(cellKey(cellX, cellY), star);
        }
      }
    };

    const resizeBackingStore = () => {
      const ratio = pixelRatio();
      const deviceWidth = Math.floor(window.innerWidth * ratio);
      const deviceHeight = Math.floor(window.innerHeight * ratio);
      if (canvas.width === deviceWidth && canvas.height === deviceHeight) return false;
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
      context.setTransform(ratio, 0, 0, ratio, 0, 0); // work in CSS px
      return true;
    };

    // ── One frame. `front` in [0, revealCeiling] is the liquid fill position along the fill-order. ──
    const drawFrame = (elapsedSeconds: number, front: number) => {
      context.clearRect(0, 0, viewportWidth, viewportHeight);

      // 1. Resolve each star's live position, reveal factor + twinkle.
      for (const star of stars) {
        star.reveal = smoothstep(star.fillOrder - config.fillFeather, star.fillOrder + config.fillFeather, front);
        star.x =
          star.baseX + config.driftAmplitudePx * Math.sin(elapsedSeconds * config.driftSpeed + star.driftPhaseX);
        star.y =
          star.baseY +
          config.driftAmplitudePx * Math.cos(elapsedSeconds * config.driftSpeed * 0.9 + star.driftPhaseY);
        star.twinkle =
          1 - config.twinkleDepth * (0.5 - 0.5 * Math.sin(elapsedSeconds * config.twinkleSpeed + star.twinklePhase));
      }

      // 2. Links under the stars — appear as both endpoints fill in.
      context.strokeStyle = `rgb(${LINE_RGB})`;
      context.lineWidth = config.lineWidthPx;
      for (const star of stars) {
        if (star.reveal <= 0) continue;
        for (const [deltaX, deltaY] of FORWARD_NEIGHBOURS) {
          const neighbour = cellIndex.get(cellKey(star.cellX + deltaX, star.cellY + deltaY));
          if (!neighbour || neighbour.reveal <= 0) continue;
          const distance = Math.hypot(star.x - neighbour.x, star.y - neighbour.y);
          if (distance >= config.lineMaxDistPx) continue;
          const falloff = 1 - distance / config.lineMaxDistPx;
          context.globalAlpha = config.lineAlpha * falloff * Math.min(star.reveal, neighbour.reveal);
          context.beginPath();
          context.moveTo(star.x, star.y);
          context.lineTo(neighbour.x, neighbour.y);
          context.stroke();
        }
      }

      // 3. Stars on top — neon blue, fading in with the liquid front.
      const half = spriteCssSize / 2;
      for (const star of stars) {
        const alpha = config.starAlpha * star.reveal * star.twinkle;
        if (alpha <= 0.002) continue;
        context.globalAlpha = alpha;
        context.drawImage(colourSprites[star.paletteIndex], star.x - half, star.y - half, spriteCssSize, spriteCssSize);
      }
      context.globalAlpha = 1;
    };

    // ── Reduced motion: one static, fully-filled frame, no loop ──
    if (reduceMotion) {
      resizeBackingStore();
      placeStars();
      drawFrame(0, revealCeiling);
      const onResizeStatic = () => {
        if (resizeBackingStore()) {
          placeStars();
          rebuildSprites();
          drawFrame(0, revealCeiling);
        }
      };
      window.addEventListener('resize', onResizeStatic);
      return () => window.removeEventListener('resize', onResizeStatic);
    }

    // ── Animated path ──
    resizeBackingStore();
    placeStars();

    let isHeroVisible = true;
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => { isHeroVisible = entry.isIntersecting; },
      { threshold: 0 },
    );
    visibilityObserver.observe(canvas);

    // Freeze while the fleet/works overlays are up (the hero stays pinned, so the observer still
    // reports visible). The CSS .is-services rule fades it too.
    let inServices = false;
    const onServicesEnter = () => { inServices = true; };
    const onServicesLeave = () => { inServices = false; };
    window.addEventListener(DECK_REVEAL_EVENT, onServicesEnter);
    window.addEventListener(DECK_HIDE_EVENT, onServicesLeave);

    // The liquid fill is armed on reveal; nothing draws before then (screen stays empty).
    let revealTimeMs = 0;
    let hasRevealed = false;
    const runReveal = () => {
      if (hasRevealed) return;
      hasRevealed = true;
      revealTimeMs = performance.now();
    };
    window.addEventListener(REVEAL_EVENT, runReveal);
    const fallbackTimeout = window.setTimeout(runReveal, REVEAL_FALLBACK_MS);

    let animationFrame = 0;
    const startTime = performance.now();
    const render = () => {
      animationFrame = requestAnimationFrame(render);
      if (!isHeroVisible || inServices || !hasRevealed) return;
      if (resizeBackingStore()) {
        placeStars();
        rebuildSprites();
      }
      const now = performance.now();
      const elapsedSeconds = (now - startTime) / 1000;
      const fillFraction = Math.min((now - revealTimeMs) / 1000 / config.growthSeconds, 1);
      const eased = smoothstep(0, 1, fillFraction); // gentle ease so the fill settles, not stops abruptly
      const front = eased * revealCeiling;
      drawFrame(elapsedSeconds, front);
    };
    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      visibilityObserver.disconnect();
      window.clearTimeout(fallbackTimeout);
      window.removeEventListener(REVEAL_EVENT, runReveal);
      window.removeEventListener(DECK_REVEAL_EVENT, onServicesEnter);
      window.removeEventListener(DECK_HIDE_EVENT, onServicesLeave);
    };
  }, [canvasRef]);
}
