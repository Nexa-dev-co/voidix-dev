import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { getSunParallaxPose } from '@/lib/sunParallaxPose';

/**
 * Move the sun with the works camera.
 *
 * The works field publishes how far the visitor has dragged its camera off the pose the current stop
 * authored, as a pixel offset (see `lib/sunParallaxPose.ts`). This applies it. That is the whole
 * division of labour: the scene does the projection, because only it has a camera; the DOM does the
 * transform, because only it has the element.
 *
 * ── Why this owns an element of its own ──────────────────────────────────────────────────────────
 * `.hero-sun-layer` is the hero pin's (scroll transform) and `.hero-sun-flight` is the intro's (the
 * o → square flight, then the services scale). Both are already spoken for, and a transform with two
 * owners is how you get a sun that jumps — so this gets `.hero-sun-parallax` between them and is its
 * only writer.
 */

/**
 * Per-frame approach rate toward the published offset.
 *
 * Fast, because the value being chased is ALREADY smooth — the works field eases its own look-offset
 * before this ever sees it, so a slow ease here would only read as lag. What this is actually for is
 * the discontinuities: the field stops publishing the moment it leaves the screen, and the offset has
 * to fall away rather than snap.
 */
const SETTLE_EASE = 0.25;
/** Below this the offset is indistinguishable from none, so stop writing transforms. */
const SETTLE_EPSILON = 0.01;

export function useSunParallax(
  parallaxRef: RefObject<HTMLDivElement | null>,
  layerRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const parallax = parallaxRef.current;
    const layer = layerRef.current;
    if (!parallax || !layer) return;
    // Drag-to-look is disabled under reduced motion, so the field can only ever publish zero. Don't
    // hold a rAF open for the page's whole life to chase it.
    if (prefersReducedMotion()) return;

    let currentX = 0;
    let currentY = 0;
    let hasOffset = false;
    let frameId = 0;

    const step = () => {
      frameId = requestAnimationFrame(step);

      const pose = getSunParallaxPose();
      const requestedX = pose.active ? pose.offsetX : 0;
      const requestedY = pose.active ? pose.offsetY : 0;

      // The overwhelmingly common case, and it is most of the session: the intro, the hero, services,
      // and works with nobody dragging — where the field publishes an offset that is zero to within
      // floating-point noise. Gated on the VALUE rather than on `active`, so browsing projects costs
      // three comparisons a frame with no style read and no style write.
      if (
        Math.abs(requestedX) < SETTLE_EPSILON &&
        Math.abs(requestedY) < SETTLE_EPSILON &&
        !hasOffset
      ) {
        return;
      }

      // The pin SCALES our parent, and a child's translate is expressed in the parent's own pre-scale
      // units — so a raw pixel offset would carry the sun 1.1x as far as the camera actually moved.
      // Read from GSAP rather than from a shared constant: it is the thing that wrote the scale, it
      // answers from its cached transform (no forced style recalculation), and it stays correct if the
      // pin's numbers ever change.
      const parentScale = Number(gsap.getProperty(layer, 'scaleX')) || 1;
      const targetX = requestedX / parentScale;
      const targetY = requestedY / parentScale;

      currentX += (targetX - currentX) * SETTLE_EASE;
      currentY += (targetY - currentY) * SETTLE_EASE;

      // Settle exactly onto zero and then stop, rather than approaching it forever — otherwise the
      // element keeps a sub-pixel transform (and its compositor layer) for the rest of the session.
      if (
        Math.abs(targetX) < SETTLE_EPSILON &&
        Math.abs(targetY) < SETTLE_EPSILON &&
        Math.abs(currentX) < SETTLE_EPSILON &&
        Math.abs(currentY) < SETTLE_EPSILON
      ) {
        currentX = 0;
        currentY = 0;
        hasOffset = false;
        parallax.style.transform = '';
        return;
      }

      hasOffset = true;
      parallax.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [parallaxRef, layerRef]);
}
