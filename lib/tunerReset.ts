/**
 * Putting a tuning object back the way it shipped.
 *
 * ── Why this can't just reassign ─────────────────────────────────────────────────────────────────
 * Every scene holds its tuning BY REFERENCE — that reference is the whole mechanism, it's what lets a
 * slider take effect on the next frame with nothing to rebuild. So a reset must not hand back a new
 * object; it has to restore the existing one in place, field by field.
 *
 * The same is true one level down. `worksTuning.keys` is captured by the works scene as `viewKeys`, and
 * a ship's `hiddenParts` is captured by the deck panel as `placement.hiddenParts`. Replacing either
 * array would leave those holders pointing at the old one, and the reset would appear to do nothing —
 * so arrays are emptied and refilled rather than swapped.
 */

/** A pristine copy, taken at module load before anything can touch it. */
export function snapshotDefaults<T>(value: T): T {
  return structuredClone(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Copy `defaults` onto `target`, preserving the identity of `target` and of every array inside it.
 */
export function restoreInPlace<T extends object>(target: T, defaults: T): void {
  const targetRecord = target as Record<string, unknown>;
  const defaultsRecord = defaults as unknown as Record<string, unknown>;

  for (const key of Object.keys(defaultsRecord)) {
    const nextValue = defaultsRecord[key];
    const currentValue = targetRecord[key];

    if (Array.isArray(nextValue) && Array.isArray(currentValue)) {
      // Empty and refill — see the note above about who is holding these arrays.
      currentValue.length = 0;
      nextValue.forEach((entry) => currentValue.push(structuredClone(entry)));
      continue;
    }
    if (isPlainObject(nextValue) && isPlainObject(currentValue)) {
      restoreInPlace(currentValue, nextValue);
      continue;
    }
    targetRecord[key] = structuredClone(nextValue);
  }
}

// ── The registry ──
// Mirrors the export registry: each panel offers a reset, and the dock has one button that runs all of
// them. A panel's reset also has to put its own UI back in step (lil-gui caches displayed values) and
// re-run whatever it had rebuilt, which is why the panel registers a closure rather than the raw
// restore.
const resets = new Map<string, () => void>();

export function registerTuningReset(label: string, reset: () => void): () => void {
  resets.set(label, reset);
  return () => {
    resets.delete(label);
  };
}

/** Run every registered reset. Returns how many ran, so the dock can say so. */
export function resetAllTuning(): number {
  resets.forEach((reset) => reset());
  return resets.size;
}
