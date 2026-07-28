import * as THREE from 'three';
import type GUI from 'lil-gui';
import { getTunerDock, dockPanel } from '@/lib/tunerDock';
import { formatTuningSource, registerTuningExport } from '@/lib/tunerExport';
import { registerTuningReset } from '@/lib/tunerReset';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { getWritableDeckTuning, resetDeckTuning } from './deckTuning';
import { DECK_SERVICES, type GradedProfile } from './deckServices';
import type { HullShaderUniforms } from './hullMaterial';

/**
 * The services deck's authoring panel — `?tune` only, dynamically imported, never in the shipped bundle.
 *
 * ── It writes to TWO files, and says so ──────────────────────────────────────────────────────────
 * The stage (camera, rig, pad, per-ship placement, culling) lives in deckTuning.ts. Each hull's colour
 * lives in deckServices.ts, where it always has. The panel edits both live and gives you a copy button
 * per destination, because pasting a palette into the placement file would quietly do nothing.
 *
 * ── Parts ────────────────────────────────────────────────────────────────────────────────────────
 * The part list is the answer to "what to keep and what to remove". Every mesh in the active hull gets
 * a checkbox; unticking it hides the piece immediately and adds its id to that ship's `hiddenParts`.
 * The ids are POSITIONAL (`<ship>:<mesh>`) because these are third-party models whose mesh names are
 * inconsistent, missing or duplicated — the index is the only identifier every one of them has. It
 * stays valid as long as the model file does, so re-exporting a vessel invalidates its list.
 */

interface DeckTunerOptions {
  bloomPass: UnrealBloomPass;
  /** Which craft is centred right now — the panel always edits the one you're looking at. */
  activeShipIndex: () => number;
  shipParts: (shipIndex: number) => Map<string, THREE.Mesh>;
  shipMaterials: (shipIndex: number) => THREE.Material[];
  /**
   * Re-apply a ship's key/fill/rim light.
   *
   * The rig's lights are only ever written by the scene's own lighting tween, so editing a colour in
   * the panel has to ask for that tween to run again — writing the light directly from here would be a
   * second writer, and the next carousel move would silently undo it.
   */
  restageLighting: (shipIndex: number) => void;
  padParts: Map<string, THREE.Mesh>;
  onDispose: (cleanup: () => void) => void;
}

/** A graded profile is the common case; the one legacy ship has no palette to edit. */
function gradedProfileOf(shipIndex: number): GradedProfile | null {
  const profile = DECK_SERVICES[shipIndex]?.profile;
  if (!profile || profile.kind === 'legacy') return null;
  return profile;
}

