import * as THREE from 'three';

/**
 * The geode opening — a real vertex morph plus a two-treatment surface, injected into standard PBR.
 *
 * ── Why this is a sibling of `meteorMorph` and not a reuse of it ─────────────────────────────────
 * `enableMeteorMorph` does exactly the right thing for the field's rocks, and it CANNOT be used here.
 * Its swell term is
 *
 *     transformed += normalize( transformed ) * sin( uMorph * PI ) * uSwell;
 *
 * which is safe only because, as its own comment says, "the carve clamps every vertex to MIN_RADIUS,
 * so none sits at the origin". A geode is a prism: its cap centre and its collapsed hole tubes sit AT
 * the origin. normalize(vec3(0)) is NaN, and setting uSwell to 0 does not save you, because 0 * NaN is
 * still NaN — those vertices would fly to infinity and drag their triangles with them. So the geode
 * gets its own injection, with no swell, and `meteorMorph.ts` is left untouched for the shipped Works
 * section.
 *
 * ── What it adds that the field's morph doesn't need ─────────────────────────────────────────────
 * 1. A PER-VERTEX growth delay, so the mark opens outward from wherever the base rock sits instead of
 *    everywhere at once. The delay field is continuous over the surface (distance from the rock, not
 *    arc length around the outline) — a discontinuity would tear the mesh along the seam.
 * 2. The crust / crystal split, blended by the build-time crust mask. Deep interior and new growth are
 *    both crystal; only the thin shell that genuinely WAS the rock's skin stays crust.
 * 3. The charge bleed — the regions about to open glow through the intact crust first, using that same
 *    mask. Frames 2-3 of the storyboard are literally (1 - crust) * charge.
 * 4. Per-region shading: flat where it is crystal, so the facets read; smooth where it is crust.
 *
 * ── UVs are deliberately not morphed ─────────────────────────────────────────────────────────────
 * They come from the body's parametric coordinates, which are identical at both ends of the morph, so
 * there is nothing to interpolate and the texture stays pinned to the surface throughout. Same
 * conclusion `meteorMorph.ts` reaches, for the same underlying reason.
 */

const TARGET_POSITION_ATTRIBUTE = 'aTargetPosition';
const TARGET_NORMAL_ATTRIBUTE = 'aTargetNormal';
const CRUST_ATTRIBUTE = 'aCrust';
const GROWTH_DELAY_ATTRIBUTE = 'aGrowthDelay';
const CRYSTAL_PATCH_ATTRIBUTE = 'aCrystalPatch';

export interface GeodeMorphUniforms {
  /** 0 = the base rock, 1 = the mark. Everything else hangs off this. */
  uGrow: { value: number };
  /**
   * Energy in everything that is NOT crust — the fresh cut and the new growth. It carries no growth
   * term, so it can be placed anywhere on the curve: early it seeps through a still-closed rock, late
   * it is the finished mark coming alive. `markGeodePhases` puts it late.
   */
  uCharge: { value: number };
  /** How present the crystal is on what the cut exposed. */
  uReveal: { value: number };
  /** Multiplies the crust's own emissive. Rests at 1 — the gold veins never go out. */
  uVeinFlare: { value: number };

  uTime: { value: number };
  /** Idle deformation, so the base rock breathes instead of sitting there. Fades out as it opens. */
  uWobbleAmplitude: { value: number };
  uWobbleFrequency: { value: number };

  uCrystalColor: { value: THREE.Color };
  uCrystalEmissive: { value: number };
  uCrystalRoughness: { value: number };
  uCrystalMetalness: { value: number };
  uChargeColor: { value: THREE.Color };
  uChargeStrength: { value: number };
  /** How hard the crystal shades flat. 1 makes every facet its own plane. */
  uFacetShading: { value: number };
  uEdgeBias: { value: number };
  uCrystalCoverage: { value: number };
}

