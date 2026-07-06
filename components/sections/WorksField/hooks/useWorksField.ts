import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { WORKS_PROJECTS } from '../worksProjects';
import { WORKS_REVEAL_EVENT } from '../worksEvents';
import { createStoneMaterial, createFireMaterial, type FireMeteorUniforms } from '../meteorMaterial';

// ── Textures ────────────────────────────────────────────────────────────
const TEXTURE_STONE  = '/textures/meteor/stone.jpg';
const TEXTURE_STONE2 = '/textures/meteor/stone2.webp';
const TEXTURE_NORMAL = '/textures/meteor/normal.jpg';
const TEXTURE_FIRE   = '/textures/meteor/fire_meteor.jpg';

// ── Camera / framing ────────────────────────────────────────────────────
const CAMERA_FOV = 38;
// Where the camera sits relative to the focused meteor: back + a touch above, looking at it. As
// the focus travels between meteors the camera flies through the field and neighbours pass by.
const CAMERA_OFFSET = new THREE.Vector3(0, 0.7, 6.4);

// ── Warp travel — the "punch between planets" feeling ────────────────────
// The trip is time-based (not a constant lerp) so it launches, cruises, then arrives: the eased
// progress means the camera accelerates out of one planet and decelerates into the next. That speed
// curve then drives the star-streaks and an FOV kick, so the three read as one warp.
const TRAVEL_DURATION = 0.9;        // seconds per hop, regardless of distance
const TRAVEL_EASE = 'power3.inOut'; // accelerate → cruise → decelerate (the launch/arrive arc)
// Camera speed (world units/second) that maps to a full-intensity warp. Tuned so a typical hop
// between neighbouring meteors peaks near full streak without pinning there.
const WARP_REFERENCE_SPEED = 22;
const WARP_SMOOTHING = 0.22;        // ease the measured speed so streaks/FOV don't flicker frame to frame
const FOV_KICK = 8;                 // degrees the FOV widens at peak warp (38 → 46), punching the launch
// Star-streaks: at peak warp each star stretches into a light-line this long (view-space units) and
// the streak layer fades up to this opacity. Restrained-cinematic, not a game hyperdrive.
const STREAK_MAX_LENGTH = 7;
const STREAK_MAX_OPACITY = 0.8;

// ── Drag-to-look (orbit the camera a clamped amount to peek at neighbours) ──
const DRAG_YAW_SENSITIVITY   = 0.005; // radians of orbit per pixel
const DRAG_PITCH_SENSITIVITY = 0.004;
const DRAG_YAW_CLAMP   = 0.6;
const DRAG_PITCH_CLAMP = 0.4;
const VIEW_RETURN_EASE = 0.06; // spring the look-offset back to centre on release

// ── The project meteors — a loose constellation across depth ─────────────
// Each project is one meteor; the focused one burns. Positions are hand-placed so neighbours stay
// on screen (you can see the rest of the field around the active one).
interface MeteorLayout {
  position: [number, number, number];
  radius: number;
}
const METEOR_LAYOUT: MeteorLayout[] = [
  { position: [0, 0, 0],          radius: 1.3 },
  { position: [7.6, 1.9, -4.5],   radius: 1.05 },
  { position: [-6.8, -1.5, -8],   radius: 1.45 },
  { position: [4.6, 2.7, -13.5],  radius: 1.15 },
];
const METEOR_MODEL_PATH = '/models/meteor.glb'; // the real meteor body every project is carved from
const DRACO_DECODER_PATH = '/draco/';
const METEOR_DETAIL = 1;        // icosahedron subdivisions — the fallback shape if the model won't load
const FIRE_SHELL_SCALE = 1.03;  // the fire mesh sits just outside the stone so it fully envelops it
const IGNITE_DURATION = 0.7;    // cross-fade a meteor to fire
const COOL_DURATION   = 0.5;    // …and back to stone
const METEOR_SPIN_SPEED = 0.25; // rad/s slow turntable on the focused meteor
const FLOAT_AMPLITUDE   = 0.12; // gentle vertical bob on the focused meteor
const FLOAT_SPEED       = 0.9;

// ── Fire "breathing" (idle → flare rhythm, like the sun) ─────────────────
const FLARE_BASE      = 0.6;
const FLARE_AMPLITUDE = 0.35;
const FLARE_SPEED     = 1.4;

