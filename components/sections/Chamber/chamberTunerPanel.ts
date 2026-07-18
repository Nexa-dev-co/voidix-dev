import * as THREE from 'three';
import type GUI from 'lil-gui';
import { getWritableChamberTuning, type ShowcaseKey } from '@/lib/chamberTuning';
import type { ChamberScene } from './chamberScene';

/**
 * The chamber's authoring panel — `?tune` only, dynamically imported, never in the shipped bundle.
 *
 * The chamber's numbers can't be arrived at by reasoning. Where a camera should stand, what it should
 * be looking at, how big the display reads from across the room — these are judged by eye or not at
 * all, and there are over a hundred of them. So they're authored here against the live scene and then
 * baked into chamberTuning.ts.
 *
 * ── Why it needs to fly the camera ───────────────────────────────────────────────────────────────
 * The chamber's camera is a pure function of the reveal's scroll progress. That's a good property — it
 * makes the whole cinematic reversible for free — but it means the only poses reachable are the ones
 * the CURRENT tour already visits. Recording keys off that could only ever reproduce the tour that
 * already exists. So the panel borrows the camera outright (`setCameraOverride`), flies it on WASD +
 * mouse-look, and records where you put it.
 *
 * ── The output ───────────────────────────────────────────────────────────────────────────────────
 * "copy keys" writes a ready-to-paste `ShowcaseKey[]` literal to the clipboard. Paste it over
 * SHOWCASE_KEYS in chamberTuning.ts and the tour is the one you just flew.
 */

// ── Free-fly ─────────────────────────────────────────────────────────────────────────────────────
const MOVE_SPEED = 3.2; // world units per second
const SPRINT_MULTIPLIER = 3;
const LOOK_SENSITIVITY = 0.0026; // radians per pixel of drag
// Straight up is a singularity for yaw/pitch look — clamp just short of it so the view can't invert.
const PITCH_LIMIT = Math.PI / 2 - 0.02;
// How far in front of the camera a recorded key's aim point is placed. The tour splines the AIM as its
// own channel, so this only sets how far away the look-at sits — far enough that small position drift
// between neighbouring keys doesn't swing the aim wildly.
const TARGET_DISTANCE = 8;

const MOVE_KEYS: Record<string, [number, number, number]> = {
  // [right, up, forward]
  KeyW: [0, 0, 1],
  KeyS: [0, 0, -1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0],
};

interface ChamberTunerOptions {
  scene: ChamberScene;
  /** Torn down with the scene. */
  onDispose: (cleanup: () => void) => void;
}

/** Format one key as a single source line, matching how SHOWCASE_KEYS is written by hand. */
function formatKey(key: ShowcaseKey): string {
  const round = (value: number) => Number(value.toFixed(2));
  return (
    `  { x: ${round(key.x)}, y: ${round(key.y)}, z: ${round(key.z)}, ` +
    `tx: ${round(key.tx)}, ty: ${round(key.ty)}, tz: ${round(key.tz)}, ` +
    `sx: ${round(key.sx)}, sy: ${round(key.sy)}, sz: ${round(key.sz)}, ` +
    `syaw: ${round(key.syaw)}, spitch: ${round(key.spitch)}, sroll: ${round(key.sroll)}, ` +
    `sh: ${round(key.sh)} },`
  );
}

