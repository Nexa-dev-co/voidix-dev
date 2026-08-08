import * as THREE from 'three';
import { GATHER_DEFAULTS, SUN_BODY_FILL } from '@/components/effects/IntroSequence/gatherShader';

/**
 * The dust orbiting the cracked sun on the services deck.
 *
 * ── Two consumers, two very different cameras ────────────────────────────────────────────────────
 * Lives in `lib/` because the contact star reuses it: the ending's whole premise is that you come back
 * to the star you left, so it has to arrive wearing the same rings. But that star is a real object in
 * the WORKS scene, whose camera sits ~7 world units out, where the hero's sits ~4 model radii out — so
 * `pointSize` is an option rather than a constant. Everything else is shared unchanged.
 *
 * Three crossing bands sweeping across the star, the way a planetary ring sits. So the sun reads as
 * the centre of an orbital system, which is the brand's whole metaphor, rather than as a ball in a
 * cloud. Grains split evenly across whatever is in `RINGS`, in one draw call.
 *
 * The small `tilt` is what makes each one a ring rather than a line. At 0 the plane is exactly edge-on
 * to the camera and the band collapses to a horizontal stroke; ~20° opens it into a flattened ellipse
 * while keeping it clearly horizontal. Don't take it far past that — a near face-on ring stops
 * passing BEHIND the star, and that occlusion on every orbit is the only thing that makes it read as
 * going around something rather than as a decal drawn over the top.
 *
 * ── They outlive the star's own size ─────────────────────────────────────────────────────────────
 * Radii are fractions of the FRAME, not of the model, so when the works section crushes the sun to
 * half scale the bands stay where they are and the star implodes inside them. That is the intended
 * read — matter left in orbit around something collapsing — and it is why nothing here needs to know
 * about the collapse at all.
 *
 * ── The box, and why radii are fractions of the FRAME ────────────────────────────────────────────
 * The first version scattered grains through a spherical shell measured in units of the sun's shard
 * radius, and it drew a hard rectangle on screen. The reason: this canvas is sized to the HERO
 * SQUARE (112–176px), not to the viewport, so anything beyond the frame is clipped by the canvas
 * edge — and a field of bright grains on black clipped to a rect looks exactly like a box around
 * the sun.
 *
 * So nothing here is measured against the model. Every radius is a fraction of `uFrameExtent` — the
 * visible half-extent at the sun's own distance, handed in by the caller and updated on resize. A
 * ring at 0.92 is at 92% of the way to the frame edge and therefore *cannot* be clipped, at any
 * viewport, at any aspect.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────────────────────────
 * One `THREE.Points`, no per-frame CPU work: every orbit is a pure function of `uTime` and the
 * grain's own attributes, solved in the vertex shader. It lives in the sun's scene, so `sunBloom`
 * blooms it along with the star — no second canvas, no second composer.
 *
 * Depth testing is left ON (while depth *writing* is off): grains on the far side of their orbit
 * are correctly hidden behind the star. That occlusion is what actually sells them as orbiting
 * rather than as a flat overlay.
 */

/**
 * How many grains, split evenly across the rings. One draw call regardless.
 *
 * Split by each ring's `share`, not evenly. The services ring holds half of it, which is the ~700 it
 * had when it was the only band; the two that erupt on the way into works divide the rest.
 */
const PARTICLE_COUNT = 1400;

/**
 * The rings. `radius` and `thickness` are in units of the STAR'S OWN BODY RADIUS, so 1.0 sits exactly
 * on the surface and 1.3 is a third of a radius clear of it.
 *
 * There is a hard band to stay inside, and both edges bite:
 *
 *   • below 1.0 a ring is INSIDE the star and the depth test hides it completely
 *   • past the frame edge it gets clipped into a rectangle by the canvas
 *
 * ⚠ That ceiling is DERIVED, and this comment used to state it wrongly. The frame edge sits at
 * `1 / SUN_BODY_FILL` body radii, and `SUN_BODY_FILL` is `0.723 / SUN_CANVAS_HEADROOM` — so it moves
 * whenever the headroom does. The old text quoted 1.383, which is `1 / 0.723`: the value from before
 * the canvas was ever given headroom. At the current headroom of 2.6 the real ceiling is ≈ 3.6 body
 * radii, and it was ≈ 2.2 even when this file was cut down to a single ring for want of room.
 *
 * `ringRadiusFraction` below converts these into frame fractions and the shader scales them by the
 * live frame extent, which is what makes the whole thing resize-safe.
 *
 * Leave real headroom under that ceiling: the whole field is shifted sideways by the framing pan
 * (`SUN_FRAMING_NUDGE_X`), so a ring sitting flush against the edge would clip on one side only. The
 * widest ring here reaches ~0.54 of the frame, which is comfortable.
 *
 * ⚠ That pan is 0 as of 2026-08-08 — it was 5% of the frame, and the asymmetry it corrected for went
 * with the `flare` and `blowout` groups. So the headroom is not currently being spent on anything.
 * Keep it anyway: it is what makes the rings safe if the nudge is ever reintroduced by eye.
 *
 * `tilt` and `yaw` are DEGREES and define the orbital plane. Rings 0 and 1 carry opposite tilts and
 * counter-rotate — that is what draws the X.
 */
