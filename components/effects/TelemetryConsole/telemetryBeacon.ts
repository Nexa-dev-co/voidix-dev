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
 * Hence two automatic sends, chosen for what each one can possibly contain:
 *
 *   BURN_IN_DONE_EVENT   the loader's measurements are all in by here — device tier, gpu probe,
 *                        BURN-IN / ALLOCATED / split REFUSED. This is the send that answers "what
 *                        ratio did the star get, and why". It fires whether the burn-in succeeded or
 *                        refused, because `runBurnIn` always dispatches.
 *   pagehide             the whole session, including the frame profiler's per-section `ratio` and
 *                        `sun ratio` gauges, which are only emitted once you have actually scrolled
 *                        through the sections. Close the tab and it posts.
 *
 * ⚠ `keepalive` is what makes the second one possible — an ordinary fetch is cancelled when the page
 * goes away. Its budget is ~64 KB across all in-flight keepalive requests, which is why the cap below
 * exists: a long session would otherwise queue more than the browser will carry and silently drop the
 * tail. If a capture comes back truncated, it is this, and `voidix.clear()` before the run you care
 * about is the fix.
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

let installed = false;
let sentBurnIn = false;
let sentPageHide = false;

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
function send(tag: string): string {
  const capture = window.voidix?.text();
  if (!capture) return 'no capture — is lib/telemetryLog installed?';

  const chunks = chunk(capture);
  chunks.forEach((body, offset) => {
    void fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag, index: offset + 1, total: chunks.length, body }),
    }).catch(() => {
      // See above. Nothing to do about it, and saying so would pollute the capture itself.
    });
  });

  return `${chunks.length} chunk${chunks.length === 1 ? '' : 's'} sent as "${tag}"`;
}

function install(): void {
  if (installed || typeof window === 'undefined' || !telemetryEnabled) return;
  installed = true;

  window.addEventListener(BURN_IN_DONE_EVENT, () => {
    if (sentBurnIn) return;
    sentBurnIn = true;
    // ⚠ One frame late, deliberately. `reportSectionCosts` and `reportBurnIn` log from inside the same
    // task that dispatches this event, and a capture taken synchronously would miss the two lines the
    // whole exercise is about.
    requestAnimationFrame(() => send('burn-in'));
  });

  // `pagehide` rather than `unload`, which is unreliable on iOS and blocks the back/forward cache.
  window.addEventListener('pagehide', () => {
    if (sentPageHide) return;
    sentPageHide = true;
    send('pagehide');
  });

  // For a desktop console, when a mid-session capture is wanted at a specific moment.
  if (window.voidix) window.voidix.send = () => send('manual');
}

install();

export {};
