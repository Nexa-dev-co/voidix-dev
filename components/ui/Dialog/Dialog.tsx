'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogPanel } from './useDialogPanel';
import { useScrollOverflow } from './useScrollOverflow';
import { useScrollGuard } from '@/lib/hooks/useScrollGuard';

/**
 * The site's centred modal — what the bottom sheet becomes when there is room for one.
 *
 * ── It is GLASS, and that is the point ───────────────────────────────────────────────────────────
 * Every section past the hero is a live WebGL scene, and the reason anyone is on this page is what that
 * scene is doing. A solid panel dropped over the fleet would black out the craft the visitor just
 * asked about. So the panel is translucent and blurs what is behind it: the ship keeps turning, out of
 * focus, underneath the form about itself. Same reasoning as the sheet's non-solid scrim.
 *
 * ── ⚠ IT PORTALS TO `body`, AND THAT IS LOAD-BEARING ─────────────────────────────────────────────
 * The hero is pinned, and ScrollTrigger wraps a pinned section in a TRANSFORMED spacer — which makes
 * `position: fixed` inside it behave like `absolute`, so the dialog would scroll away with the page
 * instead of sitting on the glass. Identical to `Drawer`; see its header for the full story.
 */

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Small uppercase kicker over the title — usually the item this was opened from. */
  eyebrow?: string;
  /** Names the dialog for assistive tech, and heads the panel. */
  title: string;
  /**
   * Widens the panel from 34rem to 40rem, which is what buys the application form its second column.
   * Four fields fit a narrow panel; seven do not.
   */
  wide?: boolean;
  children: ReactNode;
}

export default function Dialog({
  open,
  onClose,
  eyebrow,
  title,
  wide = false,
  children,
}: DialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A portal needs a DOM to aim at, and there isn't one during SSR. Rendering nothing on the server and
  // on the first client render keeps the two agreeing, which is what hydration checks.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  useDialogPanel({ rootRef, panelRef, scrimRef, open, onClose });
  // The same guard the sheet and the FAQ panel use: a gesture that has scrolled this content keeps the
  // rest of itself, so reaching the end of the form mid-flick doesn't hand the remainder to the pin.
  useScrollGuard(scrollRef);
  // Only paints the sticky action bar's fade where content actually passes under it — see the hook.
  const isOverflowing = useScrollOverflow(scrollRef, open);

  if (!isMounted) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="dialog-root"
      data-open={open}
      // Not `inert`/`hidden` here — the CSS takes it out of the compositor when closed, and the panel's
      // own visibility is GSAP's (see useDialogPanel). Keeping the node mounted is what lets the close
      // animation play at all.
      aria-hidden={!open}
    >
      <div ref={scrimRef} className="dialog-scrim" onClick={onClose} />

      <div
        ref={panelRef}
        className="dialog-panel"
        data-wide={wide}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <button
          type="button"
          className="dialog-close"
          onClick={onClose}
          aria-label="Close"
          data-journey="Close the dialog"
        >
          <CloseGlyph />
        </button>

        {/* ⚠ The head sits OUTSIDE the scroller on purpose. It used to be the first thing inside it, so
            on any panel whose content overflowed — which is every application form on a laptop — the
            title scrolled away and the visitor lost the name of the thing they were filling in. */}
        <header className="dialog-head">
          {eyebrow && <p className="eyebrow dialog-eyebrow">{eyebrow}</p>}
          <p className="dialog-title font-display">{title}</p>
        </header>

        <div ref={scrollRef} className="dialog-scroll" data-overflowing={isOverflowing}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CloseGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M2.5 2.5l8 8M10.5 2.5l-8 8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
