import * as THREE from 'three';
import type { ShipProfile, GradedProfile, LegacyProfile } from './deckServices';

// Each hull's albedo is re-graded onto its ship's palette instead of being washed to one flat hue:
// the model's own albedo *luminance* drives a three-tone map (shadow → hull → highlight), so the
// surface keeps its real tonal variation (panels, recesses, worn edges read separately) — it looks
// like a real, multi-material machine, never one solid colour. On top of that the brightest texels
// (engines, windows) are picked out as an accent glow that feeds the bloom pass, and the silhouette
// catches a thin fresnel rim. The model's normal / roughness / metalness maps are left untouched,
// so all the PBR realism survives the recolour.

const RIM_POWER    = 3.0; // higher → the rim hugs the silhouette more tightly
const RIM_STRENGTH = 0.6; // how strong the edge catch reads

// Legacy (pre-overhaul) flat-tint treatment — see LegacyProfile in deckServices.
const LEGACY_ENV_INTENSITY  = 1.2;
const LEGACY_FRESNEL_POWER  = 2.2;

/** The rim-light colour a ship's edge light should ease to — the graded `rim`, or the legacy `colorEdge`. */
export function rimColorOf(profile: ShipProfile): string {
  return profile.kind === 'legacy' ? profile.colorEdge : profile.rim;
}

/** Per-ship uniforms shared across all of a hull's materials (the ship drives these as a unit). */
export interface HullUniforms {
  /** Hull brightness — 1 when centred, lower as the craft leaves the pad. */
  brightness: { value: number };
  /** Engine-glow breathing — 1 at rest, modulated on the centred craft. */
  emitPulse: { value: number };
}

/** The graded-palette uniforms, stored on `material.userData.hullUniforms` for the dev tuning panel. */
export interface HullShaderUniforms {
  uHullShadow: { value: THREE.Color };
  uHullMid: { value: THREE.Color };
  uHullHighlight: { value: THREE.Color };
  uAccent: { value: THREE.Color };
  uRim: { value: THREE.Color };
  uGradeMid: { value: number };
  uEmitThreshold: { value: number };
  uEmitStrength: { value: number };
  uRimPower: { value: number };
  uRimStrength: { value: number };
}

// Promote a loaded MeshStandardMaterial to a MeshPhysicalMaterial so it can wear clearcoat +
// iridescence. We copy only the maps/props we need rather than `.copy()`, because copying from a
// plain standard material would stomp the physical defaults (ior, clearcoat…) with `undefined`.
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

