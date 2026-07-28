'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT } from '@/components/sections/ServicesDeck/deckEvents';
import {
  REVEAL_EVENT,
  SUN_ASSEMBLE_EVENT,
  SUN_ASSEMBLED_EVENT,
} from '@/components/effects/IntroSequence/introEvents';
import { SUN_FRAMING_NUDGE_X } from '@/components/effects/IntroSequence/gatherShader';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { VECTOR_DEG_PER_SECOND } from './HeroInstruments/heroReadouts';

// The shared sun — the real fractured_sun model, replacing the procedural plasma shader.
//
// This is the same sun authored in /sun-lab, so its presets can eventually drive the page as it scrolls
// (peaceful → cracks → collapse → singularity). The numbers below ARE the lab's "Peaceful" preset; keep
// them in step with `sunLabPresets.ts` rather than drifting a second copy of the look.
//
// It also ASSEMBLES, and that assembly is the loader's finale: when the load hits 100% the ten fracture
// shards sweep in from outside the frame and lock together, the star lights inside the closing shell, and
// only then does the intro hand over. See the assembly section below.

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
// All distances are in units of the assembly's own radius (~0.78 model units, ~0.78 sun radii), so the
// effect scales with the model.
//
// REGISTERED TO THE LOADER'S DUST. The gather field streams matter from 22 to 54 sun radii out (see
// DEPTH_NEAR/DEPTH_FAR in gatherShader.ts) through a camera with the same framing as this one. These
// numbers put the shards in the NEAR HALF of that band — roughly 18 to 34 sun radii — so they read as
// the last and largest pieces of the same flow rather than a second effect arriving on its own.
/** How far back along the camera's view axis the parts start. This is what makes them read as distant. */
const ASSEMBLY_DEPTH = 23;
/** Extra depth variation, so they are not all on one plane. */
const ASSEMBLY_DEPTH_SPREAD = 20;
/**
 * How far outside the visible frame the shards begin, as a multiple of the frame's own half-height at
 * their depth.
 *
 * Above 1 they start CLIPPED, which is the whole point: you never catch a piece appearing, it is simply
 * already sweeping in when it crosses the edge. Above ~1.42 clears the frame's corners too, so a shard
 * entering on a diagonal is hidden as reliably as one entering on an axis.
 */
const ASSEMBLY_ENTRY_MARGIN_MIN = 1.45;
/**
 * The furthest out any shard starts. Spreading the margin across a range staggers the entries — the
 * nearest piece edges into frame early, the furthest arrives last — instead of ten pieces crossing the
 * border on the same frame.
 */
const ASSEMBLY_ENTRY_MARGIN_MAX = 2.6;

/**
 * When the star itself appears, as a fraction of the assembly.
 *
 * Only the ten cells are shards. The core sphere, the outer glow, the flares and the twenty corona planes
 * all live under `Sketchfab_model` and sit at home permanently — so without this the glowing sun is
 * already there for the whole download and the shards merely arrive AROUND it, which is the opposite of
 * the story. They scale up from nothing instead, so the star lights inside the closing shell.
 */
const CORONA_APPEAR = 0.55;
/** A little of the original radial push, so they still read as pieces of one sphere coming apart. */
const ASSEMBLY_SPREAD = 1.4;
/** Drift amplitude while they are still travelling — the "floating" part. Fades to 0 as they land. */
const ASSEMBLY_FLOAT = 0.55;
const ASSEMBLY_FLOAT_SPEED = 0.55;
/**
 * How much hotter the magma runs while the pieces are still falling in, as a multiple of its resting
 * emissive. Infalling matter is hot and cools as it settles — but the real job is legibility: at the far
 * end of the flight a shard is a ~10px chip of unlit basalt on a black veil, under a field of bright
 * dust. Without this the early travel is invisible no matter how well it is paced.
 */
