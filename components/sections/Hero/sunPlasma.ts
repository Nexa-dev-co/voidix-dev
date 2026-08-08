import * as THREE from 'three';
import { HEAT_100, HEAT_400, HEAT_600, HEAT_800, HEAT_950 } from '@/lib/heatPalette';

/**
 * The star's burning surface, procedurally.
 *
 * ── ⚠ THIS IS THE SITE'S ORIGINAL SUN, RECOVERED ─────────────────────────────────────────────────
 * The shader below is `components/sections/Hero/sunShaders.ts` from the `enhancement` branch — the
 * procedural plasma star this site shipped before `fractured_sun.glb` replaced it, and which
 * CLAUDE.md's "The shared sun" section records being superseded. It is here almost verbatim, because
 * a from-scratch rewrite was tried first and looked wrong, and the differences are worth naming so
 * nobody re-derives the same mistakes:
 *
 *   · ASHIMA SIMPLEX, not hash-based value noise. Value noise lives on a lattice and its artefacts are
 *     axis-aligned — on a sphere that reads as faint square banding no amount of octaves removes.
 *     This is the single biggest reason the rewrite looked synthetic.
 *   · The noise is sampled on `normalize(position)` — the UNIT sphere direction, so the pattern is
 *     painted onto the surface at a constant scale rather than varying with radius.
 *   · LIMB DARKENING FIRST, rim second. Real stars are darker at the edge; adding a bright rim without
 *     darkening under it is what makes a sphere read as plastic.
 *   · A separate, sharper FLARE layer over the granulation — the bright active regions.
 *   · Five octaves, not three.
 *
 * ── What it replaces on this branch ──────────────────────────────────────────────────────────────
 * `fractured_sun.glb` carries its atmosphere as ELEVEN translucent spheres (`sunouter`, alpha 0.82),
 * offset through the same two-unit volume rather than stacked concentrically. Eleven blended meshes,
 * and `sunBloom` renders the scene TWICE per drawn frame — twenty-two passes of framebuffer
 * read-modify-write over the star's footprint. Measured on the reference laptop, `sun · bloom` per
 * call: 17.5 ms with everything · 7.4 ms after the flare and blowout cull · 1.58 ms for the bare
 * shards. So roughly 5.8 ms is what this file exists to take.
 *
 * ⚠ ONE SURFACE, NOT A VOLUME. The trade works because GPUs have far more ALU headroom than blend
 * bandwidth. Raymarching this would spend the entire win and more. If it ever needs more depth, buy it
 * with a better noise field, never with more samples along a ray.
 */

// ── Where the surface sits ───────────────────────────────────────────────────────────────────────
/**
 * The plasma sphere's radius, in model units.
 *
 * ⚠ THIS IS THE DIAL THAT CHOOSES WHAT THE STAR IS, and it wants eyes rather than arithmetic:
 *
 *     ~1.00   A CLEAN STAR. The sphere covers the fractured crust (which sits at 0.965), so at rest
 *             you see the plasma ball the `enhancement` branch had. The shards emerge from behind it
 *             as the Cracks ramp pushes them outward. This is the default because it is what was
 *             asked for — the old sun, in amber.
 *     ~0.94   CRUST OVER FIRE. Inside the shards, so they read as dark plate with plasma showing
 *             through the widening gaps — what CORONA_APPEAR's comment has always described.
 *
 * Measured off the GLB: the smooth core sphere `Sphere_0` is r 0.965; the ten shard cells span 0.38
 * to ~1.0 from the origin, so they are wedges through the volume rather than a thin shell.
 */
const PLASMA_RADIUS = 1.0;
/** Where the fractured crust is. Only decides which way the surface faces — see `side` below. */
const CRUST_RADIUS = 0.965;
/** The original used 64×64. The star is ~250 device pixels across; this is a curve either way. */
const PLASMA_SEGMENTS = 64;

