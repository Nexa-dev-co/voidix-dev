import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { SECTION_ARRIVE_EVENT, readSectionArriveKey } from '@/lib/sectionJumpEvents';

/**
 * Play a section's contents in when a covered nav jump lands on it.
 *
 * ── Why a section needs this at all ──────────────────────────────────────────────────────────────
 * Everything past the hero is faded in by its crossing, and a covered jump scrubs those crossings to
 * their final values while the cover is down. So by the time the hole opens the section is simply
 * THERE, fully formed, having assembled where nobody could see it. Scrolling to it never had that
 * problem — the crossing is the entrance, and you watch it.
 *
 * ── Why a profile and not one gesture ────────────────────────────────────────────────────────────
 * Three sections arriving identically is three sections saying nothing. Each one already has its own
 * physics and the arrival is the cheapest place to speak it:
 *
 *   formation  the fleet locks into place — crisp, tight, each block in from its own side
 *   settle     material comes to rest on the stone — a rise, and the display lines TIGHTEN, their
 *              letter-spacing closing from wide as if the words were accreting like the mark does
 *   gravity    everything is drawn toward the middle of the frame, which is where the black hole is.
 *              Slow, heavy, settling out of a slight overscale rather than being placed
 *
 * The profile fixes the timing and the character; the groups fix which way each block travels. A
 * section therefore declares its arrival in a few lines and nothing here knows its structure.
 *
 * ── Why the chamber has none ──
 * It already has one. `FaqHologram` unseals on `CHAMBER_HOLOGRAM_EVENT` and staggers its own rows
 * (`holo-stagger`); a second gesture over the top would fight it.
 *
 * ⚠ In works this animates the same elements as `useWorksTextTransition`, and `overwrite: true` below
 * is what keeps them from fighting. Committing the target stop up front means the project change fires
 * at the START of the glide, so its shear is typically still running when the cover opens — the
 * arrival kills it, and a killed tween never applies its `clearProps`, which is what would otherwise
 * snap the transform out from under this one mid-flight. The margin is real (the shear leads by ~0.8s,
 * a covered glide runs 1.5s+) but it is a margin, so do not remove the overwrite.
 */

export type ArrivalProfile = 'formation' | 'settle' | 'gravity';
/** Which edge a block travels IN FROM — so `left` starts left of its resting place and moves right. */
export type ArrivalFrom = 'top' | 'bottom' | 'left' | 'right';

interface ProfileSpec {
  /** How far a block travels, in px. Small: this is a settle, not an entrance from off-screen. */
  travelPixels: number;
  durationSeconds: number;
  /** Between the lines of one group. */
  staggerSeconds: number;
  /** Between one group and the next, so the blocks arrive in order rather than as a slab. */
  groupDelaySeconds: number;
  ease: string;
  /** Scale it settles OUT of. 1 disables it. */
  fromScale: number;
  /**
   * Extra letter-spacing, in em, that display lines open with and close from — but only on groups
   * that ask for it (`tighten`). Never put this on a list or on body copy: letter-spacing is not
   * compositor-accelerated, so every frame of it is a layout pass on the element's whole line box.
   */
  tightenEm: number;
}

const ARRIVAL_PROFILES: Record<ArrivalProfile, ProfileSpec> = {
  // A fleet does not drift into position, it locks into it.
  formation: {
    travelPixels: 34,
    durationSeconds: 0.62,
    staggerSeconds: 0.05,
    groupDelaySeconds: 0.08,
    ease: 'power4.out',
    fromScale: 1,
    tightenEm: 0.14,
  },
  // Stone coming to rest: it falls a little way and stops dead.
  settle: {
    travelPixels: 22,
    durationSeconds: 0.75,
    staggerSeconds: 0.07,
    groupDelaySeconds: 0.06,
    ease: 'power3.out',
    fromScale: 1,
    tightenEm: 0.16,
  },
  // Being pulled in by something heavy — further to travel, slower, and it eases down out of a slight
  // overscale rather than arriving at its final size.
  gravity: {
    travelPixels: 46,
    durationSeconds: 1.05,
    staggerSeconds: 0.09,
    groupDelaySeconds: 0.1,
    ease: 'power2.out',
    fromScale: 1.04,
    tightenEm: 0,
  },
};

export interface ArrivalGroup {
  /** Resolved inside the container, and matched in DOCUMENT order so the stagger reads top-to-bottom. */
  selector: string;
  /** Defaults to `bottom` — a plain rise. */
  from?: ArrivalFrom;
  /** Display lines only. See `tightenEm`. */
  tighten?: boolean;
}

interface SectionArrivalOptions {
  /** The carousel section key this entrance belongs to — 'services' | 'work' | 'contact'. */
  sectionKey: string;
  /** The section's root. Nothing outside it is ever touched. */
  containerRef: RefObject<HTMLElement | null>;
  profile: ArrivalProfile;
  groups: readonly ArrivalGroup[];
}

