'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT } from '@/components/sections/ServicesDeck/deckEvents';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { VECTOR_DEG_PER_SECOND } from './HeroInstruments/heroReadouts';

// The shared sun — the real fractured_sun model, replacing the procedural plasma shader.
//
// This is the same sun authored in /sun-lab, so its presets can eventually drive the page as it scrolls
// (peaceful → cracks → collapse → singularity). The numbers below ARE the lab's "Peaceful" preset; keep
// them in step with `sunLabPresets.ts` rather than drifting a second copy of the look.
//
// It also ASSEMBLES on load: the ten fracture shards start flung apart and are drawn together by real
// asset progress, so the loader's gathering dust hands off to actual matter arriving. See the assembly
// section below.

const MODEL_PATH = '/models/fractured_sun.glb';
const DRACO_DECODER_PATH = '/draco/';

// ── The lab's "Peaceful" preset ──
const MODEL_ROTATION = { x: 5, y: 106, z: -59 };
// Imported, NOT copied: the hero HUD's "orbital vector" readout displays this exact rate so the
// telemetry reads as synced to the sun. Hard-coding the lab's 16 deg/s here would spin the sun 2.6x
// faster than the number on screen claims. One source of truth, so they cannot drift.
const AUTO_ROTATE_DEGREES_PER_SECOND = VECTOR_DEG_PER_SECOND;
const FLARE_SPIN_DEGREES_PER_SECOND = 15;
/** The magma's glow. Higher than the lab's, because the lab has a bloom pass and this does not. */
const MAGMA_EMISSIVE = 2.4;
const EXPOSURE = 1.42;
const ENV_INTENSITY = 1.77;
const KEY_COLOR = 0xfff4e0;
const KEY_INTENSITY = 2.7;
const FILL_COLOR = 0x2a3550;
const FILL_INTENSITY = 0.5;
const AMBIENT_INTENSITY = 0.25;
const CAMERA_FOV = 45;
/**
 * How far back the camera sits, as a multiple of the distance that would exactly fit the model's
 * bounding sphere. **This is the sun's size dial, and lower means bigger** — apparent size is inversely
 * proportional to distance, so halving this doubles the sun.
 *
 * Done with the camera rather than CSS on purpose: the canvas fills `.hero-sun-flight`, and the intro
 * measures that element to fly the sun into the "o" and the hero square. Resizing the element would
 * desync the landing; moving the camera changes nothing outside this file.
 *
 * Note the bounding sphere includes the flares and planes that stick well out past the sun's body, so
 * values below ~0.6 start cropping those outer elements before they touch the body itself.
 */
const CAMERA_FIT_MARGIN = 0.575;

const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_FRAME_SECONDS = 0.05;

// ── Assembly ──
// The shards do not just slide outward — they arrive from deep space: scattered far behind the sun in
// CAMERA depth, tumbling, drifting, and settling into place as assets land.
//
// All distances are in units of the assembly's own radius, so the effect scales with the model.
/** How far back along the camera's view axis the parts start. This is what makes them read as distant. */
const ASSEMBLY_DEPTH = 16;
/** Extra depth variation, so they are not all on one plane. */
const ASSEMBLY_DEPTH_SPREAD = 10;
/** Lateral scatter across the frame at their starting point. */
const ASSEMBLY_SCATTER = 5;
/** A little of the original radial push, so they still read as pieces of one sphere coming apart. */
const ASSEMBLY_SPREAD = 1.4;
/** Drift amplitude while they are still travelling — the "floating" part. Fades to 0 as they land. */
const ASSEMBLY_FLOAT = 0.55;
const ASSEMBLY_FLOAT_SPEED = 0.55;
/**
 * Seconds the parts take to fly in, as a ONE-SHOT starting when the model arrives.
 *
 * It is deliberately NOT driven by asset progress. That was the first attempt and it made the assembly
 * invisible: on a warm reload progress is already 1, so the shards were 99% home within a second and the
 * sun just sat there fully formed. The dust field is the progress meter; the sun forming is a reveal, and
 * a reveal needs a duration of its own or it is never actually seen.
 */
const ASSEMBLY_SECONDS = 2.6;
/** If the hero reveals while parts are still inbound, hurry them rather than snapping them into place. */
const ASSEMBLY_REVEAL_SPEEDUP = 3;

