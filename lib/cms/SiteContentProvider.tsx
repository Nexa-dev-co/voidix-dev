'use client';

/**
 * Carries the resolved homepage copy from the server render down to whichever component needs it.
 *
 * ── ⚠ WHY A CONTEXT AND NOT PROPS ───────────────────────────────────────────────────────────────
 * Three of the homepage's components are SIBLINGS of `<Hero/>` rather than children — `FaqHologram`,
 * `LoopVeil` and `SectionJumpVeil` all live directly in `app/page.tsx` because the pin's spacer is
 * transformed, and a transformed ancestor stops `position: fixed` being fixed. `FaqHologram` is one
 * of the seven consumers.
 *
 * So prop-drilling would need TWO paths: one down through `Hero` into the three overlays, and a
 * second one out to the hologram — and a third the next time something has to escape the pin. A
 * provider wrapped around `page.tsx`'s children does not care about the tree's shape.
 *
 * ── ⚠ IT HOLDS A VALUE; IT NEVER FETCHES ONE ────────────────────────────────────────────────────
 * The resolve happens on the server, in each route's `page.tsx`, and the finished `SiteContent` is
 * serialised across. Nothing in this file may call `fetchPublishedContent` — see `siteContent.ts`'s
 * header for what a client-side call would quietly do.
 *
 * ⚠ EVERY route that renders an `EnquiryForm` or a `PageFooter` must wrap its tree in this — which
 * is currently all four of them. A route that forgets throws on first render rather than rendering
 * fallback copy, which is the point of the default below.
 *
 * ── Why the default throws rather than falling back ─────────────────────────────────────────────
 * Everything else in this system falls back, deliberately and at every layer. This one does not: a
 * missing provider is a WIRING mistake, not a runtime condition, and the only honest signal for it is
 * a loud one at development time. Falling back to this repo's copy here would make a component
 * rendered outside the provider look like a working component on a site whose panel is down — which
 * is precisely the failure that would then ship.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { SiteContent, SiteSections } from '@/lib/cms/siteContent';

const SiteContentContext = createContext<SiteContent | null>(null);

export default function SiteContentProvider({
  content,
  children,
}: {
  content: SiteContent;
  children: ReactNode;
}) {
  return <SiteContentContext.Provider value={content}>{children}</SiteContentContext.Provider>;
}

export function useSiteContent(): SiteContent {
  const content = useContext(SiteContentContext);

  if (!content) {
    throw new Error(
      "useSiteContent was called outside SiteContentProvider — wrap this route's tree in it, the " +
        'way app/page.tsx and the document routes do.',
    );
  }

  return content;
}

/**
 * The scene sections, for a component that only ever renders on `/` or `/lite`.
 *
 * ⚠ Throws rather than returning `null` for the same reason the provider's default does: a document
 * route reaching for the fleet's copy is a wiring mistake, and the only honest signal for it is a
 * loud one. Returning empty arrays would render a fleet with no craft in it and look like a content
 * problem — sending whoever hit it to the panel to look for copy that is not missing.
 */
export function useSiteSections(): SiteSections {
  const { sections } = useSiteContent();

  if (!sections) {
    throw new Error(
      'useSiteSections was called on a route that resolved only the shared content — use ' +
        'resolveFullContent in that page.tsx, as app/page.tsx and app/lite/page.tsx do.',
    );
  }

  return sections;
}
