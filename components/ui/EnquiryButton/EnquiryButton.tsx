'use client';

/**
 * The site's one call to action, shared by the fleet and the works field so that "start something"
 * looks and behaves identically wherever a visitor finds it — the same reasoning behind the shared
 * `.drawer-open` affordance next to it.
 *
 * It sits inside overlays that set `pointer-events: none`, so the CSS re-enables them on the button
 * itself rather than on any wrapper: a wrapper with `auto` would also swallow the gaps around the
 * button, and those gaps are over a canvas that accepts drag.
 *
 * ── ⚠ `tone="hot"` IS FOR A PAGE WHOSE WHOLE PURPOSE IS THE PRESS ────────────────────────────────
 * The default is the outlined amber pill: correct where the CTA is one option among several, which is
 * everywhere on the homepage — a craft you are looking at, a project you are reading. Careers is not
 * that. The entire document exists to produce one press, so there it is filled at rest and carries the
 * heat, rather than waiting for a hover to admit it is the destination.
 *
 * Keep it rare. Two hot buttons on one screen is two destinations, which is none.
 */

interface EnquiryButtonProps {
  label: string;
  onClick: () => void;
  /** `'hot'` fills the button at rest — see the header before reaching for it. */
  tone?: 'default' | 'hot';
}

export default function EnquiryButton({ label, onClick, tone = 'default' }: EnquiryButtonProps) {
  return (
    <button
      type="button"
      className={tone === 'hot' ? 'enquiry-cta enquiry-cta--hot' : 'enquiry-cta'}
      onClick={onClick}
    >
      <span className="enquiry-cta-label">{label}</span>
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
  );
}
