// The projects shown in the Works "field". Each project is one meteor drifting in space; the
// focused project's meteor is the one on fire (see fireMeteorShaders.ts). This is the single
// source of truth for the project copy AND each meteor's warm accent tint.
//
// Placeholders for now — swap `title` / `client` / `year` / `description` / `tags` for the real
// work later; the scene and the panel both read straight from here, so no other file changes.

export interface WorksProject {
  /** Two-digit ordinal shown by the nav counter, e.g. "01". */
  index: string;
  /** Codename / display title of the project. */
  title: string;
  /** Who it was built for (or the context). */
  client: string;
  /** Year shipped. */
  year: string;
  /** One paragraph surfaced in the detail panel when this project is focused. */
  description: string;
  /** Capability / tech chips under the description. */
  tags: string[];
  /**
   * Warm accent the fire meteor's mid-tone is tinted toward, so each project's flame reads a
   * little differently (amber / ember / gold …). Omit to keep the default molten amber.
   */
  accent?: string;
}

export const WORKS_PROJECTS: WorksProject[] = [
  {
    index: '01',
    title: 'Aphelion',
    client: 'Private markets desk',
    year: '2026',
    description:
      'A trading surface that stays calm at speed. Millions of ticks a second resolve into one legible field of motion, so a desk can feel the market shift before it reads the number.',
    tags: ['Realtime', 'WebGL', 'Streaming Data', 'Design System'],
    accent: '#ff7a2a',
  },
  {
    index: '02',
    title: 'Meridian',
    client: 'Care network',
    year: '2025',
    description:
      'One record that follows the patient, not the department. We collapsed nine disconnected tools into a single orbit clinicians actually want to open — offline-first, in the palm.',
    tags: ['iOS / Android', 'Offline-first', 'FHIR', 'Motion'],
    accent: '#ffb24d',
  },
  {
    index: '03',
    title: 'Cinder',
    client: 'Fashion house',
    year: '2025',
    description:
      'A store that behaves like a film. Product arrives through cinematic scene changes instead of pages, and conversion climbed because browsing finally felt worth lingering in.',
    tags: ['Commerce', 'GSAP', 'Headless', '3D Product'],
    accent: '#ff5a36',
  },
  {
    index: '04',
    title: 'Halcyon',
    client: 'Analytics platform',
    year: '2026',
    description:
      'Intelligence wired into the product, not bolted on as a demo. Retrieval and agents run against live data, so the answer is useful on day one and sharper every week after.',
    tags: ['LLM Pipelines', 'RAG', 'Agents', 'Evaluation'],
    accent: '#ffd27a',
  },
];
