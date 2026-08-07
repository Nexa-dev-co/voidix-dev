import { RefObject, useEffect } from 'react';
import {
  BLOB_RADIUS_PX,
  FLUID_CONFIG,
} from '@/components/effects/FluidCursor/fluidConfig';
import { createFluidSimulation } from '@/components/effects/FluidCursor/fluidSimulation';
import { BLACK_STAGE_EVENT, readBlackStageActive } from '@/lib/blackStageEvent';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { shouldDrawThisFrame } from '@/lib/renderClock';

/**
 * The INK canvas's density cap.
 *
 * ── ⚠ 2 → 1.25 ON 2026-08-06, TO FUND A RESOLUTION INCREASE ELSEWHERE ───────────────────────────
 * At 2 on a dpr 2.5 panel this canvas is 3072 × 1408 — **4.33 megapixels of fullscreen fluid
 * simulation**, running a 20-iteration pressure solve and a fullscreen display pass every frame, and
 * then being copied cross-context into the invert canvas below. On the first screen a visitor sees.
 *
 * It was the last renderer on the site answering to nothing: not `adaptivePixelRatio`, not
 * `deviceTier`, not this file's own reasoning — the note on `MAX_INVERT_PIXEL_RATIO` below already
 * called that copy *"the most expensive per-frame path on the first screen a visitor sees, spent on a
 * soft-edged blob"*, capped the INVERT canvas, and left the larger source canvas at full density.
 *
 * 1.25 removes ~61 % of those pixels. The argument is the same one that capped the invert layer and
 * it applies here with only slightly less force: the ink is a dark blob with a multi-pixel gradient
 * edge and a scatter of stars. There is very little in it a second device pixel resolves.
 *
 * ⚠ Not below 1.25. The stars ARE point-like, and at 1 they begin to shimmer as they twinkle across
 * the pixel grid. If this needs to go lower, drop `STAR_FILL_RATIO` with it.
 */
const MAX_DEVICE_PIXEL_RATIO = 1.25;
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
/**
 * Upper bound on the simulation's timestep — a SANITY clamp, not a frame-rate cap.
 *
 * ⚠ This was `1 / 60`, and that single number was both reported bugs at once.
 *
 * The clamp is applied to the real elapsed time, so on a machine running at 30 fps the sim was handed
 * 16.7 ms of simulated time for 33 ms of real time — **the entire fluid ran at half speed**. Two
 * consequences, and they are exactly what was reported:
 *
 *   1. "the cursor trail lagged" — the blob is pinned to the pointer by `velocityDissipation`, which is
 *      a per-step decay. Halve the step and it settles half as fast, so the ink visibly trails the
 *      cursor instead of sitting under it. The slower the machine, the further behind it falls. This
 *      is not the frame rate being low; it is the physics being run in slow motion BECAUSE the frame
 *      rate is low.
 *   2. "it appeared in other sections" — dissipation is per-step too, so the ~0.6 s fade became ~1.2 s,
 *      while `IDLE_AFTER_LAST_SPLAT_MS` below is measured in WALL CLOCK. The loop therefore stopped
 *      while ink was still on screen, and a WebGL canvas keeps its last frame — so the trail froze
 *      there, over every section past the hero, until the pointer moved again. (Everything under these
 *      canvases goes transparent past the fill: `.hero-section.is-services` in globals.css.)
 *
 * A tab-restore or a breakpoint can hand us a delta of several seconds, and that still has to be
 * clamped — but the bound belongs somewhere no real frame reaches. 1/15 s keeps the sim honest down to
 * 15 fps and is well inside stability: advection is semi-Lagrangian and dissipation is `1/(1 + k·dt)`,
 * both unconditionally stable for any positive step.
 */
