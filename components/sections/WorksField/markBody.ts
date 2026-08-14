import * as THREE from 'three';
import { SVGLoader, type SVGResultPaths } from 'three/examples/jsm/loaders/SVGLoader.js';
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
 *
 * ── ⚠ UNFILLED PATHS ARE SKIPPED, AND THAT IS A FIX, NOT A FILTER (2026-08-14) ───────────────────
 * `SVGLoader.parseNode` pushes EVERY geometry element onto `paths` whatever its fill — `fill: none`
 * only skips setting a colour — and the parse is seeded with `fill: '#000'`, so `style.fill` is
 * never undefined. Handing all of them to `createShapes` therefore triangulates a stroke-only
 * drawing as though its outlines were fills: an outlined circle comes out as a SOLID DISC.
 *
 * That mattered nowhere while the marks were three logos chosen by hand. It matters now that anyone
 * with the admin panel can upload one, because stroke-only icons are the commonest kind there is and
 * the failure has no symptom — nothing throws, nothing is empty, the section just shows a blob.
 *
 * Skipping them means a mixed file draws its fills and ignores its stroke decoration, and a
 * stroke-only file yields ZERO shapes — which is what lets `prepareMarks` fall back to the project's
 * initial instead. A wrong mark becomes a graceful one.
 *
 * ✓ Verified a no-op for the three logos this repo ships: none contains `fill="none"`, none has a
 * stroke, none has a `<style>` block. ⚠ Paired with `inspectMarkSvg` in the admin panel, which
 * refuses an upload by this same rule so the editor hears about it rather than the visitor.
 */
export function svgToShapes(svgText: string): THREE.Shape[] {
  const parsed = new SVGLoader().parse(svgText);
  return parsed.paths.filter(isFilledPath).flatMap((path) => SVGLoader.createShapes(path));
}

/** `userData` is typed loosely by three; narrowed to the one field read rather than trusted whole. */
function isFilledPath(path: SVGResultPaths): boolean {
  const style = (path.userData as { style?: { fill?: string } } | undefined)?.style;
  return style?.fill !== undefined && style.fill !== 'none';
}

/** Outlines for a glyph (or short word) in a loaded typeface. */
export function letterToShapes(text: string, font: Font): THREE.Shape[] {
  return font.generateShapes(text, LETTER_SOURCE_SIZE);
}
