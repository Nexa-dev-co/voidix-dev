"use client";

import { Crosshair, RotateCcw } from "lucide-react";
import type { GlobalParams } from "../sunLabState";
import { ColorField, Section, Slider, Vec3Field } from "./controls";

// The New-black-hole tab's own settings — a self-contained grade + transform + spin, walled off from
// the sun. `environment` is the studio reflection: 0 keeps the model from mirroring a room that isn't
// there. (The horizon's blackness is guaranteed separately, by its material specular being 0.)
export default function BlackHoleSettings({
  value,
  onChange,
  onReset,
  onFitCamera,
}: {
  value: GlobalParams;
  onChange: (value: GlobalParams) => void;
  onReset: () => void;
  onFitCamera: () => void;
}) {
  const patch = (partial: Partial<GlobalParams>) => onChange({ ...value, ...partial });
  const axes: { index: number; label: string }[] = [
    { index: 0, label: "X" },
    { index: 1, label: "Y" },
    { index: 2, label: "Z" },
  ];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-display text-sm text-fg">New black hole</h2>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onFitCamera}
            title="Frame the black hole"
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.62rem] text-muted hover:text-fg"
          >
            <Crosshair size={12} /> Fit
          </button>
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.62rem] text-muted hover:text-fg"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      <Section title="Look">
        <Slider
          label="environment (0 = no mirror)"
          value={value.envIntensity}
          min={0}
          max={3}
          step={0.02}
          onChange={(envIntensity) => patch({ envIntensity })}
        />
        <Slider
          label="exposure"
          value={value.exposure}
          min={0.2}
          max={3}
          step={0.01}
          onChange={(exposure) => patch({ exposure })}
        />
        <Slider
          label="bloom"
          value={value.bloom.strength}
          min={0}
          max={3}
          step={0.01}
          onChange={(strength) => patch({ bloom: { ...value.bloom, strength } })}
        />
        <ColorField
          label="background"
          value={value.background.color}
          onChange={(color) => patch({ background: { ...value.background, color } })}
        />
      </Section>

      <Section title="Lights">
        <Slider
          label="key"
          value={value.key.intensity}
          min={0}
          max={6}
          step={0.05}
          onChange={(intensity) => patch({ key: { ...value.key, intensity } })}
        />
        <Slider
          label="fill"
          value={value.fill.intensity}
          min={0}
          max={6}
          step={0.05}
          onChange={(intensity) => patch({ fill: { ...value.fill, intensity } })}
        />
        <Slider
          label="ambient"
          value={value.ambient.intensity}
          min={0}
          max={3}
          step={0.05}
          onChange={(intensity) => patch({ ambient: { ...value.ambient, intensity } })}
        />
      </Section>

      <Section title="Black hole">
        <Slider
          label="size"
          value={value.blackHoleScale}
          min={0.1}
          max={4}
          step={0.02}
          onChange={(blackHoleScale) => patch({ blackHoleScale })}
        />
        <Vec3Field
          label="position"
          value={value.blackHolePosition}
          step={0.05}
          onChange={(blackHolePosition) => patch({ blackHolePosition })}
        />
        <Vec3Field
          label="rotation (deg)"
          value={value.blackHoleRotation}
          step={1}
          onChange={(blackHoleRotation) => patch({ blackHoleRotation })}
        />
      </Section>

      <Section title="Spin">
        <div className="flex flex-col gap-1">
          <span className="text-[0.64rem] text-muted">axis</span>
          <div className="grid grid-cols-3 gap-1">
            {axes.map((axis) => (
              <button
                key={axis.index}
                type="button"
                onClick={() => patch({ blackHoleSpinAxis: axis.index })}
                className={`rounded px-1.5 py-1 text-[0.62rem] ${
                  value.blackHoleSpinAxis === axis.index
                    ? "bg-accent/20 text-fg"
                    : "border border-border text-muted hover:text-fg"
                }`}
              >
                {axis.label}
              </button>
            ))}
          </div>
        </div>
        <Slider
          label="speed °/s"
          value={value.blackHoleSpinSpeed}
          min={-180}
          max={180}
          step={1}
          onChange={(blackHoleSpinSpeed) => patch({ blackHoleSpinSpeed })}
        />
      </Section>

      <Section title="Camera">
        <Slider
          label="fov"
          value={value.camera.fov}
          min={18}
          max={80}
          step={1}
          onChange={(fov) => patch({ camera: { ...value.camera, fov } })}
        />
      </Section>
    </div>
  );
}