/**
 * `formsOn` is which section erupts the ring out of the star, and it is the reason there is more than
 * one form ramp. Services shows ONE band — the star has just cracked open and thrown off a single
 * orbit. The other two erupt on the way into works, so arriving at the project field is the moment the
 * system fills out. Two eruptions, each on its own scroll, rather than one that has already happened.
 *
 * `share` is that ring's slice of PARTICLE_COUNT. Not an even split: the services ring is alone on
 * screen for a whole section, so it keeps the ~700 grains it had when it was the only ring — an even
 * third would have quietly thinned the one band that was already tuned.
 */
const RINGS = [
  // Thicker than a steeply-tilted ring would need: seen this close to edge-on the band is compressed
  // into a few pixels vertically, so the depth is what gives it any body at all.
  { radius: 1.18, thickness: 0.09, tilt: 20, yaw: 8, speed: 0.45, formsOn: 'services', share: 0.5 },
  // Opposite tilt AND opposite direction. Two bands crossing at a shallow angle is what draws the X;
  // matching their direction would read as one thick wobbling band instead of two orbits.
  { radius: 1.52, thickness: 0.07, tilt: -24, yaw: -6, speed: -0.34, formsOn: 'works', share: 0.28 },
  // The outer band: wider, finer, slower. Keplerian shear is the read — an orbit further out takes
  // longer — and it is also what stops three rings looking like a printed pattern.
  { radius: 1.95, thickness: 0.05, tilt: 9, yaw: 14, speed: 0.22, formsOn: 'works', share: 0.22 },
] as const;

/** Body radii → frame fractions, which is what the shader's `uFrameExtent` scales. */
const ringRadiusFraction = (bodyRadii: number) => bodyRadii * SUN_BODY_FILL;

/** Random variation in each grain's own orbital speed, so a ring shears instead of turning as a solid hoop. */
const SPEED_JITTER = 0.22;

/** Point size in pixels at the sun's distance, before DPR. The canvas is small — this is a big fraction of it. */
const PARTICLE_SIZE = 8.5;
/** Never let a grain go sub-pixel on the far side of its orbit. */
const MIN_PARTICLE_SIZE = 2.2;
/**
 * Additive brightness. Has to clear `sunBloom`'s BLOOM_THRESHOLD (0.59 luminance) or the grains do
 * not bloom at all: the ramp's ember end sits at ~0.30 luminance and its gold end at ~0.92, so
 * below ~1 only the very hottest grains ever cross the line.
 */
const PARTICLE_BRIGHTNESS = 1.9;

/** Twinkle depth and rate — a slow shimmer so the rings never read as a static texture. */
const TWINKLE_AMOUNT = 0.35;
const TWINKLE_SPEED = 1.3;

// ── Forming: the ejection ──
// The ring is THROWN OUT of the star, not gathered into it. Every grain erupts from ONE point under
// the star's surface, bursts through the limb, and sweeps forward around the orbit into its own
// place — so what you watch is a knot of ejecta stretching into an arc, the arc wrapping around, and
// the ring closing. The band is drawn BY the star coming apart, which is the whole reason it exists;
// the previous version had grains falling in from wider orbits, which looked fine but was caused by
// nothing.
//
// Driven by scroll, so it reverses on scroll-up for free — the ring un-forms, sweeps back into the
// knot and sinks into the star rather than blinking off.
//
// It runs on its OWN WINDOW of that scroll rather than on the star's cracks ramp (RING_WINDOW in
// SunModelCanvas), for a reason that is invisible from in here: these grains are additive, so they
// only read once the hero's black square has covered the frame. A window is not a second clock —
// both values are pure functions of the same scrubbed progress, so the ring cannot desync from the
// star it came out of, and still reverses exactly.

