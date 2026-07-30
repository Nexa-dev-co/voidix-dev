'use client';

import { usePathname } from 'next/navigation';
import Navbar from './Navbar';

/**
 * Keeps the site nav off the authoring routes.
 *
 * ── Why this is not cosmetic ─────────────────────────────────────────────────────────────────────
 * `.nav-root` is `position: fixed`, full width, `4.5rem` tall, at `z-index: 9999`, and — unlike its
 * `.nav-accent` sibling — it carries no `pointer-events: none`. A transparent box still hit-tests, and
 * so does one at `opacity: 0`.
 *
 * On the homepage that is harmless: the bar is genuinely there and its own links want the clicks. On a
 * lab it is invisible, because the entrance only plays on `REVEAL_EVENT` and nothing outside the
 * homepage ever fires that — so what the labs actually had was an unseen full-width strip across the
 * top that swallowed every click. It ate the transition rig's "Copy config" button and the whole of
 * `LabNav`, which sits at `top-4` under `z-50` and never stood a chance against `z-9999`.
 *
 * ── Why a wrapper rather than a check inside Navbar ──────────────────────────────────────────────
 * `Navbar` runs `useNavbarAnimation`, and hooks cannot be conditional — returning null from inside it
 * would still mount the hook, which measures layout, reads fonts and registers listeners for a bar that
 * is not being drawn. Deciding out here means it never mounts at all.
 *
 * ── Why a prefix list rather than a route group ──────────────────────────────────────────────────
 * Route groups are the idiomatic answer and would mean moving `page.tsx`, `sun-lab/` and `letters/`
 * into `(site)` / `(labs)` directories. That is a large diff for one boolean, and the labs are already
 * marked out by their own `robots: noindex` and their own `LabNav`. Add a prefix when a lab is added.
 */

/** Routes that own their whole viewport and bring their own navigation. */
const LAB_ROUTE_PREFIXES = ['/letters', '/sun-lab'];

export default function NavbarGate() {
  const pathname = usePathname();
  const isLabRoute = LAB_ROUTE_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
  if (isLabRoute) return null;
  return <Navbar />;
}
