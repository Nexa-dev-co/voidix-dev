/**
 * The project-change transition — one clock, shared by the DOM and the scene.
 *
 * ── Why these numbers aren't in worksTuning ──────────────────────────────────────────────────────
 * This transition spans both halves of the section: the overlay text shears apart and back (DOM,
 * `useWorksTextTransition`) while the mark comes apart and regrows (WebGL, `useWorksField`). Neither
 * owns the other, but they have to agree on how long the change takes and when the copy may come
 * back. So the schedule lives here, in a file both import, rather than inside either one's tuning.
 *
 * ── The shape of it ──────────────────────────────────────────────────────────────────────────────
 *
 *   0s      0.7      1.1      1.7          2.2        3.3       4.0s
 *   ├────────┼────────┼────────┼────────────┼──────────┼─────────┤
 *   │text OUT│        │ text IN│            │          │         │
 *   │ ├──────┤        │ ├──────────────┤    │          │         │
 *   │ geode retracts  │        │            │          │         │
 *   │ ├───────────────┤        │            │          │         │
 *   │ stones let go ───────────┤            │          │         │
 *   │            stones grow ─────────────────────────┤          │
 *   │                                                 │ geode ───┤
 *   │ camera hop ─────────────────────────┤ (2.05s — deliberately NOT stretched)
 *
 * The COPY is quick and the MARK is slow, on purpose. The label belongs to the stop you picked, so it
 * comes straight back; the stone is the thing you stay and watch.
 *
 * ── Nothing is hidden any more, and that is the change ───────────────────────────────────────────
 * This used to be a 2.90s wind-up to 1150 deg/s, a hard cut on the one frame the body was turning too
 * fast to read, and a long spin-down. The blur existed because `attachMorphTarget` cannot interpolate
 * two extruded marks — they disagree on vertex count — so there was genuinely nothing to show.
 *
 * The accretion strategy replaced that with a real change: the geode retracts, the stones let go and
 * stream back toward the core while the next mark's stream sprays out of it, and the geode grows back
 * once the stone is whole. So the transition IS the thing to look at, and a blur over the top would
 * only obscure it. The body is steady throughout; the sense of movement comes from the camera orbit.
 *
 * The text no longer waits for the mark, though. It used to leave before the swap and return with the
 * new body, because the body changed on a single hidden frame and the two could arrive together. There
 * is no such instant now — the build takes four seconds — so holding the copy back for it left the
 * section wordless for most of the change. See TEXT_IN_AT_SECONDS.
 *
 * ── Direction is the whole point ─────────────────────────────────────────────────────────────────
 * Each block keeps flowing the same way across the whole transition: the left block exits left and
 * its replacement also arrives moving left (entering from the centre), the right block mirrors it.
 * Content therefore travels in one continuous direction — which reads as ADVANCING. Having the new
 * text return from the side it just left would read as a rewind, undoing the step the user asked for.
 */

/** Seconds the outgoing text takes to clear, per block. */
export const TEXT_OUT_DURATION = 0.6;
/** Seconds between each line of a block leaving, so they fan rather than move as a slab. */
export const TEXT_OUT_STAGGER = 0.08;
/** Seconds the incoming text takes to settle. */
export const TEXT_IN_DURATION = 0.75;
export const TEXT_IN_STAGGER = 0.08;

/**
 * How far a block travels, as a percentage of its OWN width — so it always clears the edge no matter
 * the viewport, and needs no breakpoint. The exit is a full clear; the entrance starts much closer in
 * because it's a settle, not a second full slide.
 */
export const TEXT_EXIT_SHIFT_PERCENT = 120;
export const TEXT_ENTER_SHIFT_PERCENT = 60;
/** Degrees of shear while a block is in motion. Shared by both blocks, so the whole plane skews as one. */
export const TEXT_SHEAR_DEGREES = -8;

/**
 * Seconds one mark takes to become the next — the whole beat, end to end.
 *
 * This is the ONE clock. `useWorksField` moves a single `progress` value from 0 to 1 across it and
 * hands that to `setTransition`, which is a pure function; every curve inside the change is a
 * function of that number evaluated in the vertex shader. So there is nothing here to keep in step
 * with anything else, which is what the old spin/morph/re-carve schedule spent most of its comments on.
 *
 * The camera hop is DELIBERATELY not stretched to match. `travelSeconds` stays at 2.05, so the camera
 * arrives at the new stop about halfway in and you spend the rest of the change watching the mark
 * build from a settled viewpoint. Tying the two together would mean a four-second camera move, which
 * is a drift, not a shot — and the growth is the thing worth looking at, not the travel.
 *
 * ⚠ Several of the strategy's knobs are spans of PROGRESS, not seconds, so they all stretch with this.
 * At 4s: the geode is gone by ~0.7s, the stones have retracted by ~1.7s, growth runs ~1.1s → ~3.3s,
 * and the geode grows back over the last two thirds of a second. `moltenCool` at 0.17 lands at ~0.68s
 * — it was authored against a six-second round trip, where the same span reads ~1.0s, so the cooling
 * is brisker here than where it was tuned. If it reads hot, `moltenCool` in `ACCRETION_TUNING` is the
 * number, and it is now the only copy of it.
 */
export const MARK_CHANGE_SECONDS = 4;

/**
 * When the incoming text starts settling. ABSOLUTE seconds, and deliberately NOT a fraction of the
 * change.
 *
 * It was briefly a fraction, on the reasoning that the copy should keep its relationship to the mark.
 * That is wrong at any of the durations this has had: 0.62 of the six-second build it was written
 * against put the text back at 3.7s, leaving the section wordless for more than three seconds. The
 * label belongs to the STOP you have arrived at, not to how far the stone has got — you have chosen
 * the project, so its name should be back almost immediately. Being absolute is also what let
 * MARK_CHANGE_SECONDS drop to 4 without the copy needing a second look.
 *
 * So the text swaps quickly and the mark keeps building underneath it. 1.4s leaves a short beat after
 * the outgoing copy has cleared (0.6s + stagger), which is enough for the change to register as a
 * change without turning into dead air.
 */
export const TEXT_IN_AT_SECONDS = 1.4;

/** Total length of the transition. The change owns the whole span now, so these are the same number. */
export const TRANSITION_TOTAL_SECONDS = MARK_CHANGE_SECONDS;
