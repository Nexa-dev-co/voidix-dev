/**
 * The works field's numbers — the camera's path around the one meteor, and the rock itself.
 *
 * ── The shape of this, and why ───────────────────────────────────────────────────────────────────
 * There used to be four meteors and the camera flew between them; a project was a PLACE. Now there is
 * one rock and the camera moves around it, so a project is a POSE. That turns the whole section into
 * a recorded camera path — the same model the chamber's showcase already uses, for the same reason:
 * a path like this can only be judged by eye, so it's authored against the live scene in the `?tune`
 * panel and baked back in here.
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
 * The tuner has a button that writes it exactly; don't hand-edit it to something else.
 */

import { snapshotDefaults, restoreInPlace } from '@/lib/tunerReset';

/** One pose on the path around the rock. */
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
 * ⚠ PLACEHOLDER — these are a plain orbit at the flight's radius, enough for the section to run and for
 * the tuner to have something to fly from. They are not authored. Replace this array wholesale with the
 * keys recorded in the `?tune` panel.
 */
export const PROJECT_VIEW_KEYS: ProjectViewKey[] = [
  { ...FLIGHT_LANDING_KEY, stop: 0 },
  { x: 5.0, y: 1.6, z: 5.0, tx: 0, ty: 0, tz: 0, fov: 38, stop: null },
  { x: 7.0, y: 1.0, z: 0.0, tx: 0, ty: 0, tz: 0, fov: 38, stop: 1 },
  { x: 5.0, y: -0.6, z: -5.0, tx: 0, ty: 0, tz: 0, fov: 38, stop: null },
  { x: 0.0, y: 1.2, z: -7.0, tx: 0, ty: 0, tz: 0, fov: 42, stop: 2 },
  { x: -5.0, y: 1.8, z: -5.0, tx: 0, ty: 0, tz: 0, fov: 38, stop: null },
  { x: -7.0, y: 0.8, z: 0.0, tx: 0, ty: 0, tz: 0, fov: 36, stop: 3 },
];

export interface WorksTuning {
  /**
   * The camera path. Lives INSIDE the tuning rather than beside it so the `?tune` panel can splice keys
   * in and out and have the scene pick them up on the next frame — the scene holds this array by
   * reference and rebuilds its spline from it on demand.
   */
  keys: ProjectViewKey[];

  // ── The rock ──
  // One big irregular body, built the same way as the debris that surrounds it (a subdivided icosphere
  // carved by layered directional lobes) — so it reads as the largest member of the same family rather
  // than as a different kind of object. There is no model any more, and no fire shader.
  /** Radius before the lobes carve it. The debris runs 0.05–0.28, so this is what makes it monumental. */
  meteorRadius: number;
  meteorX: number;
  meteorY: number;
  meteorZ: number;
  /** Icosphere subdivisions. Higher = the carving reads as surface rather than as facets. */
  meteorDetail: number;
  /** Which random rock you get. Any integer; nudge it until you like the silhouette. */
  meteorSeed: number;
  /** Per-axis squash, so it's never a sphere. */
  meteorStretchX: number;
  meteorStretchY: number;
  meteorStretchZ: number;
  /** Degrees per second it turns on its own axis. */
  meteorSpin: number;
  /** Facets crisp (true) or smoothed (false). Crisp is what makes it read as rock rather than as putty. */
  meteorFlatShading: boolean;

  // ── Its surface ──
  // ONE texture does both jobs: as the albedo it's dark basalt, and as the EMISSIVE map the same image
  // lights only where it's bright — the lava veins. The rock stays unlit-dark and the cracks glow, which
  // is what replaced the fire shader. The veins then catch the bloom pass the field already runs.
  meteorTextureRepeat: number;
  /** How hard the veins burn. This is the knob that used to be the fire's intensity. */
  meteorEmissive: number;
  /** Tint over the albedo. White keeps the texture exactly as painted. */
  meteorColor: string;
  /** Tint on the glow. Warm keeps it lava; cool makes it something else entirely. */
  meteorEmissiveColor: string;
  meteorRoughness: number;
  meteorMetalness: number;

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

  meteorRadius: 2.6,
  meteorX: 0,
  meteorY: 0,
  meteorZ: 0,
  meteorDetail: 4,
  meteorSeed: 7,
  meteorStretchX: 1.0,
  meteorStretchY: 0.86,
  meteorStretchZ: 1.12,
  meteorSpin: 2.5,
  meteorFlatShading: true,

  meteorTextureRepeat: 2,
  meteorEmissive: 1.6,
  meteorColor: '#ffffff',
  meteorEmissiveColor: '#ff7a2a',
  meteorRoughness: 0.92,
  meteorMetalness: 0.05,

  travelSeconds: 1.6,
  evenPacing: true,
};

// The shipped values, captured before the ?tune panel can touch them.
const WORKS_DEFAULTS = snapshotDefaults(WORKS_TUNING);

/**
 * Put every value back the way it shipped.
 *
 * Restored IN PLACE — the scene holds this object (and the arrays inside it) by reference, so handing
 * back a fresh one would leave it driving the old copy. See lib/tunerReset.
 */
export function resetWorksTuning(): void {
  restoreInPlace(WORKS_TUNING, WORKS_DEFAULTS);
}

/** The works field's fixed numbers. Read once by the scene; never mutated in the app path. */
export function getWorksTuning(): Readonly<WorksTuning> {
  return WORKS_TUNING;
}

/** The same object, writable — for the `?tune` panel and nothing else. See getWritableChamberTuning. */
export function getWritableWorksTuning(): WorksTuning {
  return WORKS_TUNING;
}
