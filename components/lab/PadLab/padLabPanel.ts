import * as THREE from 'three';
import type GUI from 'lil-gui';
import { getTunerDock, dockPanel } from '@/lib/tunerDock';
import {
  formatTuningSource,
  registerTuningExport,
  copyTuningExport,
} from '@/lib/tunerExport';
import { registerTuningReset } from '@/lib/tunerReset';
import { DECK_SERVICES } from '@/components/sections/ServicesDeck/deckServices';
import { getWritablePadLabTuning, resetPadLabTuning } from './padLabTuning';
import type { PadLabHandle } from './hooks/usePadLabScene';

/**
 * The pad lab's authoring panel.
 *
 * Unlike the site's `?tune` panels this one is always on — the whole page exists to author this prop.
 *
 * ── Two destinations, and the export says which ──────────────────────────────────────────────────
 * The stage numbers (lights, pad transform, environment) are a `PadLabTuning` literal. The per-part
 * and per-material values are read back off the LIVE scene at export time, because their shape is
 * defined by the model file rather than by any source file here. The copy button emits both, each
 * under its own header, so nothing has to be transcribed by hand.
 */

/** Skipped by the literal exporter — these arrays get their own blocks, for readability. */
const EXPORT_SKIP_KEYS = ['lights', 'spins', 'shipGlowColors'] as const;

interface PadPanelOptions {
  handle: PadLabHandle;
  onDispose: (cleanup: () => void) => void;
}

function formatColor(color: THREE.Color): string {
  return `#${color.getHexString()}`;
}