const MAX_FRAME_SECONDS = 1 / 15;
// The ink dissipates within ~0.6s of the last splat (densityDissipation is very high), after which the
// sim renders a blank, fully-transparent frame forever. Once the pointer's been still longer than this we
// stop the solve + composite entirely until the next splat — a still cursor (and touch devices between
// touches) then cost nothing. Comfortably past the dissipation time, so nothing visible is ever cut off.
//
// ⚠ Wall clock, while dissipation is simulated time. Those only agree while the sim is fed real deltas
// — see MAX_FRAME_SECONDS above, and the explicit clear on the way into idle, which is what makes this
// safe rather than merely usually-correct.
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
    // Through the helper, not `matchMedia` directly — see lib/motionPreference.ts. Returning here
    // means no WebGL context is ever created, which is the point: hiding it would leave the rAF
    // loops running.
    if (prefersReducedMotion()) return;

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

    /** Wipe the sim AND the mask, so nothing is left painted on either canvas. */
    const clearTrail = () => {
      simulation.clear();
      invertContext.setTransform(1, 0, 0, 1, 0, 0);
      invertContext.globalCompositeOperation = 'source-over';
      invertContext.clearRect(0, 0, invertCanvas.width, invertCanvas.height);
    };

    /**
     * Take both canvases out of the compositor for the dark half of the site.
     *
     * ⚠ CLEARING THEM IS NOT ENOUGH, and that was the bug. A cleared canvas is still a LAYER: the
     * browser composites it every frame regardless of what is drawn in it, and the invert canvas
     * carries `mix-blend-mode: difference`, which forces the compositor to read the backdrop and blend
     * it. On a 4K laptop at 250 % scaling those two layers measured 4.27 and 1.07 megapixels — the ink
     * canvas alone being nearly TWICE the works field it was being blended over:
     *
     *     fluid ink       3056 × 1396   4.27 Mpx    ← composited through the whole dark site
     *     fluid invert    1528 ×  698   1.07 Mpx    ← …and blended, per frame
     *     field-canvas    2236 × 1021   2.28 Mpx    ← the actual 3D scene
     *
     * So the section that had its render targets carefully budgeted was being composited underneath
     * 5.3 Mpx of blank blend layers that could not, by construction, ever show anything: `inVoid`
     * refuses every splat and `clearTrail` has already wiped them.
     *
     * ⚠ `visibility`, NOT `display: none`. A display-none canvas reports `clientWidth/clientHeight` of
     * 0, and `syncCanvasSize` reads exactly those to size the drawing buffers — so it would resize the
     * sim to nothing on the way out and back again on the way in. Hidden keeps the box, drops the
     * paint.
     *
     * Invisible either way at the moment it flips: `.hero-sun-fill` is fully black over both canvases
     * when the stage changes, which is the same reason `clearTrail` can wipe them there.
     */
    const setTrailComposited = (composited: boolean) => {
      const visibility = composited ? '' : 'hidden';
      inkCanvas.style.visibility = visibility;
      invertCanvas.style.visibility = visibility;
    };

    // The trail is the hero's alone. While the fleet is up (the hero stays pinned, so the
    // IntersectionObserver still reports "visible") we stop splatting, so no new ink is laid.
    // ⚠ The BLACK STAGE, not the deck's reveal. The deck's event only fires when the fleet itself is
    // entered, and a navbar jump goes straight from the hero to works or contact without ever
    // entering it — which left the ink splatting over the whole rest of the site. See
    // lib/blackStageEvent.ts.
    //
    // ⚠ And it CLEARS rather than leaving the ink to dissipate. Waiting for the fade was the original
    // design and it is one assumption deep: it needs the loop to keep stepping long enough to finish
    // the decay. That held while the sim was fed real deltas on a 60 fps machine and stopped holding
    // on anything slower (see MAX_FRAME_SECONDS) — the loop idled first and froze half-faded ink onto
    // a canvas that, past the fill, has nothing opaque left in front of it.
    //
    // Clearing here is invisible: `.hero-sun-fill` is still fully black over this canvas at the moment
    // the stage flips, and only fades out afterwards (0.5 s, see `.is-services` in globals.css). So the
    // ink is behind an opaque square on the frame it is wiped.
    let inVoid = false;
    const onBlackStage = (event: Event) => {
      inVoid = readBlackStageActive(event);
      setTrailComposited(!inVoid);
      if (inVoid) clearTrail();
    };
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
    /** Latches the one clear that happens on the way into idle — see the render loop. */
    let isIdle = true;

    const renderFrame = (timestamp = performance.now()) => {
      animationFrame = requestAnimationFrame(renderFrame);

      // Idle the whole sim while the hero is off screen, or the tab is backgrounded — nothing to
      // draw, no work.
      if (!isHeroVisible || document.hidden) return;

      // ── On the shared cadence, like every other renderer on the page ──
      // ⚠ This is the one place the cap costs INPUT rather than motion. Everywhere else the cadence
      // samples a scroll position; here it samples a cursor, and an ink trail is judged on how closely
      // it tracks the pointer. It is on the clock anyway because the hero is a section like any other
      // and a star at 30 over a sim at 120 is exactly the "several clocks" the cadence exists to
      // remove — but if the trail ever reads as lagging the cursor, this is the line to lift, and
      // lifting it costs the hero its uniformity and nothing else.
      if (!shouldDrawThisFrame(timestamp)) return;

      const now = performance.now();
      const deltaSeconds = Math.min((now - lastFrameTime) / 1000, MAX_FRAME_SECONDS);
      lastFrameTime = now;

      // Keep resize handling live even while idle (cheap no-op when nothing changed), so the sim's
      // buffers never fall out of step with the canvas during a still stretch.
      if (resizeCanvases()) simulation.resize();

      // Idle once the trail has dissipated and the pointer's gone quiet. The next splat (mouse/touch)
      // pushes lastSplatTime forward and the loop resumes on the same frame.
      //
      // ⚠ The transition into idle CLEARS, exactly once. This used to just `return` on the assumption
      // that the canvas was already transparent by now — true only if the decay actually finished, and
      // the decay is measured in simulated time while this threshold is wall clock. On any machine not
      // holding 60 fps those two disagreed and the loop parked with ink still painted (see
      // MAX_FRAME_SECONDS). One clear on the way in costs a single frame and makes "idle" mean empty
      // rather than probably-empty.
      if (now - lastSplatTime > IDLE_AFTER_LAST_SPLAT_MS) {
        if (!isIdle) {
          isIdle = true;
          clearTrail();
        }
        return;
      }
      isIdle = false;

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
