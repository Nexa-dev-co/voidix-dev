/**
 * Fired the moment the hero square has fully filled the screen and the fleet is
 * revealed (and on every re-reveal after scrolling back up). `useServicesDeck`
 * listens for it to replay the centred craft's entrance, so the animation runs
 * again each time the deck comes back into view. Shared here so the transition
 * (driven by the hero pin) and the scene agree on the handoff name.
 */
export const DECK_REVEAL_EVENT = 'deck:reveal';

/**
 * The mirror of {@link DECK_REVEAL_EVENT}: fired when the deck is hidden again (scrolling back
 * up out of the fleet, before the fill is complete). The shared sun listens for both to switch
 * between its calm hero look and its big/rapid services look, and to swap its z-index so the
 * fleet + labels sit in front of it in the services section only.
 */
export const DECK_HIDE_EVENT = 'deck:hide';

/*
 * ⚠ `GOTO_SERVICES_EVENT` used to live here — a bespoke signal for the one navbar link that happened to
 * be wired. It is gone: every item and the CTA now route through the general `GOTO_SECTION_EVENT` in
 * `lib/sectionNavigation.ts`, which takes a section key. Three more per-section constants was the
 * alternative, and "the navbar is only half connected" is the state that replaced it.
 */
