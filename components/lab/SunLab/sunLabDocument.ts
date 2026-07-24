import { createInitialState, type SunLabState } from "./sunLabState";

// A snapshot is nothing more than a named capture of the editor's numbers (a full SunLabState). "The 3
// stages" are just three snapshots — the tool never hardcodes the count. Everything the editor can do
// automatically participates, because a snapshot IS the whole state.

export interface SunLabSnapshot {
  id: string;
  name: string;
  state: SunLabState;
}

export interface SunLabDocument {
  snapshots: SunLabSnapshot[];
  /** The snapshot currently loaded for editing. */
  activeId: string;
}

let idCounter = 0;
export function createSnapshotId(): string {
  idCounter += 1;
  return `snap-${Date.now().toString(36)}-${idCounter}`;
}

export function createSnapshot(name: string, state = createInitialState()): SunLabSnapshot {
  return { id: createSnapshotId(), name, state };
}

export function createInitialDocument(): SunLabDocument {
  const first = createSnapshot("Stage 1");
  return { snapshots: [first], activeId: first.id };
}

export function activeSnapshot(document: SunLabDocument): SunLabSnapshot {
  return document.snapshots.find((snapshot) => snapshot.id === document.activeId) ?? document.snapshots[0];
}
