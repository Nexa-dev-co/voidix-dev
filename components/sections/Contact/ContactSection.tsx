'use client';

import { useEffect, useRef, useState } from 'react';
import { LOOP_REQUEST_EVENT } from '@/lib/loopEvents';
import { useSectionArrival, type ArrivalGroup } from '@/lib/hooks/useSectionArrival';
import { useIsNarrowViewport } from '@/lib/hooks/useIsNarrowViewport';
import { useIsShortViewport } from '@/lib/hooks/useIsShortViewport';
import Drawer from '@/components/ui/Drawer/Drawer';
import EnquiryForm from '@/components/ui/EnquiryForm/EnquiryForm';
import {
  CONTACT_FOOTER_GROUPS,
  CONTACT_LEAD,
  CONTACT_TITLE,
  MODEL_ATTRIBUTION,
} from './contactContent';

// Hoisted out of the component: the hook holds this in a dependency array, and an array rebuilt every
// render would tear its listener down and re-add it on each one.
const ARRIVAL_GROUPS: readonly ArrivalGroup[] = [
  { selector: '.contact-intro > *', from: 'left' },
  // Only where the panel is rendered — a selector that matches nothing is a no-op, so this needs no
  // knowledge of which layout is up. Wherever the form is a sheet instead, its control is in the
  // action row below and arrives with it.
  { selector: '.contact-panel', from: 'right' },
  // The row's CHILDREN, not the row: on a phone it holds two buttons and they should come up together
  // rather than the wrapper sliding as one block. ⚠ Not also matched by the selector above, or the two
  // groups would put competing tweens on the same element.
  { selector: '.contact-loop > *', from: 'bottom' },
  { selector: '.contact-footer > *', from: 'bottom' },
];

/**
 * Contact — the last overlay in the hero's single pin.
 *
 * You leave the room by going back INTO the display, and the space you land in is the one you browsed
 * projects in: same stars, same debris, same camera angle you left it at. What has changed is what is
 * missing — the mark is gone — and the star, which dies while you are standing here. See
 * docs/contact-singularity-plan.md.
 *
 * Like every other section past the hero this is an absolutely-positioned overlay inside `.hero-section`
 * rather than a block in the page — there is exactly one pin on this site, and everything lives in it.
 * Nothing here draws a background: the black hole showing through IS the background.
 *
 * The form posts to the admin panel's inbox, through this site's own `/api/enquiry` — it is the same
 * shared `components/ui/EnquiryForm` the CTA on every service and every project opens, so there is one
 * form on this site and one endpoint behind it. See that component's header for what it sends and why
 * it never posts to the panel directly.
 *
 * ⚠ A submission lands in an INBOX, not in the leads pipeline. Somebody at the studio decides what
 * becomes a contact, which is what keeps bots and test posts out of the counts and the reports.
 */
