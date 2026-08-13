// The projects shown in the Works "field". A project is a MARK plus a pose to look at it from — so
// this file owns which mark the camera finds when it arrives. Changing project grows one mark out of
// the other (see worksTransition.ts and transitions/accretionTransition.ts).
//
// ── ⚠ THE COPY IS A FALLBACK NOW; THE MARK IS NOT ─────────────────────────────────────────────────
// `index`, `title`, `client`, `year`, `description`, `tags` and `discipline` come from the admin panel
// through `resolveWorksProjects`. `markId` stays here — it names a body in `marks.ts`, which is
// geometry, not copy.
//
// ⚠ The marks are placeholders too, and more visibly so: they are three stock SVG logos and the
// company initial (see `marks.ts`), paired with these projects arbitrarily. Until real project marks
// exist the section reads as a logo test, and the "V" is extruded helvetiker rather than Syne —
// `marks.ts` documents why that cannot be fixed without new tooling. ⚠ A project the panel adds
// beyond this file's count therefore has no mark to show, which is the whole of why the count is
// pinned — see `resolveWorksProjects`.

import { isDisciplineId, type DisciplineId } from '@/lib/enquirySubjects';
import type { PublishedProject } from '@/lib/cms/publishedContent';

export interface WorksProject {
  /** Two-digit ordinal shown by the nav counter, e.g. "01". */
  index: string;
  /** Codename / display title of the project. */
  title: string;
  /**
   * What KIND of work this was — the highlighted key above the title, and what the section's CTA opens
   * an enquiry about.
   *
   * The same vocabulary the fleet sells (`deckServices.ts` → `discipline`), which is the whole point:
   * a project is one of the four services, already delivered. See lib/enquirySubjects.ts.
   */
  discipline: DisciplineId;
  /** Who it was built for (or the context). */
  client: string;
  /** Year shipped. */
  year: string;
  /** One paragraph surfaced in the detail panel when this project is focused. */
  description: string;
  /** Capability / tech chips under the description. */
  tags: string[];
  /**
   * Which mark this project's body shows — an id from `MARKS` in `marks.ts`.
   *
   * Matched by ID rather than by position because `prepareMarks` DROPS a mark whose file fails to
   * load, which would silently shift every later project onto its neighbour's logo. An id that
   * resolves to nothing falls back to the first available mark instead.
   */
  markId: string;
}

export const WORKS_PROJECTS: WorksProject[] = [
  {
    index: '01',
    title: 'Aphelion',
    discipline: 'enterprise',
    client: 'Private markets desk',
    year: '2026',
    description:
      'A trading surface that stays calm at speed. Millions of ticks a second resolve into one legible field of motion, so a desk can feel the market shift before it reads the number.',
    tags: ['Realtime', 'WebGL', 'Streaming Data', 'Design System'],
    markId: 'signal',
  },
  {
    index: '02',
    title: 'Meridian',
    discipline: 'mobile',
    client: 'Care network',
    year: '2025',
    description:
      'One record that follows the patient, not the department. We collapsed nine disconnected tools into a single orbit clinicians actually want to open — offline-first, in the palm.',
    tags: ['iOS / Android', 'Offline-first', 'FHIR', 'Motion'],
    markId: 'compass',
  },
  {
    index: '03',
    title: 'Cinder',
    discipline: 'web',
    client: 'Fashion house',
    year: '2025',
    description:
      'A store that behaves like a film. Product arrives through cinematic scene changes instead of pages, and conversion climbed because browsing finally felt worth lingering in.',
    tags: ['Commerce', 'GSAP', 'Headless', '3D Product'],
    markId: 'shield',
  },
  {
    index: '04',
    title: 'Halcyon',
    discipline: 'ai',
    client: 'Analytics platform',
    year: '2026',
    description:
      'Intelligence wired into the product, not bolted on as a demo. Retrieval and agents run against live data, so the answer is useful on day one and sharper every week after.',
    tags: ['LLM Pipelines', 'RAG', 'Agents', 'Evaluation'],
    markId: 'initial',
  },
];

/**
 * The panel's project copy laid over this repo's marks.
 *
 * ── ⚠ THE JOIN IS ARRAY POSITION, for a milder reason than the fleet's ──────────────────────────
 * `deckTuning.ts` encodes vessel placement positionally, so the fleet's merge CANNOT be anything but
 * positional. Here the coupling is softer — `markId` is matched by ID precisely so that
 * `prepareMarks` dropping a failed mark doesn't shift every later project onto its neighbour's logo —
 * but the panel publishes no `markId`, so position is still the only join between the two sides.
 *
 * ── ⚠ AND THE COUNT IS STILL PINNED ─────────────────────────────────────────────────────────────
 * A fifth project would arrive with no mark to grow into. The section is four bodies on one camera
 * path (`worksTuning.ts`), and `WorksField.tsx`'s heading says "Four fires." in so many words — the
 * panel warns an editor when the count stops being four, and this is the other half of that promise.
 */
export function resolveWorksProjects(published: PublishedProject[] | null): WorksProject[] {
  if (!published || published.length === 0) {
    return WORKS_PROJECTS;
  }

  if (published.length !== WORKS_PROJECTS.length) {
    console.warn(
      `[cms] the panel published ${published.length} projects and this build has ` +
        `${WORKS_PROJECTS.length} marks — serving the site's own copy instead`,
    );
    return WORKS_PROJECTS;
  }

  return WORKS_PROJECTS.map((project, position) => {
    const publishedProject = published[position];

    return {
      ...project,
      index: publishedProject.index,
      title: publishedProject.title,
      client: publishedProject.client,
      year: publishedProject.year,
      description: publishedProject.description,
      tags: publishedProject.tags,
      // ⚠ Same guard as the fleet's: an unknown discipline would reach `DISCIPLINES[...]` in
      // `buildEnquiryPrefill` and throw, and it is also the section's visible type key.
      discipline: isDisciplineId(publishedProject.discipline)
        ? publishedProject.discipline
        : project.discipline,
    };
  });
}
