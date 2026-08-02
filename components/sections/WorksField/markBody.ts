import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';

/**
 * The 3D marks — a project's logo or glyph, extruded into a solid object.
 *
 * ── What replaced what ───────────────────────────────────────────────────────────────────────────
 * This is the marks' equivalent of `meteorBody.ts`. The rock was carved out of a sphere by layered
 * noise; a mark is a flat outline given depth. Both end up as one monumental body at the origin that
 * the authored camera path orbits, which is why the scene around them needs no changes at all.
 *
 * ── Why extrusion and not a modelled asset ───────────────────────────────────────────────────────
 * Same reason the rock stopped being a `.glb`: the silhouette becomes a number you nudge rather than
 * an asset you re-export. An SVG is a few hundred bytes, it's resolution-independent, and swapping
 * which mark a project shows is a one-line data edit. It also means new logos cost nothing — drop the
 * file in `public/logos`, add a registry entry, done.
 *
 * ── The Y-axis trap, and why the fix is a rotation ───────────────────────────────────────────────
 * SVG's Y axis points DOWN; three's points UP. Left alone, every mark renders upside down.
 *
 * The obvious fix — `geometry.scale(1, -1, 1)` — is wrong. A negative scale is a REFLECTION, not a
 * rotation: it inverts every triangle's winding order, so the whole shell turns inside out and has to
 * be papered over with `side: DoubleSide`. Instead we rotate a half turn about X, which is a proper
 * rotation (determinant +1) and therefore leaves winding and normals valid.
 *
 * That maps (x, y, z) → (x, −y, −z). Y comes out up, X is untouched — so the mark is neither upside
 * down NOR mirrored — and the negated Z simply means you're looking at the extrusion's far cap
 * instead of its near one. For a symmetric extrusion those are the same outline with the same
 * outward-facing normals, so there is nothing to correct.
 *
 * Text needs none of this: typeface fonts are already authored Y-up, so `TextGeometry` comes out the
 * right way round. Hence the two builders below rather than one with a flag.
 *
 * ── Everything is normalised and centred ─────────────────────────────────────────────────────────
 * The three source SVGs have viewBoxes of 95, 149 and 97 units — left alone the marks would be wildly
 * different sizes. Each is scaled so its largest dimension equals `targetSize` (the same discipline
 * the fleet uses to normalise vessels) and centred on its own bounds, so the camera path — which
 * orbits the origin and whose first stop must match the incoming flight's landing pose — frames every
 * mark identically.
 */

/**
 * Text is built at `size: 100` while SVG marks come in at their viewBox scale, so the depth and bevel
 * asked for in world units have to be lifted into that space before the shared normalise brings
 * everything back down. Without this a letter would extrude to a wafer next to a solid logo.
 */
const LETTER_SOURCE_SIZE = 100;
const LETTER_SOURCE_SCALE = 40;

// ── Shapes ───────────────────────────────────────────────────────────────────────────────────────
// The 2D outlines, before anything is done with them. Exported because a mark has two possible bodies
// built from the SAME outline — extruded solid (below) or assembled out of rock chunks
// (markSwarm.ts) — and neither should own how the other gets its shapes.

/**
 * Outlines from raw SVG source.
 *
 * `createShapes` resolves each path's subpaths into outer contours plus their holes, honouring the
 * fill rule — which is what carves the ring out of the compass and the cutouts out of the shield.
 */
export function svgToShapes(svgText: string): THREE.Shape[] {
  const parsed = new SVGLoader().parse(svgText);
  return parsed.paths.flatMap((path) => SVGLoader.createShapes(path));
}

/**
 * Outlines for a glyph (or short word) in a loaded typeface.
 *
 * Built at `LETTER_SOURCE_SIZE` for the same reason the geometry is: the caller normalises to a world
 * size afterwards, and a large source keeps the outline's detail above the sampling noise floor.
 */
export function letterToShapes(text: string, font: Font): THREE.Shape[] {
  return font.generateShapes(text, LETTER_SOURCE_SIZE);
}

/** Extrusion settings shared by both builders. Depth/bevel are what make a mark read as machined. */
export interface MarkGeometryOptions {
  /** How far the outline is pushed back into Z. */
  depth: number;
  /** Rounded lip on the front and back edges — the single biggest factor in whether this looks premium. */
  bevelThickness: number;
  bevelSize: number;
  /** Segments across the bevel. 1 is a chamfer, higher rounds it. */
  bevelSegments: number;
  /** How finely curves in the outline are sampled. Low values facet a circle visibly. */
  curveSegments: number;
  /** Largest dimension of the finished mark, in world units. */
  targetSize: number;
}

/**
 * Scale a mark to `targetSize` on its largest axis and centre it on the origin.
 *
 * Done after extrusion rather than on the source outline because the bevel adds to the bounds — sizing
 * beforehand would leave every mark slightly larger than asked for, by a different amount depending on
 * how much bevel it has.
 */
function normaliseAndCentre(geometry: THREE.BufferGeometry, targetSize: number): void {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return;

  const size = new THREE.Vector3();
  bounds.getSize(size);
  const largestDimension = Math.max(size.x, size.y, size.z);
  if (largestDimension > 0) {
    const scaleFactor = targetSize / largestDimension;
    geometry.scale(scaleFactor, scaleFactor, scaleFactor);
  }

  // Re-measured after the scale, so the centring is exact rather than the pre-scale offset.
  geometry.center();
}

