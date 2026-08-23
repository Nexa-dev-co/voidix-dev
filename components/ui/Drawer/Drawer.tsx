'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDrawerSheet } from './useDrawerSheet';
import { DRAWER_OPEN_EVENT, type DrawerOpenDetail } from './drawerEvents';
import { useScrollGuard } from '@/lib/hooks/useScrollGuard';

/**
 * The site's bottom sheet — the phone's answer to copy that has nowhere to go.
 *
 * Every section past the hero is a single pinned viewport with a live WebGL scene behind it. On a
 * desktop there is room beside the subject for a paragraph and a set of tags; on a 390px phone there
 * is not, and the honest options are to cut the copy or to give it somewhere to live. This is the
 * somewhere. The screen keeps what identifies the thing you are looking at — a name, a date, a few
 * keys — and everything else is one tap away.
 *
 * ── ⚠ IT PORTALS TO `body`, AND THAT IS LOAD-BEARING ─────────────────────────────────────────────
 * The hero is pinned, and ScrollTrigger wraps a pinned section in a TRANSFORMED spacer — which makes
 * `position: fixed` inside it behave like `absolute`, so the sheet would scroll away with the page
 * instead of sitting on the glass. `FaqHologram` solves the same problem by living in `page.tsx`
 * outside the hero; this solves it with a portal, so a section can still own its own drawer instead of
 * hoisting the state to the page.
 *
 * ── No dependency ────────────────────────────────────────────────────────────────────────────────
 * This is deliberately not shadcn/vaul. CLAUDE.md rules out shadcn, Radix and Framer Motion, and the
 * one thing an off-the-shelf sheet could not have known about is the thing that actually matters here:
 * the pinned carousel steals vertical gestures off `window`. See `useDrawerSheet` for that.
 */

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Small uppercase kicker over the title — usually the item's index. */
  eyebrow?: string;
  /** Names the dialog for assistive tech, and heads the sheet. */
  title: string;
  /**
   * What this sheet is, for {@link DRAWER_OPEN_EVENT}.
   *
   * ⚠ NOT the title, and deliberately not defaulted to it. A title is visitor-facing copy the panel
   * can rewrite at any time, so keying anything off it would silently split one drawer's history in
   * two the first time an editor changed a word. Omit it and the listener labels the sheet with
   * whatever section the journey is standing in, which is right for the three that ARE their section.
   */
  journeyKey?: string;
  children: ReactNode;
}

export default function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  journeyKey,
  children,
}: DrawerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A portal needs a DOM to aim at, and there isn't one during SSR. Rendering nothing on the server and
  // on the first client render keeps the two agreeing, which is what hydration checks.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  // ⚠ Announced on the FALSE→TRUE edge only, which is what an effect keyed on `open` gives for free.
  // Every caller keeps this component mounted and flips the prop, so a dispatch on each render would
  // count a re-render of the section behind it as somebody opening the sheet.
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(
      new CustomEvent<DrawerOpenDetail>(DRAWER_OPEN_EVENT, { detail: { key: journeyKey } }),
    );
  }, [open, journeyKey]);

  useDrawerSheet({ rootRef, sheetRef, scrimRef, scrollRef, open, onClose });
  // The same guard the FAQ panel uses: a gesture that has scrolled this content keeps the rest of
  // itself, so reaching the end of a long answer mid-flick doesn't hand the remainder to the page.
  useScrollGuard(scrollRef);

  if (!isMounted) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="drawer-root"
      data-open={open}
      // Not `inert`/`hidden` here — the CSS takes it out of the compositor when closed, and the sheet's
      // own visibility is GSAP's (see useDrawerSheet). Keeping the node mounted is what lets the close
      // animation play at all.
      aria-hidden={!open}
    >
      <div ref={scrimRef} className="drawer-scrim" onClick={onClose} />

      <div
        ref={sheetRef}
        className="drawer-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {/* The grab handle. A real button as well as an affordance, so the sheet is dismissible without
            a swipe — on a desktop browser at a narrow width there is no finger to throw it with. */}
        <button
          type="button"
          className="drawer-handle"
          onClick={onClose}
          aria-label="Close"
          data-journey="Close the bottom sheet"
        >
          <span className="drawer-handle-bar" aria-hidden="true" />
        </button>

        <div ref={scrollRef} className="drawer-scroll">
          <header className="drawer-head">
            {eyebrow && <p className="eyebrow drawer-eyebrow">{eyebrow}</p>}
            <p className="drawer-title font-display">{title}</p>
          </header>

          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
