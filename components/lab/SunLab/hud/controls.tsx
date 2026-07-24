"use client";

import type { ReactNode } from "react";
import type { MaterialKind } from "../sunLabModel";
import type { MaterialParams, Vector3Values } from "../sunLabState";

// Reusable HUD inputs, Tailwind-styled with the site tokens (a lab has no business growing globals.css
// — same rule LetterLab follows). All controlled: value in, onChange out. No state of their own.

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border py-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-[0.62rem] uppercase tracking-eyebrow text-muted">{title}</h3>
        {action}
      </header>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-[0.64rem] text-muted">
        <span>{label}</span>
        <span className="text-fg tabular-nums">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded bg-border accent-accent"
      />
    </label>
  );
}

function NumberInput({
  value,
  step,
  onChange,
}: {
  value: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
      step={step}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
      className="w-full rounded border border-border bg-black/30 px-1.5 py-1 text-[0.72rem] text-fg tabular-nums outline-none focus:border-accent"
    />
  );
}

export function Vec3Field({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: Vector3Values;
  step: number;
  onChange: (value: Vector3Values) => void;
}) {
  const axes: (keyof Vector3Values)[] = ["x", "y", "z"];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.64rem] text-muted">{label}</span>
      <div className="grid grid-cols-3 gap-1.5">
        {axes.map((axis) => (
          <label key={axis} className="flex items-center gap-1">
            <span className="text-[0.6rem] uppercase text-muted">{axis}</span>
            <NumberInput
              value={value[axis]}
              step={step}
              onChange={(next) => onChange({ ...value, [axis]: next })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[0.64rem] text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-[0.66rem] text-fg tabular-nums">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-5 w-7 cursor-pointer rounded border border-border bg-transparent"
        />
      </span>
    </label>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2">
      <span className="text-[0.64rem] text-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`h-4 w-7 rounded-full border border-border transition-colors ${
          value ? "bg-accent/80" : "bg-black/40"
        }`}
      >
        <span
          className={`block h-3 w-3 rounded-full bg-fg transition-transform ${
            value ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

/**
 * The editable surface of one material slot. The emissive/metal/rough controls only appear for a
 * standard (lit) material — the sun's surface materials are unlit (basic), where those fields have no
 * effect, so showing them would be a lie.
 */
export function MaterialFields({
  value,
  kind,
  onChange,
}: {
  value: MaterialParams;
  kind: MaterialKind;
  onChange: (value: MaterialParams) => void;
}) {
  const patch = (partial: Partial<MaterialParams>) => onChange({ ...value, ...partial });
  return (
    <div className="flex flex-col gap-2.5">
      <ColorField label="color" value={value.color} onChange={(color) => patch({ color })} />
      {kind === "standard" && (
        <>
          <ColorField
            label="emissive"
            value={value.emissive}
            onChange={(emissive) => patch({ emissive })}
          />
          <Slider
            label="emissive power"
            value={value.emissiveIntensity}
            min={0}
            max={8}
            step={0.05}
            onChange={(emissiveIntensity) => patch({ emissiveIntensity })}
          />
          <Slider
            label="metalness"
            value={value.metalness}
            min={0}
            max={1}
            step={0.01}
            onChange={(metalness) => patch({ metalness })}
          />
          <Slider
            label="roughness"
            value={value.roughness}
            min={0}
            max={1}
            step={0.01}
            onChange={(roughness) => patch({ roughness })}
          />
        </>
      )}
      <Slider
        label="opacity"
        value={value.opacity}
        min={0}
        max={1}
        step={0.01}
        onChange={(opacity) => patch({ opacity })}
      />
      <Toggle
        label="transparent"
        value={value.transparent}
        onChange={(transparent) => patch({ transparent })}
      />
      <Toggle label="wireframe" value={value.wireframe} onChange={(wireframe) => patch({ wireframe })} />
    </div>
  );
}
