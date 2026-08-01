import { RefObject, useEffect } from 'react';
import {
  CONSTELLATION_CONFIG,
  CONSTELLATION_CONFIG_LOW_POWER,
  LOW_POWER_MAX_WIDTH,
  DOT_DIM_RGB,
  DOT_BRIGHT_RGB,
  DOT_GLOW_RGB,
  LINE_RGB,
  LINE_BRIGHT_RGB,
  type ConstellationConfig,
} from '@/components/effects/ConstellationFrame/constellationConfig';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { BLACK_STAGE_EVENT, readBlackStageActive } from '@/lib/blackStageEvent';

const MAX_DEVICE_PIXEL_RATIO = 2;
const REVEAL_FALLBACK_MS = 7000;
// The 3×3 block of buckets around a star's live cell. Because the stars move now, links can't be
// found against a fixed grid — instead a spatial hash is rebuilt each frame from live positions and
// scanned with these offsets, so every nearby pair is caught wherever the stars have wandered to.
const NEIGHBOUR_CELL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],  [0, 0],  [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];
// The bond-and-seek motion wakes up only once the liquid fill has essentially finished (this fill
// fraction), so the frame first "completes", THEN the stars start bonding + hopping.
const ROAM_RAMP_START = 0.8;
// Clamp dt so a tab-restore or an un-freeze (hero scrolled back into view) can't teleport the stars
// with one huge frame.
const MAX_FRAME_SECONDS = 0.05;
// How fast a dot's colour eases between its dark (un-bonded) and bright (connected) states, as a
// per-second rate fed through 1 - e^(-rate·dt) so it's frame-rate independent.
const BRIGHTNESS_RATE = 6;
// How long a link takes to draw itself in once both endpoints are parked (the "linking" animation).
const LINK_GROW_SECONDS = 0.35;

// Deterministic per-cell hash (ported from the FluidCursor DISPLAY_SHADER starField): stable across
// frames + resizes, so a star's home placement, twinkle phase and fill noise never jump.
function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function parseRgb(rgb: string): [number, number, number] {
  const [red, green, blue] = rgb.split(' ').map(Number);
  return [red, green, blue];
}

interface Star {
  /** Stable identity — used to link each pair exactly once. */
  id: number;
  /** Anchor the star hops around — keeps each star inside its slice of the frame band. */
  homeX: number;
  homeY: number;
  /** Current hop destination (only meaningful while seeking). */
  targetX: number;
  targetY: number;
  twinklePhase: number;
  /** Position in the fill sequence (0 = first to light, ~1 = last). Sides fill first, then the top
   *  and bottom close toward their centres; a per-star noise offset makes the front seep like liquid. */
  fillOrder: number;
  // Live / per-frame state.
  x: number;
  y: number;
  reveal: number;
  twinkle: number;
  /** false = parked (bonded, sitting still); true = travelling to find a new connection. */
  seeking: boolean;
  /** Seconds left before a parked+connected star breaks its bond and goes looking again. */
  holdRemaining: number;
  /** Live link count this frame — drives the dot's colour and the park/seek decision. */
  connections: number;
  /** Eased 0..1 dark→bright, so the colour state change isn't an instant pop. */
  brightness: number;
}

