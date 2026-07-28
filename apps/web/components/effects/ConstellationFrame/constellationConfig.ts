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

  // ── Bond-and-seek motion (kicks in once the frame has finished filling) ──
  // Stars sit still while bonded; when a bond's hold timer runs out it breaks and the star hops off
  // to find a new connection, then parks again. Staggered timers keep the field calmly re-forming.
  /** Max distance (CSS px) a star may sit from its home anchor — bounds the walk so the "photo
   *  frame" shape survives all the movement. */
  roamRadiusPx: number;
  /** Seek travel speed in CSS px per second while a released star hunts for a new connection. */
  roamSpeedPx: number;
  /** A seeking star that gets this close (CSS px) to its target evaluates: connected → park, else
   *  hop again. */
  arriveRadiusPx: number;
  /** Min / max seconds a star holds a bond before it breaks and the star goes looking again. */
  holdSecondsMin: number;
  holdSecondsMax: number;
  /** Min / max hop distance (CSS px) a released star travels toward a fresh patch of the field. */
  hopMinPx: number;
  hopMaxPx: number;
  /** Endpoint connection count at which a link reaches full brightness (more links → brighter). */
  brightAtConnections: number;
  /** Hard cap on how many links a single star may hold — it keeps its nearest ones and ignores the
   *  rest, so no dot turns into an over-crowded hub. */
  maxConnectionsPerDot: number;
  /** Cap on how many stars may be seeking (broken off / travelling) at once — the rest hold their
   *  place and wait their turn, so only ever a handful are in motion. */
  maxConcurrentSeekers: number;
  /** Highlight glow on un-bonded stars: halo size multiple (relative to the normal halo) and its
   *  peak alpha, so a lone dark-blue pin still glows enough to be spotted. */
  glowRadiusMultiple: number;
  glowStrength: number;
}

// Desktop / full-power profile.
export const CONSTELLATION_CONFIG: ConstellationConfig = {
  cellSizePx: 50,
  fillRatio: 0.58,
  bandRatioX: 0.13,
  bandRatioY: 0.15,
  starRadiusPx: 2.1,
  haloRadiusMultiple: 3.4,
  twinkleSpeed: 0.7,
  twinkleDepth: 0.4,
  lineMaxDistPx: 84,
  starAlpha: 1,
  lineAlpha: 0.55,
  lineWidthPx: 1.6,

  growthSeconds: 14,
  fillFeather: 0.07,
  sideFillFraction: 0.38,
  fillNoise: 0.09,

  roamRadiusPx: 70,
  roamSpeedPx: 60,
  arriveRadiusPx: 8,
  holdSecondsMin: 5,
  holdSecondsMax: 12,
  hopMinPx: 40,
  hopMaxPx: 90,
  brightAtConnections: 9,
  maxConnectionsPerDot: 6,
  maxConcurrentSeekers: 30,
  glowRadiusMultiple: 2.2,
  glowStrength: 0.4,
};

// Coarse-pointer / narrow-viewport profile: fewer stars, longer/fainter links.
export const CONSTELLATION_CONFIG_LOW_POWER: ConstellationConfig = {
  ...CONSTELLATION_CONFIG,
  cellSizePx: 68,
  lineMaxDistPx: 104,
  lineAlpha: 0.48,
};

export const LOW_POWER_MAX_WIDTH = 760;

// ── Colours ──────────────────────────────────────────────────────────────
// Blue only. Dots switch state: deep blue while un-bonded, bright blue while connected.
export const DOT_DIM_RGB = '40 78 150';      // deep blue — a lone, un-bonded star
export const DOT_BRIGHT_RGB = '130 195 255'; // bright blue — lit once it forms a connection
export const DOT_GLOW_RGB = '120 175 255';   // soft highlight halo around a lone, un-bonded pin
// Links read against the light beige hero, so "more connections" deepens toward a saturated royal
// blue (higher contrast on cream) rather than washing out toward white.
export const LINE_RGB = '86 116 205';        // sparse links — soft periwinkle
export const LINE_BRIGHT_RGB = '34 60 180';  // busy clusters — deep vivid blue that pops on beige
