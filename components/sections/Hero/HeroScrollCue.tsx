import { SCROLL_CUE } from './HeroInstruments/heroReadouts';

/**
 * The hero's scroll cue on a narrow screen — the one thing on the page that says it wants a gesture.
 *
 * ── Why this exists as its own component ─────────────────────────────────────────────────────────
 * The cue used to live at the bottom of the HUD's left column, and the left column is gone below
 * 820px: `useIsLowPowerViewport` unmounts `HeroInstruments` outright (its readouts are four rAF loops
 * and hiding them in CSS would leave every one of them running), and `.hero-hud` is `display: none`
 * at 51.25em on top of that. Both decisions are right and neither priced this: the platform that most
 * needs telling that the page wants a swipe is the one that lost the only thing telling it. A phone
 * met a headline, a tagline and a pinned star that answers a gesture up to 1.8s later, with nothing
 * on screen claiming it would.
 *
 * So the cue comes back on its own, without the panel it was attached to. It is static markup and one
 * CSS keyframe — no rAF, no timer, nothing to unmount — which is why it can be gated in CSS at the
 * layout breakpoint rather than in JS at the capability one. Above 51.25em the HUD's own cue is up
 * and this is `display: none`; below it, the reverse. The two are never on screen together.
 *
 * ── ⚠ THE MARKERS ARE PLACED AROUND THE BLEND, NOT AROUND THE MARKUP ─────────────────────────────
 * `data-hud-item` is what `useHeroInstruments` animates on REVEAL_EVENT, and `HeroInstruments`' own
 * header states the rule it has to obey: a marker may never sit on a WRAPPER that contains a blended
 * element, because the transform and opacity it receives make that wrapper a stacking context and
 * kill the child's `mix-blend-mode` permanently (the `.hero-main` trap). An element that blends and
 * is animated *itself* is safe — blending happens against the parent's backdrop and does not care
 * what the element does to itself.
 *
 * Hence: the label carries `.hud-label` (the blend) and the marker together, and the arrow's marker
 * sits on a span that IS the blended element, with the `<svg>` inside it left unblended and untouched
 * by GSAP.
 *
 * ── ⚠ AND THE DRIFT IS ON THE INNER GLYPH FOR A REASON THAT IS NOT TIDINESS ──────────────────────
 * A CSS animation outranks an inline style. GSAP's entrance writes `opacity` and `transform` inline,
 * so a keyframe touching either property on the same element would win — silently, for the whole
 * session, and the entrance would simply never be seen. The drift therefore lives one level in, on
 * the `<svg>` that nothing else writes to, and animates `transform` only.
 */
export default function HeroScrollCue() {
  return (
    // aria-hidden, like the HUD it came from: the cue describes a gesture rather than naming
    // anything, and a screen reader is not being asked to scroll a pinned canvas to find the content.
    <div className="hero-touch-cue" aria-hidden="true">
      {/* One line rather than the HUD column's two — this sits under a centred tagline with the full
          width of the frame, not in a 3.75rem gutter. Same words either way; SCROLL_CUE is the one
          copy of them. */}
      <span className="hud-label hero-touch-cue-label" data-hud-item>
        {SCROLL_CUE.top} {SCROLL_CUE.bottom}
      </span>

      <span className="hero-touch-cue-arrow" data-hud-item>
        <svg
          className="hero-touch-cue-glyph"
          width="14"
          height="26"
          viewBox="0 0 14 26"
          fill="none"
        >
          <path
            d="M7 1v22M2 18l5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}
