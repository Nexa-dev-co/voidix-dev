import * as THREE from 'three';

/**
 * The shared choreography of the services → works "left-flight" (see docs/services-to-works-flight.md).
 *
 * One `0..1` progress value drives the whole crossing. This module turns that progress into a single
 * agreed pose — the camera + the ship — in ONE shared world frame. Both WebGL scenes import it and
 * drive their own objects from the same numbers, so the ship (deck canvas) and the debris/meteors
 * (works canvas) composite as one continuous space.
 *
 * Pure + allocation-free: call {@link createFlightPose} once for a reusable output, then
 * {@link computeFlightPose} every frame to fill it. No side effects, no rendering here.
 *
 * The frame: `+X` right, `+Y` up, `−Z` into the screen. The ship launches UP off the pad with a
 * little LEFT, then flies hard LEFT across space to meteor 01, which sits far to the LEFT. The camera
 * HOLDS still through the launch (the pad + the pinned sun anchor the motion), then TRACKS left from
 * the side, then TURNS to frame the meteor. The sun is a pinned DOM billboard — not driven here.
 */

// ── Framing ───────────────────────────────────────────────────────────────
const FOV_START = 34; // the deck's resting field-of-view (seamless with the fleet at progress 0)
const FOV_END   = 38; // the works resting framing by the time we arrive

// Meteor 01's spot in the shared frame — far to the LEFT, so "fly left" and "approach the meteor" are
// the same direction. The works field aligns its origin (where meteor 01 lives) onto this point.
const METEOR_POSITION: [number, number, number] = [-15, 0, -2];

// ── Camera path (side / tracking) ─────────────────────────────────────────
// HOLD the resting deck pose through the launch (Phase A) so the pad + sun anchor the ship's rise →
// then DOLLY left alongside the ship (Phase B), the ship kept in side profile, debris approaching from
// ahead-left → then TURN to frame meteor 01, landing exactly on the works resting framing (Phase C).
const CAMERA_POSITION_KEYS: Vector3Keyframe[] = [
  { at: 0.0,  value: [  0.0, 1.7, 8.2] }, // resting deck camera
  { at: 0.30, value: [  0.0, 1.7, 8.2] }, // HOLDS through the launch
  { at: 0.55, value: [ -7.0, 1.6, 7.5] }, // tracking left, looking ahead
  { at: 0.75, value: [-13.0, 1.3, 6.5] }, // nearing the meteor
  { at: 1.0,  value: [-15.0, 1.0, 5.0] }, // works resting framing of meteor 01
];
const CAMERA_TARGET_KEYS: Vector3Keyframe[] = [
  { at: 0.0,  value: [  0.0, 0.75,  0.0] },
  { at: 0.30, value: [  0.0, 0.75,  0.0] }, // holds — the ship rises up-left within the frame
  { at: 0.55, value: [ -8.0, 1.0,  -0.5] }, // looks left-ahead down the corridor
  { at: 0.75, value: [-14.0, 0.5,  -1.5] }, // swings toward the meteor
  { at: 1.0,  value: [-15.0, 0.0,  -2.0] }, // meteor 01
];
const CAMERA_FOV_KEYS: ScalarKeyframe[] = [
  { at: 0.0,  value: FOV_START },
  { at: 0.30, value: FOV_START }, // hold through the launch…
  { at: 1.0,  value: FOV_END },   // …then settle into the works framing
];

// ── Ship path ────────────────────────────────────────────────────────────
// Positions are written to the deck's `depart` group (identity `stage` for the centred craft → these
// read as world coordinates). Phase A: rise UP (dominant) with a little LEFT, on the 40/0 → 70/20 →
// 100/30 (up%/left%) ramp. Phase B: fly hard left across. Phase C: ease to a park beside the meteor.
const SHIP_POSITION_KEYS: Vector3Keyframe[] = [
  { at: 0.0,  value: [  0.0, 0.0,  0.0] },
  { at: 0.12, value: [  0.0, 1.12, 0.0] }, // 40% up, 0% left
  { at: 0.21, value: [ -1.0, 1.96, 0.0] }, // 70% up, 20% left
  { at: 0.30, value: [ -1.5, 2.8,  0.0] }, // 100% up, 30% left
  { at: 0.55, value: [ -8.0, 2.2, -1.0] }, // flying left across
  { at: 0.75, value: [-12.5, 1.0, -2.0] }, // nearing the meteor
  { at: 1.0,  value: [-14.0, 0.3, -2.0] }, // parked just right of meteor 01, in frame
];
// Yaw + bank on the `depart` group (euler radians), layered on the ship's resting local view. The
// hull's nose is turned to SCREEN-LEFT and HELD (this is a side pass, so the profile stays). Empirical
// datum: `depart.y ≈ 2.0 → nose screen-left`.
const SHIP_ROTATION_KEYS: Vector3Keyframe[] = [
  { at: 0.0,  value: [0.0, 0.0,  0.0] },
  { at: 0.15, value: [0.0, 2.0, -0.25] }, // nose swings screen-LEFT, banked into the rise
  { at: 0.55, value: [0.0, 2.0, -0.08] }, // holds nose-left, levelling
  { at: 1.0,  value: [0.0, 1.9,  0.0] },  // parked, presenting its flank
];
const SHIP_SCALE_KEYS: ScalarKeyframe[] = [
  { at: 0.0, value: 1.0 },
  { at: 1.0, value: 1.0 },
];

