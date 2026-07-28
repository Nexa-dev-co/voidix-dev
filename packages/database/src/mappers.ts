// The only place the database's vocabulary and the site's vocabulary meet.
//
// Rows are snake_case with `jsonb` columns that are structurally unknown; domain types are camelCase
// and fully typed. Every conversion out of the database runs through zod, because a row is untrusted
// input no matter who wrote it — a hand-edited record in the Supabase dashboard is exactly as capable
// of breaking a scene as a malicious one.
//
// Direction matters:
//   toRow…    domain → database. Used by the seeder and (later) the panel's save.
//   fromRow…  database → domain. Used by the site's read path. Throws on anything malformed, so the
//             caller can fall back to the bundled defaults rather than render a half-empty page.

import {
  deckServiceSchema,
  faqEntrySchema,
  worksProjectSchema,
  type ContentPayload,
  type DeckService,
  type FaqEntry,
  type WorksProject,
} from '@voidix/content';

import type {
  FaqEntryInsert,
  FaqEntryRow,
  Json,
  ProjectInsert,
  ProjectRow,
  ServiceInsert,
  ServiceRow,
} from './rows';

/**
 * Display ordinals ("01") are derived rather than stored.
 *
 * Storing them separately is how you end up with the item at position 0 labelled "03" — two sources
 * of truth for the same fact, drifting the first time someone reorders the list.
 *
 * The input is a zero-based **place in the sorted collection**, NOT the row's `position` value.
 * Positions go non-contiguous as soon as anything is reordered or deleted (a panel that reorders by
 * writing 10, 20, 30 is normal), and numbering off them directly would render "01, 06, 08".
 */
function formatOrdinal(placeInCollection: number): string {
  return String(placeInCollection + 1).padStart(2, '0');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Domain → database
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export function toServiceRow(service: DeckService, position: number): ServiceInsert {
  return {
    position,
    name: service.name,
    eyebrow: service.eyebrow,
    description: service.description,
    capabilities: service.capabilities,
    model_path: service.modelPath,
    profile: service.profile as unknown as Json,
    light: (service.light ?? null) as unknown as Json | null,
    model_rotation: (service.modelRotation ?? null) as unknown as Json | null,
  };
}

export function toProjectRow(project: WorksProject, position: number): ProjectInsert {
  return {
    position,
    title: project.title,
    client: project.client,
    year: project.year,
    description: project.description,
    tags: project.tags,
    rock: (project.rock ?? null) as unknown as Json | null,
  };
}

export function toFaqEntryRow(entry: FaqEntry, position: number): FaqEntryInsert {
  return {
    position,
    question: entry.question,
    answer: entry.answer,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Database → domain
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export function fromServiceRow(row: ServiceRow, placeInCollection: number): DeckService {
  return deckServiceSchema.parse({
    index: formatOrdinal(placeInCollection),
    name: row.name,
    eyebrow: row.eyebrow,
    description: row.description,
    capabilities: row.capabilities,
    modelPath: row.model_path,
    profile: row.profile,
    // A null jsonb column means "omitted", which is not the same as `light: null` — the domain type
    // uses absence to mean "keep the rig's default warm key".
    ...(row.light === null ? {} : { light: row.light }),
    ...(row.model_rotation === null ? {} : { modelRotation: row.model_rotation }),
  });
}

export function fromProjectRow(row: ProjectRow, placeInCollection: number): WorksProject {
  return worksProjectSchema.parse({
    index: formatOrdinal(placeInCollection),
    title: row.title,
    client: row.client,
    year: row.year,
    description: row.description,
    tags: row.tags,
    ...(row.rock === null ? {} : { rock: row.rock }),
  });
}

export function fromFaqEntryRow(row: FaqEntryRow, placeInCollection: number): FaqEntry {
  return faqEntrySchema.parse({
    index: formatOrdinal(placeInCollection),
    question: row.question,
    answer: row.answer,
  });
}

/**
 * Assemble the three working-draft collections into the payload the site is hydrated with.
 *
 * Rows are sorted here rather than relying on the query's ORDER BY, so a caller that forgets it still
 * gets a correctly ordered fleet — and so the derived ordinals match the order they're rendered in.
 */
export function toContentPayload(collections: {
  services: ServiceRow[];
  projects: ProjectRow[];
  faqEntries: FaqEntryRow[];
}): ContentPayload {
  const byPosition = <T extends { position: number }>(rows: T[]): T[] =>
    [...rows].sort((first, second) => first.position - second.position);

  // The place passed to each mapper is the index in the SORTED array, which is what the rendered
  // ordinal has to count. Written out rather than leaning on `map` handing the callback its index,
  // so adding a parameter to one of these mappers later can't silently renumber the site.
  return {
    services: byPosition(collections.services).map((row, place) => fromServiceRow(row, place)),
    projects: byPosition(collections.projects).map((row, place) => fromProjectRow(row, place)),
    faqEntries: byPosition(collections.faqEntries).map((row, place) => fromFaqEntryRow(row, place)),
  };
}