// ── Colour: the same star, on this site's ramp ───────────────────────────────────────────────────
/**
 * The original was electric cyan — `core 0xd8f6ff · mid 0x00d9ff · deep 0x012b52` — and its own
 * comment offered the warm swap: *"core 0xfff2c8 / mid 0xff8a2b / deep 0x6e1f02 to make it a classic
 * orange sun instead."*
 *
 * ⚠ Those three suggestions land almost exactly on stops the heat ramp already has (0xff8a2b against
 * `--heat-600`'s 0xff8a1a; 0x6e1f02 against `--heat-200`'s 0x6b1a04), so the ramp is used directly
 * rather than the literals. That is not tidiness for its own sake: it means retuning `--heat-600`
 * still moves the star, which is the whole point of there being one anchor.
 */
const COLOR_CORE = HEAT_950; // white-hot brightest granules — the value COLLAPSE_CORE_LIGHT already uses
const COLOR_HOT = HEAT_800; // brushed warm metal — the step below white
const COLOR_BODY = HEAT_600; // ⭐ THE ANCHOR — the sun's own light
/**
 * The convection lanes, and they are a PAIR rather than one colour.
 *
 * The original had a single deep stop and the troughs stayed that colour forever. But this star
 * cracks: `coreLight`'s comment describes *"amber escaping through widening gaps, then white-hot
 * compression"*, and until now that was done entirely by a light and an emissive map on the crust
 * while the surface itself stayed cold in the lanes.
 *
 * So the lanes ride the ramps. At rest they are char — barely-glowing matter between granules. As
 * Cracks and Collapse rise they go molten, which is the star lighting from WITHIN rather than merely
 * getting brighter. Costs one `mix`, no extra noise.
 */
const COLOR_LANE_COLD = HEAT_100; // char
const COLOR_LANE_HOT = HEAT_400; // the spiral — molten, still clearly below the body

