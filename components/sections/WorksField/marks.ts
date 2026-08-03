/**
 * The registry of marks a project can show.
 *
 * ── This file used to load them too ──────────────────────────────────────────────────────────────
 * `loadMarks` fetched every mark and handed back a cache of `ExtrudeGeometry`, because the body used
 * to be swapped whole at the peak of a wind-up spin and that swap had to be a synchronous map lookup.
 * The accretion strategy replaced that: it needs the CONTOURS, which it triangulates and cuts itself,
 * so `prepareMarks.ts` resolves shapes instead and this file is left holding only the registry.
 *
 * The loader went with the meteor era and is in git; `prepareMarks` carries the note on why one loader
 * has to own `curveSegments` and the SVG Y-flip.
 */

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

