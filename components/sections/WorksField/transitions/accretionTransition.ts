import * as THREE from 'three';
import { createMeteorMaterial } from '../meteorBody';
import { lobeAt, type RockField } from '../markRockField';
import { buildAccretionChunks, type AccretionChunks } from './accretionChunks';
import { createCrystalGeometry, placeAccretionCrystals } from './accretionCrystals';
import {
  ACCRETION_MODE,
  enableCrystalGrowth,
  enableStoneGrowth,
  type CrystalGrowthUniforms,
  type StoneGrowthUniforms,
} from './accretionGrowth';
import {
  clampProgress,
  measureGeometryBytes,
  tuningDefaults,
  type MarkTransitionBuildOptions,
  type MarkTransitionFactory,
  type MarkTransitionStrategy,
  type PreparedMark,
  type TransitionTuning,
  type TuningControl,
} from './markTransition';

/**
 * ACCRETION — the mark grown out of a seed, then overgrown with geode.
 *
 * ── The beat, from the reference ─────────────────────────────────────────────────────────────────
 * Dark pitted basalt with hairline veins burning through it, and amber crystal points erupting from its
 * edges and cavities. Crucially the two are SEQUENTIAL, not simultaneous: it is stone all the way up,
 * and only once the mark is whole does the geode grow on the edges.
 *
 *   p=0          p≈0.25         p≈0.5          p≈0.78         p=1
 *   the mark     outer stones   two streams    stone whole    geode grown
 *   + geode      let go,        crossing a     — bare rock    on the edges
 *                crystal        swollen core
 *                already gone
 *
 *   ████████      ▙▖   ▗▟        ·  ▟█▙  ·      ████████       ▲█████▲
 *   ██▲  ▲██  ─▶  ▘▝ ●● ▘▝  ─▶  ▝ ·███· ▘  ─▶   ██    ██  ─▶  ██▲  ▲██
 *   ████████      ▛▘   ▝▜        ·  ▜█▛  ·      ████████       ▲█████▲
 *
 * Crystal leaves FIRST on the way out and arrives LAST on the way in, so the mark is only ever seen
 * bare in the middle of a change. That ordering is what makes the geode read as the finish rather than
 * as decoration.
 *
 * ── Three objects, and only two of five drawn at once ────────────────────────────────────────────
 * One stone mesh and one crystal mesh per mark, plus the persistent core. Only the outgoing and
 * incoming marks are visible, so the draw is: 2 stone + 2 crystal + 1 core. Every mark's animation is
 * a vertex shader reading `uProgress` — the CPU writes three uniforms per frame and nothing else.
 */

// ── The core ──
const CORE_DETAIL = 3;
const CORE_SEED = 271;
const CORE_CARVE = 0.34;
const MIN_CARVE_RADIUS = 0.55;
/** Radius before the rest/peak scales act on it, as a share of the mark. */
const CORE_RADIUS_FRACTION = 0.24;

/** Dark basalt with veins in its bright channel — `createMeteorMaterial`'s whole reason to exist. */
const STONE_TEXTURE_PATH = '/textures/meteor/basalt-magma.png';
/** The reference's geode interior, for the cavities the stone opens into. */
const CAVITY_TEXTURE_PATH = '/textures/geode/geode-druse.png';
const STONE_TEXTURE_REPEAT = 3;

/**
 * The stone's own look — dark and matte, per the reference.
 *
 * The reference letter is very nearly black, and every bit of light in the image comes from the crystal
 * or from hairline seams. `STONE_TINT` multiplies the basalt albedo, so this is the main lever on how
 * dark the body sits; the vein emissive is deliberately low because it is multiplied by the texture's
 * own bright channel AND then bloomed.
 */
const STONE_TINT = '#55555a';
const STONE_ROUGHNESS = 0.97;
const STONE_VEIN_EMISSIVE = 0.3;

/** The crystal — a glossy dielectric with light escaping from behind it, never a bulb. */
const CRYSTAL_COLOR = '#ff8a1f';
const CRYSTAL_EMISSIVE_COLOR = '#ff7a2a';
const CRYSTAL_EMISSIVE = 0.45;
const CRYSTAL_ROUGHNESS = 0.32;
const CRYSTAL_METALNESS = 0;

