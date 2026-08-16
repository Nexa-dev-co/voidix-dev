import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether a scroller has anything to scroll.
 *
 * ⚠ IT EXISTS FOR ONE PIECE OF PAINT. The enquiry form's sticky action bar carries a gradient to near
 * opaque `--card`, so form content passes UNDER the button instead of colliding with it. That is
 * correct while something is passing under; where nothing is, it stamps an opaque strip across the
 * bottom of a TRANSLUCENT panel and reads as a second box inside the first one. `.enquiry-actions`
 * already carries that warning for the contact panel, which is laid out to fit and therefore never
 * earned the fade — and since the application form became two steps (see EnquiryForm) the dialog is in
 * exactly the same position: it fits, so the fade would be painting over nothing.
 *
 * There is no CSS query for "is this box scrollable", so it is measured. The alternative considered and
 * rejected was a second `backdrop-filter` on the bar, which self-cancels over a uniform background but
 * lets blurred text slide under the button instead of hiding it.
 *
 * ⚠ It observes the CONTENT as well as the box. A step swap, a validation message appearing under a
 * field and a file name wrapping to two lines all change the content height without touching the
 * scroller's own size, and a ResizeObserver on the scroller alone sees none of them.
 */
export function useScrollOverflow(
  scrollRef: RefObject<HTMLElement | null>,
  /** Re-measured when this flips — a closed shell has no layout worth reading. */
  active: boolean,
): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !active) return;

    // A pixel of tolerance: sub-pixel layout routinely leaves scrollHeight a hair above clientHeight on
    // a box that has nothing to scroll, and a fade that appears on a fractional pixel is worse than none.
    const sync = () => setIsOverflowing(scroller.scrollHeight - scroller.clientHeight > 1);
    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);

    return () => observer.disconnect();
  }, [scrollRef, active]);

  return isOverflowing;
}
