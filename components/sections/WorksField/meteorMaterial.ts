import * as THREE from 'three';
import { SLATE_200 } from '@/lib/coolPalette';

// The debris treatment: the shared rock texture, cool-tinted and matte, so the chunks drifting past
// read as cold stone against the one lit rock at the centre.
//
// There is no fire material any more. The meteor's molten look used to be a self-lit shader on a second
// shell; it now comes out of the surface texture's own emissive channel (see meteorBody.ts), which is
// both cheaper and more convincing than the procedural flame it replaced.

// ── Stone (inactive) ──────────────────────────────────────────────────
const STONE_TINT       = SLATE_200; // cool slate the rock albedo is multiplied by
const STONE_METALNESS  = 0.15;
const STONE_ROUGHNESS  = 0.85;
const STONE_NORMAL_SCALE = 0.8;
const STONE_ENV_INTENSITY = 0.35;

/**
 * The cool rock material for an inactive meteor / shard. `albedoMap` is multiplied by a slate tint
 * so every body sits in the cold half of the palette; the focused one becomes fire on top of this.
 */
export function createStoneMaterial(
  albedoMap: THREE.Texture,
  options?: { tint?: number; roughness?: number; flatShading?: boolean },
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: albedoMap,
    color: options?.tint ?? STONE_TINT,
    metalness: STONE_METALNESS,
    roughness: options?.roughness ?? STONE_ROUGHNESS,
    envMapIntensity: STONE_ENV_INTENSITY,
    flatShading: options?.flatShading ?? false,
    transparent: true,
  });
  // Remember the design opacity so the ignite cross-fade can restore it.
  material.userData.baseOpacity = 1;
  return material;
}
