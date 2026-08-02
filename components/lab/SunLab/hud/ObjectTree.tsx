"use client";

import { useState } from "react";
import { ChevronRight, Sun } from "lucide-react";
import type { SunLabRegistry } from "../sunLabModel";
import type { Selection } from "./selection";

// The grouped, drill-in tree: Global at the top, the five role groups, then the shared Materials.
// Selecting a group row edits the group (or just reveals its objects); expanding it lets you pick one
// object for full control.

const MATERIALS_KEY = "__materials__";

function rowClasses(active: boolean): string {
  return `flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[0.74rem] transition-colors ${
    active ? "bg-accent/15 text-fg" : "text-muted hover:bg-white/5 hover:text-fg"
  }`;
}

export default function ObjectTree({
  registry,
  selection,
  onSelect,
}: {
  registry: SunLabRegistry;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["cells"]));

  const toggle = (key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <nav className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onSelect({ kind: "global" })}
        className={rowClasses(selection.kind === "global")}
      >
        <Sun size={13} className="text-accent" />
        <span className="font-display">Global — scene</span>
      </button>

      {registry.groups.map((group) => {
        const isOpen = expanded.has(group.id);
        const groupActive = selection.kind === "group" && selection.groupId === group.id;
        return (
          <div key={group.id}>
            <div className="flex items-center">
              <button
                type="button"
                aria-label={isOpen ? "Collapse" : "Expand"}
                onClick={() => toggle(group.id)}
                className="rounded p-0.5 text-muted hover:text-fg"
              >
                <ChevronRight
                  size={13}
                  className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              </button>
              <button
                type="button"
                onClick={() => onSelect({ kind: "group", groupId: group.id })}
                className={rowClasses(groupActive)}
              >
                <span className="font-display">{group.label}</span>
                <span className="text-[0.62rem] text-muted">{group.objectIds.length}</span>
              </button>
            </div>

            {isOpen && (
              <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-1">
                {group.objectIds.map((id) => {
                  const entry = registry.entriesById.get(id);
                  if (!entry) return null;
                  const active = selection.kind === "object" && selection.id === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelect({ kind: "object", id })}
                      className={rowClasses(active)}
                    >
                      <span className="truncate">{entry.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Shared materials — the global look. Editing one changes everything still bound to it. */}
      <div>
        <div className="flex items-center">
          <button
            type="button"
            aria-label={expanded.has(MATERIALS_KEY) ? "Collapse" : "Expand"}
            onClick={() => toggle(MATERIALS_KEY)}
            className="rounded p-0.5 text-muted hover:text-fg"
          >
            <ChevronRight
              size={13}
              className={`transition-transform ${expanded.has(MATERIALS_KEY) ? "rotate-90" : ""}`}
            />
          </button>
          <span className={rowClasses(false)}>
            <span className="font-display">Materials</span>
            <span className="text-[0.62rem] text-muted">{registry.sharedMaterials.length}</span>
          </span>
        </div>
        {expanded.has(MATERIALS_KEY) && (
          <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-1">
            {registry.sharedMaterials.map((material) => {
              const active = selection.kind === "material" && selection.name === material.name;
              return (
                <button
                  key={material.name}
                  type="button"
                  onClick={() => onSelect({ kind: "material", name: material.name })}
                  className={rowClasses(active)}
                >
                  <span className="truncate">{material.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
