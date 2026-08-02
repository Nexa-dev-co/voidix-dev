import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import {
  createLetterMarkGeometry,
  createSvgMarkGeometry,
  createMarkMaterials,
  svgToShapes,
  letterToShapes,
  type MarkMaterialVariant,
} from '@/components/sections/WorksField/markBody';
import {
  createMarkSwarm,
  type MarkSwarm,
  type MarkChunkMaterial,
} from '@/components/sections/WorksField/markSwarm';
import {
  createChunkMaterial,
  GEODE_CRUST_SPEC_ID,
  type ChunkMaterialSpec,
} from '@/components/sections/WorksField/markChunkMaterial';
import { buildGeodeBody, type GeodeBody } from '@/components/sections/WorksField/markGeodeBody';
import {
  enableGeodeMorph,
  DEFAULT_GEODE_MORPH,
  type GeodeMorphUniforms,
} from '@/components/sections/WorksField/markGeodeMorph';
import {
  evaluateGeodePhases,
  type GeodePhaseTiming,
} from '@/components/sections/WorksField/markGeodePhases';
import { markById } from '@/components/sections/WorksField/marks';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';

/**
 * The letter lab's scene — one extruded glyph, lit and bloomed the way the works field lights its
 * marks, so a judgement made here transfers to the real section.
 *
 * Kept entirely separate from `useWorksField`: this is a testbed with no scroll coupling, no camera
 * path, no handoffs. Sharing the field's hook would mean dragging all of that in for nothing.
 */

const FONT_PATH = '/fonts/helvetiker_bold.typeface.json';

const CAMERA_FOV = 38;
const CAMERA_DISTANCE = 6.2;
const TARGET_SIZE = 2.6;
const CURVE_SEGMENTS = 12;
const BEVEL_SEGMENTS = 4;

// Matched to the works field so the glyph is judged under the same light it would ship under.
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

const SWARM_SCALE_JITTER = 0.45;
const SWARM_SEED = 149;
/** How fast a free-drifting chunk wanders and tumbles. Slow — this is ambience, not activity. */
const FREE_DRIFT_SPEED = 0.35;
const FREE_TUMBLE_SPEED = 0.25;

const IDLE_SPIN_DEGREES_PER_SECOND = 18;
const DRAG_YAW_SENSITIVITY = 0.008;
const DRAG_PITCH_SENSITIVITY = 0.006;
const DRAG_PITCH_CLAMP = 0.9;
const MAX_FRAME_SECONDS = 0.05;
const MAX_DEVICE_PIXEL_RATIO = 2;

export interface LetterLabSettings {
  /**
   * How the mark is built.
   *
   *   solid  one bevelled extrusion — the plain comparison.
   *   rock   the chunk swarm: ~600 instances flying out of a cloud into the outline.
   *   geode  ONE body that is a base rock at p = 0 and the mark at p = 1, opening crystal where the
   *          rock was cut. See markGeodeBody.ts and docs/mark-core-rock-plan.md.
   *
   * All three are kept live at once on purpose: the point of this round is judging the geode against
   * the swarm it is meant to replace, and that decision cannot be made from memory.
   */
  body: 'solid' | 'rock' | 'geode';