/**
 * Where on the orbit the eruption happens, in degrees around the ring's own plane. 0 is the ring's
 * `u` axis — the star's LIMB, chosen so grains emerge sideways against black rather than over the
 * star's own bright disc, where the bloom would swallow them.
 */
const FORM_LAUNCH_ANGLE_DEGREES = 0;
/**
 * Launch radius, as a fraction of the final orbit.
 *
 * The band sits at 1.18 body radii, so the star's surface is at 1/1.18 ≈ 0.85 of the orbit: anything
 * below that starts a grain INSIDE the body, where the depth test hides it. That is the point — the
 * grain is buried for the first ~12% of its flight and bursts through the surface already moving,
 * rather than switching on in empty space. Raise it toward 0.85 to have them peel off the limb
 * instead; lower it to bury them longer.
 */
const FORM_LAUNCH_RADIUS = 0.75;
/**
 * Angular rate the knot itself orbits at while it is still a knot, so a half-formed arc left sitting
 * mid-scroll is still alive rather than frozen. It is the FIRST ring's speed by construction: every
 * ring erupts from the same point, so they share one launch.
 */
const FORM_LAUNCH_SPIN = RINGS[0].speed;
/**
 * Fraction of the form spent staggering launches. 0 = every grain erupts at once (reads as a pop);
 * approaching 1 = the last grain only leaves as the first arrives (reads as slow and gappy).
 *
 * Deliberately NOT keyed to a grain's final angle any more, the way the old fall-in was: that angle
 * now sets how FAR the grain must travel, and delaying the far ones as well would leave the ring
 * closing in one late lurch.
 */
const FORM_STAGGER = 0.3;
/**
 * How much hotter fresh ejecta runs than settled ejecta, as a multiple of its resting brightness.
 * Without it the eruption reads as grains fading up rather than as the star throwing something off.
 * If the launch blows out into a white blob, this is the first dial — then FORM_LAUNCH_RADIUS.
 */
const FORM_EJECT_HEAT = 1.6;
/**
 * How quickly the field's master fade reaches full, as a fraction of the form. It has to be fast: the
 * eruption's first instant is its brightest, and a master fade tracking the form linearly would dim
 * exactly the frames that carry it.
 */
const PRESENCE_RAMP = 0.08;