// ── Surface tuning, carried over from the original ───────────────────────────────────────────────
/** Size of the convection cells. */
const NOISE_SCALE = 2.4;
/** How fast the surface boils. */
const FLOW_SPEED = 0.5;
/** Granulation contrast. */
const SURFACE_CONTRAST = 1.35;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vLocalPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;

  void main() {
    // Local position drives the noise so the plasma pattern is painted onto the sphere and rotates
    // with it, rather than swimming in screen space.
    vLocalPosition = position;
    vViewNormal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// ⚠ No backticks anywhere below. Inside a glsl template literal one terminates the string, and
// CLAUDE.md records this biting three times now — every one of them from a comment.
const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vLocalPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;

  uniform float uTime;
  uniform vec3  uColorCore;
  uniform vec3  uColorHot;
  uniform vec3  uColorBody;
  uniform vec3  uColorLaneCold;
  uniform vec3  uColorLaneHot;
  uniform float uNoiseScale;
  uniform float uFlowSpeed;
  uniform float uContrast;
  uniform float uIntensity;   // the Cracks ramp: 0 = calm hero star, 1 = restless
  uniform float uCollapse;    // the Collapse ramp: drives it white-hot and violent across works

  // Restless-state drama: extra flare energy and harder granulation.
  const float INTENSITY_FLARE_BOOST    = 2.6;
  const float INTENSITY_CONTRAST_BOOST = 0.5;
  const float INTENSITY_LANE_HEAT      = 0.7;  // how far Cracks alone lights the lanes

  // ── The collapse ─────────────────────────────────────────────────────────────
  // It goes further than Cracks on every axis, and one of these is not just "more".
  const float COLLAPSE_FLARE_BOOST     = 4.5;
  const float COLLAPSE_FLOW_BOOST      = 3.2;
  const float COLLAPSE_CONTRAST_BOOST  = 1.1;
  const float COLLAPSE_WHITEN          = 0.55;
  const float COLLAPSE_RIM_BOOST       = 2.2;
  /**
   * The granulation gets FINER as the star crushes in — the same surface features carried onto a
   * smaller sphere. This is the figure-skater effect the rotation already has (see
   * COLLAPSE_ROTATE_DEGREES_PER_SECOND in SunModelCanvas), applied to the surface as well, and it is
   * what stops the collapse reading as the star simply getting brighter and faster.
   */
  const float COLLAPSE_SCALE_GAIN      = 1.6;

  // ── Depth ────────────────────────────────────────────────────────────────────
  /**
   * Looking INTO the star at the centre of the disc, where the line of sight goes deepest through the
   * hot body. The complement of limb darkening rather than a repeat of the rim, and between them the
   * sphere stops reading as a lit ball and starts reading as a volume. Free — it reuses the same
   * fresnel term the limb and rim already need.
   */
  const float CORE_DEPTH_POWER         = 2.2;
  const float CORE_DEPTH_INTENSITY     = 0.5;

  const int   FBM_OCTAVES        = 5;
  const float FBM_INITIAL_AMP    = 0.5;
  const float FBM_LACUNARITY     = 2.0;
  const float FBM_GAIN           = 0.5;
  const float WARP_FREQUENCY     = 1.6;
  const float WARP_STRENGTH      = 0.35;

  // Four ramp segments, not two. A star's temperature gradient is not linear, and mixing straight
  // from the lanes to the anchor left the mid-tones a flat wash of one colour across most of the disc.
  const float HEAT_LANE_EDGE     = 0.05;
  const float HEAT_BODY_EDGE     = 0.48;
  const float HEAT_HOT_EDGE      = 0.74;

  const float FLARE_FREQUENCY    = 2.1;
  const float FLARE_SHARPNESS    = 3.0;
  const float FLARE_INTENSITY    = 0.6;

  const float LIMB_DARKEN_FLOOR  = 0.45;
  const float LIMB_DARKEN_POWER  = 2.0;
  const float RIM_POWER          = 3.5;
  const float RIM_INTENSITY      = 0.9;

  // Ashima Arts 3D simplex noise (webgl-noise, MIT).
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float fbm(vec3 point) {
    float total = 0.0;
    float amplitude = FBM_INITIAL_AMP;
    for (int octave = 0; octave < FBM_OCTAVES; octave++) {
      total += snoise(point) * amplitude;
      point *= FBM_LACUNARITY;
      amplitude *= FBM_GAIN;
    }
    return total;
  }

  void main() {
    vec3 spherePoint = normalize(vLocalPosition);
    float flow = uTime * uFlowSpeed * (1.0 + uCollapse * COLLAPSE_FLOW_BOOST);

    // 1. Domain-warp the sample point so the plasma swirls and churns instead of just scrolling past
    //    — this is what reads as turbulent convection.
    // The field TIGHTENS as the star crushes in — see COLLAPSE_SCALE_GAIN.
    vec3 sampleCoord = spherePoint * uNoiseScale * (1.0 + uCollapse * COLLAPSE_SCALE_GAIN);
    float warp = snoise(sampleCoord * WARP_FREQUENCY + vec3(0.0, 0.0, flow));
    vec3 churned = sampleCoord + warp * WARP_STRENGTH;

    // 2. Granulation — layered noise gives the boiling convection cells.
    float granulation = fbm(churned + vec3(flow * 0.15, -flow * 0.1, flow * 0.05));
    float heat = clamp(granulation * 0.5 + 0.5, 0.0, 1.0);
    heat = pow(heat, uContrast
                   + uIntensity * INTENSITY_CONTRAST_BOOST
                   + uCollapse * COLLAPSE_CONTRAST_BOOST);

    // 3. Surface flares — sharp, faster-moving hot spots layered over the body.
    float flarePattern = fbm(churned * FLARE_FREQUENCY - vec3(flow * 0.3));
    float flares = pow(clamp(flarePattern, 0.0, 1.0), FLARE_SHARPNESS);

    // 4. THE INSIDE. The lanes between granules are the thinnest part of the surface, so they are
    //    where a star that is coming apart shows its interior. At rest they are char; as Cracks and
    //    Collapse rise they go molten, which reads as the star lighting from within rather than
    //    merely getting brighter. One mix, no extra noise.
    float laneHeat = clamp(uIntensity * INTENSITY_LANE_HEAT + uCollapse, 0.0, 1.0);
    vec3 lanes = mix(uColorLaneCold, uColorLaneHot, laneHeat);

    // 5. Four ramp segments: lanes, body, hot, white-hot core.
    vec3 color = mix(lanes, uColorBody, smoothstep(HEAT_LANE_EDGE, HEAT_BODY_EDGE, heat));
    color = mix(color, uColorHot, smoothstep(HEAT_BODY_EDGE, HEAT_HOT_EDGE, heat));
    color = mix(color, uColorCore, smoothstep(HEAT_HOT_EDGE, 1.0, heat));
    color += uColorCore * flares * FLARE_INTENSITY
           * (1.0 + uIntensity * INTENSITY_FLARE_BOOST + uCollapse * COLLAPSE_FLARE_BOOST);

    // 6. Volume. THREE fresnel terms doing three different jobs, off one dot product:
    //    · depth      — the centre of the disc, where the line of sight runs deepest through hot body
    //    · limb       — darker toward the edge, which is what real stars do and what stops it reading
    //                   as a lit ball
    //    · chromosphere — a thin hot rim back at the silhouette so the edge glows rather than dies
    float facing = max(dot(normalize(vViewNormal), normalize(vViewDirection)), 0.0);
    float fresnel = 1.0 - facing;
    color += uColorCore * pow(facing, CORE_DEPTH_POWER) * CORE_DEPTH_INTENSITY * heat;
    color *= mix(1.0, LIMB_DARKEN_FLOOR, pow(fresnel, LIMB_DARKEN_POWER));
    color += uColorBody * pow(fresnel, RIM_POWER) * RIM_INTENSITY
           * (1.0 + uCollapse * COLLAPSE_RIM_BOOST);

    // 7. The collapse crushes the whole ramp toward the core colour — temperature, not exposure.
    color = mix(color, uColorCore, uCollapse * COLLAPSE_WHITEN);

    gl_FragColor = vec4(color, 1.0);

    // Into the same chain as the crust beside it. A ShaderMaterial does NOT get these for free —
    // three appends them to its OWN materials only. Without them the plasma emits raw linear values
    // to the canvas while the shards go through ACES and the exposure, and the two halves of one star
    // are graded differently.
    //
    // ⚠ The ORIGINAL ran on a renderer with NoToneMapping, so its three colours were authored raw.
    // Here they pass through ACES, which compresses the highlights — expect to lift them rather than
    // assume the old literals land identically.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface SunPlasma {
  readonly mesh: THREE.Mesh;
  /** Advance the field and re-grade it. Called every drawn frame; four uniform writes. */
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
  const geometry = new THREE.SphereGeometry(PLASMA_RADIUS, PLASMA_SEGMENTS, PLASMA_SEGMENTS);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0 },
      uColorCore: { value: new THREE.Color(COLOR_CORE) },
      uColorHot: { value: new THREE.Color(COLOR_HOT) },
      uColorBody: { value: new THREE.Color(COLOR_BODY) },
      uColorLaneCold: { value: new THREE.Color(COLOR_LANE_COLD) },
      uColorLaneHot: { value: new THREE.Color(COLOR_LANE_HOT) },
      uNoiseScale: { value: NOISE_SCALE },
      uFlowSpeed: { value: FLOW_SPEED },
      uContrast: { value: SURFACE_CONTRAST },
      uIntensity: { value: 0 },
      uCollapse: { value: 0 },
    },
    // ⚠ OPAQUE, and that is the original's design rather than an oversight: the fragment ends on
    // alpha 1.0 and the silhouette is carried by limb darkening plus the rim, not by a fade. A
    // transparent star was tried in the rewrite and it read as a ghost — the crust showed through the
    // body and nothing looked solid. Writing depth also means the shards occlude correctly once the
    // Cracks ramp pushes them out past this radius.
    transparent: false,
    // At the crust radius the far hemisphere is behind opaque geometry; inside it, that hemisphere is
    // what shows through the widening gaps. Derived so the two cannot fall out of step.
    side: PLASMA_RADIUS < CRUST_RADIUS ? THREE.DoubleSide : THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sun_plasma';
  // Centred on the model origin and always in frame — the frustum test is wasted work on the one
  // object that is never off screen.
  mesh.frustumCulled = false;

  return {
    mesh,
    update(elapsedSeconds, cracks, collapse) {
      material.uniforms.uTime.value = elapsedSeconds;
      material.uniforms.uIntensity.value = cracks;
      material.uniforms.uCollapse.value = collapse;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
