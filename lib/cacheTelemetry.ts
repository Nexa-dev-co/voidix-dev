import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { LOOP_RESET_EVENT } from '@/lib/loopEvents';
import { telemetryEnabled } from '@/lib/telemetryEnabled';

/**
 * What the network actually did, printed to the console — development and Vercel previews.
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
 * ── What it prints ───────────────────────────────────────────────────────────────────────────────
 * Per-resource detail is the least useful thing here and there is the most of it, so each observer
 * batch collapses into ONE line you can expand. What stays at top level is what you have to act on:
 * a re-download, and the per-lap summary — a headline, a lap-over-lap delta, a verdict, and a table.
 *
 * ⚠ The summary answers the question above IN WORDS. Read the verdict line; it is the whole point.
 *
 * ── What can and cannot be observed ──────────────────────────────────────────────────────────────
 * Everything here comes from `PerformanceResourceTiming`, which is the only honest source: it reports
 * what the browser DID, not what a header asked for.
 *
 * ⚠ Browser cache EVICTION cannot be observed from JavaScript. There is no event for it. What can be
 * observed is its consequence, which is what actually matters: a URL that this session already
 * fetched being fetched FROM THE NETWORK again. That is reported loudly as a re-download, and it is
 * the closest thing to "something got deleted" that exists.
 *
 * ⚠ In development this UNDERSTATES caching, and the readout says so. `next.config.mjs` applies its
 * immutable headers in production only — on purpose, so a re-exported model is never served stale
 * from disk while you are working on it. Do not tune caching from a dev log; read a preview instead,
 * where the headers, the minified bundle and the CDN are all the real ones (`telemetryEnabled`).
 */

/** Enough headroom that a full session's requests are never silently dropped from the buffer. */
const RESOURCE_BUFFER_SIZE = 500;

/** Dev-server noise that says nothing about caching. */
const IGNORED_PATTERNS = [/webpack-hmr/, /__nextjs/, /\.hot-update\./];

/**
 * Above this, the wait dominates and gets called out by name.
 *
 * ⚠ This is the correction that matters most in dev. `entry.duration` is `responseEnd - startTime`,
 * so it is mostly queueing and server think-time; dividing bytes by it produced throughput figures
 * that were simply false — the same session that reported 3 KB/s for a 10 KB chunk moved a 414 KB
 * texture at 17,600 KB/s moments later. Next compiles routes on demand, and the whole first wave of
 * requests sits parked behind one webpack build, then lands together. That is a compile stall, not a
 * slow network, and a readout that cannot tell them apart sends you chasing the wrong thing.
 */
const DOMINANT_WAIT_MS = 400;

type Delivery = 'network' | 'revalidated' | 'cache' | 'unknown';

type Category = 'model' | 'texture' | 'draco' | 'chunk' | 'font' | 'other';

/** Fixed row order, so two laps' tables can be compared by eye without re-reading the labels. */
const CATEGORY_ORDER: readonly Category[] = ['model', 'texture', 'draco', 'font', 'chunk', 'other'];

/**
 * Categories whose bytes are build output rather than the site.
 *
 * Kept apart in the totals because in development they are unminified, carry the HMR runtime and the
 * React dev builds, and routinely outweigh every real asset four to one — which makes the one number
 * you actually wanted unreadable. Fonts live under `_next/static/media` but ship to production as
 * they are, so they count as site.
 */
const BUILD_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['chunk']);

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

interface CategoryStats {
  networkCount: number;
  networkBytes: number;
  cacheCount: number;
  slowestMs: number;
}

/** Carried across a lap boundary so the next summary can print a delta instead of a bare total. */
interface LapTotals {
  label: string;
  networkCount: number;
  networkBytes: number;
}

/** One resource's line, built during accumulation and printed once the batch's shape is known. */
interface DetailLine {
  message: string;
  styles: string[];
  networkBytes: number;
  fromCache: boolean;
  /** Re-downloads. Printed with `console.warn` at top level — never hidden inside a collapsed group. */
  severe: boolean;
}

interface TimingSplit {
  waitMs: number;
  transferMs: number;
  measurable: boolean;
}

const seen = new Map<string, SeenResource>();
const lapStats = new Map<Category, CategoryStats>();
let started = false;
let lapLabel = 'load';
let lapNetworkBytes = 0;
let lapNetworkCount = 0;
let lapCacheCount = 0;
let lapSiteBytes = 0;
let lapBuildBytes = 0;
/**
 * The same two totals for what came from CACHE, kept apart from the wire figures on purpose.
 *
 * ⚠ THEY ARE NOT THE SAME UNIT AND MUST NEVER BE ADDED. A network entry reports `transferSize` — what
 * crossed the wire, compressed. A cached entry has `transferSize` 0 and only `decodedBodySize` — the
 * UNCOMPRESSED size. For a GLB the two are within a few percent (it is already compressed); for a JS
 * chunk decoded is ~3× the wire (`2200cc46` read 54.1 KB over the wire and 168.8 KB from cache).
 * Summing them would invent a number that is neither.
 *
 * They exist because without them a fully cached lap printed `0.0 KB site assets · 0.0 KB bundle`
 * while every individual line above it showed a real size — which reads as "nothing loaded" and cost
 * an afternoon of arguing about whether a rebuilt model had actually deployed.
 */
