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
 * ── Why 30em, and why only the contact section asks ──────────────────────────────────────────────
 * ⚠ THIS WAS 38em / 608px UNTIL 2026-08-15, AND THAT NUMBER WAS CATCHING ORDINARY LAPTOPS. 608px of
 * *viewport* is not a small screen: a 1366×768 or 1920×1080 laptop at 125% display scaling has roughly
 * 500–560px left once the browser's own chrome is subtracted. So the shape this hook was written for —
 * a phone held sideways — had quietly grown to include a large share of real desktops, and on every one
 * of them the contact section replaced its form with a button. A visitor who has scrolled the entire
 * site to reach the one place it asks for their details should not be asked to tap again.
 *
 * 480px is where the panel genuinely stops fitting, and getting there took three things rather than a
 * lowered number: below 38em the section's own rhythm gives ~40px AND Name and Mobile fold onto one
 * row, and the panel is bounded to the body it sits in so it can never climb under the navbar. ⚠ Note
 * the ORDER — the form keeps a field per row for as long as the section can pay for it out of its own
 * margins, and only spends a row when it cannot. Below 480px the sheet is still right: at a 430px
 * landscape phone the panel would be a ~200px slot, which is worse than a sheet that owns the frame.
 *
 * Nothing else needs it. The dialog solves the same frame with the fluid rhythm alone (it has no
 * footer and no lead paragraph competing for the same pixels), and a bottom sheet is allowed to
 * scroll — it has a handle and a scrollbar that say so.
 *
 * The query string is the one in `globals.css`'s SHORT FRAMES block. It is duplicated here for the
 * reason `useIsNarrowViewport` gives: a media query cannot be read out of a stylesheet, so the only
 * alternative is JS and CSS disagreeing about where the layout changes. Keep them in step by hand.
 */
const SHORT_QUERY = '(max-height: 30em)';

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
