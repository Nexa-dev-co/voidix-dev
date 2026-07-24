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
  applyMaterialParams,
  type SunLabRegistry,
} from "../sunLabModel";
import {
  DEFAULT_GLOBAL_PARAMS,
  type GlobalParams,
  type MaterialParams,
  type Vector3Values,
} from "../sunLabState";

// The Sun Lab scene. Loads fractured_sun.glb exactly as authored (never flattened — its two coordinate
// frames are intentional), lights + blooms it, and hands React an IMPERATIVE handle so slider drags
// mutate the 47 MB model in place instead of rebuilding it. React owns the values; this owns the scene.

const MODEL_PATH = "/models/fractured_sun.glb";
const DRACO_DECODER_PATH = "/draco/";
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
}

interface UseSunLabSceneArguments {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onReady: (handle: SunLabSceneHandle) => void;
  onStatus: (status: SunLabStatus) => void;
}

function setEulerFromDegrees(euler: THREE.Euler, degrees: Vector3Values): void {
  euler.set(
    THREE.MathUtils.degToRad(degrees.x),
    THREE.MathUtils.degToRad(degrees.y),
    THREE.MathUtils.degToRad(degrees.z),
  );
}

export function useSunLabScene({ canvasRef, onReady, onStatus }: UseSunLabSceneArguments): void {
  // Keep the latest callbacks without re-running the (heavy) setup effect.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

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

    const buildFlareSpins = () => {
      if (!registry) return;
      registry.entries
        .filter((entry) => entry.groupId === "flares")
        .forEach((entry) => {
          entry.mesh.geometry.computeBoundingBox();
          const size = new THREE.Vector3();
          entry.mesh.geometry.boundingBox?.getSize(size);
          // Shortest local dimension = the disc's normal — spin about that so it turns flat, in place.
          const axis =
            size.x <= size.y && size.x <= size.z
              ? new THREE.Vector3(1, 0, 0)
              : size.y <= size.z
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);
          const spin: FlareSpin = {
            mesh: entry.mesh,
            axis,
            base: entry.mesh.quaternion.clone(),
            angle: 0,
          };
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

    const handle: SunLabSceneHandle = {
      // Filled in once the model loads; the getters below read the live registry.
      get registry() {
        return registry as SunLabRegistry;
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
        const entry = registry?.entriesById.get(id);
        if (!entry) return;
        entry.mesh.visible = resolved.visible;
        entry.mesh.position.set(resolved.position.x, resolved.position.y, resolved.position.z);
        setEulerFromDegrees(entry.mesh.rotation, resolved.rotation);
        entry.mesh.scale.set(resolved.scale.x, resolved.scale.y, resolved.scale.z);
        // A flare's posed rotation is the base the drill spins on top of — keep it in sync with edits.
        const flareSpin = flareSpinById.get(id);
        if (flareSpin) flareSpin.base.copy(entry.mesh.quaternion);
      },
      applyObjectMaterial: (id, slot, params) => {
        const entry = registry?.entriesById.get(id);
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
        const entry = registry?.entriesById.get(id);
        if (!entry || !entry.slotCloned[slot]) return;
        const shared = entry.sharedSlots[slot];
        entry.materialSlots[slot] = shared;
        entry.slotCloned[slot] = false;
        if (Array.isArray(entry.mesh.material)) entry.mesh.material[slot] = shared;
        else entry.mesh.material = shared;
      },
      applySharedMaterial: (name, params) => {
        const shared = registry?.sharedMaterials.find((entry) => entry.name === name);
        if (shared) applyMaterialParams(shared.material, params);
      },
      applyFractureSpread: (amount) => {
        fractureSpread = amount;
        if (!formActive) applyShardSpread();
      },
      playFormAnimation: () => {
        formProgress = 0;
        formActive = true;
        // Snap to the start pose immediately so there's no flash of the open state before it forms.
        positionShardsAt(formFromSpread);
      },
      fitCamera,
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

        onStatusRef.current({ isLoading: false, percent: 100 });
        onReadyRef.current(handle);
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
        const eased = 1 - Math.pow(1 - t, 3);
        positionShardsAt(formFromSpread + (fractureSpread - formFromSpread) * eased);
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