let lapSiteCacheBytes = 0;
let lapBuildCacheBytes = 0;
let lapRedownloads = 0;
let lapOpaqueCount = 0;
let previousLap: LapTotals | null = null;

const STYLE_NETWORK = 'color:#ff8a1a;font-weight:600';
const STYLE_CACHE = 'color:#5bd6a0;font-weight:600';
const STYLE_REVALIDATED = 'color:#8ab4ff;font-weight:600';
const STYLE_WARN = 'color:#ff5c5c;font-weight:700';
const STYLE_UNKNOWN = 'color:#888;font-weight:600';
const STYLE_HEADER = 'color:#ff8a1a;font-weight:700';
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

/**
 * Waiting apart from transferring — see `DOMINANT_WAIT_MS` for why this is not cosmetic.
 *
 * ⚠ Unmeasurable is a real outcome, not a failure. A worker's own chunk can report a NEGATIVE
 * duration: its timing origin is the worker's, not the document's, so the subtraction crosses two
 * clocks. `responseStart` is likewise 0 for a cross-origin response without `Timing-Allow-Origin`.
 * Both say so rather than printing a confident wrong number.
 */
function splitTiming(entry: PerformanceResourceTiming): TimingSplit {
  const totalMs = entry.duration;
  const transferMs = entry.responseEnd - entry.responseStart;
  const measurable =
    totalMs > 0 && entry.responseStart > 0 && transferMs >= 0 && transferMs <= totalMs;

  if (!measurable) return { waitMs: Math.max(0, totalMs), transferMs: 0, measurable: false };
  return { waitMs: totalMs - transferMs, transferMs, measurable: true };
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;

function statsFor(category: Category): CategoryStats {
  const existing = lapStats.get(category);
  if (existing) return existing;
  const created: CategoryStats = { networkCount: 0, networkBytes: 0, cacheCount: 0, slowestMs: 0 };
  lapStats.set(category, created);
  return created;
}

/** Why a request spent most of its life waiting. In dev the answer is nearly always the same one. */
function waitReason(category: Category): string {
  return category === 'chunk'
    ? 'dev server compiled this on demand — not a slow network'
    : 'server wait, not transfer';
}

/** The timing half of a network line: what was spent waiting, what was spent actually moving bytes. */
function describeNetworkTiming(entry: PerformanceResourceTiming, timing: TimingSplit): string {
  if (!timing.measurable) return 'timing unavailable (worker clock)';

  const waited = `waited ${timing.waitMs.toFixed(0)} ms`;
  if (timing.transferMs <= 0) return `${waited} · sent instantly`;

  const throughput = entry.transferSize / 1024 / (timing.transferMs / 1000);
  return `${waited} · sent in ${timing.transferMs.toFixed(0)} ms (${throughput.toFixed(0)} KB/s)`;
}

/** Accumulate one entry into the lap, and build the line that describes it. */
function record(entry: PerformanceResourceTiming & ResourceTimingExtras): DetailLine | null {
  const url = entry.name;
  if (IGNORED_PATTERNS.some((pattern) => pattern.test(url))) return null;

  const path = url.startsWith('http') ? new URL(url).pathname : url;
  const delivery = classifyDelivery(entry);
  const category = categorise(path);
  const stats = statsFor(category);
  const timing = splitTiming(entry);
  const previous = seen.get(url);

  seen.set(url, {
    fetches: (previous?.fetches ?? 0) + 1,
    networkFetches: (previous?.networkFetches ?? 0) + (delivery === 'network' ? 1 : 0),
  });

  if (delivery === 'network') {
    lapNetworkBytes += entry.transferSize;
    lapNetworkCount += 1;
    stats.networkCount += 1;
    stats.networkBytes += entry.transferSize;
    stats.slowestMs = Math.max(stats.slowestMs, timing.waitMs + timing.transferMs);
    if (BUILD_CATEGORIES.has(category)) lapBuildBytes += entry.transferSize;
    else lapSiteBytes += entry.transferSize;
  } else if (delivery === 'cache') {
    lapCacheCount += 1;
    stats.cacheCount += 1;
    // Decoded, not transferred — `transferSize` is 0 by definition here. See the declarations.
    if (BUILD_CATEGORIES.has(category)) lapBuildCacheBytes += entry.decodedBodySize;
    else lapSiteCacheBytes += entry.decodedBodySize;
  }

  // ── The one that matters: paid for twice ──
  // Either the browser dropped it, or two loaders asked for the same URL and nothing deduped them.
  // Both are real defects and both look like this from here.
  if (previous && delivery === 'network') {
    lapRedownloads += 1;
    return {
      message:
        `%c[cache] RE-DOWNLOADED%c ${path}%c\n  fetched ${previous.fetches + 1}x this session, ` +
        `${formatBytes(entry.transferSize)} over the wire again.\n  ` +
        'Either it was evicted, or two loaders want the same file and nothing is sharing it.',
      styles: [STYLE_WARN, '', STYLE_DIM],
      networkBytes: entry.transferSize,
      fromCache: false,
      severe: true,
    };
  }

  let style: string;
  let detail: string;

  if (delivery === 'network') {
    style = STYLE_NETWORK;
    const dominatedByWait = timing.measurable && timing.waitMs > DOMINANT_WAIT_MS;
    const tag = dominatedByWait ? ` · ⚠ ${waitReason(category)}` : '';
    detail = `${formatBytes(entry.transferSize)} · ${describeNetworkTiming(entry, timing)}${tag}`;
  } else if (delivery === 'cache') {
    style = STYLE_CACHE;
    detail = `${formatBytes(entry.decodedBodySize)} · never touched the network`;
  } else if (delivery === 'revalidated') {
    style = STYLE_REVALIDATED;
    detail =
      `${formatBytes(entry.decodedBodySize)} from disk · ` +
      `${formatBytes(entry.transferSize)} of headers to ask`;
  } else {
    // Every size reads zero. This is what a CROSS-ORIGIN response without `Timing-Allow-Origin` looks
    // like from here — the browser withholds the numbers rather than the resource failing. Say so,
    // instead of confidently reporting "0.0 KB from disk", and keep it out of the totals it would
    // otherwise drag toward zero.
    style = STYLE_UNKNOWN;
    lapOpaqueCount += 1;
    detail = 'sizes withheld — cross-origin without Timing-Allow-Origin';
  }

  return {
    message: `%c[cache] ${delivery.toUpperCase()}%c ${category} %c${path}%c  ${detail}`,
    styles: [style, STYLE_DIM, '', STYLE_DIM],
    networkBytes: delivery === 'network' ? entry.transferSize : 0,
    fromCache: delivery === 'cache',
    severe: false,
  };
}

function print(line: DetailLine): void {
  if (line.severe) console.warn(line.message, ...line.styles);
  else console.log(line.message, ...line.styles);
}

/**
 * Print one observer batch: warnings at top level, everything else folded into a single line.
 *
 * The batch is the natural unit — the browser hands over resources that completed together, and the
 * `buffered: true` replay arrives as one big first batch, which is exactly the twenty-line wall this
 * grouping is for. The group opens and closes inside this call, so it can never swallow logs from
 * elsewhere in the app.
 */
function reportBatch(entries: readonly (PerformanceResourceTiming & ResourceTimingExtras)[]): void {
  const lines: DetailLine[] = [];
  entries.forEach((entry) => {
    const line = record(entry);
    if (line) lines.push(line);
  });
  if (lines.length === 0) return;

  lines.filter((line) => line.severe).forEach(print);

  const details = lines.filter((line) => !line.severe);
  if (details.length === 0) return;
  if (details.length === 1) {
    print(details[0]);
    return;
  }

  const batchNetworkBytes = lines.reduce((total, line) => total + line.networkBytes, 0);
  const batchCacheCount = lines.filter((line) => line.fromCache).length;
  console.groupCollapsed(
    `%c[cache]%c ${lines.length} resources · ${formatBytes(batchNetworkBytes)} over the wire · ` +
      `${batchCacheCount} from cache`,
    STYLE_HEADER,
    STYLE_DIM,
  );
  details.forEach(print);
  console.groupEnd();
}

/**
 * The lap's answer, in words.
 *
 * Only printed from the second lap on, because on the first one "nothing was evicted" is trivially
 * true and says nothing.
 */
function lapVerdict(): { text: string; style: string } {
  if (lapRedownloads > 0) {
    const subject = lapRedownloads === 1 ? 'resource was' : 'resources were';
    return {
      text: `${lapRedownloads} ${subject} paid for twice this lap — caching IS the lever. See the warnings above.`,
      style: STYLE_WARN,
    };
  }
  if (lapNetworkCount === 0) {
    return {
      text:
        'Nothing touched the network. Everything this lap needed was still resident, so caching is ' +
        'not what makes the first run slow — doing the work earlier is.',
      style: STYLE_CACHE,
    };
  }
  return {
    text: `${lapNetworkCount} first-time fetches, 0 re-downloads. Nothing was evicted.`,
    style: STYLE_CACHE,
  };
}

/** One row per category that saw any traffic. Categories with nothing to say are left out. */
function summaryRows(): Record<string, Record<string, number | string>> {
  const rows: Record<string, Record<string, number | string>> = {};
  CATEGORY_ORDER.forEach((category) => {
    const stats = lapStats.get(category);
    if (!stats) return;
    rows[category] = {
      'over the wire': stats.networkCount,
      KB: Math.round(stats.networkBytes / 1024),
      'from cache': stats.cacheCount,
      slowest: stats.networkCount > 0 ? `${Math.round(stats.slowestMs)} ms` : '—',
    };
  });
  return rows;
}

/**
 * Print what the lap just cost and reset the counters.
 *
 * This is the number the whole module is for. On the first pass it should be large; if the lap after
 * the loop is near zero, nothing is being re-fetched and the cache was never the thing making the
 * first run slow.
 */
function summarise(nextLabel: string): void {
  // The bundle caveat is only true of a dev server. A preview is measuring the real minified build,
  // and labelling that "not a real number" would throw away the one figure worth having.
  const bundleNote = process.env.NODE_ENV === 'development' ? ' (unminified — not a real number)' : '';
  const opaqueNote = lapOpaqueCount > 0 ? ` · ${lapOpaqueCount} cross-origin, sizes withheld` : '';

  // The headline keeps its original meaning — what this lap actually pulled over the wire — and the
  // cache line is added only when there is one, so an ordinary cold load reads exactly as it always did.
  console.log(
    // ⚠ "over the wire" goes BEFORE `opaqueNote`, not after. The first cut appended it at the end of
    // the clause and produced "2 cross-origin, sizes withheld over the wire", which reads as a claim
    // about the withheld sizes rather than about the totals.
    `%c[cache] ── ${lapLabel} complete ──%c  ${formatBytes(lapSiteBytes)} site assets · ` +
      `${formatBytes(lapBuildBytes)} bundle${bundleNote} over the wire${opaqueNote} · ` +
      `${seen.size} distinct URLs this session` +
      (lapCacheCount > 0
        ? `\n  …plus ${formatBytes(lapSiteCacheBytes)} site + ${formatBytes(lapBuildCacheBytes)} bundle ` +
          `from CACHE across ${lapCacheCount} request${lapCacheCount === 1 ? '' : 's'} ` +
          `(decoded size — not comparable with the wire figures above)`
        : ''),
    STYLE_HEADER,
    STYLE_DIM,
  );

  if (previousLap) {
    console.log(
      `%c[cache] vs ${previousLap.label}:%c  ${previousLap.networkCount} → ${lapNetworkCount} requests ` +
        `over the wire, ${formatBytes(previousLap.networkBytes)} → ${formatBytes(lapNetworkBytes)}`,
      STYLE_HEADER,
      '',
    );
    const verdict = lapVerdict();
    console.log(`%c${verdict.text}`, verdict.style);
  }

  const rows = summaryRows();
  if (Object.keys(rows).length > 0) console.table(rows);

  previousLap = { label: lapLabel, networkCount: lapNetworkCount, networkBytes: lapNetworkBytes };
  lapLabel = nextLabel;
  lapNetworkBytes = 0;
  lapNetworkCount = 0;
  lapCacheCount = 0;
  lapSiteBytes = 0;
  lapBuildBytes = 0;
  lapSiteCacheBytes = 0;
  lapBuildCacheBytes = 0;
  lapRedownloads = 0;
  lapOpaqueCount = 0;
  lapStats.clear();
}

/**
 * Begin reporting. Idempotent, and a no-op outside development.
 *
 * Safe to call from a component effect: StrictMode's double-mount hits the `started` guard, and the
 * observer is deliberately never torn down — it is page-lifetime by nature and the page has one.
 */
export function startCacheTelemetry(): void {
  if (!telemetryEnabled) return;
  if (started || typeof PerformanceObserver === 'undefined') return;
  started = true;

  performance.setResourceTimingBufferSize?.(RESOURCE_BUFFER_SIZE);

  // `buffered` replays everything already in the buffer, so resources that landed before this ran —
  // the document, the first chunks, the preloaded star — are reported too rather than missed.
  new PerformanceObserver((list) => {
    reportBatch(list.getEntries() as (PerformanceResourceTiming & ResourceTimingExtras)[]);
  }).observe({ type: 'resource', buffered: true });

  window.addEventListener(REVEAL_EVENT, () => summarise('lap'), { once: true });
  // The loop does NOT reload the page, which is exactly the point: whatever it re-fetches is a real
  // cache miss, and whatever it does not is work that was simply never thrown away.
  window.addEventListener(LOOP_RESET_EVENT, () => summarise('lap'));
}
