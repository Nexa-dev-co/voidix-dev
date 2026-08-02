import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { LENSING_SHADER } from "@/lib/lensingShader";
import {
  ACCRETION_COUNT,
  ACCRETION_FRAGMENT_SHADER,
  ACCRETION_UNIFORMS,
  ACCRETION_VERTEX_SHADER,
} from "@/lib/accretionShader";
import {
  BURST_FRAGMENT_SHADER,
  BURST_UNIFORMS,
  BURST_VERTEX_SHADER,
  flashEnvelope,
} from "@/lib/burstShader";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import {
  buildSunLabRegistry,
  buildBlackHoleRegistry,
  applyMaterialParams,
  addDuplicateEntry,
  removeRegistryEntry,
  type SunLabRegistry,
  type SunLabObjectEntry,
} from "../sunLabModel";
import {
  DEFAULT_GLOBAL_PARAMS,
  type FormEasing,
  type GlobalParams,
  type MaterialParams,
  type Vector3Values,
} from "../sunLabState";

// The Sun Lab scene. Loads fractured_sun.glb exactly as authored (never flattened — its two coordinate
// frames are intentional), lights + blooms it, and hands React an IMPERATIVE handle so slider drags
// mutate the 47 MB model in place instead of rebuilding it. React owns the values; this owns the scene.

const MODEL_PATH = "/models/fractured_sun.glb";
const BLACKHOLE_MODEL_PATH = "/models/black_hole.glb";
const DRACO_DECODER_PATH = "/draco/";
// The finale, mapped to the sequence 0→1. The order is the whole point and reads strictly left to right:
//
//   0.00        0.15              0.50   0.62        0.84        1.00
//     │ liquid sun │  COLLAPSE      │ HORIZON │  RINGS FORM        │
//     │  churns    │  star falls in │ opens   │  glow, then the    │
//     │            │                │ from    │  main ring last    │
//     │            │                │ middle  │                    │
//
// Nothing overlaps that shouldn't: the hole opens only once the star is essentially gone, and the disc
// assembles only once the hole exists. The rings used to form BEFORE the core, which read as two models
// cross-fading rather than one thing causing the next.
const FINALE_EXPLODE: [number, number] = [0.15, 0.5]; // the star falls in
const FINALE_HORIZON: [number, number] = [0.4, 0.62]; // the hole opens from the middle
// The liquid ramps IN with the collapse rather than being on from frame 0. The finale opens on the
// collapsed-but-intact star, which has to read as solid matter before it starts behaving like fluid —
// a star that is already flowing before anything happens has nowhere to go.
const FINALE_LIQUID_RAMP: [number, number] = [0.15, 0.34];
// The disc assembles only AFTER the hole is finished — there is a deliberate beat of just-a-black-hole
// between FINALE_HORIZON completing (0.62) and the first ring appearing, so the disc reads as something
// that gathered around the hole rather than arriving with it.
const FINALE_RING_FORM_EARLY: [number, number] = [0.68, 0.88];
const FINALE_RING_FORM_LATE: [number, number] = [0.78, 1];
const BLACKHOLE_TARGET_FACTOR = 1.3;
// The flash, in sequence units around its peak. Attack is short — a detonation arrives fast.
const FLASH_ATTACK = 0.05;
// The BURST CORE only holds briefly: it is the detonation itself, and it has to get out of the way so
// you can see what it revealed. The screen grade below is what stays lit.
const FLASH_CORE_HOLD_FRACTION = 0.25;
const FLASH_CORE_DECAY = 0.16;
// The screen-wide grade lags the core slightly (the eye is overwhelmed a beat AFTER the light arrives)
// and then PLATEAUS for the authored hold — that plateau is the window the black hole forms inside.
const FLASH_SCREEN_LAG = 0.015;
const FLASH_SCREEN_ATTACK = 0.07;
const FLASH_SCREEN_DECAY = 0.24;
// How far the burst quad expands, in sun-radii. Kept modest: it is additive and covers a lot of frame,
// so a large bright quad floods everything it is meant to be revealing.
const FLASH_SCALE_FROM = 0.5;
const FLASH_SCALE_TO = 4;
// The black hole's liquid, relative to the flash: it swells in while the screen is held bright (the hole
// forming inside the glare) and drains to zero as that brightness leaves — settling to a plain hole.
const FINALE_LIQUID_IN_FRACTION = 0.7;
// What the screen-wide stage ADDS at full intensity. Kept modest on purpose: the finale stages are
// already graded hot (exposure 1.6, bloom 2.5), so a big boost here doesn't read as a flash, it just
// white-clips the frame and you lose the horizon opening underneath it. Raise `strength` to go brighter.
const FLASH_EXPOSURE_BOOST = 0.45;
const FLASH_BLOOM_BOOST = 0.4;
// A sudden bright flash is a photosensitivity trigger, so it is damped hard rather than merely eased.
const REDUCED_MOTION_FLASH_SCALE = 0.22;
// The only lit material on the sun, and the one carrying its glow — so it is the one redshift acts on.
const REDSHIFT_MATERIAL = "magma";
// The anticipation beat. The tremor builds across TREMOR_IN and is then swallowed by the real collapse,
// so it hands over rather than competing with it.
const TREMOR_IN = 0.14;
// Radians per unit of sequence — about three shudders across the beat. Fast enough to read as a struggle,
// slow enough not to look like noise.
const TREMOR_FREQUENCY = 140;
// Per-shard phase offset, so they shudder out of step. In lockstep it reads as one mechanical pulse.
const TREMOR_PHASE_STEP = 0.9;
// What the beat adds beyond the shudder itself, at full amplitude.
const TREMOR_SPIN_LIFT = 0.8;
const TREMOR_GLOW_SWELL = 0.5;
// Bloom settles to this as the black hole forms (only the bloom — exposure + lights stay glowy).
const BLACKHOLE_BLOOM_STRENGTH = 0.44;
// black_hole.glb is now converted to real metallic-roughness at build time (see the `specGloss` recipe in
// scripts/optimizeModels.mjs), so three loads its colours and all its textures natively. Nothing about
// its materials is rewritten here any more — the registry captures the model's own values as the
// defaults, which is what makes "Reset" on this tab actually mean reset.
//
// One exception is applied on load, in BLACK_HOLE_HORIZON_MATERIALS below: the horizon's specular.
// The conversion faithfully preserves the artist's specularFactor 0.2, which three encodes as F0 ≈ 0.199
// — a 20%-reflective surface. Black albedo kills the diffuse term but NOT the specular one, so the key
// light would put a glossy highlight on the event horizon. `specularIntensity = 0` collapses that term
// to zero for every light at every angle, which is the only way a black hole stays black.
const BLACK_HOLE_HORIZON_MATERIALS = ["black_hole_blackoutside", "black_hole_center"];
// Yellow sparks: they emit from the sun during the explosion, fly out, then spiral back into the hole.
const PARTICLE_COUNT = 2600;
const PARTICLE_EMIT: [number, number] = [0.16, 0.34]; // when each particle is born (staggered)
const PARTICLE_ABSORB: [number, number] = [0.72, 0.94]; // when each is swallowed (staggered)
const PARTICLE_OUT_FRACTION = 0.32; // share of a particle's life spent flying OUT before it's pulled in
const PARTICLE_COLOR = new THREE.Color(1.0, 0.82, 0.28);
const PARTICLE_SIZE = 26;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_FRAME_SECONDS = 0.05;
const BLOOM_MSAA_SAMPLES = 4;
// Leave the model comfortably inside the frame after auto-fitting to its bounding sphere.
const CAMERA_FIT_MARGIN = 1.35;
// Phase offset per shard so the cracks don't all breathe in lockstep — reads as alive, not mechanical.
const FRACTURE_PHASE_STEP = 0.7;
const TWO_PI = Math.PI * 2;

/** One flare's spin state: its disc-normal axis, its posed rotation, and the accumulated spin. */
interface FlareSpin {
  mesh: THREE.Mesh;
  axis: THREE.Vector3;
  base: THREE.Quaternion;
  angle: number;
}

export interface SunLabStatus {
  isLoading: boolean;
  /** 0..100 while downloading, or -1 when unknown / errored. */
  percent: number;
  error?: boolean;
}

