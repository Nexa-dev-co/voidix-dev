// The projects shown in the Works "field". A project is a MARK plus a pose to look at it from.
// Changing project grows one mark out of the other (see worksTransition.ts and
// transitions/accretionTransition.ts).
//
// ── ⚠ THE WHOLE PROJECT IS A FALLBACK NOW — INCLUDING THE MARK ───────────────────────────────────
// Everything here comes from the admin panel through `resolveWorksProjects`: the copy, and since
// 2026-08-14 the mark as well, uploaded per project and dereferenced on the server by
// `lib/cms/markSource.ts`. This array is what an UNCONFIGURED site serves — a fresh clone, a laptop
// with no panel, a panel that is down — and nothing more.
//
// ⚠ THE COUNT IS NO LONGER PINNED, and that is the point of the change. The panel decides how many
// projects exist; the camera path is generated to fit (`worksTuning.ts`), the pin's stop count
// follows (`Hero.tsx`), and a project with no uploaded mark grows its own INITIAL rather than
// borrowing someone else's logo. There is nothing structural left for a fifth project to collide
// with.
//
// ⚠ The marks below are still placeholders, and visibly so: three stock SVG logos paired with these
// projects arbitrarily, plus one project that has none and therefore grows an "H". A letter mark is
// extruded in helvetiker rather than Syne — `markBody.ts` documents why that cannot be fixed
// without new tooling.

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
   * The project's mark, as SVG source.
   *
   * Arrives already dereferenced — `lib/cms/markSource.ts` fetched it on the server, so by the time
   * anything in the scene reads this it is text, not a promise and not a URL. Null means the panel
   * has no mark for this project (or the fetch was refused), and the field grows the INITIAL of
   * `title` instead.
   */
  markSvg?: string | null;
  /**
   * A same-origin asset to use when `markSvg` is null — `/logos/…`, from this repo's `public/`.
   *
   * ⚠ Only the fallback projects below set this, and it is the one place a mark is still fetched in
   * the browser. That is deliberate: these three files ship with the repo rather than living in the
   * panel's bucket, so there is no URL for the server to dereference and nothing to expose — it is
   * our own origin. Without it, a fresh clone would render four letters where it used to render
   * three logos, which is a worse first impression than the fetch is a cost.
   */
  markSvgPath?: string;
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
    markSvgPath: '/logos/rss-symbol-variant-for-facebook-in-a-square-svgrepo-com.svg',
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
    markSvgPath: '/logos/compass-svgrepo-com.svg',
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
    markSvgPath: '/logos/shield-checkered-tool-svgrepo-com.svg',
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
    // No mark, on purpose: this is what the initial fallback looks like in the fallback data.
  },
];

/**
 * The section's headline, in two parts, derived from how many projects there actually are.
 *
 * ⚠ It read "Four fires. One field." as literal markup until 2026-08-14, in TWO places — the
 * section's own `<h2>` and the transit card a long navbar jump travels behind. The panel can publish
 * any number of projects now, so both were one edit away from contradicting the section under them,
 * and nothing on either side would have said so. They read this instead.
 *
 * The number is spelled rather than rendered as a digit because it is display type in a two-sentence
 * headline: "5 fires." beside "One field." reads as a data point rather than a claim. Past the list
 * it falls back to the numeral, which is the honest answer for a count nobody composed this line for.
 */
const SPELLED_COUNTS = [
  'No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
];

export function worksCountPhrase(projectCount: number): string {
  const spelled = SPELLED_COUNTS[projectCount] ?? String(projectCount);
  return `${spelled} ${projectCount === 1 ? 'fire' : 'fires'}.`;
}

/** The second sentence. Fixed — one field however many fires are burning in it. */
export const WORKS_FIELD_PHRASE = 'One field.';

/**
 * What a project falls back to when the panel names a discipline this build has never heard of.
 *
 * ⚠ It used to take the discipline of whichever repo project sat at the same index, which only
 * worked while the two arrays were the same length by decree. There is no counterpart project any
 * more, so this has to be a real default — and it must be a valid `DisciplineId`, because
 * `buildEnquiryPrefill` indexes `DISCIPLINES` with it and would otherwise throw inside the CTA.
 * `web` because it is the broadest of the four, so a mislabelled project still opens a sensible
 * enquiry rather than a specialist one.
 */
const FALLBACK_DISCIPLINE: DisciplineId = 'web';

/**
 * How many projects the camera path can compose distinctly before shots start repeating.
 *
 * Advisory. Nothing clamps to it — silently dropping a project an editor published would be far
 * worse than a section that gets repetitive — but the number is worth saying out loud once, because
 * the geometry that produces it is not obvious from anywhere near this file. See
 * `buildProjectViewKeys` in `worksTuning.ts`: every stop has to stay inside a cone about 35° wide
 * either side of face-on or the mark is seen edge-on and reads as a bar, which leaves roughly
 * 70/(N−1) degrees between neighbours.
 */
const COMFORTABLE_PROJECT_COUNT = 6;

/**
 * The panel's projects, each carrying the mark that was fetched for it.
 *
 * ── ⚠ THE PUBLISHED ARRAY IS THE SPINE NOW ──────────────────────────────────────────────────────
 * This used to map over `WORKS_PROJECTS` and lay the panel's words on top, refusing the whole
 * payload when the counts disagreed — because a fifth project had no mark to grow into and no pose
 * to be seen from. Both of those are now derived from the project itself, so there is nothing left
 * for the repo array to contribute and it has become what it always claimed to be: the copy an
 * unconfigured site serves.
 *
 * ⚠ `markSources` is POSITIONAL and must be the list `resolveMarkSources` returned for exactly this
 * `published` array. It is a separate argument rather than a field on the payload because
 * dereferencing a URL is a server-side fetch and this function is pure — see `lib/cms/markSource.ts`
 * for why that fetch cannot happen in the browser.
 */
export function resolveWorksProjects(
  published: PublishedProject[] | null,
  markSources: (string | null)[] = [],
): WorksProject[] {
  if (!published || published.length === 0) {
    return WORKS_PROJECTS;
  }

  if (published.length > COMFORTABLE_PROJECT_COUNT) {
    console.warn(
      `[cms] ${published.length} projects published — past ${COMFORTABLE_PROJECT_COUNT} the ` +
        'camera path runs out of distinct compositions and later shots start to look alike',
    );
  }

  return published.map((publishedProject, position) => ({
    index: publishedProject.index,
    title: publishedProject.title,
    client: publishedProject.client,
    year: publishedProject.year,
    description: publishedProject.description,
    tags: publishedProject.tags,
    // ⚠ An unknown discipline would reach `DISCIPLINES[...]` in `buildEnquiryPrefill` and throw,
    // and it is also the section's visible type key.
    discipline: isDisciplineId(publishedProject.discipline)
      ? publishedProject.discipline
      : FALLBACK_DISCIPLINE,
    // `?? null` rather than leaving it undefined: a shorter `markSources` than `published` is a
    // caller bug, and every project reading "no mark, grow the initial" is the safe way to be wrong.
    markSvg: markSources[position] ?? null,
  }));
}
