import * as THREE from 'three';
import { buildShardCells, type ShardCells } from './shardsCells';
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
 * SHARDS — the mark rearranges into the next one. Cell i becomes cell i.
 *
 * ── The beat ─────────────────────────────────────────────────────────────────────────────────────
 * There is no core, nothing grows, and the mark is never absent. Every piece of A is accounted for at
 * every instant: it travels, tumbles and rescales until it is standing exactly where the corresponding
 * piece of B belongs.
 *
 *   p=0            p≈0.35          p=0.5            p≈0.65          p=1
 *   mark A whole   pieces in       every piece is   pieces still    mark B whole
 *                  flight, fanned  at its partner's in flight,      — same pieces,
 *                  through depth   place            settling        rearranged
 *
 *   ┌─┬─┬─┐         ╱ ─ ╲            ▫ ▫ ▫          ╲ ─ ╱          ┌───┬─┐
 *   ├─┼─┼─┤   ─▶   ▫  ▫  ▫    ─▶     ▫ ▫ ▫   ─▶     ▫  ▫  ▫  ─▶    ├─┬─┴─┤
 *   └─┴─┴─┘         ╲ ─ ╱            ▫ ▫ ▫          ╱ ─ ╲          └─┴───┘
 *
 * ── The one real problem, and how it is solved ───────────────────────────────────────────────────
 * Cell i of A and cell i of B are DIFFERENT SHAPES with different vertex counts, so no vertex of one
 * can be interpolated into a vertex of the other. Two meshes have to exist.
 *
 * The obvious answer — fade one out while the other fades in — is exactly the mistake `accretion-plan`
 * §1.5 calls out: "the mess was a crossfade. Things shrinking while other things grow is a dissolve."
 * Two overlapping ghosts of the same mark is the cheapest-looking thing on this list.
 *
 * So the handoff is a BATON, per cell. Both meshes follow the same path, and at each cell's own swap
 * moment A's piece stops being drawn and B's piece starts — at the same place, at the same size, at the
 * same tumble angle. Exactly one of the two is ever visible. What changes at that instant is only the
 * piece's SHAPE, and three things hide it:
 *
 *   1 · Every cell swaps at its own staggered time, so it is never one global pop.
 *   2 · The swap is placed where the tumble peaks, so the piece is at its least readable orientation.
 *   3 · The piece is travelling fastest there.
 *
 * ── Nothing is stateful ──────────────────────────────────────────────────────────────────────────
 * Every curve is a pure function of `uProgress` and per-cell constants. No timers, no arrived flags —
 * so it scrubs backwards at any rate and a resize just re-derives it, which is the contract in
 * `markTransition` and the ONE CLOCK rule in CLAUDE.md.
 */

/**
 * The same surface accretion uses, on purpose.
 *
 * The rig exists to compare what the candidates DO, and a candidate that arrives on a different rock
 * would be compared on its texture. Declared here rather than imported because the contract's model is
 * that a strategy owns its own look — this is a deliberate agreement, not a shared dependency.
 */
const STONE_TEXTURE_PATH = '/textures/meteor/black-stone-background-material_1127-22469.jpg';
const STONE_TINT = '#aab2bd';
const STONE_BASE_COLOR = new THREE.Color(STONE_TINT);

/** Mode, as a uniform rather than a CPU branch: one mesh per mark, one role each. */
const SHARDS_MODE = {
  /** Fully formed and still — what a mark does when it is not part of the transition. */
  settled: 0,
  /** Arriving: starts standing in the outgoing mark's places, ends in its own. */
  incoming: 1,
  /** Leaving: starts in its own places, ends standing in the incoming mark's. */
  outgoing: 2,
} as const;

