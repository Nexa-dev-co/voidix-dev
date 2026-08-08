import * as THREE from 'three';
import { HEAT_200, HEAT_400, HEAT_600, HEAT_900, HEAT_950, heatToVec3 } from '@/lib/heatPalette';

/**
 * The star's burning surface, procedurally.
 *
 * ── What it replaces, and why ────────────────────────────────────────────────────────────────────
 * `fractured_sun.glb` carries its atmosphere as **eleven translucent spheres** (`sunouter`, alpha
 * 0.82), offset through the same two-unit volume rather than stacked concentrically — measured mean
 * centre distance 0.525 from the origin, which is what gives them structure rather than a smooth skin.
 * Eleven blended meshes, and `sunBloom` renders the scene TWICE per drawn frame, so twenty-two passes
 * of framebuffer read-modify-write over the star's footprint.
 *
 * Measured on the reference laptop, `sun · bloom` per call:
 *
 *     everything                17.5 ms
 *     minus flare + blowout      7.4 ms   ← where the star is today
 *     shards only (loader)       1.58 ms
 *                               -------
 *     so sunouter + core + mips  5.8 ms   ← this file exists to take that
 *
 * ⚠ ONE SURFACE, NOT A VOLUME. The trade only works because GPUs have far more ALU headroom than
 * blend bandwidth: a few octaves of noise on one opaque-ish sphere is cheap where eleven blended ones
 * are not. Raymarching this — thirty-odd steps per fragment — spends the entire win and more, in a way
 * that is hard to walk back once the look depends on it. If this ever needs more depth, buy it with a
 * better noise field, never with more samples along a ray.
 *
 * ⚠ And it is ONE MESH, not two. The plan called for a body plus a rim shell; both live in this one
 * shader instead, because the cost being removed is per-mesh on one machine and per-blended-layer on
 * the other, and a second sphere would give some of both back for nothing.
 */

// ── Where the surface sits ───────────────────────────────────────────────────────────────────────
/**
 * The plasma sphere's radius, in model units.
 *
 * ⚠ THIS IS THE DIAL THAT CHOOSES WHAT THE STAR IS, and it wants eyes rather than arithmetic:
 *
 *     ~1.00   ATMOSPHERE — where the eleven shells reached. The fractured crust reads in front of a
 *             burning haze. Closest to what ships today, and the safe default.
 *     ~0.95   BODY — just inside the crust. The shards become dark plate over a burning core and the
 *             plasma shows through the widening gaps, which is what the code has always CLAIMED the
 *             star is (see CORONA_APPEAR: "the star lights inside the closing shell"). More dramatic,
 *             and a real departure.
 *
 * Measured geometry for whoever tunes this: the smooth core sphere `Sphere_0` is r 0.965; the ten
 * shard cells span 0.38 to ~1.0 from the origin, so they are wedges through the volume rather than a
 * thin shell. Between those two numbers the plasma is inside the crust; above them it is outside it.
 */
const PLASMA_RADIUS = 1.0;
/**
 * Where the fractured crust actually is, measured off the GLB — the smooth core sphere `Sphere_0` is
 * exactly this. Only used to decide which way the plasma faces (see `side` below), so the radius above
 * stays the single dial.
 */
const CRUST_RADIUS = 0.965;
/** Enough segments that the limb is a curve rather than a polygon at ~250 device pixels across. */
const PLASMA_SEGMENTS = 48;

// ── The noise field ──────────────────────────────────────────────────────────────────────────────
/**
 * Octaves in the surface fbm. Three is the floor for something that reads as turbulent rather than
 * as a texture; each one is eight hash lookups per fragment, so this is the cost dial.
 */
const NOISE_OCTAVES = 3;
/** How far the field is dragged by its own low frequency — what turns bands into curdled cells. */
const DOMAIN_WARP = 0.55;
/** Spatial frequency of the first octave. Higher is finer, and at some point it aliases. */
const NOISE_SCALE = 1.9;
/** How fast the field churns at rest, in field units per second. The star's slow boil. */
const CHURN_SPEED = 0.055;
/** Multiplier on that at full Collapse — the surface tears rather than boils. */
const COLLAPSE_CHURN_GAIN = 5.2;

