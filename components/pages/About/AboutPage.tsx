'use client';

import { useState, type CSSProperties } from 'react';
import PageShell from '@/components/layout/PageShell/PageShell';
import DocSection from '@/components/layout/PageShell/DocSection';
import ClaimRow from '@/components/layout/PageShell/ClaimRow';
import PhaseTrack from '@/components/layout/PageShell/PhaseTrack';
import EnquiryButton from '@/components/ui/EnquiryButton/EnquiryButton';
import EnquiryPanel from '@/components/ui/EnquiryPanel/EnquiryPanel';
import {
  ABOUT_CAREERS_INVITE,
  ABOUT_CLOSING_LEAD,
  ABOUT_CLOSING_TITLE,
  ABOUT_EYEBROW,
  ABOUT_LEAD,
  ABOUT_SECTIONS,
  ABOUT_TITLE,
  BUILD_PHASES,
  INSTRUMENTS,
  INSTRUMENTS_NOTE,
  PREMISE_PARAGRAPHS,
  PREMISE_QUOTE,
  PRINCIPLES,
  STACK,
  STACK_NOTE,
} from './aboutContent';

/**
 * `/about` — the studio, told in the site's own language.
 *
 * A document, not a scene: native scroll, no pin, no WebGL, no GSAP. `PageShell` holds the frame and
 * the reasoning for all three; every word is in `aboutContent.ts`.
 *
 * The one piece of state here is the enquiry panel, and it opens the SAME shared form the fleet, the
 * field and the contact section open — dialog on a desktop, bottom sheet on a phone, decided by
 * `useIsNarrowViewport` inside `EnquiryPanel`. There is no second contact form on this site and this
 * page does not add one.
 *
 * ⚠ No `prefill`. Every other opener carries the thing you were looking at — a craft, a project, a
 * discipline. This one is opened from a page ABOUT the studio, so there is no subject to carry, and
 * the panel's `prefill` is optional for exactly that case (the chamber's "ask us anything" is the
 * other). Inventing one would put a discipline in the subject line the visitor never chose.
 */
export default function AboutPage() {
  const [isEnquiryOpen, setIsEnquiryOpen] = useState(false);

  return (
    <>
      <PageShell
        eyebrow={ABOUT_EYEBROW}
        title={ABOUT_TITLE}
        lead={ABOUT_LEAD}
        sections={ABOUT_SECTIONS}
      >
        {/* 01 — the premise */}
        <DocSection meta={ABOUT_SECTIONS[0]}>
          <div className="doc-prose">
            {PREMISE_PARAGRAPHS.map((paragraph, index) => (
              <p
                key={paragraph.slice(0, 24)}
                className="doc-paragraph"
                style={{ '--reveal-index': index } as CSSProperties}
              >
                {paragraph}
              </p>
            ))}
          </div>

          {/* Breaks the rule between the columns rather than sitting under them — a pull quote that
              follows the prose is just a bigger sentence. */}
          <blockquote className="doc-quote">
            <p className="font-display doc-quote-text">{PREMISE_QUOTE}</p>
          </blockquote>
        </DocSection>

        {/* 02 — the principles */}
        <DocSection meta={ABOUT_SECTIONS[1]}>
          <ul className="doc-claims">
            {PRINCIPLES.map((principle, index) => (
              <ClaimRow key={principle.index} claim={principle} order={index} />
            ))}
          </ul>
        </DocSection>

        {/* 03 — how a build runs */}
        <DocSection meta={ABOUT_SECTIONS[2]} wide>
          <PhaseTrack phases={BUILD_PHASES} />
        </DocSection>

        {/* 04 — the instruments */}
        <DocSection meta={ABOUT_SECTIONS[3]} wide>
          <ul className="doc-instruments">
            {INSTRUMENTS.map((instrument, index) => (
              <li
                key={instrument.label}
                className="doc-instrument"
                style={{ '--reveal-index': index } as CSSProperties}
              >
                <p className="doc-instrument-label">{instrument.label}</p>
                <p className="font-display doc-instrument-value">{instrument.value}</p>
              </li>
            ))}
          </ul>
          <p className="doc-note">{INSTRUMENTS_NOTE}</p>
        </DocSection>

        {/* 05 — the stack */}
        <DocSection meta={ABOUT_SECTIONS[4]}>
          <ul className="doc-chips">
            {STACK.map((entry, index) => (
              <li
                key={entry}
                className="doc-chip"
                style={{ '--reveal-index': index } as CSSProperties}
              >
                {entry}
              </li>
            ))}
          </ul>
          <p className="doc-note">{STACK_NOTE}</p>
        </DocSection>

        {/* The close. Not a numbered section — it is the page ending rather than another thing the page
            has to say, so it carries no station on the rail. */}
        <div className="doc-close" data-reveal>
          <h2 className="font-display doc-close-title">{ABOUT_CLOSING_TITLE}</h2>
          <p className="doc-close-lead">{ABOUT_CLOSING_LEAD}</p>
          <div className="doc-close-actions">
            <EnquiryButton label="Start a project" onClick={() => setIsEnquiryOpen(true)} />
            <a className="doc-close-link" href="/careers">
              {ABOUT_CAREERS_INVITE}
              <span aria-hidden="true"> →</span>
            </a>
          </div>
        </div>
      </PageShell>

      <EnquiryPanel
        open={isEnquiryOpen}
        onClose={() => setIsEnquiryOpen(false)}
        eyebrow="Start a project"
        title={ABOUT_CLOSING_TITLE}
      />
    </>
  );
}
