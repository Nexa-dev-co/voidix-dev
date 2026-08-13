import { DECK_SERVICES } from '@/components/sections/ServicesDeck/deckServices';
import { WORKS_PROJECTS } from '@/components/sections/WorksField/worksProjects';
import { DISCIPLINES } from '@/lib/enquirySubjects';
import type { FetchedRelease } from '@/lib/cms/fetchPublishedContent';
import { logContentReport } from '@/lib/cms/logContentReport';
import type { PublishedContent } from '@/lib/cms/publishedContent';
import { telemetryEnabled } from '@/lib/telemetryEnabled';

/**
 * Which of this render's words came from the panel, and which came from this repo.
 *
 * ── ⚠ WHY THIS IS PER KEY AND NOT PER PAGE ──────────────────────────────────────────────────────
 * The nine payload keys resolve INDEPENDENTLY, and each one falls back on its own terms. A page can
 * therefore be eight-ninths connected and look completely fine — the fleet reading the panel while
 * the FAQ quietly serves seven placeholder answers. "Did the panel answer?" is one boolean and it
 * cannot see that; this can.
 *
 * ⚠ TWO OF THE CONDITIONS ARE NOT "IS IT NULL", and they are the ones worth having this file for.
 * `resolveDeckServices` and `resolveWorksProjects` discard the panel's copy ENTIRELY when the number
 * published differs from the number of models in this build — because `deckTuning.ts` keys ship
 * placements by array position, so a fifth service would bind every placement to the wrong vessel.
 * Publish a fifth service and the fleet silently reverts to this repo's four, with correct-looking
 * copy and no visible fault. That is the exact failure this report exists to make loud.
 *
 * ── ⚠ IT MIRRORS THE RESOLVERS; IT DOES NOT ASK THEM ────────────────────────────────────────────
 * Each verdict below re-states the condition inside the matching `resolve*` function, because those
 * return finished content and not a note about where it came from. That duplication is the cost of
 * not making every resolver return a tuple, and it has one real failure mode: change a resolver's
 * fallback rule and this file will confidently report the old one. The rules are listed against
 * their owners for that reason — if you touch one, touch its line here.
 *
 * ── Nothing here runs in production ─────────────────────────────────────────────────────────────
 * `telemetryEnabled` is a build-time constant, so a production bundle folds these calls to nothing
 * and the report is never built, never logged and never serialised into the RSC payload. That last
 * one matters: `siteContent.ts`'s header measured an unwanted 11.1 kB of RSC bytes as 28 % of
 * `/about`'s HTML, and a diagnostic has no business spending any of that on a real visitor.
 */

/** Where one key's words actually came from. */
export type ContentKeySource = 'panel' | 'fallback';

export interface ContentKeyReport {
  key: string;
  source: ContentKeySource;
  /**
   * What is worth knowing beyond the verdict — a count when the count is the thing that can be
   * wrong, and the REASON whenever a key fell back while the panel was otherwise answering. A
   * fallback with no explanation just moves the question along.
   */
  detail?: string;
}

export interface ContentReport {
  /** The route that assembled it, so two tabs' logs can be told apart. */
  route: string;
  /** Null unless the panel answered. */
  version: number | null;
  publishedAt: string | null;
  /** Why the panel's answer was what it was — carried verbatim from the fetch. */
  outcome: FetchedRelease['outcome'];
  keys: ContentKeyReport[];
}

/**
 * Which keys a route actually resolves.
 *
 * ⚠ `'shared'` is not a smaller version of `'full'` by accident — the document routes deliberately
 * do not resolve the four scene keys, so that the fleet's and the field's copy never reaches
 * `/about`'s HTML. Reporting keys a route never asked for would invent a fallback that never
 * happened.
 */
export type ContentScope = 'full' | 'shared';

interface BuildOptions {
  route: string;
  release: FetchedRelease;
  scope: ContentScope;
  /** The document routes' own key, resolved outside the shared set. */
  pageKey?: 'about' | 'careers';
}

/**
 * What every route calls: builds the report, prints it to the terminal, and hands it back for the
 * browser to print too.
 *
 * ⚠ ONE GATE, HERE, and it is why this returns `ContentReport | undefined` rather than a report.
 * `telemetryEnabled` is a build-time constant, so in production this folds to `return undefined`
 * and the bundler drops `buildContentReport` and everything it reached for. That also means each
 * route passes `report={undefined}` to the provider, so not one byte of diagnostic reaches a real
 * visitor's RSC payload — which is the property `siteContent.ts` split the payload to protect.
 */
export function reportContent(options: BuildOptions): ContentReport | undefined {
  if (!telemetryEnabled) return undefined;

  const report = buildContentReport(options);
  // The server's copy. The browser prints the same object from `SiteContentProvider`, so a render
  // that never reaches the client — a build, a bot, a curl — still says where its words came from.
  logContentReport(report);

  return report;
}

