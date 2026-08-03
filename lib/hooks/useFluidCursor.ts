import { RefObject, useEffect } from 'react';
import {
  BLOB_RADIUS_PX,
  FLUID_CONFIG,
} from '@/components/effects/FluidCursor/fluidConfig';
import { createFluidSimulation } from '@/components/effects/FluidCursor/fluidSimulation';
import { BLACK_STAGE_EVENT, readBlackStageActive } from '@/lib/blackStageEvent';

const MAX_DEVICE_PIXEL_RATIO = 2;
/**
 * The INVERT layer's own density cap, deliberately below the ink's.
 *
 * That layer is a silhouette: the ink's alpha, flooded with flat white, blended through
 * `mix-blend-mode: difference`. It carries no detail of its own — there is nothing in it that a second
 * device pixel could resolve. But it was being kept at the ink's full 2×, which made the per-frame
 * copy below a ~3000 × 2000 cross-context `drawImage` plus a repaint of a second canvas the same size,
 * every frame the pointer moves over the hero. That is the most expensive per-frame path on the first
 * screen a visitor sees, spent on a soft-edged blob.
 *
 * At 1 it is a quarter of the pixels for a difference nobody can point at — the blob's edge is already
 * several pixels of gradient. The INK canvas keeps its full density, so the thing you actually look at
 * is untouched.
 */
const MAX_INVERT_PIXEL_RATIO = 1;
const MAX_FRAME_SECONDS = 1 / 60;
// The ink dissipates within ~0.6s of the last splat (densityDissipation is very high), after which the
// sim renders a blank, fully-transparent frame forever. Once the pointer's been still longer than this we
// stop the solve + composite entirely until the next splat — a still cursor (and touch devices between
// touches) then cost nothing. Comfortably past the dissipation time, so nothing visible is ever cut off.
const IDLE_AFTER_LAST_SPLAT_MS = 900;

/**
 * Drives the fluid cursor: one WebGL sim renders dark ink + stars to `inkCanvas`,
 * and each frame its silhouette is copied to `invertCanvas` (a 2D canvas using
 * mix-blend-mode: difference) so text beneath glows through inverted.
 */
