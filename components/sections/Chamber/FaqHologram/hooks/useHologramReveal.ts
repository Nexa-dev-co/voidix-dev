import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { hologramMaxHeightGain, toDesignPx } from '@/lib/hologramPose';
import { getChamberTuning } from '@/lib/chamberTuning';
import { FAQ_ENTRY_OPEN_EVENT, type FaqEntryOpenDetail } from '@/lib/chamberEvents';

/**
 * The unseal, and the fall from a question into its answer.
 *
 * ── Why there is no positioning maths here ────────────────────────────────────────────────────────
 * The two black frames are flex SIBLINGS of the lit area, not things placed against it. So the only
 * thing this animates is the lit area's HEIGHT — sealed is `0`, and the frames are pressed together;
 * open is the content's measured height, and the content pushes them apart. Switch to a taller answer
 * and the same tween carries the frames to the new size. Nothing tracks anything.
 *
 * ── Why the measurement is stable ─────────────────────────────────────────────────────────────────
 * The panel is laid out at a fixed design width and scaled into the room by the tracking hook (see
 * HOLOGRAM_DESIGN_WIDTH). So `offsetHeight` here is in design pixels and does not move when the camera
 * does — otherwise this tween would be chasing a target that changes every frame.
 */

/** The chosen question flares before the list powers down around it, so the click has a consequence. */
const FLARE_SECONDS = 0.18;
const POWER_DOWN_SECONDS = 0.3;
const SCAN_IN_SECONDS = 0.5;
/** The lit area re-seals a little faster than it opens — closing should feel decisive, not reluctant. */
const SEAL_FACTOR = 0.7;

interface HologramRevealRefs {
  /** The lit area. Its height IS the animation. */
  screenRef: RefObject<HTMLDivElement | null>;
  /** What's inside it — measured to decide how far the frames part. */
  contentRef: RefObject<HTMLDivElement | null>;
  /** True once the scroll has committed the hologram's stop. */
  isOpen: boolean;
  /** Which question is expanded, or null for the list. */
  openEntry: number | null;
  setOpenEntry: (index: number | null) => void;
  /**
   * Bumped when a covered nav jump lands on the chamber. Play the unseal AGAIN.
   *
   * A counter rather than a boolean, because the thing being asked for is an event ("do it now"), and a
   * boolean has to be turned back off by whoever set it — which means two writers and a window in which
   * the panel is told to replay something it has already replayed.
   */
  arrivalReplay: number;
}

