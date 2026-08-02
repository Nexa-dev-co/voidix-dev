/**
 * Measure an element's natural (untransformed) viewport rect.
 *
 * `getBoundingClientRect()` includes any live CSS/GSAP transform, so reading it while the hero
 * square is mid-scroll (scaled up toward fullscreen) returns the *expanded* box. Anything that
 * needs the element's base footprint — the sun layer syncing to the square, the pin recomputing
 * its fill geometry — must strip the transform first. We clear the inline transform, measure,
 * then restore it synchronously so nothing observes the intermediate state.
 */
export function measureUntransformedRect(element: HTMLElement): DOMRect {
  const previousTransform = element.style.transform;
  element.style.transform = 'none';
  const rect = element.getBoundingClientRect();
  element.style.transform = previousTransform;
  return rect;
}
