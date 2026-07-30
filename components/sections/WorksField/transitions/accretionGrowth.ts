import * as THREE from 'three';

/**
 * The growth, as a pure function of one progress value — all of it in the vertex shader.
 *
 * ── Why the three transforms finish at DIFFERENT times ───────────────────────────────────────────
 * A stone scales, rotates and travels. Running those together and linearly is what made the first
 * attempt read as a fade. Offsetting them is the whole difference:
 *
 *   g   0                                                       1
 *       ├───────────────────────────────────────────────────────┤
 * scale ████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░  done at scaleLead  (~0.55)
 *   rot ██████████████████████████████████████░░░░░░░░░░░░░░░░░  done at rotateLead (~0.70)
 *   pos ███████████████████████████████████████████████████████  done at 1.0, with overshoot
 *
 * So a stone comes out of the core ALREADY solid and ALREADY aligned, and the last thing it does is
 * slot into place and rebound. Read in order: material emerges → tumbles → aligns → slams home.
 *
 * ── The streams counter-rotate ───────────────────────────────────────────────────────────────────
 * Travel is not a straight line: the whole stone is swung about the core's axis by an angle that decays
 * to zero as it lands, one way growing and the other way retracting. Two counter-rotating flows crossing
 * at the midpoint is the "mess". It is the same trick `worksTransition.ts` already relies on, where
 * counter-spinning the debris field against the rock makes the two rates ADD into the apparent speed.
 *
 * ── Nothing is stateful ──────────────────────────────────────────────────────────────────────────
 * Every curve below reads `uProgress` and per-vertex constants. No timers, no arrived flags, so it can
 * be scrubbed backwards at any rate and a resize just re-derives it.
 */

/** Mode, as a uniform rather than a branch on the CPU: one mesh per mark, one role each. */
export const ACCRETION_MODE = {
  /** Fully formed and still — what a mark does when it is not part of the transition. */
  settled: 0,
  /** Growing out of the core. */
  incoming: 1,
  /** Retracting into it. */
  outgoing: 2,
} as const;

export interface StoneGrowthUniforms {
  uProgress: { value: number };
  uMode: { value: number };
  /**
   * HOW a stone gets from absent to placed. Four different ideas, not four points on a dial:
   *
   *   0 travel    it flies from the core's skin to its place — the most motion, and the most like a
   *               swarm, which is the read that was rejected.
   *   1 in place  it swells at its final position and snaps. No translation whatsoever.
   *   2 extend    a scale anchored on the stone's INNER face, so material extends outward while the
   *               centroid never moves. Closest to how a mineral actually grows.
   *   3 creep     it emerges from the neighbour that arrived before it, so the mark spreads across
   *               itself like frost instead of being assembled from outside. Travel of one stone's width.
   */
  uArrival: { value: number };
  /** Where the core sits, so the spiral has an axis to swing about. */
  uCoreCentre: { value: THREE.Vector3 };

  /** The stone's window: it starts growing here and every stone has landed by 1. */
  uGrowDelay: { value: number };
  /** 0 = every stone moves together, →1 = a long procession. */
  uGrowStagger: { value: number };
  /** Retraction is finished by here, which is what leaves room for the overlap. */
  uShrinkWindow: { value: number };
  uShrinkStagger: { value: number };
  /** Breaks the perfect shell — nothing in nature grows as one. */
  uOrderJitter: { value: number };
  /**
   * Quantise the growth front into this many discrete waves. 0 or 1 leaves it continuous.
   *
   * A continuous front is one smooth event, and at speed it reads as a single blur however carefully the
   * stagger is authored. Rounding each stone's place in the queue to a wave makes the mark build in
   * layers you can count — a shell lands, then the next — which is what turns the growth into steps
   * rather than a swell.
   */
  uGrowthSteps: { value: number };

  uOvershoot: { value: number };
  /** When scale finishes on the way IN, so a stone arrives already solid and then slots home. */
  uScaleLead: { value: number };
  /**
   * When scale finishes on the way OUT — separate from the lead above, and it has to be.
   *
   * Growth wants scale to land EARLY, so the stone is full size while it slots in. Retraction wants the
   * opposite: at 0.55 the stone stayed full size for most of the withdrawal and then blinked out at the
   * end. At 1 the scale tracks the whole retraction, so the stone visibly shrinks until it is gone.
   */
  uShrinkScaleLead: { value: number };
  uRotateLead: { value: number };
  uSpinTurns: { value: number };
  uSpiralTurns: { value: number };
  uTremorCycles: { value: number };
  uTremorAmplitude: { value: number };

