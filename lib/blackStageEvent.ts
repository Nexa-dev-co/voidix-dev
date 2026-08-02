/**
 * A full-black scene has taken the page — or has given it back.
 *
 * True from the moment the filled square hands over to the fleet, all the way to the bottom of the
 * site; false only on the hero and its fill. It is the event form of the `is-services` class the pin
 * puts on the hero section, and it means exactly what that class means.
 *
 * ── Why this is not DECK_REVEAL_EVENT ────────────────────────────────────────────────────────────
 * Because that event was quietly carrying two meanings, and only one of them was its own:
 *
 *   1. "the fleet is entering — replay the craft's entrance"   ← genuinely the deck's
 *   2. "the void has the page — sun goes behind, ink stops,
 *       the constellation freezes"                             ← nothing to do with the deck
 *
 * The two were interchangeable for as long as the only way into the void was to scroll through the
 * fleet, because then the fleet really was always the first black scene you met. **A navbar jump
 * broke that.** `goToStop` commits its target stop up front, so `setStage` goes straight from "fill"
 * to "work" (or "contact") and services is never entered — no DECK_REVEAL, and therefore:
 *
 *   · the fluid cursor kept splatting ink over the works field, the chamber and the contact form;
 *   · the constellation frame kept animating behind them;
 *   · the sun stayed at its hero z-index, painting IN FRONT of the marks instead of behind them.
 *
 * Fired by the stage machine on the fill ↔ black boundary rather than by any one section, so it
 * cannot depend on the route taken to get there. `DECK_REVEAL_EVENT` keeps meaning (1) and only (1).
 */

export const BLACK_STAGE_EVENT = 'voidix:black-stage';

export interface BlackStageDetail {
  /** True when a full-black scene is on screen; false on the hero and its fill. */
  active: boolean;
}

export function readBlackStageActive(event: Event): boolean {
  const detail = (event as CustomEvent<BlackStageDetail>).detail;
  return detail?.active === true;
}
