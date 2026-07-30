import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { letterToShapes, svgToShapes } from './markBody';
import { MARKS } from './marks';
import type { PreparedMark } from './transitions/markTransition';

/**
 * Every registry mark, resolved to the outlines a transition strategy builds from.
 *
 * ── Why this is shared between the lab and the section ───────────────────────────────────────────
 * It started inside `useTransitionLab`, where it existed so four candidates could be compared against
 * identical shapes. The works field now ships one of those candidates, so it needs the same outlines —
 * and "the same" has to mean it literally, not by inspection. Two copies of this function are one
 * `curveSegments` edit away from the lab judging a mark the section does not render, at which point
 * every look decision made in the lab is about a different object.
 *
 * So there is one loader, and the lab imports it from the section rather than the other way round.
 * That direction is deliberate and matches everything else under `WorksField/` that the labs consume
 * (`markBody`, `marks`, `transitions/*`): the section owns the marks, the lab borrows them.
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
