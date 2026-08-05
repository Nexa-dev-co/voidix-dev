/**
 * A navbar jump long enough to be worth hiding.
 *
 * ── Why hide it at all ───────────────────────────────────────────────────────────────────────────
 * The pin is scrubbed, so driving it to a distant stop PLAYS everything in between. Clicking Contact
 * from the hero renders the fill, the fleet reveal, four craft, the services→works flight, four
 * marks, the chamber reveal, the tour and the return dive — roughly 1100vh of authored cinema — in
 * 3.2 seconds. Every one of those is a shot meant to be watched; run together at that rate they are
 * a blur, and the visitor arrives having been shown everything and seen nothing.
 *
 * ── Why the journey still HAPPENS ────────────────────────────────────────────────────────────────
 * The obvious fix is a teleport: throw the scrollbar at the destination and force every eased value
 * to its target, the way the loop does. It was designed and rejected, because it skips things the
 * site needs:
 *
 *   · `LOOP_RESET_EVENT` claims every owner of an eased value forces `current = target`. It does
 *     not — each listener hard-codes 0, which only works because the loop lands at the TOP. Making
 *     it general touches four scenes and fails intermittently when one is missed.
 *   · The chamber room and the contact star are built LAZILY, off handoff/chamber progress. A
 *     teleport never crosses those spans, so a jump from the hero to the FAQ would arrive in a room
 *     that was never created.
 *   · `currentStop`, `wasInFill`, `lastCommittedIndex` and `lastCrossingProgress` would all have to
 *     be re-derived for the destination.
 *
 * So the glide is exactly the one that runs today. It is simply not watched. Every guarantee the
 * scroll spine already gives holds unchanged, because nothing is skipped — including the lazy
 * fetches, which happen on the way past as they always have.
 *
 * See docs/nav-jump-plan.md.
 */

/** The jump is on. The cover should start closing; the pin has NOT moved yet. */
export const JUMP_BEGIN_EVENT = 'voidix:jump-begin';

export interface JumpBeginDetail {
  /** The destination's section key, so the cover can name where it is taking you. */
  key: string;
  /**
   * Viewport point the cover should collapse into — the centre of the control that was clicked.
   *
   * Optional: a programmatic `requestSection` has no control to measure, and on a narrow viewport the
   * item may not be on screen at all. The cover falls back to the middle of the frame.
   */
  origin?: { x: number; y: number };
}

export function readJumpBegin(event: Event): JumpBeginDetail | null {
  const detail = (event as CustomEvent<JumpBeginDetail>).detail;
  return typeof detail?.key === 'string' ? detail : null;
}

/**
 * The cover has the screen — the pin may move now.
 *
 * ⚠ Fired by the COVER, never timed by the pin. Only the thing doing the covering knows when it has
 * actually finished covering, and a constant here that had to be kept in step with the collapse's
 * duration over there is the timing coupling this codebase keeps having to undo. Same contract as
 * `LOOP_COVERED_EVENT` and `CHAMBER_HOLOGRAM_EVENT`.
 */
export const JUMP_COVERED_EVENT = 'voidix:jump-covered';

/**
 * The pin has SETTLED on the destination — the cover may open.
 *
 * ⚠ "Settled" means the pin's own progress has reached the target stop, NOT that the `scrollTo` tween
 * finished. The pin is scrubbed (`SCROLL_SCRUB`), so its progress trails the scrollbar by up to that
 * many seconds; opening on the tween's completion would uncover onto a pin still sliding the last
 * stretch of the journey — which is the exact thing this feature exists to hide, only later.
 */
export const JUMP_ARRIVED_EVENT = 'voidix:jump-arrived';

/**
 * You have landed on this section — play its entrance.
 *
 * ── The cover is generic; the entrance is the section's own ──────────────────────────────────────
 * The same split as `HERO_SERVICES_PROGRESS_EVENT`, where the pin owns the layout of the span and the
 * sun owns what to do with it. This carries a key and nothing else; what arriving looks like is
 * decided entirely by whoever owns that section. Two already answer it without listening here — the
 * fleet replays its craft on `DECK_REVEAL_EVENT`, the room unseals its hologram on
 * `CHAMBER_HOLOGRAM_EVENT` — and that is fine. A section with no entrance simply has none.
 *
 * ⚠ Fired at the START of the cover opening, not after it, so the entrance plays THROUGH the reveal
 * rather than behind it. Spent under the cover it would hand the visitor a fully-built section the
 * instant the hole cleared, having watched none of it — the mistake `LOOP_COVERED_EVENT` documents
 * for the hero's own arrival.
 */
export const SECTION_ARRIVE_EVENT = 'voidix:section-arrive';

export interface SectionArriveDetail {
  key: string;
}

export function readSectionArriveKey(event: Event): string | null {
  const detail = (event as CustomEvent<SectionArriveDetail>).detail;
  return typeof detail?.key === 'string' ? detail.key : null;
}
