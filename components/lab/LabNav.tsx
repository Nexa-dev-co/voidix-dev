'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MARK_TRANSITIONS } from '@/components/sections/WorksField/transitions/transitionCatalog';

/**
 * Moving between the labs.
 *
 * Every candidate transition is its own route, so this is the whole navigation: the letter lab, then
 * one entry per candidate. Unbuilt ones are shown disabled rather than hidden, so the shape of the
 * comparison is visible before it is finished — and so it stays obvious how many questions are still
 * open.
 *
 * Fixed top-right because that is the one corner both labs leave free: the letter lab puts its panel
 * on the left and its stepper centre-bottom.
 */

const PILL = 'rounded-full px-3 py-1 text-[0.6rem] uppercase tracking-eyebrow transition-colors';

export default function LabNav() {
  const pathname = usePathname();

  return (
    <nav className="pointer-events-auto fixed right-4 top-4 z-50 flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-end gap-1 rounded-full border border-border bg-card/80 p-1 backdrop-blur">
      <Link
        href="/letters"
        className={`${PILL} ${
          pathname === '/letters' ? 'bg-accent text-black' : 'text-muted hover:text-fg'
        }`}
      >
        Letters
      </Link>

      <span className="mx-1 h-3 w-px shrink-0 bg-border" aria-hidden="true" />

      {MARK_TRANSITIONS.map((entry) => {
        const href = `/letters/transition/${entry.id}`;
        if (!entry.isBuilt) {
          return (
            <span
              key={entry.id}
              className={`${PILL} cursor-not-allowed text-muted/40`}
              title={`Not built yet — ${entry.decidingQuestion}`}
            >
              {entry.label}
            </span>
          );
        }
        return (
          <Link
            key={entry.id}
            href={href}
            className={`${PILL} ${
              pathname === href ? 'bg-accent text-black' : 'text-muted hover:text-fg'
            }`}
            title={entry.identity}
          >
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}
