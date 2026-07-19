// The projects shown in the Works "field". There is ONE rock, and a project is a pose to look at it
// from — so this file is the single source of truth for the project copy AND for the rock the camera
// finds when it arrives. Changing project is a re-carve, hidden inside the spin-up (see
// worksTransition.ts).
//
// Placeholders for now — swap `title` / `client` / `year` / `description` / `tags` for the real
// work later; the scene and the panel both read straight from here, so no other file changes.

/**
 * How the rock looks for one project. `seed` and `sizeScale` are baked into geometry, so changing
 * them means re-carving the body (`buildMeteor`); `color` and `textureRepeat` are pushed onto the
 * material every frame, so they take effect immediately.
 *
 * These four deliberately OVERRIDE their equivalents in worksTuning — the tuner's global
 * `meteorSeed` / `meteorColor` / `meteorTextureRepeat` are the fallback for a project that omits a
 * profile, not a live knob once one is set. Everything else about the rock (emissive, roughness,
 * metalness, stretch, detail, idle spin) stays global and stays tunable.
 */
export interface ProjectRock {
  /** Which silhouette gets carved. Any integer; the same seed is always the same rock. */
  seed: number;
  /** Multiplies the global `meteorRadius`. Keep inside ±10% or the swap stops reading as the same body. */
  sizeScale: number;
  /** Tint over the basalt albedo. */
  color: string;
  /** How many times the surface texture wraps the body — the apparent grain of the rock. */
  textureRepeat: number;
}

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
  /** The rock the camera finds at this project's stop. Omit to keep the global tuning values. */
  rock?: ProjectRock;
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
    // The look authored in ?tune — project 01 is the baseline every other rock varies from.
    rock: { seed: 149, sizeScale: 1.0, color: '#b69090', textureRepeat: 4.5 },
  },
  {
    index: '02',
    title: 'Meridian',
    client: 'Care network',
    year: '2025',
    description:
      'One record that follows the patient, not the department. We collapsed nine disconnected tools into a single orbit clinicians actually want to open — offline-first, in the palm.',
    tags: ['iOS / Android', 'Offline-first', 'FHIR', 'Motion'],
    rock: { seed: 512, sizeScale: 1.06, color: '#9aa6b4', textureRepeat: 3.2 },
  },
  {
    index: '03',
    title: 'Cinder',
    client: 'Fashion house',
    year: '2025',
    description:
      'A store that behaves like a film. Product arrives through cinematic scene changes instead of pages, and conversion climbed because browsing finally felt worth lingering in.',
    tags: ['Commerce', 'GSAP', 'Headless', '3D Product'],
    rock: { seed: 883, sizeScale: 0.93, color: '#c69a86', textureRepeat: 5.6 },
  },
  {
    index: '04',
    title: 'Halcyon',
    client: 'Analytics platform',
    year: '2026',
    description:
      'Intelligence wired into the product, not bolted on as a demo. Retrieval and agents run against live data, so the answer is useful on day one and sharper every week after.',
    tags: ['LLM Pipelines', 'RAG', 'Agents', 'Evaluation'],
    rock: { seed: 271, sizeScale: 1.09, color: '#a8a0b8', textureRepeat: 2.8 },
  },
];
