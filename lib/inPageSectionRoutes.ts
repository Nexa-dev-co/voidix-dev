import { prefersReducedMotion } from '@/lib/prefersReducedMotion';

/**
 * Routes that carry the navbar's sections as real in-page anchors — so a nav click stays put.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * `/lite` is the site for a connection that will not carry the site: the same services, work and
 * answers as the homepage, as a document, with nothing to download. And until this, every one of the
 * navbar's four items on that page navigated to `/` — so the one page built for a visitor who cannot
 * afford ten megabytes answered every click by fetching ten megabytes. It was not a small leak; it was
 * the whole purpose of the page, undone by the chrome around it.
 *
 * ── ⚠ A SET, NOT A MAP, AND THE SECTION KEYS ARE WHY ─────────────────────────────────────────────
 * There is no nav-key → anchor-id table here because `/lite` renames its own sections to the navbar's
 * keys instead (see `LITE_SECTIONS`). A table would have been a third place that names a section, and
 * `navItems.ts` and `docSections.ts` both open by arguing against the second.
 *
 * So adding a route to this set is a CLAIM: every key in `NAV_ITEMS` is an element id on that page.
 * `scrollToSection` checks rather than trusts — see there.
 *
 * ⚠ `/about` and `/careers` are NOT here and must not be added. They have none of these sections;
 * they have their own, on their own rail. Their nav items correctly leave the page, and the homepage
 * takes it from there (see lib/arrivalSection.ts).
 */
export const IN_PAGE_SECTION_ROUTES = new Set(['/lite']);

export const isInPageSectionRoute = (pathname: string): boolean =>
  IN_PAGE_SECTION_ROUTES.has(pathname);

/**
 * Travel to a section on such a route. Returns false when it is not there.
 *
 * ── ⚠ THE RETURN VALUE IS THE POINT: FALL THROUGH, NEVER SWALLOW ─────────────────────────────────
 * A caller must only `preventDefault` when this returns true. If a key is ever renamed on one side
 * alone, the click then falls through to its `href` and the visitor gets the homepage's version of
 * that section — a downgrade rather than a dead control. A nav item that silently does nothing is the
 * failure mode worth designing out; `OrbitRail` has made the same choice since it was written.
 *
 * ⚠ `scrollIntoView`, not a hand-built `scrollTo`: only it honours `scroll-margin-top`, and without
 * that margin a travelled-to heading parks underneath the fixed navbar.
 *
 * ⚠ ...and not a bare `#anchor` href either, which is the obvious way to get this for free. Making
 * one of those glide means `html { scroll-behavior: smooth }`, and that is exactly the declaration
 * that fights ScrollTrigger on the homepage — which shares this stylesheet. Scoped to the press
 * instead. (Lifted from `OrbitRail`, which now calls this rather than keeping its own copy.)
 */
export function scrollToSection(key: string): boolean {
  const target = document.getElementById(key);
  if (!target) return false;
  target.scrollIntoView({
    block: 'start',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
  return true;
}
