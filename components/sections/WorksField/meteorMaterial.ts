import * as THREE from 'three';
import { FIRE_METEOR_VERTEX_SHADER, FIRE_METEOR_FRAGMENT_SHADER } from './fireMeteorShaders';

// Two material treatments for the field:
//   • stone  — inactive meteors + shards: the rock texture, cool-tinted, matte. A real lit PBR
//              surface so the field reads as solid crystal under the stage lights.
//   • fire   — the focused project's meteor: the self-lit molten shader (fireMeteorShaders.ts),
//              cross-faded in over the stone one via `uIgnite`.
// Both are built transparent so ignite/cool can fade them against each other.

// ── Stone (inactive) ──────────────────────────────────────────────────
const STONE_TINT       = 0x2a3340; // cool slate the rock albedo is multiplied by
const STONE_METALNESS  = 0.15;
const STONE_ROUGHNESS  = 0.85;
const STONE_NORMAL_SCALE = 0.8;
const STONE_ENV_INTENSITY = 0.35;

// ── Fire (active) — default molten ramp, mid-tone tinted per project ──
const FIRE_EMBER = 0x3a0a02; // cooling crust
const FIRE_MID   = 0xff7a2a; // molten body (overridden by project.accent)
const FIRE_HOT   = 0xfff1c8; // white-hot granules / flares
const FIRE_NOISE_SCALE = 2.6;
const FIRE_FLOW_SPEED  = 0.5;
const FIRE_CONTRAST    = 1.3;
const FIRE_BASE_FLARE  = 0.6;

/** The live uniforms the render loop + the ?tune panel drive on a fire meteor. */
export interface FireMeteorUniforms {
  uTime:  { value: number };
  uMap:   { value: THREE.Texture };
  uEmber: { value: THREE.Color };
  uMid:   { value: THREE.Color };
  uHot:   { value: THREE.Color };
  uNoiseScale: { value: number };
  uFlowSpeed:  { value: number };
  uContrast:   { value: number };
  uFlare:      { value: number };
  uIgnite:     { value: number };
}

/**
 * The cool rock material for an inactive meteor / shard. `albedoMap` is multiplied by a slate tint
 * so every body sits in the cold half of the palette; the focused one becomes fire on top of this.
 */
export function createStoneMaterial(
  albedoMap: THREE.Texture,
  normalMap: THREE.Texture,
  options?: { tint?: number; roughness?: number; flatShading?: boolean },
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: albedoMap,
    normalMap,
    color: options?.tint ?? STONE_TINT,
    metalness: STONE_METALNESS,
    roughness: options?.roughness ?? STONE_ROUGHNESS,
    envMapIntensity: STONE_ENV_INTENSITY,
    flatShading: options?.flatShading ?? false,
    transparent: true,
  });
  material.normalScale.set(STONE_NORMAL_SCALE, STONE_NORMAL_SCALE);
  // Remember the design opacity so the ignite cross-fade can restore it.
  material.userData.baseOpacity = 1;
  return material;
}

/**
 * The molten shader material for the focused meteor. Returns the material plus its uniforms so the
 * scene can drive `uTime` / `uFlare` (the churn + breathing) and `uIgnite` (the ignite/cool fade).
 */
export function createFireMaterial(
  fireMap: THREE.Texture,
  accentHex?: string,
): { material: THREE.ShaderMaterial; uniforms: FireMeteorUniforms } {
  const uniforms: FireMeteorUniforms = {
    uTime:  { value: 0 },
    uMap:   { value: fireMap },
    uEmber: { value: new THREE.Color(FIRE_EMBER) },
    uMid:   { value: new THREE.Color(accentHex ?? FIRE_MID) },
    uHot:   { value: new THREE.Color(FIRE_HOT) },
    uNoiseScale: { value: FIRE_NOISE_SCALE },
    uFlowSpeed:  { value: FIRE_FLOW_SPEED },
    uContrast:   { value: FIRE_CONTRAST },
    uFlare:      { value: FIRE_BASE_FLARE },
    uIgnite:     { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader:   FIRE_METEOR_VERTEX_SHADER,
    fragmentShader: FIRE_METEOR_FRAGMENT_SHADER,
    // Our strongly-typed uniforms interface has no string index signature (ShaderMaterial expects
    // one); the shapes are otherwise identical, so bridge it here rather than loosening the type.
    uniforms: uniforms as unknown as { [uniform: string]: THREE.IUniform },
    transparent: true,
    depthWrite: false, // it fades over the stone shell beneath it; don't let alpha punch the depth buffer
  });

  return { material, uniforms };
}

export const FIRE_BASE_FLARE_VALUE = FIRE_BASE_FLARE;