const PARTICLE_VERTEX_SHADER = /* glsl */ `
  precision highp float;

  // The grain's orbital plane, as two orthonormal basis vectors baked on the CPU. Its normal is
  // their cross product, so the out-of-plane offset needs no third attribute.
  attribute vec3 aRingU;
  attribute vec3 aRingV;
  // x = radius (fraction of the frame extent), y = start angle, z = angular speed,
  // w = out-of-plane offset (fraction of the frame extent).
  attribute vec4 aOrbit;
  // x = heat along the ember-to-gold ramp, y = twinkle phase.
  attribute vec2 aLook;
  // 0 = this grain belongs to the ring that forms on services, 1 = one of the works rings. Used to
  // pick between the two form ramps, so one set can be mid-eruption while the other is untouched.
  attribute float aFormGroup;

  uniform float uTime;
  uniform float uPresence;
  uniform float uPresenceWorks;
  uniform float uFrameExtent;
  uniform float uSize;
  uniform float uMinSize;
  uniform float uPixelRatio;
  uniform float uTwinkleAmount;
  uniform float uTwinkleSpeed;
  uniform float uForm;
  uniform float uFormWorks;
  uniform float uFormStagger;
  uniform float uLaunchAngle;
  uniform float uLaunchSpin;
  uniform float uLaunchRadius;
  uniform float uEjectHeat;

  varying float vHeat;
  varying float vFade;

  const float TWO_PI = 6.283185307;
  // How much of a grain's own flight is spent ramping up out of nothing, so it arrives rather than
  // pops. Short — it is buried inside the star for longer than this anyway.
  const float LAUNCH_FADE = 0.12;

  void main() {
    // ── The ejection ──
    // 1. Launch order. Purely random, so the eruption has duration and a ragged leading edge.
    float delay = fract(aLook.y / TWO_PI) * uFormStagger;
    // Whichever eruption this grain belongs to. Everything below is unchanged — the two sets simply
    // run the same flight off different scrolls.
    float form = mix(uForm, uFormWorks, aFormGroup);
    // Each grain runs its own 0..1 flight across the window left after its delay.
    float grainForm = clamp((form - delay) / max(1.0 - uFormStagger, 0.001), 0.0, 1.0);

    // 2. Two curves off that one flight. The radial climb runs AHEAD of the angular sweep, so a
    //    grain clears the star's limb before it starts travelling around: it bursts out, then curls.
    float climb = 1.0 - pow(1.0 - grainForm, 4.0);
    float sweep = grainForm * grainForm * (3.0 - 2.0 * grainForm);

    // 3. How far around the grain still has to go, measured from the knot AS IT IS RIGHT NOW and
    //    reduced into a single turn. At sweep 0 every grain is exactly on the knot, which orbits as
    //    one body; at sweep 1 this resolves exactly to the settled band.
    //
    //    Reducing the offset matters far more than it looks. The band SHEARS — every grain runs at
    //    its own rate — so a grain's true offset from the knot grows without bound as the page ages.
    //    Interpolate toward that raw offset and the angular speed picks up a factor of elapsed time:
    //    scroll ten seconds after load and the sweep is clean, but sit on the hero for five minutes
    //    first and every grain whips 2.4 extra turns on its way round (thirty minutes: fourteen).
    //    Reduced, the sweep looks the same at one second as at one hour.
    //
    //    The cost is a seam: a grain whose offset crosses zero relocates mid-flight. That is ~8
    //    grains out of 700 over a formation — against a smear across all of them.
    float settledAngle = aOrbit.y + uTime * aOrbit.z;
    float knotAngle = uLaunchAngle + uTime * uLaunchSpin;
    float offset = mod(settledAngle - knotAngle, TWO_PI);
    float angle = knotAngle + offset * sweep;

    // 4. Out from under the surface and into the orbit. The band's thickness opens up from the
    //    launch too, so at rest the ejecta is a knot rather than an already-spread smear.
    float radius = aOrbit.x * mix(uLaunchRadius, 1.0, climb) * uFrameExtent;

    vec3 normal = cross(aRingU, aRingV);
    vec3 position =
      (aRingU * cos(angle) + aRingV * sin(angle)) * radius +
      normal * (aOrbit.w * uFrameExtent * climb);

    vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewPosition;

    vHeat = aLook.x;

    // 5. Fresh ejecta is hot and cools as it settles. Tied to the climb rather than the sweep so the
    //    grain is at its hottest the moment it breaks the surface, not later out on the orbit.
    float ignition = 1.0 + uEjectHeat * (1.0 - climb);
    float launched = smoothstep(0.0, LAUNCH_FADE, grainForm);
    // A slow shimmer, out of phase per grain.
    float twinkle = 1.0 - uTwinkleAmount * (0.5 + 0.5 * sin(uTime * uTwinkleSpeed + aLook.y));
    vFade = twinkle * mix(uPresence, uPresenceWorks, aFormGroup) * launched * ignition;

    // Perspective size — the only cue that separates the near and far halves of an orbit.
    float perspectiveSize = uSize * uPixelRatio / max(-modelViewPosition.z, 0.001);
    gl_PointSize = max(perspectiveSize, uMinSize * uPixelRatio);
  }
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uColorCool;
  uniform vec3 uColorHot;
  uniform float uBrightness;

  varying float vHeat;
  varying float vFade;

  void main() {
    // Round the square point off into a soft grain — a hard square reads as a bug at this size.
    vec2 offset = gl_PointCoord - 0.5;
    float falloff = 1.0 - smoothstep(0.0, 0.5, length(offset));
    if (falloff <= 0.0) discard;

    vec3 color = mix(uColorCool, uColorHot, vHeat);
    float intensity = falloff * vFade * uBrightness;

    // Additive: alpha carries the same intensity so it composites correctly wherever it lands.
    gl_FragColor = vec4(color * intensity, intensity);
  }
`;

export interface SunParticlesOptions {
  /**
   * Point size in pixels at one unit of camera distance, before DPR — the shader divides it by view
   * depth. Defaults to the hero's value.
   *
   * ⚠ This is NOT convertible between the two consumers, which is why it is an option and not a shared
   * constant. Apparent grain size is `pointSize / cameraDistance`, and the two scenes place their
   * cameras in unrelated units: the hero's sits a few model radii from a sun fitted to a 175px canvas,
   * the works camera sits 6–8 world units from a star fitted to the field. Tune each against its own
   * scene; a value carried across will be wrong by roughly the ratio of those distances.
   */
  pointSize?: number;
}

