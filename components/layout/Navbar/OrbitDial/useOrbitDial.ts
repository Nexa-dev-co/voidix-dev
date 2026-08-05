import { useCallback, useEffect, useRef, useState } from 'react';
import { currentSectionIndex, fanScale } from './orbitGeometry';

/**
 * The dial's state: whether it is open, which facet is lit, and where the fan pivots from.
 *
 * ── ⚠ IT IS A TAP NOW, AND THAT IS A DELIBERATE REVERSAL ─────────────────────────────────────────
 * This began as press-hold-drag-release: hold the mark, sweep to a facet, let go. The reasoning was
 * sound on paper — every destination here is a scrubbed cinematic several seconds long, so a control
 * that cannot fire by accident is worth something — but it did not survive contact with a phone:
 *
 *   · A hold competes with the platform's own long-press. Both iOS and Android are waiting on that same
 *     gesture for text selection, the callout menu and drag-to-reorder, and the ones we did not
 *     suppress fired over the top of the fan.
 *   · Nothing on a screen says "hold me". The bar reads "Navigate ⊙"; a visitor taps it, gets the latch
 *     behaviour that existed only as an accessibility accommodation, and has now learned the control by
 *     accident rather than by design.
 *   · A sweep along an arc is a fine motor gesture on a surface with no friction feedback. Releasing
 *     between two facets did nothing, correctly, and read as the control being broken.
 *
 * ⚠ THE MIS-TAP PROTECTION IS NOT LOST, which is the thing to check before "simplifying" this further.
 * It still takes TWO deliberate taps to commit a journey — one to open the fan, one to choose — and the
 * second lands on a 44px target that only exists while the fan is up. That is the same number of
 * intentional acts the drag required; what changed is that both of them are the gesture every visitor
 * already has.
 *
 * The facet under a POINTER still lights (`armStation`), which is what a mouse in a narrow window
 * expects. On a touch screen nothing hovers, so nothing lights until it is pressed — correct in both
 * cases, and it costs one callback.
 */

interface OrbitDialOptions {
  /** Where the fan pivots from — the toggle in the navbar. */
  toggleRef: React.RefObject<HTMLElement | null>;
  onSelect: (index: number, origin: HTMLElement) => void;
}

export interface OrbitDialState {
  isOpen: boolean;
  /** The facet the pointer is over, or null. Drives the highlight. */
  activeIndex: number | null;
  /** The section the visitor is actually in — the one that glows. */
  currentIndex: number | null;
  /** Pivot in viewport px, and the design-unit scale. Published so the fan draws on the same numbers. */
  pivotX: number;
  pivotY: number;
  scale: number;
  toggle: () => void;
  armStation: (index: number | null) => void;
  selectStation: (index: number) => void;
  close: () => void;
}

export function useOrbitDial({ toggleRef, onSelect }: OrbitDialOptions): OrbitDialState {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [pivot, setPivot] = useState({ x: 0, y: 0, scale: 1 });

  // The resize handler is bound once for the life of an open fan and would otherwise close over the
  // pivot as it was on the render that opened it.
  const pivotRef = useRef({ x: 0, y: 0, scale: 1 });

  const close = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(null);
  }, []);

  const selectStation = useCallback(
    (index: number) => {
      const origin = toggleRef.current;
      if (!origin) return;
      close();
      onSelect(index, origin);
    },
    [close, onSelect, toggleRef],
  );

  const armStation = useCallback((index: number | null) => setActiveIndex(index), []);

  const toggle = useCallback(() => {
    const toggleElement = toggleRef.current;
    if (!toggleElement) return;

    if (isOpen) {
      close();
      return;
    }

    // Measured on the way open rather than held in state: the bar is fixed, but its mark moves with a
    // resize and with the navbar's own entrance, and a stale pivot swings the fan out of thin air.
    const rect = toggleElement.getBoundingClientRect();
    const nextPivot = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      scale: fanScale(window.innerWidth, window.innerHeight),
    };
    pivotRef.current = nextPivot;
    setPivot(nextPivot);

    // Read once, here: the fan swallows the gestures that could move the page, so the section the
    // visitor is in cannot change while it is open.
    setCurrentIndex(currentSectionIndex());
    setActiveIndex(null);
    setIsOpen(true);
  }, [close, isOpen, toggleRef]);

  // A resize with the fan up would leave the drawn arc and the facets on different radii.
  useEffect(() => {
    if (!isOpen) return;
    const handleResize = () => {
      const next = { ...pivotRef.current, scale: fanScale(window.innerWidth, window.innerHeight) };
      pivotRef.current = next;
      setPivot(next);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  return {
    isOpen,
    activeIndex,
    currentIndex,
    pivotX: pivot.x,
    pivotY: pivot.y,
    scale: pivot.scale,
    toggle,
    armStation,
    selectStation,
    close,
  };
}
