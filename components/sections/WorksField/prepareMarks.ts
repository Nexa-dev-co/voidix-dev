import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { letterToShapes, svgToShapes } from './markBody';
import { MARKS } from './marks';
import type { PreparedMark } from './transitions/markTransition';

/**
 * Every registry mark, resolved to the outlines a transition strategy builds from.
 *
 * ── Why every mark goes through one loader ───────────────────────────────────────────────────────
 * It began life in a comparison lab, where four candidate transitions had to be judged against
 * identical shapes. The lab is gone and the section ships the candidate that won, but the reason for a
 * single loader outlives it: `curveSegments` and the SVG's Y-flip decide what a mark actually IS, and
 * a second copy of this function is one edit away from four marks cut to different fidelities.
 *
 * ── Why shapes rather than geometry ─────────────────────────────────────────────────────────────
 * `marks.ts`'s `loadMarks` returns extruded `ExtrudeGeometry`, which is what the old meteor-era body
 * wanted. A partitioning strategy needs the CONTOURS — it triangulates and cuts them itself. Both
 * loaders exist because they answer different questions, and neither is a superset of the other.
 */

const FONT_PATH = '/fonts/helvetiker_bold.typeface.json';

function loadFontOrNull(): Promise<Font | null> {
  return new Promise<Font | null>((resolve) => {
    new FontLoader().load(FONT_PATH, resolve, undefined, () => resolve(null));
  });
}

/**
 * Fetch and resolve every mark.
 *
 * A mark that fails to load is simply absent from the result — the same policy `loadMarks` uses, and
 * for the same reason: one unreachable file should cost that one mark, not the whole section. Callers
 * must therefore treat the length as authoritative rather than assuming `MARKS.length`.
 */
export async function prepareMarks(): Promise<PreparedMark[]> {
  const needsFont = MARKS.some((mark) => mark.kind === 'letter');
  const font = needsFont ? await loadFontOrNull() : null;

  const prepared = await Promise.all(
    MARKS.map(async (mark): Promise<PreparedMark | null> => {
      try {
        if (mark.kind === 'svg') {
          const response = await fetch(mark.source);
          if (!response.ok) return null;
          // SVG's Y axis points down. The flag travels with the mark rather than being applied here,
          // because the two families of builder want it corrected at different moments — see the note
          // on `flipY` in `markTransition.ts`.
          return {
            id: mark.id,
            label: mark.label,
            shapes: svgToShapes(await response.text()),
            flipY: true,
          };
        }
        if (!font) return null;
        return {
          id: mark.id,
          label: mark.label,
          shapes: letterToShapes(mark.source, font),
          flipY: false,
        };
      } catch {
        return null;
      }
    }),
  );

  return prepared.filter((mark): mark is PreparedMark => mark !== null);
}
