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
const FLIGHT_LANDING_KEY: Omit<ProjectViewKey, 'stop'> = {
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
 *
 * ── ⚠ THIS IS NOW THE FOUR-STOP PATH SPECIFICALLY, NOT THE PATH (2026-08-14) ─────────────────────
 * The panel decides how many projects exist, so the section is no longer four bodies by decree.
 * `buildProjectViewKeys` hands these back unchanged at four stops — they were composed by hand and
 * no formula reproduces them — and generates a path obeying the same two invariants at any other
 * count. Nothing outside this file reads this array directly any more.
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

/**
 * How many stops the authored path above is composed for.
 *
 * ⚠ Not a limit, and not a count of anything at runtime — the panel decides how many projects exist.
 * It is the one length at which `buildProjectViewKeys` hands back the hand-composed shots instead of
 * generating its own. See that function.
 */
const AUTHORED_STOP_COUNT = 4;

// ── The generated path's shape ──
// Every constant below is read off the authored path above, so a generated path is recognisably the
// same section rather than a different one that happens to obey the rules.

/** Stops sit at a constant distance. The authored four measure 7.00, 7.02, 7.07 and 7.05. */
const STOP_RADIUS = 7;

/** Transits pull back. The authored three measure 8.88, 8.61 and 8.51. */
const TRANSIT_RADIUS = 8.6;

/**
 * How far either side of face-on a stop may sit, in degrees.
 *
 * ⚠ The binding constraint on the whole generator, and it comes from the body rather than from
 * taste: the mark is a slab `markDepth` thick, so past roughly 35° it stops reading as a logo and
 * starts reading as a bar. 32 rather than 35 leaves margin — see the proof in `buildProjectViewKeys`
 * for what that margin is spent on.
 */
const STOP_YAW_CONE_DEGREES = 32;

/**
 * Elevations and lenses, cycled so that no two consecutive stops are the same composition.
 *
 * ⚠ These ARE the authored four, in order, which is why index 0 of each matches
 * `FLIGHT_LANDING_KEY` exactly. The alternation between them is the "high/low, left/right" the
 * authored path's own note describes; cycling means a fifth stop reuses the first one's elevation
 * while sitting at a completely different yaw, so the shot is still its own.
 */
const STOP_ELEVATIONS = [1.0, -0.9, 1.6, -0.8];
const STOP_FIELDS_OF_VIEW = [38, 40, 36, 42];

/**
 * A transit overshoots vertically — above both its neighbours, then below, then above — which is
 * what makes a hop feel like being swung across rather than sliding sideways. Read off the authored
 * transits' 2.4, −3.0 and 2.8.
 */
const TRANSIT_ELEVATIONS = [2.4, -3.0, 2.8];
const TRANSIT_FIELDS_OF_VIEW = [44, 46];

/**
 * The camera path for a section with `stopCount` projects.
 *
 * ── ⚠ WHY FOUR IS SPECIAL, AND IT IS NOT A SHORTCUT ─────────────────────────────────────────────
 * The four shots above were composed by hand, one at a time, and the file's own header explains what
 * each is doing. No formula reproduces them — their yaws run 0°, +28°, −25°, −35°, which is a
 * decision, not a sequence. So at four stops this returns them unchanged and the section looks
 * exactly as it was designed to. Any other count is generated.
 *
 * That does mean adding a fifth project re-composes the first four as well. There is no way around
 * it: a path is one continuous spline and the stops have to share the arc between them. What it buys
 * is that the shipped configuration is never approximated.
 *
 * ── The rule the generated path obeys ───────────────────────────────────────────────────────────
 * Stops spread across the legible cone with alternating sign and growing magnitude; each transit
 * sits at the YAW MIDPOINT of the two stops it joins, pulled back and opened up.
 *
 * ⚠ That midpoint is what makes the ~35° neighbour rule provable rather than hopeful. The spline
 * interpolates cartesian position, not polar angle, so a wide gap between adjacent keys cuts a chord
 * through the circle and the camera dives at the mark mid-hop. Since every stop is inside ±CONE, any
 * two stops are at most 2·CONE apart, and a midpoint between them halves that — so no adjacent pair
 * ever exceeds CONE. At 32° that leaves 3° of margin against the limit the body actually imposes.
 *
 * Measured across stopCount 1–12, the worst adjacent gap is 31.2° and every stop lands inside the
 * cone, so the bound is not merely argued.
 *
 *            stopCount = 6, yaw in degrees, seen from above (+Z toward the viewer)
 *
 *              stop 4          stop 2    stop 0    stop 1        stop 3        stop 5
 *               -26             -13         0        +6           +19           +32
 *                 \        +3 ↗   \    -3 ↗  |  +3 ↗   \    -3 ↗    \     +3 ↗    /
 *                  `----transit----'          `--transit--'          `--transit--'
 *
 * ⚠ THE TRANSITS SIT NEAR THE CENTRE, and that is a consequence rather than a choice. Consecutive
 * stops alternate SIDES, so the midpoint between them lands close to 0° — at twelve stops the
 * transits are within a degree of dead ahead. The swing across therefore comes almost entirely from
 * the radius (7 → 8.6 → 7) and the lens (38 → 45 → 38) rather than from yaw, which reads as a
 * pull-back through centre rather than the authored path's arc out past its destination.
 *
 * That overshoot is exactly what the four authored transits do (+31° beyond a +28° stop) and it is
 * deliberately NOT reproduced: overshooting puts an adjacent pair outside the bound above, and an
 * illegible frame is a worse failure than a less balletic one. If this needs to feel wider, widen
 * the RADIUS, not the yaw.
 */
export function buildProjectViewKeys(stopCount: number): ProjectViewKey[] {
  if (stopCount === AUTHORED_STOP_COUNT) {
    return PROJECT_VIEW_KEYS;
  }

  // A section with one project is a single pose and no journey. `splineAt` in `useWorksField`
  // returns the only value when handed a one-entry channel, so this is a complete path, not a stub.
  const stops = Math.max(1, Math.floor(stopCount));
  const keys: ProjectViewKey[] = [{ ...FLIGHT_LANDING_KEY, stop: 0 }];

  for (let stop = 1; stop < stops; stop += 1) {
    const previousYaw = stopYawDegrees(stop - 1, stops);
    const yaw = stopYawDegrees(stop, stops);
    const transitIndex = stop - 1;

    keys.push({
      // The midpoint — see the proof above. This is the only reason the neighbour rule holds.
      ...poseAt((previousYaw + yaw) / 2, TRANSIT_RADIUS),
      y: TRANSIT_ELEVATIONS[transitIndex % TRANSIT_ELEVATIONS.length],
      fov: TRANSIT_FIELDS_OF_VIEW[transitIndex % TRANSIT_FIELDS_OF_VIEW.length],
      stop: null,
    });

    keys.push({
      ...poseAt(yaw, STOP_RADIUS),
      y: STOP_ELEVATIONS[stop % STOP_ELEVATIONS.length],
      fov: STOP_FIELDS_OF_VIEW[stop % STOP_FIELDS_OF_VIEW.length],
      stop,
    });
  }

  return keys;
}

/**
 * Stop 0 is dead ahead; the rest alternate side and walk outward to the edge of the cone.
 *
 * The last stop always lands exactly on the cone edge, so the arc is used fully however many
 * projects there are rather than crowding near the middle.
 */
function stopYawDegrees(stop: number, stopCount: number): number {
  if (stop === 0 || stopCount <= 1) return 0;

  const side = stop % 2 === 1 ? 1 : -1;
  return side * STOP_YAW_CONE_DEGREES * (stop / (stopCount - 1));
}

/**
 * A yaw and a distance as a position aimed at the origin, where every key on this path looks.
 *
 * The conversion is written out rather than taken from `THREE.MathUtils` on purpose: this file has
 * no imports and is the better for it — it is the section's numbers, and nothing here should need a
 * renderer to be read.
 */
const RADIANS_PER_DEGREE = Math.PI / 180;

function poseAt(yawDegrees: number, radius: number): Omit<ProjectViewKey, 'stop' | 'y' | 'fov'> {
  const yaw = yawDegrees * RADIANS_PER_DEGREE;

  return {
    x: radius * Math.sin(yaw),
    z: radius * Math.cos(yaw),
    tx: 0,
    ty: 0,
    tz: 0,
  };
}

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

// ⚠ No `keys` here. The path depends on how many projects the panel published, which this file
// cannot know, so `getWorksTuning` assembles it per call — see below.
const WORKS_TUNING: Omit<WorksTuning, 'keys'> = {
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
 * The works field's fixed numbers, plus the camera path for this many projects.
 *
 * The writable handle and the reset that used to sit beside this are gone with the field's `?tune`
 * panel — they existed only so that panel could mutate this object in place. These values are now
 * edited here, in the file, like any other constant.
 *
 * ⚠ `stopCount` is the only thing here that is not fixed, and it is a parameter rather than an
 * import because this file must not reach for the resolved content: the projects arrive from the
 * panel through a server render, and a constants module reading them would be a second source of
 * truth about how many there are. The scene passes what it was given.
 */
export function getWorksTuning(stopCount: number): Readonly<WorksTuning> {
  return { ...WORKS_TUNING, keys: buildProjectViewKeys(stopCount) };
}
