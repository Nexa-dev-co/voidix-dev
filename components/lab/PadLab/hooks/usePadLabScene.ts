'use client';

import { useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { DECK_SERVICES } from '@/components/sections/ServicesDeck/deckServices';
import { getPadLabTuning } from '../padLabTuning';
import {
  PAD_MODEL_PATH,
  PAD_GLOW_MATERIALS,
  preparePad,
} from '@/components/sections/ServicesDeck/padModel';

/**
 * The pad lab's scene: the landing pad, the light it throws, and a real craft to judge that light
 * against.
 *
 * Everything here is driven from `padLabTuning` every frame rather than being set once, so a panel
 * edit shows up immediately without any wiring between the two. The one exception is the model
 * itself — parts and materials are edited directly on the three objects, and this hook just exposes
 * them through the handle so the panel can build controls for whatever the file turns out to hold.
 */

const DRACO_DECODER_PATH = '/draco/';

/** The pad is normalised to this width in world units, so the camera framing is model-independent. */
const PAD_TARGET_WIDTH = 6;
/** …and the test craft to this, matching the deck's own TARGET_SIZE so it reads at the right scale. */
const SHIP_TARGET_SIZE = 2.3;

const CAMERA_FOV = 38;
const CAMERA_START = new THREE.Vector3(5.5, 3.2, 7.5);
const CAMERA_TARGET = new THREE.Vector3(0, 1, 0);
/** Let the camera go BELOW the ground plane — seeing the pad light the hull from under is the point. */
const ORBIT_MAX_POLAR_ANGLE = Math.PI;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_FRAME_SECONDS = 0.05;

const GROUND_SIZE = 60;
const HELPER_SIZE = 0.12;

/** One addressable piece of the pad, as the panel sees it. */
export interface PadPart {
  index: number;
  name: string;
  /**
   * The part's material name — the only readable identity this model has. Its node names are
   * Sketchfab noise (`Object_7`…), so the panel labels parts by this instead.
   */
  materialName: string;
  mesh: THREE.Mesh;
  /** The pose it loaded with — every panel edit is applied as an offset from this. */
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  baseScale: THREE.Vector3;
  /** Panel-editable offsets. Degrees for rotation. */
  offset: {
    visible: boolean;
    x: number;
    y: number;
    z: number;
    rotX: number;
    rotY: number;
    rotZ: number;
    scale: number;
  };
}

export interface PadLabHandle {
  parts: PadPart[];
  /** Deduped by name — several meshes can share one material, and editing it once should hit them all. */
  materials: { name: string; material: THREE.MeshStandardMaterial }[];
  /**
   * Names of the materials the render loop drives as the pad's glow (see PAD_GLOW_MATERIALS).
   *
   * The panel needs this so it can suppress its own emissive controls for those materials — the loop
   * rewrites them every frame, so a slider there would move and appear to do nothing.
   */
  glowMaterialNames: string[];
  /** Force a redraw after a panel edit (the loop is continuous, so this is a no-op hook for later). */
  invalidate: () => void;
}

export interface PadLabStatus {
  isLoading: boolean;
  error: string | null;
}

interface PadLabSceneOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onReady: (handle: PadLabHandle) => void;
  onStatus: (status: PadLabStatus) => void;
}

/** Fit an object to a target size and centre it on its own bounding box. */
function normaliseToSize(object: THREE.Object3D, targetSize: number): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / largest;
  object.scale.setScalar(scale);
  // Re-measure after scaling rather than scaling the old centre — the two are not the same once the
  // object has a non-uniform parent.
  object.position.sub(centre.multiplyScalar(scale));
}

