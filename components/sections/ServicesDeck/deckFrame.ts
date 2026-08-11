import * as THREE from 'three';
import type { DeckTuning } from './deckTuning';

/**
 * How much world the deck's camera can actually see, at any depth.
 *
 * This is the one piece of maths that makes the vessel's loose parts responsive. They are authored as
 * an ANGLE and a RADIUS on a ring measured in fractions of the live frame — never as world offsets —
 * and this resolves that ring against whatever viewport is in front of us.
 *
 * ⚠ The reason it cannot be world constants is written into the portal gates this replaces:
 *
 *   "At portrait the visible half-width at the stage collapses to ~1.2 world units while every hull is
 *    normalised to 2.3, so a fixed lateral offset puts both gates off-screen by roughly 3×."
 *
 * A part parked at a fixed world x is comfortably at the edge of a 16:9 frame and a screen and a half
 * away on a 390 px phone. Resolved through here, the same authored angle simply arrives over the top
 * of a portrait frame instead of round the side of a landscape one — no second authoring pass, and no
 * breakpoint.
 */

export interface FrameExtent {
  /** Half the visible width at the requested depth, in world units. */
  halfWidth: number;
  /** Half the visible height at the same depth. */
  halfHeight: number;
}

/**
 * The visible half-extents on the plane at world `z`.
 *
 * `z` is a world coordinate, not a distance: 0 is the stage the vessel assembles on, negative is
 * behind it (further from the camera, so a bigger frame).
 */
export function frameExtentAt(
  tuning: Pick<DeckTuning, 'cameraDistance' | 'cameraHeight' | 'cameraLookY' | 'cameraFov'>,
  aspect: number,
  z: number,
): FrameExtent {
  const viewDistance = Math.hypot(
    tuning.cameraDistance,
    tuning.cameraHeight - tuning.cameraLookY,
  );
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(tuning.cameraFov / 2));
  // The camera looks slightly DOWN, so a world-z offset is not quite a depth offset. This is the z
  // component of its forward axis — ~0.993 at the resting shot, but it stays honest if the camera is
  // ever raised.
  const forwardZ = tuning.cameraDistance / viewDistance;
  const halfHeight = (viewDistance - z * forwardZ) * tanHalfFov;
  return { halfHeight, halfWidth: halfHeight * (aspect || 1) };
}

/**
 * Where the camera's aim line sits vertically on the plane at world `z`.
 *
 * The camera looks down at `cameraLookY`, so "the middle of the frame" is not y = 0 anywhere except at
 * the stage — a part placed at a fixed y drifts out of shot as it moves back. Ring positions are
 * measured from this line.
 */
export function aimLineYAt(
  tuning: Pick<DeckTuning, 'cameraDistance' | 'cameraHeight' | 'cameraLookY'>,
  z: number,
): number {
  return (
    tuning.cameraHeight +
    (tuning.cameraLookY - tuning.cameraHeight) *
      ((tuning.cameraDistance - z) / tuning.cameraDistance)
  );
}
