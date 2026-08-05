/**
 * The site's one answer to "should this move?".
 *
 * ── Why this exists rather than `matchMedia` at each call site ────────────────────────────────────
 * `prefersReducedMotion()` used to read the media query directly, and every consumer captured the
 * result into a `const` at effect-setup time:
 *
 *     const reduceMotion = prefersReducedMotion();   // ← read once, at scene construction
 *
 * That is fine for a page you can reload. This site is ONE route with ONE pin, and the moment a
 * visitor reaches for their Reduce Motion switch is the moment a page has just made them feel
 * unwell — which is to say, mid-journey, with no reload coming. The setting had no effect until they
 * left and came back.
 *
 * A module-level value fixes half of that: the answer can now change during a session, and anything
 * that asks per frame picks it up immediately. The other half is the call sites that still capture,
 * and those are converted one at a time — `subscribeMotionPreference` exists so a consumer can opt
 * in without every other consumer having to change on the same day.
 *
 * ── Why a THREE-state preference and not a boolean ───────────────────────────────────────────────
 * `system` is not the same as `full`. A visitor who has never touched the in-page control should
 * keep following their OS, including if they change it later; a visitor who has explicitly chosen
 * full motion should NOT have the OS quietly overrule them on the next visit. Collapsing the two
 * loses the difference between "no opinion" and "an opinion that happens to match the default".
 *
 * ⚠ The control must be able to turn reduced motion ON, not only off. Someone who arrives without
 * the OS flag and starts feeling ill needs the exit — that is most of the reason to ship it at all.
 */

/** What the visitor has explicitly chosen, if anything. */
export type MotionPreference = 'system' | 'reduced' | 'full';

const STORAGE_KEY = 'voidix:motion-preference';
const MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Mirrored onto `<html>` so CSS can follow an in-page override.
 *
 * ⚠ The `@media (prefers-reduced-motion: reduce)` blocks in `globals.css` read the OS query and
 * cannot see this. Until each of them grows a companion selector, an in-page override moves the
 * JavaScript-driven motion only. Setting the attribute here costs nothing and means that follow-up
 * is a pure CSS change with no wiring.
 */
const MOTION_ATTRIBUTE = 'data-motion';

type MotionListener = () => void;
const listeners = new Set<MotionListener>();

let preference: MotionPreference = 'system';
let systemReduced = false;
let initialised = false;

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

function readStoredPreference(): MotionPreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'reduced' || stored === 'full') return stored;
  } catch {
    // Safari in private browsing throws on localStorage rather than returning null. A visitor who
    // cannot persist a choice should still be able to make one for this session.
  }
  return 'system';
}

/** Reflect the RESOLVED answer, not the preference — CSS wants to know whether to move, not why. */
function paintMotionAttribute(): void {
  document.documentElement.setAttribute(
    MOTION_ATTRIBUTE,
    isReducedMotion() ? 'reduced' : 'full',
  );
}

/**
 * Lazy, because this module is imported by files that run during SSR.
 *
 * ⚠ `initialised` is deliberately NOT set on the server path, so the first client call still does
 * the real work. Returning early without latching is the whole trick.
 */
function initialise(): void {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;

  const query = window.matchMedia(MEDIA_QUERY);
  systemReduced = query.matches;
  preference = readStoredPreference();

  // The OS setting can change mid-session too — on iOS it is reachable without leaving the browser.
  // Only worth announcing when nothing is overriding it.
  query.addEventListener('change', (event: MediaQueryListEvent) => {
    systemReduced = event.matches;
    if (preference === 'system') {
      paintMotionAttribute();
      notifyListeners();
    }
  });

  paintMotionAttribute();
}

/**
 * The resolved answer: should motion be suppressed right now?
 *
 * ⚠ Returns `false` during SSR, and must keep doing so. `IntroSequence` renders `GatherCanvas`
 * unconditionally precisely because a reduced-motion branch in render output would differ between
 * server and client and break hydration. Components opt out inside their own effects instead.
 */
export function isReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  initialise();
  if (preference === 'reduced') return true;
  if (preference === 'full') return false;
  return systemReduced;
}

/** What the visitor chose — `system` when they have not chosen. For rendering the control itself. */
export function getMotionPreference(): MotionPreference {
  initialise();
  return preference;
}

/** True when the OS is asking for reduced motion, regardless of any override. For the control's copy. */
export function isSystemReducedMotion(): boolean {
  initialise();
  return systemReduced;
}

export function setMotionPreference(next: MotionPreference): void {
  initialise();
  if (preference === next) return;
  preference = next;

  try {
    if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // See readStoredPreference — the choice still applies to this session.
  }

  paintMotionAttribute();
  notifyListeners();
}

/** Subscribe to changes. Returns its own unsubscribe, so callers can hand it straight to an effect. */
export function subscribeMotionPreference(listener: MotionListener): () => void {
  initialise();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
