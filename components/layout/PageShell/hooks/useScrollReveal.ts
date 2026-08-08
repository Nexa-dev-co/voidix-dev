'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Reveals things as they come into view — the document pages' one piece of entrance motion.
 *
 * ── ⚠ WHY THERE IS NO GSAP IN HERE ───────────────────────────────────────────────────────────────
 * The homepage carries GSAP because it IS a scrubbed timeline. These pages carry prose. An
 * `IntersectionObserver` that adds one class, with every transition declared in CSS next to the thing
 * it moves, does the whole job.
 *
 * ⚠ That is a statement about THIS FILE, not about the route's bundle, and the difference was measured
 * rather than assumed. `/about` still downloads ~69 KB of gsap + ScrollTrigger, because the root
 * layout renders `Navbar`, and `useNavbarAnimation` imports gsap at module scope for the bar's
 * entrance — so every route pays for it whether it animates anything or not. Nothing on these pages
 * uses a frame of it. See docs/about-careers-plan.md §6 for the measurement and the one-hook fix.
 *
 * ── ⚠ IT REVEALS ONCE, AND NEVER AGAIN ───────────────────────────────────────────────────────────
 * `unobserve` on the way out. A section that re-animates every time it passes the fold is the "generic
 * scroll reveal" the brief names as an anti-reference, and it turns an ordinary scroll back up the page
 * into a slideshow. Arriving is a thing that happens to a section once.
 *
 * ── Reduced motion needs no branch ────────────────────────────────────────────────────────────────
 * The observer still runs and the class still lands; the blanket rule at the bottom of `globals.css`
 * has already collapsed the transitions those classes drive to nothing. The content simply is where it
 * belongs. That is the whole reason the motion lives in CSS transitions rather than in a timeline —
 * the site's existing reduced-motion handling reaches it for free.
 */

/** How much of an element has to be showing before it counts as arrived. */
const REVEAL_THRESHOLD = 0.18;

/**
 * Nudges the trigger line up from the very bottom of the viewport. Without it a short element that is
 * technically 18% visible while still below the fold gets its reveal spent off screen.
 */
const REVEAL_ROOT_MARGIN = '0px 0px -8% 0px';

export function useScrollReveal(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const targets = Array.from(container.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (targets.length === 0) return;

    // Some browsers this site supports (and every automated crawler) will not run the observer. Nothing
    // may depend on it for CONTENT to exist — the CSS only ever moves and fades what is already there —
    // but if the API is missing outright, present everything immediately rather than leaving a page of
    // invisible copy.
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((target) => target.classList.add('is-revealed'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        });
      },
      { threshold: REVEAL_THRESHOLD, rootMargin: REVEAL_ROOT_MARGIN },
    );

    // ⚠ Anything already on screen at mount is revealed outright rather than observed. The observer
    // would get there on its first callback anyway, but one frame later — which is a visible flash of
    // the masthead's own copy arriving on a page the visitor is already looking at.
    targets.forEach((target) => {
      const rect = target.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.9) target.classList.add('is-revealed');
      else observer.observe(target);
    });

    return () => observer.disconnect();
  }, [containerRef]);
}
