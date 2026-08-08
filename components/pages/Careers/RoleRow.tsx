'use client';

import { useId, type CSSProperties } from 'react';
import type { CareerRole } from './careersContent';

/**
 * One open role — a row that opens in place rather than a link to somewhere else.
 *
 * Closed, four of them can be scanned in a second. Open, it holds everything a person needs to decide
 * whether to write. Sending them to a job-board page for that would be the one moment on this site
 * where the visitor is handed off to somebody else's design.
 *
 * ── ⚠ WHY THE PANEL ANIMATES WITH `grid-template-rows: 0fr → 1fr` ────────────────────────────────
 * Because it is the only technique that animates to CONTENT height without measuring it. `height: auto`
 * cannot be transitioned; a fixed `max-height` has to be guessed, and the guess is wrong in both
 * directions — too small clips the longest role, too large makes the shortest one open with a lazy
 * pause after the content has already arrived. A role with two bullets and one with three both open
 * correctly here with no JavaScript involved in the geometry at all.
 *
 * ⚠ The inner element MUST keep `overflow: hidden` (see globals.css). A zero-height grid row does not
 * clip on its own — without it the collapsed panel's text is simply drawn over the row below.
 *
 * ── Accessibility ────────────────────────────────────────────────────────────────────────────────
 * A real `<button aria-expanded>` controlling a panel by id, which is the whole contract for a
 * disclosure — no `role`, no roving focus to honour, nothing invented.
 *
 * ⚠ The collapsed panel is taken out of play by `visibility: hidden` in CSS, NOT by an attribute here.
 * A zero-height panel that is merely clipped still contains a focusable Apply button, so tabbing
 * through the page would land inside a role that is closed, with the focus ring drawn on nothing.
 * `visibility` removes it from the tab order and from the accessibility tree together, and — unlike
 * `display: none` — it can be transitioned, so it holds off until the collapse has finished playing.
 */

interface RoleRowProps {
  role: CareerRole;
  open: boolean;
  onToggle: () => void;
  onApply: () => void;
  /** Position in the list, for the reveal's stagger. */
  order: number;
}

export default function RoleRow({ role, open, onToggle, onApply, order }: RoleRowProps) {
  const panelId = `${useId()}-role-panel`;

  return (
    <li className="doc-role" data-open={open} style={{ '--reveal-index': order } as CSSProperties}>
      <h3 className="doc-role-heading">
        <button
          type="button"
          className="doc-role-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="doc-role-index" aria-hidden="true">
            {role.index}
          </span>
          <span className="doc-role-titles">
            <span className="font-display doc-role-title">{role.title}</span>
            <span className="doc-role-meta">
              {role.location}
              <span className="doc-role-meta-sep" aria-hidden="true">
                ·
              </span>
              {role.commitment}
            </span>
          </span>
          {/* Two strokes that become one — a plus that turns into a minus. Cheaper than swapping an
              icon and it animates, which is what says the row opens rather than navigates. */}
          <span className="doc-role-sign" aria-hidden="true">
            <span className="doc-role-sign-bar" />
            <span className="doc-role-sign-bar" />
          </span>
        </button>
      </h3>

      <div className="doc-role-panel" id={panelId}>
        <div className="doc-role-panel-inner">
          <div className="doc-role-columns">
            <div className="doc-role-column">
              <p className="doc-role-column-title">What you’d own</p>
              <ul className="doc-role-list">
                {role.owns.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>

            <div className="doc-role-column">
              <p className="doc-role-column-title">What we need to see</p>
              <ul className="doc-role-list">
                {role.needs.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Held apart from the two lists above, and labelled honestly. A "nice to have" list folded
              in with the requirements is the single most reliable way to stop good people applying. */}
          <div className="doc-role-bonus">
            <p className="doc-role-column-title">Nice, genuinely not required</p>
            <ul className="doc-chips doc-chips--quiet">
              {role.bonus.map((entry) => (
                <li key={entry} className="doc-chip">
                  {entry}
                </li>
              ))}
            </ul>
          </div>

          <button type="button" className="enquiry-cta doc-role-apply" onClick={onApply}>
            <span className="enquiry-cta-label">Apply for this role</span>
            <span className="enquiry-cta-glyph" aria-hidden="true">
              <svg width="15" height="10" viewBox="0 0 15 10" fill="none">
                <path
                  d="M1 5h12M9.5 1.5L13 5l-3.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </li>
  );
}
