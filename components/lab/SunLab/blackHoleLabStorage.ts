import { createBlackHoleInitialState, normalizeState, type SunLabState } from "./sunLabState";

// The "New black hole" tab persists its OWN state under a separate key — completely walled off from the
// sun document, so nothing the sun does can bleed into it. It reuses SunLabState (global = the black
// hole's scene look + transform + spin; objects/sharedMaterials = its per-part edits).

const STORAGE_KEY = "voidix:new-blackhole:v1";

export function loadBlackHoleState(): SunLabState {
  if (typeof window === "undefined") return createBlackHoleInitialState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createBlackHoleInitialState();
    return normalizeState(JSON.parse(raw) as SunLabState);
  } catch {
    return createBlackHoleInitialState();
  }
}

export function saveBlackHoleState(state: SunLabState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Non-fatal — the editor keeps working in memory.
  }
}

export function clearBlackHoleState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
