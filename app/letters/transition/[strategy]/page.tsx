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
      {/* ── The `key` is load-bearing, not a lint appeasement ──
          The note above says a strategy change is a navigation and the component is rebuilt from
          scratch. That is true of a full page load and NOT true of a client-side one: `LabNav` uses
          `next/link`, and moving between two values of the same `[strategy]` segment renders this same
          component at the same position in the tree, so React reuses the instance and keeps the canvas.

          The harness then tears its renderer down and builds a new one on a canvas that still owns a
          WebGL context — and `getContext` hands back the existing, just-disposed one rather than a
          fresh context. The new renderer wraps a dead context and the canvas goes on showing whatever
          was last drawn on it, which reads as the previous strategy still playing.

          Keying on the id forces the remount the design already assumed. */}
      <TransitionLab key={entry.id} strategyId={entry.id} />
    </main>
  );
}
