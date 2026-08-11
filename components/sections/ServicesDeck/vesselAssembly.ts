import * as THREE from 'three';
import { frameExtentAt, aimLineYAt } from './deckFrame';
import { VESSEL_PARTS, VESSEL_WAVE_COUNT, type VesselPart } from './vesselParts';
import type { DeckTuning } from './deckTuning';

/**
 * The vessel's assembly: nine parts, each blended between a holding pose and its socket by one
 * scrubbed number.
 *
 * ── The one structural decision ──────────────────────────────────────────────────────────────────
 * A part is never RE-PARENTED. The obvious build keeps loose parts in a swarm group and moves them
 * into the hull when they lock, but a re-parent is a discontinuity in the middle of a scrub: it
 * happens on one frame, at a threshold, and it reverses badly — exactly the class of bug
 * `docs/services-to-works-flight.md` was written about. Instead every part stays a child of the same
 * group for its whole life and its transform each frame is a blend:
 *
 *      holding pose  ◄──────── assembly 0..1 ────────►  socket, rigid with the hull
 *      (frame-anchored,                                 (resolved THROUGH `spin`, so the
 *       drifting, tumbling)                              hull's yaw carries it)
 *
 * Three things fall out of that, and all three are wanted:
 *   • at 1 the part is EXACTLY rigid with the hull — no seam to reconcile before the flight;
 *   • drag-to-look grabs a part in proportion to how attached it is (a half-locked wing follows your
 *     drag half way), because the socket is resolved through the live `spin` matrix every frame;
 *   • it reverses perfectly, because it is a pure function of one number.
 *
 * ── The rig ──────────────────────────────────────────────────────────────────────────────────────
 *      lift ─┬─► spin    the hull's yaw/pitch: base view + turntable + drag. EMPTY — it exists only
 *            │           as the reference frame a socket resolves through.
 *            └─► parts ─► 9 clusters, each carrying its own normalisation scale.
 *
 * ⚠ `spin` is a SIBLING of the parts, not their ancestor, and that is the point: a loose part must not
 * inherit the showroom turntable. Debris drifting at the edge of frame that rotates in lockstep with
 * the ship reads as a carousel, not as a swarm.
 */

// ── The travel path ──────────────────────────────────────────────────────────────────────────────
// ⚠ A CUBIC BÉZIER, not a lerp. The first build of this shipped `holding.lerp(socket, blend)` — a
// straight line — and a straight line is what makes assembly animation look cheap, however well the
// timing is shaped on top of it. The four control points buy two separate things:
//
//        holding ●━━━━━━━━━━━━━━━━━━━━●  socket           BEFORE
//                      (straight)
//
//                 ╭─────────────╮                         AFTER
//        holding ●╯             ╰──╮
//                 ↑                 ╲
//              P1 │ swings ALONG      ╰──●━━━━►● socket
//                 │ the ring          P2      P3
//                                      └── final approach runs along the
//                                          part's own mounting axis
//
// P1 is TANGENTIAL to the holding ring, so a part sweeps around into frame rather than diving at the
// centre — and it is derived from the part's live offset on that ring, so it stays right at every
// aspect for free. P2 sits out along `approachFrom`, so the last stretch runs down the axis the part
// mounts on: a wing slides inboard, a nacelle lowers onto the hull, the core slots forward. That is
// the difference between a part ARRIVING AT its position and a part FITTING INTO it.
//
// P0 = holding and P3 = socket exactly, so both ends of the scrub are untouched and reversal is exact.

// ── The lock ──
// A part that lerps smoothly into place reads as FLOATING into position. A machine part should ARRIVE.
/** Travel: the long curved approach, decelerating. Ends with the part still short of its socket. */
const TRAVEL_END = 0.82;
/** Align: tumble resolves to the socket's orientation. The part is presented, held just outside. */
const ALIGN_END = 0.92;
/** How far in the part has got by the time it is presented — the last 10% is the lock itself. */
const PRESENT_BLEND = 0.9;
/** A small overshoot through the lock, gone by the time it closes. This is what makes it read hard. */
const LOCK_OVERSHOOT = 0.055;

