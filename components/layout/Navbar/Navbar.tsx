"use client";

import { useRef, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { useNavbarAnimation } from "@/lib/hooks/useNavbarAnimation";
import { useIsNarrowViewport } from "@/lib/hooks/useIsNarrowViewport";
import { originOfElement, requestSection } from "@/lib/sectionNavigation";
import {
  isInPageSectionRoute,
  scrollToSection,
} from "@/lib/inPageSectionRoutes";
import OrbitDial from "./OrbitDial/OrbitDial";
import { useOrbitDial } from "./OrbitDial/useOrbitDial";
import {
  HOME_METER_KEY,
  NAV_ITEMS,
  hrefForMode,
  type NavMode,
} from "./navItems";

const METER_KEYS = [HOME_METER_KEY, ...NAV_ITEMS.map((item) => item.key)];

/** Where "Start Project" goes. The same key the fourth nav item carries — one destination, one name. */
const CTA_SECTION_KEY = "contact";

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
      <svg
        className="orbital-static"
        width="26"
        height="26"
        viewBox="0 0 26 26"
        fill="none"
      >
        <circle
          cx="13"
          cy="13"
          r="9"
          stroke="rgb(var(--accent-rgb) / 0.18)"
          strokeWidth="0.75"
          strokeDasharray="2 2.5"
        />
        <circle cx="13" cy="13" r="2" fill="var(--accent)" />
      </svg>
      <svg
        className="orbital-spinning"
        width="26"
        height="26"
        viewBox="0 0 26 26"
        fill="none"
      >
        <circle cx="22" cy="13" r="1.5" fill="var(--accent)" opacity="0.85" />
      </svg>
    </div>
  );
}