  /** The spark as a stone seats. The field runs a bloom pass, so hundreds of these make it crackle. */
  uFlashColor: { value: THREE.Color };
  uFlashStrength: { value: number };

  /** Exposed geode pockets on the stone — the reference's open cavities. */
  uCavityMap: { value: THREE.Texture | null };
  /** How far in from the outline a cavity can reach. */
  uCavityWidth: { value: number };
  /** Share of stones that carry one. Whole stones, not speckles, which is how the reference reads. */
  uCavityCoverage: { value: number };
  uCavityGlow: { value: number };
}

/** Shared GLSL: the easings, and rotation without a matrix. */
const GROWTH_HELPERS = /* glsl */ `
  const float ACCRETION_TAU = 6.283185307179586;

  float accretionEaseOut( float t ) {
    float inverted = 1.0 - clamp( t, 0.0, 1.0 );
    return 1.0 - inverted * inverted * inverted;
  }

  // Overshoots past 1 and settles back. Exactly 0 at t=0 and 1 at t=1 for any strength.
  float accretionBackOut( float t, float strength ) {
    float shifted = clamp( t, 0.0, 1.0 ) - 1.0;
    return 1.0 + ( strength + 1.0 ) * shifted * shifted * shifted + strength * shifted * shifted;
  }

  // Rodrigues. Cheaper than building a matrix, and it is the same maths.
  vec3 accretionSpin( vec3 point, vec3 axis, float angle ) {
    float cosine = cos( angle );
    float sine = sin( angle );
    return point * cosine + cross( axis, point ) * sine + axis * dot( axis, point ) * ( 1.0 - cosine );
  }

  vec3 accretionSwing( vec3 point, float angle ) {
    float cosine = cos( angle );
    float sine = sin( angle );
    return vec3( point.x * cosine - point.y * sine, point.x * sine + point.y * cosine, point.z );
  }

  // Cheap per-stone hash, so which stones carry a cavity is stable and needs no attribute.
  float accretionHash( vec3 seed ) {
    return fract( sin( dot( seed, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
  }
`;

/**
 * Teach a stone material to grow out of the core.
 *
 * Injected into standard PBR rather than hand-written, so the basalt albedo and the veins burning
 * through the emissive channel keep working untouched — the same reasoning `meteorMorph` gives.
 */
