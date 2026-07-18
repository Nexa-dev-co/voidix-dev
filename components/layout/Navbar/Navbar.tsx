'use client';

import { useRef, type CSSProperties } from 'react';
import { useNavbarAnimation } from '@/lib/hooks/useNavbarAnimation';
import { GOTO_SERVICES_EVENT } from '@/components/sections/ServicesDeck/deckEvents';

// `enter` drives the directional entrance (see useNavbarAnimation); `key` maps the item
// to its scroll-progress meter and the CSS var its section feeds (--nav-progress-<key>).
const NAV_ITEMS = [
  { key: 'services', number: '01', label: 'Services', href: '/#services', enter: 'top'    },
  { key: 'work',     number: '02', label: 'Work',     href: '#work',     enter: 'left'   },
  { key: 'process',  number: '03', label: 'Process',  href: '#process',  enter: 'right'  },
  { key: 'contact',  number: '04', label: 'Contact',  href: '#contact',  enter: 'bottom' },
] as const;

// The logo's meter tracks the hero ("home") section.
const HOME_METER_KEY = 'home';
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
        <circle cx="13" cy="13" r="9" stroke="rgba(0,229,255,0.18)" strokeWidth="0.75" strokeDasharray="2 2.5" />
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

  // On the homepage, "Services" drives the hero pin to the revealed fleet instead of jumping to
  // the top of the (overlay) section. Off the homepage, the href ("/#services") navigates normally.
  const handleNavClick = (event: React.MouseEvent, key: string) => {
    if (key === 'services' && window.location.pathname === '/') {
      event.preventDefault();
      window.dispatchEvent(new Event(GOTO_SERVICES_EVENT));
    }
  };

  return (
    <>
      {/* Cyan accent layer — sits behind the blended bar and renders normally, so the
          brand cyan (top line, logo mark, the per-section meters) never gets inverted by
          the difference blend on .nav-root. The meters are positioned over each item by
          measurement (see useNavbarAnimation), and each fill reads the CSS var its
          section feeds. */}
      <div ref={accentRef} className="nav-accent" aria-hidden="true">
        <div className="nav-accent-line" />

        <div className="nav-accent-logo">
          <OrbitalMark />
          {/* Invisible wordmark — reserves the same width so the visible (blended)
              wordmark in .nav-root aligns with this cyan mark. */}
          <span className="nav-wordmark nav-ghost">VOIDIX</span>
        </div>

        {/* One cyan meter per section + one for the logo (home). JS sets each meter's
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
          {/* Transparent placeholder where the cyan mark sits in the accent layer. */}
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

        <button className="nav-cta" type="button">
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
