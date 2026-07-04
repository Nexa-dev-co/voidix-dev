/**
 * Fired the moment the Works field pins into view (and on every re-entry after scrolling back
 * up out of it). `useWorksField` listens for it to replay the focused meteor's ignition, so the
 * "scroll away then back" gesture re-plays the entrance rather than showing a static field.
 * Shared here so the scroll driver (`useWorksScroll`) and the scene agree on the handoff name.
 */
export const WORKS_REVEAL_EVENT = 'works:reveal';
