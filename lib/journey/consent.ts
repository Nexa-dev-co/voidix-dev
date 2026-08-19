/**
 * Whether this visitor has agreed to be recognised between visits.
 *
 * ── The two tiers, in one sentence each ─────────────────────────────────────────────────────────
 * TIER 1 runs for everybody and needs no permission: counts with no identifier, nothing written to
 * the device, nothing that can single a person out. TIER 2 begins only when someone says yes and adds
 * exactly one thing — an id that survives between visits. This module is the gate between them.
 *
 * ── ⚠ MODELLED ON `motionPreference.ts`, DELIBERATELY AND CLOSELY ───────────────────────────────
 * That file already solved every hard part of this shape: three states rather than a boolean so that
 * "no opinion" is distinguishable from "an opinion that matches the default"; a module-level value so
 * a change is visible immediately rather than on the next reload; a listener set so consumers can
 * react without polling; and `try`/`catch` around every storage call because Safari in private
 * browsing THROWS on localStorage rather than returning null. Read that file before changing this one.
 *
 * ── ⚠ THE SYSTEM SIGNAL IS `globalPrivacyControl`, AND IT IS THIS FILE'S `prefers-reduced-motion` ─
 * The parallel is exact and worth stating: motion has an OS switch that a site must honour without
 * being asked, and so does this. GPC is a real, legally recognised opt-out — enforced under the CCPA
 * and treated as a valid objection signal elsewhere — and a browser sending it has already answered
 * the question this module exists to ask.
 *
 * So a visitor sending GPC is treated as DENIED and is never shown the bar. Not "asked politely
 * anyway": asking someone who has already globally said no is the dark-pattern version of consent,
 * and the whole reason tier 1 was designed to need no permission is so that respecting them costs the
 * site nothing.
 *
 * ⚠ They can still opt in deliberately from the control on `/privacy`. An explicit, informed choice
 * made on this site outranks a browser-wide default — but it has to be sought out, never solicited.
 */

/** ⚠ Named in the privacy notice. Renaming it silently makes that page wrong. */
export const JOURNEY_CONSENT_STORAGE_KEY = 'voidix:journey-consent';

/**
 * ⚠ Lives here rather than in `visitorId.ts` even though that module owns the value, and the reason
 * is a dependency cycle: withdrawing consent must destroy the id, so `setJourneyConsent` has to be
 * able to erase it — and if this file imported `visitorId.ts` while `visitorId.ts` imported this one
 * for its consent check, the two would import each other. Consent governs the lifetime of both keys,
 * so it holds both names and the dependency points one way.
 */
export const JOURNEY_VISITOR_STORAGE_KEY = 'voidix:journey-visitor';

/** Fired whenever the answer changes, so the bar and the collector can react without polling. */
export const JOURNEY_CONSENT_EVENT = 'voidix:journey-consent';

/**
 * `unset` is not a third opinion — it is the absence of one, and it is why this is not a boolean.
 * A visitor who has never been asked and a visitor who said no are the same for collection purposes
 * and completely different for whether to show the bar.
 */
export type JourneyConsent = 'unset' | 'granted' | 'denied';

type ConsentListener = () => void;
const listeners = new Set<ConsentListener>();

let consent: JourneyConsent = 'unset';
let initialised = false;

/**
 * The stored shape.
 *
 * ⚠ `decidedAt` is not decoration and is not analytics. Consent has to be demonstrable — the party
 * relying on it is expected to be able to say when it was given and what was being asked at the time.
 * `version` is what makes that meaningful later: if the thing being consented to ever changes, a
 * grant recorded against the old wording is no longer a grant for the new one, and a stored version
 * behind the current one re-opens the question instead of silently carrying the old yes forward.
 */
interface StoredConsent {
  choice: 'granted' | 'denied';
  decidedAt: number;
  version: number;
}

/**
 * ⚠ BUMP THIS WHENEVER WHAT IS COLLECTED MATERIALLY CHANGES, and change the privacy notice in the
 * same commit. Every stored decision below this number is retired and the visitor is asked again.
 * A yes given to one set of facts is not a yes to a different set.
 */
export const JOURNEY_CONSENT_VERSION = 1;

