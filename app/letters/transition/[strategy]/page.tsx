import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import TransitionLab from '@/components/lab/TransitionLab/TransitionLab';
import {
  MARK_TRANSITIONS,
  markTransitionById,
} from '@/components/sections/WorksField/transitions/transitionCatalog';

/**
 * One route per candidate mark→mark transition.
 *
 * ── Why a route each, rather than tabs ───────────────────────────────────────────────────────────
 * Adding a candidate is then one strategy module plus one catalogue entry — this file never changes,
 * and no candidate can break another. It also means `strategyId` cannot change while the harness is
 * mounted, which is why `useTransitionLab` needs a single effect and none of the cross-effect rebuild
 * plumbing the letter lab carries.
 *
 * ── Why the catalogue and not the registry ──────────────────────────────────────────────────────
 * This is a Server Component (it exports `metadata`), and the registry imports three.js. The
 * catalogue is deliberately free of it, so the server can enumerate, validate and title every
 * candidate while the client harness is the only thing that ever loads a strategy.
 */

interface TransitionPageProps {
  params: { strategy: string };
}

export function generateStaticParams() {
  return MARK_TRANSITIONS.map((entry) => ({ strategy: entry.id }));
}

export function generateMetadata({ params }: TransitionPageProps): Metadata {
  const entry = markTransitionById(params.strategy);
  return {
    title: entry ? `voidix — ${entry.label} transition` : 'voidix — transition lab',
    description: entry?.identity ?? 'Mark transition testbed.',
    robots: { index: false, follow: false },
  };
}

export default function TransitionPage({ params }: TransitionPageProps) {
  const entry = markTransitionById(params.strategy);
  if (!entry) notFound();

  return (
    <main>
      <TransitionLab strategyId={entry.id} />
    </main>
  );
}
