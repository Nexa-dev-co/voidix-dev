"use client";

import { Check, Clipboard, Copy, Plus, RotateCcw, Undo2, X } from "lucide-react";
import type { SunLabSnapshot } from "../sunLabDocument";

// The snapshot bar: the named states you author (your "stages"), plus undo / copy / reset. The active
// snapshot's name is editable inline; others are click-to-switch.
export default function SnapshotBar({
  snapshots,
  activeId,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onRename,
  onUndo,
  canUndo,
  onCopy,
  copied,
  onResetAll,
}: {
  snapshots: SunLabSnapshot[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  onCopy: () => void;
  copied: boolean;
  onResetAll: () => void;
}) {
  const iconButton = "flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.62rem] text-muted hover:text-fg disabled:opacity-40 disabled:hover:text-muted";

  return (
    <header className="flex flex-col gap-2 border-b border-border pb-2">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-bold tracking-tight text-fg">SUN LAB</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={onUndo} disabled={!canUndo} className={iconButton} title="Undo (Ctrl+Z)">
            <Undo2 size={12} /> Undo
          </button>
          <button type="button" onClick={onCopy} className={iconButton} title="Copy current numbers">
            {copied ? <Check size={12} className="text-accent" /> : <Clipboard size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={onResetAll} className={iconButton} title="Reset this snapshot to defaults">
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {snapshots.map((snapshot, index) => {
          const active = snapshot.id === activeId;
          return (
            <div
              key={snapshot.id}
              className={`flex items-center gap-1 rounded border px-1.5 py-1 ${
                active ? "border-accent/60 bg-accent/10" : "border-border"
              }`}
            >
              <span className="text-[0.58rem] text-muted">{index + 1}</span>
              {active ? (
                <input
                  value={snapshot.name}
                  onChange={(event) => onRename(snapshot.id, event.target.value)}
                  className="w-20 bg-transparent text-[0.7rem] text-fg outline-none"
                  aria-label="Snapshot name"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(snapshot.id)}
                  className="max-w-24 truncate text-[0.7rem] text-muted hover:text-fg"
                >
                  {snapshot.name}
                </button>
              )}
              {snapshots.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDelete(snapshot.id)}
                  aria-label="Delete snapshot"
                  className="text-muted hover:text-fg"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}

        <button type="button" onClick={onAdd} className={iconButton} title="New snapshot">
          <Plus size={12} /> New
        </button>
        <button type="button" onClick={onDuplicate} className={iconButton} title="Duplicate active snapshot">
          <Copy size={12} /> Dupe
        </button>
      </div>
    </header>
  );
}
