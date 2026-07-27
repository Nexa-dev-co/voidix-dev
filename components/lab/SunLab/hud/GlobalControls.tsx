"use client";

import { RotateCcw, Crosshair, Play } from "lucide-react";
import type { GlobalParams } from "../sunLabState";
import { ColorField, Section, Slider, Toggle, Vec3Field } from "./controls";

// The whole-sun controls. None of these know about "stages" — they're just the scene's global knobs,
// so they behave the same whatever you're authoring.

export default function GlobalControls({
  value,
  onChange,
  onReset,
  onFitCamera,
  onPlayForm,
  sequence,
  onSequenceChange,
  onPlaySequence,
}: {
  value: GlobalParams;
  onChange: (value: GlobalParams) => void;
  onReset: () => void;
  onFitCamera: () => void;
  onPlayForm: () => void;
  sequence: number;
  onSequenceChange: (value: number) => void;
  onPlaySequence: () => void;
}) {
  const patch = (partial: Partial<GlobalParams>) => onChange({ ...value, ...partial });

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-display text-sm text-fg">Global — the sun</h2>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onFitCamera}
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

      <Section title="Model">
        <Slider
          label="scale"
          value={value.modelScale}
          min={0.1}
          max={4}
          step={0.01}
          onChange={(modelScale) => patch({ modelScale })}
        />
        <Vec3Field
          label="rotation (deg)"
          value={value.rotation}
          step={1}
          onChange={(rotation) => patch({ rotation })}
        />
      </Section>

      <Section title="Animation">
        <Slider
          label="whole-sun spin °/s"
          value={value.autoRotateSpeed}
          min={-90}
          max={90}
          step={1}
          onChange={(autoRotateSpeed) => patch({ autoRotateSpeed })}
        />
        <Slider
          label="flare spin °/s"
          value={value.flareSpinSpeed}
          min={-360}
          max={360}
          step={5}
          onChange={(flareSpinSpeed) => patch({ flareSpinSpeed })}
        />
        <Slider
          label="cracks breathe (inward)"
          value={value.fracturePulse}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(fracturePulse) => patch({ fracturePulse })}
        />
        <Slider
          label="breathe speed /s"
          value={value.fracturePulseSpeed}
          min={0.05}
          max={2}
          step={0.05}
          onChange={(fracturePulseSpeed) => patch({ fracturePulseSpeed })}
        />
      </Section>

      <Section
        title="Form on enter"
        action={
          <button
            type="button"
            onClick={onPlayForm}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.62rem] text-muted hover:text-fg"
          >
            <Play size={12} /> Play
          </button>
        }
      >
        <Toggle
          label="form on enter"
          value={value.formOnEnter}
          onChange={(formOnEnter) => patch({ formOnEnter })}
        />
        <Slider
          label="form from spread"
          value={value.formFromSpread}
          min={-1}
          max={2.5}
          step={0.01}
          onChange={(formFromSpread) => patch({ formFromSpread })}
        />
        <Slider
          label="form from scale"
          value={value.formFromScale}
          min={0.05}
          max={2}
          step={0.01}
          onChange={(formFromScale) => patch({ formFromScale })}
        />
        <Slider
          label="form duration s"
          value={value.formDuration}
          min={0.2}
          max={4}
          step={0.05}
          onChange={(formDuration) => patch({ formDuration })}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[0.64rem] text-muted">easing</span>
          <div className="grid grid-cols-3 gap-1">
            {([
              ["out", "settle"],
              ["in", "gravity"],
              ["inout", "both"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => patch({ formEasing: mode })}
                className={`rounded px-1.5 py-1 text-[0.6rem] ${
                  value.formEasing === mode
                    ? "bg-accent/20 text-fg"
                    : "border border-border text-muted hover:text-fg"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section
        title="Finale — singularity"
        action={
          <button
            type="button"
            onClick={onPlaySequence}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.62rem] text-muted hover:text-fg"
          >
            <Play size={12} /> Play
          </button>
        }
      >
        <Toggle
          label="finale enabled"
          value={value.finaleEnabled}
          onChange={(finaleEnabled) => patch({ finaleEnabled })}
        />
        <Slider
          label="sequence (scrub)"
          value={sequence}
          min={0}
          max={1}
          step={0.001}
          onChange={onSequenceChange}
        />
        <Slider
          label="black hole size"
          value={value.blackHoleScale}
          min={0.1}
          max={4}
          step={0.05}
          onChange={(blackHoleScale) => patch({ blackHoleScale })}
        />
        <Vec3Field
          label="black hole position"
          value={value.blackHolePosition}
          step={0.05}
          onChange={(blackHolePosition) => patch({ blackHolePosition })}
        />
        <Slider
          label="black hole spin °/s"
          value={value.blackHoleSpinSpeed}
          min={-180}
          max={180}
          step={1}
          onChange={(blackHoleSpinSpeed) => patch({ blackHoleSpinSpeed })}
        />
      </Section>

      {/* The star's own matter, released from its mesh and wound inward. The spiral is NOT authored —
          it emerges from Keplerian shear (inner material laps outer), so `wind` is the only shape dial. */}
      <Section title="Accretion spiral">
        <Slider
          label="strength (0 = off)"
          value={value.accretion.strength}
          min={0}
          max={3}
          step={0.01}
          onChange={(strength) => patch({ accretion: { ...value.accretion, strength } })}
        />
        <Slider
          label="wind (spiral tightness)"
          value={value.accretion.wind}
          min={0}
          max={6}
          step={0.01}
          onChange={(wind) => patch({ accretion: { ...value.accretion, wind } })}
        />
        <Slider
          label="flatten to disc"
          value={value.accretion.flatten}
          min={0}
          max={1}
          step={0.01}
          onChange={(flatten) => patch({ accretion: { ...value.accretion, flatten } })}
        />
        <Slider
          label="turbulence (filaments)"
          value={value.accretion.turbulence}
          min={0}
          max={0.6}
          step={0.005}
          onChange={(turbulence) => patch({ accretion: { ...value.accretion, turbulence } })}
        />
        <Slider
          label="particle size"
          value={value.accretion.size}
          min={4}
          max={120}
          step={1}
          onChange={(size) => patch({ accretion: { ...value.accretion, size } })}
        />
        <Slider
          label="swallow radius"
          value={value.accretion.innerRadius}
          min={0.01}
          max={0.6}
          step={0.005}
          onChange={(innerRadius) => patch({ accretion: { ...value.accretion, innerRadius } })}
        />
        <ColorField
          label="outer (cool)"
          value={value.accretion.colorCool}
          onChange={(colorCool) => patch({ accretion: { ...value.accretion, colorCool } })}
        />
        <ColorField
          label="inner (hot)"
          value={value.accretion.colorHot}
          onChange={(colorHot) => patch({ accretion: { ...value.accretion, colorHot } })}
        />
      </Section>

      <Section title="Core light">
        <ColorField
          label="colour"
          value={value.coreLight.color}
          onChange={(color) => patch({ coreLight: { ...value.coreLight, color } })}
        />
        <Slider
          label="intensity"
          value={value.coreLight.intensity}
          min={0}
          max={40}
          step={0.5}
          onChange={(intensity) => patch({ coreLight: { ...value.coreLight, intensity } })}
        />
        <Slider
          label="range (0 = infinite)"
          value={value.coreLight.distance}
          min={0}
          max={30}
          step={0.5}
          onChange={(distance) => patch({ coreLight: { ...value.coreLight, distance } })}
        />
      </Section>

      <Section title="Bloom">
        <Slider
          label="strength"
          value={value.bloom.strength}
          min={0}
          max={3}
          step={0.01}
          onChange={(strength) => patch({ bloom: { ...value.bloom, strength } })}
        />
        <Slider
          label="radius"
          value={value.bloom.radius}
          min={0}
          max={1.5}
          step={0.01}
          onChange={(radius) => patch({ bloom: { ...value.bloom, radius } })}
        />
        <Slider
          label="threshold"
          value={value.bloom.threshold}
          min={0}
          max={1}
          step={0.01}
          onChange={(threshold) => patch({ bloom: { ...value.bloom, threshold } })}
        />
      </Section>

      <Section title="Lights">
        <ColorField
          label="key colour"
          value={value.key.color}
          onChange={(color) => patch({ key: { ...value.key, color } })}
        />
        <Slider
          label="key intensity"
          value={value.key.intensity}
          min={0}
          max={6}
          step={0.05}
          onChange={(intensity) => patch({ key: { ...value.key, intensity } })}
        />
        <ColorField
          label="fill colour"
          value={value.fill.color}
          onChange={(color) => patch({ fill: { ...value.fill, color } })}
        />
        <Slider
          label="fill intensity"
          value={value.fill.intensity}
          min={0}
          max={6}
          step={0.05}
          onChange={(intensity) => patch({ fill: { ...value.fill, intensity } })}
        />
        <ColorField
          label="ambient colour"
          value={value.ambient.color}
          onChange={(color) => patch({ ambient: { ...value.ambient, color } })}
        />
        <Slider
          label="ambient intensity"
          value={value.ambient.intensity}
          min={0}
          max={3}
          step={0.05}
          onChange={(intensity) => patch({ ambient: { ...value.ambient, intensity } })}
        />
      </Section>

      <Section title="Render">
        <Slider
          label="exposure"
          value={value.exposure}
          min={0.2}
          max={3}
          step={0.01}
          onChange={(exposure) => patch({ exposure })}
        />
        <Slider
          label="env reflections"
          value={value.envIntensity}
          min={0}
          max={3}
          step={0.01}
          onChange={(envIntensity) => patch({ envIntensity })}
        />
        <Slider
          label="camera fov"
          value={value.camera.fov}
          min={18}
          max={80}
          step={1}
          onChange={(fov) => patch({ camera: { ...value.camera, fov } })}
        />
        <ColorField
          label="background"
          value={value.background.color}
          onChange={(color) => patch({ background: { ...value.background, color } })}
        />
        <Toggle
          label="transparent bg"
          value={value.background.transparent}
          onChange={(transparent) => patch({ background: { ...value.background, transparent } })}
        />
      </Section>
    </div>
  );
}
