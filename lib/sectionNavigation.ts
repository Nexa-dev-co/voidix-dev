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
  /** A carousel section key: 'services' | 'work' | 'process' | 'contact'. */
  key: string;
}

/** Ask the hero pin to scroll to a section. No-op off the homepage, where the pin does not exist. */
export function requestSection(key: string): void {
  window.dispatchEvent(
    new CustomEvent<GotoSectionDetail>(GOTO_SECTION_EVENT, { detail: { key } }),
  );
}

/** Safely pull the section key out of a {@link GOTO_SECTION_EVENT} listener's event. */
export function readGotoSectionKey(event: Event): string | null {
  const detail = (event as CustomEvent<GotoSectionDetail>).detail;
  return typeof detail?.key === 'string' ? detail.key : null;
}
