'use client';

import {
  CORE_LABEL,
  LEFT_READOUTS,
  RIGHT_READOUTS,
  COORD_LINES,
  SCROLL_CUE,
  type Readout,
} from './heroReadouts';

// The hero's instrument HUD: two telemetry columns flanking the headline (see the concept mock).
// Presentational only — the entrance + the subtle live ticking live in useHeroInstruments, which
// Hero calls. Labels carry the difference-blend invert (like the headline); values stay brand-cyan
// on a normal blend, so the invert never muddies the accent (see .hud-label / .hud-value in CSS).
//
// The entrance animates elements marked `data-hud-item`. Those markers sit ONLY on leaf elements,
// never on a wrapper that contains a .hud-label: a transform/opacity on such a wrapper would turn
// it into a stacking context and permanently kill the label's difference blend (the same trap the
// headline sidesteps by only transforming its inner spans). Animating the blended label directly is
// safe — an element blends against its parent's backdrop regardless of its own transform.

function Row({ label, value, live }: Readout) {
  return (
    <div className="hud-row">
      <span className="hud-label" data-hud-item>{label}</span>
      <span className="hud-value" data-hud-item data-live={live}>{value}</span>
    </div>
  );
}

export default function HeroInstruments() {
  return (
    <>
      {/* ── Left column — core status stack + scroll cue ── */}
      <aside className="hero-hud hero-hud--left" aria-hidden="true">
        <p className="hud-core">
          <span className="hud-core-dot" data-hud-item />
          <span className="hud-label" data-hud-item>{CORE_LABEL}</span>
        </p>

        <span className="hud-divider" data-hud-item />

        {LEFT_READOUTS.map((readout) => (
          <Row key={readout.label} {...readout} />
        ))}

        <span className="hud-divider" data-hud-item />

        <div className="hero-scroll-cue">
          <span className="hud-label" data-hud-item>
            {SCROLL_CUE.top}
            <br />
            {SCROLL_CUE.bottom}
          </span>
          <svg className="hud-scroll-arrow" data-hud-item width="14" height="26" viewBox="0 0 14 26" fill="none">
            <path d="M7 1v22M2 18l5 5 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </aside>

      {/* ── Right column — orbital telemetry ── */}
      <aside className="hero-hud hero-hud--right" aria-hidden="true">
        <span className="hud-reticle" data-hud-item>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <circle cx="17" cy="17" r="8" stroke="currentColor" strokeWidth="1" opacity="0.6" />
            <path d="M17 1v7M17 26v7M1 17h7M26 17h7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </span>

        <div className="hud-coords">
          {COORD_LINES.map((line) => (
            <span key={line} className="hud-label hud-coord" data-hud-item>{line}</span>
          ))}
        </div>

        <span className="hud-divider" data-hud-item />

        {RIGHT_READOUTS.map((readout) => (
          <Row key={readout.label} {...readout} />
        ))}

        {/* Mini orbit widget — a dashed track with one slowly-orbiting node. */}
        <span className="hud-orbit" data-hud-item>
          <svg className="hud-orbit-static" width="52" height="52" viewBox="0 0 52 52" fill="none">
            <circle cx="26" cy="26" r="18" stroke="currentColor" strokeWidth="0.75" strokeDasharray="2 3" opacity="0.5" />
            <circle cx="26" cy="26" r="2" fill="currentColor" />
          </svg>
          <svg className="hud-orbit-spinning" width="52" height="52" viewBox="0 0 52 52" fill="none">
            <circle cx="44" cy="26" r="2" fill="currentColor" />
          </svg>
        </span>
      </aside>
    </>
  );
}