export async function createChamberTunerPanel({
  scene,
  onDispose,
}: ChamberTunerOptions): Promise<void> {
  const { default: LilGui } = await import('lil-gui');
  const tuning = getWritableChamberTuning();
  const camera = scene.camera;

  const gui: GUI = new LilGui({ title: 'Chamber · authoring' });
  // The panel sits over a fixed, full-screen canvas; without this it scrolls away with the page.
  gui.domElement.style.zIndex = '10002';

  // ── Free-fly state ──
  const flyState = {
    enabled: false,
    speed: MOVE_SPEED,
    yaw: 0,
    pitch: 0,
  };
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
    // Don't swallow typing into the panel's own number fields.
    if (event.target instanceof HTMLInputElement) return;
    if (MOVE_KEYS[event.code] || event.code.startsWith('Shift')) {
      heldKeys.add(event.code);
      event.preventDefault();
    }
  };
  const handleKeyUp = (event: KeyboardEvent) => heldKeys.delete(event.code);
  const handlePointerDown = (event: PointerEvent) => {
    if (!flyState.enabled) return;
    // Dragging inside the panel is adjusting a slider, not looking around.
    if (gui.domElement.contains(event.target as Node)) return;
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
      scene.setCameraOverride(null);
      return;
    }
    // Pick up exactly where the reveal left the camera, so taking control never jumps the view. The
    // camera's own forward vector gives the yaw/pitch the free-fly then steers from.
    camera.getWorldDirection(forward);
    flyState.yaw = Math.atan2(forward.x, forward.z);
    flyState.pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    scene.setCameraOverride(drive);
  };

  // ── Keys ──
  const captureKey = (): ShowcaseKey => {
    camera.getWorldDirection(forward);
    return {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      tx: camera.position.x + forward.x * TARGET_DISTANCE,
      ty: camera.position.y + forward.y * TARGET_DISTANCE,
      tz: camera.position.z + forward.z * TARGET_DISTANCE,
      // The screen is recorded as it currently sits, so a key carries the display's pose with it —
      // that's what lets the tour lift the feed off the table and carry it across the room.
      sx: tuning.rigX,
      sy: tuning.rigY,
      sz: tuning.rigZ,
      syaw: tuning.rigYaw,
      spitch: tuning.rigPitch,
      sroll: tuning.rigRoll,
      sh: tuning.displayHeight,
    };
  };

  const keyActions = {
    selected: 0,
    append: () => {
      tuning.showcaseKeys.push(captureKey());
      keyActions.selected = tuning.showcaseKeys.length - 1;
      refreshKeyDisplay();
    },
    replaceSelected: () => {
      if (!tuning.showcaseKeys[keyActions.selected]) return;
      tuning.showcaseKeys[keyActions.selected] = captureKey();
      refreshKeyDisplay();
    },
    deleteSelected: () => {
      if (tuning.showcaseKeys.length === 0) return;
      tuning.showcaseKeys.splice(keyActions.selected, 1);
      keyActions.selected = Math.max(0, keyActions.selected - 1);
      refreshKeyDisplay();
    },
    goToSelected: () => {
      const key = tuning.showcaseKeys[keyActions.selected];
      if (!key) return;
      camera.position.set(key.x, key.y, key.z);
      forward.set(key.tx - key.x, key.ty - key.y, key.tz - key.z).normalize();
      flyState.yaw = Math.atan2(forward.x, forward.z);
      flyState.pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    },
    copyKeys: () => {
      const source = [
        'export const SHOWCASE_KEYS: ShowcaseKey[] = [',
        ...tuning.showcaseKeys.map(formatKey),
        '];',
      ].join('\n');
      // The clipboard needs a user gesture and a secure context; a button click is one, but localhost
      // over plain http on some browsers is not — so always log it too, and the copy is a convenience.
      navigator.clipboard?.writeText(source).catch(() => {});
      console.log(source);
    },
  };

  const guiFolder = (title: string) => gui.addFolder(title);

  const displayFolder = guiFolder('Display');
  displayFolder.add(tuning, 'rigX', -20, 20, 0.01);
  displayFolder.add(tuning, 'rigY', -5, 10, 0.01);
  displayFolder.add(tuning, 'rigZ', -20, 20, 0.01);
  displayFolder.add(tuning, 'rigYaw', -180, 360, 1);
  displayFolder.add(tuning, 'rigPitch', -180, 180, 1);
  displayFolder.add(tuning, 'rigRoll', -180, 180, 1);
  displayFolder.add(tuning, 'displayHeight', 0.1, 6, 0.01);
  displayFolder.close();

  const tableFolder = guiFolder('Table');
  tableFolder.add(tuning, 'showTable');
  tableFolder.add(tuning, 'tableScaleX', 0.05, 5, 0.01);
  tableFolder.add(tuning, 'tableScaleY', 0.05, 5, 0.01);
  tableFolder.add(tuning, 'tableScaleZ', 0.05, 5, 0.01);
  tableFolder.add(tuning, 'tableX', -20, 20, 0.01);
  tableFolder.add(tuning, 'tableY', -5, 10, 0.01);
  tableFolder.add(tuning, 'tableZ', -20, 20, 0.01);
  tableFolder.add(tuning, 'tableRotX', -180, 180, 1);
  tableFolder.add(tuning, 'tableRotY', -360, 360, 1);
  tableFolder.add(tuning, 'tableRotZ', -180, 180, 1);
  tableFolder.addColor(tuning, 'tableColor');
  tableFolder.close();

  const groundFolder = guiFolder('Ground');
  groundFolder.add(tuning, 'showGround');
  groundFolder.add(tuning, 'groundY', -5, 5, 0.01);
  groundFolder.add(tuning, 'groundCell', 0.1, 10, 0.05);
  groundFolder.add(tuning, 'groundLineWidth', 0.5, 6, 0.1);
  groundFolder.add(tuning, 'groundFade', 2, 120, 0.5);
  groundFolder.add(tuning, 'groundOpacity', 0, 3, 0.01);
  groundFolder.add(tuning, 'groundGlowRadius', 0, 20, 0.1);
  groundFolder.add(tuning, 'groundGlowStrength', 0, 3, 0.01);
  groundFolder.addColor(tuning, 'groundColor').name('unlit (dark)');
  groundFolder.addColor(tuning, 'groundColorLit').name('lit (white) — shared');
  groundFolder.addColor(tuning, 'groundLineColor').name('grid lines');
  groundFolder.addColor(tuning, 'groundGlowColor').name('hologram pool tint');

  const wallsFolder = guiFolder('Walls');
  wallsFolder.add(tuning, 'showWalls');
  wallsFolder.add(tuning, 'wallRadius', 2, 60, 0.5).name('radius (clips floor)');
  wallsFolder.add(tuning, 'wallHeight', 1, 40, 0.5);
  wallsFolder.add(tuning, 'wallFadeStart', 0, 1, 0.01).name('holds full until');
  wallsFolder.addColor(tuning, 'wallColor').name('wall colour');
  wallsFolder.add(tuning, 'wallOpacity', 0, 1, 0.01);

  // Named for what it is: the room's lighting, which the floor and the walls share.
  const igniteFolder = guiFolder('Room · lights on');
  igniteFolder.add(tuning, 'groundPowerStart', 0, 1, 0.01).name('starts at progress');
  igniteFolder.add(tuning, 'groundPowerEnd', 0, 1, 0.01).name('done by progress');
  igniteFolder.add(tuning, 'groundIgniteRadius', 1, 60, 0.5).name('sweep reach');
  igniteFolder.add(tuning, 'groundIgniteJitter', 0, 2, 0.01).name('out-of-order');
  igniteFolder.add(tuning, 'groundIgniteSoftness', 0.01, 1, 0.01).name('cell rise');
  igniteFolder.add(tuning, 'groundSurge', 0, 6, 0.05).name('strike flare');

  const hologramFolder = guiFolder('Hologram');
  hologramFolder.add(tuning, 'showHologram');
  hologramFolder.add(tuning, 'holoX', -20, 20, 0.01);
  hologramFolder.add(tuning, 'holoY', -5, 10, 0.01);
  hologramFolder.add(tuning, 'holoZ', -20, 20, 0.01);
  hologramFolder.add(tuning, 'holoWidth', 0.5, 8, 0.01);
  hologramFolder.add(tuning, 'holoMaxHeight', 0.5, 8, 0.01);
  hologramFolder.add(tuning, 'holoSwayFollow', 0, 1, 0.01);
  hologramFolder.addColor(tuning, 'holoInk').name('text (ink)');
  hologramFolder.addColor(tuning, 'holoTint').name('accent (cyan)');
  hologramFolder.add(tuning, 'holoOpacity', 0, 0.6, 0.005).name('panel wash');
  hologramFolder.add(tuning, 'holoGlow', 0, 4, 0.05);
  hologramFolder.add(tuning, 'holoScanlines', 0, 1, 0.01);
  hologramFolder.add(tuning, 'holoFringe', 0, 4, 0.05);

  const showcaseFolder = guiFolder('Showcase');
  showcaseFolder
    .add(flyState, 'enabled')
    .name('free fly (WASD / QE / drag)')
    .onChange(setFlying);
  showcaseFolder.add(flyState, 'speed', 0.2, 20, 0.1).name('fly speed');
  const selectedController = showcaseFolder
    .add(keyActions, 'selected', 0, Math.max(tuning.showcaseKeys.length - 1, 0), 1)
    .name('key');
  showcaseFolder.add(keyActions, 'goToSelected').name('▸ go to key');
  showcaseFolder.add(keyActions, 'append').name('+ record new key');
  showcaseFolder.add(keyActions, 'replaceSelected').name('⟳ replace key');
  showcaseFolder.add(keyActions, 'deleteSelected').name('− delete key');
  showcaseFolder.add(tuning, 'returnKeyStart', 0, 32, 1).name('way-out starts at');
  showcaseFolder.add(keyActions, 'copyKeys').name('⧉ copy keys → clipboard');

  // The key slider's range follows the list as keys are added and removed.
  function refreshKeyDisplay() {
    selectedController.max(Math.max(tuning.showcaseKeys.length - 1, 0));
    selectedController.updateDisplay();
  }

  onDispose(() => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('pointerdown', handlePointerDown);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    // Hand the camera back before the panel goes, or the scene is left frozen on the last flown pose.
    scene.setCameraOverride(null);
    // Takes its folders and controllers with it — don't destroy those separately.
    gui.destroy();
  });
}
