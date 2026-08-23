/**
 * The four sections, as the site names them.
 *
 * Pulled out of `Navbar.tsx` because the navbar is no longer the only thing that has to say a
 * section's name: a jump far enough to be hidden holds a title card while it travels, and that card
 * must read exactly `02 / Work` — the same number and the same word the visitor just clicked. Two
 * copies of that pairing would drift the first time one of them was renamed.
 */

export interface NavItem {
  /** Maps the item to its scroll-progress meter and the CSS var its section feeds (`--nav-progress-<key>`). */
  key: string;
  number: string;
  label: string;
  href: string;
  /** Which edge the item converges from in the navbar's entrance (see useNavbarAnimation). */
  enter: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'services', number: '01', label: 'Services', href: '/#services', enter: 'top'    },
  { key: 'work',     number: '02', label: 'Work',     href: '/#work',     enter: 'left'   },
  { key: 'faq',      number: '03', label: 'FAQ',      href: '/#faq',      enter: 'right'  },
  { key: 'contact',  number: '04', label: 'Contact',  href: '/#contact',  enter: 'bottom' },
];

/** The logo's meter tracks the hero. Not a nav item — there is no link to the top. */
export const HOME_METER_KEY = 'home';

/**
 * What the bar does with a click, which is a different answer on each of the three kinds of route.
 *
 *   pin        `/` — every item drives the one pinned ScrollTrigger. None of these sections is a
 *              place, so an href would land on the hero whichever you clicked.
 *   in-page    `/lite` — the section is right there on the page; scroll to it and stay.
 *   navigate   `/about`, `/careers` — the section is genuinely elsewhere. Let the href go, and the
 *              homepage's loader picks the destination up on arrival (lib/arrivalSection.ts).
 */
export type NavMode = 'pin' | 'in-page' | 'navigate';

/**
 * The item's `href` for a given mode.
 *
 * ⚠ It is not decoration under an `onClick`, and none of the three modes make it one. In `pin` mode
 * the handler prevents default and the href is the honest fallback for a click that arrives before the
 * script does; in `in-page` mode it is a real same-page anchor that works with JavaScript off, and it
 * is what a middle-click or a copy-link gives you.
 */
export const hrefForMode = (item: NavItem, mode: NavMode): string =>
  mode === 'in-page' ? `#${item.key}` : item.href;

export const findNavItem = (key: string): NavItem | undefined =>
  NAV_ITEMS.find((item) => item.key === key);
