/**
 * The four candidate mark→mark transitions, plus the control — as data, with no three.js anywhere.
 *
 * ── Why this is separate from the registry ───────────────────────────────────────────────────────
 * The route pages are Server Components (they export `metadata`), and the factories they'd otherwise
 * reach for import three.js. Splitting the *catalogue* from the *implementations* means a server page
 * can enumerate, validate and title every candidate without pulling a WebGL library onto the server,
 * and only the client harness ever imports `registry.ts`.
 *
 * ── Why unbuilt candidates are listed anyway ────────────────────────────────────────────────────
 * `isBuilt: false` shows them in the nav, disabled. The comparison's *shape* is then visible from the
 * first day rather than appearing one tab at a time — and the deciding question is on screen next to
 * each one, so it stays obvious that these are four answers to a single question instead of four
 * unrelated effects. See `docs/mark-transition-comparison.md`.
 */

export type MarkTransitionId = 'accretion' | 'one-skin' | 'shards' | 'field';

export interface MarkTransitionEntry {
  id: MarkTransitionId;
  label: string;
  /** What carries the mark's identity across the change. The whole taxonomy in one line. */
  identity: string;
  /**
   * The single observation that kills this approach or clears it.
   *
   * Written down per candidate because the rig exists to answer four specific questions, not to be
   * admired — and because a question you can read off the screen is much harder to forget to ask.
   */
  decidingQuestion: string;
  isBuilt: boolean;
}

export const MARK_TRANSITIONS: MarkTransitionEntry[] = [
  {
    id: 'accretion',
    label: 'Accretion',
    identity: 'A seed — a persistent base rock that grows the mark out of itself, piece by piece.',
    decidingQuestion:
      'Does the growth read as rock being ADDED — material travelling out of the core and locking into place — and does the geode arrive as the finish, only once the stone is whole?',
    isBuilt: true,
  },
  {
    id: 'one-skin',
    label: 'One skin',
    identity: 'Connectivity — one mesh forever; every mark is a set of target positions on it.',
    decidingQuestion:
      'Can one fixed canonical density hold a fine logo detail crisply — the shield’s checkers, the compass ring’s stroke?',
    isBuilt: false,
  },
  {
    id: 'shards',
    label: 'Shards',
    identity: 'Pieces — N cells that tile the mark exactly; cell i becomes cell i.',
    decidingQuestion:
      'Do the seams show at rest, and does the cell matching read as rearrangement rather than as noise?',
    isBuilt: false,
  },
  {
    id: 'field',
    label: 'Field',
    identity: 'A function — a signed distance field per mark, raymarched.',
    decidingQuestion:
      'Does the frame cost fit alongside the chamber’s render-to-texture and the bloom pass, on the low tier?',
    isBuilt: false,
  },
];

export function markTransitionById(id: string): MarkTransitionEntry | undefined {
  return MARK_TRANSITIONS.find((entry) => entry.id === id);
}
