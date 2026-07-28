import * as THREE from 'three';
import { GATHER_DEFAULTS, SUN_BODY_FILL } from '@/components/effects/IntroSequence/gatherShader';

/**
 * The dust orbiting the cracked sun on the services deck.
 *
 * One ring, lying along the X axis — a shallow horizontal band sweeping left to right across the
 * star, the way a planetary ring sits. So the sun reads as the centre of an orbital system, which is
 * the brand's whole metaphor, rather than as a ball in a cloud.
 *
 * The small `tilt` is what makes it a ring rather than a line. At 0 the plane is exactly edge-on to
 * the camera and the band collapses to a horizontal stroke; ~20° opens it into a flattened ellipse
 * while keeping it clearly horizontal. Don't take it far past that — a near face-on ring stops
 * passing BEHIND the star, and that occlusion on every orbit is the only thing that makes it read as
 * going around something rather than as a decal drawn over the top.
 *
 * (`RINGS` is still a list — add entries back for crossing orbits; grains split evenly across
 * whatever is in it.)
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
 * Down from 1100 with the drop to a single ring: three rings spread that across three separate
 * bands, but concentrating the same count into one near-edge-on band would read as a solid bar.
 */
const PARTICLE_COUNT = 700;

/**
 * The rings. `radius` and `thickness` are in units of the STAR'S OWN BODY RADIUS, so 1.0 sits exactly
 * on the surface and 1.3 is a third of a radius clear of it.
 *
 * There is a hard band to stay inside, and both edges bite:
 *
 *   • below 1.0 a ring is INSIDE the star and the depth test hides it completely
 *   • above ~1.38 it is outside the visible frame and gets clipped into a rectangle by the canvas
 *
 * That ceiling is not arbitrary: the star's body is `SUN_BODY_FILL` (0.723) of the frame half-extent
 * — see the framing maths in `gatherShader` — so the frame edge sits at 1 / 0.723 ≈ 1.383 body
 * radii. `ringRadiusFraction` below converts these into frame fractions and the shader scales them
 * by the live frame extent, which is what makes the whole thing resize-safe.
 *
 * Leave real headroom under that 1.383, though: the whole field is shifted sideways by the framing
 * pan (`SUN_FRAMING_NUDGE_X`, 5% of the frame), so a ring sitting flush against the edge would clip
 * on one side only. The widest ring here reaches 0.90 of the frame, leaving room for the pan.
 *
 * `tilt` and `yaw` are DEGREES and define the orbital plane. Rings 0 and 1 carry opposite tilts and
 * counter-rotate — that is what draws the X.
 */
const RINGS = [
  // Thicker than a steeply-tilted ring would need: seen this close to edge-on the band is compressed
  // into a few pixels vertically, so the depth is what gives it any body at all.
  { radius: 1.18, thickness: 0.09, tilt: 20, yaw: 8, speed: 0.45 },
];

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

// ── Forming ──
// The ring does not just fade up: it ASSEMBLES. Grains fall in from wider orbits and arrive
// staggered around the circumference, so the band draws itself around the star.
//
// Driven by the same services ramp as everything else, so it reverses on scroll-up for free — the
// ring un-forms and scatters back out rather than blinking off.
/** How far out a grain starts, as a multiple of its final orbit. */
const FORM_ENTRY_RADIUS_SCALE = 2.1;
/**
 * Fraction of the form spent staggering arrivals. 0 = every grain lands together (reads as a fade);
 * approaching 1 = the last grain only starts as the first finishes (reads as slow and gappy).
 */
const FORM_STAGGER = 0.55;
/**
 * Blends each grain's arrival order between a clean sweep around the ring (0) and pure random (1).
 * All-sweep reads mechanical, like a loading bar bent into a circle; a little randomness keeps the
 * leading edge ragged and organic while the sweep still reads as direction.
 */
