import { createInitialState, type SunLabState } from "./sunLabState";
import { PEACEFUL_PRESET } from "./sunLabPresets";

// A snapshot is nothing more than a named capture of the editor's numbers (a full SunLabState). "The 3
// stages" are just three snapshots — the tool never hardcodes the count. Everything the editor can do
// automatically participates, because a snapshot IS the whole state.

export interface SunLabSnapshot {
  id: string;
  name: string;
  state: SunLabState;
}

/**
 * A duplicated object. It's DOCUMENT-level (shared across every stage — a structural addition to the
 * model), cloned from `sourceId` on load. Its per-stage pose/material lives in each snapshot's
 * `objects[id]` like any other object.
 */
export interface AddedObject {
  id: string;
  sourceId: string;
}

export interface SunLabDocument {
  snapshots: SunLabSnapshot[];
  /** The snapshot currently loaded for editing. */
  activeId: string;
  /** Objects duplicated in the editor, shared across all snapshots. */
  addedObjects: AddedObject[];
}

let addedCounter = 0;
export function createAddedObjectId(sourceId: string): string {
  addedCounter += 1;
  return `${sourceId}~copy${addedCounter}`;
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
  // Fresh users open on the authored Peaceful stage rather than a blank default.
  const first = createSnapshot(PEACEFUL_PRESET.name, structuredClone(PEACEFUL_PRESET.state));
  return { snapshots: [first], activeId: first.id, addedObjects: [] };
}

export function activeSnapshot(document: SunLabDocument): SunLabSnapshot {
  return document.snapshots.find((snapshot) => snapshot.id === document.activeId) ?? document.snapshots[0];
}
