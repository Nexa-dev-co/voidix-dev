/**
 * The geode's choreography — four curves derived from one progress value.
 *
 * ── Why they are curves of `p` and not a timeline ────────────────────────────────────────────────
 * The storyboard has energy waking before the rock opens, crystal surfacing as it opens, and the whole
 * thing closing again afterwards. Expressed as a GSAP timeline that would be four clocks, and this site
 * was rebuilt once because a transition ran on three of them and fast scroll desynced it
 * (`docs/services-to-works-flight.md`). Expressed as pure functions of one number it cannot be outrun,
 * it reverses perfectly, and a resize just re-derives it.
 *
 * The round trip is free: run `p` from 0 to 1 and back, and frames 7-12 ARE frames 6-1.
 *
 *   p    0        .15      .3       .5              .8       1
 *        |---------|--------|--------|---------------|-------|
 *   grow  ........--=====================================..      the silhouette
 * reveal  ......--==========================================     crystal surfacing
 *   vein  .--===--.......................................        gold flare (see the note below)
 * spread  ..........................................--=====      crystal TAKES the surface
 * charge  .........................................--======      the interior wakes
 *
 * `spread` is the one beat that happens AFTER the mark is whole. Everything up to `growEnd` (0.92) is
 * a rock becoming a letter, and it does that as mostly rock with a little crystal in the cuts. Only
 * once the silhouette has landed does the crystal actually take the surface. Running it on the same
 * progress rather than on a timer is what keeps the close honest: scrub back and the crystal recedes
 * first, and only then does the letter shut.
 *
 * ── Charge fires LAST, and that is a change ──────────────────────────────────────────────────────
 * It used to ramp over 0.02 → 0.3, so the body glowed through nearly the whole opening and never read
 * as stone — which was half of why the base rock did not look like a rock. It now lands in the last
 * 10%, alongside `spread`, so what you watch is inert rock giving way and only then coming alive.
 * The bounds are authored, so the old early wake is two sliders away if it is ever wanted back.
 *
 * Note that `ramp` is monotonic: charge rises and then HOLDS, so the settled mark keeps a faint wash
 * on every opened surface. If it should flare and fade, charge needs a second pair of bounds for the
 * fall — an intentional decision, not an oversight.
 *
 * ⚠ `veinFlare` is inert in the shipped configuration. It multiplies `totalEmissiveRadiance`, and the
 * geode's crust is built from a `stone` spec, which carries no emissive map — so it multiplies zero.
 * It only does anything if the crust is switched to the `meteor` treatment, which `DEFAULT_CHUNK_SPECS`
 * deliberately avoids. Kept because that switch is a legitimate thing to try, not because it is live.
 */

export interface GeodePhaseTiming {
  /** The interior waking. Placed in the last 10% so the body is inert stone until then. */
  chargeStart: number;
  chargeEnd: number;
  /** The silhouette giving way. */
  growStart: number;
  growEnd: number;
  /** Crystal surfacing on what the cut exposed. */
  revealStart: number;
  revealEnd: number;
  /**
   * The crystal spreading across the finished mark. Sits AFTER `growEnd` on purpose — this is the
   * beat where a formed, mostly-rock letter fills in with geode.
   */
  spreadStart: number;
  spreadEnd: number;
  /** The gold veins' flare: where it peaks, how wide, and how far above resting brightness. */
  veinPeak: number;
  veinWidth: number;
  veinFlare: number;
}

export interface GeodePhases {
  grow: number;
  charge: number;
  reveal: number;
  /** 0 = the forming mark's sparse crystal, 1 = the settled mark's. Drives crystal COVERAGE, not look. */
  spread: number;
  /** Multiplies the crust's own emissive. Rests at 1 — the veins never go out. */
  veinFlare: number;
}

export const DEFAULT_GEODE_PHASE_TIMING: GeodePhaseTiming = {
  // The last 10%. See the note above — this used to be 0.02 → 0.3 and it is what stopped the base
  // rock reading as stone.
  chargeStart: 0.9,
  chargeEnd: 1,
  growStart: 0.18,
  growEnd: 0.92,
  revealStart: 0.12,
  revealEnd: 0.7,
  spreadStart: 0.9,
  spreadEnd: 1,
  veinPeak: 0.12,
  veinWidth: 0.16,
  veinFlare: 1.8,
};

/** Smooth 0..1 ramp between two bounds. Degenerate bounds step rather than divide by zero. */
function ramp(value: number, start: number, end: number): number {
  if (end <= start) return value >= end ? 1 : 0;
  const local = (value - start) / (end - start);
  const clamped = local < 0 ? 0 : local > 1 ? 1 : local;
  return clamped * clamped * (3 - 2 * clamped);
}

/** A soft pulse centred on `centre`, reaching 1 at the centre and 0 beyond `width`. */
function pulse(value: number, centre: number, width: number): number {
  if (width <= 0) return 0;
  const distance = Math.abs(value - centre) / width;
  if (distance >= 1) return 0;
  const falloff = 1 - distance;
  return falloff * falloff * (3 - 2 * falloff);
}

export function evaluateGeodePhases(
  progress: number,
  timing: GeodePhaseTiming,
): GeodePhases {
  const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return {
    grow: ramp(clamped, timing.growStart, timing.growEnd),
    charge: ramp(clamped, timing.chargeStart, timing.chargeEnd),
    reveal: ramp(clamped, timing.revealStart, timing.revealEnd),
    spread: ramp(clamped, timing.spreadStart, timing.spreadEnd),
    veinFlare: 1 + timing.veinFlare * pulse(clamped, timing.veinPeak, timing.veinWidth),
  };
}
