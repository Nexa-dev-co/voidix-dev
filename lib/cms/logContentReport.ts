import type { ContentReport } from '@/lib/cms/contentReport';
import { telemetryEnabled } from '@/lib/telemetryEnabled';

/**
 * Prints one content report — on the server during the render, and again in the browser.
 *
 * ── ⚠ WHY THIS IS NOT IN `contentReport.ts` ─────────────────────────────────────────────────────
 * The browser needs this function and `SiteContentProvider` is a client component, so whatever this
 * module imports goes into the client bundle. `contentReport.ts` imports `DECK_SERVICES`,
 * `WORKS_PROJECTS` and `DISCIPLINES` in order to check its counts — the fleet's, the field's and the
 * form's entire fallback copy. A diagnostic that shipped the content it exists to warn you about
 * would be a poor joke, so the type comes across (erased at compile time) and nothing else does.
 *
 * ── ⚠ ONE RENDERER FOR TWO CONSOLES, AND `%c` IS WHY IT WORKS ───────────────────────────────────
 * Node's `util.format` accepts `%c`, discards the directive and SKIPS the CSS argument after it, so
 * the same call that draws colour in a browser prints clean unstyled text in the terminal. That is
 * also the contract `telemetryLog`'s capture relies on: every `%c` must be matched by exactly one
 * trailing style argument, or the downloaded log fills with `color:#5bd6a0;font-weight:700`.
 *
 * ⚠ Silent in production. `telemetryEnabled` is a build-time constant, so the check below folds to
 * `false` and the bundler drops the whole call — visitors do not get a console full of
 * instrumentation, exactly as the other instruments on this site behave.
 */

/** Green for the panel's own words, amber — the brand's `--heat-600` — for this repo's. */
const PANEL_STYLE = 'color:#5bd6a0;font-weight:700';
const FALLBACK_STYLE = 'color:#ff8a1a;font-weight:700';
const LABEL_STYLE = 'color:#5bd6a0;font-weight:700';
const QUIET_STYLE = 'color:#888';

/** Wide enough for `disciplines`, the longest key. Keeps the verdicts in one column. */
const KEY_COLUMN_WIDTH = 13;

export function logContentReport(report: ContentReport): void {
  if (!telemetryEnabled) return;

  const lines: string[] = [`%c[content]%c ${report.route} · ${describeOutcome(report)}`];
  const styles: string[] = [LABEL_STYLE, QUIET_STYLE];

  for (const entry of report.keys) {
    // `PANEL` is padded to `FALLBACK`'s width so the details line up under each other — the column
    // is what makes a single amber row findable in a block of green ones at a glance.
    const verdict = entry.source === 'panel' ? 'PANEL   ' : 'FALLBACK';
    lines.push(
      `  ${entry.key.padEnd(KEY_COLUMN_WIDTH)}%c${verdict}%c${entry.detail ? `  ${entry.detail}` : ''}`,
    );
    styles.push(entry.source === 'panel' ? PANEL_STYLE : FALLBACK_STYLE, QUIET_STYLE);
  }

  console.log(lines.join('\n'), ...styles);
}

/**
 * The header's summary of what the fetch achieved.
 *
 * ⚠ Every branch except the first names something to go and do. "Falling back" is the symptom of
 * five different causes, and a log that reported only the symptom would send you to read the
 * resolvers when the actual answer is that nobody has pressed Publish.
 */
function describeOutcome(report: ContentReport): string {
  switch (report.outcome) {
    case 'panel':
      return `release v${report.version ?? '?'}${
        report.publishedAt ? ` · published ${formatTimestamp(report.publishedAt)}` : ''
      }`;
    case 'unconfigured':
      return 'panel not configured — VOIDIX_CMS_URL / VOIDIX_CMS_CONTENT_SECRET are unset';
    case 'nothing-published':
      return 'panel reached, but nothing has ever been published — press Publish in the panel';
    case 'unreachable':
      return 'panel unreachable — down, deploying, or slower than the 8 s timeout';
    case 'rejected':
      return 'panel refused the request — VOIDIX_CMS_CONTENT_SECRET and CONTENT_READ_SECRET disagree';
  }
}

function formatTimestamp(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? iso
    : when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
