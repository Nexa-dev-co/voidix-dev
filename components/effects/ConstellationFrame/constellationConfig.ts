// Tuning for the hero's constellation frame — a photo-frame border of connected "zodiac" stars in
// blue. The screen starts empty; on reveal the frame fills in with a LIQUID-like flowing front that
// starts at the left & right sides and spreads along the border to meet at the top-centre and
// bottom-centre. Only the constellation exists (no centre haze, no separate gray band). After it
// completes it holds with gentle drift + twinkle.
//
// All values live here; the hook holds no magic numbers. Pixel values are CSS px (the hook
// multiplies by DPR where it builds backing stores).

export interface ConstellationConfig {
  /** Grid cell that may hold one star (CSS px). Larger = sparser field. */
  cellSizePx: number;
  /** Fraction of cells that actually hold a star (0..1). */
  fillRatio: number;
  /** Border-band thickness as a fraction of viewport width (L/R) and height (T/B). The zodiac lives
   *  only in this band; the centre stays clear for the headline. */
  bandRatioX: number;
  bandRatioY: number;
  /** Star core radius (CSS px) and the soft halo multiple (the neon glow). */
  starRadiusPx: number;
  haloRadiusMultiple: number;
  /** How far a star wanders from its base position (CSS px) and how fast. */
  driftAmplitudePx: number;
  driftSpeed: number;
  /** Twinkle: alpha oscillates between (1 - depth) and 1 at this speed, phased per star. */
  twinkleSpeed: number;
  twinkleDepth: number;
  /** Two stars closer than this (CSS px) get a connecting line; alpha falls off to it. */
  lineMaxDistPx: number;
  /** Peak star alpha once revealed, and line alpha once both ends are revealed. */
  starAlpha: number;
  lineAlpha: number;
  /** Connecting-line stroke width (CSS px). */
  lineWidthPx: number;

  // ── The liquid fill (border reveal from the sides) ──
  /** Seconds for the fill to travel from the sides and complete the whole frame. */
  growthSeconds: number;
  /** Soft width (in fill-order units, 0..1) of the reveal front — the liquid meniscus. */
  fillFeather: number;
  /** Portion of the fill (0..1) spent lighting the two side edges before the top/bottom fill in. */
  sideFillFraction: number;
  /** Per-star random offset to the fill order (0..1) — makes the front irregular, so it seeps in
   *  like liquid instead of a clean geometric line. */
  fillNoise: number;
}

// Desktop / full-power profile.
export const CONSTELLATION_CONFIG: ConstellationConfig = {
  cellSizePx: 50,
  fillRatio: 0.58,
  bandRatioX: 0.13,
  bandRatioY: 0.15,
  starRadiusPx: 2.1,
  haloRadiusMultiple: 3.4,
  driftAmplitudePx: 6,
  driftSpeed: 0.14,
  twinkleSpeed: 0.7,
  twinkleDepth: 0.4,
  lineMaxDistPx: 84,
  starAlpha: 1,
  lineAlpha: 0.34,
  lineWidthPx: 1.6,

  growthSeconds: 14,
  fillFeather: 0.07,
  sideFillFraction: 0.38,
  fillNoise: 0.09,
};

// Coarse-pointer / narrow-viewport profile: fewer stars, longer/fainter links.
export const CONSTELLATION_CONFIG_LOW_POWER: ConstellationConfig = {
  ...CONSTELLATION_CONFIG,
  cellSizePx: 68,
  lineMaxDistPx: 104,
  lineAlpha: 0.28,
  driftAmplitudePx: 5,
};

export const LOW_POWER_MAX_WIDTH = 760;

// ── Colours ──────────────────────────────────────────────────────────────
// Blue only. Dark-but-neon dots + a slightly deeper blue for the connecting links.
export const DOT_PALETTE: readonly string[] = ['72 140 255']; // brighter neon blue
export const LINE_RGB = '96 156 255';