// Inject the graded-palette shader. The grade runs at <normal_fragment_begin> (where the
// texture-sampled diffuseColor + view-space normal are in scope); the accent/rim glow is added at
// <emissivemap_fragment> — AFTER the emissive map multiply — so a black emissive map can't cancel it.
function applyGradedHull(
  material: THREE.MeshStandardMaterial,
  profile: GradedProfile,
  uniforms: HullUniforms,
) {
  const shaderUniforms: HullShaderUniforms = {
    uHullShadow: { value: new THREE.Color(profile.shadow) },
    uHullMid: { value: new THREE.Color(profile.hull) },
    uHullHighlight: { value: new THREE.Color(profile.highlight) },
    uAccent: { value: new THREE.Color(profile.accent) },
    uRim: { value: new THREE.Color(profile.rim) },
    uGradeMid: { value: profile.gradeMid },
    uEmitThreshold: { value: profile.emitThreshold },
    uEmitStrength: { value: profile.emitStrength },
    uRimPower: { value: RIM_POWER },
    uRimStrength: { value: RIM_STRENGTH },
  };
  // Exposed so applyLitState can drive brightness and the dev panel can retune live.
  material.userData.tintBrightness = uniforms.brightness;
  material.userData.hullUniforms = shaderUniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shaderUniforms, {
      uTintBrightness: uniforms.brightness,
      uEmitPulse: uniforms.emitPulse,
    });

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uHullShadow;
        uniform vec3 uHullMid;
        uniform vec3 uHullHighlight;
        uniform vec3 uAccent;
        uniform vec3 uRim;
        uniform float uGradeMid;
        uniform float uEmitThreshold;
        uniform float uEmitStrength;
        uniform float uRimPower;
        uniform float uRimStrength;
        uniform float uTintBrightness;
        uniform float uEmitPulse;
        float hullLum;
        float hullFresnel;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        // 1. Grade the albedo by its own luminance — keeps panel/detail variation, swaps the palette.
        hullLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 hullGraded = mix(uHullShadow, uHullMid, smoothstep(0.0, uGradeMid, hullLum));
        hullGraded = mix(hullGraded, uHullHighlight, smoothstep(uGradeMid, 1.0, hullLum));
        diffuseColor.rgb = hullGraded * uTintBrightness;
        // 2. Silhouette fresnel, used for the rim glow below.
        hullFresnel = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), uRimPower);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // 3. Pick the brightest texels out as accent glow (engines/windows) + add the rim catch.
        float hullEmit = smoothstep(uEmitThreshold, 1.0, hullLum) * uEmitStrength * uEmitPulse;
        totalEmissiveRadiance += (uAccent * hullEmit + uRim * hullFresnel * uRimStrength) * uTintBrightness;`,
      );
  };
  material.needsUpdate = true;
}

// The original flat two-tone tint: the model's texture multiplied by a fresnel mix from colorCore
// (facing the camera) to colorEdge (grazing). Injected exactly as the pre-overhaul build did.
function applyLegacyTint(
  material: THREE.MeshStandardMaterial,
  profile: LegacyProfile,
  uniforms: HullUniforms,
) {
  const uColorCore = { value: new THREE.Color(profile.colorCore) };
  const uColorEdge = { value: new THREE.Color(profile.colorEdge) };
  material.userData.tintBrightness = uniforms.brightness;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uColorCore,
      uColorEdge,
      uTintBrightness: uniforms.brightness,
      uFresnelPower: { value: LEGACY_FRESNEL_POWER },
    });
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uColorCore;
        uniform vec3 uColorEdge;
        uniform float uTintBrightness;
        uniform float uFresnelPower;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        float hullFresnel = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), uFresnelPower);
        diffuseColor.rgb *= mix(uColorCore, uColorEdge, hullFresnel) * uTintBrightness;`,
      );
  };
  material.needsUpdate = true;
}

// Restore the original treatment for a legacy ship: keep the loaded MeshStandardMaterial (and its
// native metalness/roughness), just retint it and wire up the swap fade.
function createLegacyHull(
  source: THREE.MeshStandardMaterial,
  profile: LegacyProfile,
  uniforms: HullUniforms,
): THREE.MeshStandardMaterial {
  source.envMapIntensity = LEGACY_ENV_INTENSITY;
  source.transparent = true;
  source.userData.baseOpacity = source.opacity;
  applyLegacyTint(source, profile, uniforms);
  return source;
}

// Build the final hull material for one loaded source material. Legacy ships → the original flat
// tint. Otherwise: full path → MeshPhysicalMaterial (clearcoat + iridescence); low-power path →
// the lighter MeshStandardMaterial. Either graded path injects the same shader, so the look is
// consistent — just cheaper on weak devices.
function createHullMaterial(
  source: THREE.MeshStandardMaterial,
  profile: ShipProfile,
  uniforms: HullUniforms,
  lowPower: boolean,
): THREE.MeshStandardMaterial {
  if (profile.kind === 'legacy') {
    return createLegacyHull(source, profile, uniforms);
  }

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

  // Native engine lights (an emissive map) take the accent colour; with no map the threshold
  // pickout in the shader is the only glow, so keep the base emissive dark to avoid a flat wash.
  material.emissive.set(material.emissiveMap ? profile.accent : 0x000000);

  // Swap fades need transparency; remember the design opacity for the presence fade.
  material.transparent = true;
  material.userData.baseOpacity = material.opacity;

  applyGradedHull(material, profile, uniforms);
  return material;
}

/**
 * Walk a loaded vessel, replace every standard hull material with its graded-palette equivalent,
 * reassign it to the mesh, and return the final material list (for the lit/opacity drivers).
 */
export function applyHullMaterials(
  root: THREE.Object3D,
  profile: ShipProfile,
  uniforms: HullUniforms,
  lowPower: boolean,
): THREE.Material[] {
  const materials: THREE.Material[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const sources = Array.isArray(child.material) ? child.material : [child.material];
    const built = sources.map((source) =>
      source instanceof THREE.MeshStandardMaterial
        ? createHullMaterial(source, profile, uniforms, lowPower)
        : source,
    );
    child.material = Array.isArray(child.material) ? built : built[0];
    materials.push(...built);
  });
  return materials;
}
