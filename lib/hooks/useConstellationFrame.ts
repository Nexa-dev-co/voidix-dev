import { RefObject, useEffect } from 'react';
import {
  CONSTELLATION_CONFIG,
  CONSTELLATION_CONFIG_LOW_POWER,
  LOW_POWER_MAX_WIDTH,
  HAZE_RGB,
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
// frames + resizes, so a star's placement, colour, drift phase and twinkle never jump.
function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

// Standard normal sample (Box–Muller) — used to cluster the nebula blobs around the centre.
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface Star {
  cellX: number;
  cellY: number;
  baseX: number;
  baseY: number;
  driftPhaseX: number;
  driftPhaseY: number;
  twinklePhase: number;
  distanceFromCentre: number;
  paletteIndex: number;
  // Per-frame scratch.
  x: number;
  y: number;
  reveal: number;
  twinkle: number;
}

/**
 * Drives the hero's constellation effect. The screen starts empty; on REVEAL_EVENT a growth front
 * expands from the exact centre outward, revealing two zones as it passes: a soft smoky galaxy-dust
 * haze in the middle (behind the headline) and connected neon "zodiac" stars at the page edges. The
 * spread-and-connect takes ~growthSeconds, then it holds with gentle drift + twinkle. Frozen over the
 * services/works overlays, idled off-screen, reduced-motion safe (one static, fully-grown frame).
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

    let viewportWidth = 0;
    let viewportHeight = 0;
    let halfDiagonal = 0;

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

    // ── Nebula haze — a soft cloud of blobs clustered around the centre, built once (downscaled) ──
    let nebula = document.createElement('canvas');
    const buildNebula = () => {
      const nebulaWidth = Math.max(1, Math.round(viewportWidth * config.hazeRenderScale));
      const nebulaHeight = Math.max(1, Math.round(viewportHeight * config.hazeRenderScale));
      nebula = document.createElement('canvas');
      nebula.width = nebulaWidth;
      nebula.height = nebulaHeight;
      const nebulaContext = nebula.getContext('2d');
      if (!nebulaContext) return;

      const centreX = nebulaWidth / 2;
      const centreY = nebulaHeight / 2;
      const sigma = Math.min(nebulaWidth, nebulaHeight) * config.hazeSpreadRatio;
      for (let index = 0; index < config.hazeBlobCount; index += 1) {
        const blobX = centreX + gaussian() * sigma;
        const blobY = centreY + gaussian() * sigma;
        const radius =
          (config.hazeBlobMinPx + Math.random() * (config.hazeBlobMaxPx - config.hazeBlobMinPx)) *
          config.hazeRenderScale;
        const gradient = nebulaContext.createRadialGradient(blobX, blobY, 0, blobX, blobY, radius);
        gradient.addColorStop(0, `rgb(${HAZE_RGB} / ${config.hazeBlobAlpha})`);
        gradient.addColorStop(1, `rgb(${HAZE_RGB} / 0)`);
        nebulaContext.fillStyle = gradient;
        nebulaContext.fillRect(blobX - radius, blobY - radius, radius * 2, radius * 2);
      }
    };

    const rebuildAssets = () => {
      spriteCssSize = config.starRadiusPx * config.haloRadiusMultiple * 2;
      colourSprites = DOT_PALETTE.map(buildDotSprite);
      buildNebula();
    };

    // ── Edge-zone star placement (deterministic cells, perimeter band) ──
    let stars: Star[] = [];
    const cellIndex = new Map<number, Star>();
    const cellKey = (cellX: number, cellY: number) => cellX * 100000 + cellY;

    const placeStars = () => {
      stars = [];
      cellIndex.clear();
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
      halfDiagonal = Math.hypot(viewportWidth, viewportHeight) / 2;

      const cell = config.cellSizePx;
      const bandX = viewportWidth * config.bandRatioX;
      const bandY = viewportHeight * config.bandRatioY;
      const centreX = viewportWidth / 2;
      const centreY = viewportHeight / 2;
      const columns = Math.ceil(viewportWidth / cell) + 1;
      const rows = Math.ceil(viewportHeight / cell) + 1;

      for (let cellX = 0; cellX < columns; cellX += 1) {
        for (let cellY = 0; cellY < rows; cellY += 1) {
          if (hash(cellX, cellY) >= config.fillRatio) continue;

          const baseX = (cellX + hash(cellX + 1.7, cellY + 9.2)) * cell;
          const baseY = (cellY + hash(cellX + 5.3, cellY + 2.9)) * cell;

          // Keep only the perimeter band — the centre belongs to the haze, not the zodiac.
          const inBand =
            baseX < bandX ||
            baseX > viewportWidth - bandX ||
            baseY < bandY ||
            baseY > viewportHeight - bandY;
          if (!inBand) continue;

          const star: Star = {
            cellX,
            cellY,
            baseX,
            baseY,
            driftPhaseX: hash(cellX + 4.3, cellY + 7.1) * Math.PI * 2,
            driftPhaseY: hash(cellX + 8.9, cellY + 1.3) * Math.PI * 2,
            twinklePhase: hash(cellX + 2.1, cellY + 8.7) * Math.PI * 2,
            distanceFromCentre: Math.hypot(baseX - centreX, baseY - centreY),
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

    // ── One frame. `growthRadius` is the reveal front's radius from the centre. ──
    const drawFrame = (elapsedSeconds: number, growthRadius: number) => {
      context.setTransform(pixelRatio(), 0, 0, pixelRatio(), 0, 0);
      context.clearRect(0, 0, viewportWidth, viewportHeight);
      const centreX = viewportWidth / 2;
      const centreY = viewportHeight / 2;

      // 1. Haze — draw the nebula, then (while still growing) clip it to the growth disc with a
      //    feathered radial mask so it reveals from the centre out.
      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1;
      context.drawImage(nebula, 0, 0, viewportWidth, viewportHeight);
      if (growthRadius < halfDiagonal + config.growthFeatherPx) {
        context.globalCompositeOperation = 'destination-in';
        const innerRadius = Math.max(0, growthRadius - config.growthFeatherPx);
        const mask = context.createRadialGradient(centreX, centreY, innerRadius, centreX, centreY, growthRadius);
        mask.addColorStop(0, 'rgba(0,0,0,1)');
        mask.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = mask;
        context.fillRect(0, 0, viewportWidth, viewportHeight);
        context.globalCompositeOperation = 'source-over';
      }

      // 2. Resolve each edge star's live position, reveal factor + twinkle.
      for (const star of stars) {
        star.reveal = Math.min(
          Math.max((growthRadius - star.distanceFromCentre) / config.growthFeatherPx, 0),
          1,
        );
        star.x =
          star.baseX + config.driftAmplitudePx * Math.sin(elapsedSeconds * config.driftSpeed + star.driftPhaseX);
        star.y =
          star.baseY +
          config.driftAmplitudePx * Math.cos(elapsedSeconds * config.driftSpeed * 0.9 + star.driftPhaseY);
        star.twinkle =
          1 - config.twinkleDepth * (0.5 - 0.5 * Math.sin(elapsedSeconds * config.twinkleSpeed + star.twinklePhase));
      }

      // 3. Links under the stars — appear as both endpoints are revealed.
      context.strokeStyle = `rgb(${LINE_RGB})`;
      context.lineWidth = 1;
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

      // 4. Stars on top — neon colour, fading in with the reveal front.
      const half = spriteCssSize / 2;
      for (const star of stars) {
        const alpha = config.starAlpha * star.reveal * star.twinkle;
        if (alpha <= 0.002) continue;
        context.globalAlpha = alpha;
        context.drawImage(colourSprites[star.paletteIndex], star.x - half, star.y - half, spriteCssSize, spriteCssSize);
      }
      context.globalAlpha = 1;
    };

    // ── Reduced motion: one static, fully-grown frame, no loop ──
    if (reduceMotion) {
      resizeBackingStore();
      placeStars();
      rebuildAssets();
      drawFrame(0, halfDiagonal + config.growthFeatherPx);
      const onResizeStatic = () => {
        if (resizeBackingStore()) {
          placeStars();
          rebuildAssets();
          drawFrame(0, halfDiagonal + config.growthFeatherPx);
        }
      };
      window.addEventListener('resize', onResizeStatic);
      return () => window.removeEventListener('resize', onResizeStatic);
    }

    // ── Animated path ──
    resizeBackingStore();
    placeStars();
    rebuildAssets();

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

    // The growth front is armed on reveal; nothing draws before then (screen stays empty).
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
        rebuildAssets();
      }
      const now = performance.now();
      const elapsedSeconds = (now - startTime) / 1000;
      const growthFraction = Math.min((now - revealTimeMs) / 1000 / config.growthSeconds, 1);
      const eased = 1 - Math.pow(1 - growthFraction, 3); // easeOutCubic: quick bloom, settle at edges
      const growthRadius = eased * (halfDiagonal + config.growthFeatherPx);
      drawFrame(elapsedSeconds, growthRadius);
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
