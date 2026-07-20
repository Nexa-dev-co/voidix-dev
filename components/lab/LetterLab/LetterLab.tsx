'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLetterLab, type LetterLabSettings } from './hooks/useLetterLab';
import type { MarkMaterialVariant } from '@/components/sections/WorksField/markBody';
import { MARKS } from '@/components/sections/WorksField/marks';
import {
  DEFAULT_CHUNK_SPECS,
  type ChunkMaterialSpec,
} from '@/components/sections/WorksField/markChunkMaterial';
import ChunkSpecEditor from './ChunkSpecEditor';

/**
 * The letter lab — one extruded glyph, steppable, so the question "do we need Syne letter SVGs?" can
 * be answered by looking at something rather than by guessing.
 *
 * Styled with Tailwind utilities rather than by adding to `globals.css`. That file is already 1786
 * lines carrying every shipped component's CSS, and a throwaway testbed has no business growing it.
 *
 * ⚠ The typeface is helvetiker, not Syne — see the note in `marks.ts`. What this page can tell you is
 * whether extruded 3D type works as a body in this lighting at all; it cannot tell you how the brand
 * face will look.
 */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
const INITIAL_GLYPH_INDEX = GLYPHS.indexOf('V');

/** The registry's SVG marks — the logo half of the lab. */
const SVG_MARKS = MARKS.filter((mark) => mark.kind === 'svg');

type Subject = 'letters' | 'logos';

const DEFAULT_SETTINGS: Omit<LetterLabSettings, 'character' | 'svgMarkId'> = {
  // Rock by default — it's the look that belongs in the works field; solid is the comparison.
  // These four are the values authored in the lab on 2026-07-20 and approved; they're the baseline the
  // works field should inherit, not arbitrary starting points.
  body: 'rock',
  // Cloned, so editing the mix in the panel can never write back into the shared module default.
  chunkSpecs: DEFAULT_CHUNK_SPECS.map((spec) => ({ ...spec })),
  edgeSpacing: 0.03,
  edgeChunkScale: 0.04,
  interiorChunkScale: 0.06,
  interiorChunkCount: 340,
  variant: 'hull',
  depth: 0.34,
  bevelSize: 0.03,
  bevelThickness: 0.03,
  color: '#11161c',
  edgeColor: '#00e5ff',
  edgeEmissive: 1.6,
  roughness: 0.32,
  metalness: 0.9,
};

/**
 * Each variant carries the edge colour that makes it read as itself — picking `lava` and leaving the
 * glow on brand cyan would render something that is neither look, and tell you nothing.
 *
 * ⚠ `lava` is only half-shown here: the field's basalt texture isn't loaded in the lab, so you're
 * seeing its emissive and surface response without the veins. Judge the textured read in the section.
 */
const VARIANTS: { id: MarkMaterialVariant; label: string; edgeColor: string }[] = [
  { id: 'hull', label: 'Hull — dark face, cyan edge', edgeColor: '#00e5ff' },
  { id: 'lava', label: 'Lava — molten (untextured here)', edgeColor: '#ff7a2a' },
];

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-[0.65rem] uppercase tracking-eyebrow text-muted">
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

