import type { CSSProperties } from 'react';

/**
 * A claim, then the thing that backs it up — the site's voice, rendered.
 *
 * `CLAUDE.md` states the house sentence pattern outright, and `faqEntries.ts` and `worksProjects.ts`
 * both write in it. This is that pattern as a piece of layout, used by About's principles and by
 * Careers' what-it-is-like — one component, two contents.
 *
 * ── ⚠ ROWS ON A RULE, NOT CARDS IN A GRID ────────────────────────────────────────────────────────
 * Four bordered boxes in a 2×2 is the "feature grid" the brief names as an anti-reference, and it is
 * the single easiest way to make this site look like every other studio's. Rows are also what the
 * fleet's detail, the FAQ's list and the works panel already are, so this is the site's existing
 * habit rather than a new opinion.
 */

export interface Claim {
  /** Two-digit ordinal down the left. */
  index: string;
  claim: string;
  backing: string;
}

interface ClaimRowProps {
  claim: Claim;
  /** Position in the list, for the reveal's stagger. */
  order: number;
}

export default function ClaimRow({ claim, order }: ClaimRowProps) {
  return (
    <li className="doc-claim" style={{ '--reveal-index': order } as CSSProperties}>
      <span className="doc-claim-index" aria-hidden="true">
        {claim.index}
      </span>
      <div className="doc-claim-text">
        <h3 className="font-display doc-claim-title">{claim.claim}</h3>
        <p className="doc-claim-backing">{claim.backing}</p>
      </div>
    </li>
  );
}