const ACCRETION_CONTROLS: TuningControl[] = [
  // ── The stone, cut and roughened. Rebuilds. ──
  { key: 'rimSpacing', label: 'Rim stone size', min: 0.04, max: 0.4, step: 0.005, value: 0.13, rebuilds: true },
  { key: 'coreSpacing', label: 'Core stone size', min: 0.1, max: 1.2, step: 0.01, value: 0.42, rebuilds: true },
  { key: 'spacingFalloff', label: 'Rim depth', min: 0.05, max: 1, step: 0.01, value: 0.3, rebuilds: true },
  { key: 'capEdgeFraction', label: 'Tessellation', min: 0.008, max: 0.05, step: 0.001, value: 0.022, rebuilds: true },
  { key: 'capSubdivisions', label: 'Subdivisions', min: 0, max: 3, step: 1, value: 2, decimals: 0, rebuilds: true },
  { key: 'capAmplitude', label: 'Face pitting', min: 0, max: 0.12, step: 0.002, value: 0.03, rebuilds: true },
  { key: 'capFrequency', label: 'Pit scale', min: 0.4, max: 6, step: 0.05, value: 2.4, rebuilds: true },
  { key: 'inPlaneAmplitude', label: 'Edge chipping', min: 0, max: 0.12, step: 0.002, value: 0.028, rebuilds: true },
  { key: 'silhouetteProtection', label: 'Keep outline', min: 0, max: 1, step: 0.02, value: 0.5, rebuilds: true },
  { key: 'chunkInflate', label: 'Seam close', min: 0, max: 0.01, step: 0.0005, value: 0.002, rebuilds: true },
  // ── The geode. Rebuilds. ──
  { key: 'crystalCoverage', label: 'Geode coverage', min: 0, max: 1, step: 0.02, value: 0.42, rebuilds: true },
  { key: 'crystalSiteSpacing', label: 'Geode spacing', min: 0.03, max: 0.4, step: 0.005, value: 0.075, rebuilds: true },
  { key: 'crystalPatchScale', label: 'Geode patch size', min: 0.5, max: 8, step: 0.1, value: 2.2, rebuilds: true },
  { key: 'crystalCluster', label: 'Points per site', min: 1, max: 10, step: 1, value: 4, decimals: 0, rebuilds: true },
  { key: 'crystalLength', label: 'Point length', min: 0.04, max: 0.5, step: 0.005, value: 0.17, rebuilds: true },
  { key: 'crystalSpread', label: 'Fan', min: 0, max: 1.1, step: 0.02, value: 0.5, rebuilds: true },
  { key: 'crystalEmbed', label: 'Sink in', min: 0, max: 0.6, step: 0.02, value: 0.28, rebuilds: true },
  // ── How hot it burns. Live, and deliberately low: it all lands on top of a bloom pass. ──
  { key: 'stoneVeinGlow', label: 'Vein glow', min: 0, max: 2, step: 0.02, value: 0.3, rebuilds: false },
  { key: 'cavityCoverage', label: 'Open cavities', min: 0, max: 1, step: 0.02, value: 0.34, rebuilds: false },
  { key: 'cavityWidth', label: 'Cavity reach', min: 0.02, max: 0.5, step: 0.01, value: 0.16, rebuilds: false },
  { key: 'cavityGlow', label: 'Cavity glow', min: 0, max: 4, step: 0.05, value: 0.8, rebuilds: false },
  { key: 'crystalGlow', label: 'Crystal glow', min: 0, max: 3, step: 0.02, value: 0.45, rebuilds: false },
  { key: 'crystalRootGlow', label: 'Crystal root glow', min: 0, max: 4, step: 0.05, value: 1.2, rebuilds: false },
  { key: 'crystalTipGlow', label: 'Crystal tip glow', min: 0, max: 2, step: 0.02, value: 0.3, rebuilds: false },
  // Roughness, not gloss — LOW is shiny. Raised from 0.16, because a near-mirror crystal against the
  // room probe was throwing specular highlights straight through the bloom threshold.
  { key: 'crystalRoughness', label: 'Crystal roughness', min: 0, max: 1, step: 0.02, value: 0.32, rebuilds: false },
  { key: 'flashStrength', label: 'Lock spark', min: 0, max: 3, step: 0.05, value: 0.4, rebuilds: false },
  // ── The choreography. Live. ──
  // Retimed so the stone actually has room: it used to grow across 0.38 → 0.80, which is 42% of the
  // timeline for the whole assembly. Retraction now clears earlier and the geode starts later, giving
  // the growth just over half of the run.
  { key: 'shrinkWindow', label: 'Retract by', min: 0.15, max: 0.95, step: 0.01, value: 0.42, rebuilds: false },
  { key: 'growDelay', label: 'Stone grows from', min: 0.05, max: 0.8, step: 0.01, value: 0.26, rebuilds: false },
  { key: 'crystalStart', label: 'Geode grows from', min: 0.5, max: 0.98, step: 0.01, value: 0.84, rebuilds: false },
  { key: 'crystalRetractBy', label: 'Geode gone by', min: 0.05, max: 0.5, step: 0.01, value: 0.18, rebuilds: false },
  { key: 'growthSteps', label: 'Growth waves', min: 1, max: 12, step: 1, value: 5, decimals: 0, rebuilds: false },
  { key: 'growStagger', label: 'Grow procession', min: 0, max: 0.95, step: 0.05, value: 0.72, rebuilds: false },
  { key: 'shrinkStagger', label: 'Retract procession', min: 0, max: 0.95, step: 0.05, value: 0.62, rebuilds: false },
  { key: 'crystalStagger', label: 'Geode procession', min: 0, max: 0.95, step: 0.05, value: 0.6, rebuilds: false },
  { key: 'orderJitter', label: 'Front jitter', min: 0, max: 0.5, step: 0.01, value: 0.08, rebuilds: false },
  { key: 'overshoot', label: 'Slam', min: 0, max: 3, step: 0.05, value: 1.15, rebuilds: false },
  { key: 'scaleLead', label: 'Grow: scale done by', min: 0.2, max: 1, step: 0.02, value: 0.55, rebuilds: false },
  // 1 means it shrinks across the whole retraction rather than holding full size and blinking out.
  { key: 'shrinkScaleLead', label: 'Shrink: over', min: 0.2, max: 1, step: 0.02, value: 1, rebuilds: false },
  { key: 'rotateLead', label: 'Align done by', min: 0.2, max: 1, step: 0.02, value: 0.72, rebuilds: false },
  // Self-rotation, off: a stone spinning on its own axis reads as debris thrown rather than as material
  // placed, and it wastes the one thing a fragment has that a pebble did not — a correct orientation.
  { key: 'spinTurns', label: 'Tumble (self-spin)', min: 0, max: 3, step: 0.05, value: 0, rebuilds: false },
  // The OTHER rotation, and a different thing: the whole stone swung about the centre as it travels, so
  // the two streams curve past each other. Lowered rather than removed — this is what makes the middle
  // read as two flows instead of one radial burst.
  { key: 'spiralTurns', label: 'Stream curl (orbit)', min: 0, max: 1.5, step: 0.02, value: 0.14, rebuilds: false },
  { key: 'tremorCycles', label: 'Judder', min: 0, max: 8, step: 0.5, value: 2.5, rebuilds: false },
  { key: 'tremorAmplitude', label: 'Judder depth', min: 0, max: 0.15, step: 0.002, value: 0.035, rebuilds: false },
  // ── The core. Off by default — see the note on `setTransition`. ──
  { key: 'coreVisible', label: 'First formation (core)', min: 0, max: 1, step: 1, value: 0, decimals: 0, kind: 'toggle', rebuilds: false },
  { key: 'baseRestScale', label: 'Core at rest', min: 0, max: 1.5, step: 0.02, value: 0.3, rebuilds: false },
  { key: 'basePeakScale', label: 'Core at peak', min: 0, max: 2.5, step: 0.02, value: 1.15, rebuilds: false },
];

