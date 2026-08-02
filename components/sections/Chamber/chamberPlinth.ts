import * as THREE from 'three';
import {
  SURFACE_LIGHTING_UNIFORMS,
  SURFACE_LIGHTING_FUNCTIONS,
  createSurfaceLightingUniforms,
  type SurfaceLightingUniforms,
} from './chamberSurfaceLighting';

/**
 * The plinth the FAQ hologram is projected from.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The panel used to hang in mid-air over a wash of tint painted on the floor. That wash was standing in
 * for a source — a flat circle implying something below — and it never convinced, because a projection
 * with nothing projecting it is a sticker. This is the thing itself: a black drum standing on the floor
 * with a lit emitter in its throat, and the panel above it.
 *
 * ── Two meshes, two jobs ─────────────────────────────────────────────────────────────────────────
 *  1. The DRUM — matte black, opaque, depth-writing. A real object in the room: it occludes the floor's
 *     tiling behind it and takes the shadow gap at its own base. Its only light is the pattern cut into
 *     it: a ring near the top and a run of vertical vents, both glowing.
 *  2. The EMITTER — a slim cylinder rising out of the drum's throat, additive and fading upward, so the
 *     light thins as it climbs toward the panel instead of stopping at a hard top face.
 *
 * ── It rides the room's own wavefront ────────────────────────────────────────────────────────────
 * Same `surfaceIgnition` as the floor and the walls (see chamberSurfaceLighting): the plinth lights when
 * the sweep reaches it, not on a clock of its own. So it powers up as part of the room and reverses with
 * it when you scroll back out, for free.
 */

const RADIAL_SEGMENTS = 48;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/**
 * The drum.
 *
 * Everything is driven from the cylinder's own UV — x runs once around, y runs base to top — rather
 * than from an angle computed in the fragment shader. That is deliberate: `atan` wraps, and a pattern
 * built on it seams at the wrap unless every period is an integer. A UV has no wrap to reason about,
 * so the vent count is free to be anything.
 */
const BODY_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

${SURFACE_LIGHTING_UNIFORMS}

  uniform vec3  uBodyColor;    // the drum itself. Near-black: it is a housing, not a surface to look at.
  uniform vec3  uGlowColor;
  uniform float uVents;        // vertical slots around the drum
  uniform float uVentWidth;    // each slot's half-width, in UV turns
  uniform float uVentTop;      // where the run of slots ends, as a height fraction
  uniform float uVentBottom;   // ...and where it starts
  uniform float uVentGlow;
  uniform float uRingY;        // the bright ring near the top, as a height fraction
  uniform float uRingWidth;
  uniform float uRingGlow;
  uniform float uRimGlow;      // the lit lip right at the top edge
  uniform float uBevel;        // how far down from the top the lip reaches

  varying vec3 vWorldPosition;
  varying vec2 vUv;

  ${SURFACE_LIGHTING_FUNCTIONS}

  void main() {
    vec2 ignition = surfaceIgnitionSmooth(vWorldPosition);

    vec3 surface = mix(uColor, uBodyColor, ignition.x);

    // The vents. A band of the drum's height carries them; outside that band the housing is blank, which
    // is what stops the pattern reading as stripes on a tube.
    float inBand = step(uVentBottom, vUv.y) * step(vUv.y, uVentTop);
    // Softened at both ends of the run so a slot fades out rather than being chopped.
    float bandFade = smoothstep(uVentBottom, uVentBottom + 0.06, vUv.y)
                   * (1.0 - smoothstep(uVentTop - 0.06, uVentTop, vUv.y));
    float ventCoord = fract(vUv.x * max(floor(uVents + 0.5), 1.0));
    float toVent = abs(ventCoord - 0.5);
    float vent = (1.0 - smoothstep(uVentWidth, uVentWidth * 1.8, toVent)) * inBand * bandFade;

    // The ring — one continuous band of light near the top, the drum's own horizon.
    float ring = 1.0 - smoothstep(uRingWidth, uRingWidth * 2.0, abs(vUv.y - uRingY));

    // The lip at the very top, where the housing turns over into the throat.
    float rim = smoothstep(1.0 - uBevel, 1.0, vUv.y);

    surface += uGlowColor * (vent * uVentGlow + ring * uRingGlow + rim * uRimGlow)
               * ignition.x * (1.0 + ignition.y);

    gl_FragColor = vec4(surface, 1.0);
  }
