import * as THREE from 'three';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { letterToShapes, svgToShapes } from './markBody';
import type { WorksProject } from './worksProjects';
import type { PreparedMark } from './transitions/markTransition';

/**
 * Every project's mark, resolved to the outlines the accretion strategy builds from.
 *
 * ── ⚠ ONE MARK PER PROJECT, IN ORDER, ALWAYS ────────────────────────────────────────────────────
 * This function used to resolve a REGISTRY — a fixed list of four marks in `marks.ts` — and a
 * project picked one by `markId`. That indirection existed for a reason worth remembering: a mark
 * whose file failed to load was simply dropped, and matching by position would then have shifted
 * every later project onto its neighbour's logo. Matching by id avoided that.
 *
 * Neither the registry nor the id survives (2026-08-14). A project carries its own mark now, and
 * more importantly it can always produce one: if the SVG is missing, refused, unparseable or
 * stroke-only, the project grows its own INITIAL instead. So the returned array is the same length
 * as the projects array, in the same order, with no holes — and `markIndexOfProject` in
 * `useWorksField` collapses to the identity it always wanted to be.
 *
 * ⚠ Callers may rely on that length. Nothing here is allowed to return early or filter.
 *
 * ── Where a source comes from ───────────────────────────────────────────────────────────────────
 *   `markSvg`      the panel's upload, ALREADY FETCHED — `lib/cms/markSource.ts` dereferenced the
 *                  storage URL on the server so this never touches the network for it, and so the
 *                  storage host never appears in the page
 *   `markSvgPath`  a same-origin file in `public/logos/`, and only the repo's own fallback projects
 *                  set it. This is the one fetch left here, and it is to our own origin
 *   neither        the initial
 *
 * ── Why every mark goes through one parser ──────────────────────────────────────────────────────
 * `curveSegments` and the SVG Y-flip decide what a mark actually IS, and a second copy of this
 * function is one edit away from marks cut to different fidelities within the same section.
 */

const FONT_PATH = '/fonts/helvetiker_bold.typeface.json';

/**
 * The size the last-resort square is generated at.
 *
 * Matches `LETTER_SOURCE_SIZE` in `markBody.ts` for the same reason it exists there: everything is
 * normalised to a world `targetSize` downstream, and a large source keeps the outline's detail above
 * the sampling noise floor on the way through.
 */
const PLACEHOLDER_SOURCE_SIZE = 100;

/** What each project needs before any of it can be built. */
interface ResolvedSource {
  project: WorksProject;
  /** SVG outlines, or null when this project is falling back to a letter. */
  svgShapes: THREE.Shape[] | null;
}

export async function prepareMarks(projects: WorksProject[]): Promise<PreparedMark[]> {
  // Every SVG first, in parallel — only `markSvgPath` actually goes to the network, and the panel's
  // uploads are already text by the time they arrive here.
  const sources: ResolvedSource[] = await Promise.all(
    projects.map(async (project) => ({
      project,
      svgShapes: await resolveSvgShapes(project),
    })),
  );

  // ⚠ The typeface is loaded only if something actually needs it, and the check has to happen AFTER
  // the SVGs are parsed rather than from `markSvg == null` alone — a project can have an upload that
  // yields no shapes (a stroke-only file) and fall back to its initial anyway. Skipping the load
  // when every project has a usable mark saves 61 KB inside the loader's own gate.
  const needsFont = sources.some((source) => source.svgShapes === null);
  const font = needsFont ? await loadFontOrNull() : null;

  return sources.map(({ project, svgShapes }) => {
    if (svgShapes) {
      return {
        id: project.index,
        label: project.title,
        shapes: svgShapes,
        // SVG's Y axis points down. The flag travels with the mark rather than being applied here,
        // because the two families of builder want it corrected at different moments — see the note
        // on `flipY` in `markTransition.ts`.
        flipY: true,
      };
    }

    return {
      id: project.index,
      label: project.title,
      // Typeface outlines are authored Y-up already, hence `flipY: false` for both branches below.
      shapes: letterShapes(project.title, font) ?? placeholderShapes(),
      flipY: false,
    };
  });
}

/**
 * This project's SVG outlines, or null if it has none worth cutting.
 *
 * ⚠ An empty result is a real answer, not a failure to report: `svgToShapes` returns nothing for a
 * stroke-only file (see its header), and that is exactly the case the initial exists to cover.
 */
async function resolveSvgShapes(project: WorksProject): Promise<THREE.Shape[] | null> {
  const source = project.markSvg ?? (await fetchOwnAsset(project.markSvgPath));

  if (!source) return null;

  try {
    const shapes = svgToShapes(source);
    return shapes.length > 0 ? shapes : null;
  } catch {
    return null;
  }
}

/** The fallback projects' own files. Same origin, so no CORS and nothing exposed. */
async function fetchOwnAsset(path: string | undefined): Promise<string | null> {
  if (!path) return null;

  try {
    const response = await fetch(path);
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * The project's initial, extruded.
 *
 * ⚠ helvetiker, NOT Syne. `three` ships helvetiker / optimer / gentilis and none of them is the
 * brand face; the Syne binary Next serves is a hashed `.woff2` in the build output, which is not
 * convertible to a typeface JSON without new tooling. So a letter mark reads generic by
 * construction. Drop a Syne `.ttf`/`.otf` into `public/fonts` and this stops being true.
 *
 * Returns null rather than throwing when the glyph is not in the face — a non-Latin title is a
 * perfectly reasonable thing for an editor to publish, and it should cost that project a square
 * rather than the section a crash.
 */
function letterShapes(title: string, font: Font | null): THREE.Shape[] | null {
  if (!font) return null;

  // `Array.from`, not `title[0]` — indexing a string cuts a surrogate pair in half, and the first
  // thing that would break on is an emoji in a project title.
  const initial = Array.from(title.trim())[0];

  if (!initial) return null;

  try {
    const shapes = letterToShapes(initial.toUpperCase(), font);
    return shapes.length > 0 ? shapes : null;
  } catch {
    return null;
  }
}

/**
 * The last resort: a plain square.
 *
 * Only reachable when the typeface failed to load AND a project has no usable SVG — a broken
 * deployment, in other words. It exists because the one thing this function may not do is return
 * fewer marks than there are projects: every consumer indexes the two together, and a hole would put
 * one project's words over another project's body. A square is obviously a placeholder, cuts
 * cleanly, and costs nothing to generate.
 */
function placeholderShapes(): THREE.Shape[] {
  const half = PLACEHOLDER_SOURCE_SIZE / 2;
  const square = new THREE.Shape();

  square.moveTo(-half, -half);
  square.lineTo(half, -half);
  square.lineTo(half, half);
  square.lineTo(-half, half);
  square.closePath();

  return [square];
}

function loadFontOrNull(): Promise<Font | null> {
  return new Promise<Font | null>((resolve) => {
    new FontLoader().load(FONT_PATH, resolve, undefined, () => resolve(null));
  });
}
