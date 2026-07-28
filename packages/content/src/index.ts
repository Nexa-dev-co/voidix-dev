// The one definition of Voidix's editable content, shared by the site and (soon) the admin panel.
//
//   types.ts       — the contract: what a service / project / FAQ entry is
//   validation.ts  — the same shapes as zod schemas, for untrusted input at the API boundary
//   runtime.ts     — the live arrays the site reads, plus `hydrateContent` to pour rows into them
//   defaults/      — the content as authored in code, and the fallback when nothing is published

export type {
  ContentPayload,
  DeckService,
  FaqEntry,
  GradedProfile,
  LegacyProfile,
  ModelRotation,
  ProjectRock,
  ShipLight,
  ShipProfile,
  WorksProject,
} from './types';

export { DECK_SERVICES, WORKS_PROJECTS, FAQ_ENTRIES, hydrateContent } from './runtime';

export { MAX_WORKS_PROJECTS } from './limits';

export { DEFAULT_DECK_SERVICES } from './defaults/deckServices';
export { DEFAULT_FAQ_ENTRIES } from './defaults/faqEntries';
export { DEFAULT_WORKS_PROJECTS } from './defaults/worksProjects';

export {
  contentPayloadSchema,
  deckServiceSchema,
  faqEntrySchema,
  gradedProfileSchema,
  legacyProfileSchema,
  modelRotationSchema,
  parseContentPayload,
  projectRockSchema,
  shipLightSchema,
  shipProfileSchema,
  worksProjectSchema,
} from './validation';
