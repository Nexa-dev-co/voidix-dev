// Tuning for the fluid cursor — the ink trail that follows the pointer across the hero.
//
// The sim is a trimmed port of Pavel Dobryakov's WebGL-Fluid-Simulation. That library is built to
// fling colourful fluid everywhere; we want the opposite — a tight, dark blob that hugs the cursor
// and leaves NO lingering tail. So almost every value below is pushed away from the library's
// default to fight one of three problems past attempts had: long smeary tails, hard/harsh heads,
// and banding. The two biggest anti-tail levers are the dissipation pair (how fast the dye and the
// motion die) and the low curl (which kills wispy filaments). The "reference:" notes give the
// library's own default, so you can see which way — and how far — each knob has been turned.

export interface FluidConfig {
  /**
   * Resolution of the velocity / pressure grid — the *physics* simulation, not what you see.
   * Higher = finer swirls but more GPU work every frame; lower = coarser motion, cheaper. For a
   * single cursor blob 128 is already plenty; you'd only raise it for large, detailed fluid.
   */
  simulationResolution: number;
  /**
   * Resolution of the dye field — the *visible* ink texture you actually look at. Kept far higher
   * than the sim grid because the eye reads the dye directly: higher = crisper ink edges (more
   * memory + GPU), lower = softer, blockier ink.
   */
  dyeResolution: number;
  /**
   * How fast the dye fades out each frame. This is the main "kill the tail" knob:
   * higher → the ink vanishes almost as soon as it's laid, so the blob never smears into a trail;
   * lower → the ink lingers and streaks out behind the cursor.
   */
  densityDissipation: number;
  /**
   * How fast the fluid's momentum dies. Higher → motion stops quickly, so the blob settles right
   * under the cursor instead of coasting past it; lower → the ink keeps drifting after the pointer
   * has moved on (more "liquid", but it slides off the cursor).
   */
  velocityDissipation: number;
  /**
   * Strength of the pressure projection that keeps the fluid incompressible (divergence-free) —
   * i.e. stops it piling up or tearing holes. Higher feels springier / pushier; lower is calmer.
   */
  pressure: number;
  /**
   * How many Jacobi iterations solve that pressure each frame. More = more accurate, smoother flow
   * (costs GPU); fewer = cheaper, but the fluid can look mushy or "leak". 20 is a solid middle.
   */
  pressureIterations: number;
  /**
   * Vorticity confinement — how much extra swirl / curl gets re-injected into the fluid. Another
   * tail lever: high (the library uses 30) breeds wispy filaments that curl off into a trail; low
   * keeps the blob rounded and filament-free.
   */
  curl: number;
  /**
   * How hard each pointer move shoves the fluid outward. Higher → the ink jets / explodes away from
   * the cursor; lower → a gentle nudge. Kept modest so it reads as a soft blob, not a firehose.
   */
  splatForce: number;
}

// A note on the numbers: the resolutions, pressure, and iteration count are left at the source
// library's own defaults (sensible for a cursor, no reason to touch them). The dissipations, curl,
// and splat force are deliberately pushed away from those defaults — that's what turns a sprawling
// fluid into a tight, tail-free blob. Each "reference:" note is the library's default for contrast.
export const FLUID_CONFIG: FluidConfig = {
  // Both are texture sizes in pixels-per-side (powers of two), left at the library defaults.
  simulationResolution: 128, // 128×128 physics grid — coarse is fine; the blob has no fine detail to resolve
  dyeResolution: 1024, // 1024×1024 ink texture — 8× finer than the physics, so the ink edges stay crisp

  // Dissipation = a per-frame decay rate; bigger number → fades faster. Both are pushed WAY up.
  densityDissipation: 10.2, // ink fades ~3× faster than default → no lingering tail   (reference default: 1)
  velocityDissipation: 10.0, // motion dies ~15× faster → blob settles on the cursor    (reference: 0.2)

  pressure: 0.8, // pressure-projection strength (0–1) — the default; keeps the fluid stable
  pressureIterations: 20, // Jacobi passes for the pressure solve — the default; plenty for this small grid
  curl: 8, // swirl/vorticity, far below default → no wispy filaments  (reference: 30)
  splatForce: 1600, // shove per pointer move, ~¼ the default → a soft nudge    (reference: 6000)
};

// ── Blob size, mapped from cursor speed ────────────────────────────────
// The blob isn't a fixed size: it's small when the cursor is still or ambling, and swells toward
// the max only when you whip the pointer — so a fast flick feels more energetic than a slow drift.
export const MIN_BLOB_RADIUS_PX = 30; // radius at rest / slow movement — the resting blob size
export const MAX_BLOB_RADIUS_PX = 30; // radius when the cursor is moving flat-out
// The cursor speed at which the blob reaches its MAX radius, measured in screen-heights per second
// (so it feels the same on any screen size). Lower → the blob grows big with gentle movement;
// higher → you have to move very fast before it maxes out.
export const SPEED_FOR_MAX_RADIUS = 10;

// ── Ink appearance ─────────────────────────────────────────────────────
// The ink colour as RGB, each channel 0–1. Near-black with the faintest cool-blue tint so it reads
// as "deep space" rather than flat grey.
export const INK_COLOR: readonly [number, number, number] = [0.02, 0.02, 0.03];
// The most opaque the ink veil ever gets. Deliberately below 1 so the inverted text on the layer
// beneath still glows through the blob — the "backlit ink in dark water" look.
export const INK_PEAK_ALPHA = 0.82;
// Converts accumulated dye into visible opacity: higher → the blob reaches full darkness from less
// dye, so it "fills in" faster and more solidly.
export const DYE_TO_PRESENCE = 4.0;
// How much dye each pointer move injects. Higher → a more solid blob per move; lower → fainter and
// more gaseous. Works together with DYE_TO_PRESENCE to set how quickly the ink builds up.
export const DYE_SPLAT_AMOUNT = 0.3;

// ── Stars (the only "lighting", kept subtle) ───────────────────────────
// The ink is sprinkled with faint stars so the blob reads as a slice of night sky, not flat black.
// Stars sit on a grid: the field is diced into square cells, and a fraction of the cells get a star.
export const STAR_CELL_SIZE_PX = 46; // size of each grid cell — smaller cells pack the stars denser
export const STAR_FILL_RATIO = 0.55; // fraction of cells that actually hold a star (0–1) — higher = more stars
export const STAR_BRIGHTNESS = 0.85; // peak brightness of a star
export const STAR_TWINKLE_SPEED = 1.6; // how quickly stars pulse in and out
// Every star randomly picks one of these colours (RGB, 0–1), so the field mixes white + cool blue.
export const STAR_PALETTE: readonly (readonly [number, number, number])[] = [
  [1.0, 1.0, 1.0], // white
  [0.2, 0.4, 1.0], // dark blue
];
