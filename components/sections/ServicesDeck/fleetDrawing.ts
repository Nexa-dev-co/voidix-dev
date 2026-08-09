import * as THREE from 'three';
import { getDeviceTier } from '@/lib/deviceTier';
import type { FleetDrawings } from './deckDrawings';

// The fleet, drawn out of dust — and one of them built.
//
// Four craft, four drawings. Dust gathers into the first, and each stop MORPHS it into the next: one
// grain travelling from its place in one craft to its place in the next, so the shape transforms
// rather than dissolving and re-forming. At the last stop the drawing does something the others never
// do — it turns out of plan view into three dimensions, the wireframe draws itself between the grains,
// and the hull skins over it.
//
// ── ⚠ The hero's drawing is not a picture of it. It IS the hull, flattened ───────────────────────
// A stored drawing point is `(drawX, drawY)` in a plane spanned by DECK_PLAN_RIGHT and DECK_PLAN_NOSE,
// and the bake produced it by projecting the hull's own feature-edge points onto exactly those axes.
// So `drawX·RIGHT + drawY·NOSE` is the same vector as "the 3D point with its DORSAL component
// removed" — and the turn is a plain lerp between the two in MODEL space. Not a cross-fade, not a
// view-space trick, and it cannot scramble: correspondence is by construction.
//
// The other three craft have no third dimension at all. They are drawings and never anything else,
// which is why nothing here needs their geometry — only the hero's model ships.
//
// ── Why the bloom is in the sprite ───────────────────────────────────────────────────────────────
// Same trade the loader's field makes, for the same reason: the deck's UnrealBloomPass ships
// `enabled = false`, and its comment is load-bearing — a disabled pass costs nothing, a strength-0
// one costs the whole blur pyramid. Additive grains with a hot core and a wide soft halo sum along a
// line the way a blur pass would, at a few more pixels per grain.

/**
 * Grains, by what the machine can afford.
 *
 * Well under the loader's field (18k–60k) because this is not the same job: the loader spreads a
 * fullscreen stream over the whole viewport, where this is one object occupying part of the frame.
 */
const GRAIN_COUNT_BY_TIER = {
  potato: 7000,
  low: 11000,
  mid: 18000,
  high: 26000,
} as const;

/**
 * How far out a grain begins, in deck units (the craft's largest dimension is 1).
 *
 * Comfortably off-frame at the deck's shot, so grains arrive from outside rather than appearing.
 */
const ORIGIN_RADIUS = 3.6;

/** Sprite size in deck units, the pixel floor, and how much wider the sprite is than the grain. */
const GRAIN_SIZE = 0.021;
const GRAIN_SIZE_MIN_PIXELS = 1.0;
const BLOOM_SPREAD = 1.7;

/** The wireframe's weight. It is a support act — the dust carries the drawing. */
const WIRE_OPACITY = 0.45;

// ── The materialise ──────────────────────────────────────────────────────────────────────────────
//
// Windows over the hero's own 0..1. They overlap on purpose: the wireframe starts drawing while the
// craft is still turning and the hull starts skinning before the lines have finished, so it reads as
// one continuous act rather than three cues.

const TURN_WINDOW: [number, number] = [0.0, 0.46];
const WIRE_IN_WINDOW: [number, number] = [0.14, 0.52];
const WIRE_OUT_WINDOW: [number, number] = [0.66, 0.94];
const SKIN_WINDOW: [number, number] = [0.56, 0.95];

export interface MaterialisePhases {
  /** 0 = the flat drawing, 1 = the real three-dimensional craft. Drives the pose too. */
  solid: number;
  /** How much of the wireframe has drawn itself in. */
  wire: number;
  /** How solid the hull is — the hook drives the ship's presence with this. */
  skin: number;
}

const window01 = (range: [number, number], value: number) =>
  THREE.MathUtils.clamp((value - range[0]) / (range[1] - range[0]), 0, 1);

/**
 * The hero's build, as a pure function of one number.
 *
 * One definition, read by both the field (which sets uniforms from it) and the deck hook (which
 * slerps the craft's pose and drives the hull's presence from it) — so the pose and the drawing can
 * never disagree about how far through the build they are.
 */
export function materialisePhases(materialise: number): MaterialisePhases {
  return {
    solid: THREE.MathUtils.smoothstep(materialise, TURN_WINDOW[0], TURN_WINDOW[1]),
    wire: window01(WIRE_IN_WINDOW, materialise) * (1 - window01(WIRE_OUT_WINDOW, materialise)),
    skin: THREE.MathUtils.smoothstep(materialise, SKIN_WINDOW[0], SKIN_WINDOW[1]),
  };
}

