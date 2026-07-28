"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useSunLabScene, type SunLabSceneHandle, type SunLabStatus } from "./hooks/useSunLabScene";
import {
  createBlackHoleInitialState,
  createInitialState,
  DEFAULT_GLOBAL_PARAMS,
  type GlobalParams,
  type MaterialParams,
  type ObjectOverride,
  type SunLabState,
} from "./sunLabState";
import {
  activeSnapshot,
  createAddedObjectId,
  createInitialDocument,
  createSnapshot,
  type SunLabDocument,
} from "./sunLabDocument";
import { clearDocument, loadDocument, saveDocument } from "./sunLabStorage";
import {
  clearBlackHoleState,
  loadBlackHoleState,
  saveBlackHoleState,
} from "./blackHoleLabStorage";
import BlackHoleSettings from "./hud/BlackHoleSettings";
import { SUN_LAB_PRESETS } from "./sunLabPresets";
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
  // The finale scrub cursor — a transient authoring value (not saved per stage); Play ramps it 0→1.
  const [sequence, setSequence] = useState(0);
  const sequenceRef = useRef(0);
  sequenceRef.current = sequence;
  // Bumped whenever the scene registry changes (duplicate / delete / black hole loads) so the tree re-renders.
  const [, setRegistryVersion] = useState(0);
  const bumpRegistry = () => setRegistryVersion((version) => version + 1);
  // Which model's tree is shown — the sun or the (self-contained) new black hole.
  const [activeModel, setActiveModel] = useState<"sun" | "blackhole">("sun");
  const activeModelRef = useRef(activeModel);
  activeModelRef.current = activeModel;

  // The New-black-hole tab's OWN state — its own scene look, transform, spin + per-part edits, walled off
  // from the sun (its own localStorage). All the edit handlers route to this when the tab is active.
  const [blackHoleState, setBlackHoleState] = useState<SunLabState>(() => loadBlackHoleState());
  const blackHoleStateRef = useRef(blackHoleState);
  blackHoleStateRef.current = blackHoleState;

  const documentRef = useRef(document);
  documentRef.current = document;
  const undoStackRef = useRef<SunLabState[]>([]);
  const lastEditRef = useRef(0);

  // The active state — sun snapshot OR the black hole's own state, depending on the tab.
  const state = activeModel === "blackhole" ? blackHoleState : activeSnapshot(document).state;
  const currentState = () =>
    activeModelRef.current === "blackhole"
      ? blackHoleStateRef.current
      : activeSnapshot(documentRef.current).state;

  // ── State plumbing (routes to the active model's state) ──
  const setActiveState = (nextState: SunLabState) => {
    if (activeModelRef.current === "blackhole") {
      setBlackHoleState(nextState);
      return;
    }
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

  // Find an object in either model (the sun or the black hole).
  const entryById = (id: string) =>
    handleRef.current?.registry.entriesById.get(id) ??
    handleRef.current?.blackHoleRegistry?.entriesById.get(id);

  // The registry the HUD is currently editing. Group ids and material names are disjoint between the two
  // models, so anything that looks one up MUST ask the active model — reaching for the sun's registry
  // while the black hole tab is open finds nothing and silently does nothing.
  const activeSceneRegistry = () =>
    activeModelRef.current === "blackhole"
      ? handleRef.current?.blackHoleRegistry
      : handleRef.current?.registry;

  const resolvedTransform = (id: string, override: ObjectOverride | undefined) => {
    const defaults = entryById(id)?.defaults;
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
    if (!handle || !handle.registry) return;
    handle.applyGlobal(next.global);
    handle.applyFractureSpread(next.fractureSpread);
    // Apply a registry's shared materials first (so an un-cloned slot reflects the right value), then
    // each object's transform + per-slot material. Runs for the sun AND the black hole.
    const applyRegistry = (target: typeof handle.registry | null) => {
      if (!target) return;
      target.sharedMaterials.forEach((shared) => {
        handle.applySharedMaterial(shared.name, next.sharedMaterials[shared.name] ?? shared.defaults);
      });
      target.entries.forEach((entry) => {
        handle.applyObjectTransform(entry.id, resolvedTransform(entry.id, next.objects[entry.id]));
        entry.materialSlots.forEach((_, slot) => {
          const override = next.objects[entry.id]?.materials?.[slot];
          if (override) handle.applyObjectMaterial(entry.id, slot, override);
          else handle.setObjectMaterialToShared(entry.id, slot);
        });
      });
    };
    // The SUN's registry only. The black hole owns its own state on its own tab, and applying a sun
    // state here would walk its materials back to defaults — the two are meant to be walled off.
    applyRegistry(handle.registry);
    // Reflect the finale at the current scrub cursor (black hole hidden unless this stage enables it).
    handle.applyFinale(sequenceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the New-black-hole tab's own state: its standalone scene look + transform + spin, then its
  // per-part edits. Nothing here touches the sun's document.
  const applyBlackHole = useCallback((bh: SunLabState) => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.showBlackHoleStandalone({
      exposure: bh.global.exposure,
      bloom: bh.global.bloom,
      key: bh.global.key,
      fill: bh.global.fill,
      ambient: bh.global.ambient,
      background: bh.global.background,
      cameraFov: bh.global.camera.fov,
      envIntensity: bh.global.envIntensity,
      scale: bh.global.blackHoleScale,
      position: bh.global.blackHolePosition,
      rotation: bh.global.blackHoleRotation,
      spinAxis: bh.global.blackHoleSpinAxis,
      spinSpeed: bh.global.blackHoleSpinSpeed,
      lensing: bh.global.lensing,
    });
    const registry = handle.blackHoleRegistry;
    if (!registry) return;
    registry.sharedMaterials.forEach((shared) => {
      handle.applySharedMaterial(shared.name, bh.sharedMaterials[shared.name] ?? shared.defaults);
    });
    registry.entries.forEach((entry) => {
      handle.applyObjectTransform(entry.id, resolvedTransform(entry.id, bh.objects[entry.id]));
      entry.materialSlots.forEach((_, slot) => {
        const override = bh.objects[entry.id]?.materials?.[slot];
        if (override) handle.applyObjectMaterial(entry.id, slot, override);
        else handle.setObjectMaterialToShared(entry.id, slot);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the black hole finishes loading, reveal its tab and apply whichever state the current tab needs.
  const onBlackHoleReady = useCallback(() => {
    bumpRegistry();
    if (activeModelRef.current === "blackhole") applyBlackHole(blackHoleStateRef.current);
    else applyFullState(activeSnapshot(documentRef.current).state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFullState, applyBlackHole]);

  const onReady = useCallback(
    (handle: SunLabSceneHandle) => {
      handleRef.current = handle;
      // Re-create the duplicated objects (document-level) onto this fresh scene BEFORE applying state,
      // so their per-stage overrides have something to apply to.
      documentRef.current.addedObjects.forEach((added) =>
        handle.addDuplicate(added.sourceId, added.id),
      );
      // Reflect the loaded/active snapshot onto this scene. Runs on every ready (incl. a StrictMode
      // remount's fresh scene), and it's idempotent — so the viewport always matches the numbers.
      applyFullState(currentState());
      if (currentState().global.formOnEnter) handle.playFormAnimation();
      setReady(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyFullState],
  );

  useSunLabScene({ canvasRef, onReady, onStatus: setStatus, onBlackHoleReady });

  // ── Autosave (each state to its own store) ──
  useEffect(() => {
    const timer = window.setTimeout(() => saveDocument(document), AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [document]);
  useEffect(() => {
    const timer = window.setTimeout(() => saveBlackHoleState(blackHoleState), AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [blackHoleState]);

  // ── Edits ──
  const updateGlobal = (next: GlobalParams) => {
    editActiveState((previous) => ({ ...previous, global: next }));
    if (activeModelRef.current === "blackhole") {
      applyBlackHole({ ...blackHoleStateRef.current, global: next });
      return;
    }
    handleRef.current?.applyGlobal(next);
    // Re-apply the finale so toggling it / resizing the black hole reflects immediately.
    handleRef.current?.applyFinale(sequenceRef.current);
  };

  const changeSequence = (value: number) => {
    setSequence(value);
    handleRef.current?.applyFinale(value);
  };
  // Mirror the scene's playback into React so the scrub slider tracks it — and so a later edit re-applies
  // where the finale actually IS, rather than snapping it back to 0.
  const playSequence = () =>
    handleRef.current?.playSequence(
      currentState().global.finaleDuration,
      (played) => setSequence(played),
    );
  const resetGlobal = () =>
    updateGlobal(
      structuredClone(
        activeModelRef.current === "blackhole"
          ? createBlackHoleInitialState().global
          : DEFAULT_GLOBAL_PARAMS,
      ),
    );

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
    const shared = activeSceneRegistry()?.sharedMaterials.find((entry) => entry.name === name);
    if (shared) handleRef.current?.applySharedMaterial(name, shared.defaults);
    editActiveState((previous) => {
      const sharedMaterials = { ...previous.sharedMaterials };
      delete sharedMaterials[name];
      return { ...previous, sharedMaterials };
    });
  };

  const resetGroup = (groupId: string) => {
    const group = activeSceneRegistry()?.groups.find((entry) => entry.id === groupId);
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
    const group = activeSceneRegistry()?.groups.find((entry) => entry.id === groupId);
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

  // ── Duplicate / delete objects (document-level, shared across stages) ──
  const isAddedObject = (id: string) =>
    documentRef.current.addedObjects.some((added) => added.id === id);

  const duplicateObject = (id: string) => {
    const handle = handleRef.current;
    if (!handle) return;
    const newId = createAddedObjectId(id);
    handle.addDuplicate(id, newId);
    setDocument((previous) => ({
      ...previous,
      addedObjects: [...previous.addedObjects, { id: newId, sourceId: id }],
    }));
    bumpRegistry();
    setSelection({ kind: "object", id: newId });
  };

  const deleteObject = (id: string) => {
    handleRef.current?.removeObject(id);
    setDocument((previous) => ({
      ...previous,
      addedObjects: previous.addedObjects.filter((added) => added.id !== id),
      // Drop its per-stage overrides from every snapshot too.
      snapshots: previous.snapshots.map((snapshot) => {
        if (!snapshot.state.objects[id]) return snapshot;
        const objects = { ...snapshot.state.objects };
        delete objects[id];
        return { ...snapshot, state: { ...snapshot.state, objects } };
      }),
    }));
    bumpRegistry();
    setSelection({ kind: "global" });
  };

  const resetAll = () => {
    const onBlackHole = activeModelRef.current === "blackhole";
    const initial = onBlackHole ? createBlackHoleInitialState() : createInitialState();
    lastEditRef.current = 0; // force this onto the undo stack even right after an edit
    pushHistory();
    setActiveState(initial);
    if (onBlackHole) applyBlackHole(initial);
    else applyFullState(initial);
    setSelection({ kind: "global" });
  };

  // Wipe ALL saved data — the sun document AND the black hole's own store — and start from clean bases.
  const freshStart = () => {
    if (!window.confirm("Reset everything to base? This clears all saved snapshots and edits.")) return;
    clearDocument();
    clearBlackHoleState();
    const base = createSnapshot("Base", createInitialState());
    const fresh: SunLabDocument = { snapshots: [base], activeId: base.id, addedObjects: [] };
    setDocument(fresh);
    const freshBlackHole = createBlackHoleInitialState();
    setBlackHoleState(freshBlackHole);
    setSelection({ kind: "global" });
    setSequence(0);
    sequenceRef.current = 0;
    undoStackRef.current = [];
    setCanUndo(false);
    if (activeModelRef.current === "blackhole") applyBlackHole(freshBlackHole);
    else applyFullState(base.state);
  };

  // ── Undo ──
  const undo = useCallback(() => {
    const restored = undoStackRef.current.pop();
    setCanUndo(undoStackRef.current.length > 0);
    if (!restored) return;
    lastEditRef.current = 0;
    setActiveState(restored);
    if (activeModelRef.current === "blackhole") applyBlackHole(restored);
    else applyFullState(restored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFullState, applyBlackHole]);

  // ── Snapshots ──
  // Switching / adding / deleting clears undo history — it's scoped to editing one snapshot.
  const switchToState = (nextState: SunLabState) => {
    undoStackRef.current = [];
    setCanUndo(false);
    // A stage starts at the beginning of its finale timeline.
    setSequence(0);
    applyFullState(nextState);
    handleRef.current?.applyFinale(0);
    // Entering a stage that forms on enter replays its one-shot open.
    if (nextState.global.formOnEnter) handleRef.current?.playFormAnimation();
  };

  const playForm = () => handleRef.current?.playFormAnimation();

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

  const addPreset = (index: number) => {
    const preset = SUN_LAB_PRESETS[index];
    if (!preset) return;
    const snapshot = createSnapshot(preset.name, structuredClone(preset.state));
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
    setDocument({ ...previous, snapshots: remaining, activeId: nextActiveId });
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
  const blackHoleRegistry = handleRef.current?.blackHoleRegistry ?? null;
  // The tree shows one model at a time; fall back to the sun until the black hole has loaded.
  const activeRegistry =
    activeModel === "blackhole" && blackHoleRegistry ? blackHoleRegistry : registry;
  const selectedIsSun = !!(
    selection.kind === "object" && registry?.entriesById.get(selection.id)
  );

  const switchModel = (model: "sun" | "blackhole") => {
    setActiveModel(model);
    activeModelRef.current = model; // so the routed helpers use the new tab immediately
    setSelection({ kind: "global" });
    undoStackRef.current = [];
    setCanUndo(false);
    if (model === "blackhole") {
      // The New black hole tab: show it alone with its own settings.
      applyBlackHole(blackHoleStateRef.current);
    } else {
      handleRef.current?.exitBlackHoleStandalone();
      applyFullState(activeSnapshot(documentRef.current).state);
    }
  };

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
            presetNames={SUN_LAB_PRESETS.map((preset) => preset.name)}
            onSelect={selectSnapshot}
            onAdd={addSnapshot}
            onDuplicate={duplicateSnapshot}
            onAddPreset={addPreset}
            onDelete={deleteSnapshot}
            onRename={renameSnapshot}
            onUndo={undo}
            canUndo={canUndo}
            onCopy={copyState}
            copied={copied}
            onResetAll={resetAll}
            onFreshStart={freshStart}
            showSnapshots={activeModel === "sun"}
          />

          {/* Finale playback — always visible on a finale stage, so Play + scrub are never buried. */}
          {state.global.finaleEnabled && (
            <div className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-2 py-1.5">
              <button
                type="button"
                onClick={playSequence}
                className="flex items-center gap-1 rounded border border-border bg-black/30 px-2 py-1 text-[0.66rem] text-fg hover:text-accent"
              >
                <Play size={12} /> Play
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={sequence}
                onChange={(event) => changeSequence(Number(event.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-border accent-accent"
                aria-label="Finale sequence"
              />
              <span className="w-8 text-right text-[0.62rem] tabular-nums text-muted">
                {sequence.toFixed(2)}
              </span>
            </div>
          )}

          {/* Model tab — appears once the black hole has loaded. */}
          {blackHoleRegistry && (
            <div className="flex gap-1">
              {(["sun", "blackhole"] as const).map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => switchModel(model)}
                  className={`flex-1 rounded border py-1 text-[0.66rem] ${
                    activeModel === model
                      ? "border-accent/60 bg-accent/10 text-fg"
                      : "border-border text-muted hover:text-fg"
                  }`}
                >
                  {model === "sun" ? "Sun" : "New black hole"}
                </button>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-[1.1] overflow-y-auto pr-1">
            {activeRegistry && (
              <ObjectTree registry={activeRegistry} selection={selection} onSelect={setSelection} />
            )}
          </div>

          <div className="min-h-0 flex-[1.4] overflow-y-auto border-t border-border pr-1 pt-1">
            {selection.kind === "global" && activeModel === "blackhole" && (
              <BlackHoleSettings
                value={state.global}
                onChange={updateGlobal}
                onReset={resetGlobal}
                onFitCamera={() => handleRef.current?.fitCamera()}
              />
            )}

            {selection.kind === "global" && activeModel === "sun" && (
              <GlobalControls
                value={state.global}
                onChange={updateGlobal}
                onReset={resetGlobal}
                onFitCamera={() => handleRef.current?.fitCamera()}
                onPlayForm={playForm}
                sequence={sequence}
                onSequenceChange={changeSequence}
                onPlaySequence={playSequence}
              />
            )}

            {selection.kind === "object" &&
              (() => {
                const entry = entryById(selection.id);
                if (!entry) return null;
                return (
                  <ObjectPanel
                    name={entry.name}
                    slotNames={entry.materialSlots.map((material) => material.name)}
                    slotKinds={entry.slotKinds}
                    defaults={entry.defaults}
                    override={state.objects[selection.id]}
                    isAdded={isAddedObject(selection.id)}
                    canDuplicate={selectedIsSun}
                    onTransformChange={(partial) => changeObjectTransform(selection.id, partial)}
                    onMaterialChange={(slot, params) =>
                      changeObjectMaterial(selection.id, slot, params)
                    }
                    onReset={() => resetObject(selection.id)}
                    onDuplicate={() => duplicateObject(selection.id)}
                    onDelete={() => deleteObject(selection.id)}
                  />
                );
              })()}

            {selection.kind === "group" &&
              (() => {
                const group = activeRegistry?.groups.find((entry) => entry.id === selection.groupId);
                if (!group) return null;
                return (
                  <GroupPanel
                    label={group.label}
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
                const shared = activeRegistry?.sharedMaterials.find(
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