const ASSEMBLY_HEAT = 2.5;
/**
 * Seconds the parts take to fly in, as a ONE-SHOT.
 *
 * It is deliberately NOT driven by asset progress. That was the first attempt and it made the assembly
 * invisible: on a warm reload progress is already 1, so the shards were 99% home within a second and the
 * sun just sat there fully formed. The dust field is the progress meter; the sun forming is a reveal, and
 * a reveal needs a duration of its own or it is never actually seen.
 *
 * Sized to the intro's own beat: the cue lands ~0.7s in and the pre-handoff hold starts ~3.3s in, so this
 * finishes with the sun sitting formed and still in the "o" for a moment before the flight out.
 */
const ASSEMBLY_SECONDS = 2.2;
/** If the hero reveals while parts are still inbound, hurry them rather than snapping them into place. */
const ASSEMBLY_REVEAL_SPEEDUP = 3;
/**
 * When to start on our own if no cue ever arrives — measured from PAGE LOAD, not from mount.
 *
 * Only a backstop for an intro that never reaches its gate. It sits past the intro's own 12s asset
 * timeout so the two can't race; the normal no-intro case is handled immediately by INTRO_MARKER_SELECTOR
 * instead of by waiting this out.
 */
const ASSEMBLE_CUE_FALLBACK_MS = 14000;
/** An element only the loader renders — its presence means a cue is coming, so wait for it. */
const INTRO_MARKER_SELECTOR = '.intro-o-slot';

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
  /** How far back along the camera's view axis `far` puts it — the term that drives apparent size. */
  depth: number;
  /** The orientation it tumbles in from, slerped back to `homeQuaternion` as it lands. */
  tumble: THREE.Quaternion;
  /** Per-shard phase so they drift out of step rather than bobbing in unison. */
  phase: number;
}

/** Everything that is not a shard — the star's body and its corona, which grow in as the shell closes. */
interface CoronaPart {
  object: THREE.Object3D;
  /** Its authored scale. Not 1 — `Sketchfab_model` carries 0.964 — so growth multiplies, never sets. */
  homeScale: THREE.Vector3;
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
    const coronaParts: CoronaPart[] = [];
    let shardRadius = 1;
    /** Camera → sun distance, set once the model is framed. The assembly's perspective maths needs it. */
    let cameraDistance = 1;
    /** The magma materials, so the assembly can run them hot while the pieces are still inbound. */
    const heatedMaterials: THREE.MeshStandardMaterial[] = [];
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
    // A one-shot flight, cued when the load reaches 100%. The dust carries the wait; this is the reward
    // for it ending, so it runs on its own clock and the intro holds its handoff until it finishes.
    const skipAssembly = prefersReducedMotion();
    let assembly = 0;
    let modelReady = false;
    let assemblyCued = false;
    let forceAssembled = false;
    const cueAssembly = () => {
      assemblyCued = true;
    };
    // The intro cues this when the load hits 100%, and holds its own handoff until we answer with
    // SUN_ASSEMBLED_EVENT — so the flight is the loader's finale and is always watched start to finish.
    window.addEventListener(SUN_ASSEMBLE_EVENT, cueAssembly);
    // With no loader on the page there is no cue coming, so assemble as soon as the model lands. Checking
    // the DOM rather than listening for INTRO_ACTIVE_EVENT because this canvas is dynamically imported
    // and mounts well after the intro has already announced itself — the event would be long gone.
    const introOnPage = document.querySelector(INTRO_MARKER_SELECTOR) !== null;
    if (!introOnPage) cueAssembly();
    // Ultimate safety net: an intro that is on the page but never reaches its gate (a stalled asset it
    // gives up on at 12s) must not leave the sun in pieces forever.
    const cueFallbackTimer = window.setTimeout(
      cueAssembly,
      Math.max(0, ASSEMBLE_CUE_FALLBACK_MS - performance.now()),
    );
    const onReveal = () => {
      forceAssembled = true;
      cueAssembly(); // past the point of waiting for a cue that clearly is not coming
    };
    window.addEventListener(REVEAL_EVENT, onReveal);

