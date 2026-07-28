import * as THREE from 'three';

/**
 * The landing pad's model knowledge — shared by the deck that ships it and the lab that authors it.
 *
 * It lives here, in the section, rather than in `components/lab/PadLab`, because the deck is the
 * consumer and lab code must never reach the homepage bundle. The lab imports from here; nothing
 * here imports from the lab.
 *
 * All of this is keyed by MATERIAL name. That is the only stable identity the model has — its nodes
 * are Sketchfab noise (`Object_11`, `Object_13`…) and their indices depend on the glb's traverse
 * order, which a re-export can change without warning. The material names are authored.
 */

export const PAD_MODEL_PATH = '/models/champion_astro_ring.glb';

/**
 * The materials that act as the pad's light-emitting surfaces, and how hard each burns relative to
 * the master glow intensity.
 *
 * `interloper_rings` — the big outer rings, the brightest thing on the pad — ships with NO emissive
 * factor at all. It glows entirely because of this table.
 */
export const PAD_GLOW_MATERIALS: Record<string, number> = {
  interloper_rings: 1,
  c_sd_Meatcleaver_on: 0.85,
  xenint_copper00b_prop: 0.7,
  // Authored brighter than the rings (10 against a 5.6 master), hence a weight above 1.
  modelsprops_xeninterloperhologramsd_platform_shield: 1.79,
};

/**
 * How much environment light the pad's materials take.
 *
 * A property of the PAD, applied per-material, rather than a scene setting — and that distinction is
 * the whole point. The deck leaves `scene.environmentIntensity` at three's default of 1 because its
 * ships need it (each hull sets its own `envMapIntensity` from its profile, which multiplies with
 * the scene's). Turning the scene down to suit the pad would darken every craft.
 *
 * It has to be turned down for the pad because several of its materials carry a WHITE base colour
 * over a base-colour texture — `c_sd_Meatcleaver_on` (the `Object_13` / `Object_17` panels) and
 * `interloper_rings`. Light them at full environment and that painted albedo shows through and
 * fights the glow, so the panels drift toward their texture's own orange instead of taking the
 * craft's colour. The materials authored `#000000` are immune, which is why only some parts drift.
 *
 * 0.15 mirrors what the pad was authored under in /pad-lab.
 */
export const PAD_ENV_INTENSITY = 0.15;

export interface PadMaterialDefaults {
  color?: string;
  emissive?: string;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
}

/**
 * Per-material look, applied once on load.
 *
 * `emissive` / `emissiveIntensity` are deliberately absent for the glow materials: the render loop
 * owns those, and a value here would be overwritten on the first frame.
 */
export const PAD_MATERIAL_DEFAULTS: Record<string, PadMaterialDefaults> = {
  // Unlit structure — the concrete-and-metal segments the glow sits between.
  c_sd_meatcleaver: { metalness: 0.5, roughness: 0.4 },
  Object01Mtl: { metalness: 0.5, roughness: 0.5 },
  xenxen_metal_trim_01a_prop: { metalness: 0.5, roughness: 0.5 },

  // Lit surfaces. Colour and PBR only — their emissive comes from the glow. The black base colours
  // are what keep these reading as pure light rather than as painted plastic between pulses.
  interloper_rings: { color: '#ffffff', metalness: 0, roughness: 1 },
  c_sd_Meatcleaver_on: { color: '#ffffff', metalness: 0, roughness: 1 },
  xenint_copper00b_prop: { color: '#000000', metalness: 0, roughness: 1 },
  modelsprops_xeninterloperhologramsd_platform_shield: {
    color: '#000000',
    metalness: 0.5,
    roughness: 1,
  },
};

export interface PreparedPad {
  /** The light-emitting materials, with their weights. */
  glowMaterials: { material: THREE.MeshStandardMaterial; weight: number }[];
  /** Live `uGlowMapHue` uniforms from the glow materials that carry an emissive texture. */
  mapHueUniforms: { value: number }[];
  /** Meshes grouped by material name — what the spin targets. */
  partsByMaterial: Map<string, THREE.Mesh[]>;
  /** Every standard material on the pad, deduped by name, in traverse order. */
  materials: { name: string; material: THREE.MeshStandardMaterial }[];
  /** Every mesh, in traverse order — the lab's per-part controls address these. */
  meshes: { index: number; name: string; materialName: string; mesh: THREE.Mesh }[];
}