`;

/**
 * The emitter in the throat.
 *
 * Fades out as it rises, so the light thins into the air under the panel rather than ending on a flat
 * top. Additive and depth-tested but not depth-writing — it is light, not an object, and writing depth
 * would let it punch a hole in the panel drawn after it.
 */
const CORE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

${SURFACE_LIGHTING_UNIFORMS}

  uniform vec3  uCoreColor;
  uniform float uCoreIntensity;
  uniform float uCoreFade;   // how much of the height is left by the time it has gone

  varying vec3 vWorldPosition;
  varying vec2 vUv;

  ${SURFACE_LIGHTING_FUNCTIONS}

  void main() {
    vec2 ignition = surfaceIgnitionSmooth(vWorldPosition);

    // Bright at the throat, gone by uCoreFade. Squared, so it holds near the base and thins fast —
    // a linear ramp reads as a painted gradient rather than as light losing itself in air.
    float rise = 1.0 - smoothstep(0.0, max(uCoreFade, 0.001), vUv.y);
    rise *= rise;

    float amount = rise * uCoreIntensity * ignition.x * (1.0 + ignition.y);
    if (amount <= 0.001) discard;

    gl_FragColor = vec4(uCoreColor * amount, amount);
  }
`;

export interface PlinthBodyUniforms extends SurfaceLightingUniforms {
  uBodyColor: { value: THREE.Color };
  uGlowColor: { value: THREE.Color };
  uVents: { value: number };
  uVentWidth: { value: number };
  uVentTop: { value: number };
  uVentBottom: { value: number };
  uVentGlow: { value: number };
  uRingY: { value: number };
  uRingWidth: { value: number };
  uRingGlow: { value: number };
  uRimGlow: { value: number };
  uBevel: { value: number };
}

export interface PlinthCoreUniforms extends SurfaceLightingUniforms {
  uCoreColor: { value: THREE.Color };
  uCoreIntensity: { value: number };
  uCoreFade: { value: number };
}

export interface ChamberPlinth {
  group: THREE.Group;
  bodyUniforms: PlinthBodyUniforms;
  coreUniforms: PlinthCoreUniforms;
  /** Both cylinders are built at unit size and scaled, so every dimension stays a live knob. */
  setShape: (
    radius: number,
    height: number,
    coreRadius: number,
    coreHeight: number,
  ) => void;
  dispose: () => void;
}

export function createChamberPlinth(): ChamberPlinth {
  const group = new THREE.Group();

  // Open-ended: the top face is never seen (the emitter stands in it) and the bottom sits on the floor.
  const bodyGeometry = new THREE.CylinderGeometry(1, 1, 1, RADIAL_SEGMENTS, 1, true);
  const coreGeometry = new THREE.CylinderGeometry(1, 1, 1, RADIAL_SEGMENTS, 1, true);

  const bodyUniforms: PlinthBodyUniforms = {
    ...createSurfaceLightingUniforms(),
    uBodyColor: { value: new THREE.Color('#0a0a0b') },
    uGlowColor: { value: new THREE.Color('#ff7b00') },
    uVents: { value: 18 },
    uVentWidth: { value: 0.16 },
    uVentTop: { value: 0.72 },
    uVentBottom: { value: 0.16 },
    uVentGlow: { value: 0.5 },
    uRingY: { value: 0.86 },
    uRingWidth: { value: 0.018 },
    uRingGlow: { value: 1.5 },
    uRimGlow: { value: 0.9 },
    uBevel: { value: 0.04 },
  };

  const coreUniforms: PlinthCoreUniforms = {
    ...createSurfaceLightingUniforms(),
    uCoreColor: { value: new THREE.Color('#ffa200') },
    uCoreIntensity: { value: 1.8 },
    uCoreFade: { value: 0.8 },
  };

  const bodyMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: BODY_FRAGMENT_SHADER,
    uniforms: bodyUniforms as unknown as { [uniform: string]: THREE.IUniform },
    // A solid object, unlike every other surface in this room: it must occlude the floor's tiling behind
    // it, which means writing depth and being opaque.
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const coreMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: CORE_FRAGMENT_SHADER,
    uniforms: coreUniforms as unknown as { [uniform: string]: THREE.IUniform },
    transparent: true,
    blending: THREE.AdditiveBlending,
    // Light, not an object: depth-TESTED so the drum in front of it occludes it, but never depth-WRITING
    // or it would punch a hole through the hologram panel composited after it.
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  group.add(body, core);

  return {
    group,
    bodyUniforms,
    coreUniforms,
    setShape: (radius, height, coreRadius, coreHeight) => {
      // Cylinders are centred on their own origin, so each is raised by half its height to stand on the
      // group's base — which the scene places on the floor line.
      body.scale.set(radius, height, radius);
      body.position.y = height / 2;
      // The emitter starts at the drum's top and rises from there.
      core.scale.set(coreRadius, coreHeight, coreRadius);
      core.position.y = height + coreHeight / 2;
    },
    dispose: () => {
      bodyGeometry.dispose();
      coreGeometry.dispose();
      bodyMaterial.dispose();
      coreMaterial.dispose();
    },
  };
}
