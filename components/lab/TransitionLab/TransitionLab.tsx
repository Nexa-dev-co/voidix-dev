'use client';

import { useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Pause, Play, RotateCcw } from 'lucide-react';
import LabNav from '@/components/lab/LabNav';
import { useDebounced } from '@/components/lab/useDebounced';
import { MARK_TRANSITION_FACTORIES } from '@/components/sections/WorksField/transitions/registry';
import {
  tuningDefaults,
  type TransitionTuning,
} from '@/components/sections/WorksField/transitions/markTransition';
import {
  markTransitionById,
  type MarkTransitionId,
} from '@/components/sections/WorksField/transitions/transitionCatalog';
import { useTransitionLab } from './hooks/useTransitionLab';

/**
 * The comparison rig: one candidate transition, driven by hand, with its numbers on screen.
 *
 * ── Why the numbers are as prominent as the picture ──────────────────────────────────────────────
 * All four candidates can be made to look good. They differ most on what you cannot see — frame cost,
 * build cost, bytes held, and how each behaves when it fails. A rig that only showed the render would
 * be decided by whichever candidate was tuned last. See `docs/mark-transition-comparison.md`.
 *
 * ── The scrub is the instrument ──────────────────────────────────────────────────────────────────
 * `setTransition` is contractually a pure function of `(from, to, progress)`, so dragging must be
 * indistinguishable from playing. That is the site's ONE CLOCK rule used as a test: a candidate that
 * only looks right when played at its intended speed is hiding a second clock, and it would not
 * survive being driven by scroll later.
 */

/**
 * Seconds for one full A→B.
 *
 * Opens well ABOVE the works field's own `MORPH_SECONDS` (1.0s), because a one-second default is far too
 * fast to judge choreography by — every stage blurs into one event and any staging you author is
 * invisible. Authored slow, then pulled back toward the shipping rate once the stages read.
 */
const DEFAULT_ROUND_TRIP_SECONDS = 6;
const MIN_ROUND_TRIP_SECONDS = 0.5;
const MAX_ROUND_TRIP_SECONDS = 12;

/**
 * Quiet time after the last move of a REBUILDING knob before the scene catches up. Long enough to cover
 * a drag; the live knobs are not debounced at all.
 */
const REBUILD_SETTLE_MS = 220;

/** A backdrop is an authoring aid; `Site` is the only one that counts. Same set as the letter lab. */
const BACKDROPS = [
  { id: 'site', label: 'Site', color: '#060606' },
  { id: 'slate', label: 'Slate', color: '#39404a' },
  { id: 'grey', label: 'Grey', color: '#6e737a' },
] as const;

interface TransitionLabProps {
  strategyId: MarkTransitionId;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[0.6rem] uppercase tracking-eyebrow text-muted">{label}</span>
      <span className="tabular-nums text-[0.7rem] text-fg">{value}</span>
    </div>
  );
}

