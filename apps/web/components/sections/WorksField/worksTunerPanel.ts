import * as THREE from 'three';
import type GUI from 'lil-gui';
import { getTunerDock, dockPanel } from '@/lib/tunerDock';
import { formatTuningSource, registerTuningExport } from '@/lib/tunerExport';
import { registerTuningReset } from '@/lib/tunerReset';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  getWritableWorksTuning,
  resetWorksTuning,
  FLIGHT_LANDING_KEY,
  type ProjectViewKey,
} from './worksTuning';

/**
 * The works field's authoring panel — `?tune` only, dynamically imported, never in the shipped bundle.
 *
 * Same job as the chamber's, for the same reason: where the camera should stand to present a project,
 * and what route it takes to the next one, are judged by eye or not at all. You fly, you record, you
 * paste the result into worksTuning.ts.
 *
 * ── Why it has to fly the camera ─────────────────────────────────────────────────────────────────
 * The field's camera is a pure function of the authored path, so the only poses it can reach are the
 * ones the path already visits. Recording off that could only ever reproduce the path that exists. So
 * the panel takes the camera outright and hands it back when you're done.
 *
 * ── The rule the panel enforces ──────────────────────────────────────────────────────────────────
 * Stop 0 must equal the services→works flight's landing pose, or the ship's arrival ends somewhere the
 * browsing camera isn't. That's what the "reset stop 0 to flight landing" button is for — it is not a
 * convenience, it's the repair for the one mistake that silently tears the seam.
 */

const MOVE_SPEED = 4;
const SPRINT_MULTIPLIER = 3;
const LOOK_SENSITIVITY = 0.0026;
const PITCH_LIMIT = Math.PI / 2 - 0.02;
/** How far in front of the camera a recorded key's aim point lands. */
const TARGET_DISTANCE = 7;

const MOVE_KEYS: Record<string, [number, number, number]> = {
  // [right, up, forward]
  KeyW: [0, 0, 1],
  KeyS: [0, 0, -1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0],
};

interface WorksTunerOptions {
  camera: THREE.PerspectiveCamera;
  bloomPass: UnrealBloomPass;
  /** Take the camera (or hand it back with `null`). */
  setCameraOverride: (
    drive: ((deltaSeconds: number, camera: THREE.PerspectiveCamera) => void) | null,
  ) => void;
  /** Rebuild the rock — its silhouette is baked into geometry, so a shape change needs a new one. */
  rebuildMeteor: () => void;
  /** Re-derive the spline from the key list, after keys are added, replaced or removed. */
  rebuildPath: () => void;
  onDispose: (cleanup: () => void) => void;
}

function formatKey(key: ProjectViewKey): string {
  const round = (value: number) => Number(value.toFixed(2));
  return (
    `  { x: ${round(key.x)}, y: ${round(key.y)}, z: ${round(key.z)}, ` +
    `tx: ${round(key.tx)}, ty: ${round(key.ty)}, tz: ${round(key.tz)}, ` +
    `fov: ${round(key.fov)}, stop: ${key.stop === null ? 'null' : key.stop} },`
  );
}

