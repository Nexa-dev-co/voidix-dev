'use client';

import { useRef, type CSSProperties } from 'react';
import { useNavbarAnimation } from '@/lib/hooks/useNavbarAnimation';
import { originOfElement, requestSection } from '@/lib/sectionNavigation';
import { HOME_METER_KEY, NAV_ITEMS } from './navItems';

const METER_KEYS = [HOME_METER_KEY, ...NAV_ITEMS.map((item) => item.key)];

function LinkArrow() {
  return (
    <span className="nav-link-arrow" aria-hidden="true">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path
          d="M2.5 6.5h7M6.5 3.5l3 3-3 3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function OrbitalMark() {
  return (
    <div className="orbital-mark" aria-hidden="true">
      <svg className="orbital-static" width="26" height="26" viewBox="0 0 26 26" fill="none">
        <circle cx="13" cy="13" r="9" stroke="rgb(var(--accent-rgb) / 0.18)" strokeWidth="0.75" strokeDasharray="2 2.5" />
        <circle cx="13" cy="13" r="2" fill="var(--accent)" />
      </svg>
      <svg className="orbital-spinning" width="26" height="26" viewBox="0 0 26 26" fill="none">
        <circle cx="22" cy="13" r="1.5" fill="var(--accent)" opacity="0.85" />
      </svg>
    </div>
  );
}

export default function Navbar() {
  const navRef    = useRef<HTMLElement>(null);
  const accentRef = useRef<HTMLDivElement>(null);
  const metersRef = useRef<HTMLDivElement>(null);

  useNavbarAnimation({ navRef, accentRef, metersRef });

  // On the homepage EVERY item drives the pin, because none of these sections is a place you can jump
  // to: they are overlays inside one pinned ScrollTrigger, so the href would land on the hero whichever
  // one you clicked. Off the homepage (the labs render this navbar too) the "/#key" href navigates
  // normally and the pin picks it up on arrival.
  const isHomepage = () => window.location.pathname === '/';

  // The clicked control's centre travels with the request: a jump far enough to be hidden collapses
  // into the label you pressed and unfolds out of it again, which is what gives the cover a cause
  // rather than making it a wipe. See lib/sectionJumpEvents.ts.
  const handleNavClick = (event: React.MouseEvent, key: string) => {
    if (!isHomepage()) return;
    event.preventDefault();
    requestSection(key, originOfElement(event.currentTarget));
  };

  // "Start Project" goes where a start-a-project button should: the contact form at the end.
  const handleCtaClick = (event: React.MouseEvent) => {
    if (!isHomepage()) {
      window.location.href = '/#contact';
      return;
    }
    requestSection('contact', originOfElement(event.currentTarget));
  };

  return (
    <>
      {/* Accent layer — sits behind the blended bar and renders normally, so the brand amber
          (top line, logo mark, the per-section meters) never gets inverted by
          the difference blend on .nav-root. The meters are positioned over each item by
          measurement (see useNavbarAnimation), and each fill reads the CSS var its
          section feeds. */}
      <div ref={accentRef} className="nav-accent" aria-hidden="true">
        <div className="nav-accent-line" />

        <div className="nav-accent-logo">
          <OrbitalMark />
          {/* Invisible wordmark — reserves the same width so the visible (blended)
              wordmark in .nav-root aligns with this accent mark. */}
          <span className="nav-wordmark nav-ghost">VOIDIX</span>
        </div>

        {/* One meter per section + one for the logo (home). JS sets each meter's
            left/width to sit under its item; the fill scales to --nav-progress-<key>. */}
        <div ref={metersRef} className="nav-meters">
          {METER_KEYS.map((meterKey) => (
            <span key={meterKey} className="nav-meter" data-meter={meterKey}>
              <span
                className="nav-meter-fill"
                style={{ '--meter-progress': `var(--nav-progress-${meterKey}, 0)` } as CSSProperties}
              />
            </span>
          ))}
        </div>
      </div>

      {/* Blended bar — mix-blend-mode: difference inverts all of this against whatever
          is underneath (cream hero → dark, black sections → light). */}
      <header ref={navRef} className="nav-root">

        <a href="/" className="nav-logo">
          {/* Transparent placeholder where the accent mark sits in the accent layer. */}
          <span className="nav-mark-spacer" aria-hidden="true" />
          <span className="nav-wordmark">VOIDIX</span>
        </a>

        <nav aria-label="Main navigation">
          <ul className="nav-items">
            {NAV_ITEMS.map((navItem) => (
              <li key={navItem.href} className="nav-item" data-enter={navItem.enter}>
                <a
                  href={navItem.href}
                  className="nav-link"
                  data-key={navItem.key}
                  onClick={(event) => handleNavClick(event, navItem.key)}
                >
                  <span className="nav-link-text">
                    <span className="nav-link-label">{navItem.label}</span>
                    <span className="nav-link-number">{navItem.number}</span>
                  </span>
                  <LinkArrow />
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <button className="nav-cta" type="button" onClick={handleCtaClick}>
          <span>Start Project</span>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path
              d="M1 10L10 1M10 1H3.5M10 1V7.5"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="cta-corner cta-tl" aria-hidden="true" />
          <span className="cta-corner cta-tr" aria-hidden="true" />
          <span className="cta-corner cta-bl" aria-hidden="true" />
          <span className="cta-corner cta-br" aria-hidden="true" />
        </button>

      </header>
    </>
  );
}
