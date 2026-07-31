/**
 * The star's death, as a pure function of one number.
 *
 * ── What this is ─────────────────────────────────────────────────────────────────────────────────
 * A port of `/sun-lab`'s Singularity stage — the sequence you get by loading that preset and hitting
 * Play. Every window, curve and constant below is lifted from `useSunLabScene` and `sunLabPresets`
 * rather than re-derived, because the lab is where these were judged by eye and a second set of
 * numbers that merely looks similar is how the two drift apart.
 *
 * ── Why it is a pure evaluator and not a scene ───────────────────────────────────────────────────
 * The lab owns a whole editor: registries, presets, a Play button that ramps its own clock. None of
 * that belongs on the site, where the sequence is simply the contact crossing's scrubbed progress. So
 * what crosses over is the MATHS, as a function from sequence → everything the frame needs, and
 * `SunModelCanvas` applies the result to the objects it already owns.
 *
 * That also gives the finale the site's crossing contract for free: no timers, no flags, no arrival
 * state. It cannot be outrun, it reverses exactly, and scrubbing back turns the hole into a star.
 *
 *   0.00        0.15              0.50   0.62        0.84        1.00
 *     │ liquid sun │  COLLAPSE      │ HORIZON │  RINGS FORM        │
 *     │  churns    │  star falls in │ opens   │  glow, then the    │
 *     │            │                │ from    │  main ring last    │
 *     │            │                │ middle  │                    │
 *
 * Nothing overlaps that shouldn't: the hole opens only once the star is essentially gone, and the disc
 * assembles only once the hole exists.
 */

// ── The sequence windows (lab: FINALE_*) ──
const EXPLODE: readonly [number, number] = [0.15, 0.5]; // the star falls in
const HORIZON: readonly [number, number] = [0.4, 0.62]; // the hole opens from the middle
/** A deliberate beat of just-a-black-hole before the disc arrives, so it reads as having gathered. */
const RING_FORM_EARLY: readonly [number, number] = [0.68, 0.88];
const RING_FORM_LATE: readonly [number, number] = [0.78, 1];

// ── The flash (lab: FLASH_*) ──
const FLASH_AT = 0.5; // peaks exactly where the cubed collapse takes the star's scale to zero
const FLASH_HOLD = 0.18;
const FLASH_STRENGTH = 0.5;
const FLASH_ATTACK = 0.05; // a detonation arrives fast
const FLASH_CORE_HOLD_FRACTION = 0.25; // the burst clears so it isn't standing in front of the reveal
const FLASH_CORE_DECAY = 0.16;
const FLASH_SCREEN_LAG = 0.015; // the eye is overwhelmed a beat AFTER the light arrives
const FLASH_SCREEN_ATTACK = 0.07;
const FLASH_SCREEN_DECAY = 0.24;
const FLASH_EXPOSURE_BOOST = 0.45;
const FLASH_BLOOM_BOOST = 0.4;
/** A sudden bright flash is a photosensitivity trigger, so it is damped hard rather than merely eased. */
const REDUCED_MOTION_FLASH_SCALE = 0.22;

// ── What the star does while it falls (lab: finaleCollapse on SINGULARITY_STATE) ──
/** Crushed inward BEYOND the collapse pose's own spread, so it implodes rather than just shrinking. */
const SHARD_CRUSH = 1.2;
const REDSHIFT_AMOUNT = 0.85;
export const SINGULARITY_REDSHIFT_COLOR = 0xff2600;
const SPIN_UP = 5;
const TREMOR_AMOUNT = 0.09;
/** The anticipation beat builds over this, then is swallowed by the collapse — it hands over. */
const TREMOR_IN = 0.14;
/** Radians per unit of sequence — about three shudders across the beat. */
const TREMOR_FREQUENCY = 140;
const TREMOR_PHASE_STEP = 0.9;
const TREMOR_SPIN_LIFT = 0.8;
const TREMOR_GLOW_SWELL = 0.5;

/**
 * ⚠ The Singularity grade is DIMMER than the collapse pose it inherits from, and that is not a mistake.
 *
 * Collapse was authored as a white-hot end state and is right on its own. Singularity then stacks a
 * supernova flash on top of that same grade, which clips the frame to white and buries the very thing
 * it is meant to be revealing. Every contributor is pulled down together — grading only one just moves
 * where the clipping happens. Lab values: exposure 1.6 → 1.05, bloom 2.5 → 1.15, core light 18 → 8.
 */
export const SINGULARITY_EXPOSURE = 1.05;
export const SINGULARITY_BLOOM_STRENGTH = 1.15;
export const SINGULARITY_CORE_LIGHT_INTENSITY = 8;
/** Bloom settles here as the hole forms — only the bloom; exposure and lights stay glowy. */
const BLACKHOLE_BLOOM_STRENGTH = 0.44;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * A flash envelope with a sustained plateau: rise → HOLD → fall.
 *
 * The hold is the whole point. A pulse that peaks and immediately decays reads as a camera flash; a
 * supernova floods the frame and STAYS flooded while the thing that caused it resolves underneath.
 * That plateau is the window the black hole forms inside.
 */
function flashEnvelope(
  value: number,
  peak: number,
  attack: number,
  hold: number,
  decay: number,
): number {
  if (value <= peak - attack || value >= peak + hold + decay) return 0;
  if (value < peak) {
    const rise = (value - (peak - attack)) / attack;
    return rise * rise;
  }
  if (value <= peak + hold) return 1;
  const fall = (value - (peak + hold)) / decay;
  return (1 - fall) * (1 - fall);
}