function extrudeShapes(
  shapes: THREE.Shape[],
  options: MarkGeometryOptions,
): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(shapes, {
    depth: options.depth,
    bevelEnabled: options.bevelSize > 0 || options.bevelThickness > 0,
    bevelThickness: options.bevelThickness,
    bevelSize: options.bevelSize,
    bevelOffset: 0,
    bevelSegments: options.bevelSegments,
    curveSegments: options.curveSegments,
  });
}

/**
 * Build a mark from raw SVG source.
 *
 * Takes the text rather than a URL so the caller owns fetching — the field preloads every mark during
 * init and caches the geometry, because the project swap happens at the peak of the spin and cannot
 * afford to wait on a network round trip (see the plan doc, §6).
 */
export function createSvgMarkGeometry(
  svgText: string,
  options: MarkGeometryOptions,
): THREE.ExtrudeGeometry {
  const geometry = extrudeShapes(svgToShapes(svgText), options);
  // Y-down → Y-up. A proper rotation, not a mirror — see the header note.
  geometry.rotateX(Math.PI);
  normaliseAndCentre(geometry, options.targetSize);
  return geometry;
}

/**
 * Build a mark from a glyph (or a short word) in a loaded typeface.
 *
 * No axis flip here: typeface JSON is authored Y-up already. `TextGeometry` also lays glyphs out from
 * a left baseline origin, so the centring in `normaliseAndCentre` is doing real work — without it a
 * letter would orbit around a point off its own edge.
 */
export function createLetterMarkGeometry(
  text: string,
  font: Font,
  options: MarkGeometryOptions,
): THREE.ExtrudeGeometry {
  const geometry = new TextGeometry(text, {
    font,
    // The source size is arbitrary — `normaliseAndCentre` rescales to `targetSize` regardless. A large
    // value keeps the bevel proportions sane relative to the glyph before that rescale.
    size: LETTER_SOURCE_SIZE,
    depth: options.depth * LETTER_SOURCE_SCALE,
    bevelEnabled: options.bevelSize > 0 || options.bevelThickness > 0,
    bevelThickness: options.bevelThickness * LETTER_SOURCE_SCALE,
    bevelSize: options.bevelSize * LETTER_SOURCE_SCALE,
    bevelOffset: 0,
    bevelSegments: options.bevelSegments,
    curveSegments: options.curveSegments,
  });

  normaliseAndCentre(geometry, options.targetSize);
  return geometry;
}

// ── Materials ────────────────────────────────────────────────────────────────────────────────────
// `ExtrudeGeometry` emits exactly two material groups: group 0 is the front and back caps, group 1 is
// the extruded side walls (bevel included). That maps straight onto a material array, which is what
// makes the brand look cheap to build — a dark face with a glowing rim needs no shader work at all,
// just two standard materials handed over in the right order.
//
//         face (group 0)        ┌──────────────┐
//         dark, metallic ──────▶│      ◈       │
//         edge (group 1)        └━━━━━━━━━━━━━━┘ ← emissive; blooms via the field's existing pass
//
// Both variants are built and the treatment picks between them — the call on which one
// is right can only be made against the real lighting.

export type MarkMaterialVariant = 'hull' | 'lava';

export interface MarkMaterialOptions {
  variant: MarkMaterialVariant;
  /** Face tint. */
  color: string;
  /** Edge glow colour, and how hard it burns. */
  edgeColor: string;
  edgeEmissive: number;
  roughness: number;
  metalness: number;
  /** Only used by `lava` — the basalt surface reused from the rock. */
  surfaceTexture?: THREE.Texture | null;
  textureRepeat?: number;
  flatShading: boolean;
}

/**
 * The pair of materials a mark is drawn with, in the order `ExtrudeGeometry`'s groups expect:
 * `[face, edge]`. Returned as an array so it can be assigned to `mesh.material` directly.
 */
export function createMarkMaterials(
  options: MarkMaterialOptions,
): THREE.MeshStandardMaterial[] {
  const {
    variant,
    color,
    edgeColor,
    edgeEmissive,
    roughness,
    metalness,
    surfaceTexture,
    textureRepeat,
    flatShading,
  } = options;

  // `lava` reuses the rock's basalt-and-veins texture, so the mark stays in the same family as the
  // debris around it. Note the UVs are NOT the rock's spherical projection — ExtrudeGeometry generates
  // world-scaled UVs per face — so the repeat that looked right on the rock will need re-tuning here.
  const useTexture = variant === 'lava' && !!surfaceTexture;
  let faceMap: THREE.Texture | null = null;
  if (useTexture && surfaceTexture) {
    faceMap = surfaceTexture.clone();
    faceMap.needsUpdate = true;
    faceMap.wrapS = THREE.RepeatWrapping;
    faceMap.wrapT = THREE.RepeatWrapping;
    const repeat = textureRepeat ?? 1;
    faceMap.repeat.set(repeat, repeat);
  }

  const faceMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    map: faceMap,
    // In `lava` the same texture lights only where it's bright — the veins — exactly as it does on the
    // rock. In `hull` the face is inert and all the light comes off the edge.
    emissiveMap: useTexture ? faceMap : null,
    emissive: new THREE.Color(useTexture ? edgeColor : '#000000'),
    emissiveIntensity: useTexture ? edgeEmissive : 0,
    roughness,
    metalness,
    flatShading,
  });

  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(variant === 'hull' ? edgeColor : color),
    emissive: new THREE.Color(edgeColor),
    emissiveIntensity: edgeEmissive,
    roughness,
    metalness,
    flatShading,
  });

  return [faceMaterial, edgeMaterial];
}
