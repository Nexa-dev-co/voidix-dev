'use client';

import { useState, type CSSProperties } from 'react';
import PageShell from '@/components/layout/PageShell/PageShell';
import DocSection from '@/components/layout/PageShell/DocSection';
import ClaimRow from '@/components/layout/PageShell/ClaimRow';
import PhaseTrack from '@/components/layout/PageShell/PhaseTrack';
import EnquiryButton from '@/components/ui/EnquiryButton/EnquiryButton';
import EnquiryPanel from '@/components/ui/EnquiryPanel/EnquiryPanel';
import { ABOUT_SECTIONS, type AboutContent } from './aboutContent';

/**
 * `/about` — the studio, told in the site's own language.
 *
 * A document, not a scene: native scroll, no pin, no WebGL, no GSAP. `PageShell` holds the frame and
 * the reasoning for all three.
 *
 * ⚠ Every word arrives as a prop. `app/about/page.tsx` is a Server Component that reads the admin
 * panel and resolves it against `aboutContent.ts`'s fallback, so this component never imports copy
 * and never learns which of the two it is rendering — which is what stops the two sources being
 * mixed one field at a time. `ABOUT_SECTIONS` is the exception and stays an import: it is structure
 * (anchor ids and orbit-rail stations), not copy, and the panel deliberately cannot reach it.
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
interface AboutPageProps {
  /** Resolved upstream — published copy if the panel has any, this repo's fallback if not. */
  content: AboutContent;
}

export default function AboutPage({ content }: AboutPageProps) {
  const [isEnquiryOpen, setIsEnquiryOpen] = useState(false);

  return (
    <>
      <PageShell
        eyebrow={content.eyebrow}
        title={content.title}
        lead={content.lead}
        sections={ABOUT_SECTIONS}
      >
        {/* 01 — the premise */}
        <DocSection meta={ABOUT_SECTIONS[0]}>
          <div className="doc-prose">
            {content.premiseParagraphs.map((paragraph, index) => (
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
            <p className="font-display doc-quote-text">{content.premiseQuote}</p>
          </blockquote>
        </DocSection>

        {/* 02 — the principles */}
        <DocSection meta={ABOUT_SECTIONS[1]}>
          <ul className="doc-claims">
            {content.principles.map((principle, index) => (
              <ClaimRow key={principle.index} claim={principle} order={index} />
            ))}
          </ul>
        </DocSection>

        {/* 03 — how a build runs */}
        <DocSection meta={ABOUT_SECTIONS[2]} wide>
          <PhaseTrack phases={content.buildPhases} />
        </DocSection>

        {/* 04 — the instruments */}
        <DocSection meta={ABOUT_SECTIONS[3]} wide>
          <ul className="doc-instruments">
            {content.instruments.map((instrument, index) => (
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
          <p className="doc-note">{content.instrumentsNote}</p>
        </DocSection>

        {/* 05 — the stack */}
        <DocSection meta={ABOUT_SECTIONS[4]}>
          <ul className="doc-chips">
            {content.stack.map((entry, index) => (
              <li
                key={entry}
                className="doc-chip"
                style={{ '--reveal-index': index } as CSSProperties}
              >
                {entry}
              </li>
            ))}
          </ul>
          <p className="doc-note">{content.stackNote}</p>
        </DocSection>

        {/* The close. Not a numbered section — it is the page ending rather than another thing the page
            has to say, so it carries no station on the rail. */}
        <div className="doc-close" data-reveal>
          <h2 className="font-display doc-close-title">{content.closingTitle}</h2>
          <p className="doc-close-lead">{content.closingLead}</p>
          <div className="doc-close-actions">
            <EnquiryButton label="Start a project" onClick={() => setIsEnquiryOpen(true)} />
            <a className="doc-close-link" href="/careers">
              {content.careersInvite}
              <span aria-hidden="true"> →</span>
            </a>
          </div>
        </div>
      </PageShell>

      <EnquiryPanel
        open={isEnquiryOpen}
        onClose={() => setIsEnquiryOpen(false)}
        eyebrow="Start a project"
        title={content.closingTitle}
      />
    </>
  );
}