/** A rock carved by the same lobes as everything else in the field, so the core is visibly a sibling. */
function createCoreGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, CORE_DETAIL);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const direction = new THREE.Vector3();

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    direction.fromBufferAttribute(position, vertex).normalize();
    const displaced =
      1 +
      CORE_CARVE *
        (0.3 * lobeAt(direction, 1.6, CORE_SEED) +
          0.15 * lobeAt(direction, 3.4, CORE_SEED * 2.1) +
          0.06 * lobeAt(direction, 7.1, CORE_SEED * 3.7));
    const radius = Math.max(displaced, MIN_CARVE_RADIUS);
    position.setXYZ(vertex, direction.x * radius, direction.y * radius, direction.z * radius);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function cloneRepeated(texture: THREE.Texture, repeat: number): THREE.Texture {
  const clone = texture.clone();
  clone.needsUpdate = true;
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeat, repeat);
  return clone;
}

function loadTexture(path: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      path,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        resolve(texture);
      },
      undefined,
      () => resolve(null),
    );
  });
}

/** Everything belonging to one mark. */
interface MarkLayer {
  stone: THREE.Mesh;
  stoneUniforms: StoneGrowthUniforms;
  crystal: THREE.InstancedMesh | null;
  crystalUniforms: CrystalGrowthUniforms | null;
  chunks: AccretionChunks;
  bytes: number;
}

