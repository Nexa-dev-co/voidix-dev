import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { LOOP_RESET_EVENT } from '@/lib/loopEvents';

/**
 * What the network actually did, printed to the console — development only.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The reported symptom is "the first run is slow, the lap after Travel in Time is smooth", and the
 * natural reading of that is a broken cache. This instrument exists to test that reading rather than
 * act on it, because the two are distinguishable and the answer changes what is worth fixing:
 *
 *   · if lap 2 is fast because assets are being SERVED FROM CACHE, there will be resource entries on
 *     lap 2 and they will say "cache". Caching is then the lever.
 *   · if lap 2 is fast because there is NOTHING LEFT TO DO — every shader compiled, every texture
 *     uploaded, every mark cut, all of it still resident because the loop never reloads the page —
 *     then lap 2 will be almost silent here, and caching is not the lever at all. Doing the work
 *     earlier is.
 *
 * ── What can and cannot be observed ──────────────────────────────────────────────────────────────
 * Everything here comes from `PerformanceResourceTiming`, which is the only honest source: it reports
 * what the browser DID, not what a header asked for.
 *
 * ⚠ Browser cache EVICTION cannot be observed from JavaScript. There is no event for it. What can be
 * observed is its consequence, which is what actually matters: a URL that this session already
 * fetched being fetched FROM THE NETWORK again. That is reported loudly as a re-download, and it is
 * the closest thing to "something got deleted" that exists.
 */

/** Enough headroom that a full session's requests are never silently dropped from the buffer. */
const RESOURCE_BUFFER_SIZE = 500;

/** Dev-server noise that says nothing about caching. */
const IGNORED_PATTERNS = [/webpack-hmr/, /__nextjs/, /\.hot-update\./];

type Delivery = 'network' | 'revalidated' | 'cache' | 'unknown';

type Category = 'model' | 'texture' | 'draco' | 'chunk' | 'font' | 'other';

/**
 * Fields that are real and load-bearing here but not in every TypeScript DOM lib yet.
 * Narrowed rather than cast to `any` — they are read defensively below in any case.
 */
interface ResourceTimingExtras {
  deliveryType?: string;
  responseStatus?: number;
}

interface SeenResource {
  fetches: number;
  networkFetches: number;
}

const seen = new Map<string, SeenResource>();
let started = false;
let lapLabel = 'load';
let lapNetworkBytes = 0;
let lapNetworkCount = 0;
let lapCacheCount = 0;

const STYLE_NETWORK = 'color:#ff8a1a;font-weight:600';
const STYLE_CACHE = 'color:#5bd6a0;font-weight:600';
const STYLE_REVALIDATED = 'color:#8ab4ff;font-weight:600';
const STYLE_WARN = 'color:#ff5c5c;font-weight:700';
const STYLE_DIM = 'color:#888';

function categorise(path: string): Category {
  if (path.includes('/models/')) return 'model';
  if (path.includes('/textures/')) return 'texture';
  if (path.includes('/draco/')) return 'draco';
  if (path.includes('/_next/static/media/')) return 'font';
  if (path.includes('/_next/')) return 'chunk';
  return 'other';
}

/**
 * How the browser delivered this resource.
 *
 * `deliveryType` is the authoritative answer where it exists (Chrome 106+). The two fallbacks below
 * are the long-standing tells, in order: a resource with a decoded body but ZERO transferred bytes
 * never touched the network, and one that transferred bytes but decoded none is a 304 — headers only,
 * body from disk.
 */
function classifyDelivery(entry: PerformanceResourceTiming & ResourceTimingExtras): Delivery {
  if (entry.deliveryType === 'cache') return 'cache';
  if (entry.responseStatus === 304) return 'revalidated';
  if (entry.transferSize === 0 && entry.decodedBodySize > 0) return 'cache';
  if (entry.transferSize > 0 && entry.encodedBodySize === 0) return 'revalidated';
  if (entry.transferSize > 0) return 'network';
  return 'unknown';
}

