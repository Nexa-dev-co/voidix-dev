import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
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
const BLACKHOLE_MODEL_PATH = "/models/blackhole.glb";
const DRACO_DECODER_PATH = "/draco/";
// The finale, mapped to the sequence 0→1: the sun shrinks + gets sucked in over EXPLODE (its glow goes
// with it), the black hole grows from the centre over REVEAL. Black hole is fit to ~this many sun-radii.
const FINALE_EXPLODE: [number, number] = [0.2, 0.55]; // sun sucked in, finishing as the core completes
const FINALE_REVEAL: [number, number] = [0.25, 0.55]; // the dark core grows
// The white rings + skin form EARLY (as the sun disappears); the `Blackhole_ring` mesh forms LATER.
const FINALE_RING_FORM_EARLY: [number, number] = [0.22, 0.52];
const FINALE_RING_FORM_LATE: [number, number] = [0.52, 0.92];
const BLACKHOLE_TARGET_FACTOR = 1.3;
// Bloom settles to this as the black hole forms (only the bloom — exposure + lights stay glowy).
const BLACKHOLE_BLOOM_STRENGTH = 0.44;
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
  /** Play the finale once, ramping the sequence 0→1 over the given seconds. */
  playSequence: (durationSeconds: number) => void;
  /** Show the fully-formed black hole (sun hidden) so it can be edited on the Black hole tab. */
  setBlackHolePreview: (enabled: boolean) => void;
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
    const blackHoleGroup = new THREE.Group();
    blackHoleGroup.scale.setScalar(0); // hidden until the reveal
    scene.add(blackHoleGroup);
    let blackHoleFitScale = 1;
    let blackHoleLoaded = false;
    // Pure unlit black for the event horizon — no lighting, no env reflection, tone-map can't lift 0.
    // Named so it still groups under "Core / Horizon" and is editable in the black-hole tab.
    const blackHoleCoreMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, name: "Blackhole_core" });
    // The stage's authored (super-glowy) grade — what the finale blends FROM toward the black-hole grade.
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
    // Preview: show the fully-formed black hole (sun hidden) so it can be edited on the Black hole tab.
    let blackHolePreview = false;
    // Ring/skin meshes form AFTER the core — scale is base × form. The white ones form early (with the
    // sun disappearing), the `Blackhole_ring` mesh forms late. `currentForm` is stored so an edit composes.
    interface RingForm {
      id: string;
      mesh: THREE.Mesh;
      baseScale: THREE.Vector3;
      early: boolean;
      currentForm: number;
    }
    const ringForms: RingForm[] = [];
    const ringFormById = new Map<string, RingForm>();
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
      if (!modelRoot) return;
      const box = new THREE.Box3().setFromObject(modelRoot);
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

    const applyRingForm = (earlyForm: number, lateForm: number) => {
      ringForms.forEach((ringForm) => {
        ringForm.currentForm = ringForm.early ? earlyForm : lateForm;
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

      let explode: number;
      let reveal: number;

      if (blackHolePreview) {
        explode = 1;
        reveal = 1;
      } else if (!finaleEnabled) {
        blackHoleGroup.scale.setScalar(0);
        particlePoints.visible = false;
        return;
      } else {
        explode = smoothstep(FINALE_EXPLODE[0], FINALE_EXPLODE[1], sequence);
        reveal = smoothstep(FINALE_REVEAL[0], FINALE_REVEAL[1], sequence);
      }

      // The sun shrinks to nothing (sucked into the hole); the black hole grows in its place.
      if (modelRoot) modelRoot.scale.setScalar(targetModelScale * (1 - explode));
      blackHoleGroup.scale.setScalar(blackHoleFitScale * blackHoleScale * reveal);
      // White rings/skin form early (as the sun goes); the Blackhole_ring mesh forms later.
      const earlyForm = blackHolePreview
        ? 1
        : smoothstep(FINALE_RING_FORM_EARLY[0], FINALE_RING_FORM_EARLY[1], sequence);
      const lateForm = blackHolePreview
        ? 1
        : smoothstep(FINALE_RING_FORM_LATE[0], FINALE_RING_FORM_LATE[1], sequence);
      applyRingForm(earlyForm, lateForm);
      // Keep the scene fully glowy — the glow simply LEAVES with the sun (its emissive body is gone) and
      // its core light is sucked in too. Only the bloom eases down to the black-hole value as it forms.
      coreLight.intensity = baseCoreLightIntensity * (1 - explode);
      bloomPass.strength = THREE.MathUtils.lerp(baseBloomStrength, BLACKHOLE_BLOOM_STRENGTH, reveal);

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
      playSequence: (durationSeconds) => {
        sequencePlayDuration = Math.max(durationSeconds, 0.1);
        sequencePlayProgress = 0;
        sequencePlayActive = true;
        applyFinale(0);
      },
      setBlackHolePreview: (enabled) => {
        blackHolePreview = enabled;
        applyFinale(currentSequence);
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

        onStatusRef.current({ isLoading: false, percent: 100 });
        onReadyRef.current(handle);

        // Load the black hole too — centred at the sun's core, fit to its size, hidden until the finale.
        gltfLoader.load(
          BLACKHOLE_MODEL_PATH,
          (blackHoleGltf) => {
            if (disposed) return;
            const blackHoleModel = blackHoleGltf.scene;
            blackHoleModel.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(blackHoleModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const radius = Math.max(size.x, size.y, size.z) / 2 || 1;
            // The event horizon must read PURE BLACK — swap the core material for unlit black so no
            // light, reflection or exposure can lift it. The emissive rings/skin keep glowing.
            blackHoleModel.traverse((object) => {
              if (!(object instanceof THREE.Mesh)) return;
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              const isCore = materials.some((material) => material.name === "Blackhole_core");
              if (isCore) object.material = blackHoleCoreMaterial;
            });
            blackHoleModel.position.sub(center); // centre it on the group origin (= sun centre)
            blackHoleGroup.add(blackHoleModel);
            blackHoleFitScale = (sunRadius * BLACKHOLE_TARGET_FACTOR) / radius;
            blackHoleLoaded = true;
            // Build its editable registry (its own tab) and tell React to show it + apply saved edits.
            blackHoleRegistry = buildBlackHoleRegistry(blackHoleModel);
            // The rings + skin form AFTER the core — collect them so the finale can scale them from 0.
            // The one mesh using the `Blackhole_ring` material forms LATE; every other ring/skin (the
            // white ones) forms EARLY, as the sun disappears.
            blackHoleRegistry.entries.forEach((entry) => {
              if (entry.groupId !== "rings" && entry.groupId !== "skin") return;
              const isLateRing = entry.materialSlots.some(
                (material) => material.name === "Blackhole_ring",
              );
              const ringForm: RingForm = {
                id: entry.id,
                mesh: entry.mesh,
                baseScale: entry.mesh.scale.clone(),
                early: !isLateRing,
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
      if (autoRotateSpeed !== 0) {
        spinner.rotation.y += THREE.MathUtils.degToRad(autoRotateSpeed) * delta;
      }
      if (flareSpinSpeed !== 0) {
        const deltaAngle = THREE.MathUtils.degToRad(flareSpinSpeed) * delta;
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
      } else if (fracturePulse !== 0 && registry) {
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
        applyFinale(Math.min(sequencePlayProgress, 1));
        if (sequencePlayProgress >= 1) sequencePlayActive = false;
      }
      // Black hole idle spin, once it's revealed.
      if (finaleEnabled && blackHoleLoaded && blackHoleGroup.scale.x > 0.0001) {
        blackHoleGroup.rotation.y += THREE.MathUtils.degToRad(blackHoleSpinSpeed) * delta;
      }
      controls.update();
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
      blackHoleCoreMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      clonedMaterials.forEach((material) => material.dispose());
      environmentTexture.dispose();
      pmrem.dispose();
      composer.dispose();
      bloomPass.dispose();
      dracoLoader.dispose();
      renderer.dispose();
    };
    // Built once; the callbacks are read through refs so they never trigger a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);
}