export function useFluidCursor(
  inkCanvasRef: RefObject<HTMLCanvasElement | null>,
  invertCanvasRef: RefObject<HTMLCanvasElement | null>
) {
  useEffect(() => {
    const inkCanvas = inkCanvasRef.current;
    const invertCanvas = invertCanvasRef.current;
    if (!inkCanvas || !invertCanvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const invertContext = invertCanvas.getContext('2d');
    if (!invertContext) return;

    const pixelRatio = () => Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const invertPixelRatio = () => Math.min(pixelRatio(), MAX_INVERT_PIXEL_RATIO);

    // Match each canvas's backing store to the viewport, at ITS OWN density — see
    // MAX_INVERT_PIXEL_RATIO. Reports whether the INK canvas moved, because that is the one the
    // simulation's buffers are sized against.
    const resizeCanvases = () => {
      const deviceWidth = Math.floor(window.innerWidth * pixelRatio());
      const deviceHeight = Math.floor(window.innerHeight * pixelRatio());
      const invertWidth = Math.floor(window.innerWidth * invertPixelRatio());
      const invertHeight = Math.floor(window.innerHeight * invertPixelRatio());

      const inkChanged = inkCanvas.width !== deviceWidth || inkCanvas.height !== deviceHeight;
      if (inkChanged) {
        inkCanvas.width = deviceWidth;
        inkCanvas.height = deviceHeight;
      }
      if (invertCanvas.width !== invertWidth || invertCanvas.height !== invertHeight) {
        invertCanvas.width = invertWidth;
        invertCanvas.height = invertHeight;
      }
      return inkChanged;
    };
    resizeCanvases();

    const simulation = createFluidSimulation(inkCanvas, FLUID_CONFIG);
    if (!simulation) return;

    // The trail is scoped to the hero: once the hero scrolls out of view we stop
    // splatting and rendering so it never reacts over the sections below.
    let isHeroVisible = true;
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isHeroVisible = entry.isIntersecting;
      },
      { threshold: 0 }
    );
    visibilityObserver.observe(inkCanvas);

    // The trail is the hero's alone. While the fleet is up (the hero stays pinned, so the
    // IntersectionObserver still reports "visible") we stop splatting, so no new ink is laid and
    // the existing trail dissipates away — the cursor leaves no trail over the services section.
    // ⚠ The BLACK STAGE, not the deck's reveal. The deck's event only fires when the fleet itself is
    // entered, and a navbar jump goes straight from the hero to works or contact without ever
    // entering it — which left the ink splatting over the whole rest of the site. See
    // lib/blackStageEvent.ts.
    let inVoid = false;
    const onBlackStage = (event: Event) => { inVoid = readBlackStageActive(event); };
    window.addEventListener(BLACK_STAGE_EVENT, onBlackStage);

    // ── Pointer tracking ──────────────────────────────────────────────
    let hasLastPointer = false;
    let lastClientX = 0;
    let lastClientY = 0;
    // When the last splat landed — the render loop idles the sim once the trail's had time to dissipate.
    // Starts far in the past so a still hero (no pointer yet) costs nothing until the first splat.
    let lastSplatTime = Number.NEGATIVE_INFINITY;

    const handlePointerMove = (clientX: number, clientY: number) => {
      if (!isHeroVisible || inVoid) return;
      const now = performance.now();
      const uvX = clientX / window.innerWidth;
      const uvY = 1 - clientY / window.innerHeight;

      if (!hasLastPointer) {
        hasLastPointer = true;
        lastClientX = clientX;
        lastClientY = clientY;
        return;
      }

      const deltaXPixels = clientX - lastClientX;
      const deltaYPixels = clientY - lastClientY;

      // Force follows the motion direction (uvY is flipped, so negate dy).
      const forceX = (deltaXPixels / window.innerWidth) * FLUID_CONFIG.splatForce;
      const forceY = -(deltaYPixels / window.innerHeight) * FLUID_CONFIG.splatForce;

      simulation.splat(uvX, uvY, forceX, forceY, BLOB_RADIUS_PX);
      lastSplatTime = now; // wakes / keeps the render loop solving

      lastClientX = clientX;
      lastClientY = clientY;
    };

    const onMouseMove = (event: MouseEvent) => handlePointerMove(event.clientX, event.clientY);
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.targetTouches[0];
      if (touch) handlePointerMove(touch.clientX, touch.clientY);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('resize', resizeCanvases);

    // ── Render loop ───────────────────────────────────────────────────
    let animationFrame = 0;
    let lastFrameTime = performance.now();
    const startTime = lastFrameTime;

    const renderFrame = () => {
      animationFrame = requestAnimationFrame(renderFrame);

      // Idle the whole sim while the hero is off screen, or the tab is backgrounded — nothing to
      // draw, no work.
      if (!isHeroVisible || document.hidden) return;

      const now = performance.now();
      const deltaSeconds = Math.min((now - lastFrameTime) / 1000, MAX_FRAME_SECONDS);
      lastFrameTime = now;

      // Keep resize handling live even while idle (cheap no-op when nothing changed), so the sim's
      // buffers never fall out of step with the canvas during a still stretch.
      if (resizeCanvases()) simulation.resize();

      // Idle once the trail has fully dissipated and the pointer's gone quiet — the canvas is already
      // transparent, so skipping the solve + composite changes nothing on screen. The next splat
      // (mouse/touch) pushes lastSplatTime forward and the loop resumes on the same frame.
      if (now - lastSplatTime > IDLE_AFTER_LAST_SPLAT_MS) return;

      simulation.frame(deltaSeconds, (now - startTime) / 1000);

      // Copy the ink silhouette into the invert layer as a solid white mask,
      // keeping only the alpha. With mix-blend-mode: difference this inverts the
      // page wherever the fluid is.
      //
      // ⚠ Drawn to the invert canvas's OWN size, not 1:1. The two backing stores are deliberately at
      // different densities (see MAX_INVERT_PIXEL_RATIO), so an unscaled `drawImage` would paint a
      // 2× ink canvas into a 1× mask and invert only the top-left quarter of the screen.
      invertContext.setTransform(1, 0, 0, 1, 0, 0);
      invertContext.clearRect(0, 0, invertCanvas.width, invertCanvas.height);
      invertContext.globalCompositeOperation = 'source-over';
      invertContext.drawImage(inkCanvas, 0, 0, invertCanvas.width, invertCanvas.height);
      invertContext.globalCompositeOperation = 'source-in';
      invertContext.fillStyle = '#ffffff';
      invertContext.fillRect(0, 0, invertCanvas.width, invertCanvas.height);
    };
    renderFrame();

    return () => {
      cancelAnimationFrame(animationFrame);
      visibilityObserver.disconnect();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('resize', resizeCanvases);
      window.removeEventListener(BLACK_STAGE_EVENT, onBlackStage);
      simulation.dispose();
    };
  }, [inkCanvasRef, invertCanvasRef]);
}