// ── Anticipation ──
// A wind-up before the commitment. Shaped as sin(π·t) over its own window so it is exactly 0 at BOTH
// ends — it cannot disturb the endpoints, and it cannot survive past its window into the travel.
const ANTICIPATION_END = 0.12;
const WIND_UP_DISTANCE = 0.11; // stage units, against a 2.3-wide hull

// ── The seam flash ──
/**
 * Peak emissive multiplier at the instant of contact.
 *
 * ⚠ Cut from 2.6 on 2026-08-11. At that value the lock was the single brightest event on the deck and
 * it blew straight through the bloom threshold, so every part arrived with a FLARE — the opposite of a
 * circuit coming to life. It is a tick now, and the light that matters comes AFTER, over TRIM_WARM_SPAN.
 */
const FLASH_STRENGTH = 0.85;

// ── The settle ──
// The part's own clunk as it seats: a damped oscillation ALONG its approach axis, a couple of cycles.
// Distinct from `kick` below, which is the whole body being hit. Driven off progress past the wave's
// end so it stays a pure function of the scrub.
const SETTLE_AMPLITUDE = 0.028; // stage units
const SETTLE_SPAN = 0.06;       // in overall assembly progress
const SETTLE_FREQUENCY = 26;
const SETTLE_DAMPING = 7;

// ── The kick ──
// The assembled body takes an impulse when a wave locks and damps it out.
const KICK_AMPLITUDE = 0.035; // radians
const KICK_DECAY_SPAN = 0.09; // in overall assembly progress
const KICK_FREQUENCY = 34;
const KICK_DAMPING = 5.5;

// ── The idle swarm ──
// ⚠ Two axes at INCOMMENSURATE rates. Real tumbling debris precesses; a single axis at a constant rate
// is the most mechanical motion there is and reads as a spinning prop. The ratio is 1/φ, so the
// compound rotation never visibly repeats.
const TUMBLE_RATIO = 0.6180339887;
/** Three coprime-ish frequencies, so a loose part wanders a small 3-D figure instead of pulsing. */
const DRIFT_FREQUENCIES: [number, number, number] = [0.41, 0.29, 0.23];
const DRIFT_AMPLITUDE = 0.19;
/**
 * Nothing may hold closer to the centreline than this, whatever the ring says.
 *
 * ⚠ This is what stops a portrait frame putting the swarm inside the ship. The ring is a fraction of
 * the frame, and at 390 px the frame's half-width collapses to roughly the hull's own half-extent — so
 * a part authored at 0.74 of it would wait *inside* the machine it is waiting to join. Pushed out
 * along its own direction instead, which on a tall frame naturally sends it over the top or bottom.
 */
const MIN_HOLD_WORLD_RADIUS = 1.7;

// ── Ignition ──
// Wave 4 closes and the machine comes alive — from the CORE OUTWARD, not everywhere at once.
//
// ⚠ Where it STARTS is derived, not written down: it is the progress at which the last wave finishes
// locking (see `travelSpan` in vesselParts). It used to be a hardcoded 0.93, which sat *before* wave 4
// had finished travelling — so the hull was already ~70% lit by the time the last piece actually
// arrived, which is the ignition happening over the top of its own cue.
const IGNITION_BRIGHTNESS_GAIN = 0.55;
const IGNITION_EMIT_GAIN = 1.1;
/**
 * How much of the ignition window is spent PROPAGATING rather than rising.
 *
 * 0 lights every part simultaneously (what this used to do); 0.55 means the outermost part only starts
 * when the innermost is 55% of the way up, so the light visibly runs out along the hull. Wave 4 is 83
 * triangles a side and was never going to carry the finale on geometry — this is what it carries it on,
 * and it makes the narrative literal: the intelligence arrives last, and the intelligence is what
 * switches the machine on.
 */
const IGNITION_SPREAD = 0.55;