/**
 * Let the glow colour own the hue on a material that has an emissive TEXTURE.
 *
 * three's stock chunk is `totalEmissiveRadiance *= emissiveColor.rgb`, which multiplies the map's
 * painted colour in — so a red `emissive` over an orange map stays orange, and the pad can never
 * settle on one colour. Two of this model's panels (`Object_13` / `Object_17`, both
 * `c_sd_Meatcleaver_on`) ship exactly that orange map. Swapping in the map's LUMINANCE keeps its
 * pattern and hands the hue to `material.emissive`.
 *
 * Mixed by a uniform rather than switched by a define, so it can be dialled live without forcing a
 * shader recompile.
 */
function patchEmissiveMapAsMask(
  material: THREE.MeshStandardMaterial,
  initialHue: number,
): { value: number } | null {
  if (!material.emissiveMap) return null;
  const uniform = { value: initialHue };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowMapHue = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uGlowMapHue;\nvoid main() {')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #ifdef USE_EMISSIVEMAP
          vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
          float emissiveLuma = dot( emissiveColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          totalEmissiveRadiance *= mix( vec3( emissiveLuma ), emissiveColor.rgb, uGlowMapHue );
        #endif
        `,
      );
  };
  material.needsUpdate = true;
  return uniform;
}

/**
 * Walk a freshly loaded pad, apply its authored material look, and collect everything the render
 * loop needs to drive it.
 *
 * @param initialMapHue seeds the emissive-map uniforms; the caller keeps driving them per frame.
 */
export function preparePad(root: THREE.Object3D, initialMapHue: number): PreparedPad {
  const glowMaterials: PreparedPad['glowMaterials'] = [];
  const mapHueUniforms: { value: number }[] = [];
  const partsByMaterial = new Map<string, THREE.Mesh[]>();
  const materials: PreparedPad['materials'] = [];
  const meshes: PreparedPad['meshes'] = [];
  const seenMaterials = new Set<string>();

  let meshIndex = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const firstMaterial = meshMaterials[0];
    const materialName = firstMaterial?.name || 'unnamed';

    meshes.push({ index: meshIndex, name: object.name || `mesh ${meshIndex}`, materialName, mesh: object });
    meshIndex += 1;

    const group = partsByMaterial.get(materialName);
    if (group) group.push(object);
    else partsByMaterial.set(materialName, [object]);

    meshMaterials.forEach((material) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return;
      const name = material.name || 'unnamed';
      // Deduped by NAME, not identity: the same material can arrive as separate instances per mesh,
      // and editing "the copper trim" should light every copper part at once.
      if (seenMaterials.has(name)) return;
      seenMaterials.add(name);
      materials.push({ name, material });

      // Every pad material, not just the lit ones — the structural segments would otherwise be lit
      // by a different amount of environment than the parts sitting between them.
      material.envMapIntensity = PAD_ENV_INTENSITY;

      const defaults = PAD_MATERIAL_DEFAULTS[name];
      if (defaults) {
        if (defaults.color !== undefined) material.color.set(defaults.color);
        if (defaults.emissive !== undefined) material.emissive.set(defaults.emissive);
        if (defaults.emissiveIntensity !== undefined) {
          material.emissiveIntensity = defaults.emissiveIntensity;
        }
        if (defaults.metalness !== undefined) material.metalness = defaults.metalness;
        if (defaults.roughness !== undefined) material.roughness = defaults.roughness;
      }

      const weight = PAD_GLOW_MATERIALS[name];
      if (weight === undefined) return;
      glowMaterials.push({ material, weight });
      const uniform = patchEmissiveMapAsMask(material, initialMapHue);
      if (uniform) mapHueUniforms.push(uniform);
    });
  });

  return { glowMaterials, mapHueUniforms, partsByMaterial, materials, meshes };
}