export interface GeodeMorphDefaults {
  crystalColor: string;
  crystalEmissive: number;
  crystalRoughness: number;
  crystalMetalness: number;
  chargeColor: string;
  chargeStrength: number;
  facetShading: number;
  /**
   * How hard the crystal is pushed onto the mark's EDGES rather than spread over every opened face.
   *
   * 0 = crystal wherever the rock was cut, which covers the flat front as evenly as the rim and reads
   * as a coat of paint. 1 = only the extrusion's side walls. The mark is a prism, so those walls ARE
   * its edges, and their normals are the ones perpendicular to the extrusion axis — which is the whole
   * measurement. Between the two it is a gradient, which is the point: mostly stone, turning to geode
   * as the surface turns away from you.
   */
  edgeBias: number;
  /**
   * What SHARE of the opened surface turns to crystal — while the mark is still FORMING, and once it
   * has SETTLED. Both 0..1.
   *
   * These are a share of plates, not a brightness: the value thresholds the baked patch noise, so
   * lowering it removes whole plates rather than dimming all of them, and whatever survives stays at
   * full strength. That is what keeps a sparse geode looking like bare rock with crystal in it rather
   * than like weak crystal everywhere.
   *
   * The two exist because the beat is the point. A rock becoming a letter is mostly rock — a little
   * crystal showing in the fresh cuts. Only once the silhouette has landed does the crystal take the
   * surface. The phase that crossfades them is `spread` (see markGeodePhases), so the whole thing is
   * still one progress value and the close runs it backwards for free.
   */
  crystalCoverageForming: number;
  crystalCoverageSettled: number;
  wobbleAmplitude: number;
  wobbleFrequency: number;
}

/**
 * Cyan rather than the reference's amethyst.
 *
 * The reference is purple; `--accent` is electric cyan, and the sun, the fleet, the nav meters and the
 * FAQ hologram all sit on it. A purple mark would be the only purple thing on the site. The crust's
 * gold veins stay warm, so the warm/cool split the reference gets from amber-on-amethyst survives —
 * and cyan on basalt is the palette the works field already runs.
 */
/**
 * The shipped look.
 *
 * Crystal is LIT, not a lamp. `crystalEmissive` used to be 1.4 into a bloom pass, which made the
 * opened faces a neon letter rather than amethyst catching a key light — in the reference the crystal
 * is never a light source, it is a glossy dielectric with a little scatter deep in the facets. So the
 * emissive is now only enough to keep the deepest facets off pure black, and the crystal read comes
 * from `crystalRoughness` / `crystalMetalness` against the environment map instead.
 *
 * The same goes for the charge: frames 2-3 are a faint bloom seeping through intact crust, not a
 * lamp switching on inside the rock.
 *
 * ── The colour is the vein amber, not the brand cyan ─────────────────────────────────────────────
 * `#ff7a2a` is not a new value — it is exactly the emissive `createMeteorMaterial` already gives the
 * crust, so the veins, the charge seeping through them and the crystal they open into are all one
 * material becoming visible in three stages. That is a stronger story than the accent colour was:
 * cyan crystal read as a separate thing lighting up INSIDE the rock rather than as the rock's own
 * substance.
 *
 * The cost is that the warm/cool split is gone — crystal and veins now share a hue. If the two start
 * merging, push the crystal further gold (nearer `#ffa23c`) rather than pulling it back toward cyan;
 * the separation wanted is value and saturation, not temperature.
 */
export const DEFAULT_GEODE_MORPH: GeodeMorphDefaults = {
  crystalColor: '#ff7a2a',
  crystalEmissive: 0.1,
  crystalRoughness: 0.24,
  crystalMetalness: 0.1,
  chargeColor: '#ff7a2a',
  chargeStrength: 0.22,
  facetShading: 1,
  edgeBias: 0.7,
  crystalCoverageForming: 0.15,
  crystalCoverageSettled: 0.8,
  wobbleAmplitude: 0.012,
  wobbleFrequency: 0.55,
};

/**
 * Teach a standard material to open like a geode. Returns the uniforms to drive; every ordinary
 * material property (map, emissiveMap, tint, roughness, metalness) keeps working untouched, which is
 * the whole reason this is an injection rather than a hand-written ShaderMaterial.
 */