/**
 * Whether the browser is sending Global Privacy Control.
 *
 * ⚠ `doNotTrack` is checked too, and it is the weaker of the two — it was widely ignored and is
 * removed from most browsers now. It costs one comparison and there is no honest argument for
 * receiving an opt-out signal and choosing not to read it because it went out of fashion.
 */
export function hasGlobalPrivacyControl(): boolean {
  if (typeof navigator === 'undefined') return false;

  const globalPrivacyControl = (navigator as Navigator & { globalPrivacyControl?: boolean })
    .globalPrivacyControl;
  if (globalPrivacyControl === true) return true;

  return navigator.doNotTrack === '1';
}

function clearStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Losing the removal is survivable; throwing out of a consent path is not. See the header.
  }
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

function readStoredConsent(): JourneyConsent {
  try {
    const raw = window.localStorage.getItem(JOURNEY_CONSENT_STORAGE_KEY);
    if (!raw) return 'unset';

    const stored = JSON.parse(raw) as Partial<StoredConsent>;
    if (stored.choice !== 'granted' && stored.choice !== 'denied') return 'unset';

    // A decision recorded against an older description of what is collected is not a decision about
    // the current one. Retire it and ask again rather than carrying a stale yes forward.
    if (stored.version !== JOURNEY_CONSENT_VERSION) {
      clearStored(JOURNEY_CONSENT_STORAGE_KEY);
      clearStored(JOURNEY_VISITOR_STORAGE_KEY);
      return 'unset';
    }

    return stored.choice;
  } catch {
    // Safari private browsing throws here, and a hand-mangled value should not be fatal either.
    // Someone who cannot persist a decision can still make one for this session.
  }
  return 'unset';
}

/**
 * ⚠ Lazy, not module-side-effect, because this reads `window`. The module is imported by a component
 * that renders on the server, and touching localStorage at import time would throw during SSR.
 */
function initialise(): void {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;
  consent = readStoredConsent();
}

/**
 * The resolved answer.
 *
 * ⚠ GPC WINS OVER A STORED `unset`, BUT NOT OVER AN EXPLICIT `granted`. Someone who sought out the
 * control on `/privacy` and switched it on has made a specific, informed choice about this site,
 * which is a stronger signal than a browser-wide default. Someone who has never answered has not.
 */
export function getJourneyConsent(): JourneyConsent {
  if (typeof window === 'undefined') return 'unset';
  initialise();

  if (consent === 'unset' && hasGlobalPrivacyControl()) return 'denied';
  return consent;
}

/** The only question the collector ever needs to ask. */
export function isJourneyConsentGranted(): boolean {
  return getJourneyConsent() === 'granted';
}

/**
 * Record a decision.
 *
 * ⚠ WITHDRAWAL DESTROYS THE IDENTIFIER, HERE, SYNCHRONOUSLY. Not on the next load, not when the
 * collector next runs, not "eventually" — the moment someone says no, the thing that could recognise
 * them stops existing. Anything less makes the control on the privacy page a statement of intent
 * rather than an action.
 */
export function setJourneyConsent(next: 'granted' | 'denied'): void {
  if (typeof window === 'undefined') return;
  initialise();

  consent = next;

  if (next === 'denied') clearStored(JOURNEY_VISITOR_STORAGE_KEY);

  try {
    const record: StoredConsent = {
      choice: next,
      decidedAt: Date.now(),
      version: JOURNEY_CONSENT_VERSION,
    };
    window.localStorage.setItem(JOURNEY_CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // As above — the decision still holds for this session even if it cannot be written down.
  }

  notifyListeners();
  window.dispatchEvent(new Event(JOURNEY_CONSENT_EVENT));
}

/**
 * Whether the bar should be shown at all.
 *
 * Three ways this is false, and only one of them is "they already said something":
 *   · a decision is stored — asking again would be nagging
 *   · the browser sends GPC — see the header; they have already answered everyone at once
 *   · we are on the server — there is no visitor yet
 */
export function shouldAskJourneyConsent(): boolean {
  if (typeof window === 'undefined') return false;
  initialise();
  if (hasGlobalPrivacyControl()) return false;
  return consent === 'unset';
}

/** Returns its own unsubscribe, same contract as `subscribeMotionPreference`. */
export function subscribeJourneyConsent(listener: ConsentListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