export default function ContactSection() {
  const sectionRef = useRef<HTMLElement>(null);

  // What is drawn into place when a covered nav jump lands here.
  //
  // Every direction points at the MIDDLE of the frame, because that is where the black hole is: the
  // copy comes in from the left of it, the form from the right of it, the button and the footer up
  // from below. The layout is pulled together rather than placed, which is the only thing this
  // section's physics could reasonably say.
  //
  // The form is ONE item rather than four fields: staggering its own inputs would read as the page
  // still loading, and it is a single object beside the hole either way.
  useSectionArrival({
    sectionKey: 'contact',
    containerRef: sectionRef,
    profile: 'gravity',
    groups: ARRIVAL_GROUPS,
  });

  // ── The compact layout ──
  // The form is the single biggest object on this page, and contact is ONE pinned viewport with
  // nothing below it to scroll to. On a 360×640 phone the copy, the form, the loop button and the
  // footer together overran the frame by roughly 150px — and because the body bottom-aligns at this
  // width, the overflow went off the TOP: the section's own title sat behind the navbar, unreachable.
  // Putting the form in a sheet gives back every pixel it was taking and costs one tap.
  //
  // ⚠ TWO AXES, AND THE SECOND ONE IS NOT A PHONE. The width test above was the whole answer for as
  // long as "not enough room" meant "a phone" — but it never did. A landscape phone is 932 × 430, so
  // it clears the 820px narrow breakpoint comfortably and gets this section's full two-column desktop
  // layout, with 142px of body to put a four-field form in. It overflowed, `align-items: center` split
  // that across both ends and `.hero-section`'s `overflow: hidden` clipped it — silently, because
  // nothing here scrolls. Every short frame, phone or half-height desktop window, was in that case.
  //
  // So the question is asked on both axes and the sheet answers both. Everything else on the page
  // gives fluidly first (see the height clamps on .enquiry-form); this is for where no rhythm is
  // enough. See useIsShortViewport for why 38em and why nothing else on the site asks it.
  const isNarrow = useIsNarrowViewport();
  const isShort = useIsShortViewport();
  const isCompact = isNarrow || isShort;
  const [isFormOpen, setIsFormOpen] = useState(false);

  // A sheet with no button to reopen it is a trap, and that is what a resize past either breakpoint
  // would leave behind.
  useEffect(() => {
    if (!isCompact) setIsFormOpen(false);
  }, [isCompact]);

  /** Ask the pin to fall into the black hole and come back out at the hero. See lib/loopEvents.ts. */
  const requestLoop = () => {
    window.dispatchEvent(new Event(LOOP_REQUEST_EVENT));
  };

  return (
    <section
      ref={sectionRef}
      id="contact"
      className="contact-section"
      aria-label="Contact"
    >
      {/*
        Two columns with the middle left clear, because the middle is not empty — the black hole sits at
        the world origin, which every works camera key aims at, so it lands dead centre of frame. The
        copy goes left of it and the form right of it.
      */}
      <div className="contact-body">
        <div className="contact-intro">
          <p className="eyebrow contact-eyebrow">04 — Start a project</p>
          <h2 className="font-display contact-title">{CONTACT_TITLE}</h2>
          <p className="contact-lead">{CONTACT_LEAD}</p>
        </div>

        {/* Only where there is room for it. Wherever there is not, the form is a sheet and the control
            that opens it belongs down in the action row with the loop button rather than up here on
            its own. */}
        {!isCompact && (
          <div className="contact-panel">
            <EnquiryForm />
          </div>
        )}
      </div>

      {/*
        The loop's discoverable path. The scroll gesture is the natural one — one more push past contact
        falls into the hole — and this is for everybody who would never think to try. Both dispatch the
        same request and the PIN owns the commit: a button that scrolled by itself would be a second path
        through the same cinematic, and the two would drift the first time the dive's length changed.
      */}
      {/* On a phone this row carries BOTH actions side by side — the way into the form, and the way
          out of the site. They are the section's only two controls and they belong together; stacked,
          they read as one button that happened to grow a second one underneath it. On a wide screen the
          form is already a panel above, so this is the loop button alone, exactly as before. */}
      <div className="contact-loop">
        {isCompact && (
          <button
            type="button"
            className="drawer-open contact-open-form"
            onClick={() => setIsFormOpen(true)}
          >
            <span>Start a project</span>
          </button>
        )}

        <button type="button" className="contact-loop-button" onClick={requestLoop}>
          <span className="contact-loop-ring" aria-hidden />
          <span className="contact-loop-label">Travel in time</span>
        </button>
      </div>

      <footer className="contact-footer">
        <div className="contact-footer-brand">
          <span className="font-display contact-footer-mark">Voidix</span>
          <span className="contact-footer-note">Software with its own gravity</span>
        </div>

        <div className="contact-footer-groups">
          {CONTACT_FOOTER_GROUPS.map((group) => (
            <div className="contact-footer-group" key={group.title}>
              <p className="contact-footer-group-title">{group.title}</p>
              <ul className="contact-footer-links">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a
                      className="contact-footer-link"
                      href={link.href}
                      {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/*
          Legally required, not decorative: black_hole.glb ships under CC-BY-4.0 and the licence obliges
          attribution wherever the work appears. This section is the first place on the site that puts
          the model on screen, so it is also the first place the credit has to exist.
        */}
        <p className="contact-credit">
          {MODEL_ATTRIBUTION.prefix}
          <cite className="contact-credit-title">{MODEL_ATTRIBUTION.title}</cite> by{' '}
          {MODEL_ATTRIBUTION.author}, licensed under{' '}
          <a
            className="contact-footer-link"
            href={MODEL_ATTRIBUTION.licenceHref}
            target="_blank"
            rel="noreferrer license"
          >
            {MODEL_ATTRIBUTION.licence}
          </a>
        </p>
      </footer>

      {isCompact && (
        <Drawer
          open={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          eyebrow="04 — Start a project"
          title={CONTACT_TITLE}
        >
          <EnquiryForm />
        </Drawer>
      )}
    </section>
  );
}
