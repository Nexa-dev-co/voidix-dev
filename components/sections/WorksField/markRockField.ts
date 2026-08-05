import * as THREE from 'three';

/**
 * The base rock, as a field rather than as a mesh.
 *
 * ── Why this isn't just `createMeteorGeometry` ───────────────────────────────────────────────────
 * The geode needs to ask the rock questions a mesh can't answer cheaply: "is this point inside you",
 * "how deep", "where is your skin in this direction". Every one of those is closed-form for a carved
 * icosphere, because the carve is purely RADIAL — `meteorBody.ts` displaces each vertex along its own
 * direction and nothing else, so the rock is a height field over the unit sphere and the mesh is only
 * one way of drawing it.
 *
 * That single property is what the whole geode rests on: the crust mask, the growth delay and the
 * cling all fall out of one number. See `docs/mark-core-rock-plan.md` §2.
 *
 * ── The rock is placed, not centred ──────────────────────────────────────────────────────────────
 * It has its own centre, scale, stretch and seed, and the mark grows out of wherever it sits. Putting
 * it in the crook of a "V" is the difference between two arms reaching out of a rock and an egg with
 * two bites taken out of it.
 *
 * ── The distance is RADIAL, not Euclidean ────────────────────────────────────────────────────────
 * `signedDistanceToRock` measures along the ray from the centre, in the rock's own unstretched frame.
 * That is not a true SDF — for a lumpy stretched body the two differ. It doesn't matter: every
 * consumer normalises it (a smoothstep band, a 0..1 ramp), so only its sign and its ordering carry
 * meaning and both are exact. A real SDF would mean a mesh distance query per vertex for no visible
 * gain.
 */

// The same three lobes that carve the field's meteors, so the base rock is visibly a sibling of the
// rocks in the works field rather than a new species. Scaled by `carveAmplitude`, which can flatten
// it toward a smooth egg without leaving the family.
const LOBE_LARGE = { frequency: 1.6, amplitude: 0.3 };
const LOBE_MEDIUM = { frequency: 3.4, amplitude: 0.15 };
const LOBE_FINE = { frequency: 7.1, amplitude: 0.06 };

/** Clamp so a deep lobe can never punch through the centre and turn the field inside out. */
const MIN_RADIUS_FRACTION = 0.55;

/** Stretch is divided by, so it can never be zero. */
const MIN_STRETCH = 0.05;

const TOTAL_LOBE_AMPLITUDE =
  LOBE_LARGE.amplitude + LOBE_MEDIUM.amplitude + LOBE_FINE.amplitude;

export interface RockField {
  /** Where the rock sits, in the mark's own space. */
  centre: THREE.Vector3;
  radius: number;
  stretch: THREE.Vector3;
  seed: number;
  /** Multiplies every lobe. 0 is a smooth ellipsoid, 1 is the field meteor's own carve. */
  carveAmplitude: number;
}

/**
 * One directional lobe — the same product of sines as `meteorBody.ts:51`, kept byte-identical on
 * purpose so the two bodies carve the same way.
 */
export function lobeAt(vector: THREE.Vector3, frequency: number, phase: number): number {
  return (
    Math.sin(vector.x * frequency + phase) *
    Math.sin(vector.y * frequency * 1.3 - phase * 1.7) *
    Math.sin(vector.z * frequency * 0.9 + phase * 0.5)
  );
}

/**
 * The same layered lobes as a general 3D field, normalised to roughly −1..1.
 *
 * Used to carve surfaces that aren't spheres — the mark's own skin — so that a rocky letter and the
 * rock it came out of are made of the same noise at different frequencies.
 */
export function layeredLobeNoise(
  point: THREE.Vector3,
  frequency: number,
  seed: number,
): number {
  const scaled = point.clone().multiplyScalar(frequency);
  const sum =
    LOBE_LARGE.amplitude * lobeAt(scaled, LOBE_LARGE.frequency, seed) +
    LOBE_MEDIUM.amplitude * lobeAt(scaled, LOBE_MEDIUM.frequency, seed * 2.1) +
    LOBE_FINE.amplitude * lobeAt(scaled, LOBE_FINE.frequency, seed * 3.7);
  return sum / TOTAL_LOBE_AMPLITUDE;
}

/** Mean stretch, used to bring local-frame distances roughly back into world units. */
function meanStretch(field: RockField): number {
  return (
    (Math.max(field.stretch.x, MIN_STRETCH) +
      Math.max(field.stretch.y, MIN_STRETCH) +
      Math.max(field.stretch.z, MIN_STRETCH)) /
    3
  );
}

/** A point in the rock's own unstretched frame, where the carve is a pure radial height field. */
function toLocalFrame(
  field: RockField,
  point: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  return target.set(
    (point.x - field.centre.x) / Math.max(field.stretch.x, MIN_STRETCH),
    (point.y - field.centre.y) / Math.max(field.stretch.y, MIN_STRETCH),
    (point.z - field.centre.z) / Math.max(field.stretch.z, MIN_STRETCH),
  );
}

/** How far the rock's skin sits from its centre, in a given unit direction in the local frame. */
function rockRadiusInDirection(
  field: RockField,
  direction: THREE.Vector3,
): number {
  const displaced =
    1 +
    field.carveAmplitude *
      (LOBE_LARGE.amplitude * lobeAt(direction, LOBE_LARGE.frequency, field.seed) +
        LOBE_MEDIUM.amplitude * lobeAt(direction, LOBE_MEDIUM.frequency, field.seed * 2.1) +
        LOBE_FINE.amplitude * lobeAt(direction, LOBE_FINE.frequency, field.seed * 3.7));
  return field.radius * Math.max(displaced, MIN_RADIUS_FRACTION);
}

/**
 * The point on the rock's skin in a given local-frame direction, returned in mark space.
 *
 * This is what the whole body collapses onto at `p = 0`.
 */
export function rockSkinPoint(
  field: RockField,
  localDirection: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  const radius = rockRadiusInDirection(field, localDirection);
  return target
    .copy(localDirection)
    .multiplyScalar(radius)
    .multiply(field.stretch)
    .add(field.centre);
}

/**
 * Signed radial distance from the rock's skin. Negative inside, zero on the skin, positive outside,
 * scaled back to roughly world units by the mean stretch.
 *
 * This one number produces the crust mask, the growth delay and the cling. Nothing else in the geode
 * needs to know where the rock is.
 */
function signedDistanceToRock(field: RockField, point: THREE.Vector3): number {
  const local = toLocalFrame(field, point, new THREE.Vector3());
  const length = local.length();
  const scale = meanStretch(field);

  // Dead centre: no direction to measure along, and it is unambiguously the deepest point inside.
  if (length < 1e-6) return -field.radius * scale;

  const direction = local.divideScalar(length);
  return (length - rockRadiusInDirection(field, direction)) * scale;
}