  // ── The geode ──
  /** 0 = the closed base rock, 1 = the mark fully formed. Everything else derives from this. */
  geodeProgress: number;
  /**
   * Run the round trip on its own clock instead of following the scrub.
   *
   * While playing, `geodeProgress` is ignored — the loop owns the playhead and ping-pongs it, which is
   * frames 1-12 of the storyboard. Pausing hands control straight back to the slider.
   */
  geodePlaying: boolean;
  /** Seconds for one full open (and one full close) when the lab is playing it rather than scrubbing. */
  geodeCycleSeconds: number;
  geodePhaseTiming: GeodePhaseTiming;
  /** Where the base rock sits in the mark's own space — NOT the mark's centre. */
  rockOffsetX: number;
  rockOffsetY: number;
  rockOffsetZ: number;
  /**
   * Relative to the mark. Bigger than the mark carves a geode out of it; smaller makes the mark grow
   * out of a seed. The whole spectrum is this one number.
   */
  rockRadius: number;
  rockStretchX: number;
  rockStretchY: number;
  rockStretchZ: number;
  rockSeed: number;
  rockCarveAmplitude: number;
  /** 0 = the mark keeps its own clean profile, 1 = its outer face IS the rock's skin. */
  cling: number;
  crustThickness: number;
  markCarveAmplitude: number;
  markCarveFrequency: number;
  /** 1 protects the silhouette completely; 0 carves it as hard as the faces. */
  markCarveInPlaneDamping: number;
  /** How long the body stays solid before the mark's notches cut in, 0..1. Geometry: rebuilds. */
  silhouetteHold: number;
  /** How coarse the crystal patches are — lower means bigger islands. Geometry: rebuilds. */
  crystalPatchScale: number;
  crystalFacetScale: number;
  crystalFacetAmplitude: number;
  crystalColor: string;
  crystalEmissive: number;
  crystalRoughness: number;
  crystalMetalness: number;
  chargeStrength: number;
  facetShading: number;
  /** How hard the crystal is pushed onto the mark's edges rather than every opened face. */
  edgeBias: number;
  /** Share of the opened surface that is crystal while the mark is still forming, 0..1. */
  crystalCoverageForming: number;
  /** …and once it has settled. The `spread` phase crossfades between them. */
  crystalCoverageSettled: number;
  wobbleAmplitude: number;
  capEdgeFraction: number;
  capSubdivisions: number;
  depthRings: number;
  holeSeedFraction: number;
  /**
   * What the chunks are made of, and in what proportion. A mark's readability comes from the CONTRAST
   * between these — one surface for everything reads as a blob.
   */
  chunkSpecs: ChunkMaterialSpec[];
  /** Seconds the mark takes to gather out of the dark. */
  formationSeconds: number;
  /** Seconds the same rocks take to travel from one mark to the next. */
  shapeBlendSeconds: number;
  /** 0..1 — share of chunks already in place before anything flies. */
  formationBaseFraction: number;
  formationStagger: number;
  formationEdgeDelay: number;
  /** 0 = chunks arrive in random order, 1 = the outline draws itself around the contour. */
  formationOrder: number;
  /** Half-extent of the cloud the chunks drift in before they're called into a shape. */
  freeRadius: number;
  freeDriftAmplitude: number;
  /**
   * Fixed pool sizes. Counts rather than a spacing, because the pool has to be the SAME rocks across
   * every mark — see markSwarm's header.
   */
  edgeChunkCount: number;
  interiorChunkCount: number;
  edgeChunkScale: number;
  interiorChunkScale: number;
  /** The glyph to extrude, when `svgMarkId` is null. */
  character: string;
  /**
   * Show one of the registry's SVG marks instead of a glyph. The lab covers both because the SVG path
   * is where the real traps live — the Y-axis flip, and whether holes (the compass ring, the shield's
   * cutouts) survive `createShapes`. Those have to be seen before the works field depends on them.
   */
  svgMarkId: string | null;
  variant: MarkMaterialVariant;
  depth: number;
  bevelSize: number;
  bevelThickness: number;
  color: string;
  edgeColor: string;
  edgeEmissive: number;
  roughness: number;
  metalness: number;
}

export interface LetterLabControls {
  /** Replay the formation from scattered. */
  replayFormation: () => void;
  /**
   * Mean crust across the geode's surface, 0..1.
   *
   * Reported because the base rock can be placed somewhere that produces no crust at all — fully
   * inside the mark, or fully clear of it — and the result is a uniformly crystal mark with no geode
   * read left. That is not a bug, but it is confusing without a number on it.
   */
  crustShare: number;
}

