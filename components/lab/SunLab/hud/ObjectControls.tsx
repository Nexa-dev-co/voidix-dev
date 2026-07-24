"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import type { GroupId, MaterialKind } from "../sunLabModel";
import type {
  MaterialParams,
  ObjectDefaults,
  ObjectOverride,
  Vector3Values,
} from "../sunLabState";
import { resolveMaterial, resolveVector } from "../sunLabState";
import { MaterialFields, Section, Slider, Toggle, Vec3Field } from "./controls";

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.62rem] text-muted hover:text-fg"
    >
      <RotateCcw size={12} /> Reset
    </button>
  );
}

/** The full per-object editor: visibility, transform, and every material slot the object carries. */
export function ObjectPanel({
  name,
  slotNames,
  slotKinds,
  defaults,
  override,
  onTransformChange,
  onMaterialChange,
  onReset,
}: {
  name: string;
  slotNames: string[];
  slotKinds: MaterialKind[];
  defaults: ObjectDefaults;
  override: ObjectOverride | undefined;
  onTransformChange: (partial: Partial<ObjectOverride>) => void;
  onMaterialChange: (slot: number, params: MaterialParams) => void;
  onReset: () => void;
}) {
  const [activeSlot, setActiveSlot] = useState(0);

  const visible = override?.visible ?? defaults.visible;
  const position = resolveVector(override?.position, defaults.position);
  const rotation = resolveVector(override?.rotation, defaults.rotation);
  const scale = resolveVector(override?.scale, defaults.scale);

  const slot = Math.min(activeSlot, slotNames.length - 1);
  const material = resolveMaterial(override?.materials?.[slot], defaults.materials[slot]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="truncate font-display text-sm text-fg">{name}</h2>
        <ResetButton onClick={onReset} />
      </div>

      <Section title="Object">
        <Toggle label="visible" value={visible} onChange={(next) => onTransformChange({ visible: next })} />
      </Section>

      <Section title="Transform">
        <Vec3Field
          label="position"
          value={position}
          step={0.02}
          onChange={(next: Vector3Values) => onTransformChange({ position: next })}
        />
        <Vec3Field
          label="rotation (deg)"
          value={rotation}
          step={1}
          onChange={(next: Vector3Values) => onTransformChange({ rotation: next })}
        />
        <Vec3Field
          label="scale"
          value={scale}
          step={0.02}
          onChange={(next: Vector3Values) => onTransformChange({ scale: next })}
        />
      </Section>

      <Section
        title="Material"
        action={
          slotNames.length > 1 ? (
            <div className="flex gap-1">
              {slotNames.map((slotName, index) => (
                <button
                  key={slotName + index}
                  type="button"
                  onClick={() => setActiveSlot(index)}
                  className={`rounded px-1.5 py-0.5 text-[0.6rem] ${
                    index === slot ? "bg-accent/20 text-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {slotName || `slot ${index}`}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <MaterialFields
          value={material}
          kind={slotKinds[slot] ?? "standard"}
          onChange={(params) => onMaterialChange(slot, params)}
        />
      </Section>
    </div>
  );
}

/**
 * Group panel — the whole-group handles. Kept deliberately to the broadcasts that make sense group-wide
 * (visibility, and the fracture spread for cells); per-object position/rotation/scale live on the
 * objects themselves, because broadcasting a position to a whole group would just collapse it.
 */
export function GroupPanel({
  label,
  groupId,
  childCount,
  fractureSpread,
  onFractureSpread,
  onBroadcastVisible,
  onReset,
}: {
  label: string;
  groupId: GroupId;
  childCount: number;
  fractureSpread: number;
  onFractureSpread: (amount: number) => void;
  onBroadcastVisible: (visible: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-display text-sm text-fg">{label}</h2>
        <ResetButton onClick={onReset} />
      </div>

      <Section title={`${childCount} objects`}>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onBroadcastVisible(true)}
            className="flex-1 rounded border border-border py-1 text-[0.64rem] text-muted hover:text-fg"
          >
            Show all
          </button>
          <button
            type="button"
            onClick={() => onBroadcastVisible(false)}
            className="flex-1 rounded border border-border py-1 text-[0.64rem] text-muted hover:text-fg"
          >
            Hide all
          </button>
        </div>
        <p className="text-[0.62rem] leading-relaxed text-muted">
          Expand this group in the tree to edit one object with full control.
        </p>
      </Section>

      {groupId === "cells" && (
        <Section title="Fracture">
          <Slider
            label="spread ( − collapse · + open )"
            value={fractureSpread}
            min={-1}
            max={2.5}
            step={0.01}
            onChange={onFractureSpread}
          />
          <p className="text-[0.62rem] leading-relaxed text-muted">
            Moves each fracture shard outward along its own direction, opening the gaps so the glowing
            magma shows through. Lift the magma emissive (Materials → magma) or bloom to make it pour.
          </p>
        </Section>
      )}
    </div>
  );
}

/** Shared-material panel — edits one of the model's five materials in place (the global look). */
export function MaterialPanel({
  name,
  kind,
  defaults,
  override,
  onChange,
  onReset,
}: {
  name: string;
  kind: MaterialKind;
  defaults: MaterialParams;
  override: MaterialParams | undefined;
  onChange: (params: MaterialParams) => void;
  onReset: () => void;
}) {
  const value = resolveMaterial(override, defaults);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="truncate font-display text-sm text-fg">{name}</h2>
        <ResetButton onClick={onReset} />
      </div>
      <Section title="Shared material">
        <p className="mb-1 text-[0.62rem] leading-relaxed text-muted">
          Changes every object still bound to this material. An object you edited individually keeps its
          own copy.
        </p>
        <MaterialFields value={value} kind={kind} onChange={onChange} />
      </Section>
    </div>
  );
}
