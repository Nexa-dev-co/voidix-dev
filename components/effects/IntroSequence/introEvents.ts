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
 * An element only the loader renders, so anything that mounts LATE can still ask "is there an intro?".
 *
 * `INTRO_ACTIVE_EVENT` is fired once, synchronously, on the intro's mount — which is fine for the hero
 * (its effect runs first) and useless to everything behind a `next/dynamic` import, because those mount
 * well after the event has been and gone. Those check the DOM instead. `SunModelCanvas` established
 * this; the two heavy scene hooks need the same answer, so the selector lives here rather than being
 * spelled out in three files.
 */
export const INTRO_MARKER_SELECTOR = '.intro-o-slot';

/**
 * Fired when the load reaches 100%, cueing the sun's fracture shards to sweep in from off-frame.
 *
 * This is the loader's finale, so it is deliberately the LAST thing that happens rather than something
 * running alongside the wait: the dust streams for however long the download takes, and the arrival of
 * solid matter is the reward for it finishing. (It used to fire when the "o" appeared, which meant the
 * assembly raced the download and usually ended long before the loader did.)
 *
 * If the cue never comes — no intro on the page at all — the sun starts on its own; see SunModelCanvas.
 */
export const SUN_ASSEMBLE_EVENT = 'voidix:sun-assemble';

/**
 * Fired by the sun once every shard has landed. The intro holds its handoff until this arrives (capped by
 * a timeout), so the reveal can never begin on a half-built star — which would waste the one moment the
 * assembly is on screen.
 */
export const SUN_ASSEMBLED_EVENT = 'voidix:sun-assembled';

/**
 * Fired at the start of the handoff, telling the loader's gathering field to ignite — the last rush of
 * matter into the star, timed to land under the sun's flight out of the "o".
 *
 * An event rather than a prop because the gather field is a self-contained WebGL canvas driven by real
 * load progress, not by the GSAP timeline: this is the one moment the timeline needs to say something to
 * it, and it matches how the intro already talks to the hero.
 */
export const IGNITE_EVENT = 'voidix:intro-ignite';
