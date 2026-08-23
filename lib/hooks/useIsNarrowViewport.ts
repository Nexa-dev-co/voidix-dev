import { useEffect, useState } from 'react';

/**
 * True when the viewport is at or below the site's main "narrow" breakpoint.
 *
 * ⚠ This is NOT `useIsLowPowerViewport`, and the two must not be confused. That one asks *how much
 * work can this device do* — a coarse pointer or a sub-760px window — and decides whether to mount a
 * WebGL effect at all. This one asks *how much room is there* and decides which LAYOUT to render. A
 * phone answers yes to both, which is exactly why it is worth keeping them apart: a narrow window on a
 * fast desktop wants the narrow layout and the full effects, and a tablet with a touch screen wants
 * the wide layout and the reduced ones.
 *
 * The query string is the one from `globals.css`. It is duplicated here because a media query cannot
 * be read out of a stylesheet, so the only alternative is JS and CSS disagreeing about where the
 * layout changes — which shows up as a stepper rendered into a grid meant for four columns. Keep them
 * in step by hand; there is one of each.
 */
/**
 * ⚠ EXPORTED, because the journey layer has to answer the SAME question this hook does.
 *
 * `cursor.ts` records which layout a heatmap was gathered on, and it must not re-derive that from a
 * pixel width: this query is in `em`, so it resolves against the visitor's own root font size — a
 * reader with large text switches layout at a different pixel width than 820. Comparing
 * `innerWidth > 820` in the panel would quietly misclassify exactly those visitors. Asking
 * `matchMedia` with this string asks the browser the same question the layout asked.
 */
export const NARROW_QUERY = '(max-width: 51.25em)';

export function useIsNarrowViewport(): boolean {
  // Starts false so the server render and the first client render agree — `window` doesn't exist during
  // SSR and reading it during render would hydration-mismatch. The effect corrects it before paint.
  //
  // Erring WIDE is the safe direction here: the wide layout is the one every section was authored in,
  // so a frame of it on a phone is a frame of something merely cramped. Erring narrow would flash a
  // stepper and a drawer button onto every desktop load.
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return isNarrow;
}