// ── Shards — irregular ambient debris (NOT projects) ─────────────────────
const SHARD_COUNT       = 260;
const SHARD_COUNT_LOW   = 90;
const SHARD_FIELD       = new THREE.Vector3(13, 6.5, 20); // half-extents the debris fills (z biased back)
const SHARD_Z_CENTER    = -7;
const SHARD_MIN_SCALE   = 0.05;
const SHARD_MAX_SCALE   = 0.4;
const SHARD_DRIFT_SPEED = 0.012; // rad/s slow yaw drift on the whole debris field
const SHARD_TINT        = 0x1c2530; // darker than the meteors so the projects read as the subjects

// ── Starfield ────────────────────────────────────────────────────────────
const STAR_COUNT        = 1400;
const STAR_INNER_RADIUS = 22;
const STAR_OUTER_RADIUS = 70;
const STAR_SIZE         = 0.16;
const STAR_OPACITY      = 0.85;
const STAR_DRIFT        = 0.008;

// ── Lighting ─────────────────────────────────────────────────────────────
const KEY_LIGHT_COLOR      = 0xdfe7ff; // cool key so the stone meteors read blue-grey, not warm
const KEY_LIGHT_INTENSITY  = 2.1;
const FILL_LIGHT_COLOR     = 0x2a3550;
const FILL_LIGHT_INTENSITY = 0.6;
const AMBIENT_INTENSITY    = 0.18;
const TONE_MAPPING_EXPOSURE = 1.15;

// ── Bloom (only the fire blooms) ─────────────────────────────────────────
const BLOOM_STRENGTH     = 0.9;
const BLOOM_STRENGTH_LOW = 0.55;
const BLOOM_RADIUS       = 0.55;
const BLOOM_THRESHOLD    = 0.6;
const BLOOM_MSAA_SAMPLES = 4;

const MAX_FRAME_SECONDS = 0.05; // clamp dt so a tab-restore doesn't fling the animation
const LOW_POWER_MAX_WIDTH = 760;

export interface FieldStatus {
  isLoading: boolean;
  /** 0–100 while the textures stream in, 100 when the field is built. */
  percent: number;
}

interface FieldOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The focused project — read live from the render loop / handlers via a ref. */
  activeIndex: number;
  onStatus: (status: FieldStatus) => void;
}

interface MeteorRig {
  group: THREE.Group;
  basePosition: THREE.Vector3;
  geometry: THREE.BufferGeometry;
  stoneMaterial: THREE.MeshStandardMaterial;
  fireMaterial: THREE.ShaderMaterial;
  fireUniforms: FireMeteorUniforms;
}

// The live uniforms the render loop drives on the streak layer as the camera warps.
interface StreakUniforms {
  uStreakDir:    { value: THREE.Vector3 }; // world-space camera travel direction
  uStreakLength: { value: number };        // view-space tail length (0 at rest → STREAK_MAX_LENGTH at peak)
  uOpacity:      { value: number };        // streak layer fade (0 at rest → STREAK_MAX_OPACITY)
}

interface StarSystem {
  group: THREE.Group;
  streakUniforms: StreakUniforms;
  dispose: () => void;
}

// Stretch a star's tail vertex along the camera's travel direction, in VIEW space so the group's
// slow drift rotation never skews the streak. At rest uStreakLength is 0, so the tail sits on the
// head and the line is invisible — the dots carry the resting look; the streaks only appear mid-warp.
const STAR_STREAK_VERTEX = /* glsl */ `
  uniform vec3  uStreakDir;
  uniform float uStreakLength;
  attribute float aTail;      // 0 = head (at the star), 1 = tail (pushed back along travel)
  varying float vTail;

  void main() {
    vTail = aTail;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    // Travel direction rotated into view space; the tail trails opposite to it.
    vec3 travelView = normalize((viewMatrix * vec4(uStreakDir, 0.0)).xyz);
    viewPosition.xyz -= travelView * aTail * uStreakLength;
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const STAR_STREAK_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform float uOpacity;
  varying float vTail;
  void main() {
    // Bright at the head, fading down the tail — a comet-streak rather than a solid bar.
    gl_FragColor = vec4(vec3(1.0), uOpacity * (1.0 - vTail));
  }
`;

