"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSunLabScene, type SunLabSceneHandle, type SunLabStatus } from "./hooks/useSunLabScene";
import {
  createInitialState,
  DEFAULT_GLOBAL_PARAMS,
  type GlobalParams,
  type MaterialParams,
  type ObjectOverride,
  type SunLabState,
} from "./sunLabState";
import { GROUP_LABELS } from "./sunLabModel";
import {
  activeSnapshot,
  createInitialDocument,
  createSnapshot,
  type SunLabDocument,
} from "./sunLabDocument";
import { loadDocument, saveDocument } from "./sunLabStorage";
import { formatSunLabState } from "./sunLabPresetSource";
import SnapshotBar from "./hud/SnapshotBar";
import ObjectTree from "./hud/ObjectTree";
import GlobalControls from "./hud/GlobalControls";
import { GroupPanel, MaterialPanel, ObjectPanel } from "./hud/ObjectControls";
import type { Selection } from "./hud/selection";

const COPY_FEEDBACK_MS = 1600;
const AUTOSAVE_DEBOUNCE_MS = 400;
// A burst of edits within this window (one slider drag) collapses into a single undo step.
const HISTORY_COALESCE_MS = 400;
const UNDO_LIMIT = 60;

// The Sun Lab shell. Owns the document (all snapshots), bridges every edit to the imperative scene
// handle, and layers snapshots / undo / autosave on top of the Phase-1 editor without changing it: an
// edit is still "update the numbers, mutate the scene" — it just writes into the active snapshot.
export default function SunLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<SunLabSceneHandle | null>(null);

  const [status, setStatus] = useState<SunLabStatus>({ isLoading: true, percent: -1 });
  const [ready, setReady] = useState(false);
  const [document, setDocument] = useState<SunLabDocument>(() => loadDocument() ?? createInitialDocument());
  const [selection, setSelection] = useState<Selection>({ kind: "global" });
  const [copied, setCopied] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const documentRef = useRef(document);
  documentRef.current = document;
  const undoStackRef = useRef<SunLabState[]>([]);
  const lastEditRef = useRef(0);

  const state = activeSnapshot(document).state;
  const currentState = () => activeSnapshot(documentRef.current).state;

  // ── State plumbing ──
  const setActiveState = (nextState: SunLabState) => {
    setDocument((previous) => ({
      ...previous,
      snapshots: previous.snapshots.map((snapshot) =>
        snapshot.id === previous.activeId ? { ...snapshot, state: nextState } : snapshot,
      ),
    }));
  };

  // Push the pre-edit state onto the undo stack, but only once per burst of edits (a drag is one step).
  const pushHistory = () => {
    const now = performance.now();
    if (now - lastEditRef.current > HISTORY_COALESCE_MS) {
      undoStackRef.current.push(currentState());
      if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
      setCanUndo(true);
    }
    lastEditRef.current = now;
  };

  const editActiveState = (updater: (previous: SunLabState) => SunLabState) => {
    pushHistory();
    setActiveState(updater(currentState()));
  };

  const resolvedTransform = (id: string, override: ObjectOverride | undefined) => {
    const defaults = handleRef.current?.registry.entriesById.get(id)?.defaults;
    return {
      visible: override?.visible ?? defaults?.visible ?? true,
      position: override?.position ?? defaults?.position ?? { x: 0, y: 0, z: 0 },
      rotation: override?.rotation ?? defaults?.rotation ?? { x: 0, y: 0, z: 0 },
      scale: override?.scale ?? defaults?.scale ?? { x: 1, y: 1, z: 1 },
    };
  };

  // Make the scene exactly match a state — used on snapshot switch, undo, reset, and first load.
  const applyFullState = useCallback((next: SunLabState) => {
    const handle = handleRef.current;
    const registry = handle?.registry;
    if (!handle || !registry) return;
    handle.applyGlobal(next.global);
    handle.applyFractureSpread(next.fractureSpread);
    // Shared materials first, so an un-cloned slot below already reflects the right value.
    registry.sharedMaterials.forEach((shared) => {
      handle.applySharedMaterial(shared.name, next.sharedMaterials[shared.name] ?? shared.defaults);
    });
    registry.entries.forEach((entry) => {
      handle.applyObjectTransform(entry.id, resolvedTransform(entry.id, next.objects[entry.id]));
      entry.materialSlots.forEach((_, slot) => {
        const override = next.objects[entry.id]?.materials?.[slot];
        if (override) handle.applyObjectMaterial(entry.id, slot, override);
        else handle.setObjectMaterialToShared(entry.id, slot);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onReady = useCallback(
    (handle: SunLabSceneHandle) => {
      handleRef.current = handle;
      // Reflect the loaded/active snapshot onto this scene. Runs on every ready (incl. a StrictMode
      // remount's fresh scene), and it's idempotent — so the viewport always matches the numbers.
      applyFullState(currentState());
      setReady(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyFullState],
  );

  useSunLabScene({ canvasRef, onReady, onStatus: setStatus });

  // ── Autosave ──
  useEffect(() => {
    const timer = window.setTimeout(() => saveDocument(document), AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [document]);

  // ── Edits ──
  const updateGlobal = (next: GlobalParams) => {
    editActiveState((previous) => ({ ...previous, global: next }));
    handleRef.current?.applyGlobal(next);
  };
  const resetGlobal = () => updateGlobal(structuredClone(DEFAULT_GLOBAL_PARAMS));

  const setFractureSpread = (amount: number) => {
    editActiveState((previous) => ({ ...previous, fractureSpread: amount }));
    handleRef.current?.applyFractureSpread(amount);
  };

  const changeObjectTransform = (id: string, partial: Partial<ObjectOverride>) => {
    const nextOverride: ObjectOverride = { ...(currentState().objects[id] ?? {}), ...partial };
    editActiveState((previous) => ({ ...previous, objects: { ...previous.objects, [id]: nextOverride } }));
    handleRef.current?.applyObjectTransform(id, resolvedTransform(id, nextOverride));
  };

  const changeObjectMaterial = (id: string, slot: number, params: MaterialParams) => {
    const previousOverride = currentState().objects[id] ?? {};
    const nextOverride: ObjectOverride = {
      ...previousOverride,
      materials: { ...(previousOverride.materials ?? {}), [slot]: params },
    };
    editActiveState((previous) => ({ ...previous, objects: { ...previous.objects, [id]: nextOverride } }));
    handleRef.current?.applyObjectMaterial(id, slot, params);
  };

  const changeSharedMaterial = (name: string, params: MaterialParams) => {
    editActiveState((previous) => ({
      ...previous,
      sharedMaterials: { ...previous.sharedMaterials, [name]: params },
    }));
    handleRef.current?.applySharedMaterial(name, params);
  };

  // ── Resets (un-clone edited material slots back to shared) ──
  const restoreObjectToDefaults = (id: string, previousOverride: ObjectOverride | undefined) => {
    handleRef.current?.applyObjectTransform(id, resolvedTransform(id, undefined));
    if (previousOverride?.materials) {
      Object.keys(previousOverride.materials).forEach((slotKey) => {
        handleRef.current?.setObjectMaterialToShared(id, Number(slotKey));
      });
    }
  };

  const resetObject = (id: string) => {
    const previousOverride = currentState().objects[id];
    editActiveState((previous) => {
      const objects = { ...previous.objects };
      delete objects[id];
      return { ...previous, objects };
    });
    restoreObjectToDefaults(id, previousOverride);
  };

  const resetSharedMaterial = (name: string) => {
    const shared = handleRef.current?.registry.sharedMaterials.find((entry) => entry.name === name);
    if (shared) handleRef.current?.applySharedMaterial(name, shared.defaults);
    editActiveState((previous) => {
      const sharedMaterials = { ...previous.sharedMaterials };
      delete sharedMaterials[name];
      return { ...previous, sharedMaterials };
    });
  };

  const resetGroup = (groupId: string) => {
    const group = handleRef.current?.registry.groups.find((entry) => entry.id === groupId);
    if (!group) return;
    const previousObjects = currentState().objects;
    group.objectIds.forEach((id) => restoreObjectToDefaults(id, previousObjects[id]));
    editActiveState((previous) => {
      const objects = { ...previous.objects };
      group.objectIds.forEach((id) => delete objects[id]);
      const fractureSpread = groupId === "cells" ? 0 : previous.fractureSpread;
      return { ...previous, objects, fractureSpread };
    });
    if (groupId === "cells") handleRef.current?.applyFractureSpread(0);
  };

  const broadcastGroupVisible = (groupId: string, visible: boolean) => {
    const group = handleRef.current?.registry.groups.find((entry) => entry.id === groupId);
    if (!group) return;
    editActiveState((previous) => {
      const objects = { ...previous.objects };
      group.objectIds.forEach((id) => {
        objects[id] = { ...(objects[id] ?? {}), visible };
      });
      return { ...previous, objects };
    });
    group.objectIds.forEach((id) => {
      const override: ObjectOverride = { ...(currentState().objects[id] ?? {}), visible };
      handleRef.current?.applyObjectTransform(id, resolvedTransform(id, override));
    });
  };

  const resetAll = () => {
    const initial = createInitialState();
    lastEditRef.current = 0; // force this onto the undo stack even right after an edit
    pushHistory();
    setActiveState(initial);
    applyFullState(initial);
    setSelection({ kind: "global" });
  };

  // ── Undo ──
  const undo = useCallback(() => {
    const restored = undoStackRef.current.pop();
    setCanUndo(undoStackRef.current.length > 0);
    if (!restored) return;
    lastEditRef.current = 0;
    setActiveState(restored);
    applyFullState(restored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFullState]);

  // ── Snapshots ──
  // Switching / adding / deleting clears undo history — it's scoped to editing one snapshot.
  const switchToState = (nextState: SunLabState) => {
    undoStackRef.current = [];
    setCanUndo(false);
    applyFullState(nextState);
  };

  const selectSnapshot = (id: string) => {
    const target = documentRef.current.snapshots.find((snapshot) => snapshot.id === id);
    if (!target) return;
    setDocument((previous) => ({ ...previous, activeId: id }));
    switchToState(target.state);
  };

  const addSnapshot = () => {
    const snapshot = createSnapshot(`Stage ${documentRef.current.snapshots.length + 1}`);
    setDocument((previous) => ({
      ...previous,
      snapshots: [...previous.snapshots, snapshot],
      activeId: snapshot.id,
    }));
    switchToState(snapshot.state);
  };

  const duplicateSnapshot = () => {
    const active = activeSnapshot(documentRef.current);
    const snapshot = createSnapshot(`${active.name} copy`, structuredClone(active.state));
    setDocument((previous) => ({
      ...previous,
      snapshots: [...previous.snapshots, snapshot],
      activeId: snapshot.id,
    }));
    switchToState(snapshot.state);
  };

  const deleteSnapshot = (id: string) => {
    const previous = documentRef.current;
    if (previous.snapshots.length <= 1) return;
    const remaining = previous.snapshots.filter((snapshot) => snapshot.id !== id);
    const nextActiveId = previous.activeId === id ? remaining[0].id : previous.activeId;
    setDocument({ snapshots: remaining, activeId: nextActiveId });
    if (previous.activeId === id) {
      switchToState(remaining[0].state);
    }
  };

  const renameSnapshot = (id: string, name: string) => {
    setDocument((previous) => ({
      ...previous,
      snapshots: previous.snapshots.map((snapshot) =>
        snapshot.id === id ? { ...snapshot, name } : snapshot,
      ),
    }));
  };

  const copyState = () => {
    navigator.clipboard.writeText(formatSunLabState(currentState())).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    });
  };

  // ── Keyboard: Ctrl/Cmd+Z undo, digits 1-9 switch snapshots (never while typing) ──
  const actionsRef = useRef({ undo, selectSnapshot });
  actionsRef.current = { undo, selectSnapshot };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        actionsRef.current.undo();
        return;
      }
      if (event.key >= "1" && event.key <= "9") {
        const index = Number(event.key) - 1;
        const snapshots = documentRef.current.snapshots;
        if (index < snapshots.length) actionsRef.current.selectSnapshot(snapshots[index].id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const registry = handleRef.current?.registry;

  return (
    // Fullscreen authoring takeover — above the site navbar (z 9999), which the root layout renders on
    // every route. The lab owns the whole viewport.
    <div className="fixed inset-0 z-[10000] bg-bg text-fg">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {(status.isLoading || status.error) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-[0.72rem] uppercase tracking-eyebrow text-muted">
            {status.error
              ? "Failed to load fractured_sun.glb"
              : status.percent >= 0
                ? `Loading the sun · ${status.percent}%`
                : "Loading the sun"}
          </p>
        </div>
      )}

      {ready && registry && (
        <div className="absolute left-0 top-0 flex h-full w-[320px] max-w-[86vw] flex-col gap-2 border-r border-border bg-black/55 p-3 backdrop-blur-md">
          <SnapshotBar
            snapshots={document.snapshots}
            activeId={document.activeId}
            onSelect={selectSnapshot}
            onAdd={addSnapshot}
            onDuplicate={duplicateSnapshot}
            onDelete={deleteSnapshot}
            onRename={renameSnapshot}
            onUndo={undo}
            canUndo={canUndo}
            onCopy={copyState}
            copied={copied}
            onResetAll={resetAll}
          />

          <div className="min-h-0 flex-[1.1] overflow-y-auto pr-1">
            <ObjectTree registry={registry} selection={selection} onSelect={setSelection} />
          </div>

          <div className="min-h-0 flex-[1.4] overflow-y-auto border-t border-border pr-1 pt-1">
            {selection.kind === "global" && (
              <GlobalControls
                value={state.global}
                onChange={updateGlobal}
                onReset={resetGlobal}
                onFitCamera={() => handleRef.current?.fitCamera()}
              />
            )}

            {selection.kind === "object" &&
              (() => {
                const entry = registry.entriesById.get(selection.id);
                if (!entry) return null;
                return (
                  <ObjectPanel
                    name={entry.name}
                    slotNames={entry.materialSlots.map((material) => material.name)}
                    slotKinds={entry.slotKinds}
                    defaults={entry.defaults}
                    override={state.objects[selection.id]}
                    onTransformChange={(partial) => changeObjectTransform(selection.id, partial)}
                    onMaterialChange={(slot, params) =>
                      changeObjectMaterial(selection.id, slot, params)
                    }
                    onReset={() => resetObject(selection.id)}
                  />
                );
              })()}

            {selection.kind === "group" &&
              (() => {
                const group = registry.groups.find((entry) => entry.id === selection.groupId);
                if (!group) return null;
                return (
                  <GroupPanel
                    label={GROUP_LABELS[selection.groupId]}
                    groupId={selection.groupId}
                    childCount={group.objectIds.length}
                    fractureSpread={state.fractureSpread}
                    onFractureSpread={setFractureSpread}
                    onBroadcastVisible={(visible) =>
                      broadcastGroupVisible(selection.groupId, visible)
                    }
                    onReset={() => resetGroup(selection.groupId)}
                  />
                );
              })()}

            {selection.kind === "material" &&
              (() => {
                const shared = registry.sharedMaterials.find(
                  (entry) => entry.name === selection.name,
                );
                if (!shared) return null;
                return (
                  <MaterialPanel
                    name={shared.name}
                    kind={shared.kind}
                    defaults={shared.defaults}
                    override={state.sharedMaterials[selection.name]}
                    onChange={(params) => changeSharedMaterial(selection.name, params)}
                    onReset={() => resetSharedMaterial(selection.name)}
                  />
                );
              })()}
          </div>
        </div>
      )}
    </div>
  );
}