export async function createPadLabPanel({ handle, onDispose }: PadPanelOptions): Promise<void> {
  const { default: LilGui } = await import('lil-gui');
  const tuning = getWritablePadLabTuning();

  const gui: GUI = new LilGui({ title: 'Pad · authoring', container: getTunerDock() });
  dockPanel(gui.domElement);

  // ── Copy / reset ──
  // First, because it is the thing you reach for most and a long panel buries anything below it.
  gui.add({ copy: () => copyTuningExport() }, 'copy').name('⧉ copy config to clipboard');
  gui.add({ reset: () => resetPadLabTuning() }, 'reset').name('↺ reset stage to defaults');

  // ── The pad ──
  const padFolder = gui.addFolder('Pad — placement');
  padFolder.add(tuning, 'padScale', 0.05, 5, 0.01).name('scale');
  padFolder.add(tuning, 'padX', -20, 20, 0.01).name('x');
  padFolder.add(tuning, 'padY', -20, 20, 0.01).name('y');
  padFolder.add(tuning, 'padZ', -20, 20, 0.01).name('z');
  padFolder.add(tuning, 'padRotX', -180, 180, 0.5).name('rot X (−90 lays it flat)');
  padFolder.add(tuning, 'padRotY', -180, 180, 0.5).name('rot Y');
  padFolder.add(tuning, 'padRotZ', -180, 180, 0.5).name('rot Z');

  // ── Glow — the pad IS the light ──
  const glowFolder = gui.addFolder('▸ GLOW + BLOOM (this is the light)');
  glowFolder.add(tuning, 'glowIntensity', 0, 30, 0.05).name('glow intensity');
  glowFolder
    .add(tuning, 'glowColorFollowsShip')
    .name('colour follows craft');
  glowFolder.addColor(tuning, 'glowColor').name('glow colour (when not following)');
  // The two panels with an orange emissive map (Object_13 / Object_17) can't be tinted by colour
  // alone — see glowMapHue in padLabTuning.
  glowFolder
    .add(tuning, 'glowMapHue', 0, 1, 0.01)
    .name('texture hue (0 = one colour)');
  glowFolder
    .add(tuning, 'lightFollowsGlow')
    .name('cast light takes glow colour');
  // One swatch per craft, so the pad can be tinted to each hull and all four export together.
  const perShipFolder = glowFolder.addFolder('Glow colour per craft');
  DECK_SERVICES.forEach((service, index) => {
    // The NUMERIC index, not a stringified one: lil-gui types its property as `keyof T`, and an
    // array's keyof includes `number` but not arbitrary strings.
    perShipFolder
      .addColor(tuning.shipGlowColors, index)
      .name(`${service.index} · ${service.name}`);
  });
  glowFolder.add(tuning, 'bloomEnabled').name('bloom');
  glowFolder.add(tuning, 'bloomStrength', 0, 4, 0.01).name('bloom strength');
  glowFolder.add(tuning, 'bloomRadius', 0, 2, 0.01).name('bloom radius');
  glowFolder.add(tuning, 'bloomThreshold', 0, 1, 0.01).name('bloom threshold');

  // ── Spin ──
  // Targets are MATERIALS, not meshes: some pieces are several meshes sharing one material (the lit
  // panels are Object_13 + Object_17) and they have to turn together. Each option shows how many
  // meshes it will grab, so picking one is not a guess.
  const spinFolder = gui.addFolder('Pad — spin');
  const spinTargets: Record<string, string> = { nothing: '' };
  handle.materials.forEach(({ name }) => {
    const meshCount = handle.parts.filter((part) => part.materialName === name).length;
    if (meshCount === 0) return;
    spinTargets[`${name} (${meshCount})`] = name;
  });
  tuning.spins.forEach((spin, index) => {
    const folder = spinFolder.addFolder(`Spinner ${index + 1}`);
    folder.add(spin, 'material', spinTargets).name('parts');
    folder.add(spin, 'speed', -180, 180, 0.5).name('deg / sec (− reverses)');
    folder.add(spin, 'axis', { X: 0, Y: 1, Z: 2 }).name('axis (Z for the pad face)');
  });

  // ── The light the pad throws ──
  // The reason this lab exists: on the deck every rig light is at 0, so this prop is the only thing
  // lighting a craft from underneath.
  const lightsFolder = gui.addFolder('▸ PAD LIGHT (this is the point)');
  tuning.lights.forEach((light, index) => {
    const folder = lightsFolder.addFolder(`Light ${index + 1}`);
    folder.add(light, 'enabled');
    folder.addColor(light, 'color');
    folder.add(light, 'intensity', 0, 80, 0.1);
    folder.add(light, 'x', -12, 12, 0.01);
    folder.add(light, 'y', -6, 12, 0.01).name('y (height above pad)');
    folder.add(light, 'z', -12, 12, 0.01);
    folder.add(light, 'distance', 0, 60, 0.1).name('reach (0 = infinite)');
    folder.add(light, 'decay', 0, 4, 0.01).name('falloff');
    folder.add(light, 'showHelper').name('show marker');
  });

  // ── Environment ──
  const environmentFolder = gui.addFolder('Environment');
  environmentFolder.add(tuning, 'exposure', 0.1, 4, 0.01);
  environmentFolder.add(tuning, 'ambientIntensity', 0, 2, 0.01).name('ambient');
  environmentFolder.addColor(tuning, 'ambientColor').name('ambient colour');
  environmentFolder.add(tuning, 'envIntensity', 0, 3, 0.01).name('environment');
  environmentFolder.addColor(tuning, 'backgroundColor').name('background');
  environmentFolder.add(tuning, 'showGround').name('ground');
  environmentFolder.addColor(tuning, 'groundColor').name('ground colour');
  environmentFolder.close();

  // ── The test craft ──
  const shipFolder = gui.addFolder('Test craft (not part of the pad)');
  const shipChoices: Record<string, number> = {};
  DECK_SERVICES.forEach((service, index) => {
    shipChoices[`${service.index} · ${service.name}`] = index;
  });
  shipFolder.add(tuning, 'showShip').name('show');
  shipFolder.add(tuning, 'shipIndex', shipChoices).name('craft');
  shipFolder.add(tuning, 'shipY', -2, 10, 0.01).name('hover height');
  shipFolder.add(tuning, 'shipScale', 0.1, 4, 0.01).name('scale');
  shipFolder.add(tuning, 'shipRotY', -180, 180, 0.5).name('rot Y');
  shipFolder
    .add(tuning, 'shipNeutral')
    .name('neutral grey (judge the light alone)');

  // ── Per-material ──
  // The emissive fields are the ones that matter here: the glowing parts of this prop are what read
  // as the light source, and the PointLights above are what actually cast from them.
  const materialsFolder = gui.addFolder(`Materials (${handle.materials.length})`);
  handle.materials.forEach(({ name, material }) => {
    const isGlow = handle.glowMaterialNames.includes(name);
    const folder = materialsFolder.addFolder(isGlow ? `${name}  ⟵ glow` : name);
    folder.addColor(material, 'color');
    // A glow material's emissive is rewritten every frame from the GLOW folder, so offering sliders
    // for it here would give you two controls where only one wins — and the dead one looks broken.
    if (!isGlow) {
      folder.addColor(material, 'emissive');
      folder.add(material, 'emissiveIntensity', 0, 20, 0.01).name('emissive');
    }
    folder.add(material, 'metalness', 0, 1, 0.01);
    folder.add(material, 'roughness', 0, 1, 0.01);
    folder.add(material, 'opacity', 0, 1, 0.01).onChange(() => {
      material.transparent = material.opacity < 1;
      material.needsUpdate = true;
    });
    folder.add(material, 'wireframe');
    folder.close();
  });
  materialsFolder.close();

  // ── Per-part ──
  const partsFolder = gui.addFolder(`Parts (${handle.parts.length}) — keep / pose`);
  handle.parts.forEach((part) => {
    const folder = partsFolder.addFolder(`${part.index} · ${part.name}`);
    folder.add(part.offset, 'visible');
    folder.add(part.offset, 'x', -10, 10, 0.001);
    folder.add(part.offset, 'y', -10, 10, 0.001);
    folder.add(part.offset, 'z', -10, 10, 0.001);
    folder.add(part.offset, 'rotX', -180, 180, 0.5);
    folder.add(part.offset, 'rotY', -180, 180, 0.5);
    folder.add(part.offset, 'rotZ', -180, 180, 0.5);
    folder.add(part.offset, 'scale', 0.01, 4, 0.01);
    folder.close();
  });
  partsFolder.close();

  // ── Export ──
  const printLights = () =>
    tuning.lights
      .map(
        (light) =>
          `    { enabled: ${light.enabled}, color: '${light.color}', intensity: ${light.intensity}, ` +
          `x: ${light.x}, y: ${light.y}, z: ${light.z}, distance: ${light.distance}, ` +
          `decay: ${light.decay}, showHelper: ${light.showHelper} },`,
      )
      .join('\n');

  const printParts = () =>
    handle.parts
      .filter((part) => {
        const { visible, x, y, z, rotX, rotY, rotZ, scale } = part.offset;
        // Only emit parts that were actually touched — a full dump of nine untouched parts buries
        // the two you moved.
        return !visible || x || y || z || rotX || rotY || rotZ || scale !== 1;
      })
      .map(
        (part) =>
          `  // ${part.name}\n  ${part.index}: ${JSON.stringify(part.offset)},`,
      )
      .join('\n');

  const printMaterials = () =>
    handle.materials
      .map(
        ({ name, material }) =>
          `  '${name}': { color: '${formatColor(material.color)}', ` +
          `emissive: '${formatColor(material.emissive)}', ` +
          `emissiveIntensity: ${material.emissiveIntensity}, ` +
          `metalness: ${material.metalness}, roughness: ${material.roughness}, ` +
          `opacity: ${material.opacity} },`,
      )
      .join('\n');

  const unregisterExport = registerTuningExport(
    'PAD · components/lab/PadLab/padLabTuning.ts → the PAD_LAB_TUNING literal',
    () => {
      const touchedParts = printParts();
      const shipGlow = tuning.shipGlowColors
        .map((color, index) => `'${color}'${index < tuning.shipGlowColors.length - 1 ? ',' : ''} // ${DECK_SERVICES[index]?.name ?? index}`)
        .join('\n    ');
      const spins = tuning.spins
        .map((spin) => {
          const meshes = handle.parts
            .filter((part) => spin.material !== '' && part.materialName === spin.material)
            .map((part) => part.name);
          return (
            `    { material: '${spin.material}', speed: ${spin.speed}, axis: ${spin.axis} }, // ${
              meshes.length ? meshes.join(' + ') : 'off'
            }`
          );
        })
        .join('\n');
      return [
        formatTuningSource(tuning, EXPORT_SKIP_KEYS),
        `  shipGlowColors: [\n    ${shipGlow}\n  ],`,
        `  spins: [\n${spins}\n  ],`,
        `  lights: [\n${printLights()}\n  ],`,
        '',
        '// ── PAD MATERIALS (live values, keyed by material name) ─────────────────────────',
        printMaterials(),
        '',
        '// ── PAD PARTS (only the ones you changed) ───────────────────────────────────────',
        touchedParts || '  // none changed',
      ].join('\n');
    },
  );

  const unregisterReset = registerTuningReset('pad', resetPadLabTuning);

  onDispose(() => {
    unregisterExport();
    unregisterReset();
    gui.destroy();
  });
}