export function enableStoneGrowth(
  material: THREE.MeshStandardMaterial,
  cavityMap: THREE.Texture | null,
): StoneGrowthUniforms {
  const uniforms: StoneGrowthUniforms = {
    uProgress: { value: 1 },
    uMode: { value: ACCRETION_MODE.settled },
    // `extend` by default: it is the only one of the four that is genuinely growth rather than delivery.
    uArrival: { value: 2 },
    uCoreCentre: { value: new THREE.Vector3() },
    uGrowDelay: { value: 0.4 },
    uGrowStagger: { value: 0.68 },
    uShrinkWindow: { value: 0.6 },
    uShrinkStagger: { value: 0.62 },
    uOrderJitter: { value: 0.08 },
    uGrowthSteps: { value: 5 },
    uOvershoot: { value: 1.15 },
    uScaleLead: { value: 0.55 },
    uShrinkScaleLead: { value: 1 },
    uRotateLead: { value: 0.72 },
    // Off. A stone spinning on its own axis while it travels reads as debris being thrown, not as
    // material being placed — and it fights the one thing the stone has that a pebble did not, which is
    // a correct final orientation. Kept as a knob because the retraction can take a little of it.
    uSpinTurns: { value: 0 },
    uSpiralTurns: { value: 0.14 },
    uTremorCycles: { value: 2.5 },
    uTremorAmplitude: { value: 0.035 },
    // ── Cooled right down ──
    // Every glow here lands on top of the rig's bloom pass, which spreads anything over its threshold
    // well past its own silhouette. Stacking generous emissive on generous bloom is what turned the
    // stone into a light source instead of rock catching a key light — the reference's stone is DARK,
    // and only the crystal and the hairline veins carry any light at all.
    uFlashColor: { value: new THREE.Color('#ffb066') },
    uFlashStrength: { value: 0.4 },
    uCavityMap: { value: cavityMap },
    uCavityWidth: { value: 0.16 },
    uCavityCoverage: { value: 0.34 },
    uCavityGlow: { value: 0.8 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec3 aChunkCentroid;
        attribute vec3 aSeedPoint;
        attribute vec3 aParentPoint;
        attribute float aRadius;
        attribute float aStart;
        attribute vec3 aSpinAxis;
        attribute float aSpinTurns;
        attribute float aJitter;
        attribute float aRim;

        uniform float uProgress;
        uniform float uMode;
        uniform float uArrival;
        uniform vec3 uCoreCentre;
        uniform float uGrowDelay;
        uniform float uGrowStagger;
        uniform float uShrinkWindow;
        uniform float uShrinkStagger;
        uniform float uOrderJitter;
        uniform float uGrowthSteps;
        uniform float uOvershoot;
        uniform float uScaleLead;
        uniform float uShrinkScaleLead;
        uniform float uRotateLead;
        uniform float uSpinTurns;
        uniform float uSpiralTurns;
        uniform float uTremorCycles;
        uniform float uTremorAmplitude;
        uniform float uCavityWidth;
        uniform float uCavityCoverage;

        varying float vFlash;
        varying float vCavity;

        ${GROWTH_HELPERS}

        // How settled this stone is: 1 at its resting place, 0 collapsed onto its seed on the core.
        float accretionSettled() {
          if ( uMode < 0.5 ) return 1.0;

          float order = clamp( aStart + ( aJitter - 0.5 ) * uOrderJitter, 0.0, 1.0 );

          // Rounded into waves, so the mark builds in layers you can count. The jitter is applied
          // BEFORE this, so it decides which wave a borderline stone joins — the wave fronts come out
          // ragged like a real growth boundary rather than as perfect concentric shells. Set the jitter
          // to 0 for crisp rings.
          if ( uGrowthSteps >= 2.0 ) {
            float waves = floor( uGrowthSteps );
            order = min( floor( order * waves ), waves - 1.0 ) / ( waves - 1.0 );
          }

          if ( uMode < 1.5 ) {
            // Growing: near the core first, so the front travels outward.
            float span = max( 1.0 - uGrowDelay, 1e-4 );
            float start = uGrowDelay + order * uGrowStagger * span;
            float width = max( ( 1.0 - uGrowStagger ) * span, 1e-4 );
            return clamp( ( uProgress - start ) / width, 0.0, 1.0 );
          }

          // Retracting: far from the core first, so the mark collapses inward.
          float span = max( uShrinkWindow, 1e-4 );
          float start = ( 1.0 - order ) * uShrinkStagger * span;
          float width = max( ( 1.0 - uShrinkStagger ) * span, 1e-4 );
          return 1.0 - clamp( ( uProgress - start ) / width, 0.0, 1.0 );
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>

        float accretionGrowth = accretionSettled();

        // Deliberately staggered — see the header. Scale lands first, then alignment, then position.
        // On the way out the lead is its own number, so the stone shrinks across the whole withdrawal
        // instead of holding full size and then blinking out.
        float accretionLead = uMode > 1.5 ? uShrinkScaleLead : uScaleLead;
        float accretionScale = accretionEaseOut( accretionGrowth / max( accretionLead, 1e-4 ) );
        float accretionAlign = accretionEaseOut( accretionGrowth / max( uRotateLead, 1e-4 ) );
        float accretionTravel = accretionBackOut( accretionGrowth, uOvershoot );

        // Retracting stones tumble harder than growing ones, so the mess reads as coming apart rather
        // than as the assembly played in reverse.
        float accretionTumble = uMode > 1.5 ? 1.6 : 1.0;
        float accretionAngle = aSpinTurns * uSpinTurns * accretionTumble
          * ACCRETION_TAU * ( 1.0 - accretionAlign );

        vec3 accretionLocal = accretionSpin( transformed - aChunkCentroid, aSpinAxis, accretionAngle );

        // Outward through this stone — the direction growth happens along.
        vec3 accretionRun = aChunkCentroid - aSeedPoint;
        float accretionRunLength = length( accretionRun );
        vec3 accretionDir = accretionRunLength > 1e-5
          ? accretionRun / accretionRunLength
          : vec3( 0.0, 0.0, 1.0 );

        // Judder as it seats. Zero at growth 1 by construction, so a landed stone is perfectly still.
        float accretionRing = sin( ACCRETION_TAU * uTremorCycles * accretionGrowth )
          * pow( 1.0 - accretionGrowth, 2.0 );
        vec3 accretionShake = accretionDir * accretionRing * uTremorAmplitude;

        vec3 accretionCentre;

        if ( uArrival > 1.5 && uArrival < 2.5 ) {
          // EXTEND. No translation at all: a uniform scale anchored on a point on the stone's inner
          // face, so its near side stays put and its material extends outward. The centroid does not
          // move, which is what separates growth from delivery.
          vec3 accretionAnchor = aChunkCentroid - accretionDir * aRadius + accretionShake;
          vec3 accretionRestPoint = aChunkCentroid + accretionLocal;
          accretionLocal = ( accretionRestPoint - accretionAnchor ) * accretionTravel;
          accretionCentre = accretionAnchor;
        } else {
          // TRAVEL, IN PLACE and CREEP are one path with three origins. In place uses the stone's own
          // centroid, so the mix collapses and it becomes a pure swell — with the overshoot landing on
          // the SCALE rather than on a journey, which is what gives it a snap instead of a fade.
          vec3 accretionOrigin = uArrival < 0.5
            ? aSeedPoint
            : ( uArrival < 1.5 ? aChunkCentroid : aParentPoint );
          float accretionFill = uArrival < 1.5 && uArrival > 0.5 ? accretionTravel : accretionScale;
          accretionLocal *= accretionFill;
          accretionCentre = mix( accretionOrigin, aChunkCentroid, accretionTravel ) + accretionShake;
        }

        // The whole stone swung about the core's axis, decaying to nothing as it lands. Opposite
        // directions for the two roles, which is what crosses the streams.
        float accretionSpiralSign = uMode > 1.5 ? -1.0 : 1.0;
        float accretionSwingAngle = uSpiralTurns * ACCRETION_TAU
          * ( 1.0 - accretionTravel ) * accretionSpiralSign;

        vec3 accretionPlaced = accretionCentre + accretionLocal;
        transformed = uCoreCentre + accretionSwing( accretionPlaced - uCoreCentre, accretionSwingAngle );

        objectNormal = accretionSwing(
          accretionSpin( objectNormal, aSpinAxis, accretionAngle ),
          accretionSwingAngle
        );
        vNormal = normalize( normalMatrix * objectNormal );

        // A spark as it seats, and nothing at rest.
        float accretionSeat = smoothstep( 0.72, 0.94, accretionGrowth );
        vFlash = accretionSeat * accretionSeat * ( 1.0 - smoothstep( 0.94, 1.0, accretionGrowth ) );

        // Whole stones near the outline open into geode, rather than every stone speckling.
        float accretionOpen = step( accretionHash( aChunkCentroid * 7.0 ), uCavityCoverage );
        vCavity = accretionOpen * ( 1.0 - smoothstep( 0.0, max( uCavityWidth, 1e-4 ), aRim ) );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D uCavityMap;
        uniform float uCavityGlow;
        uniform vec3 uFlashColor;
        uniform float uFlashStrength;
        varying float vFlash;
        varying float vCavity;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        // Where the stone has opened, the surface is druse rather than basalt.
        vec4 accretionCavity = texture2D( uCavityMap, vMapUv );
        diffuseColor.rgb = mix( diffuseColor.rgb, accretionCavity.rgb, vCavity );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // The veins already burn through the material's own emissive map; an open cavity burns harder,
        // and a seating stone throws a spark.
        totalEmissiveRadiance *= 1.0 + vCavity * uCavityGlow;
        totalEmissiveRadiance += uFlashColor * uFlashStrength * vFlash;`,
      );
  };

  material.customProgramCacheKey = () => 'accretion-stone-growth';
  material.needsUpdate = true;
  return uniforms;
}

export interface CrystalGrowthUniforms {
  uProgress: { value: number };
  uMode: { value: number };
  /** Crystal only starts once the stone is whole — the beat the reference is built on. */
  uCrystalStart: { value: number };
  uCrystalStagger: { value: number };
  /** On the way out, crystal goes FIRST: it withdraws into the cracks before the stone lets go. */
  uCrystalRetractBy: { value: number };
  /** Brightest where it meets the stone, deepening toward the tip. Straight from the reference. */
  uRootGlow: { value: number };
  uTipGlow: { value: number };
}

/**
 * Teach a crystal material to grow along its own length.
 *
 * Lengthwise, not uniformly: a crystal extends. Scaling one up from nothing in every direction is what
 * makes it look like it faded in.
 */
export function enableCrystalGrowth(
  material: THREE.MeshStandardMaterial,
): CrystalGrowthUniforms {
  const uniforms: CrystalGrowthUniforms = {
    uProgress: { value: 1 },
    uMode: { value: ACCRETION_MODE.settled },
    uCrystalStart: { value: 0.78 },
    uCrystalStagger: { value: 0.6 },
    uCrystalRetractBy: { value: 0.22 },
    // Cooled: the crystal should read as a glossy dielectric with light escaping from behind it, not as
    // a bulb. The bloom pass supplies the halo, so the emissive only has to keep the deepest facets off
    // black.
    uRootGlow: { value: 1.2 },
    uTipGlow: { value: 0.3 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute float aOrder;
        attribute float aCrystalJitter;

        uniform float uProgress;
        uniform float uMode;
        uniform float uCrystalStart;
        uniform float uCrystalStagger;
        uniform float uCrystalRetractBy;

        varying float vCrystalGrowth;
        varying float vCrystalHeight;

        float accretionCrystalGrowth() {
          if ( uMode < 0.5 ) return 1.0;
          float order = clamp( aOrder + ( aCrystalJitter - 0.5 ) * 0.4, 0.0, 1.0 );

          if ( uMode < 1.5 ) {
            float span = max( 1.0 - uCrystalStart, 1e-4 );
            float start = uCrystalStart + order * uCrystalStagger * span;
            float width = max( ( 1.0 - uCrystalStagger ) * span, 1e-4 );
            return clamp( ( uProgress - start ) / width, 0.0, 1.0 );
          }

          float span = max( uCrystalRetractBy, 1e-4 );
          float start = order * uCrystalStagger * span;
          float width = max( ( 1.0 - uCrystalStagger ) * span, 1e-4 );
          return 1.0 - clamp( ( uProgress - start ) / width, 0.0, 1.0 );
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        float accretionCrystal = accretionCrystalGrowth();
        vCrystalGrowth = accretionCrystal;
        // Read off the UN-animated local position: the geometry is a unit point along +Y, so this is 0
        // at the root and 1 at the tip. Taken from the position attribute rather than from a UV varying
        // because the crystal material carries no map, so three never declares vMapUv and referencing
        // it would fail to compile.
        vCrystalHeight = clamp( position.y, 0.0, 1.0 );

        // The geometry is a unit point along +Y, and the instance matrix supplies its length and girth —
        // so extending Y here lengthens the crystal about its own root. Girth trails, so it reads as
        // pushing out and thickening rather than inflating.
        float accretionLength = accretionCrystal * accretionCrystal * ( 3.0 - 2.0 * accretionCrystal );
        transformed.y *= accretionLength;
        transformed.xz *= mix( 0.22, 1.0, accretionLength );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uRootGlow;
        uniform float uTipGlow;
        varying float vCrystalGrowth;
        varying float vCrystalHeight;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // Brightest where it leaves the stone, deepening toward the point — which is the reference's
        // read exactly: light escaping from inside the cavity, not the crystal being a lamp.
        totalEmissiveRadiance *= mix( uRootGlow, uTipGlow, vCrystalHeight );
        // A crystal that has only just started is not yet lit, so a cluster brightens as it extends.
        totalEmissiveRadiance *= vCrystalGrowth;`,
      );
  };

  material.customProgramCacheKey = () => 'accretion-crystal-growth';
  material.needsUpdate = true;
  return uniforms;
}
