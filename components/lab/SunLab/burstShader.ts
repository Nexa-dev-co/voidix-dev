import * as THREE from "three";

// The supernova burst — the flash that masks the sun→black-hole handoff.
//
// WHY THIS EXISTS AS ITS OWN OBJECT
// The obvious implementation is "spike exposure and bloom at the handoff", and it does not work: by the
// moment the sun's scale reaches zero, there is nothing bright left in frame to spike. The accretion
// particles fall inward on a squared curve, so they are still spread wide and dim at that point and only
// pile up much later. Cranking exposure on a dark frame just gives you a slightly less dark frame.
//
// So the flash brings its own light: a billboarded additive burst at the origin that expands and fades on
// its own curve, with the exposure/bloom spike riding ON TOP of it rather than doing the work alone.
//
// TWO-STAGE, deliberately: a tight hot core arrives first and reads as ignition, and a much wider soft
// halo follows it out. A single falloff reads as a glowing ball; the two together read as a detonation.

export const BURST_UNIFORMS = {
  uColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
  /** Master brightness for this frame — the pulse curve is evaluated on the CPU and pushed in here. */
  uIntensity: { value: 0 },
};

export const BURST_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const BURST_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;

  void main() {
    if (uIntensity <= 0.0) discard;
    // 0 at the centre, 1 at the edge of the quad.
    float distanceFromCentre = length(vUv - 0.5) * 2.0;
    if (distanceFromCentre > 1.0) discard;
    float falloff = 1.0 - distanceFromCentre;

    // Stage one: a tight, very hot core. The high power keeps it small and hard-edged.
    float core = pow(falloff, 9.0);
    // Stage two: a broad soft halo carrying the light outward.
    float halo = pow(falloff, 2.2);
    // Weighted so the CORE carries the flash and the halo only suggests it. The halo covers most of the
    // quad, so giving it much weight floods the frame with additive white and buries what it is meant to
    // be revealing.
    float glow = core * 1.0 + halo * 0.22;

    gl_FragColor = vec4(uColor * glow * uIntensity, glow * uIntensity);
  }
`;