class AccretionTransition implements MarkTransitionStrategy {
  readonly id = 'accretion' as const;
  readonly object = new THREE.Group();
  metrics: { buildMilliseconds: number; bufferBytes: number; perMarkBytes: number };

  private readonly marks: PreparedMark[];
  private readonly options: MarkTransitionBuildOptions;
  private tuning: TransitionTuning;

  private readonly stoneTexture: THREE.Texture | null;
  private readonly cavityTexture: THREE.Texture | null;
  private readonly crystalGeometry: THREE.BufferGeometry;
  private readonly core: THREE.Mesh;
  private readonly coreRadius: number;

  private layers: MarkLayer[] = [];

  constructor(
    marks: PreparedMark[],
    options: MarkTransitionBuildOptions,
    tuning: TransitionTuning,
    stoneTexture: THREE.Texture | null,
    cavityTexture: THREE.Texture | null,
  ) {
    this.marks = marks;
    this.options = options;
    this.tuning = tuning;
    this.stoneTexture = stoneTexture;
    this.cavityTexture = cavityTexture;
    this.crystalGeometry = createCrystalGeometry();

    this.coreRadius = options.targetSize * CORE_RADIUS_FRACTION;
    const coreMaterial = createMeteorMaterial(
      stoneTexture ? cloneRepeated(stoneTexture, 2) : new THREE.Texture(),
      false,
    );
    if (!stoneTexture) {
      coreMaterial.map = null;
      coreMaterial.emissiveMap = null;
    }
    coreMaterial.emissiveIntensity = STONE_VEIN_EMISSIVE;
    this.core = new THREE.Mesh(createCoreGeometry(), coreMaterial);
    // It swells past its resting size at the midpoint, so a sphere fitted to rest would cull it exactly
    // when it matters.
    this.core.frustumCulled = false;
    this.object.add(this.core);

    this.metrics = { buildMilliseconds: 0, bufferBytes: 0, perMarkBytes: 0 };
    this.rebuild();
  }

  /** The core, as the field every stone is seeded from. Rebuilt per call so a knob can move it. */
  private coreField(): RockField {
    return {
      centre: new THREE.Vector3(0, 0, 0),
      radius: this.coreRadius,
      stretch: new THREE.Vector3(1, 1, 1),
      seed: CORE_SEED,
      carveAmplitude: CORE_CARVE,
    };
  }