// ── The limb ─────────────────────────────────────────────────────────────────────────────────────
/** Fresnel exponent. Higher pulls the bright edge into a thinner ring. */
const RIM_POWER = 2.4;
/** How much the rim lifts the surface's own brightness — the halo the eleven shells produced. */
const RIM_GAIN = 0.85;
/**
 * How hard alpha falls at the silhouette.
 *
 * ⚠ It must reach 0 AT the silhouette. `sunBloom` renders the scene straight to a transparent canvas
 * and adds the glow with pure additive blending; a surface that ends on a hard alpha step draws a
 * visible disc edge against the cream hero, which is the same failure the bloom's header documents
 * for the composer it replaced.
 */
const EDGE_SOFTNESS = 1.6;

/** Emissive strength at rest, and at full Collapse. The star is its own light source. */
const BASE_EXPOSURE = 1.0;
const COLLAPSE_EXPOSURE_GAIN = 2.35;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vObjectPosition;
  varying vec3 vNormalView;
  varying vec3 vViewDirection;

  void main() {
    // Object space, so the field is fixed to the star and turns with it rather than swimming
    // across the surface as the model rotates.
    vObjectPosition = position;
    vNormalView = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// No backticks anywhere in here: inside a glsl template literal one would terminate the string.
const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uCracks;
  uniform float uCollapse;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uHot;
  uniform vec3 uPeak;
  uniform vec3 uWhite;

  varying vec3 vObjectPosition;
  varying vec3 vNormalView;
  varying vec3 vViewDirection;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float amplitude = 0.5;
    float sum = 0.0;
    for (int octave = 0; octave < PLASMA_OCTAVES; octave += 1) {
      sum += amplitude * noise(p);
      p *= 2.02;
      amplitude *= 0.5;
    }
    return sum;
  }

  void main() {
    // 1. Churn. One low-frequency fbm drags the sampling point of the next — the domain warp is what
    //    turns smooth bands into the curdled cells convection actually makes.
    float churn = uTime * PLASMA_CHURN * (1.0 + uCollapse * PLASMA_COLLAPSE_CHURN);
    vec3 field = vObjectPosition * PLASMA_SCALE;
    float warp = fbm(field * 0.5 + vec3(0.0, churn, 0.0));
    float surface = fbm(field + PLASMA_WARP * warp + vec3(churn * 0.6, -churn, churn * 0.3));

    // 2. Contrast rises with Cracks: the star gets restless before it gets violent.
    surface = clamp((surface - 0.5) * (1.0 + uCracks * 1.35) + 0.5, 0.0, 1.0);

    // 3. Through the heat ramp. Low troughs are barely-glowing matter; peaks are the anchor amber and
    //    above. Collapse drags the whole mapping hotter rather than simply brightening it, which is
    //    what makes it read as temperature instead of exposure.
    float heat = clamp(surface + uCollapse * 0.42, 0.0, 1.0);
    vec3 colour = mix(uDeep, uMid, smoothstep(0.0, 0.42, heat));
    colour = mix(colour, uHot, smoothstep(0.34, 0.72, heat));
    colour = mix(colour, uPeak, smoothstep(0.62, 0.94, heat));
    colour = mix(colour, uWhite, smoothstep(0.86, 1.0, heat) * uCollapse);

    // 4. The limb. One fresnel term does the job the eleven shells were doing collectively — a bright
    //    edge where the line of sight grazes the surface, and an alpha that reaches zero exactly at
    //    the silhouette so the canvas stays transparent outside the star.
    float facing = clamp(dot(normalize(vNormalView), normalize(vViewDirection)), 0.0, 1.0);
    float rim = pow(1.0 - facing, PLASMA_RIM_POWER);
    colour *= PLASMA_EXPOSURE * (1.0 + uCollapse * PLASMA_COLLAPSE_EXPOSURE)
            * (1.0 + rim * PLASMA_RIM_GAIN);

    float alpha = clamp(pow(facing, PLASMA_EDGE) + rim * 0.35, 0.0, 1.0);

    gl_FragColor = vec4(colour, alpha);

    // 5. Into the same chain as everything else in this scene.
    //
    // A ShaderMaterial does NOT get these for free. three appends tone mapping and the output
    // colour-space conversion to its OWN materials; a raw shader gets them only by including the
    // chunks. Without these two lines the plasma would emit raw linear values straight to the canvas
    // while the crust beside it went through ACES and the exposure — the two halves of one star
    // graded differently, which reads as the surface not belonging to the object.
    //
    // They are no-ops in the render that matters most: three compiles tone mapping in only when the
    // destination is the CANVAS, so the sun bloom pass into its scene target — the one the bright
    // pass reads — stays linear HDR either way. That is the behaviour the bloom is graded against.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface SunPlasma {
  readonly mesh: THREE.Mesh;
  /** Advance the field and re-grade it. Called every drawn frame; three uniform writes. */
  update(elapsedSeconds: number, cracks: number, collapse: number): void;
  dispose(): void;
}