/** Everything the field needs to know about where the beat is. */
export interface DrawingState {
  /** 0 = grains out in the dark, 1 = settled on the drawing. */
  gather: number;
  /** Which craft is being left, and which entered — indices into the bake. */
  shapeFrom: number;
  shapeTo: number;
  /** How far the crossing between those two has run. */
  shapeMorph: number;
  /** The hero's build. 0 at every other stop. */
  materialise: number;
  /** Seconds, for the shimmer only. */
  elapsed: number;
}

// ── Shaders ──────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ No backticks anywhere below. A backtick inside the template literal these live in closes the
// string; it has bitten this codebase four times and every one of them was in a comment.

const GRAIN_VERTEX_SHADER = /* glsl */ `
  // This grain's place in each of the four drawings, packed two to a vec4:
  //   aShapeAB = shape0.xy · shape1.xy      aShapeCD = shape2.xy · shape3.xy
  attribute vec4 aShapeAB;
  attribute vec4 aShapeCD;
  // …and its place on the HERO's hull. Unused at every other stop, where uMaterialise is 0.
  attribute vec3 aSolid;
  attribute float aSeed;

  // ⚠ TWO ONE-HOT SELECTORS AND A SCALAR, not one blended weight vector. A single set of weights makes
  // every grain cross at the same instant, and the midpoint of that is tens of thousands of grains at
  // the average of two unrelated silhouettes — a formless cloud, every time, for the middle of every
  // crossing. Kept apart, each grain crosses on its OWN clock and what you see is one craft coming
  // apart while the next assembles out of it. (The loader's field learned this the same way.)
  uniform vec4  uShapeFrom;
  uniform vec4  uShapeTo;
  uniform float uShapeMorph;

  uniform float uGather;
  uniform float uMaterialise;
  uniform float uPresence;
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  uniform vec3  uRight;
  uniform vec3  uNose;
  uniform vec3  uDorsal;

  varying float vAlpha;
  varying float vHeat;

  const float TAU = 6.2831853;

  /** Fraction of a crossing spent staggering the grains rather than moving them. */
  const float MORPH_STAGGER = 0.55;
  /** How far a grain bows through the DORSAL axis mid-crossing, so a morph has volume. */
  const float MORPH_ARC = 0.20;
  /** Fraction of the gather spent staggering, and how far a grain bows on its way in. */
  const float GATHER_STAGGER = 0.55;
  const float GATHER_ARC = 0.30;
  /**
   * How much depth a DRAWING keeps, in deck units.
   *
   * ⚠ Not zero, and this is the loader's hardest-won lesson repeated. A drawing on an exact plane has
   * every grain at one depth, so every grain is the same size and the same brightness, and it reads as
   * a decal stuck on the glass. A slab gives the pinhole something to grade and the tilt something to
   * parallax. Faded out as the hero materialises, which has real depth of its own.
   */
  const float DRAWING_SLAB = 0.10;
  /** How far a settled grain circles its target — a landed drawing must still be alive. */
  const float SHIMMER_RADIUS = 0.006;
  const float SHIMMER_RATE = 0.9;
  const float ORIGIN_RADIUS = ${ORIGIN_RADIUS.toFixed(2)};

  float hash(float x) {
    return fract(sin(x) * 43758.5453123);
  }

  void main() {
    // ── 1 · which craft this grain belongs to, and how far across it is ──
    vec2 leaving =
      aShapeAB.xy * uShapeFrom.x + aShapeAB.zw * uShapeFrom.y +
      aShapeCD.xy * uShapeFrom.z + aShapeCD.zw * uShapeFrom.w;
    vec2 entering =
      aShapeAB.xy * uShapeTo.x + aShapeAB.zw * uShapeTo.y +
      aShapeCD.xy * uShapeTo.z + aShapeCD.zw * uShapeTo.w;

    float morphStart = hash(aSeed * 17.31) * MORPH_STAGGER;
    float morphTravel = clamp((uShapeMorph - morphStart) / (1.0 - MORPH_STAGGER), 0.0, 1.0);
    float morph = smoothstep(0.0, 1.0, morphTravel);
    vec2 drawing = mix(leaving, entering, morph);

    // ── 2 · the drawing's own depth ──
    // A slab so the flat form reads as an object, plus a bow through the same axis while crossing, so
    // grains in transit separate from both drawings instead of sliding between them.
    float slab = (hash(aSeed * 45.13) - 0.5) * DRAWING_SLAB;
    slab += sin(morph * 3.14159265) * MORPH_ARC * (hash(aSeed * 7.77) - 0.5) * 2.0;
    vec3 drawingPosition = uRight * drawing.x + uNose * drawing.y + uDorsal * slab * (1.0 - uMaterialise);

    // ── 3 · the turn ──
    // ⚠ A plain lerp in MODEL space, because drawX·RIGHT + drawY·NOSE is literally the hull's own
    // point with its dorsal component removed. Giving the drawing its depth back IS the model.
    vec3 target = mix(drawingPosition, aSolid, uMaterialise);

    // ── 4 · the arrival out of the dark ──
    // A uniform direction on the sphere per grain, so they come from every side rather than sweeping
    // in as one front. Derived from the seed rather than stored — three floats a grain, saved.
    float originTheta = hash(aSeed * 3.71) * TAU;
    float originPhi = acos(2.0 * hash(aSeed * 8.17) - 1.0);
    vec3 origin = vec3(
      sin(originPhi) * cos(originTheta),
      cos(originPhi),
      sin(originPhi) * sin(originTheta)
    ) * ORIGIN_RADIUS * (0.7 + hash(aSeed * 11.13) * 0.6);

    float gatherStart = hash(aSeed * 23.77) * GATHER_STAGGER;
    float gatherTravel = clamp((uGather - gatherStart) / (1.0 - GATHER_STAGGER), 0.0, 1.0);
    float gathered = smoothstep(0.0, 1.0, gatherTravel);

    vec3 position = mix(origin, target, gathered);
    position += normalize(target + vec3(0.0001)) * sin(gathered * 3.14159265) * GATHER_ARC *
      (hash(aSeed * 31.19) - 0.5);

    // ── 5 · the shimmer, faded in with the landing ──
    float driftAngle = hash(aSeed * 21.71) * TAU + uTime * SHIMMER_RATE * (0.6 + hash(aSeed * 5.37));
    position += vec3(cos(driftAngle), sin(driftAngle), cos(driftAngle * 1.7)) * SHIMMER_RADIUS * gathered;

    vec4 view = modelViewMatrix * vec4(position, 1.0);
    // The bake is centre-subtracted, so this object's own origin IS the craft's centre.
    vec4 centreView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * view;

    // Heat is DEPTH — nearer grains hotter — which is what makes the slab read as an object and what
    // carries the turn as the real depth comes back.
    //
    // ⚠ view.z is NEGATIVE in front of the camera, so a nearer grain has the LARGER z. Subtracting the
    // other way grades the drawing backwards: the far face hot and the near face cold, which reads as
    // a hole rather than a hull.
    const float HEAT_DEPTH_SCALE = 1.6;
    vHeat = clamp(0.5 + (view.z - centreView.z) * HEAT_DEPTH_SCALE, 0.0, 1.0);

    // A grain that has not set off yet is invisible, so nothing sits parked in the dark.
    vAlpha = uPresence * smoothstep(0.0, 0.12, gatherTravel) * mix(0.35, 1.0, vHeat);

    gl_PointSize = max(
      ${GRAIN_SIZE_MIN_PIXELS.toFixed(1)},
      uSize * ${BLOOM_SPREAD.toFixed(2)} * uScale / max(0.001, -view.z)
    );
  }
`;