export async function createWorksTunerPanel({
  camera,
  bloomPass,
  setCameraOverride,
  rebuildMeteor,
  rebuildPath,
  onDispose,
}: WorksTunerOptions): Promise<void> {
  const { default: LilGui } = await import('lil-gui');
  const tuning = getWritableWorksTuning();

  // Docked into the shared left-hand column, so the three authoring panels stack instead of
  // landing on top of one another in lil-gui's default top-right corner.
  const gui: GUI = new LilGui({ title: 'Works · authoring', container: getTunerDock() });
  dockPanel(gui.domElement);

  const flyState = { enabled: false, speed: MOVE_SPEED, yaw: 0, pitch: 0 };
  const heldKeys = new Set<string>();
  const look = { dragging: false, lastX: 0, lastY: 0 };
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  const drive = (deltaSeconds: number, driven: THREE.PerspectiveCamera) => {
    forward.set(
      Math.sin(flyState.yaw) * Math.cos(flyState.pitch),
      Math.sin(flyState.pitch),
      Math.cos(flyState.yaw) * Math.cos(flyState.pitch),
    );
    right.crossVectors(forward, WORLD_UP).normalize();

    let moveRight = 0;
    let moveUp = 0;
    let moveForward = 0;
    heldKeys.forEach((code) => {
      const axis = MOVE_KEYS[code];
      if (!axis) return;
      moveRight += axis[0];
      moveUp += axis[1];
      moveForward += axis[2];
    });

    const sprinting = heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight');
    const step = flyState.speed * deltaSeconds * (sprinting ? SPRINT_MULTIPLIER : 1);
    driven.position
      .addScaledVector(forward, moveForward * step)
      .addScaledVector(right, moveRight * step)
      .addScaledVector(WORLD_UP, moveUp * step);

    driven.up.copy(WORLD_UP);
    driven.lookAt(
      driven.position.x + forward.x,
      driven.position.y + forward.y,
      driven.position.z + forward.z,
    );
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!flyState.enabled) return;
    if (event.target instanceof HTMLInputElement) return; // typing into a panel field
    if (MOVE_KEYS[event.code] || event.code.startsWith('Shift')) {
      heldKeys.add(event.code);
      event.preventDefault();
    }
  };
  const handleKeyUp = (event: KeyboardEvent) => heldKeys.delete(event.code);
  const handlePointerDown = (event: PointerEvent) => {
    if (!flyState.enabled) return;
    if (gui.domElement.contains(event.target as Node)) return; // dragging a slider, not looking
    look.dragging = true;
    look.lastX = event.clientX;
    look.lastY = event.clientY;
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (!look.dragging) return;
    flyState.yaw -= (event.clientX - look.lastX) * LOOK_SENSITIVITY;
    flyState.pitch = THREE.MathUtils.clamp(
      flyState.pitch - (event.clientY - look.lastY) * LOOK_SENSITIVITY,
      -PITCH_LIMIT,
      PITCH_LIMIT,
    );
    look.lastX = event.clientX;
    look.lastY = event.clientY;
  };
  const handlePointerUp = () => {
    look.dragging = false;
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);

  const setFlying = (enabled: boolean) => {
    flyState.enabled = enabled;
    heldKeys.clear();
    look.dragging = false;
    if (!enabled) {
      setCameraOverride(null);
      return;
    }
    // Pick up exactly where the path left the camera, so taking control never jumps the view.
    camera.getWorldDirection(forward);
    flyState.yaw = Math.atan2(forward.x, forward.z);
    flyState.pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    setCameraOverride(drive);
  };

  const captureKey = (stop: number | null): ProjectViewKey => {
    camera.getWorldDirection(forward);
    return {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      tx: camera.position.x + forward.x * TARGET_DISTANCE,
      ty: camera.position.y + forward.y * TARGET_DISTANCE,
      tz: camera.position.z + forward.z * TARGET_DISTANCE,
      fov: camera.fov,
      stop,
    };
  };

  const keyActions = {
    selected: 0,
    recordStop: () => {
      // The next unused project index, so recording stops in order just works. Counting existing stops
      // rather than tracking a counter means deleting a stop frees its number again.
      const nextStop = tuning.keys.filter((key) => key.stop !== null).length;
      tuning.keys.splice(keyActions.selected + 1, 0, captureKey(nextStop));
      keyActions.selected += 1;
      refresh();
    },
    recordTransit: () => {
      tuning.keys.splice(keyActions.selected + 1, 0, captureKey(null));
      keyActions.selected += 1;
      refresh();
    },
    replaceSelected: () => {
      const existing = tuning.keys[keyActions.selected];
      if (!existing) return;
      tuning.keys[keyActions.selected] = captureKey(existing.stop);
      refresh();
    },
    deleteSelected: () => {
      if (tuning.keys.length <= 1) return;
      tuning.keys.splice(keyActions.selected, 1);
      keyActions.selected = Math.max(0, keyActions.selected - 1);
      refresh();
    },
    goToSelected: () => {
      const key = tuning.keys[keyActions.selected];
      if (!key) return;
      camera.position.set(key.x, key.y, key.z);
      forward.set(key.tx - key.x, key.ty - key.y, key.tz - key.z).normalize();
      flyState.yaw = Math.atan2(forward.x, forward.z);
      flyState.pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
      camera.fov = key.fov;
      camera.updateProjectionMatrix();
    },
    resetFirstStop: () => {
      // The seam repair. Stop 0 IS the flight's landing pose; anything else tears the arrival.
      const firstStopIndex = tuning.keys.findIndex((key) => key.stop === 0);
      if (firstStopIndex === -1) return;
      tuning.keys[firstStopIndex] = { ...FLIGHT_LANDING_KEY, stop: 0 };
      refresh();
    },
    copyKeys: () => {
      const source = [
        'export const PROJECT_VIEW_KEYS: ProjectViewKey[] = [',
        ...tuning.keys.map(formatKey),
        '];',
      ].join('\n');
      navigator.clipboard?.writeText(source).catch(() => {});
      console.log(source);
    },
  };

  const rockFolder = gui.addFolder('The rock');
  const reshape = () => rebuildMeteor();
  rockFolder.add(tuning, 'meteorRadius', 0.5, 12, 0.05).onFinishChange(reshape);
  rockFolder.add(tuning, 'meteorDetail', 1, 6, 1).onFinishChange(reshape);
  rockFolder.add(tuning, 'meteorSeed', 1, 200, 1).onFinishChange(reshape).name('seed (silhouette)');
  rockFolder.add(tuning, 'meteorStretchX', 0.4, 2, 0.01).onFinishChange(reshape);
  rockFolder.add(tuning, 'meteorStretchY', 0.4, 2, 0.01).onFinishChange(reshape);
  rockFolder.add(tuning, 'meteorStretchZ', 0.4, 2, 0.01).onFinishChange(reshape);
  rockFolder.add(tuning, 'meteorFlatShading').onFinishChange(reshape);
  rockFolder.add(tuning, 'meteorX', -20, 20, 0.05);
  rockFolder.add(tuning, 'meteorY', -20, 20, 0.05);
  rockFolder.add(tuning, 'meteorZ', -20, 20, 0.05);
  rockFolder.add(tuning, 'meteorSpin', -30, 30, 0.1).name('spin °/sec');

  const surfaceFolder = gui.addFolder('Surface');
  surfaceFolder.add(tuning, 'meteorEmissive', 0, 6, 0.05).name('vein glow');
  surfaceFolder.addColor(tuning, 'meteorEmissiveColor').name('vein colour');
  surfaceFolder.addColor(tuning, 'meteorColor').name('rock tint');
  surfaceFolder.add(tuning, 'meteorRoughness', 0, 1, 0.01);
  surfaceFolder.add(tuning, 'meteorMetalness', 0, 1, 0.01);
  surfaceFolder.add(tuning, 'meteorTextureRepeat', 0.25, 8, 0.25).name('texture tiling');

  const bloomFolder = gui.addFolder('Bloom');
  bloomFolder.add(bloomPass, 'strength', 0, 3, 0.01);
  bloomFolder.add(bloomPass, 'radius', 0, 2, 0.01);
  bloomFolder.add(bloomPass, 'threshold', 0, 1, 0.01);
  bloomFolder.close();

  const pathFolder = gui.addFolder('Camera path');
  pathFolder.add(flyState, 'enabled').name('free fly (WASD / QE / drag)').onChange(setFlying);
  pathFolder.add(flyState, 'speed', 0.5, 25, 0.1).name('fly speed');
  pathFolder.add(tuning, 'travelSeconds', 0.2, 8, 0.05).name('hop seconds');
  pathFolder.add(tuning, 'evenPacing').name('even pacing');
  const selectedController = pathFolder
    .add(keyActions, 'selected', 0, Math.max(tuning.keys.length - 1, 0), 1)
    .name('key');
  pathFolder.add(keyActions, 'goToSelected').name('▸ go to key');
  pathFolder.add(keyActions, 'recordStop').name('+ record STOP (a project)');
  pathFolder.add(keyActions, 'recordTransit').name('+ record transit');
  pathFolder.add(keyActions, 'replaceSelected').name('⟳ replace key');
  pathFolder.add(keyActions, 'deleteSelected').name('− delete key');
  pathFolder.add(keyActions, 'resetFirstStop').name('⚠ reset stop 0 → flight landing');
  pathFolder.add(keyActions, 'copyKeys').name('⧉ copy keys → clipboard');

  // Every edit to the key list has to re-derive the scene's spline from it, or the panel and the camera
  // are looking at two different paths.
  function refresh() {
    rebuildPath();
    selectedController.max(Math.max(tuning.keys.length - 1, 0));
    selectedController.updateDisplay();
  }

  // ── Reset ──
  // The rock's silhouette is baked into geometry and the camera path is a precomputed spline, so a
  // reset has to rebuild both — restoring the numbers alone would leave the scene showing the old shape.
  const resetWorks = () => {
    resetWorksTuning();
    rebuildMeteor();
    refresh(); // rebuilds the path + re-ranges the key slider
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  };
  const stopReset = registerTuningReset('works', resetWorks);
  pathFolder.add({ reset: resetWorks }, 'reset').name('↺ reset works to shipped');

  const stopExport = registerTuningExport(
    'WORKS · components/sections/WorksField/worksTuning.ts',
    () =>
      [
        '// → the WORKS_TUNING literal (minus `keys`, which is the const below)',
        formatTuningSource(tuning, ['keys']),
        '',
        '// → replaces PROJECT_VIEW_KEYS',
        'export const PROJECT_VIEW_KEYS: ProjectViewKey[] = [',
        ...tuning.keys.map(formatKey),
        '];',
      ].join('\n'),
  );

  onDispose(() => {
    stopExport();
    stopReset();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('pointerdown', handlePointerDown);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    setCameraOverride(null);
    gui.destroy();
  });
}
