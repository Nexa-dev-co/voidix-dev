'use client';

import { useRef, type CSSProperties } from 'react';
import { useNavbarAnimation } from '@/lib/hooks/useNavbarAnimation';
import { useIsNarrowViewport } from '@/lib/hooks/useIsNarrowViewport';
import { originOfElement, requestSection } from '@/lib/sectionNavigation';
import OrbitDial from './OrbitDial/OrbitDial';
import { useOrbitDial } from './OrbitDial/useOrbitDial';
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

  // ── The phone's bar ──
  // Four oversized editorial labels plus a bordered CTA need something like 480px of bar; a phone has
  // ~310px between the padding. So the bar keeps the wordmark and hands the rest to the orbit fan,
  // which opens on a tap and puts the four sections on an arc. See OrbitDial.
  const isNarrow = useIsNarrowViewport();
  const toggleRef = useRef<HTMLButtonElement>(null);

  useNavbarAnimation({ navRef, accentRef, metersRef, isNarrow });

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

  // A facet on the fan. Same journey as a nav link, but the ORIGIN passed to the jump is the TOGGLE —
  // so a covered jump's black grows out of the mark still under the visitor's thumb, rather than out of
  // a facet that is already folding away. See lib/sectionJumpEvents.ts.
  const handleStationSelect = (index: number, origin: HTMLElement) => {
    const key = NAV_ITEMS[index].key;
    if (!isHomepage()) {
      window.location.href = `/#${key}`;
      return;
    }
    requestSection(key, originOfElement(origin));
  };

  // Tap to open, tap a facet to travel. The fan owns its own open state — see useOrbitDial for why this
  // is no longer the hold-and-drag gesture it was built as.
  const fan = useOrbitDial({ toggleRef, onSelect: handleStationSelect });

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

        {/* ── The dial's own mark, phone only ──
            A miniature of the ring the dial opens into, with the journey's travelled arc drawn on it
            and the node sitting where you are. It is telemetry AND the affordance: the thing you press
            already shows you what pressing it is about.

            It lives HERE, in the un-blended accent layer, for the same reason the logo's orbital mark
            does — amber inside `.nav-root` would be inverted to blue by its difference blend. The
            control that actually takes the press is a transparent button of the same size in the bar
            above, exactly as `.nav-mark-spacer` stands in for this mark. */}
        {/* No ghost twin, unlike `.nav-accent-logo` — the button's word is out of flow, so the button's
            box is exactly this mark's size and the two line up with nothing to reserve. */}
        <span className="nav-dial-mark" data-open={fan.isOpen}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="nav-dial-track" cx="50" cy="50" r="42" />
            <circle className="nav-dial-arc" cx="50" cy="50" r="42" />
          </svg>
          <span className="nav-dial-node" />
        </span>

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

        {/* One of these, never both — the meters measure `.nav-link` labels, and two sets of them in
            the document would have it position every meter over whichever it found first. */}
        {isNarrow ? (
          /* The press target for the accent layer's mini-orbit. Transparent and exactly its size — the
             same stand-in arrangement `.nav-mark-spacer` uses for the logo's mark, and for the same
             reason: the amber has to live outside the difference blend, but the click has to live
             inside it. */
          <button
            ref={toggleRef}
            className="nav-dial-toggle"
            type="button"
            onClick={fan.toggle}
            aria-expanded={fan.isOpen}
            aria-haspopup="true"
            // The visible word is "Navigate"; this says what pressing it produces. It no longer has to
            // teach a gesture — `aria-expanded` and `aria-haspopup` already describe a tap-to-open.
            aria-label="Navigate — open the section dial"
            data-open={fan.isOpen}
          >
            {/* ⚠ OUT OF FLOW, and that is the whole point of it being here.
                As a flex sibling the word became part of the control's box: the button grew to
                ~95px, its centre moved off the mark, and since the glow ring and the pivot are both
                measured from that box, the highlight sat beside the orbit instead of around it and the
                fan swung out of thin air. Absolutely positioned, it takes no part in the box — the
                button stays exactly the mark's 1.75rem, so `getBoundingClientRect` still returns the
                mark's own centre — while still rendering beside it and still taking the press, because
                an absolutely positioned child is a child. It also removes the need for the ghost twin
                the accent layer used to carry to reserve the same width. */}
            <span className="nav-dial-label">Navigate</span>
          </button>
        ) : (
          <>
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
          </>
        )}

      </header>

      {/* The phone's navigation. Mounted only at narrow widths — nothing can open it otherwise, and an
          unmounted fan is one fewer portal on every desktop session. */}
      {isNarrow && (
        <OrbitDial
          open={fan.isOpen}
          activeIndex={fan.activeIndex}
          currentIndex={fan.currentIndex}
          pivotX={fan.pivotX}
          pivotY={fan.pivotY}
          scale={fan.scale}
          onSelect={fan.selectStation}
          onArm={fan.armStation}
          onClose={fan.close}
        />
      )}
    </>
  );
}
