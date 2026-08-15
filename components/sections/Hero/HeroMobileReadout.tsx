import { CORE_MODULES } from './HeroInstruments/heroReadouts';

/**
 * The phone's slice of the instrument panel.
 *
 * ── Why the hero is empty on a phone, and why this is the fix ────────────────────────────────────
 * `useIsLowPowerViewport` unmounts `HeroInstruments` and `FluidCursor` below 760px, which is correct —
 * between them they are five rAF loops and a WebGL fluid simulation, and hiding them in CSS would have
 * left every one of them running. But the desktop hero is a headline flanked by two telemetry columns,
 * and taking both columns away leaves a headline, a tagline and a great deal of cream. The page reads
 * as unfinished rather than as restrained, which is the same failure `.doc-masthead-star` was added to
 * fix on the document routes.
 *
 * So the panel comes back the way `HeroScrollCue` did: **as static markup**. That is the whole argument
 * — the reason the HUD is unmounted is the loops, and a strip with no loops in it does not inherit that
 * reason. It is gated in CSS at the LAYOUT breakpoint (51.25em) rather than in JS at the capability one,
 * so this and the full HUD are never on screen together.
 *
 * ── ⚠ THE COPY IS NOT NEW, AND MUST NOT BE ───────────────────────────────────────────────────────
 * Every line here comes from `CORE_MODULES`, the same array the desktop's left column renders. Writing
 * a second set of words for the phone would be two sources of truth for one instrument, and the first
 * retune would leave them disagreeing on screen about what the core is doing.
 *
 * ── ⚠ AND ONLY THE MODULES THAT DO NOT TICK ──────────────────────────────────────────────────────
 * `CORE_MODULES` marks two of its five `live` — Core Stability reads real fps, Energy Output reads
 * cursor velocity. Both are driven by `useCoreTelemetry`, which is part of the HUD that is not mounted
 * here. Rendering their resting values as static text would put "99.98%" and "6%" on screen as if they
 * meant something, which is worse than leaving them out: a readout that never moves is a decoration
 * wearing an instrument's clothes. Filtered on the flag rather than by name, so a module that becomes
 * live later drops out of here on its own.
 *
 * ── ⚠ NO `mix-blend-mode` ───────────────────────────────────────────────────────────────────────
 * The headline, the tagline and the desktop HUD's labels all blend with `difference`, because the ink
 * trail passes under them and they have to invert over it. There is no ink trail at this width —
 * `FluidCursor` is unmounted by the same gate that removed the HUD — so there is nothing to invert
 * against, and the blend would only make these colours hard to reason about. Solid, and graded
 * directly against the hero's cream.
 */
export default function HeroMobileReadout() {
  const staticModules = CORE_MODULES.filter((module) => !module.live);

  return (
    // aria-hidden for the same reason the HUD and the scroll cue are: this is atmosphere in the shape
    // of an instrument, not information a screen reader is missing anything by skipping.
    <div className="hero-readout" aria-hidden="true">
      {staticModules.map((module) => (
        <div className="hero-readout-item" key={module.label}>
          <span className="hero-readout-label">{module.label}</span>
          <span
            className="hero-readout-value"
            // The breathing ONLINE light, in the amber the cream can actually carry — see the CSS.
            data-accent={module.accent ? 'true' : undefined}
          >
            {module.value}
          </span>
        </div>
      ))}
    </div>
  );
}
