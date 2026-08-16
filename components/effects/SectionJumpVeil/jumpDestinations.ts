import type { SiteSections } from '@/lib/cms/siteContent';
import { WORKS_FIELD_PHRASE, worksCountPhrase } from '@/components/sections/WorksField/worksProjects';

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
 * really does say what it says. So the card previews the section rather than describing it, and
 * arriving confirms what you were just shown. The chamber is the one exception — it has no headline
 * of its own, so it has been given one.
 *
 * ── ⚠ THIS WAS A MODULE CONSTANT AND IT WAS QUIETLY WRONG (fixed 2026-08-14) ─────────────────────
 * It read its counts off `WORKS_PROJECTS` and `FAQ_ENTRIES` — this repo's FALLBACK arrays — and its
 * works headline was the literal string "Four fires. One field.". Every one of those is now decided
 * by the admin panel. A site publishing five projects and nine answers showed a card promising four
 * marks and four frequencies, in a headline that contradicted the page it was about to land on, and
 * nothing anywhere reported it: the numbers looked plausible because they used to be true.
 *
 * So it takes the resolved sections instead. The counts are still derived and never typed — they are
 * just derived from what the visitor is actually about to see.
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

export function buildJumpDestinations(
  sections: SiteSections,
): Record<string, JumpDestination> {
  return {
    services: {
      headline: 'One craft at a time.',
      rows: [
        { label: 'Fleet', value: `${padded(sections.services.length)} craft` },
        { label: 'Status', value: 'Online' },
      ],
    },
    work: {
      // The same two phrases the section's own `<h2>` renders, from the same source.
      headline: `${worksCountPhrase(sections.projects.length)} ${WORKS_FIELD_PHRASE}`,
      rows: [
        { label: 'Field', value: `${padded(sections.projects.length)} marks` },
        { label: 'Transit', value: 'Accretion' },
      ],
    },
    faq: {
      headline: 'The room answers.',
      rows: [
        { label: 'Chamber', value: `${padded(sections.faq.length)} frequencies` },
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
}
