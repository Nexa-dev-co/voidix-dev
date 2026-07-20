import { useEffect, useState } from 'react';

/**
 * Hold a value still until it stops changing.
 *
 * The lab's panel drives work that is far too heavy to run per input event: rebuilding the swarm
 * re-carves five geometries and lays out six hundred chunks, and rebuilding the mix re-clones a
 * texture per material. Dragging a slider fires that on every pointer move, which makes the very
 * thing you're trying to judge stutter.
 *
 * So the UI reads the live value — sliders stay glued to the cursor — while the scene reads this one
 * and only catches up once you've settled. The first value passes through immediately, so nothing is
 * delayed on mount.
 */
export function useDebounced<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
