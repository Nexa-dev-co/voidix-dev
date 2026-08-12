'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import PageShell from '@/components/layout/PageShell/PageShell';
import DocSection from '@/components/layout/PageShell/DocSection';
import ClaimRow from '@/components/layout/PageShell/ClaimRow';
import PhaseTrack from '@/components/layout/PageShell/PhaseTrack';
import EnquiryButton from '@/components/ui/EnquiryButton/EnquiryButton';
import EnquiryPanel from '@/components/ui/EnquiryPanel/EnquiryPanel';
import { useIsNarrowViewport } from '@/lib/hooks/useIsNarrowViewport';
import type { EnquiryPrefill } from '@/lib/enquirySubjects';
import RoleRow from './RoleRow';
import {
  APPLICATION_BRIEF_LABEL,
  APPLICATION_SUBMIT_LABEL,
  CAREERS_ABOUT_INVITE,
  CAREERS_EYEBROW,
  CAREERS_LEAD,
  CAREERS_SECTIONS,
  CAREERS_TITLE,
  CAREER_ROLES,
  HIRING_PHASES,
  OPEN_APPLICATION_LEAD,
  OPEN_APPLICATION_COMMITMENTS,
  OPEN_APPLICATION_COMMITMENT_LABEL,
  OPEN_APPLICATION_SEED,
  OPEN_APPLICATION_SUBJECT,
  OPEN_APPLICATION_TITLE,
  ROLES_EMPTY_INVITE,
  ROLES_EMPTY_LINE,
  WORKING_HERE,
} from './careersContent';

/**
 * `/careers` — the openings, and what it is actually like to take one.
 *
 * Same frame as `/about` (see `PageShell`), same rules: a document on native scroll, no pin, no WebGL,
 * no GSAP. Every word is in `careersContent.ts`, including the ⚠ that all four roles are mock data.
 *
 * ⚠ Applying opens the site's ONE shared form, which posts nowhere. That is recorded in the content
 * file's header rather than papered over — see it before shipping this page to anyone who might apply.
 */
export default function CareersPage() {
  // ── Which roles are open ──
  // A Set rather than an index, because on a wide screen any number may be open at once — comparing two
  // roles is the thing a person actually does here, and closing one to read another would make that
  // impossible.
  const [openRoles, setOpenRoles] = useState<ReadonlySet<string>>(new Set());
  const [prefill, setPrefill] = useState<EnquiryPrefill | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // ⚠ On a phone it behaves as an accordion instead: four roles open at once is a ~4,000px column with
  // no way back to the top of it, and the comparison the multi-open exists to allow is impossible on a
  // screen that fits one and a half of them anyway.
  const isNarrow = useIsNarrowViewport();

  // Dragging a window narrow with three roles open would land in exactly the state the accordion exists
  // to prevent. Keep the most recently opened one and close the rest — a Set iterates in insertion
  // order, so the last entry is the role the visitor touched last.
  useEffect(() => {
    if (!isNarrow) return;
    setOpenRoles((current) => {
      if (current.size <= 1) return current;
      const mostRecentlyOpened = Array.from(current).pop();
      return new Set(mostRecentlyOpened ? [mostRecentlyOpened] : []);
    });
  }, [isNarrow]);

  const toggleRole = (roleTitle: string) => {
    setOpenRoles((current) => {
      if (current.has(roleTitle)) {
        const next = new Set(current);
        next.delete(roleTitle);
        return next;
      }
      return isNarrow ? new Set([roleTitle]) : new Set(current).add(roleTitle);
    });
  };

  const applyForRole = (roleTitle: string, briefSeed: string) => {
    setPrefill({ subject: roleTitle, brief: briefSeed });
    setIsPanelOpen(true);
  };

  const applyOpen = () => {
    setPrefill({ subject: OPEN_APPLICATION_SUBJECT, brief: OPEN_APPLICATION_SEED });
    setIsPanelOpen(true);
  };

  return (
    <>
      <PageShell
        eyebrow={CAREERS_EYEBROW}
        title={CAREERS_TITLE}
        lead={CAREERS_LEAD}
        sections={CAREERS_SECTIONS}
      >
        {/* 01 — what it is like here */}
        <DocSection meta={CAREERS_SECTIONS[0]}>
          <ul className="doc-claims">
            {WORKING_HERE.map((claim, index) => (
              <ClaimRow key={claim.index} claim={claim} order={index} />
            ))}
          </ul>
        </DocSection>

        {/* 02 — the roles. An empty list gets an honest sentence pointing at the open application,
            not a heading floating over nothing — the content file's own header says the mock roles
            may simply be cut, so this state is one the page must be able to stand in. */}
        <DocSection meta={CAREERS_SECTIONS[1]} wide>
          {CAREER_ROLES.length === 0 ? (
            <p className="doc-roles-empty">
              {ROLES_EMPTY_LINE}{' '}
              <a className="doc-close-link" href={`#${CAREERS_SECTIONS[3].key}`}>
                {ROLES_EMPTY_INVITE}
                <span aria-hidden="true"> →</span>
              </a>
            </p>
          ) : (
            <ul className="doc-roles">
              {CAREER_ROLES.map((role, index) => (
                <RoleRow
                  key={role.title}
                  role={role}
                  order={index}
                  open={openRoles.has(role.title)}
                  onToggle={() => toggleRole(role.title)}
                  onApply={() => applyForRole(role.title, role.briefSeed)}
                />
              ))}
            </ul>
          )}
        </DocSection>

        {/* 03 — how hiring runs */}
        <DocSection meta={CAREERS_SECTIONS[2]} wide>
          <PhaseTrack phases={HIRING_PHASES} />
        </DocSection>

        {/* 04 — the open application */}
        <DocSection meta={CAREERS_SECTIONS[3]}>
          <div className="doc-open-application">
            <h3 className="font-display doc-close-title">{OPEN_APPLICATION_TITLE}</h3>
            <p className="doc-close-lead">{OPEN_APPLICATION_LEAD}</p>
            <div
              className="doc-close-actions"
              style={{ '--reveal-index': 1 } as CSSProperties}
            >
              {/* The one press this whole document exists to produce — see EnquiryButton on `hot`. */}
              <EnquiryButton label="Write to us" onClick={applyOpen} tone="hot" />
              <a className="doc-close-link" href="/about">
                {CAREERS_ABOUT_INVITE}
                <span aria-hidden="true"> →</span>
              </a>
            </div>
          </div>
        </DocSection>
      </PageShell>

      <EnquiryPanel
        open={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        eyebrow="Careers — Voidix"
        title={prefill?.subject ?? OPEN_APPLICATION_SUBJECT}
        prefill={prefill ?? undefined}
        briefLabel={APPLICATION_BRIEF_LABEL}
        submitLabel={APPLICATION_SUBMIT_LABEL}
        variant="application"
        // Only the OPEN application is asked what shape of work it wants — every posted role has
        // already stated its own terms in the row it was opened from.
        commitmentOptions={
          prefill?.subject === OPEN_APPLICATION_SUBJECT ? OPEN_APPLICATION_COMMITMENTS : undefined
        }
        commitmentLabel={OPEN_APPLICATION_COMMITMENT_LABEL}
      />
    </>
  );
}
