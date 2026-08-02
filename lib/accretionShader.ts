import * as THREE from "three";

// The accretion spiral — the star's own matter becoming the disc.
//
// Lives in `lib/`, not beside its one caller: the contact finale runs this same code on the site
// (docs/contact-singularity-plan.md). One copy on purpose — two would mean tuning one and shipping the
// other.
//
// Every particle starts at a point sampled from the SUN'S OWN MESH and is carried inward. Nothing about
// the spiral shape is authored: it emerges from one physical fact, on the `shear` line below.
//
// WHY THE SPIRAL APPEARS BY ITSELF
// Orbital angular velocity is Keplerian — ω ∝ r^-1.5 — so material that starts closer to the centre
// sweeps through far more angle than material further out. Release a sphere of particles, advance them
// all by the same amount of "orbit", and the differential rotation winds them into arms on its own. That
// is what real accretion discs do, and it is the whole trick here.
//
// EVERY POSITION IS A CLOSED-FORM FUNCTION OF `uSequence`
// Non-negotiable: the finale must scrub. Nothing accumulates frame to frame, so dragging the sequence
// slider backwards rewinds exactly. `uTime` is used ONLY for the turbulence shimmer — the structure is
// sequence-driven, so a given sequence always reproduces the same spiral, just with living detail on top.
//
// APPROXIMATION, STATED HONESTLY: the shear uses each particle's INITIAL radius rather than integrating
// ω over its shrinking path. The exact integral diverges at the horizon and needs clamping that costs
// more than it buys; shear-by-initial-radius produces the same emergent arms and cannot blow up.

export const ACCRETION_UNIFORMS = {
  /** The finale cursor, 0→1. Drives every particle's whole path. */
  uSequence: { value: 0 },
  /** Wall-clock seconds — turbulence shimmer only, never structure. */
  uTime: { value: 0 },
  /** Sun radius in world units; positions are authored in sun-radii and scaled up by this. */
  uScale: { value: 1 },
  /** Master brightness. 0 makes the whole system invisible. */
  uStrength: { value: 1 },
  /** Turns of winding. This is the spiral's tightness. */
  uWind: { value: 1 },
  /** How hard the sphere collapses into the disc plane (1 = completely flat). */
  uFlatten: { value: 0.85 },
  /** Amplitude of the organic displacement that breaks the arms into filaments. */
  uTurbulence: { value: 0.12 },
  /** Radius (in sun-radii) where particles are swallowed. */
  uInnerRadius: { value: 0.28 },
  /** Point size in pixels at one world unit of depth. */
  uSize: { value: 26 },
  /** Outer/cooler colour. */
  uColorCool: { value: new THREE.Color(0.85, 0.16, 0.02) },
  /** Inner/hotter colour. */
  uColorHot: { value: new THREE.Color(1.0, 0.93, 0.72) },
};

export const ACCRETION_VERTEX_SHADER = /* glsl */ `
  // The built-in "position" attribute IS the particle's start point, sampled from the sun's surface and
  // normalised to sun-radii — so there is no separate start attribute to upload.
  attribute float aSeed;

  uniform float uSequence;
  uniform float uTime;
  uniform float uScale;
  uniform float uStrength;
  uniform float uWind;
  uniform float uFlatten;
  uniform float uTurbulence;
  uniform float uInnerRadius;
  uniform float uSize;

  varying float vAlpha;
  varying float vHeat;

  float hash(float n) {
    return fract(sin(n * 12.9898) * 43758.5453123);
  }

  // Cheap organic displacement. Real curl noise would cost far more per vertex than it earns at this
  // count; a handful of offset sines gives the same "torn into filaments" read.
  vec3 turbulence(vec3 p, float t) {
    return vec3(
      sin(p.z * 3.1 + t * 0.70) + sin(p.y * 2.3 - t * 0.50),
      sin(p.x * 2.7 - t * 0.60) + sin(p.z * 3.3 + t * 0.40),
      sin(p.y * 2.9 + t * 0.55) + sin(p.x * 3.7 - t * 0.45)
    );
  }

  void main() {
    // Staggered release, so the star comes apart progressively instead of shattering on one frame.
    float birth = 0.08 + hash(aSeed) * 0.26;
    float life = (uSequence - birth) / max(1.0 - birth, 1e-4);

    if (life <= 0.0 || life >= 1.0) {
      // Park dead particles off-screen; cheaper and safer than relying on alpha alone.
      vAlpha = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    // Decompose the start point into cylindrical coordinates about Y (the disc axis).
    float startRadius = length(position.xz);
    float startAngle = atan(position.z, position.x);

    // 1. Infall. Squared = accelerating, the way gravity actually pulls.
    float fall = life * life;
    float radius = mix(startRadius, uInnerRadius, fall);

    // 2. Flatten. Angular momentum collapses a sphere of matter into a disc.
    float height = position.y * (1.0 - uFlatten * life);

    // 3. Keplerian shear — ω ∝ r^-1.5. Inner material laps outer material, and THE ARMS APPEAR.
    //    The floor keeps particles that start near the axis from winding infinitely.
    float shear = pow(max(startRadius, 0.12), -1.5);
    //    Winding accelerates as the particle falls, so the arms tighten as they go.
    float wound = life * 0.4 + life * life * 0.6;
    float angle = startAngle + uWind * shear * wound;

    vec3 spiralled = vec3(cos(angle) * radius, height, sin(angle) * radius);
    // Turbulence eases off as material is swallowed — near the horizon the flow is dominated by gravity.
    // aSeed is [0,1) — scaled up only here, so the hash above keeps its float precision.
    spiralled += turbulence(spiralled * 2.0 + aSeed * 53.0, uTime) * uTurbulence * (1.0 - life * 0.65);

    vec3 worldish = spiralled * uScale;

    // Hotter the deeper it falls — compression heating, and it reads as the core glowing white.
    vHeat = clamp(1.0 - radius / max(startRadius, 1e-3), 0.0, 1.0);
    // Fade in at release, wink out as it crosses the horizon.
    vAlpha = smoothstep(0.0, 0.10, life) * (1.0 - smoothstep(0.80, 1.0, life)) * uStrength;

    vec4 viewPosition = modelViewMatrix * vec4(worldish, 1.0);
    gl_PointSize = uSize * uScale / max(-viewPosition.z, 0.001);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

export const ACCRETION_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColorCool;
  uniform vec3 uColorHot;

  varying float vAlpha;
  varying float vHeat;

  void main() {
    if (vAlpha <= 0.0) discard;
    float distanceFromCentre = length(gl_PointCoord - 0.5);
    if (distanceFromCentre > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, distanceFromCentre);
    vec3 color = mix(uColorCool, uColorHot, vHeat);
    // Additive: overlapping arms accumulate toward white, which is what makes dense regions read as
    // molten rather than as a crowd of separate dots.
    gl_FragColor = vec4(color * glow * vAlpha, glow * vAlpha);
  }
`;
