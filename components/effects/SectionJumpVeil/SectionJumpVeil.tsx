'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { findNavItem } from '@/components/layout/Navbar/navItems';
import {
  JUMP_ARRIVED_EVENT,
  JUMP_BEGIN_EVENT,
  JUMP_COVERED_EVENT,
  SECTION_ARRIVE_EVENT,
  readJumpBegin,
  type SectionArriveDetail,
} from '@/lib/sectionJumpEvents';

/**
 * The cover a long navbar jump travels behind.
 *
 * ── The gesture ──────────────────────────────────────────────────────────────────────────────────
 * Black grows out of the label you pressed until it owns the frame; the destination's name sits
 * there while the site travels; then a hole opens at that same point and the new section expands out
 * of it. The site folds into the thing you clicked and unfolds from it — which is the difference
 * between a transition and a wipe: it has a cause.
 *
 * Deliberately NOT `LoopVeil`'s liquid cream flood. That gesture means "you have come back round to
 * the beginning"; this one means "you have been taken somewhere". Two meanings, two gestures.
 *
 * ── One mask, two forms ──
 * Both halves are the same `radial-gradient` mask on one element, differing only in which side of the
 * radius is opaque — a disc that grows (cover), then a hole that grows (uncover). They meet exactly:
 * a full-radius disc and a zero-radius hole are both "entirely black", so the switch between them at
 * the top of the hold is invisible by construction rather than by matching two timings.
 *
 * DOM and CSS, no WebGL — exactly as `LoopVeil` is, and for a sharper reason: a jump can be holding
 * here while the works field compiles the chamber underneath, and a third GL context is the last
 * thing wanted on that frame.
 *
 * ── The handshake ──
 * Three signals and no shared durations (see lib/sectionJumpEvents.ts). Nothing here knows how long
 * the journey takes; nothing over there knows how long this takes.
 *
 *   JUMP_BEGIN    the pin has NOT moved. Close.
 *   JUMP_COVERED  ...fired from here, when the black actually owns the frame. Only then does it glide.
 *   JUMP_ARRIVED  the pin has settled on the destination. Open.
 */

/** Black grows out of the clicked label until it owns the frame. */
const COLLAPSE_SECONDS = 0.55;
/** The card arrives late in the collapse, so it is never legible over the page it is covering. */
const CARD_IN_AT_SECONDS = 0.34;
const CARD_IN_SECONDS = 0.35;
const CARD_IN_LIFT_PX = 16;
/** ...and leaves before the hole opens, so it is never caught hanging over the new section. */
const CARD_OUT_SECONDS = 0.26;
const CARD_OUT_LIFT_PX = -20;
const CARD_LINE_STAGGER = 0.06;
/** The hole opens at the same point, and the destination expands out of it. */
const UNFOLD_SECONDS = 0.7;
/**
 * How much of the radius the mask holds solid before feathering to the other side, as a percentage.
 *
 * Not 100: a hard stop aliases into a visibly stepped circle on a full-screen element, and the few
 * percent of softness costs nothing and reads as an edge with depth rather than a cut.
 */
const MASK_EDGE_PERCENT = 92;
/**
 * Reduced motion gets the cover but not the theatre — a plain cut each way. The jump underneath is
 * unchanged: this is about the growing circle being involuntary motion, not about the navigation.
 */
const REDUCED_FADE_SECONDS = 0.15;

/**
 * A little past the furthest corner, so the last thing covered is genuinely off-frame.
 *
 * The margin is not fussiness: the radius is measured once when the tween is built, and a phone's
 * address bar sliding away mid-jump grows the viewport under it. Exactly-to-the-corner would leave a
 * lit sliver at the edge on the frame that matters most.
 */
const COVER_RADIUS_OVERSHOOT = 1.08;

/** Furthest corner from a point — the radius at which a disc centred there covers the viewport. */
const radiusToCover = (originX: number, originY: number) => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return (
    Math.max(
      Math.hypot(originX, originY),
      Math.hypot(width - originX, originY),
      Math.hypot(originX, height - originY),
      Math.hypot(width - originX, height - originY),
    ) * COVER_RADIUS_OVERSHOOT
  );
};

