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

/**
 * Fired by the navbar's "Services" link on the homepage. The hero pin owns the scroll, so it
 * listens for this and scrolls to the revealed fleet (craft 0) — a plain `#services` anchor would
 * just jump to the top of the hero without driving the fill → reveal transition.
 */
export const GOTO_SERVICES_EVENT = 'voidix:goto-services';
