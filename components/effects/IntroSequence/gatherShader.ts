// The loader's star-birth: matter drifting in the void, gathered inward and ignited.
//
// This is the ACCRETION SPIRAL RUN BACKWARDS. The site's finale collapses a star into a black hole; the
// loader is the other end of that same arc — scattered matter falling together into the star the page
// opens on. Birth here, death there, one particle language for both.
//
// WHY IT IS DRIVEN BY PROGRESS, NOT TIME
// A loading screen's animation cannot be on a clock: cached, the whole load might be 200ms; cold on bad
// wifi it might be twenty seconds. A timed animation looks broken at both ends. Every position below is a
// function of uProgress — real bytes-loaded — so the gathering IS the progress bar. It cannot look stuck,
// because even while the gate waits the particles keep orbiting; only their DENSITY is gated.
//
// EVERYTHING IS 2D, IN CLIP SPACE
// There is no camera and no projection matrix. The wordmark is flat, the target is a point on screen, so
// the vertex shader writes gl_Position directly. Distances are computed in "aspect units" — y in [-1,1],
// x in [-aspect, aspect] — so the spiral stays circular instead of stretching with the viewport.
//
// PLAIN GLSL ES 1.00, NO ENGINE
// These strings are compiled by raw WebGL (see gatherRenderer.ts), not by a three ShaderMaterial, so
// every attribute, uniform and precision qualifier is declared explicitly rather than injected. That is
// deliberate: the loader must not wait on a 3D engine to download before it can draw its first frame.

/** Enough to read as dust rather than as dots, and trivial for a loader to draw. */
export const GATHER_COUNT = 24000;

/** Starting values for the tunable uniforms. Plain data — no engine types. */
export const GATHER_DEFAULTS = {
  /**
   * Scale of the cloud particles settle into, in aspect units. Each particle picks its own radius
   * around this (see `endRadius` in the vertex shader), so this is the cloud's centre, not a ring.
   */
  targetRadius: 0.09,
  /** Turns of winding on the way in. */
  wind: 0.9,
  /** Point size in pixels (before device pixel ratio). */
  size: 2.2,
  /** Master fade, so the whole field can be pulled out without tearing it down. */
  opacity: 1,
  /** Cold dust in the void. */
  colorCool: [0.35, 0.42, 0.75],
  /** Starlight, once it has fallen together. */
  colorHot: [1.0, 0.86, 0.62],
} as const;

export const GATHER_VERTEX_SHADER = /* glsl */ `
  precision highp float;

  // Not a location — this carries the particle's constants:
  //   x = starting radius (aspect units)   y = starting angle (radians)   z = seed 0..1
  attribute vec3 aParticle;

  uniform float uProgress;
  uniform float uTime;
  uniform float uIgnite;
  uniform vec2  uTarget;
  uniform float uTargetRadius;
  uniform float uWind;
  uniform float uAspect;
  uniform float uSize;
  uniform float uOpacity;
  uniform float uPixelRatio;

  varying float vAlpha;
  varying float vHeat;

  void main() {
    float startRadius = aParticle.x;
    float startAngle  = aParticle.y;
    float seed        = aParticle.z;

    // Staggered arrival across the load, so matter keeps streaming in the whole time rather than the
    // entire field landing at once.
    float birth = seed * 0.55;
    float life = smoothstep(birth, 1.0, uProgress);

    // Where THIS particle settles. Not a shared circle — every one gets its own radius, so the field
    // ends as a cloud scattered through and over the star rather than a ring drawn neatly around it.
    // The hash is decorrelated from the birth stagger above, or late arrivals would all land far out.
    float scatter = fract(seed * 91.7);
    // sqrt biases toward the outside, which keeps the middle from clogging while still putting a share
    // of the dust directly over the sun.
    float endRadius = uTargetRadius * (0.1 + 1.4 * sqrt(scatter));

    // Fall inward, accelerating — gravity, and it makes late progress feel like it is rushing home.
    float eased = life * life;
    float radius = mix(startRadius, endRadius, eased);

    // Keplerian shear, exactly as in the finale's accretion: material starting closer in sweeps through
    // more angle, so the infall winds into arms on its own instead of being drawn as a spiral.
    float shear = pow(max(startRadius, 0.15), -1.5);
    float angle = startAngle + uWind * shear * life;

    // A slow shimmer so the field never looks frozen while the gate is waiting on assets.
    radius += sin(uTime * 1.3 + seed * 40.0) * 0.006 * (1.0 - life);

    // Ignition: the last rush into the star, squared so it snaps.
    radius = mix(radius, 0.0, uIgnite * uIgnite);

    vec2 offset = vec2(cos(angle), sin(angle)) * radius;
    vec2 aspectPosition = uTarget + offset;
    // Aspect units back to clip space.
    gl_Position = vec4(aspectPosition.x / uAspect, aspectPosition.y, 0.0, 1.0);

    // Brighter as it compresses — compression heating, and it doubles as the progress read.
    vHeat = eased;
    float appear = smoothstep(0.0, 0.08, life);
    vAlpha = appear * mix(0.22, 1.0, eased) * uOpacity * (1.0 - smoothstep(0.55, 1.0, uIgnite));
    gl_PointSize = uSize * uPixelRatio * mix(0.7, 1.5, eased);
  }
`;

export const GATHER_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform vec3 uColorCool;
  uniform vec3 uColorHot;

  varying float vAlpha;
  varying float vHeat;

  void main() {
    if (vAlpha <= 0.0) discard;
    float distanceFromCentre = length(gl_PointCoord - 0.5);
    if (distanceFromCentre > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, distanceFromCentre);
    // Cold blue dust in the void, warming toward starlight as it falls together.
    vec3 color = mix(uColorCool, uColorHot, vHeat);
    gl_FragColor = vec4(color * glow * vAlpha, glow * vAlpha);
  }
`;
