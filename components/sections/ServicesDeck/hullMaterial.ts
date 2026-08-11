import * as THREE from 'three';
import type { VesselProfile } from './deckServices';

/**
 * The vessel's skin.
 *
 * ── Read this before changing anything: the texture is a TRIM MASK, not a colour source ──────────
 * `vessel-albedo.jpg` is 512² and it is ~97 % pure black with thin (1–3 px) saturated amber lines
 * tracing every panel seam. There is no panel shading in it, no ambient occlusion, no surface
 * variation — the hull's form in the model's own reference render comes entirely from studio lighting.
 * What the texture carries is the ship's circuitry, and that circuitry is already, exactly, the site's
 * `--heat-600`. The model arrived on-brand.
 *
 * ⚠ The material this replaces was written for the OLD FLEET — four third-party hulls that came in the
 * wrong colours and had to be forced onto a palette by grading their albedo LUMINANCE onto three tones.
 * Against this texture that did three things wrong at once:
 *
 *   · 97 % of the texture sits at luminance ~0, so the whole hull collapsed onto one flat shadow tone;
 *   · the amber trim sits at luminance ≈0.63, under the 0.84 emissive threshold, so IT NEVER GLOWED;
 *   · and that same mid-scale luminance graded the trim between the hull and highlight tones, so the
 *     amber lines came out GREY — the one feature the ship exists for, converted into the thing it is
 *     supposed to stand out from.
 *
 * A luminance threshold cannot tell a bright grey panel from an amber line. So this separates on
 * SATURATION instead, which on this texture is a perfect binary: the hull is desaturated at every
 * brightness, the trim is saturated at every brightness.
 *
 *        saturation  0.0 ──────────────────────────► 1.0
 *                    ████████ hull            ▓▓▓▓ trim
 *                            └── one clean cut ──┘
 *
 * The trim colour is then entirely OURS, which is what lets each wave's parts glow their own
 * discipline's colour along the same circuitry — one machine, four circuit colours, carried by the
 * model's own design language rather than imposed on it.
 */

// ── The trim cut ──
// Generous margins either side of the real gap. Measured in LINEAR space (three's `<map_fragment>`
// has already decoded sRGB by the time we see `diffuseColor`), where the separation is even wider than
// it is in sRGB: the amber reaches ~0.99 saturation and the hull sits near 0. The smoothstep is what
// antialiases the JPEG's colour fringing along each line rather than crawling.
const TRIM_SAT_LOW  = 0.25;
const TRIM_SAT_HIGH = 0.55;
// The trim's own brightness still modulates its glow, so a line that tapers in the texture tapers in
// the light. Below the knee is hull; above it the line burns at full strength.
const TRIM_LUM_FLOOR = 0.02;
const TRIM_LUM_KNEE  = 0.30;
/** How much of the trim colour lands in the DIFFUSE as well as the emissive — without this the lines
 *  read as an additive overlay floating above the hull rather than as lit material. */
const TRIM_DIFFUSE_MIX = 0.35;

// ── The silhouette ──
// ⚠ Both raised for this model. A near-black hull on a near-black stage is read almost entirely by its
// edges, and these two are what draw them. `RIM_POWER` DOWN widens the catch (the exponent is on an
// inverted dot product, so lower = broader); `RIM_STRENGTH` up makes it carry.
const RIM_POWER    = 2.4; // was 3.0 — a tighter rim vanished on a black hull
const RIM_STRENGTH = 0.9; // was 0.6

/** Per-PART uniforms shared across one cluster's materials (each part drives these as a unit). */
export interface HullUniforms {
  /** Hull brightness — cold while the part is loose, full once it has locked into the machine. */
  brightness: { value: number };
  /** Circuit breathing, the flash as a part locks, and the ignition surge. */
  emitPulse: { value: number };
}

// Promote a loaded MeshStandardMaterial to a MeshPhysicalMaterial so it can wear clearcoat +
// iridescence. We copy only the maps/props we need rather than `.copy()`, because copying from a plain
// standard material would stomp the physical defaults (ior, clearcoat…) with `undefined`.
function upgradeToPhysical(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const physical = new THREE.MeshPhysicalMaterial();
  physical.name = source.name;
  physical.map = source.map;
  physical.normalMap = source.normalMap;
  physical.normalScale.copy(source.normalScale);
  physical.roughnessMap = source.roughnessMap;
  physical.metalnessMap = source.metalnessMap;
  physical.aoMap = source.aoMap;
  physical.aoMapIntensity = source.aoMapIntensity;
  physical.emissiveMap = source.emissiveMap;
  physical.emissive.copy(source.emissive);
  physical.emissiveIntensity = source.emissiveIntensity;
  physical.alphaMap = source.alphaMap;
  physical.color.copy(source.color);
  physical.opacity = source.opacity;
  physical.side = source.side;
  physical.vertexColors = source.vertexColors;
  physical.flatShading = source.flatShading;
  return physical;
}

