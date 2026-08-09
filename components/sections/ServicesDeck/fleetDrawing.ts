import * as THREE from 'three';
import { getDeviceTier } from '@/lib/deviceTier';
import type { FleetDrawings } from './deckDrawings';

// The fleet, drawn out of dust — and one of them built.
//
// Four craft. Each arrives as a flat plan-view drawing, TURNS out of that plane into three
// dimensions, and holds there on the turntable. A stop change MORPHS one into the next — one grain
// travelling from its place in one craft to its place in the next, so the shape transforms rather
// than dissolving and re-forming. Only the last one then BUILDS: a wireframe drawn between the
// grains, and a hull skinned over it.
//
// ── ⚠ A DRAWING IS THE CRAFT WITH ITS DEPTH REMOVED ─────────────────────────────────────────────
// Every craft is baked as a 3D cloud in one shared frame, and its flat form is that cloud minus its
// DORSAL component — one dot product in the vertex shader, which is why no 2D positions are stored.
// The turn is then a plain lerp between the two in MODEL space. Not a cross-fade, not a view-space
// trick, and it cannot scramble: correspondence is by construction.
//
// ⚠ ALL FOUR TURN, not only the hero — and that is what makes the other three read as OBJECTS rather
// than as decals. They have real depth to rotate into, they take the pinhole's size grading, and the
// turntable spins them exactly as it spins the hull. They are not models: nothing skins them and no
// GLB ships for them. The whole distinction is `turn` (every craft) versus `build` (the hero's alone).
//
// Because the flatten is LINEAR it commutes with the morph — crossing two craft and then flattening
// is the same as crossing two flattened craft. The crossing is run flat regardless, because a drawing
// is what one craft becomes on its way to being another.
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

/** Windows over the BUILD, which only the hero ever runs. */
const WIRE_IN_WINDOW: [number, number] = [0.0, 0.42];
const WIRE_OUT_WINDOW: [number, number] = [0.55, 0.9];
const SKIN_WINDOW: [number, number] = [0.45, 0.95];

export interface DrawingPhases {
  /** 0 = the flat drawing, 1 = the craft in three dimensions. Drives the rig's pose too. */
  turn: number;
  /** How much of the wireframe has drawn itself in — monotonic. Hero only. */
  wire: number;
  /** …and how visible it is, which the skin takes back down. Kept apart; see the wire shader. */
  wireFade: number;
  /** How solid the hull is — the hook drives the ship's presence with this. Hero only. */
  skin: number;
}

const window01 = (range: [number, number], value: number) =>
  THREE.MathUtils.clamp((value - range[0]) / (range[1] - range[0]), 0, 1);

/**
 * The beat, as a pure function of its two numbers.
 *
 * ⚠ TURN and BUILD are separate because they apply to different sets of craft. Every stop turns —
 * that is what makes four drawings read as four objects — but only the hero has a wireframe to draw
 * or a hull to skin. Folding them into one number would either give the other three a build they
 * cannot run, or deny them the turn.
 *
 * One definition, read by both the field (which sets uniforms from it) and the deck hook (which
 * slerps the rig's pose and drives the hull's presence from it) — so the pose and the dust can never
 * disagree about where the beat is.
 */
