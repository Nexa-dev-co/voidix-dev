'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  CHUNK_TEXTURES,
  type ChunkMaterialSpec,
  type ChunkTreatment,
} from '@/components/sections/WorksField/markChunkMaterial';

/**
 * One chunk kind's controls.
 *
 * Collapsed to a name + weight by default: the weight is what you actually reach for when balancing a
 * mix, and five fully-expanded panels would bury it. Everything else is one click away.
 */

interface ChunkSpecEditorProps {
  spec: ChunkMaterialSpec;
  /** Shares of each zone this spec accounts for once weights are normalised, as percentages. */
  edgeSharePercent: number;
  interiorSharePercent: number;
  onChange: (next: ChunkMaterialSpec) => void;
}

interface FieldSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function FieldSlider({ label, value, min, max, step, onChange }: FieldSliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-[0.6rem] uppercase tracking-eyebrow text-muted">
        <span>{label}</span>
        <span className="text-fg">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-accent"
      />
    </label>
  );
}

export default function ChunkSpecEditor({
  spec,
  edgeSharePercent,
  interiorSharePercent,
  onChange,
}: ChunkSpecEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const set = <Key extends keyof ChunkMaterialSpec>(
    key: Key,
    value: ChunkMaterialSpec[Key],
  ) => onChange({ ...spec, [key]: value });

  return (
    <div className="rounded border border-border">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center gap-2 px-2 py-2 text-left"
      >
        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span
          className="h-3 w-3 shrink-0 rounded-sm border border-border"
          style={{ background: spec.tint }}
          aria-hidden="true"
        />
        <span className="flex-1 truncate text-[0.7rem] text-fg">{spec.label}</span>
        {/* Both shares up front — the whole point of the split is seeing rim vs mass at a glance. */}
        <span className="text-[0.6rem] tabular-nums text-accent">
          {edgeSharePercent.toFixed(0)}/{interiorSharePercent.toFixed(0)}%
        </span>
      </button>

      {/* Weights are NOT here — they live in the balancer above, where they're coupled to sum to 100.
          Two places to set one number is how the two quietly disagree. */}
      {isOpen && (
        <div className="flex flex-col gap-3 px-2 pb-3">
            <label className="flex flex-col gap-1">
              <span className="text-[0.6rem] uppercase tracking-eyebrow text-muted">Texture</span>
              <select
                value={spec.texturePath}
                onChange={(event) => set('texturePath', event.target.value)}
                className="rounded border border-border bg-bg px-2 py-1 text-[0.7rem] text-fg"
              >
                {CHUNK_TEXTURES.map((texture) => (
                  <option key={texture.path} value={texture.path}>
                    {texture.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[0.6rem] uppercase tracking-eyebrow text-muted">Treatment</span>
              <div className="flex gap-1 rounded-full border border-border p-1">
                {(['stone', 'meteor'] as ChunkTreatment[]).map((treatment) => (
                  <button
                    key={treatment}
                    type="button"
                    onClick={() => set('treatment', treatment)}
                    className={`flex-1 rounded-full px-2 py-1 text-[0.6rem] uppercase tracking-eyebrow transition-colors ${
                      spec.treatment === treatment
                        ? 'bg-accent text-black'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    {treatment}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between gap-2">
              <span className="text-[0.6rem] uppercase tracking-eyebrow text-muted">Tint</span>
              <input
                type="color"
                value={spec.tint}
                onChange={(event) => set('tint', event.target.value)}
                className="h-6 w-12 cursor-pointer rounded border border-border bg-transparent"
              />
            </label>

            <FieldSlider
              label="Texture repeat"
              value={spec.textureRepeat}
              min={0.5}
              max={6}
              step={0.1}
              onChange={(value) => set('textureRepeat', value)}
            />
            <FieldSlider
              label="Roughness"
              value={spec.roughness}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => set('roughness', value)}
            />
            {spec.treatment === 'meteor' && (
              <FieldSlider
                label="Vein glow"
                value={spec.emissiveIntensity}
                min={0}
                max={5}
                step={0.1}
                onChange={(value) => set('emissiveIntensity', value)}
              />
            )}
        </div>
      )}
    </div>
  );
}