// ── The circuitry's three levels ──
// ⚠ This is what makes a part NOT bloom at the moment it connects. The trim comes up in TWO stages: it
// reaches LOCKED_TRIM_LEVEL as the part seats — deliberately just UNDER the bloom threshold, so contact
// is a mechanical event rather than a light show — and only then warms the rest of the way over
// TRIM_WARM_SPAN of scroll, crossing into bloom as it goes. The machine powers up; it does not switch on.
/** How dim a loose part's circuitry runs while it is still adrift. */
const LOOSE_TRIM_LEVEL = 0.22;
/** Where it sits the instant it locks. `trimGlow` × this must stay below BLOOM_THRESHOLD. */
const LOCKED_TRIM_LEVEL = 0.42;
/** How much scroll the warm-up from LOCKED_TRIM_LEVEL to full takes, in overall assembly progress. */
const TRIM_WARM_SPAN = 0.085;

export interface AssemblyPart {
  spec: VesselPart;
  /** The cluster's node, straight out of the GLB, re-parented under `parts`. */
  group: THREE.Object3D;
  /** Where this part belongs, in `parts` space (normalised, ground-offset applied). */
  socket: THREE.Vector3;
  /** The model's own base orientation, which the socket pose must preserve. */
  baseQuaternion: THREE.Quaternion;
  /** Resolved from the live frame on every resize — see resolveHoldingPoses. */
  holding: THREE.Vector3;
  /**
   * The holding position's offset from the RING'S OWN CENTRE, in the screen plane.
   *
   * ⚠ Not the same as `holding.x/y`, and the difference is not cosmetic. The ring is centred on the
   * camera's aim line at the part's depth, which is well below y = 0 — so taking the perpendicular of
   * the raw position would give a "tangent" that is not tangential to anything, and the swing would
   * bias every part the same way instead of sweeping each one round its own arc.
   */
  ringOffset: THREE.Vector2;
  /** Unit direction the part comes FROM on its final approach, in ship space. */
  approachDirection: THREE.Vector3;
  tumbleAxis: THREE.Vector3;
  tumbleAxisB: THREE.Vector3;
  /** Accumulated tumble angle. Stateful so the tumble can SLOW as the part commits — deriving it from
   *  elapsed time would make any rate change a visible jump. */
  tumblePhase: number;
  /** 0 at the core, 1 at the furthest part: how late this part lights at ignition. */
  ignitionDelay: number;
  /** Assembly progress at which this part finishes seating — drives the settle and the warm-up. */
  lockProgress: number;
  /** This part's own hull uniforms, so a lock can flash one part without lighting the ship. */
  brightness: { value: number };
  emitPulse: { value: number };
}

export interface VesselAssembly {
  /** Empty; the reference frame a socket resolves through. */
  spin: THREE.Group;
  /** Parent of every cluster. */
  parts: THREE.Group;
  members: AssemblyPart[];
  /** Progress at which the last wave has finished seating — where the ignition begins. */
  ignitionStart: number;
  /** Every distinct wave lock progress, for the whole-body kick. */
  waveLockProgress: number[];
}

