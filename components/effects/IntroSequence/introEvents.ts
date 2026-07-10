/**
 * Fired by the IntroSequence orchestrator at the exact moment the blue sun lands
 * in the hero square slot. The hero listens for it and runs its reveal (text
 * mask-wipe + square "water fill" + sun crossfade). Shared so both sides agree
 * on the handoff name.
 */
export const REVEAL_EVENT = 'orbix:reveal';

/**
 * Fired once, synchronously, when the IntroSequence effect mounts — i.e. an intro is actually on the
 * page and will drive the reveal itself (possibly after a long, legitimate wait for assets to load).
 * The hero listens so it can extend its own reveal-fallback: if this never fires the intro is absent
 * or crashed on mount, so the hero recovers fast; if it does, the hero trusts the intro and only
 * keeps a long ultimate safety net.
 */
export const INTRO_ACTIVE_EVENT = 'orbix:intro-active';
