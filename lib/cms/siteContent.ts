/**
 * The seven payload keys that are not a single page's, resolved once per route.
 *
 * ── ⚠ WHY THIS IS SITE-WIDE AND NOT THE HOMEPAGE'S ──────────────────────────────────────────────
 * It was going to be `HomeContent`, and that was wrong for two reasons found on the way in:
 *
 * · **`EnquiryForm` renders on every route.** The services deck, the works field, the FAQ hologram,
 *   the contact section, `/about`, `/careers` and `/lite` all open the same form. Scope its strings
 *   to the homepage and the four document-route copies silently keep this repo's fallbacks while the
 *   homepage shows the panel's — which is the exact "a field the panel offers and the site ignores"
 *   failure `enquiryFormContent.ts` exists to end. `PageFooter` has the same shape.
 * · **`/lite` re-presents the homepage's own content.** It renders `services`, `projects` and `faq`
 *   as a document. Those are not the homepage's words, they are the site's; `/lite` just says them
 *   without the scene.
 *
 * What stays per-page is what genuinely belongs to one page: `about` and `careers` keep resolving in
 * their own `page.tsx` and arriving as a `content` prop, because each is read by exactly one tree.
 *
 * ── Why a provider rather than props ────────────────────────────────────────────────────────────
 * On the homepage, `FaqHologram` is a SIBLING of `<Hero/>` rather than a descendant — it sits in
 * `page.tsx` because the pin's spacer is transformed and the panel must be `position: fixed` against
 * the viewport. Prop-drilling would need a second path out to it, and a third for the next component
 * that has to escape the pin. See `SiteContentProvider`.
 *
 * ── ⚠ THIS RUNS ON THE SERVER, AND IT MUST ──────────────────────────────────────────────────────
 * Each route's `page.tsx` awaits `fetchPublishedContent()` and calls this; the RESULT is what crosses
 * into the client. Nothing here may be called from a client component — `fetchPublishedContent` holds
 * a secret with no `NEXT_PUBLIC_` prefix, and in a browser bundle that is `undefined`, so a
 * client-side call would not leak the key, it would silently stop fetching and fall back forever.
 * That is the quieter and more confusing failure.
 *
 * ── One shape, whichever source answered ────────────────────────────────────────────────────────
 * Every field is non-nullable by the time it leaves here. A component can never read a published
 * value for one thing and a hardcoded constant for another, because after this there is only ever one
 * `SiteContent`. The same property `resolveAboutContent` has, extended across seven keys.
 */

import type { PublishedContent } from '@/lib/cms/publishedContent';
import {
  resolveDeckServices,
  type DeckService,
} from '@/components/sections/ServicesDeck/deckServices';
import {
  resolveWorksProjects,
  type WorksProject,
} from '@/components/sections/WorksField/worksProjects';
import { resolveFaqEntries, type FaqEntry } from '@/components/sections/Chamber/faqEntries';
import {
  resolveContactContent,
  resolveFooterContent,
  type ContactContent,
  type FooterContent,
} from '@/components/sections/Contact/contactContent';
import {
  resolveEnquiryFormContent,
  type EnquiryFormContent,
} from '@/components/ui/EnquiryForm/enquiryFormContent';
import { resolveDisciplines, type Discipline, type DisciplineId } from '@/lib/enquirySubjects';

/**
 * The four keys only the scene routes render — `/` and `/lite`.
 *
 * ── ⚠ WHY THIS IS SPLIT OFF, AND IT IS NOT TIDINESS ─────────────────────────────────────────────
 * A Server Component's props are serialised into the HTML as the RSC payload. Handing every route one
 * whole `SiteContent` therefore shipped the fleet's, the field's and the chamber's copy to `/about`
 * and `/careers` as well — **measured at ~11.1 kB, 28 % of `/about`'s entire HTML**, never rendered
 * on either page.
 *
 * That is the wrong direction on exactly the two pages best placed to rank: they are the site's only
 * ordinary documents, they already carry ~2.1 MB of preloads they cannot use
 * (`docs/about-careers-plan.md` §1e), and page weight is a ranking input. So the document routes
 * resolve the shared vocabulary alone and `sections` arrives `null`.
 */
export interface SiteSections {
  services: DeckService[];
  projects: WorksProject[];
  faq: FaqEntry[];
  contact: ContactContent;
}

/**
 * What every route needs: the one form's strings, the vocabulary it seeds from, and the one footer
 * that two different footers render.
 */
export interface SiteContent {
  footer: FooterContent;
  disciplines: Record<DisciplineId, Discipline>;
  enquiryForm: EnquiryFormContent;
  /** ⚠ `null` on the document routes. Read it through `useSiteSections`, never directly. */
  sections: SiteSections | null;
}

/**
 * ⚠ Both resolvers take the whole payload rather than N arguments, and read each key with `?? null` —
 * a release published before a section existed simply has no key for it, and every resolver below
 * already treats `null` as "not ready, serve this repo's copy". That is the contract
 * `PublishedContent`'s header sets, honoured in one place rather than at seven call sites.
 */
export function resolveSharedContent(published: PublishedContent | null): SiteContent {
  return {
    footer: resolveFooterContent(published?.footer ?? null),
    disciplines: resolveDisciplines(published?.disciplines ?? null),
    enquiryForm: resolveEnquiryFormContent(published?.enquiryForm ?? null),
    sections: null,
  };
}

/**
 * `SiteContent` with the guarantee that `sections` is present.
 *
 * ⚠ It exists so `app/page.tsx` can read `content.sections.faq` for the FAQ schema without a
 * non-null assertion. `resolveFullContent` always sets it, and a `!` at the call site would be the
 * same claim made where nothing checks it — here the compiler carries it instead.
 */
export interface FullSiteContent extends SiteContent {
  sections: SiteSections;
}

/** The shared vocabulary plus the scene sections — `/` and `/lite` only. */
export function resolveFullContent(published: PublishedContent | null): FullSiteContent {
  return {
    ...resolveSharedContent(published),
    sections: {
      services: resolveDeckServices(published?.services ?? null),
      projects: resolveWorksProjects(published?.projects ?? null),
      faq: resolveFaqEntries(published?.faq ?? null),
      contact: resolveContactContent(published?.contact ?? null),
    },
  };
}
