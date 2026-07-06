'use client';

import { Fragment, useRef } from 'react';
import { useCoreTelemetry } from './hooks/useCoreTelemetry';
import { useEnvironmentTelemetry } from './hooks/useEnvironmentTelemetry';
import {
  CORE_MODULES,
  ENERGY_IDLE,
  ENERGY_PEAK,
  ENVIRONMENT_MODULES,
  SCROLL_CUE,
  type CoreModule,
  type EnvironmentModule,
} from './heroReadouts';

// The hero's instrument HUD: two panels flanking the headline. The LEFT is the Orbix Core's own OS
// (Core Stability rides the real frame rate, Energy Output rides cursor velocity — useCoreTelemetry).
// The RIGHT is the environment surrounding the Core — five modules of live telemetry (gravity field,
// cursor influence, portal status, field distortion, orbital vector — useEnvironmentTelemetry). Both
// hooks write straight to the DOM; the entrance stagger stays in useHeroInstruments, which Hero calls.
//
// Labels carry the difference-blend invert (like the headline); values stay on a normal-blend-safe
// setup (see .hud-label / .hud-module-value in CSS). The entrance animates elements marked
// `data-hud-item`. Those markers sit ONLY on leaf elements, never on a wrapper that contains a
// blended element: a transform/opacity on such a wrapper would turn it into a stacking context and
// permanently kill the blend (the same trap the headline sidesteps by only transforming its inner
// spans). Animating a blended leaf directly is safe — an element blends against its parent's
// backdrop regardless of its own transform.

function CoreModuleBlock({ label, value, live, accent }: CoreModule) {
  const valueClassName = [
    'hud-module-value',
    accent ? 'hud-module-value--accent' : '',
    live ? 'hud-module-value--numeric' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="hud-module">
      <span className="hud-label hud-module-label" data-hud-item>{label}</span>
      <span className={valueClassName} data-hud-item data-live={live}>{value}</span>
      {live === 'energy' && (
        <span className="hud-energy-track" data-hud-item>
          <span
            className="hud-energy-fill"
            data-energy-fill
            style={{ transform: `scaleX(${ENERGY_IDLE / ENERGY_PEAK})` }}
          />
        </span>
      )}
    </div>
  );
}

function EnvironmentModuleBlock({ label, value, metric }: EnvironmentModule) {
  return (
    <div className="hud-module">
      <span className="hud-label hud-module-label" data-hud-item>{label}</span>
      <span
        className={metric === 'influence' || metric === 'distortion' || metric === 'vector'
          ? 'hud-module-value hud-module-value--numeric'
          : 'hud-module-value'}
        data-hud-item
        data-metric={metric}
        data-state="base"
      >
        {value}
      </span>
      {metric === 'influence' && (
        <span className="hud-energy-track" data-hud-item>
          <span className="hud-energy-fill" data-influence-fill style={{ transform: 'scaleX(0)' }} />
        </span>
      )}
    </div>
  );
}

export default function HeroInstruments() {
  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);

  // Live telemetry — both start on REVEAL_EVENT and write straight to the DOM, no re-renders.
  useCoreTelemetry({ panelRef: leftPanelRef });
  useEnvironmentTelemetry({ panelRef: rightPanelRef });

  return (
    <>
      {/* ── Left panel — the Orbix Core OS ── */}
      <aside ref={leftPanelRef} className="hero-hud hero-hud--left" aria-hidden="true">
        {CORE_MODULES.map((coreModule, moduleIndex) => (
          <Fragment key={coreModule.label}>
            <CoreModuleBlock {...coreModule} />
            {moduleIndex < CORE_MODULES.length - 1 && (
              <span className="hud-divider hud-module-divider" data-hud-item />
            )}
          </Fragment>
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

      {/* ── Right panel — the environment surrounding the Core ── */}
      <aside ref={rightPanelRef} className="hero-hud hero-hud--right" aria-hidden="true">
        {ENVIRONMENT_MODULES.map((environmentModule, moduleIndex) => (
          <Fragment key={environmentModule.label}>
            <EnvironmentModuleBlock {...environmentModule} />
            {moduleIndex < ENVIRONMENT_MODULES.length - 1 && (
              <span className="hud-divider hud-module-divider" data-hud-item />
            )}
          </Fragment>
        ))}
      </aside>
    </>
  );
}