/**
 * Drives the hero's constellation frame: a photo-frame border of connected blue "zodiac" stars. The
 * screen starts empty; on REVEAL_EVENT the frame fills in with a liquid-like flowing front that
 * starts at the left & right sides and closes at the top-centre and bottom-centre over ~growthSeconds.
 * Once it completes the field comes alive with bond-and-seek motion: a star sits still (bright) while
 * it holds a connection, and when the bond's timer runs out it breaks, the star dims and hops to a
 * fresh patch of the band to make a new connection, then parks again. Links brighten with how many
 * connections their stars have. Frozen over the services/works overlays, idled off-screen,
 * reduced-motion safe (one static frame).
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

    // Line colours parsed once so the per-link brightness lerp is plain number math.
    const lineBaseRgb = parseRgb(LINE_RGB);
    const lineBrightRgb = parseRgb(LINE_BRIGHT_RGB);

    let viewportWidth = 0;
    let viewportHeight = 0;

    // ── Soft neon dot sprites — one per colour state, plus a larger softer glow, built once at
    //    device resolution. `haloMultiple` sets how far the halo reaches past the core. ──
    const buildDotSprite = (rgb: string, haloMultiple: number) => {
      const ratio = pixelRatio();
      const cssSize = config.starRadiusPx * haloMultiple * 2;
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
    const glowHaloMultiple = config.haloRadiusMultiple * config.glowRadiusMultiple;
    let spriteCssSize = config.starRadiusPx * config.haloRadiusMultiple * 2;
    let glowCssSize = config.starRadiusPx * glowHaloMultiple * 2;
    let dimSprite = buildDotSprite(DOT_DIM_RGB, config.haloRadiusMultiple);
    let brightSprite = buildDotSprite(DOT_BRIGHT_RGB, config.haloRadiusMultiple);
    let glowSprite = buildDotSprite(DOT_GLOW_RGB, glowHaloMultiple);
    const rebuildSprites = () => {
      spriteCssSize = config.starRadiusPx * config.haloRadiusMultiple * 2;
      glowCssSize = config.starRadiusPx * glowHaloMultiple * 2;
      dimSprite = buildDotSprite(DOT_DIM_RGB, config.haloRadiusMultiple);
      brightSprite = buildDotSprite(DOT_BRIGHT_RGB, config.haloRadiusMultiple);
      glowSprite = buildDotSprite(DOT_GLOW_RGB, glowHaloMultiple);
    };

    // ── Placement — deterministic cells, perimeter band, with a fill-order for the liquid reveal ──
    let stars: Star[] = [];
    // Rebuilt every frame from live positions so moving stars are linked by where they actually are.
    const linkBuckets = new Map<string, Star[]>();
    const bucketKey = (bucketX: number, bucketY: number) => `${bucketX},${bucketY}`;
    // Per-link grow-in progress (0..1), keyed "aId-bId". Persists across frames so a freshly formed
    // link can animate itself in; a link whose endpoint starts moving is dropped instantly.
    const linkProgress = new Map<string, number>();
    // How many stars are currently seeking (in motion). Capped so only ever a handful move at once.
    let activeSeekers = 0;

    const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

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
      activeSeekers = 0; // fresh stars are all parked
      linkProgress.clear(); // ids are re-assigned, so old link keys are meaningless
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;

      const cell = config.cellSizePx;
      const bandX = viewportWidth * config.bandRatioX;
      const bandY = viewportHeight * config.bandRatioY;
      const columns = Math.ceil(viewportWidth / cell) + 1;
      const rows = Math.ceil(viewportHeight / cell) + 1;
      let nextId = 0;

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

          stars.push({
            id: nextId,
            homeX: baseX,
            homeY: baseY,
            targetX: baseX,
            targetY: baseY,
            twinklePhase: hash(cellX + 2.1, cellY + 8.7) * Math.PI * 2,
            fillOrder,
            x: baseX,
            y: baseY,
            reveal: 0,
            twinkle: 1,
            seeking: false,
            // Randomised so the first bonds break staggered, not all at once.
            holdRemaining: randomBetween(config.holdSecondsMin, config.holdSecondsMax),
            connections: 0,
            brightness: 0,
          });
          nextId += 1;
        }
      }
    };

    // Release a parked star: send it hopping to a fresh patch of the band, clamped so it never
    // strays more than roamRadius from its home anchor (the frame shape holds over many hops).
    const startSeeking = (star: Star) => {
      star.seeking = true;
      const angle = Math.random() * Math.PI * 2;
      const hop = randomBetween(config.hopMinPx, config.hopMaxPx);
      let targetX = star.x + Math.cos(angle) * hop;
      let targetY = star.y + Math.sin(angle) * hop;
      const fromHomeX = targetX - star.homeX;
      const fromHomeY = targetY - star.homeY;
      const fromHome = Math.hypot(fromHomeX, fromHomeY);
      if (fromHome > config.roamRadiusPx) {
        targetX = star.homeX + (fromHomeX / fromHome) * config.roamRadiusPx;
        targetY = star.homeY + (fromHomeY / fromHome) * config.roamRadiusPx;
      }
      star.targetX = targetX;
      star.targetY = targetY;
    };

    const park = (star: Star) => {
      star.seeking = false;
      star.holdRemaining = randomBetween(config.holdSecondsMin, config.holdSecondsMax);
    };

    // Parked → seeking, claiming one of the limited motion slots. Returns false if all slots are
    // taken, so the caller can leave the star put and let it try again next frame.
    const tryBeginSeek = (star: Star) => {
      if (activeSeekers >= config.maxConcurrentSeekers) return false;
      activeSeekers += 1;
      startSeeking(star);
      return true;
    };
    // Seeking → parked, releasing its motion slot.
    const settle = (star: Star) => {
      activeSeekers -= 1;
      park(star);
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

    // ── One frame. `front` in [0, revealCeiling] is the liquid fill position; `motionActive` gates
    //    the bond-and-seek state machine; `snap` resolves colours instantly (reduced-motion still). ──
    const drawFrame = (
      elapsedSeconds: number,
      deltaSeconds: number,
      front: number,
      motionActive: boolean,
      snap: boolean,
    ) => {
      context.clearRect(0, 0, viewportWidth, viewportHeight);

      // 1. Resolve each star's reveal factor + twinkle, and reset its live connection count.
      for (const star of stars) {
        star.reveal = smoothstep(star.fillOrder - config.fillFeather, star.fillOrder + config.fillFeather, front);
        star.twinkle =
          1 - config.twinkleDepth * (0.5 - 0.5 * Math.sin(elapsedSeconds * config.twinkleSpeed + star.twinklePhase));
        star.connections = 0;
      }

      // 2. Spatial hash of PARKED, revealed dots only. A moving (seeking) dot is fully detached — it
      //    takes part in NO links until it has arrived and parked.
      const linkCellSize = config.lineMaxDistPx;
      linkBuckets.clear();
      for (const star of stars) {
        if (star.reveal <= 0 || star.seeking) continue;
        const key = bucketKey(Math.floor(star.x / linkCellSize), Math.floor(star.y / linkCellSize));
        const bucket = linkBuckets.get(key);
        if (bucket) bucket.push(star);
        else linkBuckets.set(key, [star]);
      }

      // A seeker settles only next to a parked dot that still has spare link capacity — the test it
      // uses on arrival to decide it has found real company (not a saturated cluster it can't join).
      const hasOpenParkedNeighbour = (star: Star) => {
        const bucketX = Math.floor(star.x / linkCellSize);
        const bucketY = Math.floor(star.y / linkCellSize);
        for (const [offsetX, offsetY] of NEIGHBOUR_CELL_OFFSETS) {
          const bucket = linkBuckets.get(bucketKey(bucketX + offsetX, bucketY + offsetY));
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === star || other.connections >= config.maxConnectionsPerDot) continue;
            if (Math.hypot(star.x - other.x, star.y - other.y) < config.lineMaxDistPx) return true;
          }
        }
        return false;
      };

      // 3. Gather candidate pairs (both parked, in range) nearest-first, then accept greedily so each
      //    dot keeps its closest links up to maxConnectionsPerDot — no dot becomes an over-dense hub.
      const candidatePairs: Array<{ starA: Star; starB: Star; distance: number }> = [];
      for (const star of stars) {
        if (star.reveal <= 0 || star.seeking) continue;
        const bucketX = Math.floor(star.x / linkCellSize);
        const bucketY = Math.floor(star.y / linkCellSize);
        for (const [offsetX, offsetY] of NEIGHBOUR_CELL_OFFSETS) {
          const bucket = linkBuckets.get(bucketKey(bucketX + offsetX, bucketY + offsetY));
          if (!bucket) continue;
          for (const neighbour of bucket) {
            if (neighbour.id <= star.id) continue;
            const distance = Math.hypot(star.x - neighbour.x, star.y - neighbour.y);
            if (distance >= config.lineMaxDistPx) continue;
            candidatePairs.push({ starA: star, starB: neighbour, distance });
          }
        }
      }
      candidatePairs.sort((first, second) => first.distance - second.distance);

      const activePairs: Array<{ starA: Star; starB: Star; distance: number; key: string; progress: number }> = [];
      const activeKeys = new Set<string>();
      for (const candidate of candidatePairs) {
        if (candidate.starA.connections >= config.maxConnectionsPerDot) continue;
        if (candidate.starB.connections >= config.maxConnectionsPerDot) continue;
        candidate.starA.connections += 1;
        candidate.starB.connections += 1;
        const key = `${candidate.starA.id}-${candidate.starB.id}`;
        activeKeys.add(key);
        activePairs.push({ ...candidate, key, progress: 0 });
      }

      // 3b. Reconcile the grow-in animation. A link whose endpoint has moved off is dropped at once
      //     (a moving dot shows no line). New links grow from 0 over LINK_GROW_SECONDS; during the
      //     initial fill (motion not yet active) they snap to full, so the liquid build looks as before.
      for (const key of Array.from(linkProgress.keys())) {
        if (!activeKeys.has(key)) linkProgress.delete(key);
      }
      const animateLinks = motionActive && !snap;
      const growStep = animateLinks ? deltaSeconds / LINK_GROW_SECONDS : 1;
      for (const pair of activePairs) {
        const nextProgress = Math.min(1, (linkProgress.get(pair.key) ?? 0) + growStep);
        linkProgress.set(pair.key, nextProgress);
        pair.progress = nextProgress;
      }

      // 4. Ease each dot's colour toward its state (connected → bright, alone → dark).
      const brightnessBlend = snap ? 1 : 1 - Math.exp(-BRIGHTNESS_RATE * deltaSeconds);
      for (const star of stars) {
        const brightTarget = star.connections > 0 ? 1 : 0;
        star.brightness += (brightTarget - star.brightness) * brightnessBlend;
      }

      // 5. Links under the stars. Each link draws itself in — extending from its lower-id endpoint to
      //    the other as it forms — and brightens from the base blue toward the deep blue with the
      //    higher connection count of its two endpoints (busy clusters read strongest).
      context.lineWidth = config.lineWidthPx;
      for (const { starA, starB, distance, progress } of activePairs) {
        const eased = smoothstep(0, 1, progress);
        if (eased <= 0.001) continue;
        const degree = Math.max(starA.connections, starB.connections);
        const brightMix = Math.min(1, (degree - 1) / Math.max(1, config.brightAtConnections - 1));
        const red = Math.round(lineBaseRgb[0] + (lineBrightRgb[0] - lineBaseRgb[0]) * brightMix);
        const green = Math.round(lineBaseRgb[1] + (lineBrightRgb[1] - lineBaseRgb[1]) * brightMix);
        const blue = Math.round(lineBaseRgb[2] + (lineBrightRgb[2] - lineBaseRgb[2]) * brightMix);
        const falloff = 1 - distance / config.lineMaxDistPx;
        context.strokeStyle = `rgb(${red} ${green} ${blue})`;
        context.globalAlpha =
          config.lineAlpha * falloff * (0.6 + 0.4 * brightMix) * Math.min(starA.reveal, starB.reveal) * eased;
        context.beginPath();
        context.moveTo(starA.x, starA.y);
        context.lineTo(starA.x + (starB.x - starA.x) * eased, starA.y + (starB.y - starA.y) * eased);
        context.stroke();
      }

      // 6. Stars on top. A lone (un-bonded) pin gets a soft glow underneath so it still stands out
      //    despite being dark; then the dim + bright sprites cross-fade by the eased brightness.
      const half = spriteCssSize / 2;
      const glowHalf = glowCssSize / 2;
      for (const star of stars) {
        const alpha = config.starAlpha * star.reveal * star.twinkle;
        if (alpha <= 0.002) continue;
        const lonely = 1 - star.brightness; // 1 while un-bonded, 0 once fully lit
        if (lonely > 0.001) {
          context.globalAlpha = alpha * lonely * config.glowStrength;
          context.drawImage(glowSprite, star.x - glowHalf, star.y - glowHalf, glowCssSize, glowCssSize);
        }
        if (star.brightness < 0.999) {
          context.globalAlpha = alpha * lonely;
          context.drawImage(dimSprite, star.x - half, star.y - half, spriteCssSize, spriteCssSize);
        }
        if (star.brightness > 0.001) {
          context.globalAlpha = alpha * star.brightness;
          context.drawImage(brightSprite, star.x - half, star.y - half, spriteCssSize, spriteCssSize);
        }
      }
      context.globalAlpha = 1;

      // 7. Bond-and-seek state machine — runs after drawing so this frame's dots + links stay
      //    consistent; the moves it makes here show up next frame.
      if (!motionActive) return;
      for (const star of stars) {
        if (star.reveal <= 0) continue;
        if (star.seeking) {
          const toTargetX = star.targetX - star.x;
          const toTargetY = star.targetY - star.y;
          const distance = Math.hypot(toTargetX, toTargetY);
          if (distance < config.arriveRadiusPx) {
            // Arrived: settle next to open company (frees a slot) so it links + animates in next
            // frame; otherwise hop onward to keep hunting — a re-hop stays seeking, keeping its slot.
            if (hasOpenParkedNeighbour(star)) settle(star);
            else startSeeking(star);
            continue;
          }
          const step = Math.min(config.roamSpeedPx * deltaSeconds, distance);
          star.x += (toTargetX / distance) * step;
          star.y += (toTargetY / distance) * step;
        } else if (star.connections > 0) {
          // Parked + bonded: sit still, counting down until the bond breaks. Only actually break off
          // if a motion slot is free — otherwise hold (timer stays expired, retries next frame).
          star.holdRemaining -= deltaSeconds;
          if (star.holdRemaining <= 0) tryBeginSeek(star);
        } else {
          // Parked but its partner(s) left — a lone pin. Go find a new connection when a slot frees;
          // until then it waits in place, dark blue and glowing so it stands out.
          tryBeginSeek(star);
        }
      }
    };

    // ── Reduced motion: one static, fully-filled frame, no loop, no bonding ──
    if (reduceMotion) {
      resizeBackingStore();
      placeStars();
      drawFrame(0, 0, revealCeiling, false, true);
      const onResizeStatic = () => {
        if (resizeBackingStore()) {
          placeStars();
          rebuildSprites();
          drawFrame(0, 0, revealCeiling, false, true);
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
    // ⚠ The BLACK STAGE, not the deck's reveal — a navbar jump can reach works or contact without the
    // fleet ever being entered, and this would then keep animating behind them. See
    // lib/blackStageEvent.ts.
    let inVoid = false;
    const onBlackStage = (event: Event) => { inVoid = readBlackStageActive(event); };
    window.addEventListener(BLACK_STAGE_EVENT, onBlackStage);

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
    let lastFrameTime = startTime;
    const render = () => {
      animationFrame = requestAnimationFrame(render);
      // While frozen, keep the clock anchored so the next live frame gets a small dt (no teleport).
      if (!isHeroVisible || inVoid || !hasRevealed) {
        lastFrameTime = performance.now();
        return;
      }
      if (resizeBackingStore()) {
        placeStars();
        rebuildSprites();
      }
      const now = performance.now();
      const deltaSeconds = Math.min((now - lastFrameTime) / 1000, MAX_FRAME_SECONDS);
      lastFrameTime = now;
      const elapsedSeconds = (now - startTime) / 1000;
      const fillFraction = Math.min((now - revealTimeMs) / 1000 / config.growthSeconds, 1);
      const eased = smoothstep(0, 1, fillFraction); // gentle ease so the fill settles, not stops abruptly
      const front = eased * revealCeiling;
      // Bond-and-seek only after the frame has essentially finished filling.
      const motionActive = fillFraction >= ROAM_RAMP_START;
      drawFrame(elapsedSeconds, deltaSeconds, front, motionActive, false);
    };
    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      visibilityObserver.disconnect();
      window.clearTimeout(fallbackTimeout);
      window.removeEventListener(REVEAL_EVENT, runReveal);
      window.removeEventListener(BLACK_STAGE_EVENT, onBlackStage);
    };
  }, [canvasRef]);
}
