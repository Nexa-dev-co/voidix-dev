import type { SunLabState } from "./sunLabState";

// Serialises the authored state for the Copy button. Plain JSON for now — portable, pastes anywhere,
// and captures only what was changed (sparse overrides + globals + spread). If we later want a
// ready-to-paste TS const instead (the open question in the plan), it swaps in here without touching
// the HUD.
export function formatSunLabState(state: SunLabState): string {
  return JSON.stringify(state, null, 2);
}
