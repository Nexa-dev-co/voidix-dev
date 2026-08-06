import type { CSSProperties } from 'react';

/**
 * A sequence of phases on a track — how a build runs, and how hiring runs.
 *
 * It is the orbit rail laid sideways, and that is the point: the same object that measures your way
 * down the page measures the way through a process, so the page has one visual idea for "a path with
 * stations on it" rather than two.
 *
 *   PROVE            SHAPE            BUILD                HAND OVER
 *   week 1–2         week 2–3         6–24 weeks           2 weeks, then the door stays open
 *   ●────────────────●────────────────●────────────────────●
 *   one line each, under the marker it belongs to
 *
 * ── ⚠ IT ROTATES BELOW 51.25em; IT DOES NOT SCROLL SIDEWAYS ──────────────────────────────────────
 * Four phases across a 360px screen is 90px each, which fits neither "6–24 weeks" nor a sentence. The
 * obvious escape is an overflow-x scroller, and it is the wrong one: `CLAUDE.md`'s responsiveness rule
 * is that the page body must never scroll horizontally, and a track you have to drag hides the last
 * phase from anyone who does not notice it is draggable. The track becomes vertical, the markers run
 * down the left, and nothing is lost. All of that lives in CSS — the markup below does not branch.
 */

export interface Phase {
  /** The phase's name — the loudest thing in the column. */
  name: string;
  /** How long it takes. Sits above the name as a kicker. */
  span: string;
  detail: string;
}

interface PhaseTrackProps {
  phases: readonly Phase[];
}

export default function PhaseTrack({ phases }: PhaseTrackProps) {
  return (
    <ol className="doc-track">
      {phases.map((phase, index) => (
        <li
          key={phase.name}
          className="doc-track-phase"
          style={{ '--reveal-index': index } as CSSProperties}
        >
          <p className="doc-track-span">{phase.span}</p>
          <h3 className="font-display doc-track-name">{phase.name}</h3>
          {/* The marker sits between the name and the detail — ON the line the track draws through
              the whole row, which is what makes the line read as passing through the phases rather
              than as an underline beneath them. */}
          <span className="doc-track-marker" aria-hidden="true" />
          <p className="doc-track-detail">{phase.detail}</p>
        </li>
      ))}
    </ol>
  );
}