/**
 * Below this the site's layouts stack — it is the shared `@media (max-width: 51.25em)` breakpoint in
 * px. Two things change there, both for correctness rather than taste:
 *
 *  · **All travel goes vertical.** A stacked block is the full width of the frame, so translating it
 *    46px sideways pushes it past the edge and the BODY gains a horizontal scrollbar mid-animation.
 *    Coming up from below reads the same on a stacked layout anyway.
 *  · **Nothing tightens.** Letter-spacing changes the width of a line, and on a narrow frame a display
 *    line sitting near its wrap point will take an extra row while it is open and lose it again on the
 *    way in — the whole block jumping a line height as it lands.
 */
const NARROW_VIEWPORT_MAX_PX = 820;

/** Where a block starts, relative to where it belongs. */
const travelOffset = (from: ArrivalFrom, travelPixels: number) => {
  if (from === 'left') return { x: -travelPixels, y: 0 };
  if (from === 'right') return { x: travelPixels, y: 0 };
  if (from === 'top') return { x: 0, y: -travelPixels };
  return { x: 0, y: travelPixels };
};

export function useSectionArrival({
  sectionKey,
  containerRef,
  profile,
  groups,
}: SectionArrivalOptions) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const spec = ARRIVAL_PROFILES[profile];
    let timeline: gsap.core.Timeline | null = null;

    const onSectionArrive = (event: Event) => {
      if (readSectionArriveKey(event) !== sectionKey) return;
      timeline?.kill();

      const resolved = groups.map((group) => ({
        group,
        elements: Array.from(container.querySelectorAll<HTMLElement>(group.selector)),
      }));
      const everything = resolved.flatMap((entry) => entry.elements);
      if (everything.length === 0) return;

      // Reduced motion still gets the section — it just gets it already assembled. Clearing rather
      // than setting to rest leaves the stylesheet in charge, so nothing carries an inline value it
      // never needed.
      if (prefersReducedMotion()) {
        gsap.set(everything, {
          clearProps: 'transform,opacity,visibility,letterSpacing',
        });
        return;
      }

      // ── Letter-spacing has to be resolved BEFORE anything is written ──
      // GSAP evaluates function-based values as each tween starts, and the `to` side would then be
      // reading an element whose `from` spacing had already been applied — it would tighten to the
      // wide value and stay there. Measured up front into a map instead, so both ends are known
      // before a single style is touched.
      // Measured per arrival, not once: a window can be resized between two jumps.
      const narrowViewport = window.innerWidth <= NARROW_VIEWPORT_MAX_PX;
      const tightensAt = (group: ArrivalGroup) =>
        group.tighten === true && spec.tightenEm > 0 && !narrowViewport;

      const restSpacing = new Map<Element, string>();
      const openSpacing = new Map<Element, string>();
      resolved.forEach(({ group, elements }) => {
        if (!tightensAt(group)) return;
        elements.forEach((element) => {
          const style = getComputedStyle(element);
          // `letter-spacing: normal` parses to NaN, which is the correct 0 here.
          const rest = parseFloat(style.letterSpacing) || 0;
          const fontSize = parseFloat(style.fontSize) || 16;
          restSpacing.set(element, `${rest}px`);
          openSpacing.set(element, `${rest + spec.tightenEm * fontSize}px`);
        });
      });

      timeline = gsap.timeline();
      resolved.forEach(({ group, elements }, groupIndex) => {
        if (elements.length === 0) return;
        const offset = travelOffset(
          narrowViewport ? 'bottom' : group.from ?? 'bottom',
          spec.travelPixels,
        );
        const tightens = tightensAt(group);

        timeline?.fromTo(
          elements,
          {
            autoAlpha: 0,
            x: offset.x,
            y: offset.y,
            scale: spec.fromScale,
            ...(tightens
              ? { letterSpacing: (_index: number, target: Element) => openSpacing.get(target) ?? '0px' }
              : {}),
          },
          {
            autoAlpha: 1,
            x: 0,
            y: 0,
            scale: 1,
            ...(tightens
              ? { letterSpacing: (_index: number, target: Element) => restSpacing.get(target) ?? '0px' }
              : {}),
            duration: spec.durationSeconds,
            stagger: spec.staggerSeconds,
            ease: spec.ease,
            overwrite: true,
            // ⚠ Cleared, not left at rest. A left-behind inline `opacity: 1` is harmless, but a
            // left-behind `translate(0)` keeps a composited layer alive on every line of the footer for
            // the rest of the session — and a left-behind `letter-spacing` would freeze display text at
            // a px value that no longer tracks its own fluid font size on resize.
            clearProps: 'transform,opacity,visibility,letterSpacing',
          },
          groupIndex * spec.groupDelaySeconds,
        );
      });
    };

    window.addEventListener(SECTION_ARRIVE_EVENT, onSectionArrive);
    return () => {
      window.removeEventListener(SECTION_ARRIVE_EVENT, onSectionArrive);
      timeline?.kill();
    };
  }, [sectionKey, containerRef, profile, groups]);
}
