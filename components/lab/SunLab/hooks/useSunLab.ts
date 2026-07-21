import {
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { buildSunModel, type SunModel, type SunLayer } from "../sunModel";
import {
  LAYER_ORDER,
  type LayerId,
  type LightLook,
  type SunState,
} from "../sunState";

const MODEL_PATH = "/models/fractured_sun.glb";
const CAMERA_FOV = 35;
const CAMERA_FRAMING = 3.4;
const MAX_PIXEL_RATIO = 2;

const TAU = Math.PI * 2;

// ── Motion tuning (magnitudes for the 0..1 params in SunState) ──
const VIBRATION_UNIT = 0.06; // world units of tremor at amplitude 1
const SPIN_MAX = TAU; // up to one tumble at spin=1
const DRIFT_UNIT = 0.8; // downward fall at drift=1
const BLACK_HOLE_COLLAPSE = 0.92; // fraction of the way to centre at full pull
const BLACK_HOLE_SWIRL_TURNS = 1.6; // how many turns the in-spiral adds
const BLACK_HOLE_SHRINK = 0.95; // how far shards shrink as the hole eats them
const CORE_MESH_BASE_RADIUS = 1; // the black core sphere is unit-sized, scaled by coreRadius·amount
const DISK_INNER = 0.55;
const DISK_OUTER = 1.15;
const PULSE_DEPTH = 0.5; // emissive swing at pulse.amount 1

/** One fracture stack at runtime: rest transforms (centre-relative) + its tumble axis and stagger order. */
interface ShardRuntime {
  meshes: THREE.Mesh[];
  restPositions: THREE.Vector3[];
  restRotations: THREE.Euler[];
  restScales: THREE.Vector3[];
  spinAxis: THREE.Vector3;
  order: number; // 0..1 — later shards break later (stagger)
}

/** Cheap deterministic hash → [0,1), so stagger order + tumble axis are stable across scrubs. */
function hash01(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function applyLight(light: THREE.Light, look: LightLook) {
  light.color.set(look.color);
  light.intensity = look.intensity;
  light.position.set(look.position[0], look.position[1], look.position[2]);
}

/** One layer's look → its studio/authored materials. `pulseFactor` is the global emissive breathing. */
function applyLayer(layer: SunLayer, state: SunState, pulseFactor: number) {
  const look = state.layers[layer.id];
  const studio = layer.studioMaterial;

  studio.emissive.set(look.emissiveColor);
  studio.emissiveIntensity = look.emissiveIntensity * pulseFactor;
  studio.opacity = look.opacity;
  studio.transparent = look.opacity < 1 || studio.transparent;
  studio.roughness = look.roughness;
  studio.metalness = look.metalness;
  // Base colour is only meaningful on the lit shards; the glow layers stay pure emissive (colour black).
  if (layer.id === "shards") studio.color.set(look.baseColor);

  const activeMaterial = state.studioMaterials ? studio : layer.authoredMaterial;
  const visible = look.opacity > 0.001;
  for (const mesh of layer.meshes) {
    mesh.visible = visible;
    if (mesh.material !== activeMaterial) mesh.material = activeMaterial;
  }
}

export function useSunLab(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  stateRef: MutableRefObject<SunState>,
  backdropColor: string,
) {
  const backdropRef = useRef(backdropColor);
  backdropRef.current = backdropColor;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const parent = canvas.parentElement ?? canvas;
    const initialWidth = parent.clientWidth || 900;
    const initialHeight = parent.clientHeight || 600;
    renderer.setSize(initialWidth, initialHeight, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      initialWidth / initialHeight,
      0.1,
      100,
    );
    camera.position.set(0, 0.2, CAMERA_FRAMING);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // pivot owns the whole sun's spin + vibration; the model recenters inside it, and the shard group,
    // core and disk all hang off it so they move together.
    const pivot = new THREE.Group();
    scene.add(pivot);

    // ── Light rig ──
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1);
    const fillLight = new THREE.DirectionalLight(0xffffff, 1);
    const rimLight = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(ambientLight, keyLight, fillLight, rimLight);

    // ── Black-hole core + accretion disk (procedural — not in the model). Hidden until amount > 0.
    // Parented to the scene, NOT the pivot: the disk is fixed in space (it must not turn edge-on with
    // the sun's spin), it only follows the vibration offset. Both sit at the shard-collapse centre. ──
    const coreSphere = new THREE.Mesh(
      new THREE.SphereGeometry(CORE_MESH_BASE_RADIUS, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    coreSphere.visible = false;
    scene.add(coreSphere);

    const diskMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(stateRef.current.blackHole.diskColor),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const accretionDisk = new THREE.Mesh(
      new THREE.RingGeometry(DISK_INNER, DISK_OUTER, 96),
      diskMaterial,
    );
    accretionDisk.visible = false;
    scene.add(accretionDisk);

    // ── Bloom pipeline ──
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(initialWidth, initialHeight);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(initialWidth, initialHeight),
      stateRef.current.bloom.strength,
      stateRef.current.bloom.radius,
      stateRef.current.bloom.threshold,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    // Runtime structures filled once the model loads.
    let model: SunModel | null = null;
    let shards: ShardRuntime[] = [];
    let cylinderMeshes: THREE.Mesh[] = [];
    let cylinderBaseScales: THREE.Vector3[] = [];

    // ── Async load ──
    let disposed = false;
    const loader = new GLTFLoader();
    loader.load(
      MODEL_PATH,
      (gltf) => {
        if (disposed) return;
        const root = gltf.scene;
        // Recentre the model inside the pivot so spin/vibration act about the sun's visual centre.
        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        root.position.sub(center);
        pivot.add(root);

        model = buildSunModel(root);

        // Reparent every shard mesh into a centre-origin group (attach preserves world transform), so a
        // shard's local position IS its offset from the sun's centre — radial explode and inward
        // collapse become plain scalar maths on that vector.
        const shardGroup = new THREE.Group();
        pivot.add(shardGroup);
        shards = model.shards.map((shard) => {
          shard.meshes.forEach((mesh) => shardGroup.attach(mesh));
          return {
            meshes: shard.meshes,
            restPositions: shard.meshes.map((mesh) => mesh.position.clone()),
            restRotations: shard.meshes.map((mesh) => mesh.rotation.clone()),
            restScales: shard.meshes.map((mesh) => mesh.scale.clone()),
            spinAxis: new THREE.Vector3(
              hash01(shard.cellKey + "x") - 0.5,
              hash01(shard.cellKey + "y") - 0.5,
              hash01(shard.cellKey + "z") - 0.5,
            ).normalize(),
            order: hash01(shard.cellKey + "order"),
          };
        });

        const cylinderLayer = model.layers.get("cylinders");
        if (cylinderLayer) {
          cylinderMeshes = cylinderLayer.meshes;
          cylinderBaseScales = cylinderMeshes.map((mesh) => mesh.scale.clone());
        }

        // Scale the procedural core/disk to the actual body size.
        const bodyScale = model.bodyRadius;
        coreSphere.scale.setScalar(0);
        accretionDisk.scale.setScalar(bodyScale);
      },
      undefined,
      (error) => console.error("[sun-lab] failed to load model", error),
    );

    // ── Per-frame: look ──
    const applyLook = (current: SunState, pulseFactor: number) => {
      if (!model) return;
      renderer.toneMappingExposure = current.exposure;
      ambientLight.intensity = current.lights.ambient;
      applyLight(keyLight, current.lights.key);
      applyLight(fillLight, current.lights.fill);
      applyLight(rimLight, current.lights.rim);
      bloomPass.strength = current.bloom.strength;
      bloomPass.radius = current.bloom.radius;
      bloomPass.threshold = current.bloom.threshold;
      for (const layerId of LAYER_ORDER) {
        const layer = model.layers.get(layerId as LayerId);
        if (layer) applyLayer(layer, current, pulseFactor);
      }
    };

    // ── Per-frame: motion ──
    const scratch = new THREE.Vector3();
    const applyMotion = (
      current: SunState,
      elapsed: number,
      delta: number,
    ) => {
      // Spin + vibration tremor on the pivot (whole sun).
      pivot.rotation.y += current.rotationSpeed * delta;
      const vib = current.vibration;
      const shake = vib.amplitude * VIBRATION_UNIT;
      const vt = elapsed * vib.frequency;
      pivot.position.set(
        (Math.sin(vt * 1.7) + Math.sin(vt * 2.9 + 1.3)) * 0.5 * shake,
        (Math.sin(vt * 1.3 + 2.1) + Math.sin(vt * 3.3)) * 0.5 * shake,
        (Math.sin(vt * 2.3 + 0.7) + Math.sin(vt * 1.9 + 3.0)) * 0.5 * shake,
      );

      // Cylinder reveal — rays grow in from zero, staggered by index. Respects the layer's own
      // visibility toggle (applyLook already set mesh.visible from it; we only narrow it further here).
      const reveal = current.cylinderReveal;
      const cylindersVisible = current.layers.cylinders.opacity > 0.001;
      const count = cylinderMeshes.length;
      cylinderMeshes.forEach((mesh, index) => {
        const start = count > 1 ? (index / count) * 0.6 : 0;
        const local = smoothstep(start, start + 0.4, reveal);
        mesh.scale.copy(cylinderBaseScales[index]).multiplyScalar(local);
        mesh.visible = cylindersVisible && local > 0.001;
      });

      // Shatter + black hole per shard.
      const sh = current.shatter;
      const bh = current.blackHole;
      const swirl = bh.amount * BLACK_HOLE_SWIRL_TURNS * TAU * bh.inSpiral;
      const collapse = THREE.MathUtils.clamp(bh.amount * bh.inSpiral, 0, 1) * BLACK_HOLE_COLLAPSE;
      const shrink = 1 - bh.amount * BLACK_HOLE_SHRINK;
      shards.forEach((shard) => {
        // Staggered local progress: later shards (higher order) start breaking later.
        const start = shard.order * sh.stagger;
        const local = smoothstep(start, start + (1 - sh.stagger), sh.amount);
        const outward = 1 + local * sh.distance;
        const driftY = -sh.drift * local * local * DRIFT_UNIT;
        const spinAngle = local * sh.spin * SPIN_MAX;

        shard.meshes.forEach((mesh, meshIndex) => {
          // Radial explode from centre (rest position already points outward from centre).
          scratch.copy(shard.restPositions[meshIndex]).multiplyScalar(outward);
          scratch.y += driftY;
          // Black-hole pull: draw inward and swirl about the vertical axis.
          if (bh.amount > 0.0001) {
            scratch.multiplyScalar(1 - collapse);
            const cos = Math.cos(swirl);
            const sin = Math.sin(swirl);
            const x = scratch.x * cos - scratch.z * sin;
            const z = scratch.x * sin + scratch.z * cos;
            scratch.x = x;
            scratch.z = z;
          }
          mesh.position.copy(scratch);

          const restRotation = shard.restRotations[meshIndex];
          mesh.rotation.set(
            restRotation.x + shard.spinAxis.x * spinAngle,
            restRotation.y + shard.spinAxis.y * spinAngle,
            restRotation.z + shard.spinAxis.z * spinAngle,
          );
          mesh.scale.copy(shard.restScales[meshIndex]).multiplyScalar(shrink);
        });
      });

      // Black-hole core + accretion disk. Both track the sun's vibration centre; the disk spins in place.
      const bodyScale = model?.bodyRadius ?? 0.6;
      if (bh.amount > 0.0001) {
        coreSphere.visible = true;
        coreSphere.position.copy(pivot.position);
        coreSphere.scale.setScalar(bh.coreRadius * bh.amount * 2 * bodyScale);
        accretionDisk.visible = true;
        accretionDisk.position.copy(pivot.position);
        accretionDisk.rotation.z += bh.diskSpeed * delta;
        diskMaterial.opacity = bh.amount;
        diskMaterial.color.set(bh.diskColor);
        accretionDisk.scale.setScalar(bodyScale * bh.diskScale);
      } else {
        coreSphere.visible = false;
        accretionDisk.visible = false;
      }
    };

    // ── Resize ──
    const applySize = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
      renderer.setSize(width, height, false);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(applySize);
    observer.observe(parent);

    // ── Loop ──
    const clock = new THREE.Clock();
    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.elapsedTime;
      const current = stateRef.current;
      const pulseFactor =
        1 +
        current.pulse.amount *
          Math.sin(elapsed * current.pulse.speed * TAU) *
          PULSE_DEPTH;
      applyLook(current, pulseFactor);
      applyMotion(current, elapsed, delta);
      renderer.setClearColor(new THREE.Color(backdropRef.current), 1);
      controls.update();
      composer.render();
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      observer.disconnect();
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      coreSphere.geometry.dispose();
      (coreSphere.material as THREE.Material).dispose();
      accretionDisk.geometry.dispose();
      diskMaterial.dispose();
      if (model) {
        model.layers.forEach((layer) => {
          layer.studioMaterial.dispose();
          layer.authoredMaterial.dispose();
        });
      }
      // Traverse the pivot (not model.root) so the reparented shard meshes' geometries are freed too.
      pivot.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      model = null;
    };
    // Built once; live values flow through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);
}
