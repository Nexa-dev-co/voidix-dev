// The services fleet moved to @voidix/content, so the admin panel and the site share one definition
// of what a service is instead of each keeping their own copy.
//
// This file stays as the path the deck imports from — the scenes, the tuner panel, and deckTuning
// all still reach for `./deckServices`, and nothing about how they consume it changed. `DECK_SERVICES`
// is the same array identity for the life of the page (see the package's runtime.ts for why that
// matters to deckTuning, which sizes itself from it at module load).

export { DECK_SERVICES } from '@voidix/content';

export type {
  DeckService,
  GradedProfile,
  LegacyProfile,
  ModelRotation,
  ShipLight,
  ShipProfile,
} from '@voidix/content';
