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
 *
 * ⚠ Fired on mount AND repeated as a HEARTBEAT while the loader's gate is waiting on the star (see
 * `tickGate`). It has to be: the gate no longer gives up after a fixed 12 s, it waits for as long as
 * the star keeps arriving — which at 20 KB/s is well over a minute — and the hero's ultimate net is a
 * fixed 20 s. Without the repeat, a legitimately slow load would trip that net and the hero would
 * reveal itself BEHIND the loader's veil, with the pin built while scroll is still locked
 * (Contract 2). Re-asserting "the intro is alive" is exactly what the hero's handler wants, so no
 * second event was needed; it clears and re-arms the timer each time.
 *
 * The hero is its only listener. Everything else deliberately reads the DOM (see below), so the
 * repeat cannot reach anything that expected a one-shot.
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
 * Cue and completion of the loader's PERFORMANCE MEASUREMENT — a stage of the gate in its own right.
 *
 * ── ⚠ Why this is a stage and not a step inside the works warm-up ────────────────────────────────
 * It was inside it, and it never once produced a reading. The burn-in needs ~12 real frames, and it was
 * running while the OTHER scene was still compiling and uploading — so frames were 300–500 ms, twelve
 * of them could not fit inside the 1.5 s cap, and it silently gave up every time. Worse, the frames it
 * did get were not the frame the visitor gets: measuring the machine while the machine is still
 * building the site reports it as far weaker than it is, and the resolution would be cut on the
 * strength of that.
 *
 * As its own stage — after BOTH scenes report warm, before the shards fly — it runs on the one quiet
 * main thread the loader ever has. Nothing is compiling, nothing is uploading, the dust is in a worker,
 * and the only other thing drawing is the star, which is exactly what will be drawing later too.
 *
 * The intro cues it and holds the assembly until the done event (capped), so the resolution is settled
 * before a single visible frame is drawn.
 */
export const BURN_IN_EVENT = 'voidix:burn-in';
export const BURN_IN_DONE_EVENT = 'voidix:burn-in-done';

/**
 * The gate has opened: the wait is over and the loader's finale is starting.
 *
 * ── ⚠ Why this is an event and not a condition anyone can evaluate ───────────────────────────────
 * `GatherCanvas` used to decide for itself when to let its held drawings go, by asking whether the
 * assets were in and warm. That was a faithful reading of "the wait is over" right up until the wait
 * stopped being a function of the assets: `MINIMUM_LOADER_MS` holds the finale so that at least one
 * drawing is seen, and on a warm cache that is seven seconds during which the field would have
 * already released — plain stream, nothing on screen, waiting for a wordmark that has not been
 * allowed to arrive yet.
 *
 * Two modules independently guessing when a third thing happens is how that goes wrong. The intro
 * knows exactly when it resumes; this is it saying so.
 *
 * ⚠ It fires BEFORE the wordmark, not with it. The field's oldest rule is that THE FINALE IS THE
 * FLOW'S — the dust must be back in its stream before the first shard moves — and the release takes
 * about 0.8 s against the ~2.3 s of wordmark that follows this. That margin is the reason this is
 * cued here rather than at SUN_ASSEMBLE_EVENT, which would be exactly too late.
 */
export const FINALE_EVENT = 'voidix:intro-finale';

/**
 * The shortest the loader may be, from mount to the wordmark.
 *
 * ── Why a loading screen has a MINIMUM ───────────────────────────────────────────────────────────
 * Because on a warm cache the whole gate can be satisfied in under two seconds, and the field would
 * be released before it had finished gathering into its first drawing — so the one thing the loader
 * is now made of would only ever be seen by people on slow connections.
 *
 * ⚠ It holds the SHOW, never the WORK. Every download, compile, allocation and measurement runs at
 * full speed and is finished before this is consulted (see `openFinale`) — this only decides when the
 * wordmark is allowed to arrive.
 *
 * ⚠ It lives HERE, next to the events, because two files need it and they are not in the same tree:
 * `IntroSequence` enforces it, and `GatherCanvas` needs it to pace the drawings (on a warm cache this
 * IS the wait, so a sequence paced on the download estimate alone would race to the end of a loader
 * that is being held open). A second copy would drift the moment either was retuned.
 */
export const MINIMUM_LOADER_MS = 6500;

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
 * Fired ONCE, on the frame the star actually lights inside its closing shell — the assembly's midpoint,
 * not its cue.
 *
 * It exists because the gathering field has to pull back from around the star before the last shards
 * dock, and "when should it pull back" turned out to have a wrong obvious answer. Keying that off
 * `SUN_ASSEMBLE_EVENT` looked right and was not: the cue is the intro ASKING, and on a slow load the
 * sun has no model yet and cannot answer — so the dust withdrew, left a hole around an empty "o", and
 * held it there for however long the download had left to run. The loader's own field disappearing
 * while nothing arrived to replace it.
 *
 * This fires from inside the flight, so it cannot happen unless there is a star to make room for.
 */
export const SUN_FORMING_EVENT = 'voidix:sun-forming';

/**
 * Fired at the start of the handoff, telling the loader's gathering field to ignite — the last rush of
 * matter into the star, timed to land under the sun's flight out of the "o".
 *
 * An event rather than a prop because the gather field is a self-contained WebGL canvas driven by real
 * load progress, not by the GSAP timeline: this is the one moment the timeline needs to say something to
 * it, and it matches how the intro already talks to the hero.
 */
export const IGNITE_EVENT = 'voidix:intro-ignite';
