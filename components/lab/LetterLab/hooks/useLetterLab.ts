import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
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
  createMarkAggregate,
  type MarkAggregate,
  type MarkChunkMaterial,
} from '@/components/sections/WorksField/markAggregate';
import {
  createChunkMaterial,
  type ChunkMaterialSpec,
} from '@/components/sections/WorksField/markChunkMaterial';
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

const AGGREGATE_SCALE_JITTER = 0.45;
const AGGREGATE_SEED = 149;

const IDLE_SPIN_DEGREES_PER_SECOND = 18;
const DRAG_YAW_SENSITIVITY = 0.008;
const DRAG_PITCH_SENSITIVITY = 0.006;
const DRAG_PITCH_CLAMP = 0.9;
const MAX_FRAME_SECONDS = 0.05;
const MAX_DEVICE_PIXEL_RATIO = 2;

export interface LetterLabSettings {
  /**
   * How the mark is built: one bevelled solid, or an assembly of carved rock chunks holding the shape.
   * The rock body is the one that belongs in this scene — see markAggregate.ts.
   */
  body: 'solid' | 'rock';
  /**
   * What the chunks are made of, and in what proportion. A mark's readability comes from the CONTRAST
   * between these — one surface for everything reads as a blob.
   */
  chunkSpecs: ChunkMaterialSpec[];
  /** Spacing between outline chunks, in world units. The main lever on how legible the mark stays. */
  edgeSpacing: number;
  edgeChunkScale: number;
  interiorChunkScale: number;
  interiorChunkCount: number;
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

export function useLetterLab(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  settings: LetterLabSettings,
) {
  // The render loop is built once; it reads the latest settings through this ref rather than being
  // torn down and rebuilt every time a slider moves.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Set by the scene effect so the settings effect can ask for a rebuild without re-running setup.
  const rebuildGeometryRef = useRef<(() => void) | null>(null);
  const rebuildMaterialRef = useRef<(() => void) | null>(null);
  const rebuildChunkMaterialsRef = useRef<(() => void) | null>(null);

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
    let aggregate: MarkAggregate | null = null;

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
    const disposeAggregate = () => {
      if (!aggregate) return;
      spin.remove(aggregate.group);
      aggregate.dispose();
      aggregate = null;
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

    /** Build the rock assembly for a set of outlines, and put it on the rig. */
    const mountAggregate = (shapes: THREE.Shape[], flipY: boolean) => {
      if (chunkMaterials.length === 0) return;
      const current = settingsRef.current;
      disposeAggregate();
      aggregate = createMarkAggregate(shapes, chunkMaterials, {
        targetSize: TARGET_SIZE,
        depth: current.depth,
        edgeSpacing: current.edgeSpacing,
        edgeChunkScale: current.edgeChunkScale,
        interiorChunkScale: current.interiorChunkScale,
        interiorChunkCount: current.interiorChunkCount,
        scaleJitter: AGGREGATE_SCALE_JITTER,
        flipY,
        seed: AGGREGATE_SEED,
      });
      spin.add(aggregate.group);
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

    /** Draw the current subject as either a solid extrusion or an assembly of rock. */
    const buildFromSvg = (svgText: string) => {
      if (settingsRef.current.body === 'rock') {
        mountAggregate(svgToShapes(svgText), true);
        disposeMesh();
        return;
      }
      mountGeometry(createSvgMarkGeometry(svgText, extrusionOptions()));
      disposeAggregate();
    };

    const buildFromLetter = (character: string, loadedFont: Font) => {
      if (settingsRef.current.body === 'rock') {
        // Typeface outlines are already Y-up, so no flip — see markBody's header note.
        mountAggregate(letterToShapes(character, loadedFont), false);
        disposeMesh();
        return;
      }
      mountGeometry(createLetterMarkGeometry(character, loadedFont, extrusionOptions()));
      disposeAggregate();
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
            weight: spec.weight,
          }));
          // Weights decide which bucket each chunk lands in, and that's baked into the instanced
          // meshes — so a material change is always a full re-lay, not a property tweak.
          buildGeometry();
        })
        .catch(() => undefined);
    };

    rebuildChunkMaterialsRef.current = rebuildChunkMaterials;

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

    const renderFrame = () => {
      frameHandle = requestAnimationFrame(renderFrame);
      const deltaSeconds = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);
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
      disposeMesh();
      disposeAggregate();
      disposeMaterials();
      disposeChunkMaterials();
      textureCache.forEach((texture) => texture.dispose());
      textureCache.clear();
      bloomPass.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, [canvasRef]);

  // Geometry is baked, so a shape change needs a rebuild; material properties are pushed onto live
  // materials. Split so dragging a colour slider doesn't re-extrude the glyph every frame.
  useEffect(() => {
    rebuildGeometryRef.current?.();
  }, [
    settings.character,
    settings.svgMarkId,
    settings.body,
    settings.depth,
    settings.bevelSize,
    settings.bevelThickness,
    settings.edgeSpacing,
    settings.edgeChunkScale,
    settings.interiorChunkScale,
    settings.interiorChunkCount,
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
}
