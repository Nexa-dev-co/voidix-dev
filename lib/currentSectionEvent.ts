/**
 * Which named section is on screen — on ANY route.
 *
 * ── ⚠ THIS EXISTS BECAUSE `SECTION_ARRIVE_EVENT` ONLY EVER FIRED ON A NAVBAR JUMP ──────────────
 * That event is dispatched from exactly one place, `SectionJumpVeil`, at the moment the cover opens
 * on a jump of 2+ sections. It is the right signal for what it was built for — telling a section to
 * play its entrance — and it is the wrong signal for "where is the visitor", because **scrolling
 * through the entire site fires it not once.**
 *
 * Anything that treated it as the answer therefore measured only the visitors who used the navbar.
 * Measured, on real data: an hour-long visit that scrolled to the bottom of the site reported its
 * furthest section as `hero`, and every cursor heatmap it produced was filed under `hero` too — so
 * the services, works and FAQ sections had no heatmap at all, on a site where scrolling is the
 * primary way through. `section:arrive` and `nav:jump` had identical counts, which is the tell.
 *
 * ── The two sources, and why one event serves both ─────────────────────────────────────────────
 * The question is the same on both kinds of route, so the answer is one event:
 *
 *   `/`                  the pin's stage machine (`setStage` in `useHeroAnimation`), which already
 *                        knows every stage, already no-ops on repeats, and already runs on ordinary
 *                        scroll as well as on jumps — so it cannot depend on the route taken.
 *   `/about`, `/careers` `useOrbitRail`, which already computes which station is active and already
 *                        acts only when that CHANGES. Free: no observer, no listener, no new work.
 *
 * ⚠ The pin's own first stage is `"fill"`, an implementation name for the hero's square. It is
 * published here as `hero`, which is what every other part of the system calls that section — the
 * navbar meter, the arrival router and the journey taxonomy included.
 */

export const CURRENT_SECTION_EVENT = 'voidix:current-section';

export interface CurrentSectionDetail {
  /**
   * The section's key.
   *
   * On `/` this is a stage: `hero`, `services`, `work`, `faq`, `contact`, `loop`. On a document route
   * it is the `<section>`'s own `id`, which `docSections.ts` already guarantees is the anchor, the
   * React key and the rail station all at once.
   */
  key: string;
}

export function readCurrentSection(event: Event): string | null {
  const detail = (event as CustomEvent<CurrentSectionDetail>).detail;
  return typeof detail?.key === 'string' && detail.key.length > 0 ? detail.key : null;
}

/** One dispatch site's worth of ceremony, shared by the two that have it. */
export function publishCurrentSection(key: string): void {
  window.dispatchEvent(
    new CustomEvent<CurrentSectionDetail>(CURRENT_SECTION_EVENT, { detail: { key } }),
  );
}