export default function LetterLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [glyphIndex, setGlyphIndex] = useState(
    INITIAL_GLYPH_INDEX >= 0 ? INITIAL_GLYPH_INDEX : 0,
  );
  const [logoIndex, setLogoIndex] = useState(0);
  const [subject, setSubject] = useState<Subject>('letters');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const isLetters = subject === 'letters';
  const isRock = settings.body === 'rock';
  const character = GLYPHS[glyphIndex];
  const currentLogo = SVG_MARKS[logoIndex];

  useLetterLab(canvasRef, {
    ...settings,
    character,
    svgMarkId: isLetters ? null : currentLogo?.id ?? null,
  });

  // One stepper drives whichever list is showing, so the control stays in the same place.
  const step = (direction: number) => {
    if (isLetters) {
      setGlyphIndex((current) => (current + direction + GLYPHS.length) % GLYPHS.length);
      return;
    }
    setLogoIndex((current) => (current + direction + SVG_MARKS.length) % SVG_MARKS.length);
  };

  const update = <Key extends keyof typeof settings>(
    key: Key,
    value: (typeof settings)[Key],
  ) => setSettings((current) => ({ ...current, [key]: value }));

  const updateChunkSpec = (index: number, next: ChunkMaterialSpec) =>
    setSettings((current) => ({
      ...current,
      chunkSpecs: current.chunkSpecs.map((spec, specIndex) =>
        specIndex === index ? next : spec,
      ),
    }));

  // Weights are relative, so the panel shows each one's actual share of the mark rather than its raw
  // number — otherwise "10" means nothing without mentally summing the other four.
  const totalChunkWeight = settings.chunkSpecs.reduce((sum, spec) => sum + spec.weight, 0);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-bg">
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Glyph stepper — the primary control, so it sits centre-bottom where the eye already is. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 p-6">
        {/* Letters vs logos — the two halves of the pipeline that need proving. */}
        <div className="pointer-events-auto flex gap-1 rounded-full border border-border p-1">
          {(['letters', 'logos'] as Subject[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSubject(option)}
              className={`rounded-full px-4 py-1 text-[0.65rem] uppercase tracking-eyebrow transition-colors ${
                subject === option ? 'bg-accent text-black' : 'text-muted hover:text-fg'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto flex items-center gap-6">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={isLetters ? 'Previous glyph' : 'Previous logo'}
            className="rounded-full border border-border p-2 text-fg transition-colors hover:border-accent hover:text-accent"
          >
            <ChevronLeft size={18} />
          </button>

          <span className="min-w-[8ch] text-center font-display text-2xl text-fg">
            {isLetters ? character : currentLogo?.label}
          </span>

          <button
            type="button"
            onClick={() => step(1)}
            aria-label={isLetters ? 'Next glyph' : 'Next logo'}
            className="rounded-full border border-border p-2 text-fg transition-colors hover:border-accent hover:text-accent"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <p className="text-[0.65rem] uppercase tracking-eyebrow text-muted">
          {isLetters ? 'helvetiker bold · not Syne · drag to inspect' : 'drag to inspect'}
        </p>
      </div>

      {/* Extrusion + material controls. Bottom-left on desktop, full-width above the stepper on
          narrow screens so nothing overlaps the glyph. */}
      <div className="pointer-events-auto absolute left-0 top-0 flex max-h-[100dvh] w-full max-w-xs flex-col gap-4 overflow-y-auto border-border bg-card/70 p-5 backdrop-blur md:left-6 md:top-1/2 md:w-72 md:max-h-[90dvh] md:-translate-y-1/2 md:rounded-lg md:border">
        {/* Rock vs solid — the headline comparison, so it sits first. */}
        <div className="flex flex-col gap-2">
          <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">Body</span>
          <div className="flex gap-1 rounded-full border border-border p-1">
            {(['rock', 'solid'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => update('body', option)}
                className={`flex-1 rounded-full px-3 py-1 text-[0.65rem] uppercase tracking-eyebrow transition-colors ${
                  settings.body === option ? 'bg-accent text-black' : 'text-muted hover:text-fg'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {isRock && (
          <>
            <Slider
              label="Edge spacing"
              value={settings.edgeSpacing}
              min={0.03}
              max={0.2}
              step={0.005}
              onChange={(value) => update('edgeSpacing', value)}
            />
            <Slider
              label="Edge chunk size"
              value={settings.edgeChunkScale}
              min={0.02}
              max={0.15}
              step={0.005}
              onChange={(value) => update('edgeChunkScale', value)}
            />
            <Slider
              label="Interior chunk size"
              value={settings.interiorChunkScale}
              min={0.03}
              max={0.3}
              step={0.005}
              onChange={(value) => update('interiorChunkScale', value)}
            />
            <Slider
              label="Interior count"
              value={settings.interiorChunkCount}
              min={0}
              max={1200}
              step={20}
              onChange={(value) => update('interiorChunkCount', value)}
            />

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">
                Chunk mix
              </span>
              {settings.chunkSpecs.map((spec, index) => (
                <ChunkSpecEditor
                  key={spec.id}
                  spec={spec}
                  sharePercent={
                    totalChunkWeight > 0 ? (spec.weight / totalChunkWeight) * 100 : 0
                  }
                  onChange={(next) => updateChunkSpec(index, next)}
                />
              ))}
            </div>
          </>
        )}

        <div className={`flex flex-col gap-2 ${isRock ? 'opacity-40' : ''}`}>
          <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">
            Material {isRock && '· solid only'}
          </span>
          {VARIANTS.map((variant) => (
            <button
              key={variant.id}
              type="button"
              onClick={() =>
                setSettings((current) => ({
                  ...current,
                  variant: variant.id,
                  edgeColor: variant.edgeColor,
                }))
              }
              className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                settings.variant === variant.id
                  ? 'border-accent text-accent'
                  : 'border-border text-muted hover:text-fg'
              }`}
            >
              {variant.label}
            </button>
          ))}
        </div>

        {/* Depth is the slab thickness for rock and the extrusion for solid — it drives both. */}
        <Slider
          label={isRock ? 'Slab depth' : 'Depth'}
          value={settings.depth}
          min={0.05}
          max={1}
          step={0.01}
          onChange={(value) => update('depth', value)}
        />

        {!isRock && (
          <>
            <Slider
              label="Bevel size"
              value={settings.bevelSize}
              min={0}
              max={0.15}
              step={0.005}
              onChange={(value) => update('bevelSize', value)}
            />
            <Slider
              label="Bevel thickness"
              value={settings.bevelThickness}
              min={0}
              max={0.15}
              step={0.005}
              onChange={(value) => update('bevelThickness', value)}
            />
            <Slider
              label="Edge glow"
              value={settings.edgeEmissive}
              min={0}
              max={4}
              step={0.1}
              onChange={(value) => update('edgeEmissive', value)}
            />
            <Slider
              label="Roughness"
              value={settings.roughness}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => update('roughness', value)}
            />
            <Slider
              label="Metalness"
              value={settings.metalness}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => update('metalness', value)}
            />
          </>
        )}
      </div>
    </div>
  );
}