/**
 * Build the plasma surface.
 *
 * ⚠ The caller must add the mesh to `coronaParts` as well as to the scene. That array is what
 * `positionShards` scales from nothing at `CORONA_APPEAR`, and it is the whole reason the star lights
 * INSIDE its closing shell rather than being on screen for the entire download.
 */
export function createSunPlasma(): SunPlasma {
  const geometry = new THREE.SphereGeometry(PLASMA_RADIUS, PLASMA_SEGMENTS, PLASMA_SEGMENTS / 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCracks: { value: 0 },
      uCollapse: { value: 0 },
      uDeep: { value: new THREE.Vector3(...heatToVec3(HEAT_200)) },
      uMid: { value: new THREE.Vector3(...heatToVec3(HEAT_400)) },
      uHot: { value: new THREE.Vector3(...heatToVec3(HEAT_600)) },
      uPeak: { value: new THREE.Vector3(...heatToVec3(HEAT_900)) },
      uWhite: { value: new THREE.Vector3(...heatToVec3(HEAT_950)) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    // ⚠ `defines`, not string substitution into the source. The first cut replaced tokens by regex and
    // it was one rename away from silent nonsense — `CHURN` is a substring of `COLLAPSE_CHURN` and
    // `EXPOSURE` of `COLLAPSE_EXPOSURE`, so the whole thing only worked because the longer names
    // happened to be replaced first. three emits these as `#define`, which is what a compile-time
    // constant is for, and it still lets the compiler unroll the octave loop.
    //
    // Floats are strings so they keep their decimal point: `#define CHURN 0` would make the shader
    // integer-divide and the surface would stop moving.
    // ⚠ Every name is prefixed. three prepends its own block of `#define`s to every fragment shader,
    // and bare names like SCALE, EDGE or EXPOSURE are exactly the sort that collide with a renderer
    // feature flag one version from now — silently, because a redefinition is legal and the shader
    // would simply compute something else.
    defines: {
      PLASMA_OCTAVES: NOISE_OCTAVES,
      PLASMA_CHURN: CHURN_SPEED.toFixed(4),
      PLASMA_COLLAPSE_CHURN: COLLAPSE_CHURN_GAIN.toFixed(3),
      PLASMA_SCALE: NOISE_SCALE.toFixed(3),
      PLASMA_WARP: DOMAIN_WARP.toFixed(3),
      PLASMA_RIM_POWER: RIM_POWER.toFixed(3),
      PLASMA_RIM_GAIN: RIM_GAIN.toFixed(3),
      PLASMA_EXPOSURE: BASE_EXPOSURE.toFixed(3),
      PLASMA_COLLAPSE_EXPOSURE: COLLAPSE_EXPOSURE_GAIN.toFixed(3),
      PLASMA_EDGE: EDGE_SOFTNESS.toFixed(3),
    },
    transparent: true,
    // ⚠ Off, and both halves matter. The shards share this volume, so a plasma that wrote depth would
    // punch them out of the frame; and the star is its own light source, so nothing in the scene
    // should occlude it by being marginally nearer the camera.
    depthWrite: false,
    // ⚠ Derived from the radius rather than fixed, so the two cannot fall out of step. Inside the
    // crust the far hemisphere is what shows through the widening gaps and the star would read as
    // hollow without it; at the atmosphere radius that hemisphere is behind opaque shards, so drawing
    // it is a second full pass of fragments for something the depth test throws away.
    side: PLASMA_RADIUS < CRUST_RADIUS ? THREE.DoubleSide : THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sun_plasma';
  // Never culled: it is centred on the model origin and always in frame, and the frustum test is
  // wasted work on the one object that is never off screen.
  mesh.frustumCulled = false;
  // Painted after the opaque crust, before the additive glow composite.
  mesh.renderOrder = 1;

  return {
    mesh,
    update(elapsedSeconds, cracks, collapse) {
      material.uniforms.uTime.value = elapsedSeconds;
      material.uniforms.uCracks.value = cracks;
      material.uniforms.uCollapse.value = collapse;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