/** The imperative surface the HUD drives. Every method mutates the live scene; none holds React state. */
export interface SunLabSceneHandle {
  registry: SunLabRegistry;
  /** The black hole's registry (its own tab in the tree). Null until the model has loaded. */
  blackHoleRegistry: SunLabRegistry | null;
  applyGlobal: (global: GlobalParams) => void;
  applyObjectTransform: (
    id: string,
    resolved: {
      visible: boolean;
      position: Vector3Values;
      rotation: Vector3Values;
      scale: Vector3Values;
    },
  ) => void;
  /** Per-object material edit — clones the shared material on first touch so siblings are untouched. */
  applyObjectMaterial: (id: string, slot: number, params: MaterialParams) => void;
  /** Un-clone a slot back to its shared material (used when a snapshot has no per-object override). */
  setObjectMaterialToShared: (id: string, slot: number) => void;
  /** Edit a shared material in place (the Materials group) — affects every object still bound to it. */
  applySharedMaterial: (name: string, params: MaterialParams) => void;
  /** Signed radial offset of the fracture cells, in units of the cell radius. Composes with overrides. */
  applyFractureSpread: (amount: number) => void;
  /** Play the one-shot fracture "form" (ramp from formFromSpread to the current spread). */
  playFormAnimation: () => void;
  /** Re-frame the camera on the model's current bounds. */
  fitCamera: () => void;
  /** Clone an existing object into a new selectable one (same group). Used by Duplicate + reload. */
  addDuplicate: (sourceId: string, newId: string) => void;
  /** Remove a duplicated object from the scene + registry. */
  removeObject: (id: string) => void;
  /** Set the finale to a moment on its 0→1 timeline (sun fade ↔ black-hole reveal; particles later). */
  applyFinale: (sequence: number) => void;
  /**
   * Play the finale once, ramping the sequence 0→1 over the given seconds. `onSequence` reports each
   * step so React's scrub cursor follows along — without it the slider sits at 0 during playback and the
   * next global edit re-applies that stale 0, snapping the finale back to the start.
   */
  playSequence: (durationSeconds: number, onSequence?: (sequence: number) => void) => void;
  /** Show the fully-formed black hole (sun hidden) so it can be edited on the Black hole tab. */
  setBlackHolePreview: (enabled: boolean) => void;
  /** Show the black hole ALONE with its own settings (the "New black hole" tab). Sun hidden. */
  showBlackHoleStandalone: (settings: BlackHoleStandaloneSettings) => void;
  /** Leave standalone mode (the caller then re-applies the sun). */
  exitBlackHoleStandalone: () => void;
}

/** The self-contained look the "New black hole" tab drives — its own scene grade, transform + spin. */
export interface BlackHoleStandaloneSettings {
  exposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  key: { color: string; intensity: number };
  fill: { color: string; intensity: number };
  ambient: { color: string; intensity: number };
  background: { color: string; transparent: boolean };
  cameraFov: number;
  /** envMapIntensity pushed onto the black hole's own materials — 0 stops the chrome-mirror reflection. */
  envIntensity: number;
  scale: number;
  position: Vector3Values;
  rotation: Vector3Values;
  spinAxis: number;
  spinSpeed: number;
  /** The screen-space lensing settings this tab drives (see lib/lensingShader.ts). */
  lensing: GlobalParams["lensing"];
}

interface UseSunLabSceneArguments {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onReady: (handle: SunLabSceneHandle) => void;
  onStatus: (status: SunLabStatus) => void;
  /** Fires once the black hole model has loaded + registered, so React can show its tab + apply state. */
  onBlackHoleReady: () => void;
}

/** Smooth 0→1 ramp across [edge0, edge1], clamped flat outside. */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * A flash envelope with a sustained plateau: rise → HOLD → fall.
 *
 * The hold is the whole point. A pulse that peaks and immediately decays reads as a camera flash; a
 * supernova floods the frame and STAYS flooded while the thing that caused it resolves underneath. That
 * plateau is the window the black hole forms in.
 *
 * Squared on the way up so it snaps in, squared down from full so it drops away and tails.
 */
function setEulerFromDegrees(euler: THREE.Euler, degrees: Vector3Values): void {
  euler.set(
    THREE.MathUtils.degToRad(degrees.x),
    THREE.MathUtils.degToRad(degrees.y),
    THREE.MathUtils.degToRad(degrees.z),
  );
}

