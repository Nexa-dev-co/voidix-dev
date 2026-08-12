import type { CSSProperties } from 'react';
import {
  TRAJECTORY_VIEW_BOX,
  phaseFraction,
  trajectoryHeightAt,
  trajectoryPath,
} from './trajectoryGeometry';

/**
 * A sequence of phases on a trajectory — how a build runs, and how hiring runs.
 *
 * It is the orbit rail laid sideways, and that is the point: the same object that measures your way
 * down the page measures the way through a process, so the page has one visual idea for "a path with
 * stations on it" rather than two.
 *
 *              ╭───────●───────╮
 *     ●────────╯                ╰────────●
 *   Day 0    2 days          Week 1     Week 2
 *   one line each, under the marker it belongs to
 *
 * ── ⚠ EVERY COLUMN DRAWS ITS OWN SLICE OF ONE CURVE ──────────────────────────────────────────────
 * There is no single stretched SVG lying across the row, and the reason is alignment. A shared curve
 * would have to be positioned against a marker row whose height is decided by how many lines a phase
 * name happens to wrap to — so it would ride correctly at one width and float off the dots at another.
 *
 * Instead each phase's marker holds an SVG whose **viewBox is windowed to that phase's own span of the
 * curve** (`x0 = fraction × 100`, one column wide) while the path itself is the whole trajectory. Every
 * column is therefore a window onto the same function: the slices meet exactly at their shared
 * endpoints because both sides compute the same point, and the curve stretches horizontally with the
 * column while its height stays pinned to the row. `preserveAspectRatio="none"` is what allows that
 * non-uniform stretch, and `vectorEffect="non-scaling-stroke"` is what stops the stroke stretching
 * with it into a wedge.
 *
 * ⚠ The dot is NOT drawn in that SVG. A `<circle>` under a non-uniform scale is an ellipse; it is a
 * CSS pseudo-element placed at `--marker-drop` instead, which is the same number the path is built
 * from — so the dot cannot drift off its own line.
 *
 * ⚠ All of this needs the four rows to line up ACROSS columns, which is `subgrid` in the stylesheet.
 * Where subgrid is missing the curve is hidden and the markers fall back to the straight rule they
 * always were — the section still reads, it just stops being a trajectory.
 *
 * ── ⚠ IT ROTATES BELOW 51.25em; IT DOES NOT SCROLL SIDEWAYS ──────────────────────────────────────
 * Four phases across a 360px screen is 90px each, which fits neither "6–24 weeks" nor a sentence. The
 * obvious escape is an overflow-x scroller, and it is the wrong one: `CLAUDE.md`'s responsiveness rule
 * is that the page body must never scroll horizontally, and a track you have to drag hides the last
 * phase from anyone who does not notice it is draggable. The track becomes vertical, the markers run
 * down the left, and nothing is lost. All of that lives in CSS — the markup below does not branch, and
 * the curve is simply hidden there, a trajectory needing a horizontal run to be one.
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
  /** One column's share of the curve, in the trajectory's own units. */
  const columnWidth = TRAJECTORY_VIEW_BOX.width / Math.max(phases.length, 1);

  return (
    // ⚠ The column count is declared, not inferred by `auto-fit` — see the stylesheet on why a
    // trajectory cannot survive being wrapped onto a second band of rows.
    <ol className="doc-track" style={{ '--track-count': phases.length } as CSSProperties}>
      {phases.map((phase, index) => {
        const fraction = phaseFraction(index, phases.length);
        const windowStart = fraction * TRAJECTORY_VIEW_BOX.width;

        return (
          <li
            key={phase.name}
            className="doc-track-phase"
            style={
              {
                '--reveal-index': index,
                '--marker-drop': trajectoryHeightAt(fraction),
              } as CSSProperties
            }
          >
            <p className="doc-track-span">{phase.span}</p>
            <h3 className="font-display doc-track-name">{phase.name}</h3>

            {/* The marker sits between the name and the detail, ON the curve rather than under it —
                which is what makes the line read as passing through the phases. */}
            <span className="doc-track-marker" aria-hidden="true">
              <svg
                className="doc-track-marker-arc"
                viewBox={`${windowStart} 0 ${columnWidth} ${TRAJECTORY_VIEW_BOX.height}`}
                preserveAspectRatio="none"
                fill="none"
              >
                <path
                  className="doc-track-arc-line"
                  d={trajectoryPath()}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </span>

            <p className="doc-track-detail">{phase.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}