const SHARDS_CONTROLS: TuningControl[] = [
  // ── The cut. Rebuilds. ──
  // Cell count is the headline: few large pieces read as a mark breaking apart, many small ones as a
  // mark flowing. It is also the one number that MUST be identical across marks — see `shardsCells`.
  { key: 'cellCount', label: 'Pieces', min: 8, max: 400, step: 1, value: 120, decimals: 0, rebuilds: true },
  { key: 'capEdgeFraction', label: 'Tessellation', min: 0.008, max: 0.05, step: 0.001, value: 0.02, rebuilds: true },
  { key: 'capSubdivisions', label: 'Subdivisions', min: 0, max: 3, step: 1, value: 1, decimals: 0, rebuilds: true },
  // ── The rearrangement. Live. ──
  // 0 moves every piece at once, which reads as the whole mark lurching. High values make it a wave
  // travelling around the outline, because cell index IS angular order (see `shardsCells`).
  { key: 'stagger', label: 'Procession', min: 0, max: 0.95, step: 0.05, value: 0.55, rebuilds: false },
  // Where each piece hands over. 0.5 is the honest midpoint; pushing it either way makes one mark's
  // pieces do more of the travelling, which biases whether the change reads as leaving or as arriving.
  { key: 'swapPoint', label: 'Handover at', min: 0.1, max: 0.9, step: 0.02, value: 0.5, rebuilds: false },
  // The masking, not decoration — see the header. At 0 the shape swap happens on an unrotated piece and
  // is far more visible, so this is the first knob to raise if the handover ever shows.
  { key: 'tumbleTurns', label: 'Tumble', min: 0, max: 2, step: 0.05, value: 0.35, rebuilds: false },
  // Fans the pieces through the slab's depth at the midpoint so they pass AROUND each other rather than
  // through. Without it the whole rearrangement happens in one plane and reads flat.
  { key: 'arc', label: 'Fan through depth', min: 0, max: 2, step: 0.02, value: 0.55, rebuilds: false },
  { key: 'orderJitter', label: 'Front jitter', min: 0, max: 0.5, step: 0.01, value: 0.12, rebuilds: false },
  // ── The surface. Live. Matched to accretion's so the two are judged on the same rock. ──
  { key: 'envIntensity', label: 'Probe strength', min: 0, max: 1.5, step: 0.05, value: 0.8, rebuilds: false },
  { key: 'stoneAlbedo', label: 'Stone body', min: 0, max: 2, step: 0.02, value: 0.2, rebuilds: false },
  { key: 'stoneRoughness', label: 'Stone roughness', min: 0, max: 1, step: 0.02, value: 1, rebuilds: false },
  { key: 'stoneMetalness', label: 'Stone metalness', min: 0, max: 1, step: 0.02, value: 0, rebuilds: false },
  { key: 'stoneTextureRepeat', label: 'Surface scale', min: 0.4, max: 12, step: 0.1, value: 2.2, rebuilds: false },
];

export interface ShardGrowthUniforms {
  uProgress: { value: number };
  uMode: { value: number };
  /** The PARTNER mark's cell poses, one texel per cell: xyz centroid, w radius. */
  uPartnerPose: { value: THREE.Texture | null };
  uCellCount: { value: number };
  uStagger: { value: number };
  uSwapPoint: { value: number };
  uTumbleTurns: { value: number };
  uArc: { value: number };
  uOrderJitter: { value: number };
}

const SHARD_HELPERS = /* glsl */ `
  const float SHARD_TAU = 6.283185307179586;

  float shardHash( float n ) {
    return fract( sin( n * 12.9898 ) * 43758.5453 );
  }

  // Rodrigues. Cheaper than building a matrix, and it is the same maths.
  vec3 shardSpin( vec3 point, vec3 axis, float angle ) {
    float cosine = cos( angle );
    float sine = sin( angle );
    return point * cosine + cross( axis, point ) * sine + axis * dot( axis, point ) * ( 1.0 - cosine );
  }
`;

/**
 * Teach a stone material to rearrange itself into another mark.
 *
 * Injected into standard PBR rather than hand-written, so the map, the tint and the roughness keep
 * working untouched — the same reasoning `accretionGrowth` gives.
 */
