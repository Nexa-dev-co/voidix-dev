// Ceilings that exist because a scene can only render so much — not because of taste.
//
// These are the numbers the admin panel enforces so it can't create a state the site is unable to
// draw. Each one is a real coupling in the WebGL work, documented with what actually breaks, because
// a limit whose reason isn't written down gets "fixed" by raising it.

/**
 * How many projects the works field can show.
 *
 * A project in the works field is a CAMERA POSE, not a place — the camera moves around one meteor and
 * parks at authored stops. Those stops are hand-recorded against the live scene in
 * `worksTuning.PROJECT_VIEW_KEYS` (each key tagged `stop: 0…3`), because a camera path can only be
 * judged by eye.
 *
 * `projectCount` feeds `stopCount` in the hero pin, so a fifth project would create a scroll snap
 * position with no pose to fly to — the camera would have nowhere to go and the section would break
 * at the end of the scroll.
 *
 * **Raising this means authoring a new camera stop first.** Add the key in `worksTuning.ts`, then
 * bump this number; the assertion in that file fails if the two disagree, in either direction.
 */
export const MAX_WORKS_PROJECTS = 4;