export function useSunLabScene({
  canvasRef,
  onReady,
  onStatus,
  onBlackHoleReady,
}: UseSunLabSceneArguments): void {
  // Keep the latest callbacks without re-running the (heavy) setup effect.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onBlackHoleReadyRef = useRef(onBlackHoleReady);
  onBlackHoleReadyRef.current = onBlackHoleReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = DEFAULT_GLOBAL_PARAMS.exposure;

    const scene = new THREE.Scene();

    // Spinner holds auto-rotation; modelRoot holds the static pose + scale. Keeping them on separate
    // nodes means the "rotation" pose control and the "auto-rotate" control never fight over the same
    // Euler.
    const spinner = new THREE.Group();
    scene.add(spinner);

    const camera = new THREE.PerspectiveCamera(
      DEFAULT_GLOBAL_PARAMS.camera.fov,
      1,
      0.01,
      1000,
    );
    camera.position.set(0, 0, 5);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // PBR reflections so the metal/hull reads under the lighting, same as the shipped scenes.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environmentTexture;
    scene.background = new THREE.Color(DEFAULT_GLOBAL_PARAMS.background.color);

    const keyLight = new THREE.DirectionalLight(
      new THREE.Color(DEFAULT_GLOBAL_PARAMS.key.color),
      DEFAULT_GLOBAL_PARAMS.key.intensity,
    );
    keyLight.position.set(3, 4, 5);
    const fillLight = new THREE.DirectionalLight(
      new THREE.Color(DEFAULT_GLOBAL_PARAMS.fill.color),
      DEFAULT_GLOBAL_PARAMS.fill.intensity,
    );
    fillLight.position.set(-4, -1, -3);
    const ambientLight = new THREE.AmbientLight(
      new THREE.Color(DEFAULT_GLOBAL_PARAMS.ambient.color),
      DEFAULT_GLOBAL_PARAMS.ambient.intensity,
    );
    // Sits at the sun's centre; pours out through the fracture gaps when the cells part.
    const coreLight = new THREE.PointLight(
      new THREE.Color(DEFAULT_GLOBAL_PARAMS.coreLight.color),
      DEFAULT_GLOBAL_PARAMS.coreLight.intensity,
      DEFAULT_GLOBAL_PARAMS.coreLight.distance,
    );
    scene.add(keyLight, fillLight, ambientLight, coreLight);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Lensing sits BEFORE bloom on purpose: gravity bends the light on its way to the camera, and bloom
    // is an artefact of the camera itself. Ordering it this way also means the photon ring blooms.
    const lensingPass = new ShaderPass(LENSING_SHADER);
    composer.addPass(lensingPass);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      DEFAULT_GLOBAL_PARAMS.bloom.strength,
      DEFAULT_GLOBAL_PARAMS.bloom.radius,
      DEFAULT_GLOBAL_PARAMS.bloom.threshold,
    );
    composer.addPass(bloomPass);
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    const resize = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
      lensingPass.uniforms.uAspect.value = width / height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    // ── Scene-owned mutable state the handle + loop share ──
    let modelRoot: THREE.Object3D | null = null;
    let registry: SunLabRegistry | null = null;
    let blackHoleRegistry: SunLabRegistry | null = null;
    // Look an object up in either model (ids are globally unique across the sun + black hole).
    const findEntry = (id: string): SunLabObjectEntry | undefined =>
      registry?.entriesById.get(id) ?? blackHoleRegistry?.entriesById.get(id);
    let autoRotateSpeed = 0;
    let fractureSpread = 0;
    // Cracks breathing — a gravity-like inward tug on the shards. Amplitude 0 = still.
    let fracturePulse = 0;
    let fracturePulseSpeed = 0.3;
    let fracturePulseTime = 0;
    // Form-on-enter — a one-shot ramp of the spread when a stage is entered.
    let formActive = false;
    let formProgress = 0;
    let formDuration = 1.2;
    let formFromSpread = 0;
    let formEasing: FormEasing = "out";
    let formFromScale = 1;
    let targetModelScale = 1;
    // Finale — the sun→black-hole reveal, driven by a 0→1 sequence.
    let finaleEnabled = false;
    let blackHoleScale = 1;
    let blackHoleSpinSpeed = 20;
    let currentSequence = 0;
    let sunRadius = 1;
    // blackHoleGroup holds the scale + position + static rotation; blackHoleSpinner (its child) holds the
    // idle spin — so a static rotation and the spin never fight over the same Euler.
    const blackHoleGroup = new THREE.Group();
    blackHoleGroup.scale.setScalar(0); // hidden until shown
    const blackHoleSpinner = new THREE.Group();
    blackHoleGroup.add(blackHoleSpinner);
    scene.add(blackHoleGroup);
    let blackHoleFitScale = 1;
    let blackHoleLoaded = false;
    // LOCAL radius of just the horizon meshes (not the rings) — the lensing pass needs to know where the
    // shadow edge actually is, and the rings extend far past it.
    let blackHoleHorizonRadius = 1;
    // How far the horizon has opened, 0..1. Since the finale now keeps the GROUP at full scale and
    // reveals per-mesh, group scale no longer says whether the hole is on screen — this does.
    let blackHoleHorizonForm = 0;
    let lensing = structuredClone(DEFAULT_GLOBAL_PARAMS.lensing);
    let accretion = structuredClone(DEFAULT_GLOBAL_PARAMS.accretion);
    let finaleFlash = structuredClone(DEFAULT_GLOBAL_PARAMS.finaleFlash);
    let finaleCollapse = structuredClone(DEFAULT_GLOBAL_PARAMS.finaleCollapse);
    // While the finale is crushing the shards it OWNS them, so the render loop's breathing must stand
    // down rather than write competing positions every frame.
    let finaleOwnsShards = false;
    // Multiplier the render loop applies to both spins — angular momentum as the star contracts.
    let finaleSpinMultiplier = 1;
    // The magma's authored emissive, so redshift can lerp FROM it and return to it exactly at sequence 0.
    // Re-captured whenever the material is written, so editing it mid-finale doesn't bake in a tint.
    let redshiftBaseEmissive: THREE.Color | null = null;
    const scratchRedshift = new THREE.Color();
    const captureRedshiftBase = () => {
      const magma = registry?.sharedMaterials.find((entry) => entry.name === REDSHIFT_MATERIAL);
      if (magma && magma.material instanceof THREE.MeshStandardMaterial) {
        redshiftBaseEmissive = magma.material.emissive.clone();
      }
    };
    const restoreRedshift = () => {
      const magma = registry?.sharedMaterials.find((entry) => entry.name === REDSHIFT_MATERIAL);
      if (magma && magma.material instanceof THREE.MeshStandardMaterial && redshiftBaseEmissive) {
        magma.material.emissive.copy(redshiftBaseEmissive);
      }
    };
    // 0→1 across FINALE_LIQUID_RAMP; scales the sun-targeted lensing so the star starts solid. Stays at 1
    // off the finale, where lensing is just a look the stage authored and shouldn't be second-guessed.
    let finaleLiquidRamp = 1;
    // The stage's authored exposure, so the flash can spike ABOVE it and return to it exactly.
    let baseExposure = DEFAULT_GLOBAL_PARAMS.exposure;
    let lensingTime = 0;
    const scratchLensCenter = new THREE.Vector3();
    const scratchLensEdge = new THREE.Vector3();
    const scratchCameraUp = new THREE.Vector3();

    // Point the lensing pass at wherever the black hole currently is on screen. Measured every frame so it
    // tracks orbiting, zoom and the reveal, rather than assuming the hole sits at the centre.
    const updateLensing = () => {
      const uniforms = lensingPass.uniforms;
      const targetsSun = lensing.target === "sun";
      // On a finale stage the liquid is driven by the sequence envelope (see applyFinale); everywhere
      // else — other stages, the black hole tab — it is exactly what was authored.
      const strength = lensing.strength * (finaleEnabled ? finaleLiquidRamp : 1);
      // Whichever body the distortion belongs to. Targeting the sun is what gives the STAR its molten
      // read; targeting the hole is the gravitational lens.
      const target = targetsSun ? modelRoot : blackHoleGroup;
      // For the hole, fold in how far it has opened — an unopened horizon is nothing to bend light around.
      const targetScale = targetsSun
        ? (modelRoot?.scale.x ?? 0)
        : blackHoleGroup.scale.x * blackHoleHorizonForm;
      // Its radius in local units — the sun's own bounding radius, or just the black hole's horizon.
      const targetRadius = targetsSun ? sunRadius : blackHoleHorizonRadius;
      // Nothing to distort if the body isn't there or has collapsed away. Strength 0 makes the shader a
      // pass-through, so this also skips the cost. As a collapsing sun shrinks, its radius shrinks with
      // it and the liquid concentrates then vanishes on its own — no separate fade needed.
      const ready = targetsSun ? !!modelRoot && modelRoot.visible : blackHoleLoaded;
      if (strength <= 0 || !ready || !target || targetScale <= 1e-4) {
        uniforms.uStrength.value = 0;
        return;
      }

      // OrbitControls has just moved the camera, but its matrices are only refreshed inside render() —
      // without this the lens centre would trail the camera by a frame while orbiting.
      camera.updateMatrixWorld();

      target.getWorldPosition(scratchLensCenter);
      scratchLensCenter.project(camera);
      // Behind the camera: projection wraps and would smear the effect across the frame.
      if (scratchLensCenter.z > 1) {
        uniforms.uStrength.value = 0;
        return;
      }
      uniforms.uStrength.value = strength;
      uniforms.uCenter.value.set(
        scratchLensCenter.x * 0.5 + 0.5,
        scratchLensCenter.y * 0.5 + 0.5,
      );

      // Project the body's edge to get its on-screen size. Offsetting along camera UP (not right) lands
      // in NDC-y, which maps to the shader's vertical units with no aspect correction to undo.
      scratchCameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
      target.getWorldPosition(scratchLensEdge);
      scratchLensEdge
        .addScaledVector(
          scratchCameraUp,
          targetRadius * targetScale * lensing.radiusScale,
        )
        .project(camera);
      uniforms.uRadius.value = Math.max(
        Math.abs(scratchLensEdge.y - scratchLensCenter.y) * 0.5,
        1e-4,
      );

      uniforms.uAberration.value = lensing.aberration;
      uniforms.uLiquid.value = lensing.liquid;
      uniforms.uRingStrength.value = lensing.ring;
      uniforms.uShadow.value = lensing.shadow;
      uniforms.uTime.value = lensingTime;
    };
    // "New black hole" tab (standalone): the black hole shown alone with its OWN settings, decoupled
    // from the sun/finale. Spin runs on the spinner about a chosen axis.
    let blackHoleStandalone = false;
    let blackHoleStandaloneSpinAxis = 1;
    let blackHoleStandaloneSpinSpeed = 0;
    const setBlackHoleEnvIntensity = (intensity: number) => {
      blackHoleGroup.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.envMapIntensity = intensity;
            material.needsUpdate = true;
          }
        });
      });
    };
    // The sun's core light fades WITH the sun (its heat gets sucked in too), so the black hole isn't
    // left over-lit. Everything else stays at the stage's authored glow — nothing is dimmed by hand.
    let baseCoreLightIntensity = DEFAULT_GLOBAL_PARAMS.coreLight.intensity;
    // The bloom the finale grades FROM (the stage's authored super-glow) toward the black-hole value.
    let baseBloomStrength = DEFAULT_GLOBAL_PARAMS.bloom.strength;

    // ── Yellow spark particles (explosion → orbit → swallowed) ──
    // Each particle's whole path is a function of the sequence, so it scrubs cleanly and truly ends.
    const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    const particleAlphas = new Float32Array(PARTICLE_COUNT);
    // Per-particle constants: a random orbit plane (u,v), phase, turns, reach, and birth/death times.
    const particleU = new Float32Array(PARTICLE_COUNT * 3);
    const particleV = new Float32Array(PARTICLE_COUNT * 3);
    const particlePhase = new Float32Array(PARTICLE_COUNT);
    const particleTurns = new Float32Array(PARTICLE_COUNT);
    const particleReach = new Float32Array(PARTICLE_COUNT);
    const particleEmit = new Float32Array(PARTICLE_COUNT);
    const particleAbsorb = new Float32Array(PARTICLE_COUNT);

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(particleAlphas, 1));
    const particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: PARTICLE_COLOR },
        uSize: { value: PARTICLE_SIZE },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        uniform float uSize;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (1.0 / max(-mv.z, 0.001));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vAlpha;
        uniform vec3 uColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float glow = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor * glow * vAlpha, glow * vAlpha);
        }`,
    });
    const particlePoints = new THREE.Points(particleGeometry, particleMaterial);
    particlePoints.frustumCulled = false;
    particlePoints.visible = false;
    scene.add(particlePoints);

    // ── Supernova burst (the flash that masks the handoff) ──
    // A billboarded additive quad at the origin. depthTest is off so it always reads: it is light hitting
    // the lens, not an object in the scene, and at this moment the horizon is opening in the same place.
    const burstMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(BURST_UNIFORMS),
      vertexShader: BURST_VERTEX_SHADER,
      fragmentShader: BURST_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const burstMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), burstMaterial);
    burstMesh.frustumCulled = false;
    burstMesh.renderOrder = 999;
    burstMesh.visible = false;
    scene.add(burstMesh);
    const flashDamping = prefersReducedMotion() ? REDUCED_MOTION_FLASH_SCALE : 1;

    // ── Accretion spiral (the star's own matter becoming the disc) ──
    // Lives on `spinner` so it shares the sun's frame; the black hole sits at that frame's origin, which
    // is exactly where the particles fall to.
    const accretionGeometry = new THREE.BufferGeometry();
    const accretionMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(ACCRETION_UNIFORMS),
      vertexShader: ACCRETION_VERTEX_SHADER,
      fragmentShader: ACCRETION_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const accretionPoints = new THREE.Points(accretionGeometry, accretionMaterial);
    accretionPoints.frustumCulled = false; // the vertex shader moves points far from their bind pose
    accretionPoints.visible = false;
    spinner.add(accretionPoints);
    let accretionSeeded = false;

    // Sample start points across the sun's actual surface. Sampling TRIANGLES rather than vertices gives
    // even coverage — the model's 10k vertices are clustered around detail, so vertex sampling would
    // clump. Positions are normalised to sun-radii so the shader's radius maths is scale-free.
    const seedAccretion = () => {
      if (!modelRoot || accretionSeeded) return;
      spinner.updateMatrixWorld(true);
      const spinnerInverse = new THREE.Matrix4().copy(spinner.matrixWorld).invert();
      const toSpinner = new THREE.Matrix4();
      const corner = new THREE.Vector3();
      const triangles: number[] = [];

      modelRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const positionAttribute = object.geometry.getAttribute("position");
        if (!positionAttribute) return;
        toSpinner.multiplyMatrices(spinnerInverse, object.matrixWorld);
        const index = object.geometry.getIndex();
        const triangleCount = index ? index.count / 3 : positionAttribute.count / 3;
        for (let triangle = 0; triangle < triangleCount; triangle += 1) {
          for (let vertex = 0; vertex < 3; vertex += 1) {
            const slot = triangle * 3 + vertex;
            const attributeIndex = index ? index.getX(slot) : slot;
            corner
              .fromBufferAttribute(positionAttribute, attributeIndex)
              .applyMatrix4(toSpinner);
            triangles.push(corner.x, corner.y, corner.z);
          }
        }
      });

      const triangleCount = triangles.length / 9;
      if (triangleCount === 0) return;

      const starts = new Float32Array(ACCRETION_COUNT * 3);
      const seeds = new Float32Array(ACCRETION_COUNT);
      for (let particle = 0; particle < ACCRETION_COUNT; particle += 1) {
        const base = Math.floor(Math.random() * triangleCount) * 9;
        // Uniform barycentric point on the triangle — the fold keeps it inside instead of biased to a corner.
        let u = Math.random();
        let v = Math.random();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const w = 1 - u - v;
        const target = particle * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          starts[target + axis] =
            (triangles[base + axis] * w +
              triangles[base + 3 + axis] * u +
              triangles[base + 6 + axis] * v) /
            sunRadius;
        }
        // Kept in [0,1): the shader's hash multiplies it up, and feeding it a large number there costs
        // float precision and bands the release times.
        seeds[particle] = Math.random();
      }

      accretionGeometry.setAttribute("position", new THREE.BufferAttribute(starts, 3));
      accretionGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      accretionMaterial.uniforms.uScale.value = sunRadius;
      accretionSeeded = true;
    };

    // Seed the per-particle constants once we know the sun's size (called on sun load).
    const seedParticles = () => {
      const tmpNormal = new THREE.Vector3();
      const tmpU = new THREE.Vector3();
      const tmpV = new THREE.Vector3();
      for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        // A random orbit plane: pick a normal, then two perpendicular basis vectors in that plane.
        tmpNormal.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        tmpU.set(0, 1, 0);
        if (Math.abs(tmpNormal.y) > 0.9) tmpU.set(1, 0, 0);
        tmpU.crossVectors(tmpU, tmpNormal).normalize();
        tmpV.crossVectors(tmpNormal, tmpU).normalize();
        particleU.set([tmpU.x, tmpU.y, tmpU.z], index * 3);
        particleV.set([tmpV.x, tmpV.y, tmpV.z], index * 3);
        particlePhase[index] = Math.random() * Math.PI * 2;
        particleTurns[index] = 1 + Math.random() * 2.5;
        particleReach[index] = sunRadius * (0.7 + Math.random() * 1.1);
        particleEmit[index] = PARTICLE_EMIT[0] + Math.random() * (PARTICLE_EMIT[1] - PARTICLE_EMIT[0]);
        particleAbsorb[index] =
          PARTICLE_ABSORB[0] + Math.random() * (PARTICLE_ABSORB[1] - PARTICLE_ABSORB[0]);
      }
    };

    // Place + fade every particle for a moment on the timeline. radius rises then falls (fly out, then
    // get pulled in, accelerating like gravity); the orbit angle keeps turning the whole time.
    const updateParticles = (sequence: number) => {
      for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        const emit = particleEmit[index];
        const absorb = particleAbsorb[index];
        const life = (sequence - emit) / (absorb - emit);
        if (life <= 0 || life >= 1) {
          particleAlphas[index] = 0;
          continue;
        }
        let radiusFactor: number;
        if (life < PARTICLE_OUT_FRACTION) {
          const outT = life / PARTICLE_OUT_FRACTION;
          radiusFactor = outT * (2 - outT); // ease-out to full reach
        } else {
          const inT = (life - PARTICLE_OUT_FRACTION) / (1 - PARTICLE_OUT_FRACTION);
          radiusFactor = 1 - inT * inT; // ease-in back to the centre (gravity)
        }
        const radius = particleReach[index] * radiusFactor;
        const angle = particlePhase[index] + life * particleTurns[index] * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const base = index * 3;
        particlePositions[base] = radius * (cos * particleU[base] + sin * particleV[base]);
        particlePositions[base + 1] =
          radius * (cos * particleU[base + 1] + sin * particleV[base + 1]);
        particlePositions[base + 2] =
          radius * (cos * particleU[base + 2] + sin * particleV[base + 2]);
        // Fade in at birth, wink out as it's swallowed.
        particleAlphas[index] = Math.min(
          smoothstep(0, 0.08, life),
          1 - smoothstep(0.88, 1, life),
        );
      }
      particleGeometry.attributes.position.needsUpdate = true;
      particleGeometry.attributes.aAlpha.needsUpdate = true;
    };
    // Play state — a one-shot ramp of the sequence.
    let sequencePlayActive = false;
    let sequencePlayProgress = 0;
    let sequencePlayDuration = 6;
    // Set for the duration of a Play so React's scrub cursor can track it.
    let sequenceReporter: ((sequence: number) => void) | null = null;
    // Preview: show the fully-formed black hole (sun hidden) so it can be edited on the Black hole tab.
    let blackHolePreview = false;
    // Ring/skin meshes form AFTER the core — scale is base × form. The white ones form early (with the
    // sun disappearing), the main `ring` mesh forms late. `currentForm` is stored so an edit composes.
    // Which beat a black-hole mesh belongs to. Scaling these SEPARATELY (rather than the whole group) is
    // what lets the hole open from the middle while the disc assembles afterwards — scaling the group
    // inflated the accretion disc out of a point, which no real disc does.
    type BlackHolePhase = "horizon" | "early" | "late";
    interface MeshForm {
      id: string;
      mesh: THREE.Mesh;
      baseScale: THREE.Vector3;
      phase: BlackHolePhase;
      currentForm: number;
    }
    const ringForms: MeshForm[] = [];
    const ringFormById = new Map<string, MeshForm>();
    // Materials cloned for per-object editing — tracked so we can dispose them on teardown.
    const clonedMaterials: THREE.Material[] = [];

    // Place the whole fracture shards (root Groups) at a uniform spread along their outward directions.
    // The magma/inner meshes live inside them, so they part with their shard — the crack-open motion.
    const positionShardsAt = (spread: number) => {
      if (!registry) return;
      const { shards, radius } = registry.cellSpread;
      const distance = spread * radius;
      shards.forEach(({ object, basePosition, outward }) => {
        object.position.set(
          basePosition.x + outward.x * distance,
          basePosition.y + outward.y * distance,
          basePosition.z + outward.z * distance,
        );
      });
    };
    const applyShardSpread = () => positionShardsAt(fractureSpread);

    // The finale's version: the same uniform spread, plus a per-shard shudder. Each shard carries its own
    // phase so they fight out of step — in lockstep it reads as one mechanical pulse rather than a star
    // straining. Purely a function of `sequence`, so scrubbing back reproduces it exactly.
    const positionShardsWithTremor = (spread: number, tremor: number, sequence: number) => {
      if (!registry) return;
      const { shards, radius } = registry.cellSpread;
      shards.forEach(({ object, basePosition, outward }, index) => {
        const shudder =
          tremor === 0
            ? 0
            : Math.sin(sequence * TREMOR_FREQUENCY + index * TREMOR_PHASE_STEP) * tremor;
        const distance = (spread + shudder) * radius;
        object.position.set(
          basePosition.x + outward.x * distance,
          basePosition.y + outward.y * distance,
          basePosition.z + outward.z * distance,
        );
      });
    };

    // ── Flare spin ──
    // The flares are FLAT discs (thin in one axis), so "spinning in place" = turning about the disc's
    // NORMAL (its shortest dimension), like a coin flat on a table — not tumbling about an in-plane axis.
    const flareSpins: FlareSpin[] = [];
    const flareSpinById = new Map<string, FlareSpin>();
    let flareSpinSpeed = 0;
    const scratchSpinQuaternion = new THREE.Quaternion();

    // The disc's geometry centre is offset from the mesh origin, so spinning about the origin would
    // orbit. Recentre each flare's geometry on the origin (compensating the mesh position so nothing
    // moves visually), so the spin turns it perfectly in place. Runs BEFORE the registry captures
    // defaults, so the compensated position is what Reset returns to.
    const recenterFlareGeometry = (root: THREE.Object3D) => {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (!materials.some((material) => material.name === "flare")) return;
        // Clone so a shared geometry is never disturbed for other meshes.
        const geometry = object.geometry.clone();
        geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        geometry.boundingBox?.getCenter(center);
        // pos' = pos + R·(S·center) keeps every vertex in the same parent-space spot after recentring.
        const compensation = center.clone().multiply(object.scale).applyQuaternion(object.quaternion);
        object.position.add(compensation);
        geometry.translate(-center.x, -center.y, -center.z);
        object.geometry = geometry;
      });
    };

    const makeFlareSpin = (mesh: THREE.Mesh): FlareSpin => {
      mesh.geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      mesh.geometry.boundingBox?.getSize(size);
      // Shortest local dimension = the disc's normal — spin about that so it turns flat, in place.
      const axis =
        size.x <= size.y && size.x <= size.z
          ? new THREE.Vector3(1, 0, 0)
          : size.y <= size.z
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(0, 0, 1);
      return { mesh, axis, base: mesh.quaternion.clone(), angle: 0 };
    };

    const buildFlareSpins = () => {
      if (!registry) return;
      registry.entries
        .filter((entry) => entry.groupId === "flares")
        .forEach((entry) => {
          const spin = makeFlareSpin(entry.mesh);
          flareSpins.push(spin);
          flareSpinById.set(entry.id, spin);
        });
    };

    const setEnvIntensity = (intensity: number) => {
      if (!modelRoot) return;
      modelRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.envMapIntensity = intensity;
            material.needsUpdate = true;
          }
        });
      });
    };

    const fitCamera = () => {
      // Frame whatever is actually on screen. On the black hole tab the sun is hidden, so measuring it
      // would give a degenerate box and throw the camera somewhere useless.
      const fitTarget = blackHoleStandalone ? blackHoleGroup : modelRoot;
      if (!fitTarget) return;
      const box = new THREE.Box3().setFromObject(fitTarget);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fitDistance =
        (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5))) *
        CAMERA_FIT_MARGIN;
      const direction = new THREE.Vector3(0.6, 0.35, 1).normalize();
      camera.position.copy(sphere.center).addScaledVector(direction, fitDistance);
      camera.near = Math.max(fitDistance / 100, 0.01);
      camera.far = fitDistance * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(sphere.center);
      controls.update();
      coreLight.position.copy(sphere.center);
    };

    const applyRingForm = (horizonForm: number, earlyForm: number, lateForm: number) => {
      ringForms.forEach((ringForm) => {
        ringForm.currentForm =
          ringForm.phase === "horizon"
            ? horizonForm
            : ringForm.phase === "early"
              ? earlyForm
              : lateForm;
        ringForm.mesh.scale.set(
          ringForm.baseScale.x * ringForm.currentForm,
          ringForm.baseScale.y * ringForm.currentForm,
          ringForm.baseScale.z * ringForm.currentForm,
        );
      });
    };

    // Set the finale to a moment on its timeline:
    //   EXPLODE    — the sun bursts + fades, yellow sparks fly out
    //   REVEAL     — the dark core grows from the centre
    //   RING_FORM  — the rings/skin form AFTER the core, spiralling back in with the sparks
    // Preview (Black hole tab) shows the fully-formed hole with the sun gone, so it can be edited.
    // Off (not a finale stage, not preview) → black hole + sparks hidden, sun left to applyGlobal/form.
    const applyFinale = (sequence: number) => {
      currentSequence = sequence;
      // Declared up here because both the lensing envelope and the flash itself are timed against it.
      const hold = finaleFlash.hold;

      let explode: number;
      let horizonForm: number;

      if (blackHolePreview) {
        explode = 1;
        horizonForm = 1;
      } else if (!finaleEnabled) {
        blackHoleGroup.scale.setScalar(0);
        blackHoleHorizonForm = 0;
        particlePoints.visible = false;
        accretionPoints.visible = false;
        burstMesh.visible = false;
        renderer.toneMappingExposure = baseExposure;
        finaleLiquidRamp = 1; // off the finale, lensing is just the stage's authored look
        finaleSpinMultiplier = 1;
        // Hand the shards and the glow back to the stage exactly as it posed them.
        if (finaleOwnsShards) {
          finaleOwnsShards = false;
          applyShardSpread();
        }
        if (redshiftBaseEmissive) restoreRedshift();
        return;
      } else {
        explode = smoothstep(FINALE_EXPLODE[0], FINALE_EXPLODE[1], sequence);
        horizonForm = smoothstep(FINALE_HORIZON[0], FINALE_HORIZON[1], sequence);
      }

      // The sun collapses on an ACCELERATING curve, not a smoothstep. Smoothstep decelerates into its
      // end, which reads as a slider being dragged; gravity does the opposite — barely moves, then
      // plummets. Cubing `explode` is what makes the last of the star vanish fast.
      const collapse = explode * explode * explode;
      if (modelRoot) modelRoot.scale.setScalar(targetModelScale * (1 - collapse));

      // ── What the star DOES while it falls ──
      // 0. TREMOR — the anticipation beat. Builds over TREMOR_IN, then is swallowed by the collapse, so
      //    it hands over instead of fighting it. This is what stops the finale opening mid-thought.
      const tremorAmount =
        finaleCollapse.tremor *
        smoothstep(0, TREMOR_IN, sequence) *
        (1 - collapse);
      // 1. The shards are crushed inward past the stage's own spread, so the star implodes rather than
      //    merely getting smaller. Uses the model's real fracture geometry instead of a uniform scale.
      finaleOwnsShards = finaleCollapse.shards !== 0 || finaleCollapse.tremor !== 0;
      if (finaleOwnsShards) {
        positionShardsWithTremor(
          fractureSpread - finaleCollapse.shards * collapse,
          tremorAmount,
          sequence,
        );
      }
      // 2. Gravitational redshift — the glow loses energy climbing out of a deepening well.
      if (redshiftBaseEmissive && finaleCollapse.redshift > 0) {
        const magma = registry?.sharedMaterials.find((entry) => entry.name === REDSHIFT_MATERIAL);
        if (magma && magma.material instanceof THREE.MeshStandardMaterial) {
          scratchRedshift.set(finaleCollapse.redshiftColor);
          magma.material.emissive
            .copy(redshiftBaseEmissive)
            .lerp(scratchRedshift, finaleCollapse.redshift * collapse);
        }
      }
      // 3. Angular momentum — a contracting star spins up. Applied as a multiplier in the render loop,
      //    where the spin actually accumulates. The tremor adds a restless lift before the real wind-up.
      finaleSpinMultiplier =
        1 + (finaleCollapse.spinUp - 1) * collapse + TREMOR_SPIN_LIFT * tremorAmount;

      // The accretion spiral: the star's own matter, released and wound inward. Runs on the raw sequence
      // (not `explode`) because the particles have their own staggered release built in.
      const accretionActive = finaleEnabled && accretionSeeded && accretion.strength > 0;
      accretionPoints.visible = accretionActive && !blackHolePreview;
      if (accretionActive) {
        const uniforms = accretionMaterial.uniforms;
        uniforms.uSequence.value = sequence;
        uniforms.uStrength.value = accretion.strength;
        uniforms.uWind.value = accretion.wind;
        uniforms.uFlatten.value = accretion.flatten;
        uniforms.uTurbulence.value = accretion.turbulence;
        uniforms.uSize.value = accretion.size;
        uniforms.uInnerRadius.value = accretion.innerRadius;
        uniforms.uColorCool.value.set(accretion.colorCool);
        uniforms.uColorHot.value.set(accretion.colorHot);
      }
      // The GROUP stays at full size; the reveal happens per-mesh below. Scaling the group would inflate
      // the accretion disc out of a single point, which is not how a disc arrives.
      blackHoleGroup.scale.setScalar(blackHoleFitScale * blackHoleScale);
      // Horizon opens from the middle first; the disc assembles around it afterwards.
      const earlyForm = blackHolePreview
        ? 1
        : smoothstep(FINALE_RING_FORM_EARLY[0], FINALE_RING_FORM_EARLY[1], sequence);
      const lateForm = blackHolePreview
        ? 1
        : smoothstep(FINALE_RING_FORM_LATE[0], FINALE_RING_FORM_LATE[1], sequence);
      applyRingForm(horizonForm, earlyForm, lateForm);
      blackHoleHorizonForm = horizonForm;
      // The lensing envelope, which depends on what it is centred on:
      //   • sun       — reads as solid until the collapse starts pulling it apart, then flows.
      //   • blackhole — swells in while the screen is held bright (the hole forming inside the glare),
      //                 then drains to zero as that brightness leaves, settling to a plain black hole.
      if (blackHolePreview) {
        finaleLiquidRamp = 1;
      } else if (lensing.target === "sun") {
        finaleLiquidRamp = smoothstep(FINALE_LIQUID_RAMP[0], FINALE_LIQUID_RAMP[1], sequence);
      } else {
        const swellIn = smoothstep(
          finaleFlash.at,
          finaleFlash.at + hold * FINALE_LIQUID_IN_FRACTION,
          sequence,
        );
        const drainOut =
          1 -
          smoothstep(
            finaleFlash.at + hold,
            finaleFlash.at + hold + FLASH_SCREEN_DECAY,
            sequence,
          );
        finaleLiquidRamp = swellIn * drainOut;
      }
      // Keep the scene fully glowy — the glow simply LEAVES with the sun (its emissive body is gone) and
      // its core light is sucked in too. Only the bloom eases down to the black-hole value as it forms.
      // The core swells while the star strains, then is sucked in with the rest of it.
      coreLight.intensity =
        baseCoreLightIntensity * (1 - explode) * (1 + TREMOR_GLOW_SWELL * tremorAmount);
      const gradedBloom = THREE.MathUtils.lerp(
        baseBloomStrength,
        BLACKHOLE_BLOOM_STRENGTH,
        horizonForm,
      );

      // ── The flash ──
      // Stage 1: the core burst, an actual light source at the origin (there is nothing else bright left
      // in frame by now — see lib/burstShader.ts). Stage 2: the screen grade, lagging slightly and lasting
      // longer, so the eye is overwhelmed a beat after the light arrives.
      const flashStrength = finaleFlash.strength * flashDamping;
      // The detonation itself: holds only briefly, then clears so it isn't standing in front of what it
      // just revealed.
      const corePulse = blackHolePreview
        ? 0
        : flashEnvelope(
            sequence,
            finaleFlash.at,
            FLASH_ATTACK,
            hold * FLASH_CORE_HOLD_FRACTION,
            FLASH_CORE_DECAY,
          );
      // The screen stays flooded across the whole hold — this plateau is the window the hole forms in.
      const screenPulse = blackHolePreview
        ? 0
        : flashEnvelope(
            sequence,
            finaleFlash.at + FLASH_SCREEN_LAG,
            FLASH_SCREEN_ATTACK,
            hold,
            FLASH_SCREEN_DECAY,
          );

      burstMesh.visible = flashStrength > 0 && corePulse > 0;
      if (burstMesh.visible) {
        // Expansion is monotonic across the whole pulse, while brightness rises then falls — so the light
        // keeps travelling outward as it dies, instead of shrinking back into itself.
        const expand = smoothstep(
          finaleFlash.at - FLASH_ATTACK,
          finaleFlash.at + hold * FLASH_CORE_HOLD_FRACTION + FLASH_CORE_DECAY,
          sequence,
        );
        const size = THREE.MathUtils.lerp(FLASH_SCALE_FROM, FLASH_SCALE_TO, expand) * sunRadius;
        burstMesh.scale.setScalar(size);
        burstMesh.position.copy(blackHoleGroup.position);
        burstMaterial.uniforms.uIntensity.value = corePulse * flashStrength;
        burstMaterial.uniforms.uColor.value.set(finaleFlash.color);
      }

      renderer.toneMappingExposure =
        baseExposure + screenPulse * flashStrength * FLASH_EXPOSURE_BOOST;
      bloomPass.strength = gradedBloom + screenPulse * flashStrength * FLASH_BLOOM_BOOST;

      // Particles are off for now (the sun-shrink + black-hole reveal reads cleaner without them).
      particlePoints.visible = false;
    };

    const handle: SunLabSceneHandle = {
      // Filled in once the model loads; the getters below read the live registries.
      get registry() {
        return registry as SunLabRegistry;
      },
      get blackHoleRegistry() {
        return blackHoleRegistry;
      },
      applyGlobal: (global) => {
        if (modelRoot) {
          modelRoot.scale.setScalar(global.modelScale);
          setEulerFromDegrees(modelRoot.rotation, global.rotation);
        }
        autoRotateSpeed = global.autoRotateSpeed;
        // When the drill is switched off, return every flare to its posed rotation (not a random angle).
        const previousFlareSpinSpeed = flareSpinSpeed;
        flareSpinSpeed = global.flareSpinSpeed;
        if (flareSpinSpeed === 0 && previousFlareSpinSpeed !== 0) {
          flareSpins.forEach((spin) => {
            spin.angle = 0;
            spin.mesh.quaternion.copy(spin.base);
          });
        }
        const previousFracturePulse = fracturePulse;
        fracturePulse = global.fracturePulse;
        fracturePulseSpeed = global.fracturePulseSpeed;
        // Turning the breathing off returns the shards to their static spread rather than a mid-pulse spot.
        if (fracturePulse === 0 && previousFracturePulse !== 0) applyShardSpread();
        formDuration = global.formDuration;
        formFromSpread = global.formFromSpread;
        formEasing = global.formEasing;
        formFromScale = global.formFromScale;
        targetModelScale = global.modelScale;
        // Finale knobs — the actual reveal is applied by applyFinale (called by React after this).
        finaleEnabled = global.finaleEnabled;
        blackHoleScale = global.blackHoleScale;
        blackHoleSpinSpeed = global.blackHoleSpinSpeed;
        blackHoleGroup.position.set(
          global.blackHolePosition.x,
          global.blackHolePosition.y,
          global.blackHolePosition.z,
        );
        baseCoreLightIntensity = global.coreLight.intensity;
        baseBloomStrength = global.bloom.strength;
        lensing = global.lensing;
        accretion = global.accretion;
        finaleFlash = global.finaleFlash;
        finaleCollapse = global.finaleCollapse;
        baseExposure = global.exposure;
        renderer.toneMappingExposure = global.exposure;
        coreLight.color.set(global.coreLight.color);
        coreLight.intensity = global.coreLight.intensity;
        coreLight.distance = global.coreLight.distance;
        bloomPass.strength = global.bloom.strength;
        bloomPass.radius = global.bloom.radius;
        bloomPass.threshold = global.bloom.threshold;
        keyLight.color.set(global.key.color);
        keyLight.intensity = global.key.intensity;
        fillLight.color.set(global.fill.color);
        fillLight.intensity = global.fill.intensity;
        ambientLight.color.set(global.ambient.color);
        ambientLight.intensity = global.ambient.intensity;
        camera.fov = global.camera.fov;
        camera.updateProjectionMatrix();
        setEnvIntensity(global.envIntensity);
        scene.background = global.background.transparent
          ? null
          : new THREE.Color(global.background.color);
      },
      applyObjectTransform: (id, resolved) => {
        const entry = findEntry(id);
        if (!entry) return;
        entry.mesh.visible = resolved.visible;
        entry.mesh.position.set(resolved.position.x, resolved.position.y, resolved.position.z);
        setEulerFromDegrees(entry.mesh.rotation, resolved.rotation);
        entry.mesh.scale.set(resolved.scale.x, resolved.scale.y, resolved.scale.z);
        // A flare's posed rotation is the base the drill spins on top of — keep it in sync with edits.
        const flareSpin = flareSpinById.get(id);
        if (flareSpin) flareSpin.base.copy(entry.mesh.quaternion);
        // A black-hole ring's scale is base × its own form factor — keep base in sync, re-apply the form.
        const ringForm = ringFormById.get(id);
        if (ringForm) {
          ringForm.baseScale.set(resolved.scale.x, resolved.scale.y, resolved.scale.z);
          entry.mesh.scale.set(
            resolved.scale.x * ringForm.currentForm,
            resolved.scale.y * ringForm.currentForm,
            resolved.scale.z * ringForm.currentForm,
          );
        }
      },
      applyObjectMaterial: (id, slot, params) => {
        const entry = findEntry(id);
        if (!entry || !entry.materialSlots[slot]) return;
        // Clone on first per-object edit so recolouring one shard never bleeds into its siblings.
        if (!entry.slotCloned[slot]) {
          const clone = entry.materialSlots[slot].clone();
          entry.materialSlots[slot] = clone;
          entry.slotCloned[slot] = true;
          clonedMaterials.push(clone);
          if (Array.isArray(entry.mesh.material)) {
            entry.mesh.material[slot] = clone;
          } else {
            entry.mesh.material = clone;
          }
        }
        applyMaterialParams(entry.materialSlots[slot], params);
      },
      setObjectMaterialToShared: (id, slot) => {
        const entry = findEntry(id);
        if (!entry || !entry.slotCloned[slot]) return;
        const shared = entry.sharedSlots[slot];
        entry.materialSlots[slot] = shared;
        entry.slotCloned[slot] = false;
        if (Array.isArray(entry.mesh.material)) entry.mesh.material[slot] = shared;
        else entry.mesh.material = shared;
      },
      applySharedMaterial: (name, params) => {
        const shared =
          registry?.sharedMaterials.find((entry) => entry.name === name) ??
          blackHoleRegistry?.sharedMaterials.find((entry) => entry.name === name);
        if (shared) applyMaterialParams(shared.material, params);
        // Re-read the redshift base AFTER writing, so an edit mid-finale re-anchors the tint to the new
        // authored colour instead of baking the current tinted value in as the new baseline.
        if (name === REDSHIFT_MATERIAL) captureRedshiftBase();
      },
      applyFractureSpread: (amount) => {
        fractureSpread = amount;
        if (!formActive) applyShardSpread();
      },
      playFormAnimation: () => {
        formProgress = 0;
        formActive = true;
        // Snap to the start pose immediately so there's no flash of the target state before it forms.
        positionShardsAt(formFromSpread);
        if (modelRoot) modelRoot.scale.setScalar(formFromScale);
      },
      fitCamera,
      addDuplicate: (sourceId, newId) => {
        const source = registry?.entriesById.get(sourceId);
        if (!registry || !source) return;
        // Mesh.clone() shares geometry + material (so shared-material edits still reach it until it's
        // edited per-object), and copies the transform. Nudge it off its source so the copy is visibly a
        // separate object (this becomes its captured default, in every stage) rather than hidden behind it.
        const newMesh = source.mesh.clone();
        newMesh.position.x += 0.2;
        newMesh.position.y += 0.12;
        source.mesh.parent?.add(newMesh);
        const entry = addDuplicateEntry(registry, source, newMesh, newId);
        if (entry.groupId === "flares") {
          const spin = makeFlareSpin(newMesh);
          flareSpins.push(spin);
          flareSpinById.set(newId, spin);
        }
      },
      removeObject: (id) => {
        if (!registry) return;
        const entry = removeRegistryEntry(registry, id);
        if (!entry) return;
        entry.mesh.parent?.remove(entry.mesh);
        // Geometry + material are shared with the source, so don't dispose them here.
        const spinIndex = flareSpins.findIndex((spin) => spin.mesh === entry.mesh);
        if (spinIndex >= 0) flareSpins.splice(spinIndex, 1);
        flareSpinById.delete(id);
      },
      applyFinale,
      playSequence: (durationSeconds, onSequence) => {
        sequencePlayDuration = Math.max(durationSeconds, 0.1);
        sequencePlayProgress = 0;
        sequencePlayActive = true;
        sequenceReporter = onSequence ?? null;
        applyFinale(0);
        sequenceReporter?.(0);
      },
      setBlackHolePreview: (enabled) => {
        blackHolePreview = enabled;
        applyFinale(currentSequence);
      },
      showBlackHoleStandalone: (settings) => {
        blackHoleStandalone = true;
        // Scene grade (its own, not the sun's).
        renderer.toneMappingExposure = settings.exposure;
        bloomPass.strength = settings.bloom.strength;
        bloomPass.radius = settings.bloom.radius;
        bloomPass.threshold = settings.bloom.threshold;
        keyLight.color.set(settings.key.color);
        keyLight.intensity = settings.key.intensity;
        fillLight.color.set(settings.fill.color);
        fillLight.intensity = settings.fill.intensity;
        ambientLight.color.set(settings.ambient.color);
        ambientLight.intensity = settings.ambient.intensity;
        // Kill the sun's core point light — it sits at the origin and was flooding the black hole from
        // its centre (the "sun is still there" glow). The black hole is lit only by key/fill/ambient here.
        coreLight.intensity = 0;
        scene.background = settings.background.transparent
          ? null
          : new THREE.Color(settings.background.color);
        camera.fov = settings.cameraFov;
        camera.updateProjectionMatrix();
        setBlackHoleEnvIntensity(settings.envIntensity);
        // Sun fully OUT of the frame — `visible = false` rather than scale 0, so it isn't drawn at all
        // and can't be picked up by a bounding-box measurement.
        if (modelRoot) modelRoot.visible = false;
        particlePoints.visible = false;
        burstMesh.visible = false; // this tab shows the settled hole, not the moment it formed
        // A half-scrubbed finale leaves the rings on a partial form multiplier. Clear it, or every scale
        // this tab reports and writes is silently multiplied by a leftover from the other tab.
        applyRingForm(1, 1, 1);
        blackHoleHorizonForm = 1; // fully formed on this tab
        blackHoleGroup.scale.setScalar(blackHoleFitScale * settings.scale);
        blackHoleGroup.position.set(settings.position.x, settings.position.y, settings.position.z);
        setEulerFromDegrees(blackHoleGroup.rotation, settings.rotation);
        blackHoleStandaloneSpinAxis = settings.spinAxis;
        blackHoleStandaloneSpinSpeed = settings.spinSpeed;
        lensing = settings.lensing;
      },
      exitBlackHoleStandalone: () => {
        blackHoleStandalone = false;
        blackHoleGroup.rotation.set(0, 0, 0);
        blackHoleSpinner.rotation.set(0, 0, 0);
        // Hand the sun back; the caller's applyGlobal re-establishes its scale.
        if (modelRoot) modelRoot.visible = true;
      },
    };

    // ── Load ──
    onStatusRef.current({ isLoading: true, percent: -1 });
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      MODEL_PATH,
      (gltf) => {
        if (disposed) return;
        modelRoot = gltf.scene;

        // The magma material ships an emissive TEXTURE but no emissive factor, so by the glTF spec it
        // renders dead-black. Prime it to white BEFORE we capture defaults, so the sun glows out of the
        // box and Reset returns to the glowing state — not the dark one.
        modelRoot.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (
              material instanceof THREE.MeshStandardMaterial &&
              material.emissiveMap &&
              material.emissive.getHex() === 0x000000
            ) {
              material.emissive.setHex(0xffffff);
            }
          });
        });

        // Recentre the flat flares BEFORE the registry snapshots their (now compensated) positions.
        recenterFlareGeometry(modelRoot);
        spinner.add(modelRoot);
        registry = buildSunLabRegistry(modelRoot);
        buildFlareSpins();

        // Apply the tool's defaults so the first frame already looks right, then fit + hand off.
        // Re-measure first: the canvas is laid out by now, so the aspect fitCamera reads is correct.
        resize();
        handle.applyGlobal(DEFAULT_GLOBAL_PARAMS);
        fitCamera();

        // Base sun radius (at scale 1) — used to fit the black hole and scale the spark burst.
        const sunBox = new THREE.Box3().setFromObject(modelRoot);
        sunRadius = sunBox.getBoundingSphere(new THREE.Sphere()).radius || 1;
        seedParticles();
        seedAccretion();

        onStatusRef.current({ isLoading: false, percent: 100 });
        onReadyRef.current(handle);

        // Load the black hole too — centred at the sun's core, fit to its size, hidden until the finale.
        gltfLoader.load(
          BLACKHOLE_MODEL_PATH,
          (blackHoleGltf) => {
            if (disposed) return;
            const blackHoleModel = blackHoleGltf.scene;
            // The model arrives correct — the ONLY thing forced here is killing the event horizon's
            // specular (see BLACK_HOLE_HORIZON_MATERIALS). Runs before the registry captures defaults, so
            // a black hole that can't be lit is what "Reset" returns to.
            blackHoleModel.traverse((object) => {
              if (!(object instanceof THREE.Mesh)) return;
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              materials.forEach((material) => {
                if (!(material instanceof THREE.MeshPhysicalMaterial)) return;
                if (!BLACK_HOLE_HORIZON_MATERIALS.includes(material.name)) return;
                material.specularIntensity = 0;
                material.needsUpdate = true;
              });
            });
            blackHoleModel.updateMatrixWorld(true);
            // Measure the horizon alone, while the model is still unparented (so world == local) — the
            // lensing shadow edge must sit on the black sphere, not on the far larger ring span. A later
            // recentre only translates it, which leaves the radius correct.
            const horizonBox = new THREE.Box3();
            blackHoleModel.traverse((object) => {
              if (!(object instanceof THREE.Mesh)) return;
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              if (!materials.some((material) => BLACK_HOLE_HORIZON_MATERIALS.includes(material.name))) {
                return;
              }
              horizonBox.expandByObject(object);
            });
            if (!horizonBox.isEmpty()) {
              blackHoleHorizonRadius = horizonBox.getBoundingSphere(new THREE.Sphere()).radius || 1;
            }
            // Centre + fit on the BLACK HOLE itself (node "black hole"), so the tiny off-centre Planet
            // doesn't skew where it sits or how big it reads. Fall back to the whole model if absent.
            const focusNode = blackHoleModel.getObjectByName("black hole") ?? blackHoleModel;
            focusNode.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(focusNode);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const radius = Math.max(size.x, size.y, size.z) / 2 || 1;
            // Rendered EXACTLY as authored — no material changes.
            blackHoleModel.position.sub(center); // centre the black hole on the group origin (= sun centre)
            blackHoleSpinner.add(blackHoleModel);
            blackHoleFitScale = (sunRadius * BLACKHOLE_TARGET_FACTOR) / radius;
            blackHoleLoaded = true;
            // Build its editable registry (its own tab) and tell React to show it + apply saved edits.
            blackHoleRegistry = buildBlackHoleRegistry(blackHoleModel);
            // Rings + glow form AFTER the core (only used by the finale); collect them so it can scale
            // from 0. The main `ring` mesh forms LATE, every other ring/glow forms EARLY.
            blackHoleRegistry.entries.forEach((entry) => {
              // The horizon opens first, then the glow + secondary rings, then the main ring completes it.
              // Planet is excluded — it isn't part of the black hole and is hidden by the base state.
              const phase: BlackHolePhase | null =
                entry.groupId === "horizon"
                  ? "horizon"
                  : entry.groupId === "rings" || entry.groupId === "glow"
                    ? entry.materialSlots.some((material) => material.name === "ring")
                      ? "late"
                      : "early"
                    : null;
              if (!phase) return;
              const ringForm: MeshForm = {
                id: entry.id,
                mesh: entry.mesh,
                baseScale: entry.mesh.scale.clone(),
                phase,
                currentForm: 1,
              };
              ringForms.push(ringForm);
              ringFormById.set(entry.id, ringForm);
            });
            applyFinale(currentSequence); // reflect the current moment now that it exists
            onBlackHoleReadyRef.current();
          },
          undefined,
          (error) => console.error("[sun-lab] failed to load black hole", error),
        );
      },
      (event) => {
        if (disposed || !event.lengthComputable) return;
        onStatusRef.current({
          isLoading: true,
          percent: Math.round((event.loaded / event.total) * 100),
        });
      },
      (error) => {
        console.error("[sun-lab] failed to load model", error);
        if (!disposed) onStatusRef.current({ isLoading: false, percent: -1, error: true });
      },
    );

    // ── Render loop ──
    const clock = new THREE.Clock();
    let animationFrame = 0;
    const renderFrame = () => {
      const delta = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);
      // Both spins carry the finale's spin-up multiplier — the star winds up as it contracts.
      if (autoRotateSpeed !== 0) {
        spinner.rotation.y +=
          THREE.MathUtils.degToRad(autoRotateSpeed * finaleSpinMultiplier) * delta;
      }
      if (flareSpinSpeed !== 0) {
        const deltaAngle =
          THREE.MathUtils.degToRad(flareSpinSpeed * finaleSpinMultiplier) * delta;
        flareSpins.forEach((spin) => {
          spin.angle += deltaAngle;
          scratchSpinQuaternion.setFromAxisAngle(spin.axis, spin.angle);
          spin.mesh.quaternion.copy(spin.base).multiply(scratchSpinQuaternion);
        });
      }
      // Form-on-enter: ramp the spread from its start to the stage's target once. Eased out so it opens
      // fast then settles. Takes priority over the breathing until it finishes.
      if (formActive && registry) {
        formProgress += delta / Math.max(formDuration, 0.001);
        const t = Math.min(formProgress, 1);
        // "in" accelerates (gravity/collapse), "out" opens then settles, "inout" does both.
        const eased =
          formEasing === "in"
            ? t * t * t
            : formEasing === "inout"
              ? t < 0.5
                ? 4 * t * t * t
                : 1 - Math.pow(-2 * t + 2, 3) / 2
              : 1 - Math.pow(1 - t, 3);
        positionShardsAt(formFromSpread + (fractureSpread - formFromSpread) * eased);
        // Shrink (or grow) the whole sun across the same ramp — so a collapse visibly gets denser.
        if (modelRoot) modelRoot.scale.setScalar(formFromScale + (targetModelScale - formFromScale) * eased);
        if (formProgress >= 1) {
          formActive = false;
          fracturePulseTime = 0; // breathing resumes cleanly from the fully-formed (open) pose
        }
        // While the finale is crushing the shards it owns their positions — breathing would fight it
        // every frame and the crush would stutter.
      } else if (fracturePulse !== 0 && registry && !finaleOwnsShards) {
        // Cracks breathing: tug each shard toward centre along its own outward line — so the motion is
        // always radial (gravity-like), never up or sideways. Overrides the static spread while running.
        fracturePulseTime += delta;
        const { shards, radius } = registry.cellSpread;
        shards.forEach(({ object, basePosition, outward }, index) => {
          const phase = TWO_PI * fracturePulseSpeed * fracturePulseTime + index * FRACTURE_PHASE_STEP;
          // 0 (fully open, at the base spread) → fracturePulse (pulled that much toward centre).
          const inward = fracturePulse * (0.5 - 0.5 * Math.cos(phase));
          const distance = (fractureSpread - inward) * radius;
          object.position.set(
            basePosition.x + outward.x * distance,
            basePosition.y + outward.y * distance,
            basePosition.z + outward.z * distance,
          );
        });
      }
      // Finale playback — ramp the sequence 0→1 once.
      if (sequencePlayActive) {
        sequencePlayProgress += delta / sequencePlayDuration;
        const played = Math.min(sequencePlayProgress, 1);
        applyFinale(played);
        sequenceReporter?.(played);
        if (sequencePlayProgress >= 1) {
          sequencePlayActive = false;
          sequenceReporter = null;
        }
      }
      // Standalone (New black hole tab): spin about the chosen axis.
      if (blackHoleStandalone && blackHoleLoaded && blackHoleStandaloneSpinSpeed !== 0) {
        const axis = blackHoleStandaloneSpinAxis === 0 ? "x" : blackHoleStandaloneSpinAxis === 2 ? "z" : "y";
        blackHoleSpinner.rotation[axis] += THREE.MathUtils.degToRad(blackHoleStandaloneSpinSpeed) * delta;
      }
      // Finale idle spin (only while the sun→black-hole finale is running, not standalone/preview).
      if (!blackHoleStandalone && !blackHolePreview && finaleEnabled && blackHoleLoaded && blackHoleGroup.scale.x > 0.0001) {
        blackHoleSpinner.rotation.y += THREE.MathUtils.degToRad(blackHoleSpinSpeed) * delta;
      }
      controls.update();
      // Billboard the burst — it represents light reaching the lens, so it must always face the camera
      // rather than presenting an edge as you orbit.
      if (burstMesh.visible) burstMesh.quaternion.copy(camera.quaternion);
      // After controls.update() so the lensing centre is measured against the camera actually being
      // rendered this frame, not last frame's.
      lensingTime += delta;
      updateLensing();
      // Shimmer only — the spiral's STRUCTURE is a function of the sequence, so scrubbing stays exact.
      accretionMaterial.uniforms.uTime.value = lensingTime;
      composer.render();
      animationFrame = requestAnimationFrame(renderFrame);
    };
    renderFrame();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      controls.dispose();
      if (modelRoot) {
        modelRoot.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        });
      }
      blackHoleGroup.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      particleGeometry.dispose();
      particleMaterial.dispose();
      accretionGeometry.dispose();
      accretionMaterial.dispose();
      burstMesh.geometry.dispose();
      burstMaterial.dispose();
      clonedMaterials.forEach((material) => material.dispose());
      environmentTexture.dispose();
      pmrem.dispose();
      composer.dispose();
      bloomPass.dispose();
      lensingPass.dispose();
      dracoLoader.dispose();
      renderer.dispose();
    };
    // Built once; the callbacks are read through refs so they never trigger a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);
}
