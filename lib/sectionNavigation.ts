/**
 * "Take me to that section" — the navbar's links and its CTA.
 *
 * ── Why an event instead of an anchor ────────────────────────────────────────────────────────────
 * Because none of the sections are places. The whole site is one pinned `ScrollTrigger` and every
 * section past the hero is an absolutely-positioned overlay inside it, so `#work` resolves to an
 * element that lives at the top of the document no matter which project is on screen. A plain anchor
 * jumps to the hero and nothing else happens.
 *
 * The pin owns the scroll, so it listens for this and drives itself to the section's first stop —
 * which also means the whole journey in between (the fill, the fleet reveal, the handoff, the reveal)
 * plays on the way rather than being skipped.
 *
 * ── Why one event with a key, rather than one event per section ──
 * This replaces `GOTO_SERVICES_EVENT`, which was exactly that: a bespoke signal for the one link that
 * happened to be wired. Adding the other three the same way would have been three more constants,
 * three more listeners and three more chances for one of them to be forgotten — and "the navbar is
 * only half connected" is precisely the state this is fixing.
 */

export const GOTO_SECTION_EVENT = 'voidix:goto-section';

export interface GotoSectionDetail {
  /** A carousel section key: 'services' | 'work' | 'faq' | 'contact'. */
  key: string;
  /**
   * Viewport point the request came FROM — the centre of the control that was clicked.
   *
   * Carried so a jump far enough to be hidden can collapse into the label you pressed and unfold out
   * of it again (see lib/sectionJumpEvents.ts). Optional, and the pin never requires it: a
   * programmatic call has no control to measure, and the cover falls back to the middle of the frame.
   */
  origin?: { x: number; y: number };
  /**
   * The screen is ALREADY black — cover the journey, but do not close over anything.
   *
   * Set by exactly one caller: `IntroSequence`, handing a deep-link arrival (`/#work`) straight from
   * the loader to its destination. The loader's veil is already opaque, so the cover's collapse has
   * nothing to collapse over; it enters at the top of its hold instead. See lib/sectionJumpEvents.ts.
   *
   * ⚠ It also FORCES the covered path. A request carrying this has a cover on screen that only
   * `JUMP_ARRIVED_EVENT` can open, so falling through to a plain glide — which the distance rule or
   * reduced motion would otherwise do — would leave the visitor on a black screen with nothing coming.
   */
  alreadyCovered?: boolean;
}

/** Ask the hero pin to scroll to a section. No-op off the homepage, where the pin does not exist. */
export function requestSection(
  key: string,
  origin?: GotoSectionDetail['origin'],
  alreadyCovered = false,
): void {
  window.dispatchEvent(
    new CustomEvent<GotoSectionDetail>(GOTO_SECTION_EVENT, {
      detail: { key, origin, alreadyCovered },
    }),
  );
}

/** Safely pull the detail out of a {@link GOTO_SECTION_EVENT} listener's event. */
export function readGotoSection(event: Event): GotoSectionDetail | null {
  const detail = (event as CustomEvent<GotoSectionDetail>).detail;
  return typeof detail?.key === 'string' ? detail : null;
}

/** The centre of an element, as the `origin` a jump collapses into. */
export function originOfElement(
  element: Element | null,
): GotoSectionDetail['origin'] {
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
