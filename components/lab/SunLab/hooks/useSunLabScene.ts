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
    // Materials cloned for per-object editing — tracked so we can dispose them on teardown.
    const clonedMaterials: THREE.Material[] = [];

    // Move the whole fracture shards (root Groups) along their outward directions. The magma/inner
    // meshes live inside them, so they part with their shard — this is the crack-open motion.
    const applyShardSpread = () => {
      if (!registry) return;
      const { shards, radius } = registry.cellSpread;
      shards.forEach(({ object, basePosition, outward }) => {
        const distance = fractureSpread * radius;
        object.position.set(
          basePosition.x + outward.x * distance,
          basePosition.y + outward.y * distance,
          basePosition.z + outward.z * distance,
        );
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
        applyShardSpread();
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

        spinner.add(modelRoot);
        registry = buildSunLabRegistry(modelRoot);

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