const GRAIN_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform vec3 uColorCool;
  uniform vec3 uColorHot;

  varying float vAlpha;
  varying float vHeat;

  /** How far the core reaches as a fraction of the sprite, and how hard each falls off. */
  const float CORE_RADIUS = 0.42;
  const float CORE_FALLOFF = 2.0;
  const float HALO_FALLOFF = 2.6;
  const float HALO_STRENGTH = 0.55;
  /** How far the core burns toward white — the part that reads as light, not a coloured dot. */
  const float WHITE_CORE = 0.55;

  void main() {
    if (vAlpha <= 0.0) discard;
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    if (radius > 1.0) discard;

    float core = pow(max(0.0, 1.0 - radius / CORE_RADIUS), CORE_FALLOFF);
    float halo = pow(max(0.0, 1.0 - radius), HALO_FALLOFF);
    float glow = core + halo * HALO_STRENGTH;

    vec3 color = mix(uColorCool, uColorHot, vHeat);
    vec3 lit = mix(color, vec3(1.0), core * WHITE_CORE);

    float intensity = glow * vAlpha;
    gl_FragColor = vec4(lit * intensity, min(1.0, intensity));
  }
`;

const WIRE_VERTEX_SHADER = /* glsl */ `
  attribute float aSeed;

  uniform float uReveal;
  uniform float uMaterialise;
  uniform float uOpacity;
  uniform vec3  uDorsal;

  varying float vAlpha;

  /** How much of the reveal is spent staggering lines rather than fading any one of them. */
  const float REVEAL_STAGGER = 0.82;
  const float REVEAL_FADE = 0.18;

  void main() {
    // The same flatten the grains get, done the other way round: a line's endpoints were never
    // sampled into a drawing, but removing their DORSAL component is exactly what the bake did to
    // produce one. So the wireframe unfolds out of the plane in step with the dust.
    vec3 flattened = position - dot(position, uDorsal) * uDorsal;
    vec4 view = modelViewMatrix * vec4(mix(flattened, position, uMaterialise), 1.0);
    gl_Position = projectionMatrix * view;

    // Both endpoints of a segment carry the SAME seed, so a line is never half drawn.
    vAlpha = uOpacity * smoothstep(0.0, REVEAL_FADE, uReveal - aSeed * REVEAL_STAGGER);
  }
