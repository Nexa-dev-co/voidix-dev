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
  /**
   * 512×512 ink texture — 4× finer than the physics, which is what keeps the ink's edge from reading
   * as blocky.
   *
   * ⚠ Was 1024, the source library's default, and that default exists for a fluid you FLING — long
   * smeared streaks whose edges you follow across the screen. This one is the opposite: the
   * `densityDissipation` two lines down is pushed ~10× past the library's, so the ink is killed almost
   * the moment it is laid and never forms an edge worth resolving at 1024. It was costing four times
   * the advection and splat bandwidth, every frame, on the first screen a visitor sees.
   *
   * If the blob ever reads soft or stepped at the rim, this is the one number to put back.
   */
  dyeResolution: 512,

  // Dissipation = a per-frame decay rate; bigger number → fades faster. Both are pushed WAY up.
  densityDissipation: 10.2, // ink fades ~3× faster than default → no lingering tail   (reference default: 1)
  velocityDissipation: 10.0, // motion dies ~15× faster → blob settles on the cursor    (reference: 0.2)

  pressure: 0.8, // pressure-projection strength (0–1) — the default; keeps the fluid stable
  pressureIterations: 20, // Jacobi passes for the pressure solve — the default; plenty for this small grid
  curl: 8, // swirl/vorticity, far below default → no wispy filaments  (reference: 30)
  splatForce: 1600, // shove per pointer move, ~¼ the default → a soft nudge    (reference: 6000)
};

// ── Blob size ──────────────────────────────────────────────────────────
/**
 * Radius of each splat, in screen pixels. One number — the blob is the same size however fast the
 * cursor is moving.
 *
 * It used to be a range mapped from pointer speed (`MIN_BLOB_RADIUS_PX` / `MAX_BLOB_RADIUS_PX` /
 * `SPEED_FOR_MAX_RADIUS`), on the reasoning that a fast flick should feel more energetic than a slow
 * drift. Some later tuning pass settled both ends on 30 and left the machinery in place, so the hook
 * was measuring pointer velocity every mousemove to interpolate between a number and itself. The
 * energy in a flick already comes from `splatForce`, which does vary with the motion; this does not
 * need to as well. Reinstate the range here if the swell is ever wanted back — the hook would need
 * its `lastPointerTime` bookkeeping back with it.
 */
export const BLOB_RADIUS_PX = 30;

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
// Every star randomly picks one of these colours (RGB, 0–1), so the field mixes a pale core with a
// warmer tint rather than reading as one flat colour.
//
// These are the SUN's palette, not the old white + cool blue: the pale gold is the gather field's
// `colorHot` (#ffeeb8, `gatherShader.ts`) and the amber is `--sun-accent` (#ff8a1a). Everything on
// this site that emits light now comes from the same star — the loader dust, the constellation, the
// hero's neon frame, and these. Keep them in step if the star's colour is ever retuned.
export const STAR_PALETTE: readonly (readonly [number, number, number])[] = [
  [1.0, 0.93, 0.72], // pale gold — starlight at its hottest
  [1.0, 0.54, 0.1], // amber — the sun's own accent
];
