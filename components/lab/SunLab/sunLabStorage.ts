import type { SunLabDocument } from "./sunLabDocument";

// localStorage persistence for the whole document (all snapshots + which is active). Versioned so a
// future schema change can be detected and discarded rather than crashing the tool on stale data.

const STORAGE_KEY = "voidix:sun-lab:v1";

export function loadDocument(): SunLabDocument | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SunLabDocument;
    // Minimal shape check — enough to reject stale/garbage without a full schema validator.
    if (!parsed || !Array.isArray(parsed.snapshots) || parsed.snapshots.length === 0) return null;
    if (!parsed.snapshots.some((snapshot) => snapshot.id === parsed.activeId)) {
      parsed.activeId = parsed.snapshots[0].id;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDocument(document: SunLabDocument): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch {
    // Quota or privacy-mode failures are non-fatal — the tool keeps working in memory.
  }
}

export function clearDocument(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
