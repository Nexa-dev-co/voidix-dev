import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';

/**
 * A project's mark, as 2D outlines — the raw material every body in this section is built from.
 *
 * ── Why outlines and not geometry ────────────────────────────────────────────────────────────────
 * This file used to extrude them too: `createSvgMarkGeometry` / `createLetterMarkGeometry` turned an
 * outline into a bevelled `ExtrudeGeometry`, one solid object per mark, and `marks.ts` cached the lot
 * up front so a project swap could be a synchronous map lookup at the peak of a wind-up spin.
 *
 * None of that survived the accretion strategy. The mark is no longer a solid that gets swapped — it
 * is triangulated, partitioned into interlocking stones and grown out of a core
 * (`transitions/accretionChunks.ts`), which needs the contours, not a finished mesh. The extrusion,
 * its bevel options and the normalise/centre pass went with the body they served; they are in git.
 *
 * ── The Y-axis trap has NOT gone away ────────────────────────────────────────────────────────────
 * SVG's Y axis points DOWN and three's points UP, so an SVG mark is upside down until something
 * corrects it. That correction deliberately does not happen here: the two families of builder want it
 * applied at different moments, so the flag travels with the mark instead (`flipY` on `PreparedMark`
 * — see `transitions/markTransition.ts` and `extractShapeLoops` in `markContours.ts`).
 *
 * Typeface outlines need none of it: font JSON is authored Y-up already. Hence two functions rather
 * than one with a flag.
 *
 * ── Everything is normalised downstream ──────────────────────────────────────────────────────────
 * The three source SVGs have viewBoxes of 95, 149 and 97 units and a glyph comes in at 100, so the
 * outlines here are at wildly different scales by design. Whatever builds a body from them normalises
 * to a world `targetSize` (`markCapMesh` measures the source bounds first, so its `edgeFraction` means
 * the same thing on all four).
 */

/**
 * The size glyph outlines are generated at.
 *
 * Arbitrary, and deliberately large: the builder rescales to a world size afterwards, and a large
 * source keeps the outline's detail above the sampling noise floor on the way through.
 */
const LETTER_SOURCE_SIZE = 100;

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

/** Outlines for a glyph (or short word) in a loaded typeface. */
export function letterToShapes(text: string, font: Font): THREE.Shape[] {
  return font.generateShapes(text, LETTER_SOURCE_SIZE);
}
