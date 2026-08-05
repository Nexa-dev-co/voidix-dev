import { useEffect, type RefObject } from 'react';

/**
 * The three things every full-screen layer on this site has to do: close on Escape, keep focus inside
 * itself, and — the one that is specific to this site — stop the pinned page moving underneath it.
 *
 * ── ⚠ THE GESTURE PROBLEM, WHICH IS NOT THE USUAL ONE ────────────────────────────────────────────
 * On most sites a modal only has to stop the BODY scrolling behind it. Here there is no body scroll to
 * speak of: the whole site is one pinned ScrollTrigger, and `useHeroAnimation` listens for `wheel` and
 * `touchmove` **on `window`**, stepping the carousel whenever the vertical travel passes
 * `TOUCH_STEP_THRESHOLD_PX`. `overflow: hidden` does nothing to that — the listener fires anyway.
 *
 * So a drag anywhere over an open layer would ALSO advance the section behind it, and closing the
 * layer would reveal somewhere you never chose to go. The fix is the one the FAQ panel already uses:
 * swallow the event before it reaches `window`. A layer of this kind covers the entire viewport while
 * it is open, so every wheel and every touch during that time starts inside it, and one
 * `stopPropagation` on its root covers all of them.
 *
 * `preventDefault` is deliberately NOT called: a layer with a scrolling region still has to scroll.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalLayerRefs {
  /** Covers the viewport while open — this is what the gestures are caught on. */
  rootRef: RefObject<HTMLElement | null>;
  /** The layer's focusable container. Focused on open; the trap cycles within it. */
  surfaceRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}

export function useModalLayer({ rootRef, surfaceRef, open, onClose }: ModalLayerRefs): void {
  useEffect(() => {
    const root = rootRef.current;
    const surface = surfaceRef.current;
    if (!root || !surface || !open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the surface itself rather than its first control: landing on a link reads to a screen
    // reader as "you are on a link", with no announcement of what just opened.
    surface.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Without the trap, Tab walks out of the layer and into the navbar behind it, where the focus
      // ring is invisible and Enter navigates the page out from under an open overlay.
      const focusable = Array.from(
        surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === surface)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const swallow = (event: Event) => event.stopPropagation();

    document.addEventListener('keydown', handleKeyDown);
    root.addEventListener('wheel', swallow, { passive: true });
    root.addEventListener('touchstart', swallow, { passive: true });
    root.addEventListener('touchmove', swallow, { passive: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      root.removeEventListener('wheel', swallow);
      root.removeEventListener('touchstart', swallow);
      root.removeEventListener('touchmove', swallow);
      // Only take focus back if it is still inside the layer — if something else has claimed it in the
      // meantime, yanking it back is worse than leaving it.
      if (previouslyFocused && surface.contains(document.activeElement)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, rootRef, surfaceRef, onClose]);
}
