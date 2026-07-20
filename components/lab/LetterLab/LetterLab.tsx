'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, Clipboard, RotateCcw } from 'lucide-react';
import { useLetterLab, type LetterLabSettings } from './hooks/useLetterLab';
import type { MarkMaterialVariant } from '@/components/sections/WorksField/markBody';
import { MARKS } from '@/components/sections/WorksField/marks';
import {
  DEFAULT_CHUNK_SPECS,
  DEFAULT_MARK_LAYOUT,
  type ChunkMaterialSpec,
} from '@/components/sections/WorksField/markChunkMaterial';
import ChunkSpecEditor from './ChunkSpecEditor';
import ChunkMixBalancer, { type MixZone } from './ChunkMixBalancer';
import { formatMarkPresetSource } from './markPresetSource';

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

/** How long the copy button stays confirmed before reverting. */
const COPY_FEEDBACK_MS = 1600;

/**
 * Backdrops to judge a mark against. The canvas renders with `alpha: true`, so this is literally the
 * page showing through behind it.
 *
 * ⚠ `Site` is the one that counts — the works field is near-black, and the base mix is built around
 * that (pale rim to draw the silhouette against dark). A mark tuned to look good on grey will have its
 * rim disappear on the real background, because the contrast that was carrying the shape is gone.
 * The lighter tones are for SEEING the geometry while you work, not for judging the final look.
 */
const BACKDROPS = [
  { id: 'grey', label: 'Grey', color: '#6e737a' },
  { id: 'slate', label: 'Slate', color: '#39404a' },
  { id: 'site', label: 'Site', color: '#060606' },
] as const;

