/**
 * The works field's numbers — the camera's path around the one body, and the mark itself.
 *
 * ── The shape of this, and why ───────────────────────────────────────────────────────────────────
 * There used to be four meteors and the camera flew between them; a project was a PLACE. Now there is
 * one body and the camera moves around it, so a project is a POSE. That turns the whole section into
 * a recorded camera path — the same model the chamber's showcase already uses, for the same reason:
 * a path like this can only be judged by eye, so it was authored against the live scene and baked
 * back in here.
 *
 * ── One list, stops tagged ───────────────────────────────────────────────────────────────────────
 * Every key is a camera pose. A key with `stop` set is where a project parks; a key without one is a
 * pass-through the camera splines on its way. That single list answers both questions at once — where
 * each project sits, AND the route taken between them — and adding a bend to a journey is just
 * recording another key in the middle of it.
 *
 *     key 0  ● stop 0 → project 01   ← must match the flight's landing (see below)
 *     key 1  ·  transit
 *     key 2  ● stop 1 → project 02
 *     key 3  ·  transit
 *     key 4  ·  transit
 *     key 5  ● stop 2 → project 03
 *     ...
 *
 * ── The constraint that isn't negotiable ─────────────────────────────────────────────────────────
 * The services→works flight ends with the camera at `sharedCamera(1) − METEOR_SHARED_POSITION`, which
 * resolves to (0, 1.0, 7.0) looking at the origin (see lib/handoffFlightPath.ts). The FIRST STOP has
 * to be that pose, or the ship's arrival ends somewhere the browsing camera isn't and the seam tears.
 * It must be written exactly; don't hand-edit it to something else.
 */


/** One pose on the path around the mark. */
export interface ProjectViewKey {
  /** Where the camera is. */
  x: number;
  y: number;
  z: number;
  /** What it's aimed at — usually the rock, but a key is free to look past it. */
  tx: number;
  ty: number;
  tz: number;
  /** This key's field of view, so a stop can be a tight portrait or a wide establishing shot. */
  fov: number;
  /**
   * Which project parks here, or `null` for a pass-through the camera only travels through.
   * Stops must appear in ascending order — the scroll walks them in sequence.
   */
  stop: number | null;
}

/**
 * The camera's landing pose at the end of the services→works flight. Stop 0 must equal this.
 * Derived, not guessed: it is `CAMERA_POSITION_KEYS.at(1) − METEOR_POSITION` from handoffFlightPath.
 */
export const FLIGHT_LANDING_KEY: Omit<ProjectViewKey, 'stop'> = {
  x: 0,
  y: 1.0,
  z: 7.0,
  tx: 0,
  ty: 0,
  tz: 0,
  fov: 38,
};

/**
 * The path, in order.
 *
 * ── Why this is no longer a full turntable ───────────────────────────────────────────────────────
 * It used to orbit the whole way round — stops at 0, 90, 180 and 270 degrees — which was fine for a
 * carved rock, because a rock looks like a rock from every side. The body is now a MARK: an extruded
 * slab (see `markTargetSize`) only 0.7 thick. Seen from 90 degrees a logo is a bar, so two of those stops
 * would have parked on a project whose mark was unreadable. The old array said of itself that it was
 * a placeholder to be replaced wholesale; this is that replacement.
 *
 * ── The shape it has instead ─────────────────────────────────────────────────────────────────────
 * Every STOP sits within about 35 degrees of face-on, so the mark always reads. The sense of moving
 * around it comes from two things instead of from yaw alone: each stop alternates high/low and
 * left/right with its own field of view, so no two projects are the same composition; and each
 * TRANSIT arcs OUT to roughly 8.6 units with a wider lens before coming back in to 7, so a hop feels
 * like being pulled back and swung across rather than sliding sideways.
 *
 *            transit bulges out to ~8.6           (seen from above, +Z toward the viewer)
 *                  ,--- 1 ---.        ,--- 5 ---.
 *                 /           \      /           \
 *        stop 1  2             \    4  stop 2     6  stop 3
 *        +28deg   \             \  /  -25deg         -35deg
 *                  0  stop 0      3
 *                  0deg (FIXED)   transit, pulled back and low
 *
 * ── Deliberately NOT going edge-on mid-transit ───────────────────────────────────────────────────
 * Swinging to 90 degrees while the mark is in pieces was tempting — it would hide the one moment the
 * body is not legible. But that moment is the two stone streams crossing, which is the whole point of
 * the change: hiding it would mean building it and then looking away. So the camera keeps the mark in
 * view throughout and pulls back instead, which gives the streams more room in frame rather than less.
 *
 * ⚠ Stop 0 is NOT free. It must stay equal to `FLIGHT_LANDING_KEY`, which is derived from where the
 * services -> works flight actually leaves the camera. Move it and the handoff ends with a jump.
 *
 * ⚠ Consecutive keys are kept close in angle on purpose. The spline interpolates CARTESIAN position,
 * not polar angle, so a wide gap cuts a chord through the circle and the camera dives at the mark
 * mid-hop. Every neighbouring pair here stays inside ~35 degrees, which keeps the chord sag small.
 */