export function useHologramReveal({
  screenRef,
  contentRef,
  isOpen,
  openEntry,
  setOpenEntry,
  arrivalReplay,
}: HologramRevealRefs) {
  /** So the effect below can tell an arrival's replay from an ordinary open / view change. */
  const lastArrivalReplay = useRef(arrivalReplay);
  /**
   * Part the frames to fit whatever is in the panel right now.
   *
   * Runs on the layout pass so it measures the content React has just committed — a frame later and the
   * panel visibly snaps to the old height first.
   */
  const applyHeight = useCallback(
    (animate: boolean) => {
      const screen = screenRef.current;
      const content = contentRef.current;
      if (!screen || !content) return;

      const tuning = getChamberTuning();
      const reduceMotion = prefersReducedMotion();
      const seconds = animate && !reduceMotion ? tuning.holoOpenSeconds : 0;

      if (!isOpen) {
        gsap.to(screen, {
          height: 0,
          duration: seconds * SEAL_FACTOR,
          ease: 'power3.in',
          overwrite: true,
        });
        return;
      }

      // Content-determined — up to a point. Past `holoMaxHeight` the panel stops growing and the answer
      // scrolls inside it instead, so a long answer can never swallow the room.
      //
      // The gain is 1 on anything but a phone. There it lets the panel run taller, because the narrow
      // design width reflows the same copy to a longer column — without it, a bigger typeface would
      // just mean less of the answer visible before it started scrolling. See hologramMaxHeightGain.
      const maxHeight = toDesignPx(
        tuning.holoMaxHeight * hologramMaxHeightGain(),
        tuning.holoWidth,
      );
      gsap.to(screen, {
        height: Math.min(content.offsetHeight, maxHeight),
        duration: seconds,
        ease: 'power3.inOut',
        overwrite: true,
      });
    },
    [screenRef, contentRef, isOpen],
  );

  // Open / re-seal, and re-fit whenever the view inside changes. Also staggers the new view's contents
  // up out of the lit area as it parts, so the panel builds rather than simply appearing.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const isArrivalReplay = arrivalReplay !== lastArrivalReplay.current;
    lastArrivalReplay.current = arrivalReplay;

    // Put the frames back together first, so `applyHeight` below has somewhere to open FROM. Without
    // this the panel is already at its full height and the tween is a no-op — the rows would scan up
    // inside a screen that never parted, which is half the gesture.
    //
    // Snapped rather than tweened: the cover is still over this on the frame it happens, so a visible
    // re-seal would only be a flicker of one. Skipped entirely when the panel is not open, because then
    // the tour is still finishing behind the cover and its own unseal is about to play anyway.
    if (isArrivalReplay && isOpen && !prefersReducedMotion() && screenRef.current) {
      gsap.set(screenRef.current, { height: 0 });
    }

    applyHeight(true);
    if (!isOpen) return;

    const reduceMotion = prefersReducedMotion();
    const tuning = getChamberTuning();
    const parts = content.querySelectorAll('.holo-stagger');

    const scanIn = gsap.fromTo(
      parts,
      { autoAlpha: 0, y: 16 },
      {
        autoAlpha: 1,
        y: 0,
        duration: reduceMotion ? 0 : SCAN_IN_SECONDS,
        stagger: reduceMotion ? 0 : tuning.holoRowStagger,
        ease: 'power2.out',
        // Behind the frames' parting, so the content emerges from the opening rather than hanging in
        // the dark waiting for it.
        delay: reduceMotion ? 0 : tuning.holoOpenSeconds * 0.35,
        overwrite: true,
      },
    );

    return () => {
      scanIn.kill();
    };
  }, [isOpen, openEntry, arrivalReplay, applyHeight, contentRef, screenRef]);

  /**
   * Fall into an answer.
   *
   * The chosen question flares, the rest of the list powers down around it, and only then does the view
   * swap — so the click reads as *this one*, rather than as the whole panel being replaced. The answer
   * then scans in from the layout effect above, and the frames glide to its (usually taller) height.
   */
  const openQuestion = useCallback(
    (index: number) => {
      // ⚠ Announced HERE rather than at the click, and before the reduced-motion branch below returns.
      // The choice has been made either way; only what it looks like differs, and a signal that fired
      // for one visitor and not the other would report reduced motion as a lack of curiosity.
      window.dispatchEvent(
        new CustomEvent<FaqEntryOpenDetail>(FAQ_ENTRY_OPEN_EVENT, { detail: { index } }),
      );

      const content = contentRef.current;
      if (!content || prefersReducedMotion()) {
        setOpenEntry(index);
        return;
      }

      const rows = Array.from(content.querySelectorAll<HTMLElement>('.holo-row'));
      const chosen = rows[index];
      const rest = rows.filter((row) => row !== chosen);
      const tuning = getChamberTuning();

      gsap
        .timeline({ onComplete: () => setOpenEntry(index) })
        .to(chosen, { '--holo-row-flare': 1, duration: FLARE_SECONDS, ease: 'power2.out' }, 0)
        .to(
          rest,
          {
            autoAlpha: 0,
            y: 10,
            duration: POWER_DOWN_SECONDS,
            // From the edges inward, so the list collapses toward the one you picked.
            stagger: { each: tuning.holoRowStagger, from: 'edges' },
            ease: 'power2.in',
          },
          FLARE_SECONDS * 0.5,
        )
        .to(chosen, { autoAlpha: 0, duration: POWER_DOWN_SECONDS * 0.6, ease: 'power2.in' }, '>-0.05');
    },
    [contentRef, setOpenEntry],
  );

  const goBack = useCallback(() => setOpenEntry(null), [setOpenEntry]);

  return { openQuestion, goBack };
}