`;

const WIRE_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.0) discard;
    gl_FragColor = vec4(uColor * vAlpha, vAlpha);
  }
`;

/**
 * A fixed-seed generator, so the grain layout is identical on every load.
 *
 * Not a nicety: the drawing is the section's signature image, and a layout reseeded from
 * Math.random() would make its densest and sparsest passages move between reloads.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 0x1000000) / 0x1000000;
  };
}

export interface FleetDrawing {
  /** Parent this to the craft's rig. It carries its own deck-unit scale and base-on-ground lift. */
  readonly object: THREE.Group;
  /** Re-tint the grains and the lines for the craft on the pad. */
  setPalette(hot: THREE.ColorRepresentation, cool: THREE.ColorRepresentation): void;
  apply(state: DrawingState): void;
  /** Height of the drawing buffer, for perspective-correct sprite sizes. */
  setViewportHeight(height: number): void;
  dispose(): void;
}

/**
 * @param unitScale What one deck unit is worth in world units — `TARGET_SIZE`, the same normalisation
 *   `prepareVessel` gives the hull. Passed rather than baked so there is one copy of it, in the file
 *   that owns the stage.
 */
export function createFleetDrawing(drawings: FleetDrawings, unitScale: number): FleetDrawing {
  const object = new THREE.Group();
  object.scale.setScalar(unitScale);
  // Lift the craft's base onto y = 0, exactly as prepareVessel lifts the hull.
  object.position.y = unitScale * drawings.heroLiftY;
  object.frustumCulled = false;

  const grainCount = GRAIN_COUNT_BY_TIER[getDeviceTier()];
  const { pointCount, shapeCount } = drawings;

  // ── Per-grain attributes ──
  // Each grain adopts one sampled point, and there are more grains than points — so several grains
  // share a point and the shimmer spreads them around it. That is what turns a plotted outline into
  // dust, and it is why the point budget does not have to rise with the grain budget.
  const shapeAB = new Float32Array(grainCount * 4);
  const shapeCD = new Float32Array(grainCount * 4);
  const solid = new Float32Array(grainCount * 3);
  const seeds = new Float32Array(grainCount);
  const random = createRandom(0x1b873593);

  for (let grain = 0; grain < grainCount; grain += 1) {
    const point = grain % pointCount;
    const packed = [shapeAB, shapeAB, shapeCD, shapeCD];
    for (let shape = 0; shape < 4; shape += 1) {
      // Shapes beyond what was baked stay at zero, and their selector weight is always zero too, so a
      // bake of three drawings costs nothing here.
      const target = packed[shape];
      const offset = grain * 4 + (shape % 2) * 2;
      if (shape < shapeCount) {
        target[offset] = drawings.drawings[shape * pointCount * 2 + point * 2];
        target[offset + 1] = drawings.drawings[shape * pointCount * 2 + point * 2 + 1];
      }
    }
    solid[grain * 3] = drawings.heroSolid[point * 3];
    solid[grain * 3 + 1] = drawings.heroSolid[point * 3 + 1];
    solid[grain * 3 + 2] = drawings.heroSolid[point * 3 + 2];
    seeds[grain] = random();
  }

  const grainGeometry = new THREE.BufferGeometry();
  // `position` is required by three even though the shader never reads it; sharing the solid buffer
  // costs nothing (three uploads one buffer and binds it twice).
  const solidAttribute = new THREE.BufferAttribute(solid, 3);
  grainGeometry.setAttribute('position', solidAttribute);
  grainGeometry.setAttribute('aSolid', solidAttribute);
  grainGeometry.setAttribute('aShapeAB', new THREE.BufferAttribute(shapeAB, 4));
  grainGeometry.setAttribute('aShapeCD', new THREE.BufferAttribute(shapeCD, 4));
  grainGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const planeRight = new THREE.Vector3(...drawings.planRight);
  const planeNose = new THREE.Vector3(...drawings.planNose);
  const planeDorsal = new THREE.Vector3(...drawings.planDorsal);

  const grainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uShapeFrom: { value: new THREE.Vector4(1, 0, 0, 0) },
      uShapeTo: { value: new THREE.Vector4(1, 0, 0, 0) },
      uShapeMorph: { value: 0 },
      uGather: { value: 0 },
      uMaterialise: { value: 0 },
      uPresence: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: GRAIN_SIZE },
      uScale: { value: 500 },
      uRight: { value: planeRight },
      uNose: { value: planeNose },
      uDorsal: { value: planeDorsal },
      uColorCool: { value: new THREE.Color('#3d1503') },
      uColorHot: { value: new THREE.Color('#ffeeb8') },
    },
    vertexShader: GRAIN_VERTEX_SHADER,
    fragmentShader: GRAIN_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const grains = new THREE.Points(grainGeometry, grainMaterial);
  grains.frustumCulled = false;
  // After the hull, so the additive glow lands on top of it rather than under.
  grains.renderOrder = 2;

  // ── The hero's wireframe ──
  const wireSeeds = new Float32Array(drawings.segmentCount * 2);
  const seedRandom = createRandom(0x85ebca6b);
  for (let segment = 0; segment < drawings.segmentCount; segment += 1) {
    const seed = seedRandom();
    wireSeeds[segment * 2] = seed;
    wireSeeds[segment * 2 + 1] = seed;
  }

  const wireGeometry = new THREE.BufferGeometry();
  wireGeometry.setAttribute('position', new THREE.BufferAttribute(drawings.heroSegments, 3));
  wireGeometry.setAttribute('aSeed', new THREE.BufferAttribute(wireSeeds, 1));

  const wireMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uReveal: { value: 0 },
      uMaterialise: { value: 0 },
      uOpacity: { value: WIRE_OPACITY },
      uDorsal: { value: planeDorsal },
      uColor: { value: new THREE.Color('#36e6ff') },
    },
    vertexShader: WIRE_VERTEX_SHADER,
    fragmentShader: WIRE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const wire = new THREE.LineSegments(wireGeometry, wireMaterial);
  wire.frustumCulled = false;
  wire.renderOrder = 1;

  object.add(wire, grains);

  const selectorFrom = grainMaterial.uniforms.uShapeFrom.value as THREE.Vector4;
  const selectorTo = grainMaterial.uniforms.uShapeTo.value as THREE.Vector4;
  const setSelector = (selector: THREE.Vector4, index: number) => {
    selector.set(index === 0 ? 1 : 0, index === 1 ? 1 : 0, index === 2 ? 1 : 0, index === 3 ? 1 : 0);
  };

  return {
    object,

    setPalette(hot, cool) {
      (grainMaterial.uniforms.uColorHot.value as THREE.Color).set(hot);
      (grainMaterial.uniforms.uColorCool.value as THREE.Color).set(cool);
      (wireMaterial.uniforms.uColor.value as THREE.Color).set(hot);
    },

    apply(state) {
      const phases = materialisePhases(state.materialise);
      setSelector(selectorFrom, state.shapeFrom);
      setSelector(selectorTo, state.shapeTo);
      grainMaterial.uniforms.uShapeMorph.value = state.shapeMorph;
      grainMaterial.uniforms.uGather.value = state.gather;
      grainMaterial.uniforms.uMaterialise.value = phases.solid;
      grainMaterial.uniforms.uTime.value = state.elapsed;
      // The dust withdraws as the hull takes over — inverted from the skin rather than given its own
      // window, so the drawing cannot outlive the thing it described.
      const presence = state.gather * (1 - phases.skin);
      grainMaterial.uniforms.uPresence.value = presence;

      wireMaterial.uniforms.uReveal.value = phases.wire;
      wireMaterial.uniforms.uMaterialise.value = phases.solid;

      // Nothing to draw at either end of the beat. Two objects skipped is two draw calls, and it also
      // means the composer never blends a fully transparent additive pass over the hull.
      grains.visible = presence > 0.001;
      wire.visible = phases.wire > 0.001;
    },

    setViewportHeight(height) {
      // Three's own convention for perspective-attenuated points: size × (height/2) / -viewZ. The size
      // is in DECK units and this object is scaled by `unitScale`, so scale it to match.
      grainMaterial.uniforms.uScale.value = height * 0.5 * unitScale;
    },

    dispose() {
      grainGeometry.dispose();
      grainMaterial.dispose();
      wireGeometry.dispose();
      wireMaterial.dispose();
    },
  };
}
