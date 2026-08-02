import { DECK_SERVICES } from '@/components/sections/ServicesDeck/deckServices';
import { WORKS_PROJECTS } from '@/components/sections/WorksField/worksProjects';
import { FAQ_ENTRIES } from '@/components/sections/Chamber/faqEntries';

/**
 * What the transit card says while a covered jump is travelling.
 *
 * ── Why there is anything here at all ────────────────────────────────────────────────────────────
 * The hold is a couple of seconds of black with a word on it. That is long enough to be a pause and
 * short enough that a spinner would be insulting, so it gets told something instead: where it is
 * going, in that place's own words, plus two readouts about what is there.
 *
 * ── The headline is the destination's REAL copy ──
 * Not a caption written for the card. Services really does open with "One craft at a time"; works
 * really is "Four fires. One field." So the card previews the section rather than describing it, and
 * arriving confirms what you were just shown. The chamber is the one exception — it has no headline of
 * its own, so it has been given one.
 *
 * ── The counts are DERIVED, never typed ──
 * `{n} MARKS` reads off `WORKS_PROJECTS`, so adding a fifth project cannot leave the card claiming
 * four. Nothing here costs a byte of bundle: all three registries are already on the homepage.
 */

/** Two digits, matching the navbar's `01 … 04` and the sections' own index counters. */
const padded = (count: number) => String(count).padStart(2, '0');

export interface JumpDestinationRow {
  label: string;
  value: string;
}

export interface JumpDestination {
  headline: string;
  rows: readonly JumpDestinationRow[];
}

export const JUMP_DESTINATIONS: Record<string, JumpDestination> = {
  services: {
    headline: 'One craft at a time.',
    rows: [
      { label: 'Fleet', value: `${padded(DECK_SERVICES.length)} craft` },
      { label: 'Status', value: 'Online' },
    ],
  },
  work: {
    headline: 'Four fires. One field.',
    rows: [
      { label: 'Field', value: `${padded(WORKS_PROJECTS.length)} marks` },
      { label: 'Transit', value: 'Accretion' },
    ],
  },
  process: {
    headline: 'The room answers.',
    rows: [
      { label: 'Chamber', value: `${padded(FAQ_ENTRIES.length)} frequencies` },
      { label: 'Signal', value: 'Hologram' },
    ],
  },
  contact: {
    headline: 'Tell us what you are building.',
    rows: [
      { label: 'Horizon', value: 'Singularity' },
      { label: 'Channel', value: 'Open' },
    ],
  },
};
