import { telemetryEnabled } from '@/lib/telemetryEnabled';
import { BURN_IN_DONE_EVENT } from '@/components/effects/IntroSequence/introEvents';

/**
 * Ships `lib/telemetryLog`'s capture to `/api/telemetry`, which re-logs it server-side so it appears
 * in Vercel's runtime logs.
 *
 * ── Why, and why it fires by itself ──────────────────────────────────────────────────────────────
 * `window.voidix.download()` already saves the capture as a .txt, and on a desktop that is the end of
 * the story. On a phone it is not: calling it needs a console, and on iOS from Windows there is no way
 * to get one. So this needs to work with **nobody touching anything** — you open the site on the
 * phone, and the numbers are in `vercel logs` by the time you look.
 *
 * Hence FOUR automatic sends, chosen for what each one can possibly contain and for how likely it is
 * to survive the platform it runs on:
 *
 *   BURN_IN_DONE_EVENT   the loader's measurements are all in by here — device tier, gpu probe,
 *                        BURN-IN / ALLOCATED / split REFUSED. This is the send that answers "what
 *                        ratio did the star get, and why". It fires whether the burn-in succeeded or
 *                        refused, because `runBurnIn` dispatches from a `finally`.
 *   a fallback timer     ⚠ because the line above assumes the loader FINISHES. On the device this
 *                        whole exercise is about, a loader that stalls is a live possibility — and
 *                        "nothing arrived" is indistinguishable from "the page never loaded", which
 *                        is the worst failure mode a diagnostic can have. This one always answers.
 *   visibilitychange     ⚠ THE ONE THAT MATTERS ON iOS. Switching apps or locking the phone fires
 *                        this and frequently does NOT fire `pagehide`.
 *   pagehide             the desktop's reliable end-of-session send.
 *
 * ⚠ `navigator.sendBeacon` FIRST, `fetch` only as the fallback. An ordinary fetch is cancelled when
 * the page goes away; `keepalive` is meant to fix that and iOS Safari has never carried it reliably,
 * which is exactly the platform these sends exist for. `sendBeacon` is the API built for this and the
 * one WebKit actually honours. Both share a ~64 KB budget, which is what the chunk cap below is for.
 *
 * ⚠ Inert in production. `telemetryEnabled` is decided at build time, the route 404s there anyway,
 * and the bundler drops this body.
 */

/**
 * Characters per POST.
 *
 * Vercel truncates a long log message, and the capture is far longer than one line's worth — so it is
 * split rather than sent whole. 3000 is comfortably inside the limit with the prefix and the newlines
 * the route adds.
 */
const CHUNK_CHARACTERS = 3000;

/**
 * The most chunks one send may use. 16 × 3000 ≈ 48 KB, deliberately under `keepalive`'s ~64 KB.
 *
 * ⚠ It truncates the END, not the beginning, and that is the right way round: the loader's lines are
 * the ones being read, and they are first.
 */
const MAX_CHUNKS = 16;

const ENDPOINT = '/api/telemetry';

/**
 * When the unconditional fallback send goes out, measured from page load.
 *
 * Past the loader on any healthy device, and — the point — NOT dependent on the loader having got
 * there. Long enough that a slow phone has normally finished; short enough that a visitor who gives
 * up and closes the tab has already been captured.
 */
const FALLBACK_SEND_MS = 15_000;

let installed = false;
/** One send per trigger. A page that hides, shows and hides again should not post three times. */
const sentTags = new Set<string>();

function chunk(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += CHUNK_CHARACTERS) {
    chunks.push(text.slice(start, start + CHUNK_CHARACTERS));
    if (chunks.length >= MAX_CHUNKS) break;
  }
  return chunks;
}

/**
 * Post the capture as it stands.
 *
 * ⚠ Fire-and-forget on purpose, and it never rejects. This is a diagnostic riding along inside a page
 * that is either loading or unloading; a rejected promise from it must not surface anywhere, and a
 * dead dev server must not fill the console with failed requests during the very load being measured.
 */
function post(payload: string): void {
  // `sendBeacon` takes its Content-Type from the Blob, and is the only one of the two that WebKit
  // reliably flushes from a page that is going away.
  const blob = new Blob([payload], { type: 'application/json' });
  if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(ENDPOINT, blob)) return;

  // It returns false when the queue is full or the payload is over budget — and does not exist at all
  // on a few older browsers. Either way the request is still worth attempting.
  void fetch(ENDPOINT, {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: payload,
  }).catch(() => {
    // Nothing to do about it, and saying so would pollute the capture itself.
  });
}

function send(tag: string): string {
  if (sentTags.has(tag)) return `already sent "${tag}"`;
  sentTags.add(tag);

  const capture = window.voidix?.text();
  if (!capture) return 'no capture — is lib/telemetryLog installed?';

  const chunks = chunk(capture);
  chunks.forEach((body, offset) => {
    post(JSON.stringify({ tag, index: offset + 1, total: chunks.length, body }));
  });

  return `${chunks.length} chunk${chunks.length === 1 ? '' : 's'} sent as "${tag}"`;
}

function install(): void {
  if (installed || typeof window === 'undefined' || !telemetryEnabled) return;
  installed = true;

  window.addEventListener(BURN_IN_DONE_EVENT, () => {
    // ⚠ One frame late, deliberately. `reportSectionCosts` and `reportBurnIn` log from inside the same
    // task that dispatches this event, and a capture taken synchronously would miss the two lines the
    // whole exercise is about.
    requestAnimationFrame(() => send('burn-in'));
  });

  // ⚠ Unconditional, and it does NOT check whether the burn-in already answered. Two captures of an
  // overlapping session cost one duplicate log entry; a missing one costs a whole trip to the phone.
  window.setTimeout(() => send('fallback'), FALLBACK_SEND_MS);

  // The iOS path: locking the phone or switching apps fires this, often without `pagehide`.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send('hidden');
  });

  // `pagehide` rather than `unload`, which is unreliable on iOS and blocks the back/forward cache.
  window.addEventListener('pagehide', () => send('pagehide'));

  // For a desktop console, when a mid-session capture is wanted at a specific moment.
  // ⚠ Numbered, so the dedupe above cannot make the second manual call a silent no-op — the whole
  // point of calling it by hand is to take MORE than one reading.
  let manualSends = 0;
  if (window.voidix) {
    window.voidix.send = () => {
      manualSends += 1;
      return send(`manual-${manualSends}`);
    };
  }
}

install();

export {};
