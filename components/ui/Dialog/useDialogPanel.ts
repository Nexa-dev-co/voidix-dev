import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { useModalLayer } from '@/lib/hooks/useModalLayer';

/**
 * The dialog's behaviour — the wide-screen counterpart to `useDrawerSheet`.
 *
 * Escape, the focus trap and the gesture arbitration that stops the pinned page moving underneath it
 * all live in `useModalLayer`, shared with the bottom sheet and the navbar's orbit dial. What is left
 * here is the entrance, and it is deliberately small: a sheet is an object you throw around, a dialog
 * is a pane of glass that arrives.
 *
 * It settles UPWARD from slightly below and slightly small, which is the same arrival the sheet makes —
 * so a visitor who resizes across the breakpoint meets one motion language, not two.
 */

const OPEN_DURATION = 0.4;
const CLOSE_DURATION = 0.24;

/** How far below its resting place the panel starts, in px. Small: this is a settle, not a slide. */
const ENTRY_OFFSET = 18;
/** …and how much under full size. Subtle enough that the blur behind it never visibly re-scales. */
const ENTRY_SCALE = 0.97;

interface DialogPanelRefs {
  rootRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  scrimRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onClose: () => void;
}

export function useDialogPanel({
  rootRef,
  panelRef,
  scrimRef,
  open,
  onClose,
}: DialogPanelRefs): void {
  // ── 1. Open / close ──
  // Watches `open` and nothing else, so a re-render from anywhere can't replay the entrance.
  useEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!root || !panel || !scrim) return;

    const reduceMotion = prefersReducedMotion();

    if (open) {
      // ⚠ `data-active` is the HOOK's, and it is what the CSS makes the root visible by. `data-open` —
      // React's — cannot do that job: it flips to false the instant the close begins, so a root hidden
      // by it would take the panel off screen a frame before the fade had moved it, and the dialog
      // would blink out instead of leaving. This goes true here and false only when the close is done.
      root.dataset.active = 'true';
      gsap.fromTo(
        scrim,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: reduceMotion ? 0 : OPEN_DURATION, ease: 'power2.out' },
      );
      gsap.fromTo(
        panel,
        { autoAlpha: 0, y: ENTRY_OFFSET, scale: ENTRY_SCALE },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: reduceMotion ? 0 : OPEN_DURATION,
          // Overshoot-free but late-decelerating, matching the sheet. A back.out reads as bounce, which
          // this site's motion never does.
          ease: 'expo.out',
        },
      );
      return;
    }

    gsap.to(scrim, { autoAlpha: 0, duration: reduceMotion ? 0 : CLOSE_DURATION, ease: 'power2.in' });
    gsap.to(panel, {
      autoAlpha: 0,
      y: ENTRY_OFFSET * 0.6,
      scale: ENTRY_SCALE,
      duration: reduceMotion ? 0 : CLOSE_DURATION,
      ease: 'power2.in',
      onComplete: () => {
        // Only now is it safe to take the root out of the compositor — see the note on the open branch.
        root.dataset.active = 'false';
      },
    });
  }, [open, rootRef, panelRef, scrimRef]);

  // ── 2. Escape, focus, and the pin ──
  useModalLayer({ rootRef, surfaceRef: panelRef, open, onClose });
}
