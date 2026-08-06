'use client';

import { useState, type CSSProperties } from 'react';
import PageShell from '@/components/layout/PageShell/PageShell';
import DocSection from '@/components/layout/PageShell/DocSection';
import EnquiryButton from '@/components/ui/EnquiryButton/EnquiryButton';
import EnquiryPanel from '@/components/ui/EnquiryPanel/EnquiryPanel';
import { DECK_SERVICES } from '@/components/sections/ServicesDeck/deckServices';
import { WORKS_PROJECTS } from '@/components/sections/WorksField/worksProjects';
import { FAQ_ENTRIES } from '@/components/sections/Chamber/faqEntries';
import {
  LITE_CLOSING_LEAD,
  LITE_CLOSING_TITLE,
  LITE_EYEBROW,
  LITE_FULL_SITE_INVITE,
  LITE_LEAD,
  LITE_SECTIONS,
  LITE_TITLE,
} from './liteContent';

/**
 * `/lite` — the site for a connection that will not carry the site.
 *
 * ── Why it exists ────────────────────────────────────────────────────────────────────────────────
 * The homepage's gate waits on ~10 MB of models before it opens, and on a weak connection that is a
 * minute of loader for a visitor who may only want to know what the studio does. This is the way out:
 * the same services, work and answers, as a document.
 *
 * ── ⚠ IT REUSES `PageShell`, AND THAT IS THE POINT ───────────────────────────────────────────────
 * `/about` and `/careers` already established the document route — native scroll, no pin, no WebGL,
 * no animation library. Building a third frame for this would mean a third set of type, spacing and
 * responsive rules to keep in step with the other two. Every class on this page already exists; the
 * route adds no CSS at all.
 *
 * ⚠ And it re-presents the homepage's OWN content files rather than restating them. See
 * `liteContent.ts` — the only new words here are the masthead and the close.
 *
 * ⚠ `.doc-claim` markup is written out rather than using `ClaimRow`, because each list here carries
 * something that component has no slot for: capabilities, a client and year, or several paragraphs of
 * answer. Same classes, same result, one extra child.
 */
export default function LitePage() {
  const [isEnquiryOpen, setIsEnquiryOpen] = useState(false);

  return (
    <>
      <PageShell
        eyebrow={LITE_EYEBROW}
        title={LITE_TITLE}
        lead={LITE_LEAD}
        sections={LITE_SECTIONS}
      >
        {/* 01 — what we build. The fleet, without the fleet. */}
        <DocSection meta={LITE_SECTIONS[0]}>
          <ul className="doc-claims">
            {DECK_SERVICES.map((service, index) => (
              <li
                key={service.index}
                className="doc-claim"
                style={{ '--reveal-index': index } as CSSProperties}
              >
                <span className="doc-claim-index" aria-hidden="true">
                  {service.index}
                </span>
                <div className="doc-claim-text">
                  <h3 className="font-display doc-claim-title">{service.name}</h3>
                  <p className="doc-claim-backing">{service.description}</p>
                  <ul className="doc-chips doc-chips--quiet">
                    {service.capabilities.map((capability) => (
                      <li key={capability} className="doc-chip">
                        {capability}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </DocSection>

        {/* 02 — selected work. The field, without the field. */}
        <DocSection meta={LITE_SECTIONS[1]}>
          <ul className="doc-claims">
            {WORKS_PROJECTS.map((project, index) => (
              <li
                key={project.index}
                className="doc-claim"
                style={{ '--reveal-index': index } as CSSProperties}
              >
                <span className="doc-claim-index" aria-hidden="true">
                  {project.index}
                </span>
                <div className="doc-claim-text">
                  <h3 className="font-display doc-claim-title">{project.title}</h3>
                  <p className="doc-note">
                    {project.client}
                    <span aria-hidden="true"> · </span>
                    {project.year}
                  </p>
                  <p className="doc-claim-backing">{project.description}</p>
                  <ul className="doc-chips doc-chips--quiet">
                    {project.tags.map((tag) => (
                      <li key={tag} className="doc-chip">
                        {tag}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </DocSection>

        {/* 03 — questions. The chamber's hologram, as a list. */}
        <DocSection meta={LITE_SECTIONS[2]}>
          <ul className="doc-claims">
            {FAQ_ENTRIES.map((entry, index) => (
              <li
                key={entry.index}
                className="doc-claim"
                style={{ '--reveal-index': index } as CSSProperties}
              >
                <span className="doc-claim-index" aria-hidden="true">
                  {entry.index}
                </span>
                <div className="doc-claim-text">
                  <h3 className="font-display doc-claim-title">{entry.question}</h3>
                  {entry.answer.map((paragraph) => (
                    <p key={paragraph.slice(0, 24)} className="doc-claim-backing">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </DocSection>

        {/* The close. Not a numbered section — it is the page ending rather than another thing the
            page has to say, so it carries no station on the rail. Same rule as About. */}
        <div className="doc-close" data-reveal>
          <h2 className="font-display doc-close-title">{LITE_CLOSING_TITLE}</h2>
          <p className="doc-close-lead">{LITE_CLOSING_LEAD}</p>
          <div className="doc-close-actions">
            <EnquiryButton label="Start a project" onClick={() => setIsEnquiryOpen(true)} />
            {/* ⚠ A plain link, so it is a real navigation and the homepage loads from scratch — which
                is exactly what someone choosing this is asking for the option of. */}
            <a className="doc-close-link" href="/">
              {LITE_FULL_SITE_INVITE}
              <span aria-hidden="true"> →</span>
            </a>
          </div>
        </div>
      </PageShell>

      {/* No `prefill`: this page is the whole studio rather than one craft or project, so there is no
          subject to carry. Same reasoning as About's. */}
      <EnquiryPanel
        open={isEnquiryOpen}
        onClose={() => setIsEnquiryOpen(false)}
        eyebrow="Start a project"
        title={LITE_CLOSING_TITLE}
      />
    </>
  );
}