export function usePadLabScene({ canvasRef, onReady, onStatus }: PadLabSceneOptions): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tuning = getPadLabTuning();
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO));
    // MUST match the deck's tone mapping (useServicesDeck sets Neutral) or this lab is not a preview,
    // it is a different picture. Tone mapping is not a cosmetic pass — ACES desaturates bright colour
    // toward white while Neutral holds saturation, so a glow tuned under one lands differently under
    // the other, and the pad's whole job is a saturated emissive.
    //
    // The lab follows the deck rather than the other way round: the deck's choice is deliberate (its
    // fleet read flat and grey under ACES) and it is the thing that ships.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = false;

    const scene = new THREE.Scene();
    const backgroundColor = new THREE.Color(getPadLabTuning().backgroundColor);
    scene.background = backgroundColor;
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 500);
    camera.position.copy(CAMERA_START);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.target.copy(CAMERA_TARGET);
    controls.maxPolarAngle = ORBIT_MAX_POLAR_ANGLE;

    // ── Post-processing ──
    // A plain composer is correct here: this canvas is opaque, so the full-screen blit that broke the
    // hero sun's transparency (see sunBloom.ts) is harmless. Bloom is what turns the emissive rings
    // from bright paint into something that reads as a light source.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1, 1, 1);
    composer.addPass(bloomPass);
    // Applies renderer.toneMapping + colour space at the very end, once.
    composer.addPass(new OutputPass());

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environmentTexture;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0);
    scene.add(ambientLight);

    // ── The ground ──
    // Unlit-ish and dark: it exists to catch the pad's light so you can see where it actually falls,
    // not to be a surface in its own right.
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tuning.groundColor),
      roughness: 0.9,
      metalness: 0,
    });
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      groundMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const padGroup = new THREE.Group();
    scene.add(padGroup);

    // ── The pad's lights ──
    // Parented to their OWN group, which follows the pad's position but NOT its rotation.
    //
    // That distinction matters: the pad model ships standing upright and gets laid flat with
    // `padRotX: -90`. Hang the lights off the pad itself and that rotation takes their local +Y with
    // it, so "height above the pad" would silently become a horizontal offset and the panel's labels
    // would be lies. The rotation is about seating the model; the light's height is about the ship.
    const lightGroup = new THREE.Group();
    scene.add(lightGroup);

    const lightRigs = tuning.lights.map(() => {
      const light = new THREE.PointLight(0xffffff, 0);
      const helper = new THREE.Mesh(
        new THREE.SphereGeometry(HELPER_SIZE, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
      );
      helper.visible = false;
      light.add(helper);
      lightGroup.add(light);
      return { light, helper };
    });

    // ── Loading ──
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    const parts: PadPart[] = [];
    const materials: { name: string; material: THREE.MeshStandardMaterial }[] = [];
    /** The subset the render loop drives as the pad's light. */
    const glowMaterials: { material: THREE.MeshStandardMaterial; weight: number }[] = [];
    /** Live `uGlowMapHue` uniforms, from the glow materials that carry an emissive texture. */
    const glowMapHueUniforms: { value: number }[] = [];

    let padRoot: THREE.Object3D | null = null;
    let shipRoot: THREE.Object3D | null = null;
    let shipRequestToken = 0;

    gltfLoader.load(
      PAD_MODEL_PATH,
      (gltf) => {
        if (disposed) return;
        padRoot = gltf.scene;
        normaliseToSize(padRoot, PAD_TARGET_WIDTH);
        padGroup.add(padRoot);

        // Walks the model, applies its authored per-material look, patches the emissive maps to act
        // as masks, and catalogues everything. Shared with the deck that ships this pad, so the lab
        // is authoring exactly what the site renders — see ServicesDeck/padModel.ts.
        const prepared = preparePad(padRoot, tuning.glowMapHue);
        materials.push(...prepared.materials);
        glowMaterials.push(...prepared.glowMaterials);
        glowMapHueUniforms.push(...prepared.mapHueUniforms);

        // The lab adds per-part posing on top, which the deck has no need for.
        prepared.meshes.forEach(({ index, name, materialName, mesh }) => {
          parts.push({
            index,
            name,
            materialName,
            mesh,
            basePosition: mesh.position.clone(),
            baseQuaternion: mesh.quaternion.clone(),
            baseScale: mesh.scale.clone(),
            offset: { visible: true, x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1 },
          });
        });

        onStatus({ isLoading: false, error: null });
        onReady({
          parts,
          materials,
          glowMaterialNames: Object.keys(PAD_GLOW_MATERIALS),
          invalidate: () => {},
        });
      },
      undefined,
      (error) => {
        if (disposed) return;
        onStatus({ isLoading: false, error: String(error) });
      },
    );

    // The craft sits inside its own group, and the panel only ever moves the GROUP.
    //
    // `normaliseToSize` centres a model by writing its position, so posing the model directly would
    // overwrite that offset and the craft would drift off its own centre the moment the hover height
    // was touched. One transform per owner, and they cannot fight.
    const shipGroup = new THREE.Group();
    scene.add(shipGroup);

    /** (Re)load the test craft whenever the panel picks a different one. */
    const loadShip = (shipIndex: number) => {
      const service = DECK_SERVICES[shipIndex];
      if (!service) return;
      shipRequestToken += 1;
      const token = shipRequestToken;
      gltfLoader.load(service.modelPath, (gltf) => {
        // Token-guarded: picking three ships quickly must not leave whichever loaded last on stage.
        if (disposed || token !== shipRequestToken) return;
        if (shipRoot) shipGroup.remove(shipRoot);
        shipRoot = gltf.scene;
        normaliseToSize(shipRoot, SHIP_TARGET_SIZE);
        // The deck flips this hull; mirror that so the craft sits the right way up here too.
        if (service.modelRotation?.x) {
          shipRoot.rotation.x = THREE.MathUtils.degToRad(service.modelRotation.x);
        }
        shipGroup.add(shipRoot);
      });
    };
    loadShip(tuning.shipIndex);

    let loadedShipIndex = tuning.shipIndex;
    let neutralApplied = false;
    const originalShipColors = new Map<THREE.Material, THREE.Color>();

    const applyShipNeutral = (neutral: boolean) => {
      if (!shipRoot || neutral === neutralApplied) return;
      shipRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
        meshMaterials.forEach((material) => {
          if (!(material instanceof THREE.MeshStandardMaterial)) return;
          if (neutral) {
            if (!originalShipColors.has(material)) {
              originalShipColors.set(material, material.color.clone());
            }
            material.color.setRGB(0.55, 0.55, 0.55);
          } else {
            const original = originalShipColors.get(material);
            if (original) material.color.copy(original);
          }
        });
      });
      neutralApplied = neutral;
    };

    // ── Sizing ──
    const applySize = () => {
      const width = canvas.clientWidth || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      // A composer caches its OWN pixel ratio at construction, so it has to be told separately or the
      // bloom targets stay at the wrong density. Same trap the deck documents.
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(canvas.parentElement ?? canvas);

    // ── Render loop ──
    const clock = new THREE.Clock();
    const scratchEuler = new THREE.Euler();
    const scratchQuaternion = new THREE.Quaternion();
    const glowColor = new THREE.Color();
    /** One accumulated angle per spinner, so each keeps its own phase and direction. */
    const spinAngles = tuning.spins.map(() => 0);
    let animationFrame = 0;

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);

      renderer.toneMappingExposure = tuning.exposure;
      // Mutated, not reassigned — a `new THREE.Color` here would allocate every frame forever.
      backgroundColor.set(tuning.backgroundColor);
      scene.environmentIntensity = tuning.envIntensity;

      ambientLight.color.set(tuning.ambientColor);
      ambientLight.intensity = tuning.ambientIntensity;

      ground.visible = tuning.showGround;
      groundMaterial.color.set(tuning.groundColor);

      // The pad's own placement.
      padGroup.scale.setScalar(tuning.padScale);
      padGroup.position.set(tuning.padX, tuning.padY, tuning.padZ);
      padGroup.rotation.set(
        THREE.MathUtils.degToRad(tuning.padRotX),
        THREE.MathUtils.degToRad(tuning.padRotY),
        THREE.MathUtils.degToRad(tuning.padRotZ),
      );

      // ── The glow ──
      // One colour drives the emissive rings AND the light they cast, which is what makes the pad a
      // light source rather than a prop standing next to a lamp.
      glowColor.set(
        tuning.glowColorFollowsShip
          ? tuning.shipGlowColors[tuning.shipIndex] ?? tuning.glowColor
          : tuning.glowColor,
      );
      glowMaterials.forEach(({ material, weight }) => {
        material.emissive.copy(glowColor);
        material.emissiveIntensity = tuning.glowIntensity * weight;
      });
      // Pushed to the patched shaders rather than held on the materials — see useEmissiveMapAsMask.
      glowMapHueUniforms.forEach((uniform) => {
        uniform.value = tuning.glowMapHue;
      });

      // The light rig follows the pad's POSITION only — see where lightGroup is created.
      lightGroup.position.copy(padGroup.position);

      // The lights it throws.
      lightRigs.forEach(({ light, helper }, index) => {
        const config = tuning.lights[index];
        if (!config) return;
        light.visible = config.enabled;
        // Set in place rather than through a ternary that builds a Color — this runs every frame.
        if (tuning.lightFollowsGlow) light.color.copy(glowColor);
        else light.color.set(config.color);
        light.intensity = config.intensity;
        light.position.set(config.x, config.y, config.z);
        light.distance = config.distance;
        light.decay = config.decay;
        helper.visible = config.showHelper && config.enabled;
        // Mirrors the light's RESOLVED colour, so the marker doesn't lie while the light is following
        // the glow.
        (helper.material as THREE.MeshBasicMaterial).color.copy(light.color);
      });

      // Each spinner keeps its own accumulated angle, so two parts can turn at different rates — or
      // at the same rate in opposite directions, which is the whole point of having more than one.
      tuning.spins.forEach((spin, index) => {
        spinAngles[index] =
          (spinAngles[index] ?? 0) + THREE.MathUtils.degToRad(spin.speed) * delta;
      });

      // Per-part offsets, applied on top of each piece's loaded pose.
      parts.forEach((part) => {
        const { mesh, offset, basePosition, baseQuaternion, baseScale } = part;
        mesh.visible = offset.visible;
        mesh.position.set(
          basePosition.x + offset.x,
          basePosition.y + offset.y,
          basePosition.z + offset.z,
        );
        mesh.scale.set(
          baseScale.x * offset.scale,
          baseScale.y * offset.scale,
          baseScale.z * offset.scale,
        );

        // A spun part gets its rotation from the clock as well as from the panel. Matched by MATERIAL,
        // so a spinner picks up every mesh using it — `c_sd_Meatcleaver_on` is two panels
        // (Object_13 and Object_17) that have to turn together. First match wins, so two spinners
        // aimed at the same material can't fight over one part.
        const spinIndex = tuning.spins.findIndex(
          (spin) => spin.material !== '' && spin.material === part.materialName,
        );
        const spinAngle = spinIndex === -1 ? 0 : spinAngles[spinIndex] ?? 0;
        const spinAxis = spinIndex === -1 ? -1 : tuning.spins[spinIndex].axis;
        scratchEuler.set(
          THREE.MathUtils.degToRad(offset.rotX) + (spinAxis === 0 ? spinAngle : 0),
          THREE.MathUtils.degToRad(offset.rotY) + (spinAxis === 1 ? spinAngle : 0),
          THREE.MathUtils.degToRad(offset.rotZ) + (spinAxis === 2 ? spinAngle : 0),
        );
        scratchQuaternion.setFromEuler(scratchEuler);
        mesh.quaternion.copy(baseQuaternion).multiply(scratchQuaternion);
      });

      // The test craft.
      if (loadedShipIndex !== tuning.shipIndex) {
        loadedShipIndex = tuning.shipIndex;
        neutralApplied = false;
        originalShipColors.clear();
        loadShip(tuning.shipIndex);
      }
      // The GROUP is posed; the model inside keeps the centring and fit `normaliseToSize` gave it.
      // So `shipScale: 1` means "as fitted" and `shipY` is a clean height above the pad's origin.
      shipGroup.visible = tuning.showShip;
      shipGroup.position.y = tuning.shipY;
      shipGroup.rotation.y = THREE.MathUtils.degToRad(tuning.shipRotY);
      shipGroup.scale.setScalar(tuning.shipScale);
      if (shipRoot) applyShipNeutral(tuning.shipNeutral);

      controls.update();

      bloomPass.enabled = tuning.bloomEnabled;
      bloomPass.strength = tuning.bloomStrength;
      bloomPass.radius = tuning.bloomRadius;
      bloomPass.threshold = tuning.bloomThreshold;
      // Always through the composer, even with bloom disabled — OutputPass is what applies tone
      // mapping and the colour space, so bypassing it would visibly shift the whole image.
      composer.render();
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      controls.dispose();
      [padRoot, shipRoot].forEach((root) => {
        root?.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
          meshMaterials.forEach((material) => material.dispose());
        });
      });
      lightRigs.forEach(({ helper }) => {
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
      });
      ground.geometry.dispose();
      groundMaterial.dispose();
      // composer.dispose() does not free passes it was given — bloom holds a stack of render targets.
      bloomPass.dispose();
      composer.dispose();
      environmentTexture.dispose();
      pmrem.dispose();
      dracoLoader.dispose();
      renderer.dispose();
    };
    // Mounted once; the panel drives everything through the shared tuning object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
