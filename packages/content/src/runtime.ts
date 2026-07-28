// The live content the site actually reads.
//
// ── Why these are mutable arrays and not a fetch ──────────────────────────────────────────────────
// Content here is consumed SYNCHRONOUSLY at module-evaluation time. `deckTuning.ts` builds one
// placement entry per vessel with `DECK_SERVICES.map(restingShip)` the moment it loads, and the
// Three.js scenes read the arrays outside of React entirely. Turning any of that into `await` would
// mean rewriting the scene bootstrap, so we don't: the exported arrays are the same identity for the
// life of the page, and remote content is poured INTO them.
//
// That is the same contract `lib/tunerReset.ts` already relies on for tuning — "every scene holds its
// tuning BY REFERENCE — that reference is the whole mechanism". Replacing an array would leave every
// existing holder pointing at the old one, so `hydrateContent` empties and refills instead of
// swapping.
//
// ── Where hydration happens ──────────────────────────────────────────────────────────────────────
// Today: nowhere. The arrays start as the bundled defaults and stay there, so the site behaves
// exactly as it did when this data lived in components/sections/**. Once the admin panel is writing
// to Postgres, a server component fetches the published rows, validates them (validation.ts), and
// calls `hydrateContent` before the scenes boot. Nothing downstream changes.
//
// Validation deliberately is NOT done here: it belongs at the trust boundary where untrusted input
// arrives, and keeping zod out of this module keeps it out of the public site bundle.

import { DEFAULT_DECK_SERVICES } from './defaults/deckServices';
import { DEFAULT_FAQ_ENTRIES } from './defaults/faqEntries';
import { DEFAULT_WORKS_PROJECTS } from './defaults/worksProjects';
import type { ContentPayload, DeckService, FaqEntry, WorksProject } from './types';

/**
 * Empty and refill `target` so its identity survives — see the note above about who is holding these
 * arrays. Entries are cloned so a caller can't keep a live handle into the site's content.
 */
function replaceListInPlace<T>(target: T[], next: readonly T[]): void {
  target.length = 0;
  next.forEach((entry) => target.push(structuredClone(entry) as T));
}

/** The four vessels on the services deck. */
export const DECK_SERVICES: DeckService[] = structuredClone(DEFAULT_DECK_SERVICES);

/** The projects the works field flies between. */
export const WORKS_PROJECTS: WorksProject[] = structuredClone(DEFAULT_WORKS_PROJECTS);

/** The questions the chamber hologram answers. */
export const FAQ_ENTRIES: FaqEntry[] = structuredClone(DEFAULT_FAQ_ENTRIES);

/**
 * Pour published content into the live arrays, keeping their identity intact.
 *
 * Collections omitted from `payload` are left alone, so a partial publish (FAQ copy only, say)
 * doesn't blank the fleet. Pass already-validated content — see `parseContentPayload`.
 */
export function hydrateContent(payload: ContentPayload): void {
  if (payload.services) replaceListInPlace(DECK_SERVICES, payload.services);
  if (payload.projects) replaceListInPlace(WORKS_PROJECTS, payload.projects);
  if (payload.faqEntries) replaceListInPlace(FAQ_ENTRIES, payload.faqEntries);
}