export function useLetterLab(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  settings: LetterLabSettings,
): LetterLabControls {
  // The render loop is built once; it reads the latest settings through this ref rather than being
  // torn down and rebuilt every time a slider moves.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Surfaced to the panel, because a badly placed base rock can leave the mark with no crust at all
  // and there is no way to tell that apart from "the crust texture isn't loading" by eye.
  const [crustShare, setCrustShare] = useState(0);

  // Set by the scene effect so the settings effect can ask for a rebuild without re-running setup.
  const rebuildGeometryRef = useRef<(() => void) | null>(null);
  const rebuildMaterialRef = useRef<(() => void) | null>(null);
  const rebuildChunkMaterialsRef = useRef<(() => void) | null>(null);
  const replayFormationRef = useRef<(() => void) | null>(null);
  const rebuildSwarmRef = useRef<(() => void) | null>(null);

  // Stable, so the scene effect never re-runs just because the panel re-rendered.
  const reportCrustShare = useCallback((share: number) => setCrustShare(share), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);

    // Image-based lighting, matching the works field. Without it every material's `envMapIntensity`
    // multiplies nothing — `createStoneMaterial` sets 0.35 and it was silently doing nothing here.
    // Matte chunks barely noticed; anything with a specular read (crystal above all) depends on it.
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

    // The spin rig, so drag rotation and idle spin compose without fighting each other.
    const spin = new THREE.Group();
    scene.add(spin);

    // Both the font load and the SVG fetches are async, so either can land after the component has
    // gone. Declared up front because every async callback below checks it.
    let isDisposed = false;

    let font: Font | null = null;
    let mesh: THREE.Mesh | null = null;
    let materials: THREE.MeshStandardMaterial[] = [];
    // The persistent rock pool. Built once the materials are ready and kept for the life of the lab —
    // a mark change re-targets it rather than replacing it, which is the whole point of the swarm.
    let swarm: MarkSwarm | null = null;
    /** True once a shape has been handed over, so the first one plays a formation and later ones don't. */
    let hasShape = false;

    // Source images, cached by path — several specs share one texture (each clones it for its own
    // repeat), and a spec's texture can be changed from the panel at any time.
    const textureCache = new Map<string, THREE.Texture>();
    let chunkMaterials: MarkChunkMaterial[] = [];

    const disposeMesh = () => {
      if (!mesh) return;
      spin.remove(mesh);
      mesh.geometry.dispose();
      mesh = null;
    };
    const disposeSwarm = () => {
      if (!swarm) return;
      spin.remove(swarm.group);
      swarm.dispose();
      swarm = null;
      hasShape = false;
    };
    const disposeChunkMaterials = () => {
      chunkMaterials.forEach((entry) => {
        const material = entry.material as THREE.MeshStandardMaterial;
        // The clone made for this spec's repeat — the cached source image is not ours to dispose.
        material.map?.dispose();
        material.dispose();
      });
      chunkMaterials = [];
    };

    // ── The geode ──
    // One mesh, rebuilt per mark. A mark change closes to the rock, swaps, and reopens — so two marks
    // never share a vertex layout and the cap triangulation is free to follow each shape.
    let geodeBody: GeodeBody | null = null;
    let geodeMesh: THREE.Mesh | null = null;
    let geodeMaterial: THREE.MeshStandardMaterial | null = null;
    let geodeUniforms: GeodeMorphUniforms | null = null;

    const disposeGeode = () => {
      if (geodeMesh) spin.remove(geodeMesh);
      geodeMesh = null;
      geodeBody?.dispose();
      geodeBody = null;
      // The material's map is a per-spec clone, exactly as in disposeChunkMaterials.
      geodeMaterial?.map?.dispose();
      geodeMaterial?.dispose();
      geodeMaterial = null;
      geodeUniforms = null;
    };

    const textureLoader = new THREE.TextureLoader();
    const loadTexture = (path: string): Promise<THREE.Texture> => {
      const cached = textureCache.get(path);
      if (cached) return Promise.resolve(cached);
      return new Promise((resolve, reject) => {
        textureLoader.load(
          path,
          (loaded) => {
            loaded.colorSpace = THREE.SRGBColorSpace;
            textureCache.set(path, loaded);
            resolve(loaded);
          },
          undefined,
          reject,
        );
      });
    };

    // Bumped on every material rebuild so a slow texture can't overwrite a newer mix that started
    // after it — the usual async-race guard.
    let materialToken = 0;

    // Seconds since the current mark began assembling. Driven in the render loop.
    let formationElapsed = 0;
    let shapeBlendElapsed = Infinity;
    replayFormationRef.current = () => {
      // Send them back out to the cloud and let them gather again — replaying a formation means
      // watching it from free, not from wherever it happens to be.
      formationElapsed = 0;
      swarm?.setFormation(0);
    };
    const disposeMaterials = () => {
      materials.forEach((material) => {
        material.map?.dispose();
        material.dispose();
      });
      materials = [];
    };

    const buildMaterials = () => {
      const current = settingsRef.current;
      disposeMaterials();
      materials = createMarkMaterials({
        variant: current.variant,
        color: current.color,
        edgeColor: current.edgeColor,
        edgeEmissive: current.edgeEmissive,
        roughness: current.roughness,
        metalness: current.metalness,
        // The lab has no basalt texture loaded — `lava` here shows the emissive/roughness half of the
        // variant only. The textured read is judged in the field, where the map actually lives.
        surfaceTexture: null,
        flatShading: false,
      });
      if (mesh) mesh.material = materials;
    };

    // SVG source is fetched once per mark and kept, so stepping back to one already seen is instant.
    const svgTextCache = new Map<string, string>();

    const mountGeometry = (geometry: THREE.ExtrudeGeometry) => {
      disposeMesh();
      mesh = new THREE.Mesh(geometry, materials);
      spin.add(mesh);
    };

    /** Create the pool once. Everything after this is re-targeting, never rebuilding. */
    const ensureSwarm = () => {
      if (swarm || chunkMaterials.length === 0) return;
      const current = settingsRef.current;
      swarm = createMarkSwarm(chunkMaterials, {
        targetSize: TARGET_SIZE,
        depth: current.depth,
        edgeChunkCount: current.edgeChunkCount,
        interiorChunkCount: current.interiorChunkCount,
        edgeChunkScale: current.edgeChunkScale,
        interiorChunkScale: current.interiorChunkScale,
        scaleJitter: SWARM_SCALE_JITTER,
        freeRadius: current.freeRadius,
        freeDriftAmplitude: current.freeDriftAmplitude,
        freeDriftSpeed: FREE_DRIFT_SPEED,
        tumbleSpeed: FREE_TUMBLE_SPEED,
        baseFraction: current.formationBaseFraction,
        formationStagger: current.formationStagger,
        formationEdgeDelay: current.formationEdgeDelay,
        formationOrder: current.formationOrder,
        seed: SWARM_SEED,
      });
      spin.add(swarm.group);
    };

    /**
     * Point the swarm at a shape.
     *
     * The FIRST shape plays a formation — the rocks are drifting free and gather into it. Every shape
     * after that is a re-target: the same rocks fly from where they were standing to where they now
     * belong, which is a shape-blend, not a re-formation. That distinction is the whole reason the two
     * blends are separate on the swarm.
     */
    const holdShape = (shapes: THREE.Shape[], flipY: boolean) => {
      ensureSwarm();
      if (!swarm) return;
      swarm.setShape(shapes, flipY);
      if (hasShape) {
        shapeBlendElapsed = 0;
        swarm.setShapeBlend(0);
        return;
      }
      hasShape = true;
      formationElapsed = 0;
      shapeBlendElapsed = Infinity; // nothing to blend from on the first shape
      swarm.setShapeBlend(1);
      swarm.setFormation(0);
    };

    const extrusionOptions = () => {
      const current = settingsRef.current;
      return {
        depth: current.depth,
        bevelThickness: current.bevelThickness,
        bevelSize: current.bevelSize,
        bevelSegments: BEVEL_SEGMENTS,
        curveSegments: CURVE_SEGMENTS,
        targetSize: TARGET_SIZE,
      };
    };

    // Bumped on every geode build, so a slow texture can't mount a body for a mark that has since been
    // stepped past — the same async-race guard the chunk materials use.
    let geodeToken = 0;

    /** Carve the geode for a shape and mount it. Replaces the body outright; there is nothing to reuse. */
    const buildGeode = (shapes: THREE.Shape[], flipY: boolean) => {
      // The crust wears the material's own emissive map, which is where the gold veins come from — so
      // it wants a `meteor` spec, the treatment that drives albedo AND emissive off one texture.
      //
      // Ask for the crust BY ID rather than taking the first `meteor` spec going. The only other one
      // is `molten` — lava, tinted pure red at emissive 5 — and picking that made the crust a light
      // source rather than veined stone. See GEODE_CRUST_SPEC_ID in markChunkMaterial.
      const crustSpec =
        settingsRef.current.chunkSpecs.find((spec) => spec.id === GEODE_CRUST_SPEC_ID) ??
        settingsRef.current.chunkSpecs.find((spec) => spec.treatment === 'meteor') ??
        settingsRef.current.chunkSpecs[0];
      if (!crustSpec) return;

      geodeToken += 1;
      const token = geodeToken;

      loadTexture(crustSpec.texturePath)
        .then((texture) => {
          if (isDisposed || token !== geodeToken) return;
          disposeGeode();

          // Re-read: a slider may have moved while the texture was in flight.
          const current = settingsRef.current;
          const body = buildGeodeBody({
            shapes,
            flipY,
            targetSize: TARGET_SIZE,
            depth: current.depth,
            capEdgeFraction: current.capEdgeFraction,
            capSubdivisions: current.capSubdivisions,
            depthRings: current.depthRings,
            rock: {
              centre: new THREE.Vector3(
                current.rockOffsetX,
                current.rockOffsetY,
                current.rockOffsetZ,
              ),
              radius: current.rockRadius,
              stretch: new THREE.Vector3(
                current.rockStretchX,
                current.rockStretchY,
                current.rockStretchZ,
              ),
              seed: current.rockSeed,
              carveAmplitude: current.rockCarveAmplitude,
            },
            cling: current.cling,
            crustThickness: current.crustThickness,
            markCarveAmplitude: current.markCarveAmplitude,
            markCarveFrequency: current.markCarveFrequency,
            markCarveInPlaneDamping: current.markCarveInPlaneDamping,
            silhouetteHold: current.silhouetteHold,
            crystalPatchScale: current.crystalPatchScale,
            crystalFacetScale: current.crystalFacetScale,
            crystalFacetAmplitude: current.crystalFacetAmplitude,
            textureRepeat: crustSpec.textureRepeat,
            holeSeedFraction: current.holeSeedFraction,
          });

          geodeBody = body;
          geodeMaterial = createChunkMaterial(texture, crustSpec);
          geodeUniforms = enableGeodeMorph(geodeMaterial, {
            ...DEFAULT_GEODE_MORPH,
            crystalColor: current.crystalColor,
            crystalEmissive: current.crystalEmissive,
            crystalRoughness: current.crystalRoughness,
            crystalMetalness: current.crystalMetalness,
            // The charge is the same energy surfacing later as crystal, so it is the same colour.
            chargeColor: current.crystalColor,
            chargeStrength: current.chargeStrength,
            facetShading: current.facetShading,
            edgeBias: current.edgeBias,
            crystalCoverageForming: current.crystalCoverageForming,
            crystalCoverageSettled: current.crystalCoverageSettled,
            wobbleAmplitude: current.wobbleAmplitude,
          });

          geodeMesh = new THREE.Mesh(body.geometry, geodeMaterial);
          // It breathes while closed and bulges past its resting bounds, so a sphere fitted to the
          // closed rock would cull it mid-open.
          geodeMesh.frustumCulled = false;
          spin.add(geodeMesh);
          reportCrustShare(body.crustShare);
        })
        .catch(() => undefined);
    };

    /** Draw the current subject as a solid extrusion, a swarm of rock, or the geode. */
    const buildFromShapes = (shapes: THREE.Shape[], flipY: boolean) => {
      const current = settingsRef.current;

      if (current.body === 'geode') {
        buildGeode(shapes, flipY);
        disposeMesh();
        disposeSwarm();
        return;
      }

      disposeGeode();

      if (current.body === 'rock') {
        holdShape(shapes, flipY);
        disposeMesh();
        return;
      }

      // The solid body extrudes from the raw shapes, so it needs the Y fix on the finished geometry —
      // `createSvgMarkGeometry` does that itself. The other two take the flip on the outline instead.
      disposeSwarm();
    };

    const buildFromSvg = (svgText: string) => {
      if (settingsRef.current.body === 'solid') {
        mountGeometry(createSvgMarkGeometry(svgText, extrusionOptions()));
        disposeSwarm();
        disposeGeode();
        return;
      }
      buildFromShapes(svgToShapes(svgText), true);
    };

    const buildFromLetter = (character: string, loadedFont: Font) => {
      if (settingsRef.current.body === 'solid') {
        mountGeometry(createLetterMarkGeometry(character, loadedFont, extrusionOptions()));
        disposeSwarm();
        disposeGeode();
        return;
      }
      // Typeface outlines are already Y-up, so no flip — see markBody's header note.
      buildFromShapes(letterToShapes(character, loadedFont), false);
    };

    const buildGeometry = () => {
      const current = settingsRef.current;

      if (current.svgMarkId) {
        const mark = markById(current.svgMarkId);
        const cached = svgTextCache.get(mark.id);
        if (cached) {
          buildFromSvg(cached);
          return;
        }
        fetch(mark.source)
          .then((response) => response.text())
          .then((svgText) => {
            if (isDisposed) return;
            svgTextCache.set(mark.id, svgText);
            // Re-read rather than closing over the old settings: a slider may have moved while this
            // was in flight, and the mark that's wanted now may not even be this one.
            if (settingsRef.current.svgMarkId !== mark.id) return;
            buildFromSvg(svgText);
          })
          .catch(() => undefined);
        return;
      }

      if (!font) return;
      buildFromLetter(current.character, font);
    };

    rebuildGeometryRef.current = buildGeometry;
    rebuildMaterialRef.current = buildMaterials;

    /** Rebuild every chunk surface from the current specs, then re-lay the mark with them. */
    const rebuildChunkMaterials = () => {
      const specs = settingsRef.current.chunkSpecs;
      materialToken += 1;
      const token = materialToken;

      Promise.all(specs.map((spec) => loadTexture(spec.texturePath)))
        .then((textures) => {
          if (isDisposed || token !== materialToken) return;
          disposeChunkMaterials();
          chunkMaterials = specs.map((spec, index) => ({
            material: createChunkMaterial(textures[index], spec),
            edgeWeight: spec.edgeWeight,
            interiorWeight: spec.interiorWeight,
          }));
          // Weights decide which bucket each chunk lands in, and that's baked into the instanced
          // meshes — so a material change is always a full re-lay, not a property tweak.
          buildGeometry();
        })
        .catch(() => undefined);
    };

    rebuildChunkMaterialsRef.current = rebuildChunkMaterials;
    // Pool size, chunk scales, the free cloud and the stagger are all baked into the swarm when it's
    // built — they can't be re-targeted, so changing one has to replace the pool outright.
    rebuildSwarmRef.current = () => {
      disposeSwarm();
      buildGeometry();
    };

    buildMaterials();
    rebuildChunkMaterials();

    new FontLoader().load(FONT_PATH, (loadedFont) => {
      if (isDisposed) return;
      font = loadedFont;
      buildGeometry();
    });

    // ── Drag to inspect ──
    let isDragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let dragYaw = 0;
    let dragPitch = 0;

    const onPointerDown = (event: PointerEvent) => {
      isDragging = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!isDragging) return;
      dragYaw += (event.clientX - lastPointerX) * DRAG_YAW_SENSITIVITY;
      dragPitch = THREE.MathUtils.clamp(
        dragPitch + (event.clientY - lastPointerY) * DRAG_PITCH_SENSITIVITY,
        -DRAG_PITCH_CLAMP,
        DRAG_PITCH_CLAMP,
      );
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      isDragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloomPass.resolution.set(width, height);
    };
    const resizeObserver = new ResizeObserver(resize);
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    resize();

    // MSAA on the composer targets — `antialias: true` is ignored once a composer does the rendering.
    composer.renderTarget1.samples = BLOOM_MSAA_SAMPLES;
    composer.renderTarget2.samples = BLOOM_MSAA_SAMPLES;

    const reduceMotion = prefersReducedMotion();
    const clock = new THREE.Clock();
    let idleSpin = 0;
    let frameHandle = 0;
    // The playhead only exists while `geodePlaying` is on; the scrub owns progress otherwise. Kept out
    // of React entirely — writing 60 progress values a second into state would re-render the panel.
    let geodePlayhead = 0;
    let geodePlayDirection = 1;

    const renderFrame = () => {
      frameHandle = requestAnimationFrame(renderFrame);
      const deltaSeconds = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);
      const elapsed = clock.elapsedTime;

      // The swarm gathers out of the drifting cloud, and travels between marks. Reduced motion skips
      // both — hundreds of flying chunks is exactly the motion that setting exists to suppress.
      if (swarm) {
        const duration = settingsRef.current.formationSeconds;
        if (reduceMotion || duration <= 0) {
          swarm.setFormation(1);
          swarm.setShapeBlend(1);
        } else {
          if (formationElapsed <= duration) {
            formationElapsed += deltaSeconds;
            swarm.setFormation(Math.min(formationElapsed / duration, 1));
          }
          const travelSeconds = settingsRef.current.shapeBlendSeconds;
          if (travelSeconds <= 0) {
            swarm.setShapeBlend(1);
          } else if (shapeBlendElapsed <= travelSeconds) {
            shapeBlendElapsed += deltaSeconds;
            swarm.setShapeBlend(Math.min(shapeBlendElapsed / travelSeconds, 1));
          }
        }
        // Always — the free cloud has to keep drifting even when nothing is being animated, or the
        // chunks that aren't in the shape read as a frozen frame.
        swarm.update(elapsed);
      }

      // The geode is four curves of one number, so the whole frame is decided here. Nothing is
      // stateful, which is what lets it be scrubbed backwards as freely as forwards.
      if (geodeUniforms) {
        const current = settingsRef.current;

        if (current.geodePlaying && !reduceMotion) {
          const cycle = Math.max(current.geodeCycleSeconds, 0.1);
          geodePlayhead += (deltaSeconds / cycle) * geodePlayDirection;
          if (geodePlayhead >= 1) {
            geodePlayhead = 1;
            geodePlayDirection = -1;
          } else if (geodePlayhead <= 0) {
            geodePlayhead = 0;
            geodePlayDirection = 1;
          }
        } else if (!current.geodePlaying) {
          // Seek, so pressing play resumes from wherever the scrub was left.
          geodePlayhead = current.geodeProgress;
          geodePlayDirection = 1;
        }

        // Reduced motion gets the finished mark, not a rock that never opens.
        const progress = reduceMotion
          ? 1
          : current.geodePlaying
            ? geodePlayhead
            : current.geodeProgress;
        const phases = evaluateGeodePhases(progress, current.geodePhaseTiming);

        geodeUniforms.uGrow.value = phases.grow;
        geodeUniforms.uCharge.value = phases.charge;
        geodeUniforms.uReveal.value = phases.reveal;
        geodeUniforms.uVeinFlare.value = phases.veinFlare;
        // The crystal takes the surface only once the letter is whole — see the `spread` phase.
        geodeUniforms.uCrystalCoverage.value = THREE.MathUtils.lerp(
          current.crystalCoverageForming,
          current.crystalCoverageSettled,
          phases.spread,
        );
        // Frozen under reduced motion — the wobble is the one thing here that moves on its own.
        geodeUniforms.uTime.value = reduceMotion ? 0 : elapsed;

        // Pushed per frame rather than baked at build time, so the crystal's look stays live while the
        // geometry knobs stay debounced behind a rebuild.
        geodeUniforms.uCrystalColor.value.set(current.crystalColor);
        geodeUniforms.uChargeColor.value.set(current.crystalColor);
        geodeUniforms.uCrystalEmissive.value = current.crystalEmissive;
        geodeUniforms.uCrystalRoughness.value = current.crystalRoughness;
        geodeUniforms.uCrystalMetalness.value = current.crystalMetalness;
        geodeUniforms.uChargeStrength.value = current.chargeStrength;
        geodeUniforms.uFacetShading.value = current.facetShading;
        geodeUniforms.uEdgeBias.value = current.edgeBias;

        geodeUniforms.uWobbleAmplitude.value = current.wobbleAmplitude;
      }

      if (!reduceMotion && !isDragging) {
        idleSpin += THREE.MathUtils.degToRad(IDLE_SPIN_DEGREES_PER_SECOND) * deltaSeconds;
      }
      spin.rotation.y = idleSpin + dragYaw;
      spin.rotation.x = dragPitch;
      composer.render();
    };
    renderFrame();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      rebuildGeometryRef.current = null;
      rebuildMaterialRef.current = null;
      rebuildChunkMaterialsRef.current = null;
      replayFormationRef.current = null;
      rebuildSwarmRef.current = null;
      disposeMesh();
      disposeSwarm();
      disposeGeode();
      disposeMaterials();
      disposeChunkMaterials();
      textureCache.forEach((texture) => texture.dispose());
      textureCache.clear();
      environmentTarget.dispose();
      pmremGenerator.dispose();
      bloomPass.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, [canvasRef, reportCrustShare]);

  // Geometry is baked, so a shape change needs a rebuild; material properties are pushed onto live
  // materials. Split so dragging a colour slider doesn't re-extrude the glyph every frame.
  useEffect(() => {
    rebuildGeometryRef.current?.();
    // Only what changes the SHAPE being held. Pool-defining values are the effect below.
  }, [
    settings.character,
    settings.svgMarkId,
    settings.body,
    settings.bevelSize,
    settings.bevelThickness,
  ]);

  // Baked into the pool at construction — these can't be re-targeted, so they replace it.
  //
  // `depth` belongs HERE, not with the geometry above: the swarm reads it once, when it scatters the
  // chunks through the slab (see markSwarm's setShape), so re-targeting the same pool leaves the old
  // thickness in place. Rebuilding the pool covers the solid body too, because the rebuild ends in
  // `buildGeometry()` either way.
  useEffect(() => {
    rebuildSwarmRef.current?.();
  }, [
    settings.depth,
    settings.edgeChunkCount,
    settings.interiorChunkCount,
    settings.edgeChunkScale,
    settings.interiorChunkScale,
    settings.freeRadius,
    settings.freeDriftAmplitude,
    settings.formationBaseFraction,
    settings.formationStagger,
    settings.formationEdgeDelay,
    settings.formationOrder,
  ]);

  // The geode's crust mask, growth delay and carves are all BAKED into the vertex buffers, so every one
  // of these replaces the body. That includes the rock's pose: unlike a transform, moving the rock
  // changes which parts of the mark count as old skin, and that is geometry.
  //
  // The look knobs (crystal colour, emissive, roughness, facet shading, wobble) are deliberately NOT
  // here — they are pushed onto uniforms every frame, so they stay live while these stay debounced.
  useEffect(() => {
    rebuildGeometryRef.current?.();
  }, [
    settings.rockOffsetX,
    settings.rockOffsetY,
    settings.rockOffsetZ,
    settings.rockRadius,
    settings.rockStretchX,
    settings.rockStretchY,
    settings.rockStretchZ,
    settings.rockSeed,
    settings.rockCarveAmplitude,
    settings.cling,
    settings.crustThickness,
    settings.markCarveAmplitude,
    settings.markCarveFrequency,
    settings.markCarveInPlaneDamping,
    // Both of these were missing, and both are baked: `silhouetteHold` re-weights the per-vertex
    // growth delay (markGeodeBody §7.5) and `crystalPatchScale` bakes the aCrystalPatch attribute.
    // Without them here the two sliders moved React state and nothing else — they only ever landed if
    // some OTHER geometry knob happened to be nudged afterwards.
    settings.silhouetteHold,
    settings.crystalPatchScale,
    settings.crystalFacetScale,
    settings.crystalFacetAmplitude,
    settings.capEdgeFraction,
    settings.capSubdivisions,
    settings.depthRings,
    settings.holeSeedFraction,
  ]);

  // The chunk mix is an array of objects, so it's compared by serialised value rather than by
  // reference — the panel builds a new array on every keystroke and re-laying the mark for an
  // identical mix would fight the sliders.
  const chunkSpecsKey = JSON.stringify(settings.chunkSpecs);
  useEffect(() => {
    rebuildChunkMaterialsRef.current?.();
  }, [chunkSpecsKey]);

  useEffect(() => {
    rebuildMaterialRef.current?.();
  }, [
    settings.variant,
    settings.color,
    settings.edgeColor,
    settings.edgeEmissive,
    settings.roughness,
    settings.metalness,
  ]);

  // Last, so every effect above is actually reachable. These two used to sit BELOW this return and
  // therefore never ran at all — which meant the whole chunk mix and every material control were
  // inert, and "Copy config" exported numbers that had never been rendered.
  return {
    replayFormation: () => replayFormationRef.current?.(),
    crustShare,
  };
}
