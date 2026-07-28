/**
 * The homepage's one pinned scroll, as data.
 *
 * The pin runs the square-fill, then a carousel of "stops" — the services craft, the works projects,
 * (soon) the chamber — with wide CROSSINGS between sections: the services→works flight, the
 * works→chamber reveal. So the stops are NOT uniformly spaced, and everything derived from them
 * (where each stop sits in the pin's progress space, how wide each crossing's scrub is, how far each
 * navbar meter has filled) has to fall out of one shared layout.
 *
 * This module owns that derivation and nothing else. It is pure: no GSAP, no DOM, no knowledge of
 * what any section renders. `useHeroAnimation` supplies the sections and does the animating — so
 * adding a section costs one entry in its list, not a new copy of this arithmetic.
 */

export interface CarouselSectionGeometry {
  /** How many stops this section cycles through (craft, projects…). At least 1. */
  stopCount: number;
  /** The crossing that leads out of this section into the next. Omitted on the last section. */
  crossingAfter?: { scrollVh: number };
}

export interface CarouselLayoutOptions {
  /** Viewport-heights of scroll the square takes to fill. */
  fillScrollVh: number;
  /** …and per carousel stop after it. */
  stageScrollVh: number;
  /**
   * How far past the fill the first stop sits, as a fraction of the carousel's span — so stop 0
   * lands on the fully revealed section rather than on the fill/transition edge (which reads as the
   * section scrolling away).
   */
  settleFraction: number;
}

export interface CarouselSectionLayout {
  /** Flat stop indices this section owns (inclusive). */
  firstStop: number;
  lastStop: number;
  /** Pin-progress of `firstStop` — where this section's navbar meter starts filling. */
  firstStopProgress: number;
  /** Progress width from the section's first stop to its last; 0 for a single-stop section. */
  meterSpan: number;
}

export interface CarouselCrossingLayout {
  /** The section this crossing leads out of. */
  sectionIndex: number;
  /** The stops the crossing spans: the section's last, and the next section's first. */
  fromStop: number;
  toStop: number;
  /** Pin-progress bounds of the crossing's scrubbed span. */
  startProgress: number;
  endProgress: number;
}

export interface CarouselLayout {
  /** Fraction of the pin the square-fill occupies; the carousel owns the rest. */
  fillFraction: number;
  /** Progress at which the first stop sits (a touch past the fill — see `settleFraction`). */
  carouselStart: number;
  /** Scroll length of the whole pin, in viewport-heights (feeds ScrollTrigger's `end`). */
  totalScrollVh: number;
  /** Pin-progress of every stop, flattened across all sections in order. */
  stopProgressValues: number[];
  totalStops: number;
  /** One entry per section, in spec order. */
  sections: CarouselSectionLayout[];
  /** One entry per section that declares a `crossingAfter`, in spec order. */
  crossings: CarouselCrossingLayout[];
  /** Which section a flat stop index belongs to. */
  sectionIndexOfStop: (stop: number) => number;
}

export function computeCarouselLayout(
  sections: readonly CarouselSectionGeometry[],
  options: CarouselLayoutOptions,
): CarouselLayout {
  const { fillScrollVh, stageScrollVh, settleFraction } = options;

  // 1. Lay the stops out in viewport-heights. Stops inside a section sit `stageScrollVh` apart; a
  //    crossing then adds its own (much wider) span between one section's last stop and the next
  //    section's first — which is what makes the layout non-uniform.
  const stopVhOffsets: number[] = [];
  const sectionOfStop: number[] = [];
  const sectionStops: { firstStop: number; lastStop: number }[] = [];
  const crossingStops: Omit<
    CarouselCrossingLayout,
    "startProgress" | "endProgress"
  >[] = [];

  let cursorVh = 0;
  sections.forEach((section, sectionIndex) => {
    const firstStop = stopVhOffsets.length;
    for (let stop = 0; stop < section.stopCount; stop += 1) {
      stopVhOffsets.push(cursorVh + stop * stageScrollVh);
      sectionOfStop.push(sectionIndex);
    }
    const lastStop = stopVhOffsets.length - 1;
    sectionStops.push({ firstStop, lastStop });

    if (!section.crossingAfter) return;
    crossingStops.push({ sectionIndex, fromStop: lastStop, toStop: lastStop + 1 });
    cursorVh = stopVhOffsets[lastStop] + section.crossingAfter.scrollVh;
  });

  // 2. Map those offsets into the pin's 0..1 progress space, behind the fill.
  const carouselVhTotal = stopVhOffsets[stopVhOffsets.length - 1] || 1;
  const totalScrollVh = fillScrollVh + carouselVhTotal;
  const fillFraction = fillScrollVh / totalScrollVh;
  const carouselStart = fillFraction + (1 - fillFraction) * settleFraction;
  const carouselSpan = 1 - carouselStart;
  const stopProgressValues = stopVhOffsets.map(
    (stopVh) => carouselStart + (stopVh / carouselVhTotal) * carouselSpan,
  );

  return {
    fillFraction,
    carouselStart,
    totalScrollVh,
    stopProgressValues,
    totalStops: stopProgressValues.length,
    sections: sectionStops.map(({ firstStop, lastStop }) => ({
      firstStop,
      lastStop,
      firstStopProgress: stopProgressValues[firstStop],
      meterSpan:
        stopProgressValues[lastStop] - stopProgressValues[firstStop],
    })),
    crossings: crossingStops.map((crossing) => ({
      ...crossing,
      startProgress: stopProgressValues[crossing.fromStop],
      endProgress: stopProgressValues[crossing.toStop],
    })),
    sectionIndexOfStop: (stop) => sectionOfStop[stop],
  };
}