    /**
     * Place every shard for an assembly value: 0 = deep, and outside the frame entirely; 1 = home.
     *
     * `time` only drives the drift, which fades out as the pieces settle — so a settled sun is
     * perfectly still and needs no separate stop condition.
     */
    const positionShards = (assemblyValue: number, time: number) => {
      // Ease the ARRIVAL, then solve back for the position — do not ease the position directly.
      //
      // Apparent size under perspective is cameraDistance / (cameraDistance + depth), and these pieces
      // start ~16 shard-radii behind a camera sitting 1.5 radii out, so they open the flight at ~17% of
      // their final size. Easing the position lerp (what this used to do) therefore buys almost nothing
      // early: the shards crawled 17% → 29% over the first half of the animation and then did all their
      // visible growing in the last few frames. That is exactly what "it isn't assembling, it's just
      // standing there" looks like — the motion was real, it was just spent where the eye can't see it.
      //
      // Interpolating RECIPROCAL distance is the standard fix: it makes depth read linearly, so the
      // pieces now sweep in at an even perceived rate the whole way (17% → 30% → 59% → 87% → 100%).
      const arrival = assemblyValue * assemblyValue * (3 - 2 * assemblyValue);
      const receding = 1 - arrival;

      heatedMaterials.forEach((material) => {
        material.emissiveIntensity = MAGMA_EMISSIVE * (1 + receding * ASSEMBLY_HEAT);
      });

      // The star lights inside the closing shell rather than waiting there for it.
      const coronaGrowth = THREE.MathUtils.smoothstep(arrival, CORONA_APPEAR, 1);
      coronaParts.forEach(({ object, homeScale }) => {
        object.visible = coronaGrowth > 0;
        object.scale.copy(homeScale).multiplyScalar(coronaGrowth);
      });

      shards.forEach(({ object, home, homeQuaternion, far, depth, tumble, phase }) => {
        const distance =
          1 / THREE.MathUtils.lerp(1 / (cameraDistance + depth), 1 / cameraDistance, arrival);
        const travelling = (distance - cameraDistance) / depth;
        // Drift and tumble stay on the eased clock, not on `travelling` — `travelling` collapses early
        // by design now, and hanging the float off it would stop the pieces moving well before they land.
        const drift = receding * ASSEMBLY_FLOAT * shardRadius;
        object.position.set(
          home.x + far.x * travelling + Math.sin(time * ASSEMBLY_FLOAT_SPEED + phase) * drift,
          home.y + far.y * travelling + Math.cos(time * ASSEMBLY_FLOAT_SPEED * 0.8 + phase) * drift,
          home.z + far.z * travelling + Math.sin(time * ASSEMBLY_FLOAT_SPEED * 1.2 + phase) * drift,
        );
        object.quaternion.slerpQuaternions(tumble, homeQuaternion, arrival);
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
            // Shards share their materials, and they all travel on one clock, so the assembly's heat is
            // a single global ramp rather than a per-shard one.
            if (material.emissiveMap && !heatedMaterials.includes(material)) {
              heatedMaterials.push(material);
            }
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

      // Put the model's centre ON the spinner's axis.
      //
      // Without this the idle spin does not turn the sun in place, it ORBITS it: spinner.rotation.y turns
      // about the world origin and the model's content is centred 0.174 units off it, which swings the
      // sun ±11px sideways over each 58-second turn. That slow drift is what reads as "not centred" —
      // the sun is only in the middle twice per minute.
      //
      // Measured in world space (Box3 always is) and converted back into the spinner's frame, because the
      // spinner has already been turning for however long the model took to download.
      spinner.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(modelRoot);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const centre = box.getCenter(new THREE.Vector3());
      spinner.worldToLocal(centre);
      modelRoot.position.sub(centre);

      // Frame it. The shards' entry points are expressed in terms of the visible frame — they have to
      // start outside it — so the camera has to be placed before they can be built.
      //
      // Panning (moving the camera and its aim point together) rather than rotating, so the sun shifts
      // across the frame without the perspective skewing.
      //
      // The nudge is not zero because the model is not visually symmetric about its own bounding box: the
      // big `sunouter` glow sphere sits at x≈0 while the fractured cells sit at x≈-0.25, so the bright
      // halo — which is what actually reads as the sun — sits right of the geometric centre the box
      // gives us. SUN_FRAMING_NUDGE_X corrects for that, and the dust reads the same constant.
      const fitDistance =
        (sphere.radius / Math.sin(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5))) * CAMERA_FIT_MARGIN;
      const frameHalfHeight = fitDistance * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5));
      const panX = frameHalfHeight * SUN_FRAMING_NUDGE_X;
      camera.position.set(panX, 0, fitDistance);
      camera.lookAt(panX, 0, 0);
      camera.updateProjectionMatrix();
      cameraDistance = fitDistance;
      // Half the visible frame per unit of distance from the camera — turns a depth into "how far out is
      // off-screen at that depth".
      const frameHalfPerUnit = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5));

      // The ten fracture shards are Groups at the model root; their local positions carry the real
      // assembly offsets, so "outward" is measured entirely within that one frame.
      const shardObjects = modelRoot.children.filter((child) =>
        child.name.startsWith('Sphere_0_cell'),
      );
      // Everything else is the star's body and corona. Captured before anything is moved, so the scales
      // recorded here are the authored ones.
      modelRoot.children
        .filter((child) => !child.name.startsWith('Sphere_0_cell'))
        .forEach((object) => coronaParts.push({ object, homeScale: object.scale.clone() }));
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

          // Deep in −Z (away from the camera) and out past the edge of the frame, with a little of its
          // own radial direction so the pieces still read as belonging to one sphere.
          //
          // Depth is pulled out as its own number because the assembly paces itself by apparent size,
          // which depends on it. The radial push tilts the true depth a little, but it is ~1 unit
          // against 17–32, so it makes no difference to the pacing.
          const depth = (ASSEMBLY_DEPTH + Math.random() * ASSEMBLY_DEPTH_SPREAD) * shardRadius;
          // Off-frame at that depth, in a random direction around the view axis. Because the offset
          // shrinks with the same factor that carries the shard forward, a piece crosses into view of
          // its own accord partway through the flight — already moving, already at a readable size.
          const entryMargin =
            ASSEMBLY_ENTRY_MARGIN_MIN +
            Math.random() * (ASSEMBLY_ENTRY_MARGIN_MAX - ASSEMBLY_ENTRY_MARGIN_MIN);
          const entryRadius = (cameraDistance + depth) * frameHalfPerUnit * entryMargin;
          const entryAngle = Math.random() * Math.PI * 2;
          const far = new THREE.Vector3(
            Math.cos(entryAngle) * entryRadius,
            Math.sin(entryAngle) * entryRadius,
            -depth,
          )
            .applyQuaternion(toLocal)
            .addScaledVector(outward, ASSEMBLY_SPREAD * shardRadius);

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
            depth,
            tumble,
            phase: Math.random() * Math.PI * 2,
          });
        });
      }

      if (skipAssembly) {
        assembly = 1; // leave the shards home — no flight to reduce
        window.dispatchEvent(new Event(SUN_ASSEMBLED_EVENT)); // never make the intro wait for a flight
      } else {
        positionShards(0, 0); // parked off-frame, so the parts visibly travel in
      }
      modelReady = true; // the one-shot assembly starts on the next frame after the cue
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

      // Assembly: a one-shot flight in from deep space, run once the model is here AND the intro has
      // put the "o" on screen — whichever of those two lands last.
      let assembling = false;
      if (modelReady && assemblyCued && assembly < 1) {
        const rate = (forceAssembled ? ASSEMBLY_REVEAL_SPEEDUP : 1) / ASSEMBLY_SECONDS;
        // Checked before the increment, so the frame that reaches exactly 1 still places the pieces —
        // they land on their true home rather than a fraction short of it.
        assembly = Math.min(1, assembly + delta * rate);
        positionShards(assembly, clock.getElapsedTime());
        assembling = true;
        // The intro is holding its handoff on this. Fired from here rather than from a timer so it is the
        // frame the last shard actually lands, however long the flight ended up taking.
        if (assembly >= 1) window.dispatchEvent(new Event(SUN_ASSEMBLED_EVENT));
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
      window.removeEventListener(SUN_ASSEMBLE_EVENT, cueAssembly);
      window.clearTimeout(cueFallbackTimer);
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