export default function TransitionLab({ strategyId }: TransitionLabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const entry = markTransitionById(strategyId);

  const [fromIndex, setFromIndex] = useState(0);
  const [toIndex, setToIndex] = useState(1);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [roundTripSeconds, setRoundTripSeconds] = useState(DEFAULT_ROUND_TRIP_SECONDS);
  const [backdrop, setBackdrop] = useState<string>(BACKDROPS[0].id);

  const controls = useMemo(
    () => MARK_TRANSITION_FACTORIES[strategyId]?.tuningControls ?? [],
    [strategyId],
  );
  const [tuning, setTuning] = useState<TransitionTuning>(() => tuningDefaults(controls));

  // Rebuilding knobs wait for you to let go; live ones are pushed straight through. Split rather than
  // debouncing everything, because a 220 ms lag on the choreography would feel broken while a lag on a
  // re-pack is the only thing making the drag usable.
  const settledTuning = useDebounced(tuning, REBUILD_SETTLE_MS);
  const effectiveTuning = useMemo(() => {
    const merged: TransitionTuning = { ...settledTuning };
    controls.forEach((control) => {
      if (!control.rebuilds) merged[control.key] = tuning[control.key];
    });
    return merged;
  }, [controls, settledTuning, tuning]);

  const readout = useTransitionLab(canvasRef, strategyId, {
    fromIndex,
    toIndex,
    progress,
    isPlaying,
    roundTripSeconds,
    isSpinning,
    tuning: effectiveTuning,
  });

  const backdropColor =
    BACKDROPS.find((option) => option.id === backdrop)?.color ?? BACKDROPS[0].color;
  // While playing, the play head owns progress — so the slider follows it instead of fighting it.
  const shownProgress = isPlaying ? readout.playProgress : progress;
  const markCount = readout.markLabels.length;

  const swapDirection = () => {
    setFromIndex(toIndex);
    setToIndex(fromIndex);
  };

  return (
    <div
      className="relative h-[100dvh] w-full overflow-hidden transition-colors duration-300"
      style={{ background: backdropColor }}
    >
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" />

      <LabNav />

      {/* The strategy's own knobs, rendered from what it declares. Left side, mirroring the letter lab. */}
      {controls.length > 0 && (
        <div className="pointer-events-auto absolute bottom-0 left-0 top-0 flex w-full max-w-[15rem] flex-col gap-3 overflow-y-auto p-6">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/70 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-[0.6rem] uppercase tracking-eyebrow text-accent">Tuning</span>
              <button
                type="button"
                onClick={() => setTuning(tuningDefaults(controls))}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.55rem] uppercase tracking-eyebrow text-fg transition-colors hover:border-accent hover:text-accent"
              >
                <RotateCcw size={10} />
                Reset
              </button>
            </div>
            {controls.map((control) => {
              const value = tuning[control.key] ?? control.value;

              if (control.kind === 'choice' && control.options) {
                return (
                  <div key={control.key} className="flex flex-col gap-1">
                    <span className="text-[0.6rem] uppercase tracking-eyebrow text-muted">
                      {control.label}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {control.options.map((option, index) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() =>
                            setTuning((current) => ({ ...current, [control.key]: index }))
                          }
                          className={`rounded-full border px-2 py-0.5 text-[0.55rem] uppercase tracking-eyebrow transition-colors ${
                            Math.round(value) === index
                              ? 'border-accent bg-accent text-black'
                              : 'border-border text-muted hover:text-fg'
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              if (control.kind === 'toggle') {
                const isOn = value > 0.5;
                return (
                  <button
                    key={control.key}
                    type="button"
                    onClick={() =>
                      setTuning((current) => ({ ...current, [control.key]: isOn ? 0 : 1 }))
                    }
                    className={`rounded border px-2 py-1 text-left text-[0.6rem] uppercase tracking-eyebrow transition-colors ${
                      isOn
                        ? 'border-accent text-accent'
                        : 'border-border text-muted hover:text-fg'
                    }`}
                  >
                    {control.label}
                  </button>
                );
              }

              return (
                <label key={control.key} className="flex flex-col gap-1">
                  <span className="flex justify-between text-[0.6rem] uppercase tracking-eyebrow text-muted">
                    <span>{control.label}</span>
                    <span className="tabular-nums text-fg">
                      {value.toFixed(control.decimals ?? 2)}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={value}
                    onChange={(event) =>
                      setTuning((current) => ({
                        ...current,
                        [control.key]: Number(event.target.value),
                      }))
                    }
                    className="accent-accent"
                  />
                </label>
              );
            })}
            <p className="text-[0.55rem] leading-relaxed text-muted">
              Packing knobs re-pack every mark and wait for you to let go; the choreography ones are
              live.
            </p>
          </div>
        </div>
      )}

      {/* What this candidate claims, and the one question that settles it. Kept on screen so the rig
          cannot quietly turn into a showreel. */}
      {/* Offset clear of the tuning column when there is one, so the claim and the knobs don't stack. */}
      <header
        className={`pointer-events-none absolute top-0 max-w-lg p-6 ${
          controls.length > 0 ? 'left-0 md:left-[15rem]' : 'left-0'
        }`}
      >
        <p className="font-display text-lg text-fg">{entry?.label ?? strategyId}</p>
        <p className="mt-1 text-[0.65rem] leading-relaxed text-muted">{entry?.identity}</p>
        <p className="mt-3 text-[0.65rem] leading-relaxed text-accent/80">
          {entry?.decidingQuestion}
        </p>
        {!readout.isBuilt && (
          <p className="mt-4 text-[0.7rem] leading-relaxed text-fg">
            Not built yet — no strategy is registered for this id.
          </p>
        )}
        {readout.error && (
          <p className="mt-4 text-[0.7rem] leading-relaxed text-fg">{readout.error}</p>
        )}
      </header>

      {/* Instruments. Bottom-right, out of the way of the controls. */}
      <div className="pointer-events-none absolute bottom-0 right-0 w-full max-w-[15rem] p-6">
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/70 p-4 backdrop-blur">
          <span className="mb-1 text-[0.6rem] uppercase tracking-eyebrow text-accent">
            Measured
          </span>
          <Metric
            label="Frame · rest"
            value={`${readout.timing.restMedian.toFixed(1)} / ${readout.timing.rest95th.toFixed(1)} ms`}
          />
          <Metric
            label="Frame · moving"
            value={`${readout.timing.transitionMedian.toFixed(1)} / ${readout.timing.transition95th.toFixed(1)} ms`}
          />
          <p className="mb-1 text-[0.55rem] leading-relaxed text-muted">median / 95th</p>
          <Metric label="Draw calls" value={String(readout.totals.drawCalls)} />
          <Metric label="Triangles" value={readout.totals.triangles.toLocaleString()} />
          <Metric label="Programs" value={String(readout.totals.programs)} />
          {readout.metrics && (
            <>
              <span className="mt-2 text-[0.6rem] uppercase tracking-eyebrow text-accent">
                Reported
              </span>
              <Metric
                label="Build"
                value={`${readout.metrics.buildMilliseconds.toFixed(1)} ms`}
              />
              <Metric
                label="Held"
                value={`${(readout.metrics.bufferBytes / 1024).toFixed(0)} KB`}
              />
              <Metric
                label="Per mark"
                value={`${(readout.metrics.perMarkBytes / 1024).toFixed(0)} KB`}
              />
            </>
          )}
        </div>
      </div>

      {/* Controls. Centre-bottom, where the eye already is. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-6">
        <div className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card/70 p-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <select
              value={fromIndex}
              onChange={(event) => setFromIndex(Number(event.target.value))}
              className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-[0.7rem] text-fg"
              aria-label="Transition from"
            >
              {readout.markLabels.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={swapDirection}
              aria-label="Swap direction"
              className="rounded border border-border p-1.5 text-fg transition-colors hover:border-accent hover:text-accent"
            >
              <ArrowLeftRight size={13} />
            </button>

            <select
              value={toIndex}
              onChange={(event) => setToIndex(Number(event.target.value))}
              className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-[0.7rem] text-fg"
              aria-label="Transition to"
            >
              {readout.markLabels.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex flex-col gap-1">
            <span className="flex justify-between text-[0.6rem] uppercase tracking-eyebrow text-muted">
              <span>Progress</span>
              <span className="tabular-nums text-fg">{shownProgress.toFixed(3)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={shownProgress}
              onChange={(event) => setProgress(Number(event.target.value))}
              className="accent-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="flex justify-between text-[0.6rem] uppercase tracking-eyebrow text-muted">
              <span>Round trip</span>
              <span className="tabular-nums text-fg">{roundTripSeconds.toFixed(1)}s</span>
            </span>
            <input
              type="range"
              min={MIN_ROUND_TRIP_SECONDS}
              max={MAX_ROUND_TRIP_SECONDS}
              step={0.1}
              value={roundTripSeconds}
              onChange={(event) => setRoundTripSeconds(Number(event.target.value))}
              className="accent-accent"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying((playing) => !playing)}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.6rem] uppercase tracking-eyebrow text-fg transition-colors hover:border-accent hover:text-accent"
            >
              {isPlaying ? <Pause size={11} /> : <Play size={11} />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>

            <button
              type="button"
              onClick={() => setIsSpinning((spinning) => !spinning)}
              className={`rounded border px-2 py-1 text-[0.6rem] uppercase tracking-eyebrow transition-colors ${
                isSpinning
                  ? 'border-accent text-accent'
                  : 'border-border text-muted hover:text-fg'
              }`}
            >
              Idle spin
            </button>

            <div className="ml-auto flex gap-1 rounded-full border border-border p-1">
              {BACKDROPS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setBackdrop(option.id)}
                  className={`rounded-full px-2 py-0.5 text-[0.55rem] uppercase tracking-eyebrow transition-colors ${
                    backdrop === option.id ? 'bg-accent text-black' : 'text-muted hover:text-fg'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-[0.55rem] leading-relaxed text-muted">
            {markCount > 0
              ? 'Drag the canvas to inspect. Idle spin is off by default — a rotating subject makes two tunings impossible to compare.'
              : 'Loading marks…'}
          </p>
        </div>
      </div>
    </div>
  );
}
