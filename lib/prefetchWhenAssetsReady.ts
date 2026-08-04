import { areAssetsReady, onAssetProgress } from './assetLoadProgress';

/**
 * Rung 3 of the download ladder: warm the HTTP cache for models that are needed much later, once
 * everything the opening actually needs is already in.
 *
 * ── The problem ──────────────────────────────────────────────────────────────────────────────────
 * `black_hole.glb` is 2.94 MB — the largest single asset on the site — and it is fetched at
 * `CHAMBER_PROGRESS_EVENT`, i.e. WHILE THE VISITOR IS SCROLLING through the works→chamber reveal.
 * `table.glb` (0.61 MB) is the same story one crossing earlier. On a first visit both land mid-scroll;
 * on the second lap they are cached and the same scroll is smooth, which is most of the reported
 * "laggy the first time, fast after the loop".
 *
 * ── Why not simply fetch them at page load ───────────────────────────────────────────────────────
 * Because that is what the late fetch was avoiding, and its reasoning still stands
 * (`useWorksField`: they must not add invisible mass to a loader whose counter is honest, nor compete
 * with the copy of the star the intro holds its handoff on). This does not move them onto the gate —
 * it starts them only once every gated source has reported 1, so they compete with nothing:
 *
 *     rung 1   the star                          ← intro gate
 *     rung 2   works surfaces, then the fleet    ← intro gate
 *     rung 3   table, black hole                 ← HERE, after both, on an idle frame
 *
 * The section keeps its own `ensureChamber` / `ensureSingularity` calls exactly as they are. This
 * only means that by the time they run, the bytes are already in the browser's cache — so a prefetch
 * that never finished, or never ran at all, costs nothing and changes no behaviour.
 */

/** Fallback when the browser has no `requestIdleCallback` — long enough to be genuinely after paint. */
const IDLE_FALLBACK_MS = 600;

/** The shape of `navigator.connection` we care about. Not in lib.dom, and not worth an `any`. */
interface DataSaverConnection {
  saveData?: boolean;
}

/**
 * True when the visitor has asked the browser to use less data.
 *
 * Speculatively spending 3.5 MB on someone who has explicitly opted out of exactly that is the one
 * way this helper could do harm, so it simply does not run. The models still load on demand, which
 * is the behaviour that shipped before any of this existed.
 */
function prefersReducedData(): boolean {
  const connection = (navigator as Navigator & { connection?: DataSaverConnection }).connection;
  return connection?.saveData === true;
}

/**
 * Prefetch `urls` once every gated asset source has finished, on an idle callback.
 *
 * Returns a teardown for the caller's cleanup: it unsubscribes, cancels a pending idle callback and
 * aborts an in-flight request.
 *
 * Failures are swallowed by design. This is speculative work whose only job is to make a later load
 * cheaper — a prefetch that 404s, is aborted at teardown, or is refused must never reach the console
 * or the section that will ask for the model properly in a moment.
 */
export function prefetchWhenAssetsReady(urls: readonly string[]): () => void {
  if (urls.length === 0 || prefersReducedData()) return () => {};

  const abortController = new AbortController();
  let idleHandle = 0;
  let idleTimer = 0;
  let started = false;
  let stopped = false;

  const run = async () => {
    // Sequential, not parallel. There is no deadline here and no one waiting on it, so taking one
    // model at a time keeps a speculative 3.5 MB from spiking against whatever the visitor is
    // actually doing — which by now is reading the hero with two WebGL scenes already drawing.
    for (const url of urls) {
      if (stopped) return;
      try {
        const response = await fetch(url, {
          // Matches how three's FileLoader will ask for it later (`new Request(url, { credentials:
          // 'same-origin' })`), so this populates the entry that request will hit rather than a
          // second one beside it.
          credentials: 'same-origin',
          signal: abortController.signal,
        });
        // Drain it. An unread body can leave the cache entry incomplete, which would make the whole
        // exercise pointless — the later load would go back to the network for the full file.
        await response.arrayBuffer();
      } catch {
        // Offline, aborted, 404 — all equally fine. The model loads on demand as it always did.
        return;
      }
    }
  };

  const startWhenIdle = () => {
    if (started || stopped) return;
    started = true;
    unsubscribe();
    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(() => void run());
    } else {
      idleTimer = window.setTimeout(() => void run(), IDLE_FALLBACK_MS);
    }
  };

  const unsubscribe = onAssetProgress(() => {
    if (areAssetsReady()) startWhenIdle();
  });

  // Everything may already be in — a warm reload reports all three sources before this subscribes.
  if (areAssetsReady()) startWhenIdle();

  return () => {
    stopped = true;
    unsubscribe();
    if (idleHandle && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
    window.clearTimeout(idleTimer);
    abortController.abort();
  };
}
