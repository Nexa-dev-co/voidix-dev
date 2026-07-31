'use client';

import type { FormEvent } from 'react';
import { LOOP_REQUEST_EVENT } from '@/lib/loopEvents';
import {
  CONTACT_FOOTER_GROUPS,
  CONTACT_LEAD,
  CONTACT_TITLE,
  MODEL_ATTRIBUTION,
} from './contactContent';

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
 * ⚠ FRONT END ONLY. The form validates (natively — this project has no validation library and that is
 * deliberate) but submits nowhere. `docs/contact-black-hole-plan.md` §7b has the open question about
 * where it should post; until that is answered `handleSubmit` deliberately does nothing rather than
 * faking a success state the visitor would believe.
 */
export default function ContactSection() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    // No endpoint yet, and no backend in this project to give it one. Prevented rather than left to
    // navigate, so the page cannot be thrown out of the pin by a stray Enter key.
    event.preventDefault();
  };

  /** Ask the pin to fall into the black hole and come back out at the hero. See lib/loopEvents.ts. */
  const requestLoop = () => {
    window.dispatchEvent(new Event(LOOP_REQUEST_EVENT));
  };

  return (
    <section id="contact" className="contact-section" aria-label="Contact">
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

        <div className="contact-panel">
          {/* Native constraint validation only — `required` and `type="email"` do the work. This project
              has no validation library and CLAUDE.md is explicit that this is deliberate. */}
          <form className="contact-form" onSubmit={handleSubmit}>
            <div className="contact-field">
              <label className="contact-label" htmlFor="contact-name">
                Name
              </label>
              <input
                id="contact-name"
                name="name"
                type="text"
                className="contact-input"
                autoComplete="name"
                required
              />
            </div>

            <div className="contact-field">
              <label className="contact-label" htmlFor="contact-email">
                Email
              </label>
              <input
                id="contact-email"
                name="email"
                type="email"
                className="contact-input"
                autoComplete="email"
                required
              />
            </div>

            <div className="contact-field">
              <label className="contact-label" htmlFor="contact-brief">
                What you are building
              </label>
              <textarea
                id="contact-brief"
                name="brief"
                className="contact-input contact-textarea"
                rows={3}
                required
              />
            </div>

            <button type="submit" className="contact-send">
              Send it
            </button>
          </form>
        </div>
      </div>

      {/*
        The loop's discoverable path. The scroll gesture is the natural one — one more push past contact
        falls into the hole — and this is for everybody who would never think to try. Both dispatch the
        same request and the PIN owns the commit: a button that scrolled by itself would be a second path
        through the same cinematic, and the two would drift the first time the dive's length changed.
      */}
      <div className="contact-loop">
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
    </section>
  );
}