/** Smootherstep — zero first AND second derivative at both ends, so a scrub never shows a corner. */
function smootherstep(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * How far along its travel a part has got, shaped into travel → align → lock.
 * Exactly 0 at 0 and exactly 1 at 1, so the ends are seamless in both directions.
 */
function lockCurve(travel: number): number {
  if (travel <= TRAVEL_END) {
    return PRESENT_BLEND * smootherstep(travel / TRAVEL_END);
  }
  if (travel <= ALIGN_END) return PRESENT_BLEND;
  const lock = (travel - ALIGN_END) / (1 - ALIGN_END);
  // Fast close (cubic out) plus an overshoot that peaks mid-lock and is gone by the end.
  const closed = PRESENT_BLEND + (1 - PRESENT_BLEND) * (1 - (1 - lock) ** 3);
  return closed + LOCK_OVERSHOOT * Math.sin(Math.PI * lock) * (1 - lock);
}

/** Progress at which a part has finished seating: its wave's start, plus however much of the quarter
 *  that wave's travel is allowed to occupy. */
function partLockProgress(spec: VesselPart): number {
  const waveSpan = 1 / VESSEL_WAVE_COUNT;
  return (spec.wave - 1) * waveSpan + waveSpan * (spec.travelSpan ?? 1);
}

/** 0..1 across this part's own slice of its wave's quarter. */
function partTravel(spec: VesselPart, progress: number): number {
  const waveSpan = 1 / VESSEL_WAVE_COUNT;
  const waveStart = (spec.wave - 1) * waveSpan;
  const raw = THREE.MathUtils.clamp(
    (progress - waveStart) / (waveSpan * (spec.travelSpan ?? 1)),
    0,
    1,
  );
  // The stagger eats into the FRONT of the travel, never the end — so however late a part leaves, the
  // whole wave still lands exactly on its stop.
  return THREE.MathUtils.clamp((raw - spec.stagger) / (1 - spec.stagger), 0, 1);
}

/**
 * Build the rig from a loaded vessel.
 *
 * Each cluster is lifted out of the model's hierarchy and given the normalisation itself, so that
 * `parts` space is stage space: a socket, a holding position and the `spin` reference all measure in
 * the same units, and the blend between them is a plain lerp with nothing to convert.
 */
export function createVesselAssembly(
  loadedScene: THREE.Object3D,
  targetSize: number,
  baseYaw: number,
  rotationDegrees?: { x?: number; y?: number; z?: number },
): VesselAssembly {
  const baseQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(rotationDegrees?.x ?? 0),
      THREE.MathUtils.degToRad(rotationDegrees?.y ?? 0),
      THREE.MathUtils.degToRad(rotationDegrees?.z ?? 0),
    ),
  );

  // Measured on the model as it ships. The base rotation cannot change the largest dimension, so the
  // normalisation is the same either way; the ground offset below is measured after it is applied.
  const modelBox = new THREE.Box3().setFromObject(loadedScene);
  const modelSize = modelBox.getSize(new THREE.Vector3());
  const modelCentre = modelBox.getCenter(new THREE.Vector3());
  const scale =
    targetSize / (Math.max(modelSize.x, modelSize.y, modelSize.z) || 1);

  const spin = new THREE.Group();
  spin.rotation.y = baseYaw;
  const parts = new THREE.Group();

  const nodesByName = new Map<string, THREE.Object3D>();
  loadedScene.traverse((child) => {
    if (child.name) nodesByName.set(child.name, child);
  });

  const members: AssemblyPart[] = VESSEL_PARTS.map((spec) => {
    const node = nodesByName.get(spec.node);
    if (!node) {
      // Loud, not silent: a renamed node means a part of the ship would simply never arrive, and the
      // machine would assemble with a hole in it that nothing else would report.
      throw new Error(
        `vessel.glb is missing the node "${spec.node}". Rebuild it with \`npm run build:vessel\` ` +
          `and check EXPECTED_CLUSTERS in scripts/buildVessel.mjs.`,
      );
    }

    // The node's own translation is its socket in model space (buildVessel recentres each cluster's
    // geometry onto it precisely so this is true). Normalise it into stage units.
    const socket = node.position
      .clone()
      .sub(modelCentre)
      .multiplyScalar(scale)
      .applyQuaternion(baseQuaternion);

    node.position.set(0, 0, 0);
    // ⚠ Posed with the base rotation, not identity, because the ground offset below is measured off
    // these boxes. Left at identity it would measure an UNROTATED hull and rest the wrong face of the
    // ship on the stage the moment VESSEL_MODEL_ROTATION is used to settle which end is the nose —
    // which is a change we already know is coming. The render loop overwrites this every frame; only
    // the measurement depends on it.
    node.quaternion.copy(baseQuaternion);
    node.scale.setScalar(scale);
    parts.add(node);

    return {
      spec,
      group: node,
      socket,
      baseQuaternion: baseQuaternion.clone(),
      holding: socket.clone(),
      ringOffset: new THREE.Vector2(),
      approachDirection: new THREE.Vector3(...spec.approachFrom)
        .normalize()
        .applyQuaternion(baseQuaternion),
      tumbleAxis: new THREE.Vector3(...spec.tumbleAxis).normalize(),
      tumbleAxisB: new THREE.Vector3(...spec.tumbleAxisB).normalize(),
      tumblePhase: spec.driftPhase,
      ignitionDelay: 0,
      lockProgress: partLockProgress(spec),
      brightness: { value: 1 },
      emitPulse: { value: 1 },
    };
  });

  // Rest the assembled hull's base on the stage plane, exactly as the fleet's hulls did — measured
  // after normalisation and rotation, from the sockets and their own extents.
  const assembledBox = new THREE.Box3();
  const partBox = new THREE.Box3();
  members.forEach((member) => {
    partBox.setFromObject(member.group);
    partBox.translate(member.socket);
    assembledBox.union(partBox);
  });
  const groundOffset = -assembledBox.min.y;
  members.forEach((member) => {
    member.socket.y += groundOffset;
    member.holding.copy(member.socket);
  });

  // ── Where the ignition starts ──
  // The centre of the LAST wave's sockets — the brain — rather than the ship's origin, so the light
  // genuinely runs out from the part that just arrived.
  const core = new THREE.Vector3();
  const coreMembers = members.filter((member) => member.spec.wave === VESSEL_WAVE_COUNT);
  coreMembers.forEach((member) => core.add(member.socket));
  core.divideScalar(Math.max(1, coreMembers.length));

  const furthest = members.reduce(
    (longest, member) => Math.max(longest, member.socket.distanceTo(core)),
    0,
  );
  members.forEach((member) => {
    member.ignitionDelay = furthest > 0 ? member.socket.distanceTo(core) / furthest : 0;
  });

  const waveLockProgress = Array.from(
    new Set(members.map((member) => member.lockProgress)),
  ).sort((a, b) => a - b);

  return {
    spin,
    parts,
    members,
    // The last wave is in; NOW the machine can light.
    ignitionStart: waveLockProgress[waveLockProgress.length - 1] ?? 1,
    waveLockProgress,
  };
}