export interface SunParticles {
  /** Add this to the sun's scene. */
  object: THREE.Points;
  /**
   * Both eruption ramps, each 0 (absent) to 1 (fully formed).
   *
   * Two rather than one because the bands do not arrive together: the services ring erupts as the star
   * cracks open, and the works rings erupt on the flight into the project field. Each is a pure
   * function of its own scrubbed scroll, so both reverse independently.
   *
   * `masterFade` scales the whole field's brightness on top of that, and exists for a case the two
   * ramps cannot express: the contact star arrives with its rings ALREADY formed (it wore them in
   * works), so it needs them to fade up without re-erupting. Passing presence as the form ramps would
   * throw them out of the star a second time, which is a different — and wrong — story.
   */
  update(
    elapsedSeconds: number,
    servicesPresence: number,
    worksPresence: number,
    masterFade?: number,
  ): void;
  /**
   * The visible half-extent at the sun's distance. Every ring is a fraction of this, so calling it
   * on resize is what keeps the rings inside the canvas at any aspect.
   */
  setFrameExtent(halfExtent: number): void;
  /**
   * The renderer's current pixel ratio. Point sizes are computed in device pixels, so this has to
   * follow the canvas — the sun's ratio is no longer fixed at construction now that it shares the
   * adaptive controller with the heavy scenes.
   */
  setPixelRatio(pixelRatio: number): void;
  dispose(): void;
}

/** Two orthonormal vectors spanning a plane at the given tilt/yaw, in degrees. */
function ringBasis(tiltDegrees: number, yawDegrees: number): { u: THREE.Vector3; v: THREE.Vector3 } {
  const orientation = new THREE.Euler(
    THREE.MathUtils.degToRad(tiltDegrees),
    THREE.MathUtils.degToRad(yawDegrees),
    0,
  );
  const u = new THREE.Vector3(1, 0, 0).applyEuler(orientation);
  const v = new THREE.Vector3(0, 0, 1).applyEuler(orientation);
  return { u, v };
}

/**
 * @param frameHalfExtent visible half-extent at the sun's distance — see `setFrameExtent`.
 * @param pixelRatio the renderer's DPR, so point sizes match what the canvas actually draws.
 */
