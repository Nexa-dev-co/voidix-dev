import * as THREE from 'three';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import {
  createSvgMarkGeometry,
  createLetterMarkGeometry,
  type MarkGeometryOptions,
} from './markBody';

/**
 * The marks a project can show, and the one place they're loaded.
 *
 * ── Why everything is built up front ─────────────────────────────────────────────────────────────
 * A project change swaps the body at the PEAK of the wind-up spin — the single frame where the mark is
 * turning too fast to read (see worksTransition.ts). That swap has to be instantaneous. An SVG fetch
 * or a font parse at that moment would stall the body mid-blur and expose the very thing the spin
 * exists to hide.
 *
 * So `loadMarks` fetches and extrudes every mark once, during field init, and hands back a cache. From
 * then on a swap is a synchronous map lookup — exactly as cheap as the rock's re-carve was.
 *
 * ── Why the geometry is cached and not the mesh ──────────────────────────────────────────────────
 * Materials are cheap (colour, roughness, the hull/lava variant) and the scene rebuilds them
 * freely; geometry is the expensive, immutable half. Caching only the geometry means a mark's look can
 * be rebuilt without re-fetching anything.
 */

const FONT_PATH = '/fonts/helvetiker_bold.typeface.json';

/**
 * ⚠ The typeface is helvetiker, NOT Syne.
 *
 * `three` ships helvetiker / optimer / gentilis and none of them is the brand face. The Syne binary
 * Next serves is a hashed `.woff2` in the build output, which isn't convertible to a typeface JSON
 * without new tooling. So any letter rendered here reads generic by construction.
 *
 * That is a deliberate, scoped compromise: it answers "does extruded 3D type work as a body in this
 * scene" but NOT "how does Syne look extruded". Drop a Syne `.ttf`/`.otf` into `public/fonts` and this
 * becomes conclusive — see docs/works-marks-plan.md §7.
 */
export type MarkKind = 'svg' | 'letter';

export interface MarkDefinition {
  /** Stable id a project refers to. */
  id: string;
  kind: MarkKind;
  /** Path under `public/` for an `svg` mark, or the glyph itself for a `letter` mark. */
  source: string;
  /** Human label. */
  label: string;
}

/**
 * The three supplied logos plus the company initial.
 *
 * The logo→project pairing is arbitrary (they're stand-ins until real project marks exist), so it
 * lives as data here and in `worksProjects.ts` rather than being wired into the scene — re-shuffling
 * is an edit to two lines, not to any code.
 */
export const MARKS: MarkDefinition[] = [
  {
    id: 'signal',
    kind: 'svg',
    source: '/logos/rss-symbol-variant-for-facebook-in-a-square-svgrepo-com.svg',
    label: 'Signal square',
  },
  {
    id: 'compass',
    kind: 'svg',
    source: '/logos/compass-svgrepo-com.svg',
    label: 'Compass',
  },
  {
    id: 'shield',
    kind: 'svg',
    source: '/logos/shield-checkered-tool-svgrepo-com.svg',
    label: 'Shield',
  },
  {
    id: 'initial',
    kind: 'letter',
    source: 'V',
    label: 'Voidix initial',
  },
];

export function markById(id: string): MarkDefinition {
  return MARKS.find((mark) => mark.id === id) ?? MARKS[0];
}

/** Geometry for every mark, keyed by id, plus the loaded font so letters can be built on demand. */
export interface MarkCache {
  geometries: Map<string, THREE.ExtrudeGeometry>;
  font: Font | null;
  dispose: () => void;
}

function fetchText(url: string): Promise<string> {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
    return response.text();
  });
}

function loadFont(): Promise<Font> {
  return new Promise((resolve, reject) => {
    new FontLoader().load(FONT_PATH, resolve, undefined, reject);
  });
}

/**
 * Fetch and extrude every mark.
 *
 * Resolves once all four are ready. A mark that fails to load is simply absent from the cache — the
 * caller falls back to whatever it was already drawing rather than throwing away the whole section for
 * one bad file.
 */
export async function loadMarks(options: MarkGeometryOptions): Promise<MarkCache> {
  const geometries = new Map<string, THREE.ExtrudeGeometry>();
  let font: Font | null = null;

  const needsFont = MARKS.some((mark) => mark.kind === 'letter');
  if (needsFont) {
    font = await loadFont().catch(() => null);
  }

  await Promise.all(
    MARKS.map(async (mark) => {
      try {
        if (mark.kind === 'svg') {
          const svgText = await fetchText(mark.source);
          geometries.set(mark.id, createSvgMarkGeometry(svgText, options));
          return;
        }
        if (font) {
          geometries.set(mark.id, createLetterMarkGeometry(mark.source, font, options));
        }
      } catch {
        // Left out of the cache on purpose — see the note above.
      }
    }),
  );

  return {
    geometries,
    font,
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      geometries.clear();
    },
  };
}
