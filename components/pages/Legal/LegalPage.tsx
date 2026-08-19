import type { CSSProperties, ReactNode } from 'react';
import PageShell from '@/components/layout/PageShell/PageShell';
import DocSection from '@/components/layout/PageShell/DocSection';
import { railSectionsOf, type LegalDocument } from './legalDocument';

/**
 * `/privacy` and `/terms` — the same frame the studio's other documents use, carrying the two pages
 * that have to be exact rather than persuasive.
 *
 * ── ⚠ THIS IS A SERVER COMPONENT, AND THAT IS THE ONE DELIBERATE DIFFERENCE FROM `AboutPage` ─────
 * Those two carry `'use client'` because each holds the enquiry panel's open/closed state. Nothing on
 * a legal page is interactive — there is no form, no disclosure, no panel — so this renders on the
 * server and ships no component JavaScript of its own. `PageShell` below is still a client component
 * and still runs the reveal; that boundary is where it belongs and this side of it stays free.
 *
 * ⚠ There is deliberately NO enquiry button here. Every other document page closes on one, because
 * every other document page is trying to start a conversation. These close on an address to write to
 * for a specific legal purpose, and putting "Start a project" under a privacy policy would be the
 * site selling to somebody who came to exercise a right.
 */
interface LegalPageProps {
  document: LegalDocument;
  /**
   * An interactive block rendered after the last section, before the close.
   *
   * ⚠ It exists for exactly one thing: the consent control on `/privacy`. A privacy notice that
   * describes a choice has to be the place the choice can be changed, or the sentence promising it is
   * false — and `/terms` has no such control, so this is optional rather than part of the document
   * shape. Keeping it a prop rather than a flag on `LegalDocument` is what stops a content file
   * having an opinion about React.
   */
  aside?: ReactNode;
}

export default function LegalPage({ document, aside }: LegalPageProps) {
  return (
    <PageShell
      eyebrow={document.eyebrow}
      title={document.title}
      lead={document.lead}
      sections={railSectionsOf(document)}
    >
      {/* The stamp sits above the first section rather than in the masthead: the masthead is the
          page's title block and a review date is metadata about the text, not part of it. */}
      <p className="doc-stamp" data-reveal>
        Last reviewed <time dateTime={document.lastReviewed}>{document.lastReviewed}</time>
      </p>

      {document.sections.map((section) => (
        <DocSection key={section.meta.key} meta={section.meta}>
          <div className="doc-prose">
            {section.paragraphs.map((paragraph, index) => (
              <p
                key={paragraph.slice(0, 32)}
                className="doc-paragraph"
                style={{ '--reveal-index': index } as CSSProperties}
              >
                {paragraph}
              </p>
            ))}
          </div>

          {section.points ? (
            <ul className="doc-ledger">
              {section.points.map((point, index) => (
                <li
                  key={point.term ?? point.detail.slice(0, 32)}
                  className="doc-ledger-row"
                  style={{ '--reveal-index': index } as CSSProperties}
                >
                  {point.term ? (
                    <span className="font-display doc-ledger-term">{point.term}</span>
                  ) : null}
                  <span className="doc-ledger-detail">{point.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {section.note ? <p className="doc-note">{section.note}</p> : null}
        </DocSection>
      ))}

      {aside ? <div data-reveal>{aside}</div> : null}

      {/* The close. Not a numbered section — it is the page ending rather than another thing the page
          has to say, so it carries no station on the rail. Same reasoning as About's. */}
      <div className="doc-close" data-reveal>
        <h2 className="font-display doc-close-title">{document.closingTitle}</h2>
        <p className="doc-close-lead">{document.closingLead}</p>
      </div>
    </PageShell>
  );
}
