/**
 * The project-change transition — one clock, shared by the DOM and the scene.
 *
 * ── Why these numbers aren't in worksTuning ──────────────────────────────────────────────────────
 * This transition spans both halves of the section: the overlay text shears apart and back (DOM,
 * `useWorksTextTransition`) while the rock spins up, re-carves and settles (WebGL, `useWorksField`).
 * Neither owns the other, but they have to agree on WHEN the swap happens — the whole illusion is
 * that the new rock appears at the exact moment the spin is too fast to read. So the schedule lives
 * here, in a file both import, rather than inside either one's tuning.
 *
 * ── The shape of it ──────────────────────────────────────────────────────────────────────────────
 *
 *   0s          0.84       1.15  1.45                                        2.90s
 *   ├────────────┼──────────┼─────┼───────────────────────────────────────────┤
 *   │ text OUT   │          │     │                                           │
 *   │ ├──────────┤          │     │                                           │
 *   │ rock spins up ────────┤▓▓▓▓▓│ rock spins DOWN to idle ──────────────────┤
 *   │ field counter-spins ──┤ ✷   │ field counter-spins down ─────────────────┤
 *   │                    peak  re-carve                                       │
 *   │                          │     ├── text IN (settles from centre) ──┤    │
 *
 * The text leaves BEFORE the swap so nothing legible is on screen while the body changes, and comes
 * back after it so the new copy and the new rock arrive together. There is a deliberate beat of empty
 * screen at the peak — just the whirling rock and the counter-whirling field — which is the moment the
 * whole transition exists for.
 *
 * ── Two things spinning, opposite ways ───────────────────────────────────────────────────────────
 * The rock spins one way and the debris + starfield whirl the other. Their rates add into the
 * apparent speed, so the moment reads far faster than either alone — see
 * ENVIRONMENT_COUNTER_SPIN_DEGREES_PER_SECOND.
 *
 * ── Direction is the whole point ─────────────────────────────────────────────────────────────────
 * Each block keeps flowing the same way across the whole transition: the left block exits left and
 * its replacement also arrives moving left (entering from the centre), the right block mirrors it.
 * Content therefore travels in one continuous direction — which reads as ADVANCING. Having the new
 * text return from the side it just left would read as a rewind, undoing the step the user asked for.
 */

/** Seconds the outgoing text takes to clear, per block. */
export const TEXT_OUT_DURATION = 0.6;
/** Seconds between each line of a block leaving, so they fan rather than move as a slab. */
export const TEXT_OUT_STAGGER = 0.08;
/** Seconds the incoming text takes to settle. */
export const TEXT_IN_DURATION = 0.75;
export const TEXT_IN_STAGGER = 0.08;

/**
 * How far a block travels, as a percentage of its OWN width — so it always clears the edge no matter
 * the viewport, and needs no breakpoint. The exit is a full clear; the entrance starts much closer in
 * because it's a settle, not a second full slide.
 */
export const TEXT_EXIT_SHIFT_PERCENT = 120;
export const TEXT_ENTER_SHIFT_PERCENT = 60;
/** Degrees of shear while a block is in motion. Shared by both blocks, so the whole plane skews as one. */
export const TEXT_SHEAR_DEGREES = -8;

/** Seconds the rock takes to wind up from its idle spin to peak. */
export const SPIN_RAMP_SECONDS = 1.15;
/** Seconds it holds at peak — the body is a blur here, and the re-carve happens inside this window. */
export const SPIN_PEAK_HOLD_SECONDS = 0.3;
/** Seconds it takes to wind back down to the idle spin. The longest beat: the settle is what sells it. */
export const SPIN_DECAY_SECONDS = 1.45;
/**
 * Peak spin, in degrees per second — an ABSOLUTE rate, not a multiple of the idle `meteorSpin`.
 * At ~1150°/s the body turns roughly 19° per frame at 60fps, which is more than enough to stop the
 * eye tracking a feature across the swap. Expressing it as a multiplier would have tied the illusion
 * to a tuning value that exists for a completely different reason (the idle drift).
 */
export const SPIN_PEAK_DEGREES_PER_SECOND = 1150;

/**
 * How fast the surrounding field — debris and stars — whirls the OTHER WAY at peak, in degrees per
 * second.
 *
 * The rock alone spinning has nothing to be fast against: it's a lone body on black, so past a certain
 * rate it stops reading as faster and just reads as a flicker. Counter-rotating the environment gives
 * the eye a reference frame moving the opposite way, so the two rates ADD into the apparent speed —
 * which is why this can be a fraction of the rock's own spin and still double how fast the moment
 * feels. It's also why it must stay a fraction: matching the rock would read as the camera rolling,
 * not as the rock spinning.
 *
 * Integrated into the drift rather than assigned, so it eases in and out with the same envelope and
 * leaves the field parked wherever it stopped — there's no home orientation for debris to snap back to.
 */
export const ENVIRONMENT_COUNTER_SPIN_DEGREES_PER_SECOND = 165;

/** The moment the rock begins changing shape: the end of the wind-up, while it's turning fastest. */
export const SWAP_AT_SECONDS = SPIN_RAMP_SECONDS;

/**
 * Seconds the body takes to morph from one rock into the next.
 *
 * Deliberately longer than the peak hold, so the reshape is still finishing as the spin starts coming
 * down — you get a good look at the new silhouette settling rather than having it handed to you
 * already finished. It used to be an instant swap on a single frame, which is why it needed to hide
 * behind the blur; now the blur only flatters something that would survive being watched.
 */
export const MORPH_SECONDS = 1.0;

/**
 * How far, in world units, every vertex bulges along its normal at the halfway point of the morph.
 *
 * This is not decoration — it's a correction. Two irregular bodies average out ROUNDER than either of
 * them, so an uncorrected morph visibly deflates toward a smooth blob at the midpoint. The swell
 * cancels that and turns the artefact into the read you actually want: molten, then set.
 */
export const MORPH_SWELL_UNITS = 0.16;

/**
 * How much hotter the lava veins burn at the peak of the morph, as a multiple of `meteorEmissive`.
 * The field already runs a bloom pass, so this blooms with it — the rock flares as it reshapes and
 * cools back into the new body.
 */
export const MORPH_EMISSIVE_FLARE = 2.4;
/** The incoming text starts just after the swap, so it never overlaps the body changing. */
export const TEXT_IN_AT_SECONDS = SWAP_AT_SECONDS + SPIN_PEAK_HOLD_SECONDS;

/**
 * Total length of the transition (~2.9s), derived so the relationship to the camera hop stays visible.
 *
 * This deliberately OUTLASTS `travelSeconds` (2.05s in worksTuning): the camera finishes its move to
 * the new stop while the rock is still shedding speed, so you arrive and watch it settle rather than
 * arriving to a scene that has already finished moving. Shortening the decay to match the hop is what
 * made the change feel abrupt.
 */
export const TRANSITION_TOTAL_SECONDS =
  SWAP_AT_SECONDS + SPIN_PEAK_HOLD_SECONDS + SPIN_DECAY_SECONDS;