export const PROJECT_VIEW_KEYS: ProjectViewKey[] = [
  { ...FLIGHT_LANDING_KEY, stop: 0 },
  { x: 4.6, y: 2.4, z: 7.6, tx: 0, ty: 0, tz: 0, fov: 44, stop: null },
  { x: 3.3, y: -0.9, z: 6.2, tx: 0, ty: 0, tz: 0, fov: 40, stop: 1 },
  { x: 0.4, y: -3.0, z: 8.6, tx: 0, ty: 0, tz: 0, fov: 46, stop: null },
  { x: -3.0, y: 1.6, z: 6.4, tx: 0, ty: 0, tz: 0, fov: 36, stop: 2 },
  { x: -5.6, y: 2.8, z: 6.4, tx: 0, ty: 0, tz: 0, fov: 44, stop: null },
  { x: -4.0, y: -0.8, z: 5.8, tx: 0, ty: 0, tz: 0, fov: 42, stop: 3 },
];

export interface WorksTuning {
  /**
   * The camera path. Lives INSIDE the tuning rather than beside it because the scene holds this array
   * by reference and rebuilds its spline from it, so the two can never disagree about which keys
   * the path is made of.
   */
  keys: ProjectViewKey[];

  // ── The mark ──
  // The section's one body: a project's logo, cut into interlocking stones and grown out of a core,
  // finished with geode on its rim. Everything about how it LOOKS lives in `ACCRETION_TUNING`
  // (`transitions/accretionTransition.ts`) — see `buildMark`. What lives here is only
  // what the SECTION owns: how big the mark is in this scene, and where it sits.
  /**
   * Largest dimension of the mark, in world units.
   *
   * The lab frames at 2.6 with its camera 6.2 out; this scene's orbit sits at radius 7, so the same
   * number reads slightly smaller here. Paired with `markY` it also decides how much of the lower frame
   * the body occupies — the two are authored together, and the frame is the limit on both (see markY).
   */
  markTargetSize: number;
  /**
   * Slab thickness, in WORLD units — never in the source outline's units.
   *
   * ⚠ The mark is a slab, not a ball, and that has a consequence the old rock did not have: seen from
   * 90 degrees it is a bar rather than a logo. The camera keys are authored to keep every STOP within
   * a readable angle and to swing wide only in transit — see PROJECT_VIEW_KEYS.
   */
  markDepth: number;
  markX: number;
  markY: number;
  markZ: number;

  // ── The debris ──
  /** How many times the shared rock texture wraps the ambient shards. */
  shardTextureRepeat: number;

  // ── Travel between stops ──
  /** Seconds one hop takes, however far apart the two stops are. */
  travelSeconds: number;
  /**
   * Re-time the path so the camera moves at an even pace rather than spending one flat slice of time
   * per key. Off, a leg with two keys crawls and a leg with one races.
   */
  evenPacing: boolean;
}

const WORKS_TUNING: WorksTuning = {
  keys: PROJECT_VIEW_KEYS,

  markTargetSize: 2.6,
  markDepth: 0.7,
  markX: 0,
  // Sat low in frame rather than dead centre. The camera still aims at the origin, so dropping the
  // mark below it puts the body in the lower third and leaves the upper frame to the starfield and
  // the section's header copy.
  //
  // ⚠ Bounded by the frame, not by taste: at the orbit's ~7 units and a 38° lens the visible half-
  // height at the mark is ~2.4, so a 2.6-tall mark centred at −0.6 reaches y ≈ −1.9. Push it much
  // lower, or much larger, and the bottom of the mark leaves the frame.
  markY: -0.6,
  markZ: 0,

  shardTextureRepeat: 4.5,

  travelSeconds: 2.05,
  evenPacing: true,
};

/**
 * The works field's fixed numbers. Read once by the scene; never mutated.
 *
 * The writable handle and the reset that used to sit beside this are gone with the field's `?tune`
 * panel — they existed only so that panel could mutate this object in place. These values are now
 * edited here, in the file, like any other constant.
 */
export function getWorksTuning(): Readonly<WorksTuning> {
  return WORKS_TUNING;
}
