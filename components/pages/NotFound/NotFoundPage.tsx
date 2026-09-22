import Link from 'next/link';
import LostCoordinates from './LostCoordinates';
import {
  NOT_FOUND_DESTINATIONS,
  NOT_FOUND_EYEBROW,
  NOT_FOUND_LEAD,
  NOT_FOUND_RETURN,
  NOT_FOUND_TITLE,
} from './notFoundContent';

/**
 * The 404 — one screen, and the one page on the site that is allowed to be a single viewport of type.
 *
 * ── ⚠ NOT `PageShell`, DELIBERATELY ─────────────────────────────────────────────────────────────
 * The shell is a document frame: an orbit rail whose stations are numbered sections, and a footer
 * that reads `SiteContent` through a provider fed by the panel. A 404 has no sections for the rail to
 * stand on, and it must not wait on the panel (see `notFoundContent.ts`). What it keeps from the
 * document routes is everything that makes it look like one of them: `.doc-page`'s padding and ink,
 * and the same `.doc-field` backdrop — so a lost visitor is visibly still inside the site.
 *
 * ── The figure ────────────────────────────────────────────────────────────────────────────────────
 * The zero is an orbit with nothing on it: a star at the centre, a trail fading up to a hollow marker
 * at the body's last known position, and the body itself leaving on a line out of frame. It is pure
 * CSS for the same budget reason the field is — see `PageShell`'s header.
 *
 * Server Component. The only JavaScript it ships is `LostCoordinates`.
 */
export default function NotFoundPage() {
  return (
    <main className="doc-page lost-page">
      <div className="doc-field" aria-hidden="true">
        <span className="doc-field-stars doc-field-stars--fine" />
        <span className="doc-field-stars doc-field-stars--coarse" />
        <span className="doc-field-bloom" />
      </div>

      <div className="doc-inner lost-inner">
        {/* Decorative — the eyebrow and the heading say "404" in words a screen reader can use. */}
        <div className="font-display lost-figure" aria-hidden="true">
          <span className="lost-figure-digit">4</span>
          <span className="lost-orbit">
            <span className="lost-orbit-ring" />
            <span className="lost-orbit-trace" />
            <span className="lost-orbit-star" />
            <span className="lost-orbit-flight">
              <span className="lost-orbit-marker" />
              <span className="lost-orbit-escape" />
              <span className="lost-orbit-body" />
            </span>
          </span>
          <span className="lost-figure-digit">4</span>
        </div>

        <div className="lost-body">
          <div className="lost-head">
            <p className="eyebrow doc-masthead-eyebrow">{NOT_FOUND_EYEBROW}</p>
            <h1 className="font-display lost-title">{NOT_FOUND_TITLE}</h1>
          </div>

          <div className="lost-detail">
            <p className="lost-lead">{NOT_FOUND_LEAD}</p>
            <LostCoordinates />

            <nav className="lost-actions" aria-label="Where to go from here">
              <Link className="lost-return" href={NOT_FOUND_RETURN.href}>
                {NOT_FOUND_RETURN.label}
              </Link>
              <ul className="lost-destinations">
                {NOT_FOUND_DESTINATIONS.map((destination) => (
                  <li key={destination.href}>
                    <Link className="doc-close-link" href={destination.href}>
                      {destination.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      </div>
    </main>
  );
}