/**
 * Re-resolve every holding pose against the live frame. Call on resize and nowhere else — this is the
 * only place the viewport enters the assembly.
 */
export function resolveHoldingPoses(
  assembly: VesselAssembly,
  tuning: DeckTuning,
  aspect: number,
): void {
  assembly.members.forEach((member) => {
    const { holdAngle, holdRadius, holdDepth } = member.spec;
    const frame = frameExtentAt(tuning, aspect, holdDepth);
    const angle = THREE.MathUtils.degToRad(holdAngle);

    const offsetX = Math.cos(angle) * frame.halfWidth * holdRadius;
    const offsetY = Math.sin(angle) * frame.halfHeight * holdRadius;

    // Clear the hull, whatever the frame says (see MIN_HOLD_WORLD_RADIUS).
    const distance = Math.hypot(offsetX, offsetY) || 1;
    const push = Math.max(1, MIN_HOLD_WORLD_RADIUS / distance);

    member.ringOffset.set(offsetX * push, offsetY * push);
    member.holding.set(
      member.ringOffset.x,
      aimLineYAt(tuning, holdDepth) + member.ringOffset.y,
      holdDepth,
    );
  });
}

export interface AssemblyFrame {
  /** 0..1 across the whole build. */
  progress: number;
  elapsed: number;
  deltaSeconds: number;
  reduceMotion: boolean;
  /** Hull brightness at each end of the lit range, from the deck tuning. */
  dormantBrightness: number;
  activeBrightness: number;
  emitPulseAmplitude: number;
  emitPulseSpeed: number;
}

const socketWorld = new THREE.Vector3();
const approachWorld = new THREE.Vector3();
const targetQuaternion = new THREE.Quaternion();
const tumbleQuaternion = new THREE.Quaternion();
const tumbleQuaternionB = new THREE.Quaternion();
const bezierP0 = new THREE.Vector3();
const bezierP1 = new THREE.Vector3();
const bezierP2 = new THREE.Vector3();
const bezierA = new THREE.Vector3();
const bezierB = new THREE.Vector3();
const bezierC = new THREE.Vector3();
const swingTangent = new THREE.Vector3();
const scratch = new THREE.Vector3();

/** de Casteljau on four points, into `out`. Allocation-free. */
function cubicBezier(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
): void {
  bezierA.lerpVectors(p0, p1, t);
  bezierB.lerpVectors(p1, p2, t);
  bezierC.lerpVectors(p2, p3, t);
  bezierA.lerp(bezierB, t);
  bezierB.lerp(bezierC, t);
  out.lerpVectors(bezierA, bezierB, t);
}