const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function report(entry: PerformanceResourceTiming & ResourceTimingExtras): void {
  const url = entry.name;
  if (IGNORED_PATTERNS.some((pattern) => pattern.test(url))) return;

  const path = url.startsWith('http') ? new URL(url).pathname : url;
  const delivery = classifyDelivery(entry);
  const category = categorise(path);
  const previous = seen.get(url);

  seen.set(url, {
    fetches: (previous?.fetches ?? 0) + 1,
    networkFetches: (previous?.networkFetches ?? 0) + (delivery === 'network' ? 1 : 0),
  });

  if (delivery === 'network') {
    lapNetworkBytes += entry.transferSize;
    lapNetworkCount += 1;
  } else if (delivery === 'cache') {
    lapCacheCount += 1;
  }

  // ── The one that matters: paid for twice ──
  // Either the browser dropped it, or two loaders asked for the same URL and nothing deduped them.
  // Both are real defects and both look like this from here.
  if (previous && delivery === 'network') {
    console.warn(
      `%c[cache] RE-DOWNLOADED%c ${path}%c\n  fetched ${previous.fetches + 1}x this session, ` +
        `${kilobytes(entry.transferSize)} over the wire again.\n  ` +
        'Either it was evicted, or two loaders want the same file and nothing is sharing it.',
      STYLE_WARN,
      '',
      STYLE_DIM,
    );
    return;
  }

  const style =
    delivery === 'network'
      ? STYLE_NETWORK
      : delivery === 'cache'
        ? STYLE_CACHE
        : STYLE_REVALIDATED;

  const size =
    delivery === 'network'
      ? `${kilobytes(entry.transferSize)} over the wire`
      : `${kilobytes(entry.decodedBodySize)} without touching the network`;

  const throughput =
    delivery === 'network' && entry.duration > 0
      ? `, ~${(entry.transferSize / 1024 / (entry.duration / 1000)).toFixed(0)} KB/s`
      : '';

  console.log(
    `%c[cache] ${delivery.toUpperCase()}%c ${category} %c${path}%c\n  ${size}, ` +
      `${entry.duration.toFixed(0)} ms${throughput}`,
    style,
    STYLE_DIM,
    '',
    STYLE_DIM,
  );
}

/**
 * Print what the lap just cost and reset the counters.
 *
 * This is the number the whole module is for. On the first pass it should be large; if the lap after
 * the loop is near zero, nothing is being re-fetched and the cache was never the thing making the
 * first run slow.
 */
function summarise(nextLabel: string): void {
  console.log(
    `%c[cache] ── ${lapLabel} complete ──%c\n` +
      `  ${lapNetworkCount} from network (${kilobytes(lapNetworkBytes)})\n` +
      `  ${lapCacheCount} served from cache\n` +
      `  ${seen.size} distinct URLs seen so far this session`,
    'color:#ff8a1a;font-weight:700',
    STYLE_DIM,
  );
  lapLabel = nextLabel;
  lapNetworkBytes = 0;
  lapNetworkCount = 0;
  lapCacheCount = 0;
}

/**
 * Begin reporting. Idempotent, and a no-op outside development.
 *
 * Safe to call from a component effect: StrictMode's double-mount hits the `started` guard, and the
 * observer is deliberately never torn down — it is page-lifetime by nature and the page has one.
 */
export function startCacheTelemetry(): void {
  if (process.env.NODE_ENV !== 'development') return;
  if (started || typeof PerformanceObserver === 'undefined') return;
  started = true;

  performance.setResourceTimingBufferSize?.(RESOURCE_BUFFER_SIZE);

  // `buffered` replays everything already in the buffer, so resources that landed before this ran —
  // the document, the first chunks, the preloaded star — are reported too rather than missed.
  new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      report(entry as PerformanceResourceTiming & ResourceTimingExtras);
    });
  }).observe({ type: 'resource', buffered: true });

  window.addEventListener(REVEAL_EVENT, () => summarise('lap'), { once: true });
  // The loop does NOT reload the page, which is exactly the point: whatever it re-fetches is a real
  // cache miss, and whatever it does not is work that was simply never thrown away.
  window.addEventListener(LOOP_RESET_EVENT, () => summarise('lap'));

  navigator.storage?.estimate?.().then((estimate) => {
    const quota = estimate.quota ?? 0;
    const usage = estimate.usage ?? 0;
    console.log(
      `%c[cache] storage%c ${kilobytes(usage)} used of ${(quota / 1024 / 1024).toFixed(0)} MB quota`,
      'color:#ff8a1a;font-weight:700',
      STYLE_DIM,
    );
  }).catch(() => {});
}