export function drawingPhases(turn: number, build: number): DrawingPhases {
  return {
    turn: THREE.MathUtils.smoothstep(turn, 0, 1),
    wire: window01(WIRE_IN_WINDOW, build),
    wireFade: 1 - window01(WIRE_OUT_WINDOW, build),
    skin: THREE.MathUtils.smoothstep(build, SKIN_WINDOW[0], SKIN_WINDOW[1]),
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
  /** 0 = flat drawing, 1 = three dimensions. Every stop runs this. */
  turn: number;
  /** The hero's wireframe-and-hull build. Stays 0 at every other stop. */
  build: number;
  /** Seconds, for the shimmer only. */
  elapsed: number;
}

// ── Shaders ──────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ No backticks anywhere below. A backtick inside the template literal these live in closes the
// string; it has bitten this codebase four times and every one of them was in a comment.

const GRAIN_VERTEX_SHADER = /* glsl */ `
  // This grain's place on each of the four craft, in three dimensions and in one shared frame.
  attribute vec3 aShapeA;
  attribute vec3 aShapeB;
  attribute vec3 aShapeC;
  attribute vec3 aShapeD;
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
  // 0 = the flat drawing, 1 = the craft in three dimensions. EVERY stop turns; only the hero then
  // goes on to a wireframe and a hull.
  uniform float uTurn;
  uniform float uPresence;
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
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
  /**
   * How much hotter a grain burns while it is CROSSING between two craft.
   *
   * Without it a morph is a slide: the same dust in a different arrangement. Peaking mid-flight makes
   * a crossing read as the energy it is meant to be, and it costs one sine that is already computed.
   */
  const float MORPH_HEAT = 0.45;
  /**
   * The scan: a band of brighter, hotter grains travelling nose to tail, forever.
   *
   * ⚠ This is what stops a HELD craft from being a still image. The loader's field has a rule about
   * it — a form that is holding must still be moving — and the shimmer alone is per-grain noise, not
   * something the eye can follow. A sweep down the hull reads as the craft being SCANNED, which is
   * the same idea the whole section is built on, running on a loop while nothing else happens.
   */
  const float SCAN_RATE = 0.11;
  const float SCAN_TIGHTNESS = 7.0;
  const float SCAN_GAIN = 0.9;
  const float SCAN_HEAT = 0.35;
  const float ORIGIN_RADIUS = ${ORIGIN_RADIUS.toFixed(2)};

  float hash(float x) {
    return fract(sin(x) * 43758.5453123);
  }

  void main() {
    // ── 1 · which craft this grain belongs to, and how far across it is ──
    vec3 leaving =
      aShapeA * uShapeFrom.x + aShapeB * uShapeFrom.y +
      aShapeC * uShapeFrom.z + aShapeD * uShapeFrom.w;
    vec3 entering =
      aShapeA * uShapeTo.x + aShapeB * uShapeTo.y +
      aShapeC * uShapeTo.z + aShapeD * uShapeTo.w;

    float morphStart = hash(aSeed * 17.31) * MORPH_STAGGER;
    float morphTravel = clamp((uShapeMorph - morphStart) / (1.0 - MORPH_STAGGER), 0.0, 1.0);
    float morph = smoothstep(0.0, 1.0, morphTravel);
    vec3 craft = mix(leaving, entering, morph);

    // ── 2 · the drawing ──
    // ⚠ The flat form is this craft with its DORSAL component removed — one dot product, and the
    // reason no 2D positions are baked. Because the flatten is LINEAR it commutes with the morph
    // above: crossing two craft and then flattening is the same as crossing two flattened craft, so
    // a stop change reads identically whether it happens flat or turned.
    vec3 flattened = craft - dot(craft, uDorsal) * uDorsal;

    // A slab of depth so the FLAT form still reads as an object rather than a decal, plus a bow
    // through the same axis while crossing, so grains in transit separate from both craft instead of
    // sliding between them. Both fade out as the real depth arrives.
    float slab = (hash(aSeed * 45.13) - 0.5) * DRAWING_SLAB;
    slab += sin(morph * 3.14159265) * MORPH_ARC * (hash(aSeed * 7.77) - 0.5) * 2.0;
    flattened += uDorsal * slab;

    // ── 3 · the turn ──
    // Giving the drawing its depth back IS the craft. Every stop does this — which is what makes the
    // three that never become models still read as objects: they turn, they take the pinhole's size
    // grading, and the turntable spins them.
    vec3 target = mix(flattened, craft, uTurn);

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

    // Grains in transit between two craft burn hotter than either.
    float transit = sin(morph * 3.14159265);
    vHeat = clamp(vHeat + transit * MORPH_HEAT, 0.0, 1.0);

    // The scan, in the craft's own frame so it tracks the hull however the turntable has turned it.
    // Deck units put the craft at roughly ±0.5 along the nose, so this maps it to 0..1.
    float alongNose = clamp(dot(craft, uNose) + 0.5, 0.0, 1.0);
    float sweep = fract(uTime * SCAN_RATE);
    float band = (alongNose - sweep) * SCAN_TIGHTNESS;
    float scan = exp(-band * band);
    vHeat = clamp(vHeat + scan * SCAN_HEAT, 0.0, 1.0);

    // A grain that has not set off yet is invisible, so nothing sits parked in the dark.
    vAlpha = uPresence * smoothstep(0.0, 0.12, gatherTravel) * mix(0.35, 1.0, vHeat) *
      (1.0 + scan * SCAN_GAIN + transit * 0.35);

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
  /** The segment's OTHER endpoint, and which of the two this vertex is (0 = anchor, 1 = free). */
  attribute vec3 aOther;
  attribute float aEnd;
  /** Where this line sits along the craft, nose (0) to tail (1), with a little jitter. */
  attribute float aOrder;

  uniform float uReveal;
  uniform float uFade;
  uniform float uTurn;
  uniform float uOpacity;
  uniform vec3  uDorsal;

  varying float vAlpha;

  /** How much of the reveal is spent working down the craft rather than drawing any one line. */
  const float ORDER_SPREAD = 0.84;
  /** …and the share one line spends being drawn. */
  const float LINE_DRAW = 0.16;

  void main() {
    // ── The line DRAWS ITSELF ──
    // Its anchor end is fixed and its free end travels out to meet its real position, so a segment
    // grows from nothing rather than fading in whole. The anchor is the end nearer the NOSE and the
    // order runs nose to tail, so the wireframe reads as a plotter working down the craft — which is
    // the difference between a machine drawing a ship and a ship simply appearing.
    float stroke = clamp((uReveal - aOrder * ORDER_SPREAD) / LINE_DRAW, 0.0, 1.0);
    vec3 drawn = aEnd < 0.5 ? position : mix(aOther, position, stroke);

    // The same flatten the grains get, done the other way round: a line's endpoints were never
    // sampled into a drawing, but removing their DORSAL component is exactly what the bake did to
    // produce one. So the wireframe unfolds out of the plane in step with the dust.
    vec3 flattened = drawn - dot(drawn, uDorsal) * uDorsal;
    vec4 view = modelViewMatrix * vec4(mix(flattened, drawn, uTurn), 1.0);
    gl_Position = projectionMatrix * view;

    // ⚠ Opacity is its OWN uniform, not the draw progress. Fading the wireframe out by winding the
    // reveal back would make every line RETRACT into its anchor as the hull closed over it — the
    // drawing being un-drawn, which is the opposite of what skinning means.
    //
    // (And no backticks in here, ever. This file's header says so and this comment is where it bit
    // for the fifth time in this codebase.)
    vAlpha = uOpacity * uFade * smoothstep(0.0, 0.05, stroke);
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
  // One vec3 per craft. Four of them plus a seed is five attributes against a guaranteed sixteen —
  // and a shape that was never baked stays at zero, where its selector weight is always zero too, so
  // a bake of three craft costs nothing here.
  const shapes = [0, 1, 2, 3].map(() => new Float32Array(grainCount * 3));
  const seeds = new Float32Array(grainCount);
  const random = createRandom(0x1b873593);

  for (let grain = 0; grain < grainCount; grain += 1) {
    const point = grain % pointCount;
    for (let shape = 0; shape < shapeCount && shape < 4; shape += 1) {
      const from = (shape * pointCount + point) * 3;
      shapes[shape][grain * 3] = drawings.shapes[from];
      shapes[shape][grain * 3 + 1] = drawings.shapes[from + 1];
      shapes[shape][grain * 3 + 2] = drawings.shapes[from + 2];
    }
    seeds[grain] = random();
  }

  const grainGeometry = new THREE.BufferGeometry();
  const shapeAttributes = shapes.map((values) => new THREE.BufferAttribute(values, 3));
  // `position` is required by three even though the shader never reads it; binding the hero's cloud
  // costs nothing (three uploads one buffer and binds it twice).
  grainGeometry.setAttribute('position', shapeAttributes[drawings.heroIndex]);
  grainGeometry.setAttribute('aShapeA', shapeAttributes[0]);
  grainGeometry.setAttribute('aShapeB', shapeAttributes[1]);
  grainGeometry.setAttribute('aShapeC', shapeAttributes[2]);
  grainGeometry.setAttribute('aShapeD', shapeAttributes[3]);
  grainGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const planeNose = new THREE.Vector3(...drawings.planNose);
  const planeDorsal = new THREE.Vector3(...drawings.planDorsal);

  const grainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uShapeFrom: { value: new THREE.Vector4(1, 0, 0, 0) },
      uShapeTo: { value: new THREE.Vector4(1, 0, 0, 0) },
      uShapeMorph: { value: 0 },
      uGather: { value: 0 },
      uTurn: { value: 0 },
      uPresence: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: GRAIN_SIZE },
      uScale: { value: 500 },
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
  //
  // Each segment is re-laid so its NOSE-most endpoint comes first — that end anchors while the other
  // draws out to meet it — and ordered nose to tail so the whole frame is drawn down the craft.
  const segmentCount = drawings.segmentCount;
  const wirePositions = new Float32Array(segmentCount * 6);
  const wireOther = new Float32Array(segmentCount * 6);
  const wireEnd = new Float32Array(segmentCount * 2);
  const wireOrder = new Float32Array(segmentCount * 2);

  const alongNose = new Float32Array(segmentCount);
  let nearestNose = Infinity;
  let furthestNose = -Infinity;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const at = segment * 6;
    const midpoint =
      ((drawings.heroSegments[at] + drawings.heroSegments[at + 3]) / 2) * planeNose.x +
      ((drawings.heroSegments[at + 1] + drawings.heroSegments[at + 4]) / 2) * planeNose.y +
      ((drawings.heroSegments[at + 2] + drawings.heroSegments[at + 5]) / 2) * planeNose.z;
    alongNose[segment] = midpoint;
    if (midpoint < nearestNose) nearestNose = midpoint;
    if (midpoint > furthestNose) furthestNose = midpoint;
  }

  const noseSpan = furthestNose - nearestNose || 1;
  const orderRandom = createRandom(0x85ebca6b);
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const at = segment * 6;
    const first = [drawings.heroSegments[at], drawings.heroSegments[at + 1], drawings.heroSegments[at + 2]];
    const second = [drawings.heroSegments[at + 3], drawings.heroSegments[at + 4], drawings.heroSegments[at + 5]];
    const firstAlong = first[0] * planeNose.x + first[1] * planeNose.y + first[2] * planeNose.z;
    const secondAlong = second[0] * planeNose.x + second[1] * planeNose.y + second[2] * planeNose.z;
    // The anchor is the nose-most end, so every stroke is drawn in the same direction of travel.
    const [anchor, free] = firstAlong >= secondAlong ? [first, second] : [second, first];

    for (let axis = 0; axis < 3; axis += 1) {
      wirePositions[at + axis] = anchor[axis];
      wirePositions[at + 3 + axis] = free[axis];
      wireOther[at + axis] = free[axis];
      wireOther[at + 3 + axis] = anchor[axis];
    }
    wireEnd[segment * 2] = 0;
    wireEnd[segment * 2 + 1] = 1;

    // 0 at the nose, 1 at the tail. The jitter stops the sweep reading as a hard ruled line moving
    // down the hull — a few lines always run ahead of and behind the front.
    const order = (furthestNose - alongNose[segment]) / noseSpan;
    const jittered = Math.min(1, Math.max(0, order + (orderRandom() - 0.5) * 0.12));
    wireOrder[segment * 2] = jittered;
    wireOrder[segment * 2 + 1] = jittered;
  }

  const wireGeometry = new THREE.BufferGeometry();
  wireGeometry.setAttribute('position', new THREE.BufferAttribute(wirePositions, 3));
  wireGeometry.setAttribute('aOther', new THREE.BufferAttribute(wireOther, 3));
  wireGeometry.setAttribute('aEnd', new THREE.BufferAttribute(wireEnd, 1));
  wireGeometry.setAttribute('aOrder', new THREE.BufferAttribute(wireOrder, 1));

  const wireMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uReveal: { value: 0 },
      uFade: { value: 1 },
      uTurn: { value: 0 },
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
      const phases = drawingPhases(state.turn, state.build);
      setSelector(selectorFrom, state.shapeFrom);
      setSelector(selectorTo, state.shapeTo);
      grainMaterial.uniforms.uShapeMorph.value = state.shapeMorph;
      grainMaterial.uniforms.uGather.value = state.gather;
      grainMaterial.uniforms.uTurn.value = phases.turn;
      grainMaterial.uniforms.uTime.value = state.elapsed;
      // The dust withdraws as the hull takes over — inverted from the skin rather than given its own
      // window, so the drawing cannot outlive the thing it described.
      const presence = state.gather * (1 - phases.skin);
      grainMaterial.uniforms.uPresence.value = presence;

      wireMaterial.uniforms.uReveal.value = phases.wire;
      wireMaterial.uniforms.uFade.value = phases.wireFade;
      wireMaterial.uniforms.uTurn.value = phases.turn;

      // Nothing to draw at either end of the beat. Two objects skipped is two draw calls, and it also
      // means the composer never blends a fully transparent additive pass over the hull.
      grains.visible = presence > 0.001;
      wire.visible = phases.wire > 0.001 && phases.wireFade > 0.001;
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
