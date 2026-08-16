'use client';

import { useState, type CSSProperties } from 'react';
import PageShell from '@/components/layout/PageShell/PageShell';
import DocSection from '@/components/layout/PageShell/DocSection';
import EnquiryButton from '@/components/ui/EnquiryButton/EnquiryButton';
import EnquiryPanel from '@/components/ui/EnquiryPanel/EnquiryPanel';
import { useSiteContent, useSiteSections } from '@/lib/cms/SiteContentProvider';
import { buildEnquiryPrefill, type EnquiryPrefill } from '@/lib/enquirySubjects';
import {
  LITE_CLOSE_ANCHOR,
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
 *
 * ── ⚠ IT CARRIES THE SCENE'S CALLS TO ACTION TOO, AND IT DID NOT USED TO ─────────────────────────
 * "The same services, work and answers" was true of the WORDS and false of the OFFERS. On the homepage
 * every craft and every project has its own CTA, and pressing it opens an enquiry that already knows
 * which discipline — and, for a project, which project — it came from. This page had one generic
 * button at the very bottom, so a visitor who had just read about Enterprise Platforms had to scroll
 * past everything else to say so, and then say it from scratch.
 *
 * That is the conversion path, and it is the one thing a text fallback least affords to drop: the
 * visitor who ends up here is on a connection that could not carry the site, which makes them MORE
 * likely to leave before reaching the bottom, not less. Every row offers the same prefilled enquiry
 * the scene does now. Only the presentation is the document's — see `ClaimAction`.
 */

/** Everything the one panel needs, handed to it by whichever row was pressed. */
interface LiteEnquiry {
  eyebrow: string;
  title: string;
  prefill?: EnquiryPrefill;
  briefLabel?: string;
  submitLabel?: string;
}

/**
 * The close's own enquiry, and the panel's resting content.
 *
 * No `prefill`: this page is the whole studio rather than one craft or project, so there is no subject
 * to carry. Same reasoning as About's.
 */
const WHOLE_STUDIO_ENQUIRY: LiteEnquiry = {
  eyebrow: 'Start a project',
  title: LITE_CLOSING_TITLE,
};

// ⚠ THE SAME WORDS THE SCENE USES, and that is the whole point of listing them here. `Start this
// build` is what the fleet's button says over a craft; `Start one like this` is what the field's says
// over a project; `Ask us anything` is how the chamber's hologram ends. A visitor who has seen the
// homepage and then falls back to this one should meet the same offers, phrased the same way — and a
// second set of verbs invented for the text version would be the page quietly becoming a different
// site rather than the same one without the download.
const SERVICE_ACTION_LABEL = 'Start this build';
const PROJECT_ACTION_LABEL = 'Start one like this';
const ASK_ACTION_LABEL = 'Ask us anything';

/**
 * A row's own call to action.
 *
 * ── ⚠ NOT `EnquiryButton`, AND THE REASON IS THE MEDIUM ──────────────────────────────────────────
 * The homepage shows ONE craft at a time, so its amber pill is one pill on screen. This page shows all
 * four at once, then four projects, then the questions — eight or nine pills stacked down a column of
 * prose, which is both louder than the homepage ever is and precisely the "feature grid with buttons"
 * the brief names as an anti-reference. `EnquiryButton`'s own header says it: keep it rare, because two
 * destinations on one screen is none.
 *
 * So the offer is the same and the register is the document's — a quiet action in the row's own voice,
 * which lights with the row on hover exactly as `.doc-claim`'s edge does. The page keeps ONE pill, at
 * the close, where the CSS already calls it "the one control the document exists to produce".
 */
function ClaimAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="doc-claim-action" onClick={onClick}>
      <span>{label}</span>
      <span className="doc-claim-action-glyph" aria-hidden="true">
        <svg width="15" height="10" viewBox="0 0 15 10" fill="none">
          <path
            d="M1 5h12M9.5 1.5L13 5l-3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

export default function LitePage() {
  // ⚠ The same three lists the homepage renders, from the same resolve — not a second copy. This page
  // re-presents the site's words; it does not restate them. See `liteContent.ts`.
  const { services, projects, faq } = useSiteSections();
  // The same vocabulary the fleet's and the field's CTAs build their prefill from — so a lead that
  // arrives from here is indistinguishable from one that arrived from the scene. See buildEnquiryPrefill.
  const { disciplines, enquiryForm } = useSiteContent();

  // ── ⚠ TWO PIECES OF STATE, NOT ONE, AND THE SECOND IS WHY ────────────────────────────────────
  // `enquiry` holds WHAT the panel is showing and `isOpen` holds WHETHER it is showing. Collapsing
  // them into one nullable would empty the panel on the frame it is asked to close — and the panel
  // animates out, so what the visitor would watch is the eyebrow and the title vanishing before the
  // sheet does. Closing therefore only ever writes `isOpen`.
  const [enquiry, setEnquiry] = useState<LiteEnquiry>(WHOLE_STUDIO_ENQUIRY);
  const [isEnquiryOpen, setIsEnquiryOpen] = useState(false);
  const openEnquiry = (next: LiteEnquiry) => {
    setEnquiry(next);
    setIsEnquiryOpen(true);
  };

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
            {services.map((service, index) => (
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
                  {/* The craft's own CTA, as the fleet has it. The enquiry arrives already knowing
                      which discipline it was opened from — the same prefill the ship's button builds. */}
                  <ClaimAction
                    label={SERVICE_ACTION_LABEL}
                    onClick={() =>
                      openEnquiry({
                        eyebrow: `${service.index} — ${service.name}`,
                        title: SERVICE_ACTION_LABEL,
                        prefill: buildEnquiryPrefill({
                          discipline: service.discipline,
                          disciplines,
                          referenceSubjectSuffix: enquiryForm.referenceSubjectSuffix,
                          referenceBriefPrefix: enquiryForm.referenceBriefPrefix,
                        }),
                      })
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </DocSection>

        {/* 02 — selected work. The field, without the field. */}
        <DocSection meta={LITE_SECTIONS[1]}>
          <ul className="doc-claims">
            {projects.map((project, index) => (
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
                  {/* ⚠ `reference` is what makes this different from the service's above: the brief
                      LEADS with the project rather than replacing the discipline's seed — "this kind
                      of work, in the orbit of that one". Exactly what the field's CTA carries. */}
                  <ClaimAction
                    label={PROJECT_ACTION_LABEL}
                    onClick={() =>
                      openEnquiry({
                        eyebrow: `${project.index} — ${project.title}`,
                        title: PROJECT_ACTION_LABEL,
                        prefill: buildEnquiryPrefill({
                          discipline: project.discipline,
                          disciplines,
                          referenceSubjectSuffix: enquiryForm.referenceSubjectSuffix,
                          referenceBriefPrefix: enquiryForm.referenceBriefPrefix,
                          reference: project.title,
                        }),
                      })
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </DocSection>

        {/* 03 — questions. The chamber's hologram, as a list. */}
        <DocSection meta={LITE_SECTIONS[2]}>
          <ul className="doc-claims">
            {faq.map((entry, index) => (
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

          {/* ⚠ ONE action for the whole list, not one per question — which is how the chamber's
              hologram ends too. A question you have already been answered needs no button; what needs
              one is the question that was not on the list. No prefill for the same reason the chamber
              gives: what the visitor is about to type IS the subject. */}
          <div className="doc-claims-action">
            <ClaimAction
              label={ASK_ACTION_LABEL}
              onClick={() =>
                openEnquiry({
                  eyebrow: `${LITE_SECTIONS[2].number} — ${LITE_SECTIONS[2].title}`,
                  title: ASK_ACTION_LABEL,
                  briefLabel: 'Your question',
                  submitLabel: 'Send the question',
                })
              }
            />
          </div>
        </DocSection>

        {/* The close. Not a numbered section — it is the page ending rather than another thing the
            page has to say, so it carries no station on the rail. Same rule as About.

            ⚠ It DOES carry an anchor, and only on this page: it is where the navbar's `04 Contact`
            and its CTA land, because this page has no contact section and the button below is the
            thing they were both asking for. An id without a rail station is exactly the right shape
            for that — reachable, unnumbered. See LITE_CLOSE_ANCHOR. */}
        <div className="doc-close" id={LITE_CLOSE_ANCHOR} data-reveal>
          <h2 className="font-display doc-close-title">{LITE_CLOSING_TITLE}</h2>
          <p className="doc-close-lead">{LITE_CLOSING_LEAD}</p>
          <div className="doc-close-actions">
            {/* The page's ONE pill — see ClaimAction for why every other offer on it is quieter. */}
            <EnquiryButton
              label="Start a project"
              onClick={() => openEnquiry(WHOLE_STUDIO_ENQUIRY)}
            />
            {/* ⚠ A plain link, so it is a real navigation and the homepage loads from scratch — which
                is exactly what someone choosing this is asking for the option of. */}
            <a className="doc-close-link" href="/">
              {LITE_FULL_SITE_INVITE}
              <span aria-hidden="true"> →</span>
            </a>
          </div>
        </div>
      </PageShell>

      {/* ⚠ ONE panel for every offer on the page, not one per row. Nine mounted dialogs — each with
          its own form state, its own scroll guard and its own portal — to show one at a time is nine
          times the machinery for no behaviour. Whichever action was pressed hands its contents in.
          `EnquiryPanel` keys the form on the prefill's subject, so moving between rows starts a clean
          form rather than one holding the last craft's sentence. */}
      <EnquiryPanel
        open={isEnquiryOpen}
        onClose={() => setIsEnquiryOpen(false)}
        eyebrow={enquiry.eyebrow}
        title={enquiry.title}
        prefill={enquiry.prefill}
        briefLabel={enquiry.briefLabel}
        submitLabel={enquiry.submitLabel}
      />
    </>
  );
}