export function enableGeodeMorph(
  material: THREE.MeshStandardMaterial,
  defaults: GeodeMorphDefaults = DEFAULT_GEODE_MORPH,
): GeodeMorphUniforms {
  const uniforms: GeodeMorphUniforms = {
    uGrow: { value: 0 },
    uCharge: { value: 0 },
    uReveal: { value: 0 },
    uVeinFlare: { value: 1 },
    uTime: { value: 0 },
    uWobbleAmplitude: { value: defaults.wobbleAmplitude },
    uWobbleFrequency: { value: defaults.wobbleFrequency },
    uCrystalColor: { value: new THREE.Color(defaults.crystalColor) },
    uCrystalEmissive: { value: defaults.crystalEmissive },
    uCrystalRoughness: { value: defaults.crystalRoughness },
    uCrystalMetalness: { value: defaults.crystalMetalness },
    uChargeColor: { value: new THREE.Color(defaults.chargeColor) },
    uChargeStrength: { value: defaults.chargeStrength },
    uFacetShading: { value: defaults.facetShading },
    uEdgeBias: { value: defaults.edgeBias },
    uCrystalCoverage: { value: defaults.crystalCoverageForming },
  };

  // Flat shading has to stay OFF at the material level: the crystal wants flat facets but the crust
  // wants a smooth weathered surface, and the only way to have both is to keep vNormal available and
  // mix toward a derivative-derived face normal per fragment.
  material.flatShading = false;
  // Draw the inside too. A mark with a concave silhouette — a V's notch, a C's mouth — opens a gap
  // partway through the morph, and with front faces only you look straight past the body into the
  // background, which reads as a hole punched through it rather than as a rock parting. Rendering the
  // far wall costs a second pass over those fragments and turns the gap into an interior.
  material.side = THREE.DoubleSide;
  // …which only behaves if the body is actually opaque. `createStoneMaterial` turns transparency on
  // so the works field can cross-fade a mark in; nothing here ever fades the geode, and leaving it on
  // puts a fully opaque shell in the TRANSPARENT queue, where three sorts per object rather than per
  // fragment. A double-sided shell in that queue can draw its far wall over its near one.
  material.transparent = false;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec3 ${TARGET_POSITION_ATTRIBUTE};
        attribute vec3 ${TARGET_NORMAL_ATTRIBUTE};
        attribute float ${CRUST_ATTRIBUTE};
        attribute float ${GROWTH_DELAY_ATTRIBUTE};
        attribute float ${CRYSTAL_PATCH_ATTRIBUTE};

        uniform float uGrow;
        uniform float uTime;
        uniform float uWobbleAmplitude;
        uniform float uWobbleFrequency;

        varying float vCrust;
        varying float vLocalGrow;
        varying float vSideness;
        varying float vCrystalPatch;

        // The same product-of-sines family the rocks are carved with, so the idle motion belongs to
        // the same body rather than looking like a bolted-on wobble.
        float geodeWobble( vec3 wobblePosition, float wobbleTime ) {
          return sin( wobblePosition.x * 2.7 + wobbleTime )
               * sin( wobblePosition.y * 3.1 - wobbleTime * 0.8 )
               * sin( wobblePosition.z * 2.3 + wobbleTime * 1.3 );
        }`,
      )
      // Normals first: three declares objectNormal here and every lighting chunk downstream reads it.
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>

        // Each vertex runs its own eased slice of the global progress. A vertex sitting on the rock
        // has no delay and moves immediately; one out at an extremity waits. Every vertex still
        // ARRIVES at uGrow = 1, so the mark is always whole at the end however the delays fall.
        float geodeSpan  = max( 1.0 - ${GROWTH_DELAY_ATTRIBUTE}, 1e-4 );
        float geodeLocal = clamp( ( uGrow - ${GROWTH_DELAY_ATTRIBUTE} ) / geodeSpan, 0.0, 1.0 );
        float geodeEased = 1.0 - pow( 1.0 - geodeLocal, 3.0 );

        vCrust = ${CRUST_ATTRIBUTE};
        vLocalGrow = geodeEased;

        // How much this vertex belongs to an EDGE of the mark. The mark is extruded along Z, so its
        // side walls are exactly the faces whose normal has no Z in it. Taken from the TARGET normal,
        // not the current one, so the crystal knows where it is heading while the rock is still closed.
        vSideness = 1.0 - abs( normalize( ${TARGET_NORMAL_ATTRIBUTE} ).z );
        vCrystalPatch = ${CRYSTAL_PATCH_ATTRIBUTE};

        objectNormal = normalize( mix( objectNormal, ${TARGET_NORMAL_ATTRIBUTE}, geodeEased ) );`,
      )
      // Then the position. transformed is what every later chunk and the projection work from.
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        transformed = mix( transformed, ${TARGET_POSITION_ATTRIBUTE}, geodeEased );

        // Breathing, so the closed rock is never a static prop. Along the normal rather than radially:
        // a prism has vertices at its own origin, and normalize() on those is NaN. Scaled out as the
        // mark forms, because a finished letter should hold still.
        float geodeIdle = geodeWobble( transformed * 3.0, uTime * uWobbleFrequency );
        transformed += objectNormal * geodeIdle * uWobbleAmplitude * ( 1.0 - geodeEased );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uCharge;
        uniform float uReveal;
        uniform float uVeinFlare;
        uniform vec3  uCrystalColor;
        uniform float uCrystalEmissive;
        uniform float uCrystalRoughness;
        uniform float uCrystalMetalness;
        uniform vec3  uChargeColor;
        uniform float uChargeStrength;
        uniform float uFacetShading;
        uniform float uEdgeBias;
        uniform float uCrystalCoverage;

        varying float vCrust;
        varying float vLocalGrow;
        varying float vSideness;
        varying float vCrystalPatch;`,
      )
      // Flat where it is crystal so the facets read as planes; smooth where it is weathered crust.
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `#include <normal_fragment_begin>
        {
          vec3 geodeFaceNormal = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
          // That cross product follows the triangle's WINDING, which reverses on a back face. Now the
          // material is double-sided that matters: the inside of the shell is where the rock was cut,
          // which is exactly where crust is 0 and the facets are drawn. Unflipped, every interior
          // facet lights from behind.
          geodeFaceNormal *= gl_FrontFacing ? 1.0 : -1.0;
          float geodeFacetMix = uFacetShading * ( 1.0 - vCrust ) * uReveal * vLocalGrow;
          normal = normalize( mix( normal, geodeFaceNormal, clamp( geodeFacetMix, 0.0, 1.0 ) ) );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        // Crystal only where the rock was actually opened: the mask says the surface is fresh, reveal
        // says the choreography has reached it, and the local growth says this part has opened yet.
        float geodeCrystal = clamp( ( 1.0 - vCrust ) * uReveal * vLocalGrow, 0.0, 1.0 );
        // Weighted onto the edges. At uEdgeBias 0 this is inert, so the old behaviour is still one
        // slider away.
        geodeCrystal *= mix( 1.0, vSideness, uEdgeBias );
        // …and only on the plates that grew any. The patch is piecewise-constant per cell, so this
        // threshold cuts along cell boundaries and leaves chunky crystal islands in bare rock rather
        // than a dissolve. A narrow band rather than a hard step, so the cut edge is not aliased.
        float geodePatchEdge = 1.0 - clamp( uCrystalCoverage, 0.0, 1.0 );
        geodeCrystal *= smoothstep( geodePatchEdge - 0.04, geodePatchEdge + 0.04, vCrystalPatch );
        // The same mask as the crystal, WITHOUT the growth or reveal terms — so it does not care
        // whether this part has opened yet. That is what lets the phase curve decide the whole
        // meaning: early it is energy seeping through intact crust, late it is the finished interior
        // waking. It is currently authored late; see markGeodePhases.
        float geodeCharge = clamp( ( 1.0 - vCrust ) * uCharge, 0.0, 1.0 );

        // Modulated by the rock's own luminance rather than replaced outright, so the crystal keeps the
        // texture's grain instead of turning into flat paint.
        float geodeGrain = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
        vec3 geodeCrystalAlbedo = uCrystalColor * ( 0.35 + 0.65 * geodeGrain );
        diffuseColor.rgb = mix( diffuseColor.rgb, geodeCrystalAlbedo, geodeCrystal );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, uCrystalRoughness, geodeCrystal );`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `#include <metalnessmap_fragment>
        metalnessFactor = mix( metalnessFactor, uCrystalMetalness, geodeCrystal );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // The crust's gold veins come out of the material's own emissive map — the same one-texture
        // trick createMeteorMaterial uses. This only flares them; it never puts them out.
        totalEmissiveRadiance *= uVeinFlare;
        totalEmissiveRadiance += uCrystalColor * uCrystalEmissive * geodeCrystal;
        totalEmissiveRadiance += uChargeColor * uChargeStrength * geodeCharge;`,
      );
  };

  // The injection is identical for every geode material, so one key is correct — but state it, because
  // a silent program-cache collision is a miserable thing to debug later.
  material.customProgramCacheKey = () => 'mark-geode-morph';
  material.needsUpdate = true;
  return uniforms;
}