  private rebuild(): void {
    const startedAt = performance.now();
    this.disposeLayers();

    const baseRock = this.coreField();

    this.layers = this.marks.map((mark, markIndex) => {
      const chunks = buildAccretionChunks(mark.shapes, mark.flipY, {
        targetSize: this.options.targetSize,
        depth: this.options.depth,
        capEdgeFraction: this.tuning.capEdgeFraction,
        capSubdivisions: this.tuning.capSubdivisions,
        rimSpacing: this.tuning.rimSpacing,
        coreSpacing: this.tuning.coreSpacing,
        spacingFalloff: this.tuning.spacingFalloff,
        chunkInflate: this.tuning.chunkInflate,
        capAmplitude: this.tuning.capAmplitude,
        capFrequency: this.tuning.capFrequency,
        inPlaneAmplitude: this.tuning.inPlaneAmplitude,
        silhouetteProtection: this.tuning.silhouetteProtection,
        baseRock,
        // Per mark, so four marks are not cut identically — and stable, so re-tuning something
        // unrelated never reshuffles the subject being judged.
        seed: 149 + markIndex * 101,
      });

      const stoneMaterial = createMeteorMaterial(
        this.stoneTexture
          ? cloneRepeated(this.stoneTexture, STONE_TEXTURE_REPEAT)
          : new THREE.Texture(),
        false,
      );
      // The throwaway above stands in when the surface failed to load. BOTH channels have to be cleared:
      // an empty Texture has no image, and a material sampling one renders black, which looks exactly
      // like a lighting bug.
      if (!this.stoneTexture) {
        stoneMaterial.map = null;
        stoneMaterial.emissiveMap = null;
      }
      stoneMaterial.color.set(STONE_TINT);
      stoneMaterial.roughness = STONE_ROUGHNESS;
      stoneMaterial.emissiveIntensity = STONE_VEIN_EMISSIVE;
      const stoneUniforms = enableStoneGrowth(stoneMaterial, this.cavityTexture);

      const stone = new THREE.Mesh(chunks.geometry, stoneMaterial);
      // Stones leave their resting bounds entirely during the transition.
      stone.frustumCulled = false;
      this.object.add(stone);

      const { crystal, crystalUniforms, crystalBytes } = this.buildCrystalLayer(chunks, markIndex);

      return {
        stone,
        stoneUniforms,
        crystal,
        crystalUniforms,
        chunks,
        bytes: measureGeometryBytes(chunks.geometry) + crystalBytes,
      };
    });

    const buildMilliseconds = performance.now() - startedAt;
    const bufferBytes =
      this.layers.reduce((total, layer) => total + layer.bytes, 0) +
      measureGeometryBytes(this.crystalGeometry) +
      measureGeometryBytes(this.core.geometry);
    this.metrics = {
      buildMilliseconds,
      bufferBytes,
      perMarkBytes: Math.round(bufferBytes / Math.max(1, this.layers.length)),
    };
  }