function enableShardRearrange(
  material: THREE.MeshStandardMaterial,
  ownPose: THREE.DataTexture,
): ShardGrowthUniforms {
  const uniforms: ShardGrowthUniforms = {
    uProgress: { value: 0 },
    uMode: { value: SHARDS_MODE.settled },
    // ⚠ Seeded with the mark's OWN pose texture rather than null, and it has to be a real texture.
    // A sampler bound to null at compile time reads back as zeros, and the maths degenerates into
    // precisely the wrong animation: `partnerCentroid` becomes the origin and `partnerRadius` becomes
    // 0, so outgoing pieces tumble inward and shrink to nothing at the centre while incoming pieces
    // grow back out of it. That is a core-and-grow beat — accretion's, not this one — and it looks
    // plausible enough to be mistaken for a design choice rather than a missing binding.
    //
    // Its own poses are the correct identity anyway: pointing a mark at itself means "go where you
    // already are", so an unbound frame sits still instead of collapsing.
    uPartnerPose: { value: ownPose },
    uCellCount: { value: 1 },
    uStagger: { value: 0.55 },
    uSwapPoint: { value: 0.5 },
    uTumbleTurns: { value: 0.35 },
    uArc: { value: 0.55 },
    uOrderJitter: { value: 0.12 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute float aCellIndex;
        attribute vec3 aCellCentroid;
        attribute float aCellRadius;

        uniform float uProgress;
        uniform float uMode;
        uniform sampler2D uPartnerPose;
        uniform float uCellCount;
        uniform float uStagger;
        uniform float uSwapPoint;
        uniform float uTumbleTurns;
        uniform float uArc;
        uniform float uOrderJitter;

        ${SHARD_HELPERS}`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>

        // At rest by default, so a mark that is not part of the change costs nothing but this branch.
        vec3 shardCentre = aCellCentroid;
        float shardScale = 1.0;
        float shardShown = 1.0;
        float shardPhase = 0.0;

        if ( uMode > 0.5 ) {
          // Cell index IS angular order around the mark, so a high stagger makes the change sweep
          // around the outline rather than firing everywhere at once. The jitter keeps the front from
          // reading as a perfect sweep hand.
          float shardOrder = aCellIndex / max( uCellCount - 1.0, 1.0 );
          shardOrder = clamp( shardOrder + ( shardHash( aCellIndex + 3.7 ) - 0.5 ) * uOrderJitter, 0.0, 1.0 );
          float shardStart = shardOrder * uStagger;
          float shardWidth = max( 1.0 - uStagger, 1e-4 );
          shardPhase = clamp( ( uProgress - shardStart ) / shardWidth, 0.0, 1.0 );

          // One texel per cell, sampled NEAREST — the partner's centroid and how far it reaches.
          vec4 shardPartner = texture2D(
            uPartnerPose,
            vec2( ( aCellIndex + 0.5 ) / max( uCellCount, 1.0 ), 0.5 )
          );

          // Outgoing runs rest to partner; incoming runs partner to rest. One number, read both ways,
          // which is what puts the two meshes on the same path at the same moment.
          float shardBlend = uMode > 1.5 ? shardPhase : 1.0 - shardPhase;
          shardCentre = mix( aCellCentroid, shardPartner.xyz, shardBlend );
          shardScale = mix( 1.0, shardPartner.w / max( aCellRadius, 1e-5 ), shardBlend );

          // The baton. Exactly one mesh draws a given cell at a given instant — never both, which is
          // what stops this being a crossfade. The loser collapses to a point and rasterises nothing.
          shardShown = uMode > 1.5
            ? step( shardPhase, uSwapPoint )
            : 1.0 - step( shardPhase, uSwapPoint );
        }

        vec3 shardLocal = ( transformed - aCellCentroid ) * shardScale * shardShown;

        // Tumble peaks mid-flight and is exactly zero at both ends, so a piece always arrives correctly
        // oriented. It peaking AT the handover is the point — see the header.
        vec3 shardAxis = normalize( vec3(
          shardHash( aCellIndex + 1.0 ) - 0.5,
          shardHash( aCellIndex + 2.0 ) - 0.5,
          shardHash( aCellIndex + 3.0 ) - 0.5
        ) + vec3( 0.0, 0.0, 1e-4 ) );
        float shardAngle = uTumbleTurns * SHARD_TAU * sin( PI * shardPhase );
        shardLocal = shardSpin( shardLocal, shardAxis, shardAngle );

        // Fanned through the depth so pieces pass around each other rather than through.
        float shardLift = uArc * sin( PI * shardPhase ) * ( shardHash( aCellIndex + 5.0 ) * 2.0 - 1.0 );

        transformed = shardCentre + shardLocal + vec3( 0.0, 0.0, shardLift );

        objectNormal = shardSpin( objectNormal, shardAxis, shardAngle );
        vNormal = normalize( normalMatrix * objectNormal );`,
      );
  };

  material.customProgramCacheKey = () => 'shards-rearrange';
  material.needsUpdate = true;
  return uniforms;
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

/** One texel per cell — xyz is where it sits, w is how far it reaches. */
function createPoseTexture(cells: ShardCells): THREE.DataTexture {
  const count = Math.max(1, cells.centroids.length);
  const data = new Float32Array(count * 4);
  cells.centroids.forEach((centroid, index) => {
    data[index * 4] = centroid.x;
    data[index * 4 + 1] = centroid.y;
    data[index * 4 + 2] = centroid.z;
    data[index * 4 + 3] = cells.radii[index];
  });
  const texture = new THREE.DataTexture(data, count, 1, THREE.RGBAFormat, THREE.FloatType);
  // NEAREST, and it is not optional: any filtering blends one cell's pose into its neighbour's and
  // pieces land between two places instead of at one.
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

interface MarkLayer {
  mesh: THREE.Mesh;
  uniforms: ShardGrowthUniforms;
  cells: ShardCells;
  pose: THREE.DataTexture;
  bytes: number;
}

class ShardsTransition implements MarkTransitionStrategy {
  readonly id = 'shards' as const;
  readonly object = new THREE.Group();
  metrics: { buildMilliseconds: number; bufferBytes: number; perMarkBytes: number };

  private readonly marks: PreparedMark[];
  private readonly options: MarkTransitionBuildOptions;
  private tuning: TransitionTuning;
  private readonly stoneTexture: THREE.Texture | null;

  private layers: MarkLayer[] = [];
  /** The count every mark actually agreed on. See `resolveCellCount`. */
  private cellCount = 0;

  constructor(
    marks: PreparedMark[],
    options: MarkTransitionBuildOptions,
    tuning: TransitionTuning,
    stoneTexture: THREE.Texture | null,
  ) {
    this.marks = marks;
    this.options = options;
    this.tuning = tuning;
    this.stoneTexture = stoneTexture;
    this.metrics = { buildMilliseconds: 0, bufferBytes: 0, perMarkBytes: 0 };
    this.rebuild();
  }

  /** Cut one mark at a given count. */
  private cut(mark: PreparedMark, cellCount: number): ShardCells {
    return buildShardCells(mark.shapes, mark.flipY, {
      targetSize: this.options.targetSize,
      depth: this.options.depth,
      capEdgeFraction: this.tuning.capEdgeFraction,
      capSubdivisions: this.tuning.capSubdivisions,
      cellCount,
    });
  }

  private rebuild(): void {
    const startedAt = performance.now();
    this.disposeLayers();

    const wanted = Math.max(1, Math.round(this.tuning.cellCount));

    // ── Every mark MUST end up with the same number of cells ──
    // `buildShardCells` clamps to the mark's triangle count, so a mark tessellated too coarsely for the
    // requested count comes back short — and cell i would then exist in one mark and not the other,
    // which is the one assumption the whole strategy rests on. Cut once, take the lowest count anyone
    // could manage, and if that is not what was asked for, cut everything again at that. Rare, and far
    // better than a correspondence that is quietly wrong.
    let cuts = this.marks.map((mark) => this.cut(mark, wanted));
    const agreed = cuts.reduce(
      (lowest, cells) => Math.min(lowest, cells.centroids.length),
      Number.POSITIVE_INFINITY,
    );
    const resolved = Number.isFinite(agreed) ? Math.max(1, agreed) : 1;
    if (cuts.some((cells) => cells.centroids.length !== resolved)) {
      cuts.forEach((cells) => cells.geometry.dispose());
      cuts = this.marks.map((mark) => this.cut(mark, resolved));
    }
    this.cellCount = resolved;

    this.layers = cuts.map((cells) => {
      // Built BEFORE the material, so the sampler has a real texture the moment the program compiles —
      // see the note in `enableShardRearrange`.
      const pose = createPoseTexture(cells);

      const material = new THREE.MeshStandardMaterial({
        map: this.stoneTexture
          ? cloneRepeated(this.stoneTexture, this.tuning.stoneTextureRepeat)
          : null,
        color: STONE_BASE_COLOR.clone().multiplyScalar(this.tuning.stoneAlbedo),
        roughness: this.tuning.stoneRoughness,
        metalness: this.tuning.stoneMetalness,
        envMapIntensity: this.tuning.envIntensity,
      });
      const uniforms = enableShardRearrange(material, pose);

      const mesh = new THREE.Mesh(cells.geometry, material);
      // Pieces leave their resting bounds entirely, and fan out through the depth on top of that.
      mesh.frustumCulled = false;
      this.object.add(mesh);

      return {
        mesh,
        uniforms,
        cells,
        pose,
        bytes: measureGeometryBytes(cells.geometry) + this.cellCount * 4 * 4,
      };
    });

    const buildMilliseconds = performance.now() - startedAt;
    const bufferBytes = this.layers.reduce((total, layer) => total + layer.bytes, 0);
    this.metrics = {
      buildMilliseconds,
      bufferBytes,
      perMarkBytes: Math.round(bufferBytes / Math.max(1, this.layers.length)),
    };
  }

  private disposeLayers(): void {
    this.layers.forEach((layer) => {
      this.object.remove(layer.mesh);
      layer.cells.geometry.dispose();
      const material = layer.mesh.material as THREE.MeshStandardMaterial;
      material.map?.dispose();
      material.dispose();
      layer.pose.dispose();
    });
    this.layers = [];
  }

  /** Push the live numbers onto one mark's uniforms and material. */
  private applyLook(layer: MarkLayer, mode: number, partner: MarkLayer): void {
    const uniforms = layer.uniforms;
    uniforms.uMode.value = mode;
    uniforms.uPartnerPose.value = partner.pose;
    uniforms.uCellCount.value = this.cellCount;
    uniforms.uStagger.value = this.tuning.stagger;
    uniforms.uSwapPoint.value = this.tuning.swapPoint;
    uniforms.uTumbleTurns.value = this.tuning.tumbleTurns;
    uniforms.uArc.value = this.tuning.arc;
    uniforms.uOrderJitter.value = this.tuning.orderJitter;

    const material = layer.mesh.material as THREE.MeshStandardMaterial;
    material.color.copy(STONE_BASE_COLOR).multiplyScalar(this.tuning.stoneAlbedo);
    material.roughness = this.tuning.stoneRoughness;
    material.metalness = this.tuning.stoneMetalness;
    material.envMapIntensity = this.tuning.envIntensity;
    material.map?.repeat.setScalar(this.tuning.stoneTextureRepeat);
  }

  setTransition(fromIndex: number, toIndex: number, progress: number): void {
    const clamped = clampProgress(progress);
    const count = this.layers.length;
    if (count === 0) return;

    const from = Math.max(0, Math.min(count - 1, fromIndex));
    const to = Math.max(0, Math.min(count - 1, toIndex));
    // Sitting still. Handed both roles a mark would be told to leave and arrive at once, and half its
    // pieces would vanish to the baton.
    const isStill = from === to;

    this.layers.forEach((layer, index) => {
      const isFrom = index === from;
      const isTo = index === to;
      const visible = isFrom || isTo;
      layer.mesh.visible = visible;
      if (!visible) return;

      const mode = isStill
        ? SHARDS_MODE.settled
        : isTo
          ? SHARDS_MODE.incoming
          : SHARDS_MODE.outgoing;
      // The partner is the OTHER mark — whose cell poses this one is travelling to or from. Sitting
      // still it is its own partner, which is harmless: settled mode never reads the pose texture.
      this.applyLook(layer, mode, this.layers[isTo ? from : to]);
      layer.uniforms.uProgress.value = clamped;
    });
  }

  update(): void {
    // Nothing idles — the rig owns the spin, and motion here would be a second clock.
  }

  applyTuning(tuning: TransitionTuning): void {
    const needsRebuild = SHARDS_CONTROLS.some(
      (control) => control.rebuilds && tuning[control.key] !== this.tuning[control.key],
    );
    this.tuning = { ...tuning };
    if (needsRebuild) this.rebuild();
  }

  dispose(): void {
    this.disposeLayers();
    this.stoneTexture?.dispose();
  }
}

export const shardsTransitionFactory: MarkTransitionFactory = {
  id: 'shards',
  label: 'Shards',
  identity: 'Pieces — N cells that tile the mark exactly; cell i becomes cell i.',
  tuningControls: SHARDS_CONTROLS,
  create: async (marks, options, tuning) => {
    const stoneTexture = await loadTexture(STONE_TEXTURE_PATH);
    return new ShardsTransition(
      marks,
      options,
      { ...tuningDefaults(SHARDS_CONTROLS), ...tuning },
      stoneTexture,
    );
  },
};