export default function SectionJumpVeil() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // The destination's own name, so the hold says where you are going rather than merely waiting.
  const [destination, setDestination] = useState<{ number: string; label: string } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const fill = fillRef.current;
    const card = cardRef.current;
    if (!root || !fill || !card) return;

    let timeline: gsap.core.Timeline | null = null;
    // Where the current jump is folding into. Held across both halves — the hole must open at the
    // same point the disc grew from, or the gesture stops being one move and becomes two.
    let originX = window.innerWidth / 2;
    let originY = window.innerHeight / 2;
    const maskRadius = { value: 0 };
    /** Which section this jump is for, so the opening can tell it to play its entrance. */
    let destinationKey = '';

    const announceArrival = () => {
      window.dispatchEvent(
        new CustomEvent<SectionArriveDetail>(SECTION_ARRIVE_EVENT, {
          detail: { key: destinationKey },
        }),
      );
    };

    /**
     * `hole = false` — opaque INSIDE the radius: a black disc growing over the page.
     * `hole = true`  — opaque OUTSIDE it: a window opening onto the page.
     */
    const applyMask = (hole: boolean) => {
      const inner = hole ? 'transparent' : '#000';
      const outer = hole ? '#000' : 'transparent';
      const image =
        `radial-gradient(circle ${maskRadius.value}px at ${originX}px ${originY}px, ` +
        `${inner} ${MASK_EDGE_PERCENT}%, ${outer} 100%)`;
      fill.style.setProperty('mask-image', image);
      fill.style.setProperty('-webkit-mask-image', image);
    };

    const cardLines = () => Array.from(card.children) as HTMLElement[];

    const onJumpBegin = (event: Event) => {
      const request = readJumpBegin(event);
      if (!request) return;
      timeline?.kill();

      destinationKey = request.key;
      const navItem = findNavItem(request.key);
      setDestination(navItem ? { number: navItem.number, label: navItem.label } : null);

      // No origin means nothing was clicked (a programmatic request, or an item off-screen on a
      // narrow viewport). The middle of the frame is the honest answer — it belongs to no control, so
      // it reads as the page itself folding rather than as folding into the wrong thing.
      originX = request.origin?.x ?? window.innerWidth / 2;
      originY = request.origin?.y ?? window.innerHeight / 2;

      root.classList.add('is-covering');
      // Staged hidden HERE rather than by the entrance's `from` values: a `fromTo` only applies those
      // when it starts, and this one starts a third of a second in — the lines would be sitting at
      // full opacity over the page you are still looking at until then.
      gsap.set(card, { autoAlpha: 1 });
      gsap.set(cardLines(), { autoAlpha: 0, y: CARD_IN_LIFT_PX });

      if (prefersReducedMotion()) {
        maskRadius.value = radiusToCover(originX, originY);
        applyMask(false);
        timeline = gsap.timeline({
          onComplete: () => window.dispatchEvent(new Event(JUMP_COVERED_EVENT)),
        });
        timeline.to(fill, { autoAlpha: 1, duration: REDUCED_FADE_SECONDS, ease: 'none' }, 0);
        timeline.set(cardLines(), { autoAlpha: 1, y: 0 }, 0);
        return;
      }

      maskRadius.value = 0;
      applyMask(false);
      gsap.set(fill, { autoAlpha: 1 });

      timeline = gsap.timeline({
        // Announced when the black genuinely owns the frame — not when the card has finished
        // arriving, which is decoration and can happen while the site is already travelling.
        onComplete: () => window.dispatchEvent(new Event(JUMP_COVERED_EVENT)),
      });
      timeline.to(
        maskRadius,
        {
          value: radiusToCover(originX, originY),
          duration: COLLAPSE_SECONDS,
          ease: 'power2.inOut',
          onUpdate: () => applyMask(false),
        },
        0,
      );
      timeline.to(
        cardLines(),
        {
          autoAlpha: 1,
          y: 0,
          duration: CARD_IN_SECONDS,
          stagger: CARD_LINE_STAGGER,
          ease: 'power3.out',
        },
        CARD_IN_AT_SECONDS,
      );
    };
    window.addEventListener(JUMP_BEGIN_EVENT, onJumpBegin);

    const onJumpArrived = () => {
      timeline?.kill();

      if (prefersReducedMotion()) {
        timeline = gsap.timeline({
          onComplete: () => root.classList.remove('is-covering'),
        });
        timeline.to(fill, { autoAlpha: 0, duration: REDUCED_FADE_SECONDS, ease: 'none' }, 0);
        timeline.set(cardLines(), { autoAlpha: 0 }, 0);
        timeline.call(announceArrival, undefined, 0);
        return;
      }

      // A full-radius disc and a zero-radius hole are the same picture — entirely black — so this
      // swap is invisible without either half having to know the other's timing.
      maskRadius.value = 0;
      applyMask(true);

      timeline = gsap.timeline({
        onComplete: () => root.classList.remove('is-covering'),
      });
      timeline.to(
        cardLines(),
        {
          autoAlpha: 0,
          y: CARD_OUT_LIFT_PX,
          duration: CARD_OUT_SECONDS,
          stagger: CARD_LINE_STAGGER,
          ease: 'power3.in',
        },
        0,
      );
      timeline.to(
        maskRadius,
        {
          value: radiusToCover(originX, originY),
          duration: UNFOLD_SECONDS,
          ease: 'power2.inOut',
          onUpdate: () => applyMask(true),
        },
        CARD_OUT_SECONDS * 0.6,
      );
      // On the same beat the hole starts opening, so the section assembles THROUGH the reveal rather
      // than behind it. See SECTION_ARRIVE_EVENT.
      timeline.call(announceArrival, undefined, CARD_OUT_SECONDS * 0.6);
    };
    window.addEventListener(JUMP_ARRIVED_EVENT, onJumpArrived);

    return () => {
      window.removeEventListener(JUMP_BEGIN_EVENT, onJumpBegin);
      window.removeEventListener(JUMP_ARRIVED_EVENT, onJumpArrived);
      timeline?.kill();
    };
  }, []);

  return (
    <div ref={rootRef} className="section-jump-veil" aria-hidden>
      <div ref={fillRef} className="section-jump-veil-fill" />
      {/* A SIBLING of the fill, never a child: the mask applies to the whole element it is set on, so
          a card inside it would be eaten by the same hole that reveals the page. */}
      <div ref={cardRef} className="section-jump-card">
        <span className="eyebrow section-jump-card-number">{destination?.number ?? ''}</span>
        <span className="font-display section-jump-card-label">{destination?.label ?? ''}</span>
      </div>
    </div>
  );
}