export function buildContentReport({
  route,
  release,
  scope,
  pageKey,
}: BuildOptions): ContentReport {
  const payload = release.payload;

  const keys: ContentKeyReport[] = [];

  if (scope === 'full') {
    keys.push(
      describeCountedList(
        'services',
        payload?.services,
        DECK_SERVICES.length,
        'vessels',
        release,
      ),
      describeCountedList('projects', payload?.projects, WORKS_PROJECTS.length, 'marks', release),
      describeList('faq', payload?.faq, 'answers', release),
      describeObject('contact', payload?.contact, release),
    );
  }

  keys.push(describeFooter(payload, release), describeDisciplines(payload, release));
  keys.push(describeObject('enquiryForm', payload?.enquiryForm, release));

  if (pageKey) {
    keys.push(describeObject(pageKey, payload?.[pageKey], release));
  }

  return {
    route,
    version: release.version,
    publishedAt: release.publishedAt,
    outcome: release.outcome,
    keys,
  };
}

/**
 * The reason a key fell back, given what happened at the fetch.
 *
 * When the panel never answered, every key has the same cause and repeating it nine times is noise
 * — so it is said once in the header and left off each line.
 */
function fallbackDetail(release: FetchedRelease, reasonWhenReached: string): string | undefined {
  return release.outcome === 'panel' ? reasonWhenReached : undefined;
}

/** `contact`, `enquiryForm`, `about`, `careers` — all four fall back on exactly "is it null". */
function describeObject(
  key: string,
  value: unknown,
  release: FetchedRelease,
): ContentKeyReport {
  if (!value) {
    return {
      key,
      source: 'fallback',
      detail: fallbackDetail(release, 'never saved in the panel'),
    };
  }
  return { key, source: 'panel' };
}

/** `faq` — falls back on null or empty. */
function describeList(
  key: string,
  list: unknown[] | undefined,
  noun: string,
  release: FetchedRelease,
): ContentKeyReport {
  if (!list || list.length === 0) {
    return { key, source: 'fallback', detail: fallbackDetail(release, `no ${noun} published`) };
  }
  return { key, source: 'panel', detail: `${list.length} ${noun}` };
}

/**
 * `services` and `projects` — the two that also fall back on a COUNT MISMATCH.
 *
 * ⚠ This is the branch the whole file is worth writing for. Publishing a fifth service produces a
 * page that looks entirely correct and is serving none of the panel's words.
 */
function describeCountedList(
  key: string,
  list: unknown[] | undefined,
  expectedCount: number,
  noun: string,
  release: FetchedRelease,
): ContentKeyReport {
  if (!list || list.length === 0) {
    return { key, source: 'fallback', detail: fallbackDetail(release, `nothing published`) };
  }

  if (list.length !== expectedCount) {
    return {
      key,
      source: 'fallback',
      detail: `panel published ${list.length}, this build has ${expectedCount} ${noun}`,
    };
  }

  return { key, source: 'panel', detail: `${list.length} ${noun}` };
}

/** `footer` — null OR no groups, because a footer with no links is not a published footer. */
function describeFooter(
  payload: PublishedContent | null,
  release: FetchedRelease,
): ContentKeyReport {
  const footer = payload?.footer;

  if (!footer || footer.groups.length === 0) {
    return {
      key: 'footer',
      source: 'fallback',
      detail: fallbackDetail(release, footer ? 'published with no link groups' : 'never saved'),
    };
  }

  return { key: 'footer', source: 'panel', detail: `${footer.groups.length} groups` };
}

/**
 * `disciplines` — the one key that MERGES rather than choosing.
 *
 * ⚠ `resolveDisciplines` starts from this repo's four and overwrites each one the panel names,
 * ignoring any key it does not recognise. So the honest verdict is a fraction: three published
 * disciplines leave the fourth on repo copy while the key as a whole is genuinely connected, and
 * calling that either "panel" or "fallback" would be a lie in one direction or the other.
 */
function describeDisciplines(
  payload: PublishedContent | null,
  release: FetchedRelease,
): ContentKeyReport {
  const published = payload?.disciplines;
  const total = Object.keys(DISCIPLINES).length;

  if (!published || published.length === 0) {
    return {
      key: 'disciplines',
      source: 'fallback',
      detail: fallbackDetail(release, 'none published'),
    };
  }

  const recognised = published.filter((entry) => entry.key in DISCIPLINES).length;

  return {
    key: 'disciplines',
    source: recognised === total ? 'panel' : 'fallback',
    detail: `${recognised} of ${total} recognised`,
  };
}

/**
 * ⚠ Printing lives in `logContentReport.ts`, deliberately, and not because two files are tidier.
 * The browser logs this report too, and `SiteContentProvider` is a client component — so anything
 * the printer imports lands in the client bundle. This module reaches for `DECK_SERVICES`,
 * `WORKS_PROJECTS` and `DISCIPLINES` to check its counts, which is the fleet's, the field's and the
 * form's entire fallback copy. Keeping the printer free of those imports is what stops a diagnostic
 * shipping the very content it exists to tell you was not used.
 */
