// The database layer: row shapes, the mappers that translate them to and from the domain types in
// @voidix/content, and the server-only admin client.
//
//   rows.ts      — snake_case table shapes, mirroring supabase/migrations
//   mappers.ts   — the only place database and domain vocabulary meet; validates on the way out
//   client.ts    — service-role client, server-side only
//   scripts/     — the seeder
//
// The site should import the mappers, never the raw row types. Reaching for a ServiceRow in a
// component means the snake_case vocabulary has leaked out of this package.

export type {
  ContentPublicationRow,
  FaqEntryInsert,
  FaqEntryRow,
  Json,
  LeadRow,
  LeadStatus,
  ProjectInsert,
  ProjectRow,
  SceneTuningPublishedRow,
  SceneTuningRow,
  ServiceInsert,
  ServiceRow,
} from './rows';

export {
  fromFaqEntryRow,
  fromProjectRow,
  fromServiceRow,
  toContentPayload,
  toFaqEntryRow,
  toProjectRow,
  toServiceRow,
} from './mappers';

export { createAdminClient } from './client';
