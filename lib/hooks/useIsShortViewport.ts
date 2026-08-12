import { useEffect, useState } from 'react';

/**
 * True when the viewport is at or below the site's "short frame" breakpoint.
 *
 * ⚠ THIS IS THE THIRD OF THREE VIEWPORT QUESTIONS AND THEY ARE NOT INTERCHANGEABLE. Read the other
 * two before reaching for this one:
 *
 *   useIsLowPowerViewport  — *how much work can this device do* (coarse pointer or <760px). Gates
 *                            whether a WebGL effect mounts at all.
 *   useIsNarrowViewport    — *how much room is there, ACROSS* (51.25em). Gates layout.
 *   useIsShortViewport     — *how much room is there, DOWN*. Gates layout too, and it is a genuinely
 *                            separate axis rather than a proxy for the other one.
 *
 * The shape that forced this open is the **landscape phone: 932 × 430**. It is WIDER than the narrow
 * breakpoint, so `useIsNarrowViewport` says there is plenty of room and the full desktop layout
 * renders — into 430px of height. Every height problem on this site is currently invisible to the
 * only two questions it knows how to ask.
 *
 * ── Why 38em, and why only the contact section asks ──────────────────────────────────────────────
 * 608px is where the contact section runs out of room, measured rather than chosen: the section is
 * ONE pinned viewport with nothing below it to scroll to, and below this height its padding, the
 * action row and the five-row footer leave the form less than it needs even after the height-fluid
 * rhythm in `globals.css` has given everything it has. Past that the form moves into the sheet, whole
 * and unscrolled — the site's existing answer for copy with nowhere to go.
 *
 * Nothing else needs it. The dialog solves the same frame with the fluid rhythm alone (it has no
 * footer and no lead paragraph competing for the same pixels), and a bottom sheet is allowed to
 * scroll — it has a handle and a scrollbar that say so.
 *
 * The query string is the one in `globals.css`'s SHORT FRAMES block. It is duplicated here for the
 * reason `useIsNarrowViewport` gives: a media query cannot be read out of a stylesheet, so the only
 * alternative is JS and CSS disagreeing about where the layout changes. Keep them in step by hand.
 */
const SHORT_QUERY = '(max-height: 38em)';

export function useIsShortViewport(): boolean {
  // Starts false so the server render and the first client render agree — the same reasoning, and the
  // same safe direction, as `useIsNarrowViewport`: the tall layout is the one every section was
  // authored in, so a frame of it is a frame of something merely cramped.
  const [isShort, setIsShort] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(SHORT_QUERY);
    const sync = () => setIsShort(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return isShort;
}