/**
 * Drive every part for one frame. Pure in `progress` for everything that matters: the same number
 * always produces the same POSE, which is what lets a fast flick, a covered nav jump and a slow
 * scroll-back all land correctly. (The tumble phase is the one stateful value, and it only governs how
 * a free-floating part is oriented while adrift — the assembled pose is exact regardless.)
 */
export function updateVesselAssembly(
  assembly: VesselAssembly,
  frame: AssemblyFrame,
): void {
  const { progress, elapsed, deltaSeconds, reduceMotion } = frame;

  // `spin` is not drawn; its matrix is the whole reason it exists, and it has to be current before any
  // socket resolves through it.
  assembly.spin.updateMatrix();

  const ignitionSpan = Math.max(1e-4, 1 - assembly.ignitionStart);
  const ignition = smootherstep((progress - assembly.ignitionStart) / ignitionSpan);

  assembly.members.forEach((member) => {
    const travel = partTravel(member.spec, progress);
    // How far past this part's own seating we are — drives both the settle and the circuitry's warm-up.
    const sinceLock = progress - member.lockProgress;
    // Under reduced motion the scrub still drives the build — it is the section's spine, not
    // decoration — but the arc, the overshoot, the tumble and the drift all go.
    const blend = reduceMotion ? travel : lockCurve(travel);
    const orientation = reduceMotion
      ? travel
      : smootherstep(travel / ALIGN_END);

    // ── Where it belongs: the socket, carried by whatever the hull's yaw is doing ──
    socketWorld.copy(member.socket).applyMatrix4(assembly.spin.matrix);
    targetQuaternion.copy(assembly.spin.quaternion).multiply(member.baseQuaternion);
    // The mounting axis turns with the ship too, or a wing would slide in along a direction the hull
    // no longer points.
    approachWorld
      .copy(member.approachDirection)
      .applyQuaternion(assembly.spin.quaternion);

    // ── Where it waits ──
    bezierP0.copy(member.holding);
    if (!reduceMotion) {
      // A 3-D Lissajous wander rather than a bob: three coprime-ish frequencies, so it never repeats
      // and never looks like it is on a timer. Faded out by the travel so a seated part cannot drift.
      const loose = 1 - blend;
      bezierP0.x +=
        Math.sin(elapsed * DRIFT_FREQUENCIES[0] + member.spec.driftPhase) *
        DRIFT_AMPLITUDE * loose;
      bezierP0.y +=
        Math.sin(elapsed * DRIFT_FREQUENCIES[1] + member.spec.driftPhase * 1.7) *
        DRIFT_AMPLITUDE * 0.8 * loose;
      bezierP0.z +=
        Math.sin(elapsed * DRIFT_FREQUENCIES[2] + member.spec.driftPhase * 2.3) *
        DRIFT_AMPLITUDE * 0.6 * loose;
    }

    if (reduceMotion) {
      member.group.position.lerpVectors(bezierP0, socketWorld, blend);
    } else {
      const travelDistance = bezierP0.distanceTo(socketWorld);

      // P1 — tangential to the holding ring, so the part sweeps around rather than diving in. Taken
      // from `ringOffset` (the offset from the ring's own centre) rather than from the world position,
      // for the reason on that field.
      swingTangent.set(-member.ringOffset.y, member.ringOffset.x, 0);
      if (swingTangent.lengthSq() < 1e-6) swingTangent.set(1, 0, 0);
      swingTangent.normalize().multiplyScalar(member.spec.swing * member.spec.arc * travelDistance);
      bezierP1.copy(bezierP0).add(swingTangent);

      // P2 — out along the mounting axis, so the curve ARRIVES down that axis.
      bezierP2
        .copy(socketWorld)
        .addScaledVector(approachWorld, member.spec.approachDistance);

      cubicBezier(bezierP0, bezierP1, bezierP2, socketWorld, blend, member.group.position);

      // ── Anticipation ──
      // A wind-up away from the socket before the part commits. sin(π·t) over its own window, so it is
      // exactly 0 at both ends and cannot leak into the endpoints or survive into the travel.
      if (travel < ANTICIPATION_END) {
        const windUp = Math.sin(Math.PI * (travel / ANTICIPATION_END)) * WIND_UP_DISTANCE;
        scratch.subVectors(bezierP0, socketWorld).normalize().multiplyScalar(windUp);
        member.group.position.add(scratch);
      }

      // ── The settle ──
      // Once the part has landed, it rings along the axis it came in on and damps out.
      if (sinceLock >= 0) {
        const phase = sinceLock / SETTLE_SPAN;
        const ring =
          SETTLE_AMPLITUDE *
          Math.sin(phase * SETTLE_FREQUENCY) *
          Math.exp(-phase * SETTLE_DAMPING);
        member.group.position.addScaledVector(approachWorld, ring);
      }
    }

    // ── Orientation ──
    if (reduceMotion) {
      member.group.quaternion.copy(targetQuaternion);
    } else {
      // The tumble SLOWS as the part commits — it is under control now, not adrift. Accumulated rather
      // than derived from elapsed time, because scaling a rate that multiplies elapsed would make every
      // rate change a visible jump.
      member.tumblePhase +=
        deltaSeconds * member.spec.tumbleSpeed * (1 - orientation);
      tumbleQuaternion.setFromAxisAngle(member.tumbleAxis, member.tumblePhase);
      tumbleQuaternionB.setFromAxisAngle(
        member.tumbleAxisB,
        member.tumblePhase * TUMBLE_RATIO + member.spec.driftPhase,
      );
      tumbleQuaternion.multiply(tumbleQuaternionB);
      member.group.quaternion.slerpQuaternions(
        tumbleQuaternion,
        targetQuaternion,
        orientation,
      );
    }

    // ── The circuitry ──
    // A loose part's trim runs dim and comes up as it joins; the seam flashes at contact; and at
    // ignition the light arrives from the core, later the further out the part sits.
    let flash = 0;
    if (!reduceMotion && travel > ALIGN_END && travel < 1) {
      flash = Math.sin(Math.PI * ((travel - ALIGN_END) / (1 - ALIGN_END))) * FLASH_STRENGTH;
    }
    const breathing = reduceMotion
      ? 1
      : 1 + Math.sin(elapsed * frame.emitPulseSpeed) * frame.emitPulseAmplitude;
    const partIgnition = smootherstep(
      (ignition - member.ignitionDelay * IGNITION_SPREAD) / (1 - IGNITION_SPREAD),
    );

    // Two stages: up to LOCKED_TRIM_LEVEL as the part seats, then the rest over TRIM_WARM_SPAN of
    // scroll AFTER it has. `smootherstep` clamps to 0 while sinceLock is negative, so a part that has
    // not landed yet contributes nothing here.
    const warmUp = smootherstep(sinceLock / TRIM_WARM_SPAN);
    const trimLevel =
      LOOSE_TRIM_LEVEL +
      (LOCKED_TRIM_LEVEL - LOOSE_TRIM_LEVEL) * blend +
      (1 - LOCKED_TRIM_LEVEL) * warmUp;
    member.emitPulse.value =
      breathing * trimLevel + flash + IGNITION_EMIT_GAIN * partIgnition;
    member.brightness.value =
      THREE.MathUtils.lerp(frame.dormantBrightness, frame.activeBrightness, blend) *
      (1 + IGNITION_BRIGHTNESS_GAIN * partIgnition);
  });

  // ── The kick ──
  // Each completed wave hit the body; the body is still ringing. Summed over the waves rather than
  // latched on the last one, so two waves landing close together compound the way they should.
  if (!reduceMotion) {
    let kick = 0;
    for (const lockProgress of assembly.waveLockProgress) {
      const sinceLock = progress - lockProgress;
      if (sinceLock < 0) continue;
      const phase = sinceLock / KICK_DECAY_SPAN;
      kick +=
        KICK_AMPLITUDE *
        Math.sin(phase * KICK_FREQUENCY) *
        Math.exp(-phase * KICK_DAMPING);
    }
    assembly.parts.rotation.z = kick;
    assembly.parts.rotation.x = kick * 0.4;
  } else {
    assembly.parts.rotation.set(0, 0, 0);
  }
}
