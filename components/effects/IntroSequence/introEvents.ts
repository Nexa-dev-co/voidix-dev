/**
 * Fired by the IntroSequence orchestrator at the exact moment the blue sun lands
 * in the hero square slot. The hero listens for it and runs its reveal (text
 * mask-wipe + square "water fill" + sun crossfade). Shared so both sides agree
 * on the handoff name.
 */
export const REVEAL_EVENT = 'voidix:reveal';

/**
 * Fired once, synchronously, when the IntroSequence effect mounts — i.e. an intro is actually on the
 * page and will drive the reveal itself (possibly after a long, legitimate wait for assets to load).
 * The hero listens so it can extend its own reveal-fallback: if this never fires the intro is absent
 * or crashed on mount, so the hero recovers fast; if it does, the hero trusts the intro and only
 * keeps a long ultimate safety net.
 */
export const INTRO_ACTIVE_EVENT = 'voidix:intro-active';

/**
 * Fired at the start of the handoff, telling the loader's gathering field to ignite — the last rush of
 * matter into the star, timed to land under the sun's flight out of the "o".
 *
 * An event rather than a prop because the gather field is a self-contained WebGL canvas driven by real
 * load progress, not by the GSAP timeline: this is the one moment the timeline needs to say something to
 * it, and it matches how the intro already talks to the hero.
 */
export const IGNITE_EVENT = 'voidix:intro-ignite';
