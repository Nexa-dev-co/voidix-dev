'use client';

import { useRef } from 'react';
import { LOADER_MODULES, MODULE_STATES } from './loaderModules';
import { useLoaderTelemetry } from './hooks/useLoaderTelemetry';

// The loader's live instrument panel: a module list reading real per-source load progress, a throughput
// readout differentiated from it, and a hairline meter along the bottom of the editorial frame.
//
// Every value here is real. Nothing is on a timer pretending to load, so the panel cannot drift out of
// step with what is actually happening — and when it says ONLINE, that source genuinely is.
//
// The rows carry `intro-chrome`, which is what IntroSequence's timeline already fades in at the start and
// out at the handoff. That is deliberate: the panel needs no timeline code of its own, and it can never
// be left on screen after the veil lifts.

export default function LoaderTelemetry() {
  const rootRef = useRef<HTMLDivElement>(null);
  useLoaderTelemetry(rootRef);

  return (
    <div ref={rootRef} className="loader-telemetry" aria-hidden>
      <div className="loader-modules">
        {LOADER_MODULES.map((module) => (
          <div key={module.feed} className="loader-row intro-chrome" data-feed={module.feed}>
            <span className="loader-label">{module.label}</span>
            {/* Dressed entirely by the row's state class — nothing reads this element directly. */}
            <span className="loader-dot" />
            {/* Resting text matches what the hook writes on its first frame, so hydration is stable. */}
            <span className="loader-state" data-role="state">
              {module.feed === 'shell' ? MODULE_STATES.dormant : MODULE_STATES.queued}
            </span>
            <span className="loader-value" data-role="value">
              {module.feed === 'shell' ? '--' : '0%'}
            </span>
          </div>
        ))}
      </div>

      <span className="loader-throughput intro-chrome" data-role="throughput">
        0.00 MB/S
      </span>

      {/* Sits on the frame's bottom edge, so the meter reads as the frame filling rather than as a bar
          stuck to the page. Same faint-track + cyan-fill grammar as the navbar's per-section meters. */}
      <div className="loader-meter intro-chrome">
        <span className="loader-meter-fill" data-role="meter-fill" />
      </div>
    </div>
  );
}
