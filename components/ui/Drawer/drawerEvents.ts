/**
 * The bottom sheet, announcing itself.
 *
 * ⚠ IT LIVES WITH THE DRAWER RATHER THAN IN `lib/` BECAUSE THE DRAWER OWNS IT. Four sections use the
 * sheet — services, works, contact and the enquiry panel — and none of them should have to remember
 * to say that they opened one. One dispatch inside the component covers every present and future
 * caller, which is the same argument `Drawer` itself makes for existing.
 *
 * ⚠ ONLY OPENING IS ANNOUNCED. On a phone every section past the hero keeps only what names the thing
 * you are looking at, and the sheet is where the rest went — so opening it is the visitor asking for
 * the copy, which is worth knowing. Closing is how you get back to the site and means nothing.
 */

export const DRAWER_OPEN_EVENT = 'voidix:drawer-open';

export interface DrawerOpenDetail {
  /**
   * What this sheet is, where the caller knows something the current section does not.
   *
   * ⚠ Optional on purpose. Three of the four sheets ARE their section — the services sheet only ever
   * opens over the fleet — so a key would restate what the pin already published, and a listener can
   * label those from wherever the journey currently is. `EnquiryPanel` is the exception and passes
   * one, because its sheet is a form that opens over any section at all.
   */
  key?: string;
}

export function readDrawerKey(event: Event): string | undefined {
  const detail = (event as CustomEvent<DrawerOpenDetail>).detail;
  return typeof detail?.key === 'string' ? detail.key : undefined;
}
