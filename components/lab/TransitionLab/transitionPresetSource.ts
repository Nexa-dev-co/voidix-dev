import type {
  TransitionTuning,
  TuningControl,
} from '@/components/sections/WorksField/transitions/markTransition';

/**
 * Turn a transition tuning session into source you can paste.
 *
 * Same job as the letter lab's `markPresetSource`, and the same reason for existing: the panel edits
 * numbers that only live in memory, and the point of an authoring session is to end up with values in a
 * file. Without this the rig could be tuned for an hour and the result was gone on refresh.
 *
 * ── Why it is not `formatTuningSource` ───────────────────────────────────────────────────────────
 * That helper prints `key: value,` and nothing else, which is right for the `?tune` panels because their
 * keys are self-describing. Here they are not. A strategy's tuning is a flat bag of numbers whose
 * meaning lives entirely in its `TuningControl` list, so a bare `arrival: 2` tells you nothing — and
 * `2` is not even a quantity, it is the index of "Extend". The control list is the only thing that can
 * decode that, so the printer takes it and annotates every line.
 *
 * ── Why it marks what changed ────────────────────────────────────────────────────────────────────
 * Accretion declares forty-odd knobs and a session usually moves five. Handing over forty numbers with
 * no indication of which ones were decisions is how a tuning session becomes unreviewable — the reader
 * cannot tell an authored value from a default that came along for the ride. Every line that differs
 * from its declared default says so.
 */

const HEADER_WIDTH = 78;

/** Same rounding as `lib/tunerExport` — an authored 0.1 must not come back as 0.10000000000000009. */
function formatNumber(value: number): string {
  return String(Number.isInteger(value) ? value : Number(value.toFixed(4)));
}

/** What a non-quantity value actually means, so a bare index in the paste is not a mystery. */
function describeValue(control: TuningControl, value: number): string {
  if (control.kind === 'choice') return control.options?.[Math.round(value)] ?? '';
  if (control.kind === 'toggle') return value > 0.5 ? 'on' : 'off';
  return '';
}

/** `Accretion` → `ACCRETION_TUNING`, so the block is pasteable as-is rather than needing a name. */
function constantName(strategyLabel: string): string {
  const slug = strategyLabel
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return `${slug || 'TRANSITION'}_TUNING`;
}

export function formatTransitionPresetSource(
  strategyLabel: string,
  controls: TuningControl[],
  tuning: TransitionTuning,
): string {
  if (controls.length === 0) {
    return `// ${strategyLabel} declares no tuning controls — there is nothing to export.`;
  }

  // Padded to the widest key so the values and their labels line up in a column. A wall of ragged
  // `key: value, // Label` is exactly as hard to scan as the raw object it replaced.
  const widestKey = controls.reduce(
    (widest, control) => Math.max(widest, control.key.length),
    0,
  );

  let changedCount = 0;
  const lines = controls.map((control) => {
    const value = tuning[control.key] ?? control.value;
    const meaning = describeValue(control, value);
    const isChanged = value !== control.value;
    if (isChanged) changedCount += 1;

    const assignment = `  ${control.key}:`.padEnd(widestKey + 4);
    const printed = `${formatNumber(value)},`.padEnd(12);
    const note = meaning ? `${control.label} · ${meaning}` : control.label;
    const changed = isChanged ? `   CHANGED from ${formatNumber(control.value)}` : '';
    return `${assignment}${printed}// ${note}${changed}`;
  });

  return [
    `// ── ${strategyLabel} — tuning session ${'─'.repeat(
      Math.max(2, HEADER_WIDTH - strategyLabel.length - 19),
    )}`,
    `// Paste each number into the matching control's \`value:\` in that strategy's control list`,
    `// (components/sections/WorksField/transitions/).`,
    '//',
    changedCount === 0
      ? '// Nothing differs from the declared defaults — this is the shipped tuning.'
      : `// ${changedCount} of ${controls.length} differ from the declared defaults, marked CHANGED.`,
    `const ${constantName(strategyLabel)} = {`,
    ...lines,
    '};',
  ].join('\n');
}
