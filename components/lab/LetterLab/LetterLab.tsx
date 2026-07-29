'use client';

import { useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Clipboard,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import { DEFAULT_GEODE_MORPH } from '@/components/sections/WorksField/markGeodeMorph';
import {
  DEFAULT_GEODE_PHASE_TIMING,
  type GeodePhaseTiming,
} from '@/components/sections/WorksField/markGeodePhases';
import { useLetterLab, type LetterLabSettings } from './hooks/useLetterLab';
import { useDebounced } from './hooks/useDebounced';
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

/** Quiet time after the last slider move before the scene rebuilds. Long enough to cover a drag. */
const SCENE_SETTLE_MS = 220;

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

/**
 * The geode's starting point.
 *
 * `rockRadius` is deliberately a little larger than the mark's own half-extent (`TARGET_SIZE` is 2.6,
 * so the mark reaches ~1.3): that puts the base rock at the reference's middle of the spectrum, where
 * the mark is carved OUT of a rock that was always big enough and the crust is the old skin. Shrink it
 * and the same build slides continuously toward a crystal mark grown out of a seed.
 */
const DEFAULT_GEODE: Pick<
  LetterLabSettings,
  | 'geodeProgress'
  | 'geodePlaying'
  | 'geodeCycleSeconds'
  | 'geodePhaseTiming'
  | 'rockOffsetX'
  | 'rockOffsetY'
  | 'rockOffsetZ'
  | 'rockRadius'
  | 'rockStretchX'
  | 'rockStretchY'
  | 'rockStretchZ'
  | 'rockSeed'
  | 'rockCarveAmplitude'
  | 'cling'
  | 'crustThickness'
  | 'markCarveAmplitude'
  | 'markCarveFrequency'
  | 'markCarveInPlaneDamping'
  | 'crystalPatchScale'
  | 'silhouetteHold'
  | 'crystalFacetScale'
  | 'crystalFacetAmplitude'
  | 'crystalColor'
  | 'crystalEmissive'
  | 'crystalRoughness'
  | 'crystalMetalness'
  | 'chargeStrength'
  | 'facetShading'
  | 'edgeBias'
  | 'crystalCoverageForming'
  | 'crystalCoverageSettled'
  | 'wobbleAmplitude'
  | 'capEdgeFraction'
  | 'capSubdivisions'
  | 'depthRings'
  | 'holeSeedFraction'
> = {
  // Opens on the formed mark, so there is something to look at before you touch anything.
  geodeProgress: 1,
  geodePlaying: false,
  geodeCycleSeconds: 6,
  geodePhaseTiming: { ...DEFAULT_GEODE_PHASE_TIMING },
  rockOffsetX: 0,
  rockOffsetY: 0,
  rockOffsetZ: 0,
  rockRadius: 1.5,
  rockStretchX: 1,
  // Was 1.12 / 0.7 — a deliberately flattened egg. Rounder now, so what opens is a ROCK: the mark is
  // a 0.7-deep slab, and a rock nearly as flat as the slab it becomes never reads as having been
  // carved out of anything. Not taken all the way to 1 because `cling` (0.85) pulls the mark's outer
  // face onto the rock's skin, and a much deeper rock swells the letter with it.
  rockStretchY: 1,
  rockStretchZ: 0.85,
  // Project 01's rock seed, straight from worksProjects — so the base rock is literally one of the
  // field's rocks rather than a shape that merely resembles them.
  rockSeed: 149,
  rockCarveAmplitude: 1,
  cling: 0.85,
  crustThickness: 0.18,
  markCarveAmplitude: 0.035,
  markCarveFrequency: 1.6,
  // Most displacement still goes through the thickness — in-plane displacement is what eats a counter
  // or rounds off a "V", and a mark that stops reading has failed at the only job it has. But at 0.7
  // the outline came out a PERFECT letter with a rocky surface, which reads as a decal on stone. Let
  // enough through that the silhouette is visibly hewn rather than typeset.
  markCarveInPlaneDamping: 0.4,
  // Cells want to be a few triangles across or the facets alias into noise rather than reading as
  // plates. At the default edge fraction that puts them around here.
  // A patch covers several facets, so it runs at a lower frequency than the facets themselves —
  // otherwise coverage speckles individual facets instead of removing whole plates.
  crystalPatchScale: 4,
  // Hold the rock's outline while the rest of the shape resolves, so a letter's notch cuts in at the
  // end instead of gaping through the whole morph. 0 restores the old distance-only delay.
  silhouetteHold: 0.65,
  crystalFacetScale: 12,
  // Raised so the facets stand proud of the outline instead of sitting flush in it — a little geode
  // overgrowing the letter's edge, which is what stops the cut looking machined.
  crystalFacetAmplitude: 0.055,
  // ── The crystal's LOOK is not authored here ──
  // Every one of these is a uniform the shader already owns a default for, and `markGeodeMorph.ts`
  // documents why each value is what it is (crystal is lit, not a lamp; the colour is the vein amber
  // rather than the brand cyan; the coverage pair is the whole `spread` beat). Taken from that module
  // rather than re-typed beside it, so the lab cannot open on a look the shipped default doesn't have.
  crystalColor: DEFAULT_GEODE_MORPH.crystalColor,
  crystalEmissive: DEFAULT_GEODE_MORPH.crystalEmissive,
  crystalRoughness: DEFAULT_GEODE_MORPH.crystalRoughness,
  crystalMetalness: DEFAULT_GEODE_MORPH.crystalMetalness,
  chargeStrength: DEFAULT_GEODE_MORPH.chargeStrength,
  facetShading: DEFAULT_GEODE_MORPH.facetShading,
  edgeBias: DEFAULT_GEODE_MORPH.edgeBias,
  crystalCoverageForming: DEFAULT_GEODE_MORPH.crystalCoverageForming,
  crystalCoverageSettled: DEFAULT_GEODE_MORPH.crystalCoverageSettled,
  wobbleAmplitude: DEFAULT_GEODE_MORPH.wobbleAmplitude,
  capEdgeFraction: 0.017,
  capSubdivisions: 3,
  depthRings: 5,
  holeSeedFraction: 0.04,
};

const DEFAULT_SETTINGS: Omit<LetterLabSettings, 'character' | 'svgMarkId'> = {
  ...DEFAULT_GEODE,
  // Geode by default — it is the thing being judged this round. `rock` (the swarm it replaces) and
  // `solid` are one click away, which is the whole point of keeping all three live.
  body: 'geode',
  // Cloned, so editing the mix in the panel can never write back into the shared module default.
  chunkSpecs: DEFAULT_CHUNK_SPECS.map((spec) => ({ ...spec })),
  // The authored layout, imported rather than re-typed so the two can't drift apart.
  ...DEFAULT_MARK_LAYOUT,
  // Formation: slow and deliberate. A high stagger with a high order means the rocks arrive as a
  // sequence — the outline drawing itself around the contour — rather than a simultaneous swarm.
  formationSeconds: 5,
  shapeBlendSeconds: 4,
  formationBaseFraction: 0.3,
  formationStagger: 0.8,
  formationEdgeDelay: 0.25,
  formationOrder: 0.85,
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
  /** Digits in the read-out. Counts, seeds and subdivision rounds are integers — "149.00" is noise. */
  decimals?: number;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, decimals = 2, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-[0.65rem] uppercase tracking-eyebrow text-muted">
        <span>{label}</span>
        <span className="text-fg">{value.toFixed(decimals)}</span>
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
  const isGeode = settings.body === 'geode';
  const isSolid = settings.body === 'solid';
  const character = GLYPHS[glyphIndex];
  const currentLogo = SVG_MARKS[logoIndex];

  // Sliders stay live in the UI; the scene only catches up once you stop moving them. Which mark is
  // shown is NOT debounced — stepping a glyph should answer immediately, and it's cheap.
  const settledSettings = useDebounced(settings, SCENE_SETTLE_MS);

  const { replayFormation, crustShare } = useLetterLab(canvasRef, {
    ...settledSettings,
    character,
    svgMarkId: isLetters ? null : currentLogo?.id ?? null,
    // ── Live, deliberately outside the debounce ──
    // Everything here is a uniform or a playhead, so there is nothing to rebuild. The scrub is the
    // primary control and a 220ms lag on it would feel broken; the crystal knobs are pushed onto the
    // shader every frame. The geometry knobs — the rock's pose above all — stay debounced, because
    // they are baked into the vertex buffers and each one re-carves the body.
    body: settings.body,
    geodeProgress: settings.geodeProgress,
    geodePlaying: settings.geodePlaying,
    geodeCycleSeconds: settings.geodeCycleSeconds,
    geodePhaseTiming: settings.geodePhaseTiming,
    crystalColor: settings.crystalColor,
    crystalEmissive: settings.crystalEmissive,
    crystalRoughness: settings.crystalRoughness,
    crystalMetalness: settings.crystalMetalness,
    chargeStrength: settings.chargeStrength,
    facetShading: settings.facetShading,
    edgeBias: settings.edgeBias,
    crystalCoverageForming: settings.crystalCoverageForming,
    crystalCoverageSettled: settings.crystalCoverageSettled,
    wobbleAmplitude: settings.wobbleAmplitude,
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

  /** The phase curves are nested one level down, so they get their own updater. */
  const updatePhase = (key: keyof GeodePhaseTiming, value: number) =>
    setSettings((current) => ({
      ...current,
      geodePhaseTiming: { ...current.geodePhaseTiming, [key]: value },
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
        shapeBlendSeconds: settings.shapeBlendSeconds,
        formationBaseFraction: settings.formationBaseFraction,
        formationStagger: settings.formationStagger,
        formationEdgeDelay: settings.formationEdgeDelay,
        formationOrder: settings.formationOrder,
        freeRadius: settings.freeRadius,
        freeDriftAmplitude: settings.freeDriftAmplitude,
      },
      {
        build: {
          rockOffsetX: settings.rockOffsetX,
          rockOffsetY: settings.rockOffsetY,
          rockOffsetZ: settings.rockOffsetZ,
          rockRadius: settings.rockRadius,
          rockStretchX: settings.rockStretchX,
          rockStretchY: settings.rockStretchY,
          rockStretchZ: settings.rockStretchZ,
          rockSeed: settings.rockSeed,
          rockCarveAmplitude: settings.rockCarveAmplitude,
          cling: settings.cling,
          crustThickness: settings.crustThickness,
          markCarveAmplitude: settings.markCarveAmplitude,
          markCarveFrequency: settings.markCarveFrequency,
          markCarveInPlaneDamping: settings.markCarveInPlaneDamping,
          silhouetteHold: settings.silhouetteHold,
          crystalPatchScale: settings.crystalPatchScale,
          crystalFacetScale: settings.crystalFacetScale,
          crystalFacetAmplitude: settings.crystalFacetAmplitude,
          capEdgeFraction: settings.capEdgeFraction,
          capSubdivisions: settings.capSubdivisions,
          depthRings: settings.depthRings,
          holeSeedFraction: settings.holeSeedFraction,
        },
        morph: {
          crystalColor: settings.crystalColor,
          crystalEmissive: settings.crystalEmissive,
          crystalRoughness: settings.crystalRoughness,
          crystalMetalness: settings.crystalMetalness,
          // The lab drives the charge off the crystal's own colour — one energy, surfacing in stages.
          chargeColor: settings.crystalColor,
          chargeStrength: settings.chargeStrength,
          facetShading: settings.facetShading,
          edgeBias: settings.edgeBias,
          crystalCoverageForming: settings.crystalCoverageForming,
          crystalCoverageSettled: settings.crystalCoverageSettled,
          wobbleAmplitude: settings.wobbleAmplitude,
          // No slider — exported at the value actually in force, so a paste reproduces what you saw
          // rather than silently reverting to whatever the module happens to hold later.
          wobbleFrequency: DEFAULT_GEODE_MORPH.wobbleFrequency,
        },
        phases: settings.geodePhaseTiming,
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

        {/* The headline comparison, so it sits first: one body that opens, six hundred that fly, and
            the plain extrusion as the control. */}
        <div className="flex flex-col gap-2">
          <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">Body</span>
          <div className="flex gap-1 rounded-full border border-border p-1">
            {(['geode', 'rock', 'solid'] as const).map((option) => (
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

        {isGeode && (
          <>
            {/* The scrub IS the effect — one number, and every curve hangs off it. So it goes first,
                and it runs backwards as freely as forwards, which is frames 7-12 of the storyboard. */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">Open</span>
                <button
                  type="button"
                  onClick={() => update('geodePlaying', !settings.geodePlaying)}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.6rem] uppercase tracking-eyebrow text-fg transition-colors hover:border-accent hover:text-accent"
                >
                  {settings.geodePlaying ? <Pause size={11} /> : <Play size={11} />}
                  {settings.geodePlaying ? 'Pause' : 'Play'}
                </button>
              </div>
              <Slider
                label="Progress"
                value={settings.geodeProgress}
                min={0}
                max={1}
                step={0.005}
                onChange={(value) => update('geodeProgress', value)}
              />
              <Slider
                label="Round trip (s)"
                value={settings.geodeCycleSeconds}
                min={1}
                max={20}
                step={0.5}
                onChange={(value) => update('geodeCycleSeconds', value)}
              />
              <p className="text-[0.6rem] leading-relaxed text-muted">
                Play ping-pongs the whole cycle and ignores the scrub; pausing hands it straight back.
              </p>
            </div>

            {/* Placing the rock badly is not an error, and without this you would just see a mark that
                has mysteriously gone all crystal. */}
            <div className="flex flex-col gap-1 border-t border-border pt-4">
              <span className="flex justify-between text-[0.65rem] uppercase tracking-eyebrow text-muted">
                <span>Crust share</span>
                <span className={crustShare < 0.05 ? 'text-fg' : 'text-accent'}>
                  {(crustShare * 100).toFixed(0)}%
                </span>
              </span>
              {crustShare < 0.05 && (
                <p className="text-[0.6rem] leading-relaxed text-muted">
                  Almost none of this mark was ever the rock&apos;s skin — it is all fresh cut or new
                  growth, so there is no geode read left. Move the rock so it intersects the mark, or
                  widen the crust band.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">
                Base rock
              </span>
              <p className="text-[0.6rem] leading-relaxed text-muted">
                Not the mark&apos;s centre — it is placed. Radius alone slides from a geode carved out
                of a rock (large) to a mark grown out of a seed (small).
              </p>
              <Slider
                label="Radius"
                value={settings.rockRadius}
                min={0.2}
                max={3}
                step={0.02}
                onChange={(value) => update('rockRadius', value)}
              />
              <Slider
                label="Offset X"
                value={settings.rockOffsetX}
                min={-2}
                max={2}
                step={0.02}
                onChange={(value) => update('rockOffsetX', value)}
              />
              <Slider
                label="Offset Y"
                value={settings.rockOffsetY}
                min={-2}
                max={2}
                step={0.02}
                onChange={(value) => update('rockOffsetY', value)}
              />
              <Slider
                label="Offset Z"
                value={settings.rockOffsetZ}
                min={-2}
                max={2}
                step={0.02}
                onChange={(value) => update('rockOffsetZ', value)}
              />
              <Slider
                label="Stretch X"
                value={settings.rockStretchX}
                min={0.3}
                max={2.5}
                step={0.02}
                onChange={(value) => update('rockStretchX', value)}
              />
              <Slider
                label="Stretch Y"
                value={settings.rockStretchY}
                min={0.3}
                max={2.5}
                step={0.02}
                onChange={(value) => update('rockStretchY', value)}
              />
              <Slider
                label="Stretch Z"
                value={settings.rockStretchZ}
                min={0.1}
                max={2.5}
                step={0.02}
                onChange={(value) => update('rockStretchZ', value)}
              />
              <Slider
                label="Carve"
                value={settings.rockCarveAmplitude}
                min={0}
                max={2}
                step={0.02}
                onChange={(value) => update('rockCarveAmplitude', value)}
              />
              {/* Ranged to cover worksProjects' own seeds (149 · 271 · 512 · 883) — the default is
                  project 01's, and at the old 0–20 the thumb pinned at the top while the read-out
                  said 149, so the first touch silently swapped the rock for a different one. */}
              <Slider
                label="Seed"
                value={settings.rockSeed}
                min={0}
                max={1000}
                step={1}
                decimals={0}
                onChange={(value) => update('rockSeed', value)}
              />
              <Slider
                label="Idle breath"
                value={settings.wobbleAmplitude}
                min={0}
                max={0.08}
                step={0.002}
                onChange={(value) => update('wobbleAmplitude', value)}
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">The cut</span>
              <Slider
                label="Cling to skin"
                value={settings.cling}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => update('cling', value)}
              />
              <Slider
                label="Crust thickness"
                value={settings.crustThickness}
                min={0.01}
                max={0.8}
                step={0.005}
                onChange={(value) => update('crustThickness', value)}
              />
              <Slider
                label="Rock carve"
                value={settings.markCarveAmplitude}
                min={0}
                max={0.2}
                step={0.002}
                onChange={(value) => update('markCarveAmplitude', value)}
              />
              <Slider
                label="Carve scale"
                value={settings.markCarveFrequency}
                min={0.2}
                max={6}
                step={0.05}
                onChange={(value) => update('markCarveFrequency', value)}
              />
              <Slider
                label="Silhouette protection"
                value={settings.markCarveInPlaneDamping}
                min={0}
                max={1}
                step={0.02}
                onChange={(value) => update('markCarveInPlaneDamping', value)}
              />
              <p className="text-[0.6rem] leading-relaxed text-muted">
                Cling at 1 makes the outer face the rock&apos;s own skin. Protection at 1 keeps the
                carve out of the mark&apos;s plane, which is what stops it eating a counter.
              </p>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">Crystal</span>
              <label className="flex items-center justify-between gap-2">
                <span className="text-[0.6rem] uppercase tracking-eyebrow text-muted">Colour</span>
                <input
                  type="color"
                  value={settings.crystalColor}
                  onChange={(event) => update('crystalColor', event.target.value)}
                  className="h-6 w-12 cursor-pointer rounded border border-border bg-transparent"
                />
              </label>
              <Slider
                label="Facet size"
                value={settings.crystalFacetScale}
                min={4}
                max={80}
                step={1}
                decimals={0}
                onChange={(value) => update('crystalFacetScale', value)}
              />
              <Slider
                label="Facet depth"
                value={settings.crystalFacetAmplitude}
                min={0}
                max={0.15}
                step={0.002}
                onChange={(value) => update('crystalFacetAmplitude', value)}
              />
              <Slider
                label="Geode while forming"
                value={settings.crystalCoverageForming}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => update('crystalCoverageForming', value)}
              />
              <Slider
                label="Geode once formed"
                value={settings.crystalCoverageSettled}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => update('crystalCoverageSettled', value)}
              />
              <Slider
                label="Stay solid"
                value={settings.silhouetteHold}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => update('silhouetteHold', value)}
              />
              <Slider
                label="Patch size"
                value={settings.crystalPatchScale}
                min={1}
                max={24}
                step={0.5}
                onChange={(value) => update('crystalPatchScale', value)}
              />
              <Slider
                label="Crystal on edges"
                value={settings.edgeBias}
                min={0}
                max={1}
                step={0.02}
                onChange={(value) => update('edgeBias', value)}
              />
              <Slider
                label="Flat shading"
                value={settings.facetShading}
                min={0}
                max={1}
                step={0.02}
                onChange={(value) => update('facetShading', value)}
              />
              <Slider
                label="Glow"
                value={settings.crystalEmissive}
                min={0}
                max={5}
                step={0.05}
                onChange={(value) => update('crystalEmissive', value)}
              />
              <Slider
                label="Charge (through crust)"
                value={settings.chargeStrength}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => update('chargeStrength', value)}
              />
              <Slider
                label="Roughness"
                value={settings.crystalRoughness}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => update('crystalRoughness', value)}
              />
              <Slider
                label="Metalness"
                value={settings.crystalMetalness}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => update('crystalMetalness', value)}
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">
                Choreography
              </span>
              <p className="text-[0.6rem] leading-relaxed text-muted">
                Where charge starts relative to grow is the entire feel of it — energy has to wake
                before the rock gives way, or the mark opens out of an inert stone.
              </p>
              <Slider
                label="Charge start"
                value={settings.geodePhaseTiming.chargeStart}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updatePhase('chargeStart', value)}
              />
              <Slider
                label="Charge end"
                value={settings.geodePhaseTiming.chargeEnd}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updatePhase('chargeEnd', value)}
              />
              <Slider
                label="Grow start"
                value={settings.geodePhaseTiming.growStart}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updatePhase('growStart', value)}
              />
              <Slider
                label="Grow end"
                value={settings.geodePhaseTiming.growEnd}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updatePhase('growEnd', value)}
              />
              <Slider
                label="Reveal start"
                value={settings.geodePhaseTiming.revealStart}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updatePhase('revealStart', value)}
              />
              <Slider
                label="Reveal end"
                value={settings.geodePhaseTiming.revealEnd}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updatePhase('revealEnd', value)}
              />
              {/* The one beat that runs AFTER the mark is whole: crystal taking the finished
                  surface. Charge now lands in the same window, so these two decide the completion. */}
              <Slider
                label="Spread start"
                value={settings.geodePhaseTiming.spreadStart}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updatePhase('spreadStart', value)}
              />
              <Slider
                label="Spread end"
                value={settings.geodePhaseTiming.spreadEnd}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updatePhase('spreadEnd', value)}
              />
              <p className="text-[0.6rem] leading-relaxed text-muted">
                Vein flare is inert as configured — it multiplies the material&apos;s emissive map and
                the crust spec is <span className="text-fg">stone</span>, which has none. Switch the
                crust to <span className="text-fg">meteor</span> before tuning these three.
              </p>
              <Slider
                label="Vein flare"
                value={settings.geodePhaseTiming.veinFlare}
                min={0}
                max={5}
                step={0.05}
                onChange={(value) => updatePhase('veinFlare', value)}
              />
              <Slider
                label="Flare at"
                value={settings.geodePhaseTiming.veinPeak}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updatePhase('veinPeak', value)}
              />
              <Slider
                label="Flare width"
                value={settings.geodePhaseTiming.veinWidth}
                min={0.01}
                max={0.6}
                step={0.01}
                onChange={(value) => updatePhase('veinWidth', value)}
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">
                Tessellation
              </span>
              <p className="text-[0.6rem] leading-relaxed text-muted">
                Edge length is a fraction of the mark, so every mark gets the same density whatever
                scale its source arrived at. Each subdivision quadruples the triangle count.
              </p>
              <Slider
                label="Edge fraction"
                value={settings.capEdgeFraction}
                min={0.004}
                max={0.06}
                step={0.001}
                onChange={(value) => update('capEdgeFraction', value)}
              />
              <Slider
                label="Subdivisions"
                value={settings.capSubdivisions}
                min={0}
                max={4}
                step={1}
                decimals={0}
                onChange={(value) => update('capSubdivisions', value)}
              />
              <Slider
                label="Depth rings"
                value={settings.depthRings}
                min={1}
                max={16}
                step={1}
                decimals={0}
                onChange={(value) => update('depthRings', value)}
              />
              <Slider
                label="Hole seed"
                value={settings.holeSeedFraction}
                min={0.005}
                max={0.2}
                step={0.005}
                onChange={(value) => update('holeSeedFraction', value)}
              />
              <p className="text-[0.6rem] leading-relaxed text-muted">
                A hole is a real tunnel at progress 0, just an ε-thin one — that is what lets the mark
                keep its topology through the whole morph. Too small and its normals go bad; too large
                and you can see the pinprick before it opens.
              </p>
            </div>
          </>
        )}

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
                label="Form duration (s)"
                value={settings.formationSeconds}
                min={0}
                max={15}
                step={0.1}
                onChange={(value) => update('formationSeconds', value)}
              />
              <Slider
                label="Travel duration (s)"
                value={settings.shapeBlendSeconds}
                min={0}
                max={15}
                step={0.1}
                onChange={(value) => update('shapeBlendSeconds', value)}
              />
              <Slider
                label="Order (random → sequential)"
                value={settings.formationOrder}
                min={0}
                max={1}
                step={0.05}
                onChange={(value) => update('formationOrder', value)}
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
                Base sits in place from frame one, first formation only. Order at 1 makes the outline
                draw itself around the contour instead of arriving at random. Travel is the same rocks
                moving between marks.
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

        <div className={`flex flex-col gap-2 ${isSolid ? '' : 'opacity-40'}`}>
          <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">
            Material {!isSolid && '· solid only'}
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
          label={isSolid ? 'Depth' : 'Slab depth'}
          value={settings.depth}
          min={0.05}
          max={1}
          step={0.01}
          onChange={(value) => update('depth', value)}
        />

        {isSolid && (
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