// A spherical shell of stars wrapping the field: faint additive dots at rest, plus a streak layer
// (built from the same star positions) that elongates them into light-lines while the camera warps.
function createStarSystem(): StarSystem {
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let starIndex = 0; starIndex < STAR_COUNT; starIndex += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = STAR_INNER_RADIUS + Math.random() * (STAR_OUTER_RADIUS - STAR_INNER_RADIUS);
    positions[starIndex * 3]     = radius * Math.sin(phi) * Math.cos(theta);
    positions[starIndex * 3 + 1] = radius * Math.cos(phi);
    positions[starIndex * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  // Resting dots.
  const dotGeometry = new THREE.BufferGeometry();
  dotGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dotMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: STAR_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: STAR_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dots = new THREE.Points(dotGeometry, dotMaterial);

  // Streak layer — two vertices per star (head + tail), both at the star position; the tail is
  // pushed back in the shader by uStreakLength. Drawn as line segments (pairs 0-1, 2-3, …).
  const streakPositions = new Float32Array(STAR_COUNT * 2 * 3);
  const streakTail = new Float32Array(STAR_COUNT * 2);
  for (let starIndex = 0; starIndex < STAR_COUNT; starIndex += 1) {
    const headOffset = starIndex * 6;
    const starOffset = starIndex * 3;
    for (let vertex = 0; vertex < 2; vertex += 1) {
      streakPositions[headOffset + vertex * 3]     = positions[starOffset];
      streakPositions[headOffset + vertex * 3 + 1] = positions[starOffset + 1];
      streakPositions[headOffset + vertex * 3 + 2] = positions[starOffset + 2];
    }
    streakTail[starIndex * 2]     = 0; // head
    streakTail[starIndex * 2 + 1] = 1; // tail
  }
  const streakGeometry = new THREE.BufferGeometry();
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
  streakGeometry.setAttribute('aTail', new THREE.BufferAttribute(streakTail, 1));

  const streakUniforms: StreakUniforms = {
    uStreakDir:    { value: new THREE.Vector3(0, 0, 1) },
    uStreakLength: { value: 0 },
    uOpacity:      { value: 0 },
  };
  const streakMaterial = new THREE.ShaderMaterial({
    vertexShader:   STAR_STREAK_VERTEX,
    fragmentShader: STAR_STREAK_FRAGMENT,
    uniforms:       streakUniforms as unknown as { [uniform: string]: THREE.IUniform },
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });
  const streaks = new THREE.LineSegments(streakGeometry, streakMaterial);
  // The tail can reach beyond the star shell; keep it drawing even when its bounds leave the frustum.
  streaks.frustumCulled = false;

  const group = new THREE.Group();
  group.add(dots, streaks);

  return {
    group,
    streakUniforms,
    dispose: () => {
      dotGeometry.dispose();
      dotMaterial.dispose();
      streakGeometry.dispose();
      streakMaterial.dispose();
    },
  };
}

// An irregular chunk: an icosahedron with its vertices randomly pushed in/out, so no two shards are
// the "perfect" gem shape the meteors are. Built once, then instanced with random pose/scale.
function createShardGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    vertex.fromBufferAttribute(position, vertexIndex);
    // Deterministic-ish jitter so the two base shards look different from each other.
    const jitter = 0.55 + 0.5 * Math.sin(seed * 12.9898 + vertexIndex * 4.1414);
    vertex.multiplyScalar(0.7 + jitter * 0.6);
    position.setXYZ(vertexIndex, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Flatten a loaded glb into one buffer geometry the meteors can wear: bake every mesh's world
// transform, keep only position/normal/uv (so primitives with different attribute sets still merge),
// then centre it and normalise to a unit radius. Each meteor later clones this and scales it to its
// own layout radius — so the model's absolute size and pivot don't matter. The fire shader only uses
// normalize(localPosition), which is scale-invariant, so the flame maps onto the model unchanged.
function meteorGeometryFromModel(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateWorldMatrix(true, true);

  const parts: THREE.BufferGeometry[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    let baked = child.geometry.clone();
    baked.applyMatrix4(child.matrixWorld);
    if (baked.index) baked = baked.toNonIndexed();
    if (!baked.getAttribute('normal')) baked.computeVertexNormals();

    const trimmed = new THREE.BufferGeometry();
    trimmed.setAttribute('position', baked.getAttribute('position'));
    trimmed.setAttribute('normal', baked.getAttribute('normal'));
    const uv = baked.getAttribute('uv');
    // Some meteor models have no unwrap; give a zeroed uv so merge + the fire's uMap sample don't NaN.
    trimmed.setAttribute(
      'uv',
      uv ?? new THREE.BufferAttribute(new Float32Array(baked.getAttribute('position').count * 2), 2),
    );
    parts.push(trimmed);
    baked.dispose();
  });

  // No mesh in the file → fall back to the faceted crystal so the section still builds.
  if (!parts.length) return new THREE.IcosahedronGeometry(1, METEOR_DETAIL);
  const merged = (parts.length === 1 ? parts[0] : mergeGeometries(parts, false)) ?? parts[0];

  merged.computeBoundingBox();
  const center = merged.boundingBox!.getCenter(new THREE.Vector3());
  merged.translate(-center.x, -center.y, -center.z);
  merged.computeBoundingSphere();
  const radius = merged.boundingSphere?.radius || 1;
  merged.scale(1 / radius, 1 / radius, 1 / radius);
  merged.computeVertexNormals();
  return merged;
}

export function useWorksField({ canvasRef, activeIndex, onStatus }: FieldOptions) {
  // The render loop + handlers read the freshest focus through a ref, so the persistent setup
  // effect never re-runs when the active project changes.
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // Set up inside the persistent effect; called from the selection effect below so a focus change
  // re-stages the existing scene instead of rebuilding it.
  const setFocusRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = prefersReducedMotion();
    const lowPower =
      window.matchMedia('(pointer: coarse)').matches || window.innerWidth < LOW_POWER_MAX_WIDTH;

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 200);

    // Cool image-based lighting so the crystal meteors catch real reflections without an HDR.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    scene.environment = pmremGenerator.fromScene(roomEnvironment, 0.04).texture;

    const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY);
    keyLight.position.set(5, 8, 6);
    const fillLight = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
    fillLight.position.set(-6, -2, 3);
    scene.add(keyLight, fillLight, new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));

    // ── Bloom pipeline (only the fire is bright enough to bleed) ──
    const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: lowPower ? 0 : BLOOM_MSAA_SAMPLES,
    });
    const composer = new EffectComposer(renderer, composerTarget);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      lowPower ? BLOOM_STRENGTH_LOW : BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    // ── Starfield (dots + warp streaks) ──
    const starSystem = createStarSystem();
    scene.add(starSystem.group);

    // ── Camera rig state ──
    // The camera looks at `focusCurrent`. On a focus change it *warps* from where it is to the new
    // meteor along a time-based eased hop (launch → cruise → arrive); drag adds a clamped yaw/pitch
    // orbit offset that springs back on release.
    const focusCurrent = new THREE.Vector3().fromArray(METEOR_LAYOUT[activeIndexRef.current].position);
    const focusTarget  = focusCurrent.clone();
    let viewYaw = 0, viewPitch = 0, viewYawTarget = 0, viewPitchTarget = 0;
    // On portrait/narrow aspect the camera pulls back so the meteor stays framed instead of clipping.
    let distanceScale = 1;

    // The warp hop: focusCurrent = lerp(travelFrom, travelTo, easedProgress). GSAP eases the progress
    // so the speed curve (and thus the streaks + FOV kick) is the launch/arrive arc, not a flat drift.
    const travelFrom = focusCurrent.clone();
    const travelTo   = focusCurrent.clone();
    const travelProgress = { value: 1 }; // 1 = arrived / idle
    let travelActive = false;
    const startTravel = () => {
      travelFrom.copy(focusCurrent);
      travelTo.copy(focusTarget);
      travelProgress.value = 0;
      travelActive = true;
      gsap.killTweensOf(travelProgress);
      gsap.to(travelProgress, {
        value: 1,
        duration: TRAVEL_DURATION,
        ease: TRAVEL_EASE,
        onComplete: () => { travelActive = false; },
      });
    };

    const updateCamera = (instant: boolean) => {
      if (instant || reduceMotion) {
        focusCurrent.copy(focusTarget);
        travelActive = false;
      } else if (travelActive) {
        focusCurrent.lerpVectors(travelFrom, travelTo, travelProgress.value);
      }
      viewYaw   += (viewYawTarget   - viewYaw)   * VIEW_RETURN_EASE;
      viewPitch += (viewPitchTarget - viewPitch) * VIEW_RETURN_EASE;

      const offset = CAMERA_OFFSET.clone();
      offset.z *= distanceScale;
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), viewYaw);
      offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), viewPitch);
      camera.position.copy(focusCurrent).add(offset);
      camera.lookAt(focusCurrent);
    };

    // ── Load textures, then build the meteors + shards ──
    const meteorRigs: MeteorRig[] = [];
    let shardMeshes: THREE.InstancedMesh[] = [];
    const shardGeometries: THREE.BufferGeometry[] = [];
    const shardMaterials: THREE.MeshStandardMaterial[] = [];
    const disposableTextures: THREE.Texture[] = [];
    // The normalised meteor model, shared by all four project bodies. Set once the glb arrives; the
    // field only builds after both this and the textures are in (see the coordinator below).
    let meteorBaseGeometry: THREE.BufferGeometry | null = null;

    const loadingManager = new THREE.LoadingManager();
    const textureLoader = new THREE.TextureLoader(loadingManager);

    const loadAlbedo = (path: string) => {
      const texture = textureLoader.load(path);
      texture.colorSpace = THREE.SRGBColorSpace;
      disposableTextures.push(texture);
      return texture;
    };
    const stoneMap  = loadAlbedo(TEXTURE_STONE);
    const stone2Map = loadAlbedo(TEXTURE_STONE2);
    const fireMap   = loadAlbedo(TEXTURE_FIRE);
    const normalMap = textureLoader.load(TEXTURE_NORMAL); // linear data — leave colorSpace as-is
    disposableTextures.push(normalMap);

    loadingManager.onProgress = (_url, loaded, total) => {
      onStatus({ isLoading: true, percent: Math.round((loaded / Math.max(total, 1)) * 100) });
    };

    // Build the bodies once the textures AND the meteor model are in (the meteors need both).
    const buildField = () => {
      if (!meteorBaseGeometry) return;
      // Project meteors — a stone shell with a fire shell nested inside it for the ignite cross-fade.
      METEOR_LAYOUT.forEach((layout, index) => {
        const project = WORKS_PROJECTS[index];
        // Each meteor is the shared model geometry, cloned and grown to its own layout radius.
        const geometry = meteorBaseGeometry!.clone().scale(layout.radius, layout.radius, layout.radius);

        const stoneMaterial = createStoneMaterial(index % 2 === 0 ? stoneMap : stone2Map, normalMap, {
          flatShading: true,
        });
        const stoneMesh = new THREE.Mesh(geometry, stoneMaterial);

        const { material: fireMaterial, uniforms: fireUniforms } = createFireMaterial(fireMap, project.accent);
        const fireMesh = new THREE.Mesh(geometry, fireMaterial);
        fireMesh.scale.setScalar(FIRE_SHELL_SCALE);

        const group = new THREE.Group();
        group.position.fromArray(layout.position);
        // Random resting tilt so the crystals don't all sit the same way up.
        group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        group.add(stoneMesh, fireMesh);
        scene.add(group);

        meteorRigs.push({
          group,
          basePosition: new THREE.Vector3().fromArray(layout.position),
          geometry,
          stoneMaterial,
          fireMaterial,
          fireUniforms,
        });
      });

      // Ambient shard debris — two irregular base shapes, each instanced across the field.
      const totalShards = lowPower ? SHARD_COUNT_LOW : SHARD_COUNT;
      const shardMatrix = new THREE.Matrix4();
      const shardQuaternion = new THREE.Quaternion();
      const shardEuler = new THREE.Euler();
      const shardScale = new THREE.Vector3();
      const shardPosition = new THREE.Vector3();

      for (let baseIndex = 0; baseIndex < 2; baseIndex += 1) {
        const geometry = createShardGeometry(baseIndex + 1);
        const material = createStoneMaterial(baseIndex === 0 ? stoneMap : stone2Map, normalMap, {
          tint: SHARD_TINT,
          flatShading: true,
        });
        material.transparent = false; // shards never cross-fade, so keep them cheap/opaque
        const countForBase = Math.floor(totalShards / 2);
        const instanced = new THREE.InstancedMesh(geometry, material, countForBase);
        instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);

        for (let instanceIndex = 0; instanceIndex < countForBase; instanceIndex += 1) {
          shardPosition.set(
            (Math.random() * 2 - 1) * SHARD_FIELD.x,
            (Math.random() * 2 - 1) * SHARD_FIELD.y,
            SHARD_Z_CENTER + (Math.random() * 2 - 1) * SHARD_FIELD.z,
          );
          shardEuler.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
          shardQuaternion.setFromEuler(shardEuler);
          shardScale.setScalar(SHARD_MIN_SCALE + Math.random() * (SHARD_MAX_SCALE - SHARD_MIN_SCALE));
          shardMatrix.compose(shardPosition, shardQuaternion, shardScale);
          instanced.setMatrixAt(instanceIndex, shardMatrix);
        }
        instanced.instanceMatrix.needsUpdate = true;
        scene.add(instanced);
        shardMeshes.push(instanced);
        shardGeometries.push(geometry);
        shardMaterials.push(material);
      }

      // Light the focused meteor immediately (no cross-fade on first build).
      applyFocus(activeIndexRef.current, true);
      onStatus({ isLoading: false, percent: 100 });
    };

    // The meteor model and the textures load in parallel; build only when BOTH are ready. tryBuild
    // is called from each side so whichever finishes last triggers the build (order-independent).
    let texturesReady = false;
    const tryBuild = () => {
      if (texturesReady && meteorBaseGeometry) buildField();
    };
    loadingManager.onLoad = () => { texturesReady = true; tryBuild(); };

    // Load the meteor body (Draco-compressed). Routed through the same manager so its bytes count
    // toward the loading percentage. On failure we fall back to the faceted crystal so Works still builds.
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    const gltfLoader = new GLTFLoader(loadingManager);
    gltfLoader.setDRACOLoader(dracoLoader);
    gltfLoader.load(
      METEOR_MODEL_PATH,
      (gltf) => {
        meteorBaseGeometry = meteorGeometryFromModel(gltf.scene);
        tryBuild();
      },
      undefined,
      (error) => {
        console.error(`Failed to load meteor model: ${METEOR_MODEL_PATH}`, error);
        meteorBaseGeometry = new THREE.IcosahedronGeometry(1, METEOR_DETAIL);
        tryBuild();
      },
    );

    // ── Ignite / cool ──
    const igniteMeteor = (rig: MeteorRig, instant: boolean) => {
      gsap.killTweensOf(rig.fireUniforms.uIgnite);
      gsap.killTweensOf(rig.stoneMaterial);
      if (instant || reduceMotion) {
        rig.fireUniforms.uIgnite.value = 1;
        rig.stoneMaterial.opacity = 0;
        return;
      }
      gsap.to(rig.fireUniforms.uIgnite, { value: 1, duration: IGNITE_DURATION, ease: 'power2.out', overwrite: true });
      gsap.to(rig.stoneMaterial, { opacity: 0, duration: IGNITE_DURATION, ease: 'power2.out', overwrite: true });
    };
    const coolMeteor = (rig: MeteorRig, instant: boolean) => {
      gsap.killTweensOf(rig.fireUniforms.uIgnite);
      gsap.killTweensOf(rig.stoneMaterial);
      if (instant || reduceMotion) {
        rig.fireUniforms.uIgnite.value = 0;
        rig.stoneMaterial.opacity = 1;
        return;
      }
      gsap.to(rig.fireUniforms.uIgnite, { value: 0, duration: COOL_DURATION, ease: 'power2.in', overwrite: true });
      gsap.to(rig.stoneMaterial, { opacity: 1, duration: COOL_DURATION, ease: 'power2.in', overwrite: true });
    };

    // Focus a project: warp the camera to its meteor, ignite it, cool the rest.
    let stagedIndex = activeIndexRef.current;
    const applyFocus = (index: number, instant: boolean) => {
      stagedIndex = index;
      focusTarget.fromArray(METEOR_LAYOUT[index].position);
      // Launch the eased warp hop from wherever the camera is now to the new meteor.
      if (!instant && !reduceMotion) startTravel();
      meteorRigs.forEach((rig, rigIndex) => {
        if (rigIndex === index) igniteMeteor(rig, instant);
        else coolMeteor(rig, instant);
      });
      if (instant) updateCamera(true);
    };

    const setFocus = (index: number) => {
      if (index === stagedIndex || !meteorRigs.length) return;
      applyFocus(index, false);
    };
    setFocusRef.current = setFocus;

    // Re-ignite the focused meteor when the section scrolls back into view.
    const replayReveal = () => {
      if (!meteorRigs.length) return;
      const index = activeIndexRef.current;
      const rig = meteorRigs[index];
      // Snap it dark, then light it up, so the ignition visibly re-plays.
      rig.fireUniforms.uIgnite.value = 0;
      rig.stoneMaterial.opacity = 1;
      applyFocus(index, false);
    };
    window.addEventListener(WORKS_REVEAL_EVENT, replayReveal);

    // ── Drag-to-look ──
    const drag = { active: false, startX: 0, startY: 0 };
    const handlePointerDown = (event: PointerEvent) => {
      if (reduceMotion) return;
      drag.active = true;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!drag.active) return;
      viewYawTarget = THREE.MathUtils.clamp(
        (event.clientX - drag.startX) * DRAG_YAW_SENSITIVITY, -DRAG_YAW_CLAMP, DRAG_YAW_CLAMP,
      );
      viewPitchTarget = THREE.MathUtils.clamp(
        (event.clientY - drag.startY) * DRAG_PITCH_SENSITIVITY, -DRAG_PITCH_CLAMP, DRAG_PITCH_CLAMP,
      );
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!drag.active) return;
      drag.active = false;
      canvas.releasePointerCapture?.(event.pointerId);
      // Spring the look back to centre (the eased return in updateCamera does the travel).
      viewYawTarget = 0;
      viewPitchTarget = 0;
    };
    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    // ── Render loop ──
    const clock = new THREE.Clock();
    let frameId = 0;
    // Warp state — read from the camera's own speed each frame so the streaks + FOV follow the exact
    // launch/arrive curve of the travel tween (longer hops naturally streak harder).
    const previousCameraPosition = new THREE.Vector3();
    const streakDirection = new THREE.Vector3(0, 0, 1);
    let hasPreviousCameraPosition = false;
    let warp = 0;
    const renderFrame = () => {
      frameId = requestAnimationFrame(renderFrame);
      const deltaSeconds = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);
      const elapsed = clock.elapsedTime;

      starSystem.group.rotation.y = elapsed * STAR_DRIFT;
      shardMeshes.forEach((mesh, meshIndex) => {
        // Opposite drift on the two fields gives the debris a parallax shimmer.
        mesh.rotation.y = elapsed * SHARD_DRIFT_SPEED * (meshIndex === 0 ? 1 : -1);
      });

      const focused = activeIndexRef.current;
      meteorRigs.forEach((rig, rigIndex) => {
        const isFocused = rigIndex === focused && !reduceMotion;
        // Only the burning meteor animates; the rest hold their resting tilt.
        if (isFocused) {
          rig.group.rotation.y += METEOR_SPIN_SPEED * deltaSeconds;
          rig.group.position.y = rig.basePosition.y + Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE;
          rig.fireUniforms.uTime.value += deltaSeconds;
          rig.fireUniforms.uFlare.value = FLARE_BASE + Math.sin(elapsed * FLARE_SPEED) * FLARE_AMPLITUDE;
        } else if (rig.group.position.y !== rig.basePosition.y) {
          // Settle a just-unfocused meteor back onto its resting height (it may have frozen mid-bob).
          rig.group.position.y = rig.basePosition.y;
        }
      });

      updateCamera(false);

      // Warp intensity = the camera's speed this frame, normalised and smoothed. It rises as the hop
      // launches and falls as it arrives, so the streaks stretch + the FOV widens in lockstep.
      if (hasPreviousCameraPosition && !reduceMotion) {
        const cameraSpeed = camera.position.distanceTo(previousCameraPosition) / deltaSeconds;
        const warpTarget = THREE.MathUtils.clamp(cameraSpeed / WARP_REFERENCE_SPEED, 0, 1);
        warp += (warpTarget - warp) * WARP_SMOOTHING;
        if (cameraSpeed > 1e-4) {
          streakDirection.subVectors(camera.position, previousCameraPosition).normalize();
        }
      } else {
        warp = 0;
      }
      previousCameraPosition.copy(camera.position);
      hasPreviousCameraPosition = true;

      // Drive the star-streaks + FOV kick off the warp.
      starSystem.streakUniforms.uStreakLength.value = warp * STREAK_MAX_LENGTH;
      starSystem.streakUniforms.uOpacity.value = warp * STREAK_MAX_OPACITY;
      starSystem.streakUniforms.uStreakDir.value.copy(streakDirection);
      const targetFov = CAMERA_FOV + warp * FOV_KICK;
      if (Math.abs(camera.fov - targetFov) > 0.01) {
        camera.fov = targetFov;
        camera.updateProjectionMatrix();
      }

      composer.render();
    };
    renderFrame();

    // ── Resize ──
    const handleResize = () => {
      const width  = canvas.clientWidth  || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      const aspect = width / height;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      // Portrait → pull the camera back so the meteor doesn't overflow the narrow frame.
      distanceScale = aspect < 1 ? THREE.MathUtils.clamp(1 / aspect, 1, 1.9) : 1;
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
    };
    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas.parentElement ?? canvas);

    // ── Dev tuning panel (?tune) — the focused fire + the bloom ──
    let destroyGui: (() => void) | undefined;
    if (new URLSearchParams(window.location.search).has('tune')) {
      import('lil-gui')
        .then(({ default: GUI }) => {
          const gui = new GUI({ title: 'Works · fire + bloom' });
          const bloomFolder = gui.addFolder('Bloom');
          bloomFolder.add(bloomPass, 'strength', 0, 3, 0.01);
          bloomFolder.add(bloomPass, 'radius', 0, 2, 0.01);
          bloomFolder.add(bloomPass, 'threshold', 0, 1, 0.01);

          const focusedUniforms = () => meteorRigs[activeIndexRef.current]?.fireUniforms;
          const fire = { noiseScale: 2.6, flowSpeed: 0.5, contrast: 1.3, mid: '#ff7a2a', hot: '#fff1c8', ember: '#3a0a02' };
          const fireFolder = gui.addFolder('Fire (focused)');
          fireFolder.add(fire, 'noiseScale', 0.5, 6, 0.05).onChange((value: number) => { const u = focusedUniforms(); if (u) u.uNoiseScale.value = value; });
          fireFolder.add(fire, 'flowSpeed', 0, 2, 0.01).onChange((value: number) => { const u = focusedUniforms(); if (u) u.uFlowSpeed.value = value; });
          fireFolder.add(fire, 'contrast', 0.5, 3, 0.01).onChange((value: number) => { const u = focusedUniforms(); if (u) u.uContrast.value = value; });
          fireFolder.addColor(fire, 'ember').onChange((value: string) => { const u = focusedUniforms(); if (u) u.uEmber.value.set(value); });
          fireFolder.addColor(fire, 'mid').onChange((value: string) => { const u = focusedUniforms(); if (u) u.uMid.value.set(value); });
          fireFolder.addColor(fire, 'hot').onChange((value: string) => { const u = focusedUniforms(); if (u) u.uHot.value.set(value); });
          destroyGui = () => gui.destroy();
        })
        .catch(() => {});
    }

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      destroyGui?.();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener(WORKS_REVEAL_EVENT, replayReveal);

      meteorRigs.forEach((rig) => {
        gsap.killTweensOf(rig.fireUniforms.uIgnite);
        gsap.killTweensOf(rig.stoneMaterial);
        rig.geometry.dispose();
        rig.stoneMaterial.dispose();
        rig.fireMaterial.dispose();
      });
      shardGeometries.forEach((geometry) => geometry.dispose());
      shardMaterials.forEach((material) => material.dispose());
      shardMeshes = [];
      meteorBaseGeometry?.dispose();
      dracoLoader.dispose();
      disposableTextures.forEach((texture) => texture.dispose());
      gsap.killTweensOf(travelProgress);
      starSystem.dispose();
      pmremGenerator.dispose();
      scene.environment?.dispose();
      // EffectComposer.dispose() doesn't free added passes — release the bloom pyramid explicitly.
      bloomPass.dispose();
      composer.dispose();
      renderer.dispose();
    };
    // Setup runs once; focus changes are read live via activeIndexRef / the selection effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to focus changes: re-stage the existing scene (fly camera, ignite/cool).
  useEffect(() => {
    setFocusRef.current(activeIndex);
  }, [activeIndex]);
}