const DEFAULT_SETTINGS: Omit<LetterLabSettings, 'character' | 'svgMarkId'> = {
  // Rock by default — it's the look that belongs in the works field; solid is the comparison.
  // These four are the values authored in the lab on 2026-07-20 and approved; they're the baseline the
  // works field should inherit, not arbitrary starting points.
  body: 'rock',
  // Cloned, so editing the mix in the panel can never write back into the shared module default.
  chunkSpecs: DEFAULT_CHUNK_SPECS.map((spec) => ({ ...spec })),
  // The authored layout, imported rather than re-typed so the two can't drift apart.
  ...DEFAULT_MARK_LAYOUT,
  // Formation: long enough to watch it happen, with the outline landing last so the shape resolves.
  formationSeconds: 2.4,
  formationBaseFraction: 0.3,
  formationStagger: 0.55,
  formationEdgeDelay: 0.3,
  // The cloud the rocks live in before they're called. Wide enough to fill the frame so they read as
  // ambient debris rather than a tidy reservoir parked just off the mark.
  freeRadius: 4.5,
  freeDriftAmplitude: 0.35,
  variant: 'hull',
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
  const [hasCopied, setHasCopied] = useState(false);
  // Grey by default — the marks are being authored right now, and the geometry has to be visible
  // before it can be judged. Switch to `Site` before trusting how it looks.
  const [backdrop, setBackdrop] = useState<string>(BACKDROPS[0].id);
  const [mixZone, setMixZone] = useState<MixZone>('edge');

  const backdropColor =
    BACKDROPS.find((option) => option.id === backdrop)?.color ?? BACKDROPS[0].color;

  const isLetters = subject === 'letters';
  const isRock = settings.body === 'rock';
  const character = GLYPHS[glyphIndex];
  const currentLogo = SVG_MARKS[logoIndex];

  const { replayFormation } = useLetterLab(canvasRef, {
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

  /** Apply a rebalanced weight list to whichever zone the balancer is editing. */
  const applyMixWeights = (weights: number[]) =>
    setSettings((current) => ({
      ...current,
      chunkSpecs: current.chunkSpecs.map((spec, index) =>
        mixZone === 'edge'
          ? { ...spec, edgeWeight: weights[index] }
          : { ...spec, interiorWeight: weights[index] },
      ),
    }));

  const updateChunkSpec = (index: number, next: ChunkMaterialSpec) =>
    setSettings((current) => ({
      ...current,
      chunkSpecs: current.chunkSpecs.map((spec, specIndex) =>
        specIndex === index ? next : spec,
      ),
    }));

  // Weights are relative and normalised per zone, so the panel shows each one's actual share rather
  // than its raw number — "10" means nothing without mentally summing the other four.
  const totalEdgeWeight = settings.chunkSpecs.reduce((sum, spec) => sum + spec.edgeWeight, 0);
  const totalInteriorWeight = settings.chunkSpecs.reduce(
    (sum, spec) => sum + spec.interiorWeight,
    0,
  );
  const share = (weight: number, total: number) => (total > 0 ? (weight / total) * 100 : 0);

  const copyPreset = () => {
    const source = formatMarkPresetSource(
      settings.chunkSpecs,
      {
        edgeChunkCount: settings.edgeChunkCount,
        edgeChunkScale: settings.edgeChunkScale,
        interiorChunkScale: settings.interiorChunkScale,
        interiorChunkCount: settings.interiorChunkCount,
        depth: settings.depth,
      },
      {
        formationSeconds: settings.formationSeconds,
        formationBaseFraction: settings.formationBaseFraction,
        formationStagger: settings.formationStagger,
        formationEdgeDelay: settings.formationEdgeDelay,
        freeRadius: settings.freeRadius,
        freeDriftAmplitude: settings.freeDriftAmplitude,
      },
    );
    // Logged as well as copied: the clipboard needs a secure context, and this gets opened over plain
    // http on a LAN address often enough that the console is the fallback that always works. Same
    // reasoning as lib/tunerExport's copy.
    navigator.clipboard?.writeText(source).catch(() => {});
    console.log(source);
    setHasCopied(true);
    window.setTimeout(() => setHasCopied(false), COPY_FEEDBACK_MS);
  };

  return (
    <div
      className="relative h-[100dvh] w-full overflow-hidden transition-colors duration-300"
      style={{ background: backdropColor }}
    >
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
        {/* Copy the whole session as pasteable source. Sticky, so it stays reachable however far down
            the chunk mix you've scrolled. */}
        <button
          type="button"
          onClick={copyPreset}
          className={`sticky top-0 z-10 flex items-center justify-center gap-2 rounded border px-3 py-2 text-[0.65rem] uppercase tracking-eyebrow backdrop-blur transition-colors ${
            hasCopied
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border bg-card/90 text-fg hover:border-accent hover:text-accent'
          }`}
        >
          {hasCopied ? <Check size={13} /> : <Clipboard size={13} />}
          {hasCopied ? 'Copied — also logged' : 'Copy config'}
        </button>

        {/* Backdrop. Not a look decision — a visibility one while authoring. */}
        <div className="flex flex-col gap-2">
          <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">Backdrop</span>
          <div className="flex gap-1 rounded-full border border-border p-1">
            {BACKDROPS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setBackdrop(option.id)}
                className={`flex-1 rounded-full px-2 py-1 text-[0.6rem] uppercase tracking-eyebrow transition-colors ${
                  backdrop === option.id ? 'bg-accent text-black' : 'text-muted hover:text-fg'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {backdrop !== 'site' && (
            <p className="text-[0.6rem] leading-relaxed text-muted">
              Authoring aid only — the works field is near-black. Check on{' '}
              <span className="text-fg">Site</span> before judging the mix.
            </p>
          )}
        </div>

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
              label="Outline chunks"
              value={settings.edgeChunkCount}
              min={40}
              max={600}
              step={10}
              onChange={(value) => update('edgeChunkCount', value)}
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

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">
                  Formation
                </span>
                <button
                  type="button"
                  onClick={replayFormation}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.6rem] uppercase tracking-eyebrow text-fg transition-colors hover:border-accent hover:text-accent"
                >
                  <RotateCcw size={11} />
                  Replay
                </button>
              </div>
              <Slider
                label="Duration (s)"
                value={settings.formationSeconds}
                min={0}
                max={8}
                step={0.1}
                onChange={(value) => update('formationSeconds', value)}
              />
              <Slider
                label="Base already placed"
                value={settings.formationBaseFraction}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => update('formationBaseFraction', value)}
              />
              <Slider
                label="Cloud radius"
                value={settings.freeRadius}
                min={1}
                max={12}
                step={0.1}
                onChange={(value) => update('freeRadius', value)}
              />
              <Slider
                label="Cloud drift"
                value={settings.freeDriftAmplitude}
                min={0}
                max={1.5}
                step={0.05}
                onChange={(value) => update('freeDriftAmplitude', value)}
              />
              <Slider
                label="Stagger"
                value={settings.formationStagger}
                min={0}
                max={0.95}
                step={0.05}
                onChange={(value) => update('formationStagger', value)}
              />
              <Slider
                label="Outline delay"
                value={settings.formationEdgeDelay}
                min={0}
                max={0.8}
                step={0.05}
                onChange={(value) => update('formationEdgeDelay', value)}
              />
              <p className="text-[0.6rem] leading-relaxed text-muted">
                Base sits in place from frame one — the rest fly in to complete it. Outline delay
                holds the silhouette back so the mass gathers first and the shape resolves last.
              </p>
            </div>

            {/* All the proportions in one place, pinned to 100%. */}
            <div className="border-t border-border pt-4">
              <ChunkMixBalancer
                specs={settings.chunkSpecs}
                zone={mixZone}
                onZoneChange={setMixZone}
                onWeightsChange={applyMixWeights}
              />
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">
                Rock types
              </span>
              <p className="text-[0.6rem] leading-relaxed text-muted">
                Surface and look of each kind. Proportions are set in the mix above.
              </p>
              {settings.chunkSpecs.map((spec, index) => (
                <ChunkSpecEditor
                  key={spec.id}
                  spec={spec}
                  edgeSharePercent={share(spec.edgeWeight, totalEdgeWeight)}
                  interiorSharePercent={share(spec.interiorWeight, totalInteriorWeight)}
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