interface Vector3Keyframe {
  at: number;
  value: [number, number, number];
}
interface ScalarKeyframe {
  at: number;
  value: number;
}

/** The full pose for one progress value — every object the flight moves, in the shared frame. */
export interface FlightPose {
  cameraPosition: THREE.Vector3;
  cameraTarget:   THREE.Vector3;
  cameraFov:      number;
  shipPosition:   THREE.Vector3;
  shipRotation:   THREE.Euler;
  shipScale:      number;
}

/** Allocate a reusable pose the caller fills each frame with {@link computeFlightPose}. */
export function createFlightPose(): FlightPose {
  return {
    cameraPosition: new THREE.Vector3(),
    cameraTarget:   new THREE.Vector3(),
    cameraFov:      FOV_START,
    shipPosition:   new THREE.Vector3(),
    shipRotation:   new THREE.Euler(),
    shipScale:      1,
  };
}

// Smootherstep-interpolate a Vector3 across keyframes; flat-holds outside the first/last stop.
function sampleVector3(keyframes: Vector3Keyframe[], progress: number, out: THREE.Vector3): void {
  const lastIndex = keyframes.length - 1;
  if (progress <= keyframes[0].at) {
    out.fromArray(keyframes[0].value);
    return;
  }
  if (progress >= keyframes[lastIndex].at) {
    out.fromArray(keyframes[lastIndex].value);
    return;
  }
  for (let index = 0; index < lastIndex; index += 1) {
    const from = keyframes[index];
    const to   = keyframes[index + 1];
    if (progress <= to.at) {
      const t = THREE.MathUtils.smootherstep(progress, from.at, to.at);
      out.set(
        THREE.MathUtils.lerp(from.value[0], to.value[0], t),
        THREE.MathUtils.lerp(from.value[1], to.value[1], t),
        THREE.MathUtils.lerp(from.value[2], to.value[2], t),
      );
      return;
    }
  }
}

function sampleScalar(keyframes: ScalarKeyframe[], progress: number): number {
  const lastIndex = keyframes.length - 1;
  if (progress <= keyframes[0].at) return keyframes[0].value;
  if (progress >= keyframes[lastIndex].at) return keyframes[lastIndex].value;
  for (let index = 0; index < lastIndex; index += 1) {
    const from = keyframes[index];
    const to   = keyframes[index + 1];
    if (progress <= to.at) {
      const t = THREE.MathUtils.smootherstep(progress, from.at, to.at);
      return THREE.MathUtils.lerp(from.value, to.value, t);
    }
  }
  return keyframes[lastIndex].value;
}

const rotationSample = new THREE.Vector3();

/** Fill `out` with the flight pose at `progress` (clamped 0..1). Allocation-free. */
export function computeFlightPose(progress: number, out: FlightPose): FlightPose {
  const clamped = THREE.MathUtils.clamp(progress, 0, 1);

  sampleVector3(CAMERA_POSITION_KEYS, clamped, out.cameraPosition);
  sampleVector3(CAMERA_TARGET_KEYS,   clamped, out.cameraTarget);
  out.cameraFov = sampleScalar(CAMERA_FOV_KEYS, clamped);

  sampleVector3(SHIP_POSITION_KEYS, clamped, out.shipPosition);
  sampleVector3(SHIP_ROTATION_KEYS, clamped, rotationSample);
  out.shipRotation.set(rotationSample.x, rotationSample.y, rotationSample.z);
  out.shipScale = sampleScalar(SHIP_SCALE_KEYS, clamped);

  return out;
}

/** Where meteor 01 sits in the shared frame — the works field aligns its origin to this. */
export const METEOR_SHARED_POSITION = METEOR_POSITION;
