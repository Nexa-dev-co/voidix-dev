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
import { CAREERS_SECTIONS, type CareerRole, type CareersContent } from './careersContent';

/**
 * What identifies a role to the open/closed state and to React's reconciler.
 *
 * ⚠ The slug when there is one, and the title only as a fallback — the two title-keyed states this
 * replaced would have merged two roles into one row the day an editor posted "Product Designer"
 * twice for two teams. The fallback roles in `careersContent.ts` carry no slug because they answer
 * to no row in the panel; within that hardcoded list the titles are unique by inspection.
 */
function roleKey(role: CareerRole): string {
  return role.slug ?? role.title;
}

/**
 * `/careers` — the openings, and what it is actually like to take one.
 *
 * Same frame as `/about` (see `PageShell`), same rules: a document on native scroll, no pin, no WebGL,
 * no GSAP.
 *
 * ⚠ Every word arrives as a prop, resolved in `app/careers/page.tsx` from the admin panel against
 * `careersContent.ts`'s fallback — including the roles, which may legitimately be an empty list. This
 * component renders whatever it is handed and never reaches for a default, which is what keeps "we
 * have nothing open" a decision the panel can actually make.
 *
 * ⚠ Applying opens the site's ONE shared form, which posts nowhere yet. That is recorded in the
 * content file's header rather than papered over — see it before shipping this page to anyone who
 * might apply.
 */
interface CareersPageProps {
  content: CareersContent;
}

export default function CareersPage({ content }: CareersPageProps) {
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

  const toggleRole = (identifier: string) => {
    setOpenRoles((current) => {
      if (current.has(identifier)) {
        const next = new Set(current);
        next.delete(identifier);
        return next;
      }
      return isNarrow ? new Set([identifier]) : new Set(current).add(identifier);
    });
  };

  const applyForRole = (role: CareerRole) => {
    // ⚠ The slug travels with the subject, not instead of it: the title is what the applicant reads
    // at the head of the form, the slug is what files the application against the right role.
    setPrefill({ subject: role.title, brief: role.briefSeed, roleSlug: role.slug });
    setIsPanelOpen(true);
  };

  const applyOpen = () => {
    setPrefill({ subject: content.openApplicationSubject, brief: content.openApplicationSeed });
    setIsPanelOpen(true);
  };

  return (
    <>
      <PageShell
        eyebrow={content.eyebrow}
        title={content.title}
        lead={content.lead}
        sections={CAREERS_SECTIONS}
      >
        {/* 01 — what it is like here */}
        <DocSection meta={CAREERS_SECTIONS[0]}>
          <ul className="doc-claims">
            {content.workingHere.map((claim, index) => (
              <ClaimRow key={claim.index} claim={claim} order={index} />
            ))}
          </ul>
        </DocSection>

        {/* 02 — the roles. An empty list gets an honest sentence pointing at the open application,
            not a heading floating over nothing — the panel can publish no roles at all, so this
            state is one the page must be able to stand in. */}
        <DocSection meta={CAREERS_SECTIONS[1]} wide>
          {content.roles.length === 0 ? (
            <p className="doc-roles-empty">
              {content.rolesEmptyLine}{' '}
              <a className="doc-close-link" href={`#${CAREERS_SECTIONS[3].key}`}>
                {content.rolesEmptyInvite}
                <span aria-hidden="true"> →</span>
              </a>
            </p>
          ) : (
            <ul className="doc-roles">
              {content.roles.map((role, index) => (
                <RoleRow
                  key={roleKey(role)}
                  role={role}
                  order={index}
                  open={openRoles.has(roleKey(role))}
                  onToggle={() => toggleRole(roleKey(role))}
                  onApply={() => applyForRole(role)}
                />
              ))}
            </ul>
          )}
        </DocSection>

        {/* 03 — how hiring runs */}
        <DocSection meta={CAREERS_SECTIONS[2]} wide>
          <PhaseTrack phases={content.hiringPhases} />
        </DocSection>

        {/* 04 — the open application */}
        <DocSection meta={CAREERS_SECTIONS[3]}>
          <div className="doc-open-application">
            <h3 className="font-display doc-close-title">{content.openApplicationTitle}</h3>
            <p className="doc-close-lead">{content.openApplicationLead}</p>
            <div
              className="doc-close-actions"
              style={{ '--reveal-index': 1 } as CSSProperties}
            >
              {/* The one press this whole document exists to produce — see EnquiryButton on `hot`. */}
              <EnquiryButton label="Write to us" onClick={applyOpen} tone="hot" />
              <a className="doc-close-link" href="/about">
                {content.aboutInvite}
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
        title={prefill?.subject ?? content.openApplicationSubject}
        prefill={prefill ?? undefined}
        briefLabel={content.applicationBriefLabel}
        submitLabel={content.applicationSubmitLabel}
        variant="application"
        // Only the OPEN application is asked what shape of work it wants — every posted role has
        // already stated its own terms in the row it was opened from.
        commitmentOptions={
          prefill?.subject === content.openApplicationSubject
            ? content.commitmentOptions
            : undefined
        }
        commitmentLabel={content.commitmentLabel}
      />
    </>
  );
}