const FORM_SCATTER = 0.45;

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

  uniform float uTime;
  uniform float uPresence;
  uniform float uFrameExtent;
  uniform float uSize;
  uniform float uMinSize;
  uniform float uPixelRatio;
  uniform float uTwinkleAmount;
  uniform float uTwinkleSpeed;
  uniform float uForm;
  uniform float uFormEntryScale;
  uniform float uFormStagger;
  uniform float uFormScatter;

  varying float vHeat;
  varying float vFade;

  const float TWO_PI = 6.283185307;

  void main() {
    // ── Arrival order ──
    // Sweeping by start angle draws the ring around the star; blending in the grain's own random
    // phase keeps the leading edge ragged instead of a hard clock hand.
    float sweepDelay = fract(aOrbit.y / TWO_PI);
    float randomDelay = fract(aLook.y / TWO_PI);
    float delay = mix(sweepDelay, randomDelay, uFormScatter) * uFormStagger;
    // Each grain runs its own 0..1 form across the window left after its delay.
    float grainForm = clamp((uForm - delay) / max(1.0 - uFormStagger, 0.001), 0.0, 1.0);
    // Ease out: it decelerates into its orbit rather than arriving at full speed.
    float settled = 1.0 - pow(1.0 - grainForm, 3.0);

    float angle = aOrbit.y + uTime * aOrbit.z;
    // Falls inward from a wider orbit as it forms.
    float radius = aOrbit.x * mix(uFormEntryScale, 1.0, settled) * uFrameExtent;

    vec3 normal = cross(aRingU, aRingV);
    vec3 position =
      (aRingU * cos(angle) + aRingV * sin(angle)) * radius +
      normal * (aOrbit.w * uFrameExtent);

    vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewPosition;

    vHeat = aLook.x;

    // A slow shimmer, out of phase per grain.
    float twinkle = 1.0 - uTwinkleAmount * (0.5 + 0.5 * sin(uTime * uTwinkleSpeed + aLook.y));
    vFade = twinkle * uPresence * settled;

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

export interface SunParticles {
  /** Add this to the sun's scene. */
  object: THREE.Points;
  /** `presence` is the services energy ramp (0 hero → 1 services). */
  update(elapsedSeconds: number, presence: number): void;
  /**
   * The visible half-extent at the sun's distance. Every ring is a fraction of this, so calling it
   * on resize is what keeps the rings inside the canvas at any aspect.
   */
  setFrameExtent(halfExtent: number): void;
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
export function createSunParticles(frameHalfExtent: number, pixelRatio: number): SunParticles {
  const geometry = new THREE.BufferGeometry();
  const ringU = new Float32Array(PARTICLE_COUNT * 3);
  const ringV = new Float32Array(PARTICLE_COUNT * 3);
  const orbit = new Float32Array(PARTICLE_COUNT * 4);
  const look = new Float32Array(PARTICLE_COUNT * 2);
  // A dummy position attribute: three needs one to infer the draw count, but the vertex shader
  // computes every real position from the attributes above, so its contents are never read.
  const positions = new Float32Array(PARTICLE_COUNT * 3);

  const bases = RINGS.map((ring) => ringBasis(ring.tilt, ring.yaw));

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const ringIndex = index % RINGS.length;
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
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRingU', new THREE.BufferAttribute(ringU, 3));
  geometry.setAttribute('aRingV', new THREE.BufferAttribute(ringV, 3));
  geometry.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
  geometry.setAttribute('aLook', new THREE.BufferAttribute(look, 2));
  // The shader places everything, so three's own culling maths has nothing meaningful to test.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), frameHalfExtent * 4);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPresence: { value: 0 },
      uFrameExtent: { value: frameHalfExtent },
      uSize: { value: PARTICLE_SIZE },
      uMinSize: { value: MIN_PARTICLE_SIZE },
      uPixelRatio: { value: pixelRatio },
      uTwinkleAmount: { value: TWINKLE_AMOUNT },
      uTwinkleSpeed: { value: TWINKLE_SPEED },
      uForm: { value: 0 },
      uFormEntryScale: { value: FORM_ENTRY_RADIUS_SCALE },
      uFormStagger: { value: FORM_STAGGER },
      uFormScatter: { value: FORM_SCATTER },
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

  const update = (elapsedSeconds: number, presence: number) => {
    // Fully skipped on the hero, where presence is 0 — no draw, no cost.
    object.visible = presence > 0.001;
    if (!object.visible) return;
    material.uniforms.uTime.value = elapsedSeconds;
    material.uniforms.uPresence.value = presence;
    // Form runs off the SAME ramp as the fade rather than its own clock. That is deliberate: one
    // clock means the assembly reverses exactly on scroll-up, and it can never desync from the
    // sun's own cracks ramp, which is driven by that same value.
    material.uniforms.uForm.value = presence;
  };

  const setFrameExtent = (halfExtent: number) => {
    material.uniforms.uFrameExtent.value = halfExtent;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), halfExtent * 4);
  };

  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };

  return { object, update, setFrameExtent, dispose };
}
