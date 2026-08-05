'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { NAV_ITEMS } from '../navItems';
import { ARC_VIEW_BOX, arcPath, stationOffset } from './orbitGeometry';
import { useOrbitFan } from './useOrbitFan';

/**
 * The orbit fan — the phone's navigation, and a gesture rather than a menu.
 *
 * ── What it is ───────────────────────────────────────────────────────────────────────────────────
 * Tap the mark in the navbar and four facets swing out beneath it. Tap one and you travel; tap anywhere
 * else, or press Escape, and it folds away.
 *
 *        ●  ← tapped
 *         ╲
 *      ╲   ╲          each facet is one section
 *   ╲   ╲               the one you are IN glows amber
 *  ╲                    the one under a POINTER lights up
 *
 * The shape is an octagon's language — flat facets, hard turns, ends that never close — rather than a
 * circle's, because a ring implies you can keep going round and this is a fan that opens.
 *
 * ⚠ It was a hold-and-drag gesture until it met a real phone. `useOrbitDial`'s header has the three
 * reasons it changed, and — more usefully — why the protection that gesture existed to provide is still
 * intact under a tap. Read that before proposing either direction again.
 *
 * ── It portals to `body` ─────────────────────────────────────────────────────────────────────────
 * ScrollTrigger wraps the pin in a TRANSFORMED spacer, which turns `position: fixed` inside the hero
 * into something that behaves like `absolute`. Same reason `FaqHologram` lives outside the hero.
 *
 * The geometry — where each facet sits, how long it is drawn, which one a pointer is over — is all in
 * `orbitGeometry.ts`, so the drawing and the hit-testing cannot drift apart.
 */

interface OrbitDialProps {
  open: boolean;
  /** The facet the pointer is over right now, or null. */
  activeIndex: number | null;
  /** The section the visitor is actually in — the one that glows. */
  currentIndex: number | null;
  /** Pivot in viewport px, and the design-unit scale, both from the dial hook. */
  pivotX: number;
  pivotY: number;
  scale: number;
  onSelect: (index: number) => void;
  /** Reports which facet is under a pointer, or null. Nothing calls it on a touch screen. */
  onArm: (index: number | null) => void;
  onClose: () => void;
}

export default function OrbitDial({
  open,
  activeIndex,
  currentIndex,
  pivotX,
  pivotY,
  scale,
  onSelect,
  onArm,
  onClose,
}: OrbitDialProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fanRef = useRef<HTMLDivElement>(null);

  // A portal needs a DOM to aim at, and there isn't one during SSR.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  useOrbitFan({ rootRef, fanRef, open, onClose });

  if (!isMounted) return null;

  return createPortal(
    <div ref={rootRef} className="orbit-root" data-open={open} aria-hidden={!open}>
      {/* ⚠ A radial darkening centred on the pivot, NOT a flat scrim — the scene stays legible out at
          the far corners. You are handed an instrument OVER the thing you came to look at, not sent to
          a different screen. */}
      <div
        className="orbit-scrim"
        onClick={onClose}
        style={{ '--pivot-x': `${pivotX}px`, '--pivot-y': `${pivotY}px` } as CSSProperties}
      />

      <div
        ref={fanRef}
        className="orbit-fan"
        // `group`, not `menu`: a menu promises arrow-key roving focus, and this manages Tab (through
        // useModalLayer) rather than arrows. Claiming the richer role and not honouring it is worse
        // for a screen reader than claiming the plain one.
        role="group"
        aria-label="Sections"
        tabIndex={-1}
        style={
          {
            '--pivot-x': `${pivotX}px`,
            '--pivot-y': `${pivotY}px`,
            '--fan-scale': scale,
          } as CSSProperties
        }
      >
        {/* The trajectory. Drawn in design units and scaled by CSS, so a resize costs a variable and
            never a rebuilt path. It starts at the mark by construction and runs past the last station —
            an orbit that stops exactly where its contents do reads as a bracket, not as a path. */}
        <svg
          className="orbit-arc"
          viewBox={`${ARC_VIEW_BOX.x} ${ARC_VIEW_BOX.y} ${ARC_VIEW_BOX.width} ${ARC_VIEW_BOX.height}`}
          aria-hidden="true"
        >
          <defs>
            {/* Brightest where it leaves the mark, fading as it falls away — the trajectory reads as
                drawn BY something rather than as a rail something sits on.

                ⚠ The colours are set in CSS, not here. `var()` does NOT resolve inside an SVG
                presentation attribute, so `stopColor="rgb(var(--accent-rgb))"` silently computes to
                black and the arc vanishes. As a CSS *property* on a class, `stop-color` takes it
                fine. */}
            <linearGradient id="orbit-arc-fade" x1="1" y1="0" x2="0" y2="1">
              <stop className="orbit-arc-stop--near" offset="0%" />
              <stop className="orbit-arc-stop--mid" offset="45%" />
              <stop className="orbit-arc-stop--far" offset="100%" />
            </linearGradient>
          </defs>
          <path className="orbit-arc-line" d={arcPath()} />
        </svg>

        {NAV_ITEMS.map((navItem, index) => {
          const offset = stationOffset(index);
          return (
            <button
              key={navItem.key}
              type="button"
              className="orbit-station"
              // Both states are separate on purpose: `current` is where you ARE and glows constantly;
              // `armed` is where you are POINTING and lights only while a pointer is on it. The section
              // you are already in can be both at once, and it should look like it.
              data-current={index === currentIndex}
              data-armed={index === activeIndex}
              onClick={() => onSelect(index)}
              // Hover, in effect — but written as pointer events so a mouse in a narrow window gets the
              // highlight while a finger, which hovers over nothing, simply never fires them.
              onPointerEnter={() => onArm(index)}
              onPointerLeave={() => onArm(null)}
              style={
                {
                  '--station-x': `${offset.x}`,
                  '--station-y': `${offset.y}`,
                } as CSSProperties
              }
            >
              {/* The node sits ON the arc; the row hangs to its left, which is where the free space is
                  when the mark is in the top-right corner. */}
              <span className="orbit-node" aria-hidden="true" />
              <span className="orbit-row">
                <span className="orbit-row-dot" aria-hidden="true" />
                <span className="orbit-row-tail" aria-hidden="true" />
                <span className="orbit-row-text">
                  <span className="orbit-row-number">{navItem.number}</span>
                  <span className="orbit-row-label font-display">{navItem.label}</span>
                </span>
                <span className="orbit-row-leader" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
