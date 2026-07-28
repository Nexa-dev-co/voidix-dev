'use client';

import { useRef, type ReactNode } from 'react';
import { hydrateContent, type ContentPayload } from '@voidix/content';

/**
 * Pours published content into the browser's copy of the content arrays.
 *
 * ── Why this component has to exist ──────────────────────────────────────────────────────────────
 * The server and the browser run separate module graphs, so they each hold their own copy of the
 * arrays in @voidix/content. Hydrating on the server alone makes the HTML correct and then React
 * replaces it with the values compiled into the bundle a moment later — the page would visibly flip
 * from published copy back to whatever shipped in the build.
 *
 * ── Why it hydrates during render rather than in an effect ───────────────────────────────────────
 * `deckTuning.ts` reads `DECK_SERVICES` at module-evaluation time to size its per-ship placements.
 * That module lives in the DeckCanvas chunk, which `next/dynamic` loads after mount — so the arrays
 * have to be filled before then. An effect is too late and, worse, racy: child effects run before
 * parent effects, and the dynamic import is kicked off during a child's mount.
 *
 * Render order is the one guarantee available here — a parent's render body always runs before its
 * children's. So this hydrates in the render body, and every consumer downstream sees filled arrays.
 * It's a deliberate exception to "render should be pure", made safe by being idempotent: the same
 * payload is applied exactly once.
 */

interface ContentBootProps {
  /** The published payload, or null to leave the bundled defaults in place. */
  payload: ContentPayload | null;
  children: ReactNode;
}

export default function ContentBoot({ payload, children }: ContentBootProps) {
  // Guards against re-applying on every re-render, and against StrictMode's double render in dev.
  // A ref rather than a module-level flag so a second mount (a soft navigation back to the page)
  // still hydrates its own copy.
  const appliedPayload = useRef<ContentPayload | null>(null);

  if (payload && appliedPayload.current !== payload) {
    hydrateContent(payload);
    appliedPayload.current = payload;
  }

  return <>{children}</>;
}
