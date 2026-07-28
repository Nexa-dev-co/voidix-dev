// The projects shown in the Works "field". There is ONE rock, and a project is a pose to look at it
// from — so this file is the single source of truth for the project copy AND for the rock the camera
// finds when it arrives. Changing project is a re-carve, hidden inside the spin-up (see
// worksTransition.ts).
//
// Placeholders for now — swap `title` / `client` / `year` / `description` / `tags` for the real
// work later. This is the seed for the database and the fallback when nothing is published.
//
// The shapes these entries satisfy live in ../types.

import type { WorksProject } from '../types';

export const DEFAULT_WORKS_PROJECTS: WorksProject[] = [
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
