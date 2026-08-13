import { telemetryEnabled } from '@/lib/telemetryEnabled';

/**
 * Keeps a plain-text copy of everything this site logs, so a whole session can be handed over.
 *
 * ── Why not just use DevTools ────────────────────────────────────────────────────────────────────
 * Chrome's *Save as…* on the console does most of this and needs no code. What it cannot do is
 * survive the console's own buffer limit — a `[frame]` report every three seconds plus the cache
 * telemetry fills that quickly, and the interesting part is usually the beginning, which is what gets
 * dropped. It also carries the `%c` styling directives into the file as literal text.
 *
 * ⚠ It patches `console`, which is a heavy-handed thing to do and is why it is fenced behind
 * `telemetryEnabled` — a build-time constant, so a production bundle contains none of this. The
 * alternative was to route every instrument through a logger of our own, which would have meant
 * touching six files and would still have missed anything logged by a library.
 *
 * ⚠ It installs at MODULE SCOPE rather than from an effect. React effects run after the first commit,
 * and `[voidix] device tier` and the first `[cache]` lines are already out by then — an instrument
 * that misses the start of the session is most of the way to useless.
 */

/** Enough for a long session at one `[frame]` report every three seconds; oldest lines fall off. */
const MAX_ENTRIES = 5000;

const entries: string[] = [];
let startedAt = 0;
let installed = false;

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'table';

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    // Circular, or a DOM node. `String()` at least names it.
    return String(value);
  }
}

/**
 * Flatten one console call to text.
 *
 * ⚠ `%c` is the case that matters here. Every styled instrument on this site passes its CSS as
 * TRAILING arguments — one per directive — so the directives have to be stripped AND that many
 * arguments dropped, or the file ends up full of `color:#5bd6a0;font-weight:700`.
 */
function formatArguments(args: unknown[]): string {
  if (args.length === 0) return '';
  const [first, ...rest] = args;
  if (typeof first === 'string' && first.indexOf('%c') !== -1) {
    const directiveCount = (first.match(/%c/g) ?? []).length;
    return [first.replace(/%c/g, ''), ...rest.slice(directiveCount).map(stringify)].join(' ');
  }
  return args.map(stringify).join(' ');
}

function record(method: ConsoleMethod, args: unknown[]): void {
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1).padStart(7);
  const prefix = method === 'log' ? '' : `[${method}] `;
  entries.push(`${seconds}s  ${prefix}${formatArguments(args)}`);
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/** The whole capture, oldest first, with a short header naming the machine it came from. */
function renderLog(): string {
  const header = [
    `voidix console capture`,
    `  ${new Date().toISOString()}`,
    `  ${window.location.href}`,
    `  ${navigator.userAgent}`,
    `  viewport ${window.innerWidth}×${window.innerHeight} · dpr ${window.devicePixelRatio}` +
      ` · cores ${navigator.hardwareConcurrency ?? '?'}`,
    `  ${entries.length} lines`,
    '',
  ].join('\n');
  return header + entries.join('\n') + '\n';
}

function downloadLog(): string {
  const blob = new Blob([renderLog()], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `voidix-console-${Date.now()}.txt`;
  link.click();
  // Revoked on a later task — revoking synchronously can beat the download starting in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `${entries.length} lines downloading`;
}

interface VoidixConsoleApi {
  /** The capture as a string. Returned rather than logged, so it does not capture itself. */
  text(): string;
  /** Copy to the clipboard. Needs the page focused — click the page once if it refuses. */
  copy(): Promise<string>;
  /** Save as a .txt. The reliable one: no permissions, no focus requirement, no size limit. */
  download(): string;
  /** Start again from here. */
  clear(): string;
  /**
   * POST the capture to `/api/telemetry`, which re-logs it into Vercel's runtime logs.
   *
   * ⚠ Optional because it is installed by a DIFFERENT module — `TelemetryConsole/telemetryBeacon.ts`
   * — and only where that module is mounted. This file knows nothing about it and must not: the
   * capture has to work on its own, on a page with no network and no route behind it. The beacon
   * exists for one platform's inability to attach a console (iOS from Windows); the capture exists
   * for everyone.
   */
  send?(): string;
}

declare global {
  // eslint-disable-next-line no-var
  var voidix: VoidixConsoleApi | undefined;
}

function install(): void {
  if (installed || typeof window === 'undefined' || !telemetryEnabled) return;
  installed = true;
  startedAt = performance.now();

  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'table'];
  for (const method of methods) {
    const original = console[method].bind(console);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any)[method] = (...args: unknown[]) => {
      try {
        record(method, args);
      } catch {
        // Recording must never be the reason a log does not appear.
      }
      original(...args);
    };
  }

  window.voidix = {
    text: renderLog,
    copy: async () => {
      const text = renderLog();
      await navigator.clipboard.writeText(text);
      return `${entries.length} lines copied`;
    },
    download: downloadLog,
    clear: () => {
      entries.length = 0;
      startedAt = performance.now();
      return 'cleared';
    },
  };

  console.log(
    `%c[voidix] console capture on%c — voidix.download() saves a .txt · voidix.copy() to clipboard` +
      ` · voidix.text() returns it · voidix.clear() restarts`,
    'color:#5bd6a0;font-weight:700',
    'color:#888',
  );
}

install();

export {};