export function createSunParticles(
  frameHalfExtent: number,
  pixelRatio: number,
  options: SunParticlesOptions = {},
): SunParticles {
  const pointSize = options.pointSize ?? PARTICLE_SIZE;
  const geometry = new THREE.BufferGeometry();
  const ringU = new Float32Array(PARTICLE_COUNT * 3);
  const ringV = new Float32Array(PARTICLE_COUNT * 3);
  const orbit = new Float32Array(PARTICLE_COUNT * 4);
  const look = new Float32Array(PARTICLE_COUNT * 2);
  const formGroup = new Float32Array(PARTICLE_COUNT);
  // A dummy position attribute: three needs one to infer the draw count, but the vertex shader
  // computes every real position from the attributes above, so its contents are never read.
  const positions = new Float32Array(PARTICLE_COUNT * 3);

  const bases = RINGS.map((ring) => ringBasis(ring.tilt, ring.yaw));

  // Grains per ring, from its `share`. The last ring takes the remainder so rounding can never leave
  // the tail of the buffer unassigned — an unassigned grain would sit at the origin with a ring basis
  // of all zeros and render as a dead pixel at the star's centre.
  const ringCounts = RINGS.map((ring) => Math.round(PARTICLE_COUNT * ring.share));
  ringCounts[ringCounts.length - 1] =
    PARTICLE_COUNT - ringCounts.slice(0, -1).reduce((total, count) => total + count, 0);
  const ringOfParticle = new Uint8Array(PARTICLE_COUNT);
  let assigned = 0;
  ringCounts.forEach((count, ringIndex) => {
    for (let taken = 0; taken < count && assigned < PARTICLE_COUNT; taken += 1) {
      ringOfParticle[assigned] = ringIndex;
      assigned += 1;
    }
  });

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const ringIndex = ringOfParticle[index];
    const ring = RINGS[ringIndex];
    const { u, v } = bases[ringIndex];

    ringU.set([u.x, u.y, u.z], index * 3);
    ringV.set([v.x, v.y, v.z], index * 3);

    const orbitOffset = index * 4;
    // Thickness is spread symmetrically about the ring, in the plane and out of it, so the band has
    // real volume instead of being a wire.
    orbit[orbitOffset] = ringRadiusFraction(ring.radius + (Math.random() - 0.5) * ring.thickness);
    orbit[orbitOffset + 1] = Math.random() * Math.PI * 2;
    orbit[orbitOffset + 2] = ring.speed * (1 + (Math.random() - 0.5) * SPEED_JITTER);
    orbit[orbitOffset + 3] = ringRadiusFraction((Math.random() - 0.5) * ring.thickness);

    const lookOffset = index * 2;
    // Heat is per grain rather than positional, so each ring carries a mix of ember and gold —
    // the loader's palette scattered through the orbit.
    look[lookOffset] = Math.random();
    look[lookOffset + 1] = Math.random() * Math.PI * 2;

    formGroup[index] = ring.formsOn === 'works' ? 1 : 0;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRingU', new THREE.BufferAttribute(ringU, 3));
  geometry.setAttribute('aRingV', new THREE.BufferAttribute(ringV, 3));
  geometry.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
  geometry.setAttribute('aLook', new THREE.BufferAttribute(look, 2));
  geometry.setAttribute('aFormGroup', new THREE.BufferAttribute(formGroup, 1));
  // The shader places everything, so three's own culling maths has nothing meaningful to test.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), frameHalfExtent * 4);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPresence: { value: 0 },
      uPresenceWorks: { value: 0 },
      uFrameExtent: { value: frameHalfExtent },
      uSize: { value: pointSize },
      uMinSize: { value: MIN_PARTICLE_SIZE },
      uPixelRatio: { value: pixelRatio },
      uTwinkleAmount: { value: TWINKLE_AMOUNT },
      uTwinkleSpeed: { value: TWINKLE_SPEED },
      uForm: { value: 0 },
      uFormWorks: { value: 0 },
      uFormStagger: { value: FORM_STAGGER },
      uLaunchAngle: { value: THREE.MathUtils.degToRad(FORM_LAUNCH_ANGLE_DEGREES) },
      uLaunchSpin: { value: FORM_LAUNCH_SPIN },
      uLaunchRadius: { value: FORM_LAUNCH_RADIUS },
      uEjectHeat: { value: FORM_EJECT_HEAT },
      uBrightness: { value: PARTICLE_BRIGHTNESS },
      uColorCool: { value: new THREE.Vector3(...GATHER_DEFAULTS.colorCool) },
      uColorHot: { value: new THREE.Vector3(...GATHER_DEFAULTS.colorHot) },
    },
    vertexShader: PARTICLE_VERTEX_SHADER,
    fragmentShader: PARTICLE_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    // Grains do not occlude each other and must not punch holes in the star — but they ARE tested
    // against it, so the far half of each orbit passes correctly behind the sun.
    depthWrite: false,
  });

  const object = new THREE.Points(geometry, material);
  object.frustumCulled = false;
  object.visible = false;

  const update = (
    elapsedSeconds: number,
    servicesPresence: number,
    worksPresence: number,
    masterFade = 1,
  ) => {
    // Fully skipped on the hero, where BOTH are 0 — no draw, no cost. It has to be both: the works
    // rings are still absent through the whole of services, and the services ring is still there
    // through the whole of works, so either one alone would hide grains that should be on screen.
    // The master fade joins them for the same reason: fully-formed rings at zero brightness are still
    // nothing to draw.
    object.visible =
      masterFade > 0.001 && (servicesPresence > 0.001 || worksPresence > 0.001);
    if (!object.visible) return;
    material.uniforms.uTime.value = elapsedSeconds;
    material.uniforms.uBrightness.value = PARTICLE_BRIGHTNESS * masterFade;
    // The master fade snaps up almost at once (see PRESENCE_RAMP) — the per-grain `launched` term in
    // the shader is what actually staggers the field in, and the eruption's first frames are its
    // brightest, so a master fade tracking the form linearly would dim exactly those.
    material.uniforms.uPresence.value = Math.min(servicesPresence / PRESENCE_RAMP, 1);
    material.uniforms.uPresenceWorks.value = Math.min(worksPresence / PRESENCE_RAMP, 1);
    // Form and fade run off the SAME value rather than each getting a clock. That is deliberate: it
    // means the ejection reverses exactly on scroll-up — the band sweeps back into the knot and sinks
    // into the star — and a grain is only ever drawn as brightly as it has erupted.
    material.uniforms.uForm.value = servicesPresence;
    material.uniforms.uFormWorks.value = worksPresence;
  };

  const setFrameExtent = (halfExtent: number) => {
    material.uniforms.uFrameExtent.value = halfExtent;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), halfExtent * 4);
  };

  const setPixelRatio = (nextPixelRatio: number) => {
    material.uniforms.uPixelRatio.value = nextPixelRatio;
  };

  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };

  return { object, update, setFrameExtent, setPixelRatio, dispose };
}