  private buildCrystalLayer(
    chunks: AccretionChunks,
    markIndex: number,
  ): {
    crystal: THREE.InstancedMesh | null;
    crystalUniforms: CrystalGrowthUniforms | null;
    crystalBytes: number;
  } {
    const { matrices, order } = placeAccretionCrystals({
      rimPoints: chunks.rimPoints,
      rimNormals: chunks.rimNormals,
      depth: this.options.depth,
      targetSize: this.options.targetSize,
      siteSpacing: this.tuning.crystalSiteSpacing,
      coverage: this.tuning.crystalCoverage,
      patchScale: this.tuning.crystalPatchScale,
      clusterSize: this.tuning.crystalCluster,
      length: this.tuning.crystalLength,
      lengthJitter: 0.45,
      spread: this.tuning.crystalSpread,
      embed: this.tuning.crystalEmbed,
      seed: 401 + markIndex * 137,
    });

    if (matrices.length === 0) {
      return { crystal: null, crystalUniforms: null, crystalBytes: 0 };
    }

    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(CRYSTAL_COLOR),
      emissive: new THREE.Color(CRYSTAL_EMISSIVE_COLOR),
      emissiveIntensity: CRYSTAL_EMISSIVE,
      roughness: CRYSTAL_ROUGHNESS,
      metalness: CRYSTAL_METALNESS,
      // Every facet its own plane. A crystal that shades smoothly is a lump, and the facets are the
      // entire reason this reads as mineral.
      flatShading: true,
    });
    const crystalUniforms = enableCrystalGrowth(crystalMaterial);

    const crystal = new THREE.InstancedMesh(
      this.crystalGeometry,
      crystalMaterial,
      matrices.length,
    );
    crystal.frustumCulled = false;
    matrices.forEach((matrix, index) => crystal.setMatrixAt(index, matrix));
    crystal.instanceMatrix.needsUpdate = true;

    // Per-instance growth data. Two floats rather than a CPU-written scale, so the whole crystal layer
    // animates without the main thread touching a buffer.
    const orderArray = new Float32Array(order);
    const jitterArray = new Float32Array(order.length);
    for (let index = 0; index < order.length; index += 1) {
      jitterArray[index] = ((Math.sin(index * 12.9898 + markIndex) * 43758.5453) % 1 + 1) % 1;
    }
    // Instanced attributes live on the geometry, and this geometry is SHARED across marks — so each
    // mark needs its own copy of it rather than fighting over one set of attributes.
    const perMarkGeometry = this.crystalGeometry.clone();
    perMarkGeometry.setAttribute('aOrder', new THREE.InstancedBufferAttribute(orderArray, 1));
    perMarkGeometry.setAttribute(
      'aCrystalJitter',
      new THREE.InstancedBufferAttribute(jitterArray, 1),
    );
    crystal.geometry = perMarkGeometry;

    this.object.add(crystal);
    return {
      crystal,
      crystalUniforms,
      crystalBytes: matrices.length * 17 * 4 + measureGeometryBytes(perMarkGeometry),
    };
  }

  private disposeLayers(): void {
    this.layers.forEach((layer) => {
      this.object.remove(layer.stone);
      layer.chunks.geometry.dispose();
      const stoneMaterial = layer.stone.material as THREE.MeshStandardMaterial;
      stoneMaterial.map?.dispose();
      stoneMaterial.dispose();

      if (!layer.crystal) return;
      this.object.remove(layer.crystal);
      // Cloned per mark, so this one IS ours to dispose — unlike the shared source geometry.
      layer.crystal.geometry.dispose();
      (layer.crystal.material as THREE.MeshStandardMaterial).dispose();
      layer.crystal.dispose();
    });
    this.layers = [];
  }

  /** Push the live choreography numbers onto one mark's uniforms. */
  private applyChoreography(layer: MarkLayer, mode: number): void {
    const stone = layer.stoneUniforms;
    stone.uMode.value = mode;
    stone.uGrowDelay.value = this.tuning.growDelay;
    stone.uGrowStagger.value = this.tuning.growStagger;
    stone.uShrinkWindow.value = this.tuning.shrinkWindow;
    stone.uShrinkStagger.value = this.tuning.shrinkStagger;
    stone.uOrderJitter.value = this.tuning.orderJitter;
    stone.uGrowthSteps.value = this.tuning.growthSteps;
    stone.uOvershoot.value = this.tuning.overshoot;
    stone.uScaleLead.value = this.tuning.scaleLead;
    stone.uShrinkScaleLead.value = this.tuning.shrinkScaleLead;
    stone.uRotateLead.value = this.tuning.rotateLead;
    stone.uSpinTurns.value = this.tuning.spinTurns;
    stone.uSpiralTurns.value = this.tuning.spiralTurns;
    stone.uTremorCycles.value = this.tuning.tremorCycles;
    stone.uTremorAmplitude.value = this.tuning.tremorAmplitude;
    stone.uFlashStrength.value = this.tuning.flashStrength;
    stone.uCavityWidth.value = this.tuning.cavityWidth;
    stone.uCavityCoverage.value = this.tuning.cavityCoverage;
    stone.uCavityGlow.value = this.tuning.cavityGlow;

    // Material properties rather than uniforms, so they are set here rather than injected — but they are
    // just as live, which matters because how hot this burns is the hardest thing to judge from a number.
    const stoneMaterial = layer.stone.material as THREE.MeshStandardMaterial;
    stoneMaterial.emissiveIntensity = this.tuning.stoneVeinGlow;

    const crystal = layer.crystalUniforms;
    if (!crystal || !layer.crystal) return;
    crystal.uMode.value = mode;
    crystal.uCrystalStart.value = this.tuning.crystalStart;
    crystal.uCrystalStagger.value = this.tuning.crystalStagger;
    crystal.uCrystalRetractBy.value = this.tuning.crystalRetractBy;
    crystal.uRootGlow.value = this.tuning.crystalRootGlow;
    crystal.uTipGlow.value = this.tuning.crystalTipGlow;

    const crystalMaterial = layer.crystal.material as THREE.MeshStandardMaterial;
    crystalMaterial.emissiveIntensity = this.tuning.crystalGlow;
    crystalMaterial.roughness = this.tuning.crystalRoughness;
  }

  setTransition(fromIndex: number, toIndex: number, progress: number): void {
    const clamped = clampProgress(progress);
    const count = this.layers.length;
    if (count === 0) return;

    const from = Math.max(0, Math.min(count - 1, fromIndex));
    const to = Math.max(0, Math.min(count - 1, toIndex));
    // Sitting still. Handed both roles, a mark would be told to retract and grow at once and would sink
    // below full size in the middle of a transition that is not happening.
    const isStill = from === to;

    this.layers.forEach((layer, index) => {
      const isFrom = index === from;
      const isTo = index === to;
      const visible = isFrom || isTo;
      layer.stone.visible = visible;
      if (layer.crystal) layer.crystal.visible = visible;
      if (!visible) return;

      const mode = isStill
        ? ACCRETION_MODE.settled
        : isTo
          ? ACCRETION_MODE.incoming
          : ACCRETION_MODE.outgoing;
      this.applyChoreography(layer, mode);
      layer.stoneUniforms.uProgress.value = clamped;
      if (layer.crystalUniforms) layer.crystalUniforms.uProgress.value = clamped;
    });

    // ── The core is a FIRST-FORMATION element ──
    // It belongs to the entry — the moment the section arrives and the first mark is grown out of a
    // rock. On every mark→mark change after that it is off, and the stones simply converge on the middle
    // and shrink away while the next mark's spray out of it. Leaving it on for every change would make
    // the same object interrupt the mark four times, and it would have to survive being looked at with
    // no mark around it to hide behind.
    //
    // Nothing else changes when it is hidden: the stones still seed from where its skin WOULD be, so the
    // spiral still has a convergence point and the streams still cross. What goes away is the object,
    // not the geometry it organises.
    this.core.visible = this.tuning.coreVisible > 0.5;
    if (!this.core.visible) return;

    // Swells at the midpoint and returns. A sine rather than a ramp, so the resting scale is reached
    // exactly at both ends and the beat has no corner in it.
    const swell = isStill ? 0 : Math.sin(Math.PI * clamped);
    const scale = THREE.MathUtils.lerp(
      this.tuning.baseRestScale,
      this.tuning.basePeakScale,
      swell,
    );
    this.core.scale.setScalar(this.coreRadius * scale);
  }

  update(): void {
    // Nothing idles — the rig owns the spin, and motion here would be a second clock.
  }

  applyTuning(tuning: TransitionTuning): void {
    const needsRebuild = ACCRETION_CONTROLS.some(
      (control) => control.rebuilds && tuning[control.key] !== this.tuning[control.key],
    );
    this.tuning = { ...tuning };
    if (needsRebuild) this.rebuild();
  }

  dispose(): void {
    this.disposeLayers();
    this.crystalGeometry.dispose();
    this.core.geometry.dispose();
    const coreMaterial = this.core.material as THREE.MeshStandardMaterial;
    coreMaterial.map?.dispose();
    coreMaterial.dispose();
    this.stoneTexture?.dispose();
    this.cavityTexture?.dispose();
  }
}

export const accretionTransitionFactory: MarkTransitionFactory = {
  id: 'accretion',
  label: 'Accretion',
  identity: 'A seed — a persistent core that grows the mark out of itself, then overgrows it with geode.',
  tuningControls: ACCRETION_CONTROLS,
  create: async (marks, options, tuning) => {
    const [stoneTexture, cavityTexture] = await Promise.all([
      loadTexture(STONE_TEXTURE_PATH),
      loadTexture(CAVITY_TEXTURE_PATH),
    ]);
    return new AccretionTransition(
      marks,
      options,
      { ...tuningDefaults(ACCRETION_CONTROLS), ...tuning },
      stoneTexture,
      cavityTexture,
    );
  },
};