// ── Services energy (unchanged behaviour, ported from the procedural sun) ──
const INTENSITY_LERP = 0.05;
const INTENSITY_SETTLE_EPSILON = 0.0005;
const STILLNESS_EPSILON = 0.001;

/** One fracture shard: where it belongs, and where it travels in from. */
interface Shard {
  object: THREE.Object3D;
  home: THREE.Vector3;
  homeQuaternion: THREE.Quaternion;
  /** Its starting offset from home, already converted into the model's local frame. */
  far: THREE.Vector3;
  /** The orientation it tumbles in from, slerped back to `homeQuaternion` as it lands. */
  tumble: THREE.Quaternion;
  /** Per-shard phase so they drift out of step rather than bobbing in unison. */
  phase: number;
}

/** One flare disc's spin state — axis is its own normal, so it turns flat like a coin. */
interface FlareSpin {
  mesh: THREE.Mesh;
  axis: THREE.Vector3;
  base: THREE.Quaternion;
  angle: number;
}

export default function SunModelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // preserveDrawingBuffer so the last frame keeps compositing while we're NOT drawing — the sun is
    // deliberately frozen for most of the scroll (see the demand-render gate). Without it, an
    // un-preserved buffer's contents are undefined once we stop rendering.
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = EXPOSURE;

    const initialWidth = canvas.clientWidth || canvas.offsetWidth || 900;
    const initialHeight = canvas.clientHeight || canvas.offsetHeight || 300;
    renderer.setSize(initialWidth, initialHeight, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, initialWidth / initialHeight, 0.01, 100);

    // The spinner carries the idle rotation; the model keeps its authored pose. Separate nodes so the
    // two never fight over the same Euler.
    const spinner = new THREE.Group();
    scene.add(spinner);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environmentTexture;

    const keyLight = new THREE.DirectionalLight(KEY_COLOR, KEY_INTENSITY);
    keyLight.position.set(3, 4, 5);
    const fillLight = new THREE.DirectionalLight(FILL_COLOR, FILL_INTENSITY);
    fillLight.position.set(-4, -1, -3);
    const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    scene.add(keyLight, fillLight, ambientLight);

    // NO post-processing, deliberately.
    //
    // A bloom pass here drew a visible RECTANGLE around the sun: EffectComposer renders into its own
    // targets and the final blit writes alpha across the whole buffer, so the canvas stopped being
    // transparent and its box showed against the cream hero. The old procedural sun had no composer for
    // the same reason. The glow instead comes from the magma's emissive (see the load handler), which
    // costs nothing and cannot leak past the geometry.

    let modelRoot: THREE.Object3D | null = null;
    const shards: Shard[] = [];
    let shardRadius = 1;
    const flareSpins: FlareSpin[] = [];
    const scratchSpin = new THREE.Quaternion();

    // ── Sizing ──
    let forceRender = true;
    const applySize = () => {
      const width = canvas.clientWidth || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      forceRender = true;
    };
    const observer = new ResizeObserver(applySize);
    observer.observe(canvas.parentElement ?? canvas);

    // ── Services energy ──
    let targetIntensity = 0;
    const energise = () => {
      targetIntensity = 1;
    };
    const deEnergise = () => {
      targetIntensity = 0;
    };
    window.addEventListener(DECK_REVEAL_EVENT, energise);
    window.addEventListener(DECK_HIDE_EVENT, deEnergise);

    // ── Assembly ──
    // A one-shot flight that starts when the model lands. The loader's dust carries the progress read;
    // this is the payoff, so it runs on its own clock and is always seen.
    let assembly = 0;
    let modelReady = false;
    let forceAssembled = false;
    const onReveal = () => {
      forceAssembled = true;
    };
    window.addEventListener(REVEAL_EVENT, onReveal);

    /**
     * Place every shard for an assembly value: 0 = scattered far off in depth, 1 = home.
     *
     * `time` only drives the drift, which is scaled by how far from home the piece still is — so a
     * settled sun is perfectly still and needs no separate stop condition.
     */
    const positionShards = (assemblyValue: number, time: number) => {
      // Smoothstep: eases out of the far pose and into the home one, but spends the MIDDLE of the
      // animation actually travelling. A cubic ease-out here put the pieces 88% home by the halfway
      // point, so most of the duration was spent watching an already-assembled sun.
      const landed = assemblyValue * assemblyValue * (3 - 2 * assemblyValue);
      const travelling = 1 - landed;
      shards.forEach(({ object, home, homeQuaternion, far, tumble, phase }) => {
        const drift = travelling * ASSEMBLY_FLOAT * shardRadius;
        object.position.set(
          home.x + far.x * travelling + Math.sin(time * ASSEMBLY_FLOAT_SPEED + phase) * drift,
          home.y + far.y * travelling + Math.cos(time * ASSEMBLY_FLOAT_SPEED * 0.8 + phase) * drift,
          home.z + far.z * travelling + Math.sin(time * ASSEMBLY_FLOAT_SPEED * 1.2 + phase) * drift,
        );
        object.quaternion.slerpQuaternions(tumble, homeQuaternion, landed);
      });
    };

    const onVisibility = () => {
      if (!document.hidden) forceRender = true;
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ── Load ──
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    let disposed = false;
    gltfLoader.load(MODEL_PATH, (gltf) => {
      if (disposed) return;
      modelRoot = gltf.scene;

      // The magma ships an emissive TEXTURE but no emissive factor, so by the glTF spec it renders
      // dead-black. Prime it to white or the sun has no glow at all.
      modelRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            if (material.emissiveMap && material.emissive.getHex() === 0x000000) {
              material.emissive.setHex(0xffffff);
            }
            // Lifted because there is no bloom to amplify it — this is the sun's entire glow now.
            material.emissiveIntensity = MAGMA_EMISSIVE;
            material.envMapIntensity = ENV_INTENSITY;
          }
        });
      });

      // Flares are FLAT discs, and their geometry centre is offset from the mesh origin — spinning about
      // the origin would orbit them. Recentre each so it turns in place like a coin on a table.
      modelRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (!materials.some((material) => material.name === 'flare')) return;
        const geometry = object.geometry.clone();
        geometry.computeBoundingBox();
        const centre = new THREE.Vector3();
        geometry.boundingBox?.getCenter(centre);
        object.position.add(centre.clone().multiply(object.scale).applyQuaternion(object.quaternion));
        geometry.translate(-centre.x, -centre.y, -centre.z);
        object.geometry = geometry;

        geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        geometry.boundingBox?.getSize(size);
        // Shortest local dimension is the disc's normal.
        const axis =
          size.x <= size.y && size.x <= size.z
            ? new THREE.Vector3(1, 0, 0)
            : size.y <= size.z
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(0, 0, 1);
        flareSpins.push({ mesh: object, axis, base: object.quaternion.clone(), angle: 0 });
      });

      modelRoot.rotation.set(
        THREE.MathUtils.degToRad(MODEL_ROTATION.x),
        THREE.MathUtils.degToRad(MODEL_ROTATION.y),
        THREE.MathUtils.degToRad(MODEL_ROTATION.z),
      );
      spinner.add(modelRoot);

      // The ten fracture shards are Groups at the model root; their local positions carry the real
      // assembly offsets, so "outward" is measured entirely within that one frame.
      const shardObjects = modelRoot.children.filter((child) =>
        child.name.startsWith('Sphere_0_cell'),
      );
      if (shardObjects.length > 0) {
        const centroid = new THREE.Vector3();
        shardObjects.forEach((shard) => centroid.add(shard.position));
        centroid.multiplyScalar(1 / shardObjects.length);
        let radiusSum = 0;
        shardObjects.forEach((shard) => {
          radiusSum += shard.position.clone().sub(centroid).length();
        });
        shardRadius = radiusSum / shardObjects.length || 1;

        // The parts start far back along the CAMERA's view axis, not the model's. The model carries an
        // authored pose, so a starting offset built in world space has to be rotated into the model's
        // local frame or "behind the camera" would point somewhere arbitrary.
        const toLocal = modelRoot.quaternion.clone().invert();

        shardObjects.forEach((shard) => {
          const outward = shard.position.clone().sub(centroid);
          // A shard exactly on the centroid has no outward — default to +Y so it still parts visibly.
          if (outward.lengthSq() < 1e-8) outward.set(0, 1, 0);
          outward.normalize();

          // Deep in −Z (away from the camera), scattered across the frame, with a little of its own
          // radial direction so the pieces still read as belonging to one sphere.
          const far = new THREE.Vector3(
            (Math.random() * 2 - 1) * ASSEMBLY_SCATTER,
            (Math.random() * 2 - 1) * ASSEMBLY_SCATTER,
            -(ASSEMBLY_DEPTH + Math.random() * ASSEMBLY_DEPTH_SPREAD),
          )
            .applyQuaternion(toLocal)
            .addScaledVector(outward, ASSEMBLY_SPREAD)
            .multiplyScalar(shardRadius);

          // A random orientation to tumble in from.
          const tumble = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              Math.random() * Math.PI * 2,
              Math.random() * Math.PI * 2,
              Math.random() * Math.PI * 2,
            ),
          );

          shards.push({
            object: shard,
            home: shard.position.clone(),
            homeQuaternion: shard.quaternion.clone(),
            far,
            tumble,
            phase: Math.random() * Math.PI * 2,
          });
        });
      }

      // Frame it, then start scattered so the parts visibly fly in.
      // The bounding sphere is NOT centred on the origin — this model's pieces sit off-centre in their
      // own frame — so the camera has to look at `sphere.center`. Aiming at the origin instead put the
      // sun partly out of shot, which read as "it never forms".
      const box = new THREE.Box3().setFromObject(modelRoot);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fitDistance =
        (sphere.radius / Math.sin(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5))) * CAMERA_FIT_MARGIN;
      camera.position.set(sphere.center.x, sphere.center.y, sphere.center.z + fitDistance);
      camera.lookAt(sphere.center);
      camera.updateProjectionMatrix();

      positionShards(0, 0); // scattered, so the parts visibly travel in
      modelReady = true; // starts the one-shot assembly on the next frame
      applySize();
      forceRender = true;
    });

    // ── Render loop ──
    const clock = new THREE.Clock();
    let intensity = 0;
    let wasAnimating = true;
    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);

      intensity += (targetIntensity - intensity) * INTENSITY_LERP;
      // Freeze the sun completely once energised — it must read as perfectly still through the
      // services → works → chamber span. Only the calm hero sun animates.
      const stillness = Math.max(0, 1 - intensity * 1.5);

      // Assembly: a one-shot flight in from deep space, started the moment the model is ready.
      let assembling = false;
      if (modelReady && assembly < 1) {
        const rate = (forceAssembled ? ASSEMBLY_REVEAL_SPEEDUP : 1) / ASSEMBLY_SECONDS;
        // Checked before the increment, so the frame that reaches exactly 1 still places the pieces —
        // they land on their true home rather than a fraction short of it.
        assembly = Math.min(1, assembly + delta * rate);
        positionShards(assembly, clock.getElapsedTime());
        assembling = true;
      }

      if (stillness > STILLNESS_EPSILON) {
        spinner.rotation.y +=
          THREE.MathUtils.degToRad(AUTO_ROTATE_DEGREES_PER_SECOND) * delta * stillness;
        const flareDelta =
          THREE.MathUtils.degToRad(FLARE_SPIN_DEGREES_PER_SECOND) * delta * stillness;
        flareSpins.forEach((spin) => {
          spin.angle += flareDelta;
          scratchSpin.setFromAxisAngle(spin.axis, spin.angle);
          spin.mesh.quaternion.copy(spin.base).multiply(scratchSpin);
        });
      }

      // Demand-render: only draw while the image is actually changing — while the state ramp eases,
      // while the surface still turns, or while the shards are still arriving. Once energised it is an
      // identical frame for the whole services → works → chamber span, so we stop redrawing it there.
      // `wasAnimating` draws the one final settled frame; `forceRender` covers resize / tab-restore.
      const animating =
        Math.abs(targetIntensity - intensity) > INTENSITY_SETTLE_EPSILON ||
        stillness > STILLNESS_EPSILON ||
        assembling;
      if (!document.hidden && (animating || wasAnimating || forceRender)) {
        renderer.render(scene, camera);
        forceRender = false;
      }
      wasAnimating = animating;
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(DECK_REVEAL_EVENT, energise);
      window.removeEventListener(DECK_HIDE_EVENT, deEnergise);
      window.removeEventListener(REVEAL_EVENT, onReveal);
      modelRoot?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      environmentTexture.dispose();
      pmrem.dispose();
      dracoLoader.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="sun-canvas" />;
}
