import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * The scene a mark is judged in — camera, lights, environment probe, bloom, and the spin rig.
 *
 * ── Why this is shared and not copied ────────────────────────────────────────────────────────────
 * Every one of these numbers is matched to the works field, so that a judgement made in a lab
 * transfers to the section. The moment there are two labs there are two copies, and two copies drift —
 * at which point the comparison is between lighting rigs rather than between marks. The transition rig
 * compares FOUR candidates, and the whole exercise is void if any of them can bring its own light.
 *
 * `useLetterLab` still builds its own identical rig; it should adopt this, and the values here were
 * taken from it unchanged so that swap is a deletion rather than a re-tune.
 *
 * ── What a caller still owns ─────────────────────────────────────────────────────────────────────
 * Drag-to-inspect, the render loop, and anything it puts inside `spin`. This module is the stage.
 */

/** Largest dimension of every mark, in world units. The one number nothing is allowed to disagree on. */
export const MARK_LAB_TARGET_SIZE = 2.6;

const CAMERA_FOV = 38;
const CAMERA_DISTANCE = 6.2;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100;

// Matched to the works field so a mark is lit the way it would ship.
const KEY_LIGHT_COLOR = 0xdfe7ff;
const KEY_LIGHT_INTENSITY = 2.1;
const FILL_LIGHT_COLOR = 0x2a3550;
const FILL_LIGHT_INTENSITY = 0.6;
const AMBIENT_INTENSITY = 0.18;
const TONE_MAPPING_EXPOSURE = 1.15;

const BLOOM_STRENGTH = 0.9;
const BLOOM_RADIUS = 0.55;
const BLOOM_THRESHOLD = 0.6;
const BLOOM_MSAA_SAMPLES = 4;

/** Blur applied to the room probe. The works field's value — same probe, same look. */
const ENVIRONMENT_BLUR = 0.04;

const MAX_DEVICE_PIXEL_RATIO = 2;

export interface MarkLabRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  /** Put the subject in here — drag rotation and idle spin compose on it without fighting. */
  spin: THREE.Group;
  /** Re-frame to the canvas's parent. Call from a ResizeObserver and once on setup. */
  resize: () => void;
  dispose: () => void;
}

export function createMarkLabRig(canvas: HTMLCanvasElement): MarkLabRig {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  // Left OFF so a caller can total a whole frame across every composer pass — see the note in
  // `useTransitionLab`. With the default on, `renderer.info` is reset by each pass's own render() call
  // and ends up describing the last fullscreen quad instead of the frame.
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  // Image-based lighting, matching the works field. Without it every material's `envMapIntensity`
  // multiplies nothing — matte stone barely notices, but anything with a specular read depends on it.
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  const environmentTarget = pmremGenerator.fromScene(roomEnvironment, ENVIRONMENT_BLUR);
  scene.environment = environmentTarget.texture;

  const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY);
  keyLight.position.set(4, 5, 6);
  const fillLight = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
  fillLight.position.set(-5, -2, 3);
  scene.add(keyLight, fillLight, new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  composer.addPass(bloomPass);
  // MSAA on the composer's targets — `antialias: true` is ignored once a composer does the rendering.
  composer.renderTarget1.samples = BLOOM_MSAA_SAMPLES;
  composer.renderTarget2.samples = BLOOM_MSAA_SAMPLES;

  const spin = new THREE.Group();
  scene.add(spin);

  const resize = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    // `composer.setSize` multiplies by the device pixel ratio and forwards the result to every pass,
    // bloom included — so there is deliberately no `bloomPass.resolution.set(...)` here. Assigning that
    // afterwards (as `useLetterLab` still does) is inert: the pass only reads `resolution` inside its
    // own `setSize`, which has already run and which would overwrite it next time anyway. Harmless, but
    // it reads like it is doing something.
    composer.setSize(width, height);
  };
  resize();

  return {
    renderer,
    scene,
    camera,
    composer,
    spin,
    resize,
    dispose: () => {
      environmentTarget.dispose();
      pmremGenerator.dispose();
      bloomPass.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
