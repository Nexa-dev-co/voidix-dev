// Tuning for the hero's constellation effect. The screen starts empty; on reveal a growth front
// expands from the exact centre outward, revealing two zones as it passes: a soft smoky galaxy-dust
// haze in the middle (behind the headline) and connected "zodiac" stars at the page edges. The whole
// spread-and-connect takes ~growthSeconds, then it holds with gentle drift + twinkle.
//
// All values live here; the hook holds no magic numbers. Pixel values are CSS px (the hook
// multiplies by DPR where it builds backing stores).

export interface ConstellationConfig {
  // ── Edge zone: the zodiac stars (perimeter band) ──
  /** Grid cell that may hold one star (CSS px). Larger = sparser field. */
  cellSizePx: number;
  /** Fraction of cells that actually hold a star (0..1). */
  fillRatio: number;
  /** Border-band thickness as a fraction of viewport width (L/R) and height (T/B): the zodiac lives
   *  here. The centre (1 - 2*bandRatio) has no edge stars — only the haze. */
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

  // ── The growth front (unified radial reveal of both zones) ──
  /** Seconds for the front to travel from the centre out to the far corners (fully connected). */
  growthSeconds: number;
  /** Soft edge width of the growth front (CSS px) so things fade in as it passes, not pop. */
  growthFeatherPx: number;

  // ── Centre zone: the smoky dust haze ──
  /** Number of soft blobs making up the nebula (more = denser smoke). Scaled down on low power. */
  hazeBlobCount: number;
  /** Blob radius range (CSS px). */
  hazeBlobMinPx: number;
  hazeBlobMaxPx: number;
  /** How tightly the haze hugs the centre: fraction of the min viewport dim for the 1-sigma spread. */
  hazeSpreadRatio: number;
  /** Per-blob peak alpha (kept low so the haze sits behind the headline). */
  hazeBlobAlpha: number;
  /** Build the nebula at this fraction of viewport resolution (smoke is soft, so downscaling is
   *  free performance). 1 = full res. */
  hazeRenderScale: number;
}

// Desktop / full-power profile.
export const CONSTELLATION_CONFIG: ConstellationConfig = {
  cellSizePx: 56,
  fillRatio: 0.52,
  bandRatioX: 0.2,
  bandRatioY: 0.22,
  starRadiusPx: 1.5,
  haloRadiusMultiple: 3.6,
  driftAmplitudePx: 6,
  driftSpeed: 0.14,
  twinkleSpeed: 0.7,
  twinkleDepth: 0.4,
  lineMaxDistPx: 88,
  starAlpha: 0.85,
  lineAlpha: 0.18,

  growthSeconds: 18,
  growthFeatherPx: 150,

  hazeBlobCount: 80,
  hazeBlobMinPx: 90,
  hazeBlobMaxPx: 260,
  hazeSpreadRatio: 0.32,
  hazeBlobAlpha: 0.05,
  hazeRenderScale: 0.5,
};

// Coarse-pointer / narrow-viewport profile: fewer stars + blobs, longer/fainter links.
export const CONSTELLATION_CONFIG_LOW_POWER: ConstellationConfig = {
  ...CONSTELLATION_CONFIG,
  cellSizePx: 76,
  lineMaxDistPx: 112,
  lineAlpha: 0.14,
  driftAmplitudePx: 5,
  hazeBlobCount: 42,
  hazeRenderScale: 0.4,
};

export const LOW_POWER_MAX_WIDTH = 760;

// ── Colours ──────────────────────────────────────────────────────────────
// Dark smoky blue for the haze; two dark-but-neon tones for the zodiac stars (blue + gold). "r g b".
export const HAZE_RGB = '34 62 128';

export const DOT_PALETTE: readonly string[] = [
  '46 108 255', // neon blue
  '226 168 30', // neon gold
];

// Line colour — a neutral cool tone that reads under both star colours.
export const LINE_RGB = '90 120 200';