export async function createDeckTunerPanel({
  bloomPass,
  activeShipIndex,
  shipParts,
  shipMaterials,
  restageLighting,
  padParts,
  onDispose,
}: DeckTunerOptions): Promise<void> {
  const { default: LilGui } = await import('lil-gui');
  const tuning = getWritableDeckTuning();

  // Docked into the shared left-hand column, so the three authoring panels stack instead of
  // landing on top of one another in lil-gui's default top-right corner.
  const gui: GUI = new LilGui({ title: 'Fleet · authoring', container: getTunerDock() });
  dockPanel(gui.domElement);

  // ── Camera ──
  const cameraFolder = gui.addFolder('Camera');
  cameraFolder.add(tuning, 'cameraFov', 12, 80, 0.5);
  cameraFolder.add(tuning, 'cameraDistance', 2, 25, 0.05);
  cameraFolder.add(tuning, 'cameraHeight', -5, 12, 0.05);
  cameraFolder.add(tuning, 'cameraLookY', -3, 6, 0.05).name('looks at Y');
  cameraFolder.close();

  // ── Rig ──
  // Multipliers, not absolutes: each craft carries its own key colour and intensity in deckServices,
  // and writing an absolute value here every frame would overwrite that and light every ship alike.
  // 1 = exactly as authored.
  const rigFolder = gui.addFolder('Lighting rig (× per-ship)');
  rigFolder.add(tuning, 'keyMultiplier', 0, 4, 0.01).name('key ×');
  rigFolder.add(tuning, 'fillMultiplier', 0, 4, 0.01).name('fill ×');
  rigFolder.add(tuning, 'rimMultiplier', 0, 4, 0.01).name('rim ×');
  rigFolder.add(tuning, 'ambientIntensity', 0, 3, 0.01).name('ambient');
  rigFolder.add(tuning, 'exposure', 0.1, 4, 0.01).name('exposure');

  // The glow the hull makes for itself, and the stage it sits on.
  const glowFolder = gui.addFolder('Hull glow + stage');
  glowFolder.add(tuning, 'litEmissiveIntensity', 0, 6, 0.05).name('emissive (centred)');
  glowFolder.add(tuning, 'activeBrightness', 0, 3, 0.01).name('brightness (centred)');
  glowFolder.add(tuning, 'dormantBrightness', 0, 3, 0.01).name('brightness (leaving)');
  glowFolder.add(tuning, 'emitPulseAmplitude', 0, 1, 0.01).name('engine pulse ±');
  glowFolder.add(tuning, 'emitPulseSpeed', 0, 8, 0.05).name('engine pulse speed');
  glowFolder.add(tuning, 'shadowOpacity', 0, 1, 0.01).name('contact shadow');
  glowFolder.add(tuning, 'starOpacity', 0, 1, 0.01).name('starfield');

  // Bloom ships DISABLED (see BLOOM_ENABLED in useServicesDeck) — so `enabled` comes first, or the
  // three sliders below would all look broken: they'd move and change nothing, because a disabled
  // pass is skipped by the composer entirely.
  const bloomFolder = gui.addFolder('Bloom');
  bloomFolder.add(bloomPass, 'enabled').name('enabled (off by default)');
  bloomFolder.add(bloomPass, 'strength', 0, 3, 0.01);
  bloomFolder.add(bloomPass, 'radius', 0, 2, 0.01);
  bloomFolder.add(bloomPass, 'threshold', 0, 1, 0.01);
  bloomFolder.close();

  // ── Pad ──
  const padFolder = gui.addFolder('Landing pad');
  padFolder.add(tuning, 'showPad');
  padFolder.add(tuning, 'padWidth', 1, 20, 0.05).name('width (reload to apply)');
  padFolder.add(tuning, 'padY', -5, 5, 0.01).name('height');
  padFolder.addColor(tuning, 'padColor');
  padFolder.addColor(tuning, 'padEmissiveColor').name('glow colour');
  padFolder.add(tuning, 'padEmissiveIntensity', 0, 4, 0.01).name('glow');
  const padPartsFolder = padFolder.addFolder('Pad parts — keep / remove');
  padFolder.close();

  // ── The active ship ──
  // Everything below re-targets whenever the carousel moves, so the panel is always editing the craft
  // in front of you rather than one you chose earlier and forgot about.
  const shipFolder = gui.addFolder('Active ship — placement');
  const paletteFolder = gui.addFolder('Active ship — palette + reflection');
  const lightFolder = gui.addFolder('Active ship — light');
  const partsFolder = gui.addFolder('Active ship — keep / remove');

  let boundShipIndex = -1;
  let shipControllers: { destroy: () => void }[] = [];

  const clearControllers = () => {
    shipControllers.forEach((controller) => controller.destroy());
    shipControllers = [];
  };

  /** Write a value across every hull material of the given ship. */
  const eachHullUniform = (
    shipIndex: number,
    mutate: (uniforms: HullShaderUniforms) => void,
  ) => {
    shipMaterials(shipIndex).forEach((material) => {
      const uniforms = material.userData.hullUniforms as HullShaderUniforms | undefined;
      if (uniforms) mutate(uniforms);
    });
  };

  const bindShip = (shipIndex: number) => {
    clearControllers();
    boundShipIndex = shipIndex;
    const placement = tuning.ships[shipIndex];
    const profile = gradedProfileOf(shipIndex);
    if (!placement) return;

    shipFolder.title(`Placement — ${DECK_SERVICES[shipIndex]?.name ?? shipIndex}`);
    shipControllers.push(
      shipFolder.add(placement, 'x', -6, 6, 0.01),
      shipFolder.add(placement, 'y', -6, 6, 0.01),
      shipFolder.add(placement, 'z', -6, 6, 0.01),
      shipFolder.add(placement, 'rotX', -180, 180, 1),
      shipFolder.add(placement, 'rotY', -180, 180, 1),
      shipFolder.add(placement, 'rotZ', -180, 180, 1),
      shipFolder.add(placement, 'scale', 0.1, 4, 0.01),
    );

    // The palette writes straight through to the live shader uniforms AND back into the profile
    // object, so the copy button below emits what you can actually see.
    if (profile) {
      const colorControl = (
        key: 'shadow' | 'hull' | 'highlight' | 'accent' | 'rim',
        apply: (uniforms: HullShaderUniforms, value: string) => void,
      ) =>
        paletteFolder.addColor(profile, key).onChange((value: string) => {
          eachHullUniform(shipIndex, (uniforms) => apply(uniforms, value));
        });

      shipControllers.push(
        colorControl('shadow', (uniforms, value) => uniforms.uHullShadow.value.set(value)),
        colorControl('hull', (uniforms, value) => uniforms.uHullMid.value.set(value)),
        colorControl('highlight', (uniforms, value) => uniforms.uHullHighlight.value.set(value)),
        colorControl('accent', (uniforms, value) => uniforms.uAccent.value.set(value)),
        colorControl('rim', (uniforms, value) => uniforms.uRim.value.set(value)),
        paletteFolder.add(profile, 'gradeMid', 0, 1, 0.01).onChange((value: number) => {
          eachHullUniform(shipIndex, (uniforms) => { uniforms.uGradeMid.value = value; });
        }),
        paletteFolder.add(profile, 'emitThreshold', 0, 1, 0.01).onChange((value: number) => {
          eachHullUniform(shipIndex, (uniforms) => { uniforms.uEmitThreshold.value = value; });
        }),
        paletteFolder.add(profile, 'emitStrength', 0, 6, 0.05).onChange((value: number) => {
          eachHullUniform(shipIndex, (uniforms) => { uniforms.uEmitStrength.value = value; });
        }),
        paletteFolder.add(profile, 'metalness', 0, 1, 0.01).onChange((value: number) => {
          shipMaterials(shipIndex).forEach((material) => {
            (material as THREE.MeshStandardMaterial).metalness = value;
          });
        }),
        paletteFolder.add(profile, 'roughness', 0, 1, 0.01).onChange((value: number) => {
          shipMaterials(shipIndex).forEach((material) => {
            (material as THREE.MeshStandardMaterial).roughness = value;
          });
        }),
        paletteFolder.add(profile, 'envIntensity', 0, 3, 0.01).name('reflection (env)').onChange((value: number) => {
          shipMaterials(shipIndex).forEach((material) => {
            (material as THREE.MeshStandardMaterial).envMapIntensity = value;
          });
        }),
        // Clearcoat and iridescence only exist on the PHYSICAL material — the low-power path leaves the
        // hulls as plain standard materials, so these are silently inert there rather than broken.
        paletteFolder.add(profile, 'clearcoat', 0, 1, 0.01).onChange((value: number) => {
          shipMaterials(shipIndex).forEach((material) => {
            if (material instanceof THREE.MeshPhysicalMaterial) material.clearcoat = value;
          });
        }),
        paletteFolder.add(profile, 'clearcoatRoughness', 0, 1, 0.01).onChange((value: number) => {
          shipMaterials(shipIndex).forEach((material) => {
            if (material instanceof THREE.MeshPhysicalMaterial) material.clearcoatRoughness = value;
          });
        }),
        paletteFolder.add(profile, 'iridescence', 0, 1, 0.01).onChange((value: number) => {
          shipMaterials(shipIndex).forEach((material) => {
            if (material instanceof THREE.MeshPhysicalMaterial) material.iridescence = value;
          });
        }),
        paletteFolder.add(profile, 'iridescenceIOR', 1, 2.5, 0.01).onChange((value: number) => {
          shipMaterials(shipIndex).forEach((material) => {
            if (material instanceof THREE.MeshPhysicalMaterial) material.iridescenceIOR = value;
          });
        }),
        // The hull's rim STRENGTH lives on the shader, not the profile — live only, so it isn't in the
        // copied palette. Useful for judging the silhouette catch while you tune the rim colour.
        paletteFolder
          .add({ rimStrength: 1 }, 'rimStrength', 0, 4, 0.05)
          .name('rim strength (live)')
          .onChange((value: number) => {
            eachHullUniform(shipIndex, (uniforms) => { uniforms.uRimStrength.value = value; });
          }),
        paletteFolder
          .add({ rimPower: 2 }, 'rimPower', 0.5, 8, 0.05)
          .name('rim falloff (live)')
          .onChange((value: number) => {
            eachHullUniform(shipIndex, (uniforms) => { uniforms.uRimPower.value = value; });
          }),
      );

      // ── This craft's own key light ──
      // Optional in the data, so it's materialised on first edit rather than assumed. Without this the
      // sliders would have nothing to bind to on a ship that never declared an override.
      const service = DECK_SERVICES[shipIndex];
      if (service) {
        service.light ??= { color: '#fff2e2', intensity: 2.4, fill: '#9aa7bb' };
        const light = service.light;
        // Re-staging is what pushes a light change onto the rig — the tween in applyShipLighting is the
        // only writer, so nudging a colour here has to ask for that tween to run again.
        const restage = () => restageLighting(shipIndex);
        shipControllers.push(
          lightFolder.addColor(light, 'color').name('key colour').onChange(restage),
          lightFolder
            .add(light, 'intensity', 0, 8, 0.05)
            .name('key intensity')
            .onChange(restage),
          lightFolder.addColor(light, 'fill').name('fill colour').onChange(restage),
        );
      }
    } else {
      shipControllers.push(
        paletteFolder
          .add({ note: 'legacy profile — no graded palette' }, 'note')
          .name('palette')
          .disable(),
      );
    }

    // ── Keep / remove ──
    // One checkbox per mesh. The proxy object is what lil-gui binds to; the real state is the mesh's
    // own visibility plus the id list the export reads.
    partsFolder.title(`Keep / remove — ${shipParts(shipIndex).size} parts`);
    shipParts(shipIndex).forEach((mesh, partId) => {
      const proxy = { keep: !placement.hiddenParts.includes(partId) };
      const label = mesh.name || partId;
      shipControllers.push(
        partsFolder.add(proxy, 'keep').name(`${partId}  ${label}`).onChange((keep: boolean) => {
          mesh.visible = keep;
          const listed = placement.hiddenParts.indexOf(partId);
          if (keep && listed !== -1) placement.hiddenParts.splice(listed, 1);
          if (!keep && listed === -1) placement.hiddenParts.push(partId);
        }),
      );
    });
  };

  // The pad's parts don't change with the carousel, so they're bound once — but only after the model
  // has actually arrived, which is why this is polled rather than called outright.
  let padBound = false;
  const bindPadParts = () => {
    if (padBound || padParts.size === 0) return;
    padBound = true;
    padParts.forEach((mesh, partId) => {
      const proxy = { keep: !tuning.padHiddenParts.includes(partId) };
      padPartsFolder.add(proxy, 'keep').name(`${partId}  ${mesh.name || ''}`).onChange((keep: boolean) => {
        mesh.visible = keep;
        const listed = tuning.padHiddenParts.indexOf(partId);
        if (keep && listed !== -1) tuning.padHiddenParts.splice(listed, 1);
        if (!keep && listed === -1) tuning.padHiddenParts.push(partId);
      });
    });
  };

  // ── Export ──
  const exports = {
    copyStage: () => {
      const source = [
        '// → paste into components/sections/ServicesDeck/deckTuning.ts (DECK_TUNING)',
        `  cameraFov: ${tuning.cameraFov},`,
        `  cameraDistance: ${tuning.cameraDistance},`,
        `  cameraHeight: ${tuning.cameraHeight},`,
        `  cameraLookY: ${tuning.cameraLookY},`,
        `  keyMultiplier: ${tuning.keyMultiplier},`,
        `  fillMultiplier: ${tuning.fillMultiplier},`,
        `  rimMultiplier: ${tuning.rimMultiplier},`,
        `  ambientIntensity: ${tuning.ambientIntensity},`,
        `  exposure: ${tuning.exposure},`,
        `  showPad: ${tuning.showPad},`,
        `  padWidth: ${tuning.padWidth},`,
        `  padY: ${tuning.padY},`,
        `  padColor: '${tuning.padColor}',`,
        `  padEmissiveColor: '${tuning.padEmissiveColor}',`,
        `  padEmissiveIntensity: ${tuning.padEmissiveIntensity},`,
        `  padHiddenParts: ${JSON.stringify(tuning.padHiddenParts)},`,
        '  ships: [',
        ...tuning.ships.map(
          (ship) =>
            `    { x: ${ship.x}, y: ${ship.y}, z: ${ship.z}, ` +
            `rotX: ${ship.rotX}, rotY: ${ship.rotY}, rotZ: ${ship.rotZ}, ` +
            `scale: ${ship.scale}, hiddenParts: ${JSON.stringify(ship.hiddenParts)} },`,
        ),
        '  ],',
      ].join('\n');
      navigator.clipboard?.writeText(source).catch(() => {});
      console.log(source);
    },
    copyPalette: () => {
      const shipIndex = activeShipIndex();
      const profile = gradedProfileOf(shipIndex);
      if (!profile) {
        console.warn('[deck] this ship uses a legacy profile — nothing to copy.');
        return;
      }
      const source =
        `// → paste into components/sections/ServicesDeck/deckServices.ts, ` +
        `profile of "${DECK_SERVICES[shipIndex]?.name}"\n` +
        JSON.stringify(profile, null, 2);
      navigator.clipboard?.writeText(source).catch(() => {});
      console.log(source);
    },
  };
  const exportFolder = gui.addFolder('Export');
  exportFolder.add(exports, 'copyStage').name('⧉ copy stage → deckTuning.ts');
  exportFolder.add(exports, 'copyPalette').name('⧉ copy palette → deckServices.ts');

  // Follow the carousel. Polled rather than event-driven because the index lives in a ref the scene
  // reads every frame — there is no change event to subscribe to, and a poll at this rate is free.
  const followInterval = window.setInterval(() => {
    bindPadParts();
    const shipIndex = activeShipIndex();
    // Rebind when the craft changes, and also once its parts have finished loading (the models stream
    // in, so the first bind can legitimately find an empty hull).
    const partsArrived =
      shipIndex === boundShipIndex &&
      shipParts(shipIndex).size > 0 &&
      shipControllers.length <= 7; // placement controls only → the part list never got built
    if (shipIndex !== boundShipIndex || partsArrived) bindShip(shipIndex);
  }, 400);

  // ── Reset ──
  // Hidden parts are the wrinkle: culling lives on the MESHES, not in the tuning, so clearing the id
  // lists doesn't switch anything back on by itself. Every part has to be re-shown to match.
  const resetDeck = () => {
    resetDeckTuning();
    DECK_SERVICES.forEach((_, shipIndex) => {
      const hidden = tuning.ships[shipIndex]?.hiddenParts ?? [];
      shipParts(shipIndex).forEach((mesh, partId) => {
        mesh.visible = !hidden.includes(partId);
      });
    });
    padParts.forEach((mesh, partId) => {
      mesh.visible = !tuning.padHiddenParts.includes(partId);
    });
    // Rebind so the per-ship folders are rebuilt against the restored placement objects.
    bindShip(activeShipIndex());
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  };
  const stopReset = registerTuningReset('fleet', resetDeck);
  gui.add({ reset: resetDeck }, 'reset').name('↺ reset fleet to shipped');

  // Two destinations, so two registered sections — pasting a palette into the placement file would
  // quietly do nothing, and a single undifferentiated blob is exactly how that mistake gets made.
  const stopStageExport = registerTuningExport(
    'FLEET · components/sections/ServicesDeck/deckTuning.ts',
    () =>
      [
        '// → the DECK_TUNING literal',
        formatTuningSource(tuning),
      ].join('\n'),
  );
  const stopPaletteExport = registerTuningExport(
    'FLEET PALETTES · components/sections/ServicesDeck/deckServices.ts',
    () =>
      DECK_SERVICES.map((service, shipIndex) => {
        const profile = gradedProfileOf(shipIndex);
        if (!profile) return `// ${service.name}: legacy profile — not edited by this panel`;
        return `// → profile of "${service.name}"\n${JSON.stringify(profile, null, 2)}`;
      }).join('\n\n'),
  );

  onDispose(() => {
    stopReset();
    stopStageExport();
    stopPaletteExport();
    window.clearInterval(followInterval);
    gui.destroy();
  });
}
