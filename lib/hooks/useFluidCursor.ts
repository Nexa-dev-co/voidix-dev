import { RefObject, useEffect } from 'react';
import {
  FLUID_CONFIG,
  MAX_BLOB_RADIUS_PX,
  MIN_BLOB_RADIUS_PX,
  SPEED_FOR_MAX_RADIUS,
} from '@/components/effects/FluidCursor/fluidConfig';
import { createFluidSimulation } from '@/components/effects/FluidCursor/fluidSimulation';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT } from '@/components/sections/ServicesDeck/deckEvents';

const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_FRAME_SECONDS = 1 / 60;

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

    // Match both canvases' backing stores to the viewport.
    const resizeCanvases = () => {
      const deviceWidth = Math.floor(window.innerWidth * pixelRatio());
      const deviceHeight = Math.floor(window.innerHeight * pixelRatio());
      let changed = false;
      for (const canvas of [inkCanvas, invertCanvas]) {
        if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
          canvas.width = deviceWidth;
          canvas.height = deviceHeight;
          changed = true;
        }
      }
      return changed;
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
    let inServices = false;
    const onServicesEnter = () => { inServices = true; };
    const onServicesLeave = () => { inServices = false; };
    window.addEventListener(DECK_REVEAL_EVENT, onServicesEnter);
    window.addEventListener(DECK_HIDE_EVENT, onServicesLeave);

    // ── Pointer tracking ──────────────────────────────────────────────
    let hasLastPointer = false;
    let lastClientX = 0;
    let lastClientY = 0;
    let lastPointerTime = 0;

    const handlePointerMove = (clientX: number, clientY: number) => {
      if (!isHeroVisible || inServices) return;
      const now = performance.now();
      const uvX = clientX / window.innerWidth;
      const uvY = 1 - clientY / window.innerHeight;

      if (!hasLastPointer) {
        hasLastPointer = true;
        lastClientX = clientX;
        lastClientY = clientY;
        lastPointerTime = now;
        return;
      }

      const deltaSeconds = Math.max((now - lastPointerTime) / 1000, 0.0001);
      const deltaXPixels = clientX - lastClientX;
      const deltaYPixels = clientY - lastClientY;

      // Blob radius grows with cursor speed, clamped to the configured range.
      const pixelSpeed = Math.hypot(deltaXPixels, deltaYPixels) / deltaSeconds;
      const normalizedSpeed = pixelSpeed / window.innerHeight;
      const speedRatio = Math.min(normalizedSpeed / SPEED_FOR_MAX_RADIUS, 1);
      const radiusPixels = MIN_BLOB_RADIUS_PX + (MAX_BLOB_RADIUS_PX - MIN_BLOB_RADIUS_PX) * speedRatio;

      // Force follows the motion direction (uvY is flipped, so negate dy).
      const forceX = (deltaXPixels / window.innerWidth) * FLUID_CONFIG.splatForce;
      const forceY = -(deltaYPixels / window.innerHeight) * FLUID_CONFIG.splatForce;

      simulation.splat(uvX, uvY, forceX, forceY, radiusPixels);

      lastClientX = clientX;
      lastClientY = clientY;
      lastPointerTime = now;
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

      if (resizeCanvases()) simulation.resize();

      simulation.frame(deltaSeconds, (now - startTime) / 1000);

      // Copy the ink silhouette into the invert layer as a solid white mask,
      // keeping only the alpha. With mix-blend-mode: difference this inverts the
      // page wherever the fluid is.
      invertContext.setTransform(1, 0, 0, 1, 0, 0);
      invertContext.clearRect(0, 0, invertCanvas.width, invertCanvas.height);
      invertContext.globalCompositeOperation = 'source-over';
      invertContext.drawImage(inkCanvas, 0, 0);
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
      window.removeEventListener(DECK_REVEAL_EVENT, onServicesEnter);
      window.removeEventListener(DECK_HIDE_EVENT, onServicesLeave);
      simulation.dispose();
    };
  }, [inkCanvasRef, invertCanvasRef]);
}