export default function Navbar() {
  const navRef = useRef<HTMLElement>(null);
  const accentRef = useRef<HTMLDivElement>(null);
  const metersRef = useRef<HTMLDivElement>(null);

  // ── The phone's bar ──
  // Four oversized editorial labels plus a bordered CTA need something like 480px of bar; a phone has
  // ~310px between the padding. So the bar keeps the wordmark and hands the rest to the orbit fan,
  // which opens on a tap and puts the four sections on an arc. See OrbitDial.
  const isNarrow = useIsNarrowViewport();
  const toggleRef = useRef<HTMLButtonElement>(null);

  // ── Which route this bar is on ──
  // On the homepage EVERY item drives the pin, because none of these sections is a place you can jump
  // to: they are overlays inside one pinned ScrollTrigger, so the href would land on the hero whichever
  // one you clicked. On `/about` and `/careers` there is no pin, and the "/#key" href navigates for
  // real — the loader reads the hash and hands off to the section on the other side, without ever
  // showing the hero (see lib/arrivalSection.ts).
  //
  // ⚠ THERE IS A THIRD ANSWER NOW, AND IT IS NOT A SPECIAL CASE OF EITHER. `/lite` carries these same
  // sections as ordinary anchors, so its items neither drive a pin nor leave the page — they scroll.
  // Treating it as "not the homepage" is what made the one page built for a visitor who cannot afford
  // ten megabytes answer every nav click by fetching ten megabytes.
  //
  // ⚠ `usePathname`, not `window.location.pathname` read inside the handlers. The handlers were only
  // ever called after mount so the old read was safe, but the same answer is now needed during RENDER
  // (the meters and the hrefs below) and during the entrance effect, and neither may touch `window`.
  const pathname = usePathname();
  const isHomepage = pathname === "/";
  const mode: NavMode = isHomepage
    ? "pin"
    : isInPageSectionRoute(pathname)
      ? "in-page"
      : "navigate";

  useNavbarAnimation({ navRef, accentRef, metersRef, isNarrow, isHomepage });

  /**
   * The one place a section request is resolved, for every control on the bar.
   *
   * Returns true when the click has been handled here and the browser should not follow the href.
   * ⚠ In `in-page` mode that is conditional on the anchor actually existing — see `scrollToSection`.
   * A key renamed on one side only then falls through to `/#key` and the visitor gets the homepage's
   * version of the section, which is a downgrade rather than a control that does nothing.
   */
  const travelTo = (key: string, origin?: HTMLElement | null): boolean => {
    if (mode === "pin") {
      // The clicked control's centre travels with the request: a jump far enough to be hidden
      // collapses into the label you pressed and unfolds out of it again, which is what gives the
      // cover a cause rather than making it a wipe. See lib/sectionJumpEvents.ts.
      requestSection(key, originOfElement(origin ?? null));
      return true;
    }
    if (mode === "in-page") return scrollToSection(key);
    return false; // `navigate` — the href is the whole mechanism.
  };

  const handleNavClick = (event: React.MouseEvent, key: string) => {
    if (travelTo(key, event.currentTarget as HTMLElement)) event.preventDefault();
  };

  // A facet on the fan. Same journey as a nav link, but the ORIGIN passed to the jump is the TOGGLE —
  // so a covered jump's black grows out of the mark still under the visitor's thumb, rather than out of
  // a facet that is already folding away. See lib/sectionJumpEvents.ts.
  //
  // ⚠ THE FAN IS THE ONLY NAVIGATION BELOW 51.25em, so it gets the same three modes as the bar. It
  // used to hard-code `window.location.href = '/#key'` for everything that was not the homepage — a
  // full document load, which on `/lite` is the ten megabytes that page exists to avoid, requested by
  // the one control a phone visitor has.
  const handleStationSelect = (index: number, origin: HTMLElement) => {
    const key = NAV_ITEMS[index].key;
    if (travelTo(key, origin)) return;
    window.location.href = `/#${key}`;
  };

  // Tap to open, tap a facet to travel. The fan owns its own open state — see useOrbitDial for why this
  // is no longer the hold-and-drag gesture it was built as.
  const fan = useOrbitDial({ toggleRef, onSelect: handleStationSelect });

  // "Start Project" goes where a start-a-project button should: the contact form at the end.
  //
  // ⚠ On `/lite` that is the page's own close block, which holds the real *Start a project* button and
  // its enquiry panel — so this scrolls there rather than opening the panel over the visitor's head.
  // Deliberately a scroll: reaching into a page's local state from the shared chrome would need an
  // event and a listener, to save a tap on a control that is by then in the middle of the screen.
  const handleCtaClick = (event: React.MouseEvent) => {
    if (travelTo(CTA_SECTION_KEY, event.currentTarget as HTMLElement)) return;
    window.location.href = `/#${CTA_SECTION_KEY}`;
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
            box is exactly this mark's size and the two line up with nothing to reserve.

            ⚠ Nothing may be added beside this without a matching spacer, and vice versa: the mark is
            painted here while the button that presses it lives in `.nav-root`, so anything that
            changes one cluster's width slides the amber off its own control. That is half of why the
            motion toggle is not in the phone's bar — see the note in the bar below. */}
        <span className="nav-dial-mark" data-open={fan.isOpen}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="nav-dial-track" cx="50" cy="50" r="42" />
            <circle className="nav-dial-arc" cx="50" cy="50" r="42" />
          </svg>
          <span className="nav-dial-node" />
        </span>

        {/* One meter per section + one for the logo (home). JS sets each meter's
            left/width to sit under its item; the fill scales to --nav-progress-<key>.

            ⚠ HOMEPAGE ONLY. Every one of these is fed by `--nav-progress-<key>`, and the only writer
            of those variables is the hero pin. On a document route nobody publishes them, so this
            would render four gauge tracks pinned at zero underneath four labels — telemetry that is
            not merely idle but structurally incapable of moving. Better absent than lying. */}
        {isHomepage && (
          <div ref={metersRef} className="nav-meters">
            {METER_KEYS.map((meterKey) => (
              <span key={meterKey} className="nav-meter" data-meter={meterKey}>
                <span
                  className="nav-meter-fill"
                  style={
                    {
                      "--meter-progress": `var(--nav-progress-${meterKey}, 0)`,
                    } as CSSProperties
                  }
                />
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Blended bar — mix-blend-mode: difference inverts all of this against whatever
          is underneath (cream hero → dark, black sections → light). */}
      <header ref={navRef} className="nav-root">
        <a href="/" className="nav-logo">
          {/* Transparent placeholder where the accent mark sits in the accent layer. */}
          <span className="nav-mark-spacer" aria-hidden="true" />
          <span className="nav-wordmark">VOIDIX</span>
        </a>

        {/* The nav list is rendered at one width only — the meters measure `.nav-link` labels, and two
            sets of them in the document would have it position every meter over whichever it found
            first. */}
        {!isNarrow && (
          <nav aria-label="Main navigation">
            <ul className="nav-items">
              {NAV_ITEMS.map((navItem) => (
                <li
                  key={navItem.href}
                  className="nav-item"
                  data-enter={navItem.enter}
                >
                  <a
                    href={hrefForMode(navItem, mode)}
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
        )}

        {/* ⚠ The motion control is NOT here, and that is a decision rather than an omission. It is
            offered once, on the loader, where the visitor is already waiting and the offer lands
            before the first cinematic instead of after one has already made them feel unwell — see
            IntroSequence/MotionPrompt. Putting a copy in the bar was built and removed; if it comes
            back, note that at phone widths it moves the dial button ~48px left, and the fan's pivot
            is measured off that button, so every node on the arc goes with it (the topmost is
            already the furthest left, at −101 design units, with its label hanging further left
            still). */}
        {isNarrow ? (
          /* The press target for the accent layer's mini-orbit. Transparent and exactly its size —
             the same stand-in arrangement `.nav-mark-spacer` uses for the logo's mark, and for the
             same reason: the amber has to live outside the difference blend, but the click has to
             live inside it. */
          <button
            ref={toggleRef}
            className="nav-dial-toggle"
            type="button"
            onClick={fan.toggle}
            aria-expanded={fan.isOpen}
            aria-haspopup="true"
            // The visible word is "Navigate"; this says what pressing it produces. It no longer has
            // to teach a gesture — `aria-expanded` and `aria-haspopup` already describe a
            // tap-to-open.
            aria-label="Navigate — open the section dial"
            data-open={fan.isOpen}
          >
            {/* ⚠ OUT OF FLOW, and that is the whole point of it being here.
                As a flex sibling the word became part of the control's box: the button grew to
                ~95px, its centre moved off the mark, and since the glow ring and the pivot are both
                measured from that box, the highlight sat beside the orbit instead of around it and
                the fan swung out of thin air. Absolutely positioned, it takes no part in the box —
                the button stays exactly the mark's 1.75rem, so `getBoundingClientRect` still
                returns the mark's own centre — while still rendering beside it and still taking the
                press, because an absolutely positioned child is a child. It also removes the need
                for the ghost twin the accent layer used to carry to reserve the same width. */}
            <span className="nav-dial-label">Navigate</span>
          </button>
        ) : (
          <button className="nav-cta" type="button" onClick={handleCtaClick}>
            <span>Start Project</span>
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              aria-hidden="true"
            >
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
