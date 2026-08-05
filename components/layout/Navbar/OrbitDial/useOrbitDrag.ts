import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { currentSectionIndex, fanScale, stationFromPointer } from './orbitGeometry';

/**
 * Press, hold, drag, release — the fan's whole interaction.
 *
 * ── The rule, and it is deliberate ───────────────────────────────────────────────────────────────
 * Releasing anywhere that is NOT a facet navigates nowhere. This control cannot be triggered by
 * accident, which matters more here than on most sites: every destination is a scrubbed cinematic
 * several seconds long, and a mis-tap does not cost you a page load, it costs you the journey.
 *
 * ── The one accommodation, and why it does not break that rule ───────────────────────────────────
 * A press that never MOVED latches the fan open instead of closing it. A pure hold-and-drag control is
 * unusable with a keyboard, unreachable by anyone who cannot hold a drag steady, and invisible to a
 * mouse user who expects a click to do something. Latching still navigates nowhere — you then tap the
 * facet you want — so "release without dragging does nothing" holds exactly as stated. What it buys is
 * that the control is operable at all without the gesture.
 *
 * ── Why the pointer is tracked on `window` and not on the fan ────────────────────────────────────
 * The press begins on the toggle in the navbar and ends somewhere out over the page, so no single
 * element sees the whole gesture. `setPointerCapture` on the toggle would keep the events coming, but
 * it also swallows them from everything else — including the facets' own hover states. Tracking on
 * `window` and hit-testing by angle needs neither.
 */

/** Movement under this (px) counts as a tap rather than a drag, and latches the fan open. */
const TAP_MOVEMENT_PX = 8;

interface OrbitDragOptions {
  /** Where the fan pivots from — the toggle in the navbar. */
  toggleRef: React.RefObject<HTMLElement | null>;
  onSelect: (index: number, origin: HTMLElement) => void;
}

export interface OrbitDragState {
  isOpen: boolean;
  /** The facet the pointer is currently over, or null. Drives the highlight. */
  activeIndex: number | null;
  /** The section the visitor is actually in — the one that glows. */
  currentIndex: number | null;
  /** Pivot in viewport px, and the design-unit scale. Published so the fan draws on the same numbers. */
  pivotX: number;
  pivotY: number;
  scale: number;
  handleTogglePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  selectStation: (index: number) => void;
  close: () => void;
}

export function useOrbitDrag({ toggleRef, onSelect }: OrbitDragOptions): OrbitDragState {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [pivot, setPivot] = useState({ x: 0, y: 0, scale: 1 });

  // Live values the window listeners read. They are refs rather than state because the listeners are
  // bound once for the life of a gesture and would otherwise close over the first render's values.
  const pivotRef = useRef({ x: 0, y: 0, scale: 1 });
  const activeIndexRef = useRef<number | null>(null);
  const startPointRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const draggingRef = useRef(false);

  const close = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(null);
    activeIndexRef.current = null;
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

  const handleTogglePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const toggle = toggleRef.current;
      if (!toggle) return;
      // The browser's own drag/selection would otherwise fight the gesture from the first pixel.
      event.preventDefault();

      const rect = toggle.getBoundingClientRect();
      const nextPivot = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        scale: fanScale(window.innerWidth, window.innerHeight),
      };
      pivotRef.current = nextPivot;
      setPivot(nextPivot);

      startPointRef.current = { x: event.clientX, y: event.clientY };
      movedRef.current = false;
      draggingRef.current = true;
      activeIndexRef.current = null;

      // Read once, here: the fan swallows the gestures that could move the page, so the section the
      // visitor is in cannot change while it is open.
      setCurrentIndex(currentSectionIndex());
      setActiveIndex(null);
      setIsOpen(true);
    },
    [toggleRef],
  );

  // The gesture. Bound only while a press is live, so a closed fan costs nothing.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      const { x, y, scale } = pivotRef.current;

      if (
        Math.hypot(event.clientX - startPointRef.current.x, event.clientY - startPointRef.current.y) >
        TAP_MOVEMENT_PX
      ) {
        movedRef.current = true;
      }

      const next = stationFromPointer(event.clientX - x, event.clientY - y, scale);
      if (next !== activeIndexRef.current) {
        activeIndexRef.current = next;
        setActiveIndex(next);
      }
    };

    const handlePointerUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;

      const landed = activeIndexRef.current;
      if (landed !== null) {
        selectStation(landed);
        return;
      }
      // Released off every facet. A real drag that ended nowhere is a deliberate cancel — close. A
      // press that never moved is someone who wants to look before choosing — latch it open.
      if (movedRef.current) close();
      else setActiveIndex(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isOpen, close, selectStation]);

  // A resize mid-gesture would leave the drawn fan and the hit-testing on different radii.
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
    handleTogglePointerDown,
    selectStation,
    close,
  };
}
