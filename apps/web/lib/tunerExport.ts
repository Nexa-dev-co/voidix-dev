/**
 * Turning what you tuned back into source you can paste.
 *
 * Every authoring panel edits a plain object of numbers, strings and booleans, live. That's what makes
 * the panels work at all — but it also means the result only exists in memory, and the whole point of
 * an authoring session is to end up with values in a file. So each panel registers a function that
 * prints its own state as TypeScript, and the dock offers one button that collects all of them.
 *
 * One button rather than one per panel, because the thing being handed over is a SESSION: you moved the
 * camera, then the walls, then a hull's palette, and copying those one at a time is how a set of values
 * that only make sense together gets split up and half-applied.
 */

/** Round only what needs it — an authored 0.1 should not come back as 0.10000000000000009. */
function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    return String(Number.isInteger(value) ? value : Number(value.toFixed(4)));
  }
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    // A flat list (hidden part ids) stays on one line; a list of objects gets a line each, because that
    // is how the key arrays are written by hand and a diff against them should be readable.
    const isFlat = value.every(
      (entry) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean',
    );
    if (isFlat) return `[${value.map(formatValue).join(', ')}]`;
    return [
      '[',
      ...value.map((entry) => `    ${formatObjectInline(entry as Record<string, unknown>)},`),
      '  ]',
    ].join('\n');
  }
  if (value && typeof value === 'object') {
    return formatObjectInline(value as Record<string, unknown>);
  }
  return String(value);
}

function formatObjectInline(source: Record<string, unknown>): string {
  const body = Object.entries(source)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(', ');
  return `{ ${body} }`;
}

/**
 * Print a tuning object as assignable source lines.
 *
 * `skipKeys` is for fields that have their own dedicated exporter — the camera key arrays, mainly, which
 * belong in their own named `const` rather than inline in the tuning literal.
 */
export function formatTuningSource(
  tuning: object,
  skipKeys: readonly string[] = [],
): string {
  return Object.entries(tuning)
    .filter(([key]) => !skipKeys.includes(key))
    .map(([key, value]) => `  ${key}: ${formatValue(value)},`)
    .join('\n');
}

// ── The registry ──
const sections = new Map<string, () => string>();

/**
 * Offer a panel's state to the "copy all" button. Registering the same label twice replaces it, so a
 * panel that is torn down and rebuilt can't leave a stale snapshot behind.
 */
export function registerTuningExport(label: string, print: () => string): () => void {
  sections.set(label, print);
  return () => {
    sections.delete(label);
  };
}

/** Everything currently registered, in one pasteable block. */
export function collectTuningExport(): string {
  if (sections.size === 0) return '// nothing registered — no authoring panel is open.';
  return Array.from(sections.entries())
    .map(([label, print]) => `// ── ${label} ${'─'.repeat(Math.max(2, 76 - label.length))}\n${print()}`)
    .join('\n\n');
}

/**
 * Copy to the clipboard, and always log as well.
 *
 * The clipboard needs a secure context and a user gesture. A button click is a gesture, but plain http
 * on a LAN address is not a secure context — and that is exactly how this gets used from a phone. The
 * console log is the fallback that always works.
 */
export function copyTuningExport(): void {
  const source = collectTuningExport();
  navigator.clipboard?.writeText(source).catch(() => {});
  console.log(source);
}