// Inject the trim-mask shader. The mask + hull colour are resolved at <normal_fragment_begin> (where
// the texture-sampled diffuseColor and the view-space normal are both in scope); the glow is added at
// <emissivemap_fragment> — AFTER the emissive map multiply — so a black emissive map cannot cancel it.
function applyVesselSkin(
  material: THREE.MeshStandardMaterial,
  profile: VesselProfile,
  uniforms: HullUniforms,
) {
  const shaderUniforms = {
    uHull: { value: new THREE.Color(profile.hull) },
    uHullLift: { value: profile.hullLift },
    uTrim: { value: new THREE.Color(profile.trim) },
    uTrimGlow: { value: profile.trimGlow },
    uRim: { value: new THREE.Color(profile.rim) },
    uTrimSatLow: { value: TRIM_SAT_LOW },
    uTrimSatHigh: { value: TRIM_SAT_HIGH },
    uTrimLumFloor: { value: TRIM_LUM_FLOOR },
    uTrimLumKnee: { value: TRIM_LUM_KNEE },
    uTrimDiffuseMix: { value: TRIM_DIFFUSE_MIX },
    uRimPower: { value: RIM_POWER },
    uRimStrength: { value: RIM_STRENGTH },
  };
  material.userData.vesselUniforms = shaderUniforms;
  material.userData.tintBrightness = uniforms.brightness;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shaderUniforms, {
      uTintBrightness: uniforms.brightness,
      uEmitPulse: uniforms.emitPulse,
    });

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uHull;
        uniform float uHullLift;
        uniform vec3 uTrim;
        uniform float uTrimGlow;
        uniform vec3 uRim;
        uniform float uTrimSatLow;
        uniform float uTrimSatHigh;
        uniform float uTrimLumFloor;
        uniform float uTrimLumKnee;
        uniform float uTrimDiffuseMix;
        uniform float uRimPower;
        uniform float uRimStrength;
        uniform float uTintBrightness;
        uniform float uEmitPulse;
        float vesselTrim;
        float vesselLum;
        float vesselFresnel;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        // 1. Split the texture into hull and trim by SATURATION. This texture is black plus saturated
        //    amber lines and nothing else, so one cut separates them at any brightness.
        float vesselMax = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        float vesselMin = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
        float vesselSat = vesselMax > 0.001 ? (vesselMax - vesselMin) / vesselMax : 0.0;
        vesselTrim = smoothstep(uTrimSatLow, uTrimSatHigh, vesselSat);
        vesselLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));

        // 2. The hull is a CONSTANT dark metal, not the texture's black — the texture carries no shading
        //    to preserve, and pure black on a black stage has no form at all. Whatever faint luminance
        //    the albedo does hold lifts it slightly, so panel-to-panel variation survives.
        vec3 vesselHull = uHull * (1.0 + uHullLift * vesselLum);
        diffuseColor.rgb = mix(vesselHull, uTrim * uTrimDiffuseMix, vesselTrim) * uTintBrightness;

        // 3. Silhouette fresnel, used for the edge catch below. On a black hull this is most of what
        //    tells you where the ship ends.
        vesselFresnel = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), uRimPower);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // 4. Burn the circuitry. The trim's own brightness modulates it, so a line that tapers in the
        //    texture tapers in the light. This is the only thing on the ship that exceeds 1.0, which is
        //    what lets the bloom threshold pick it out without hazing the hull.
        float vesselGlow = vesselTrim * uTrimGlow * uEmitPulse
          * smoothstep(uTrimLumFloor, uTrimLumKnee, vesselLum);
        totalEmissiveRadiance +=
          (uTrim * vesselGlow + uRim * vesselFresnel * uRimStrength) * uTintBrightness;`,
      );
  };
  material.needsUpdate = true;
}

// Build the final material for one loaded source material. Full path → MeshPhysicalMaterial (clearcoat
// + iridescence); low-power path → the lighter MeshStandardMaterial. Both inject the same shader, so
// the look is consistent — just cheaper on weak devices.
function createVesselMaterial(
  source: THREE.MeshStandardMaterial,
  profile: VesselProfile,
  uniforms: HullUniforms,
  lowPower: boolean,
): THREE.MeshStandardMaterial {
  const material = lowPower ? source : upgradeToPhysical(source);

  material.metalness = profile.metalness;
  material.roughness = profile.roughness;
  material.envMapIntensity = profile.envIntensity;

  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.clearcoat = profile.clearcoat;
    material.clearcoatRoughness = profile.clearcoatRoughness;
    material.iridescence = profile.iridescence;
    material.iridescenceIOR = profile.iridescenceIOR;
  }

  // The shader adds to `totalEmissiveRadiance` directly, so the material's own emissive must stay black
  // or it lays a flat wash over the whole hull. (This model ships no emissive map.)
  material.emissive.set(0x000000);

  // ⚠ OPAQUE, where the fleet's hulls were transparent. That transparency existed only for the portal
  // swap's presence fade, and it is actively wrong here: the nine clusters interpenetrate at every
  // seam, and nine transparent meshes are sorted by distance rather than depth-tested — so the ship
  // would show its parts drawing through one another wherever two of them meet.
  material.transparent = false;

  applyVesselSkin(material, profile, uniforms);
  return material;
}

/**
 * Walk one loaded part, replace every standard material with its wave's skin, reassign it to the mesh,
 * and return the final material list.
 *
 * ⚠ Call this PER CLUSTER, with that cluster's wave profile — and on cloned source materials. Every
 * cluster in vessel.glb references the same glTF material, and GLTFLoader hands out one shared
 * THREE.Material instance for it, so re-skinning in place would give all nine parts whichever wave's
 * trim colour happened to be applied last.
 */
export function applyHullMaterials(
  root: THREE.Object3D,
  profile: VesselProfile,
  uniforms: HullUniforms,
  lowPower: boolean,
): THREE.Material[] {
  const materials: THREE.Material[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const sources = Array.isArray(child.material) ? child.material : [child.material];
    const built = sources.map((source) =>
      source instanceof THREE.MeshStandardMaterial
        ? createVesselMaterial(source, profile, uniforms, lowPower)
        : source,
    );
    child.material = Array.isArray(child.material) ? built : built[0];
    materials.push(...built);
  });
  return materials;
}