/** Everything a frame of the finale needs, derived from the sequence alone. */
export interface SingularityFrame {
  /** 0 = the star intact, 1 = gone. The ACCELERATING curve, not a smoothstep — see below. */
  collapse: number;
  /** Multiplier on the sun model's scale. */
  modelScale: number;
  /** Extra inward crush on the fracture shards, added to the collapse pose's own spread. */
  shardCrush: number;
  /** Per-shard shudder, in shard-radius units. Apply with `tremorOffset`. */
  tremor: number;
  /** How far the magma's emissive is pulled toward the redshift colour. */
  redshift: number;
  /** Multiplier on the star's rotation rate — a contracting star spins up. */
  spinMultiplier: number;
  /** Multiplier on the core light, which swells as it strains then is sucked in. */
  coreLightScale: number;
  /** 0 → 1 as the event horizon opens from the middle. */
  horizonForm: number;
  /** The disc assembling around the finished hole. */
  ringFormEarly: number;
  ringFormLate: number;
  /** The detonation itself — a bright core at the origin. 0 when there is nothing to show. */
  corePulse: number;
  /** How far the burst quad has expanded, 0..1, monotonic across the whole pulse. */
  coreExpand: number;
  /** Additive tone-mapping exposure from the screen-wide flash. */
  exposureBoost: number;
  /** The bloom strength this frame, already graded from star → hole and flashed on top. */
  bloomStrength: number;
}

/**
 * Evaluate the whole finale at `sequence`.
 *
 * Allocation-free apart from the returned object, which the caller is expected to hold and reuse if it
 * cares — this runs at most once a frame and only while the finale is on screen.
 */
export function evaluateSingularity(
  sequence: number,
  reduceMotion: boolean,
): SingularityFrame {
  const clamped = Math.min(Math.max(sequence, 0), 1);
  const explode = smoothstep(EXPLODE[0], EXPLODE[1], clamped);

  // The sun collapses on an ACCELERATING curve. Smoothstep decelerates into its end, which reads as a
  // slider being dragged; gravity does the opposite — barely moves, then plummets. Cubing is what makes
  // the last of the star vanish fast.
  const collapse = explode * explode * explode;

  // The anticipation beat, swallowed by the collapse so it hands over rather than competing.
  const tremor = TREMOR_AMOUNT * smoothstep(0, TREMOR_IN, clamped) * (1 - collapse);

  const horizonForm = smoothstep(HORIZON[0], HORIZON[1], clamped);

  const flashStrength = FLASH_STRENGTH * (reduceMotion ? REDUCED_MOTION_FLASH_SCALE : 1);
  const corePulse = flashEnvelope(
    clamped,
    FLASH_AT,
    FLASH_ATTACK,
    FLASH_HOLD * FLASH_CORE_HOLD_FRACTION,
    FLASH_CORE_DECAY,
  );
  const screenPulse = flashEnvelope(
    clamped,
    FLASH_AT + FLASH_SCREEN_LAG,
    FLASH_SCREEN_ATTACK,
    FLASH_HOLD,
    FLASH_SCREEN_DECAY,
  );
  // Expansion is monotonic across the whole pulse while brightness rises then falls — so the light
  // keeps travelling outward as it dies, instead of shrinking back into itself.
  const coreExpand = smoothstep(
    FLASH_AT - FLASH_ATTACK,
    FLASH_AT + FLASH_HOLD * FLASH_CORE_HOLD_FRACTION + FLASH_CORE_DECAY,
    clamped,
  );

  return {
    collapse,
    modelScale: 1 - collapse,
    shardCrush: SHARD_CRUSH * collapse,
    tremor,
    redshift: REDSHIFT_AMOUNT * collapse,
    spinMultiplier: 1 + (SPIN_UP - 1) * collapse + TREMOR_SPIN_LIFT * tremor,
    // The glow LEAVES with the star — its emissive body is gone and its core light is sucked in too.
    coreLightScale: (1 - explode) * (1 + TREMOR_GLOW_SWELL * tremor),
    horizonForm,
    ringFormEarly: smoothstep(RING_FORM_EARLY[0], RING_FORM_EARLY[1], clamped),
    ringFormLate: smoothstep(RING_FORM_LATE[0], RING_FORM_LATE[1], clamped),
    corePulse: corePulse * flashStrength,
    coreExpand,
    exposureBoost: screenPulse * flashStrength * FLASH_EXPOSURE_BOOST,
    bloomStrength:
      SINGULARITY_BLOOM_STRENGTH +
      (BLACKHOLE_BLOOM_STRENGTH - SINGULARITY_BLOOM_STRENGTH) * horizonForm +
      screenPulse * flashStrength * FLASH_BLOOM_BOOST,
  };
}

/**
 * The shudder offset for one shard, in the same units the crush is expressed in.
 *
 * Per-shard phase so they strain out of step; in lockstep it reads as one mechanical pulse rather than
 * a star coming apart. Purely a function of the sequence, so scrubbing back reproduces it exactly.
 */
export function tremorOffset(shardIndex: number, sequence: number, tremor: number): number {
  if (tremor <= 0) return 0;
  return Math.sin(sequence * TREMOR_FREQUENCY + shardIndex * TREMOR_PHASE_STEP) * tremor;
}
