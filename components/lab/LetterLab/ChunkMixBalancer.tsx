'use client';

import type { ChunkMaterialSpec } from '@/components/sections/WorksField/markChunkMaterial';

/**
 * The mix, as one balanced set of percentages.
 *
 * ── Why the sliders are coupled ──────────────────────────────────────────────────────────────────
 * Weights are relative — the aggregate normalises them — so raw numbers are almost impossible to
 * author with. Move one from 10 to 20 and every other kind's actual share silently drops, by an amount
 * you have to work out yourself. What you want to say is "a third of this mark is pale stone", and that
 * only works if the numbers ARE percentages.
 *
 * So moving one slider redistributes the remainder across the others, in proportion to what they
 * already were. Their ratios to each other survive; only their share of the whole changes. The total is
 * pinned at 100, so the number next to each kind is the truth about the mark rather than an input to
 * arithmetic you have to do in your head.
 *
 * ── Per zone, because the zones are independent ──────────────────────────────────────────────────
 * The outline and the interior are drawn from separately-normalised pools (see MarkChunkMaterial), so
 * they each get their own 100%. Editing them in one merged list would imply a relationship between the
 * two that doesn't exist.
 */

export type MixZone = 'edge' | 'interior';

const TOTAL_PERCENT = 100;

interface ChunkMixBalancerProps {
  specs: ChunkMaterialSpec[];
  zone: MixZone;
  onZoneChange: (zone: MixZone) => void;
  /** Hands back the full weight list for the active zone, already summing to 100. */
  onWeightsChange: (weights: number[]) => void;
}

const weightKey = (zone: MixZone) =>
  zone === 'edge' ? ('edgeWeight' as const) : ('interiorWeight' as const);

/**
 * Set one entry and absorb the difference into the others, proportionally.
 *
 * When the others are all at zero there is no ratio to preserve, so the remainder is split evenly —
 * otherwise the slider would be stuck, unable to give anything back.
 */
function rebalance(weights: number[], index: number, nextValue: number): number[] {
  const clamped = Math.min(TOTAL_PERCENT, Math.max(0, nextValue));
  const remainder = TOTAL_PERCENT - clamped;
  const othersTotal = weights.reduce(
    (sum, weight, weightIndex) => (weightIndex === index ? sum : sum + weight),
    0,
  );

  return weights.map((weight, weightIndex) => {
    if (weightIndex === index) return clamped;
    if (othersTotal <= 0) return remainder / Math.max(1, weights.length - 1);
    return (weight / othersTotal) * remainder;
  });
}

export default function ChunkMixBalancer({
  specs,
  zone,
  onZoneChange,
  onWeightsChange,
}: ChunkMixBalancerProps) {
  const key = weightKey(zone);
  const weights = specs.map((spec) => spec[key]);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[0.65rem] uppercase tracking-eyebrow text-muted">Mix</span>
        <span className="text-[0.6rem] tabular-nums text-accent">{Math.round(total)}%</span>
      </div>

      <div className="flex gap-1 rounded-full border border-border p-1">
        {(['edge', 'interior'] as MixZone[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onZoneChange(option)}
            className={`flex-1 rounded-full px-2 py-1 text-[0.6rem] uppercase tracking-eyebrow transition-colors ${
              zone === option ? 'bg-accent text-black' : 'text-muted hover:text-fg'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <p className="text-[0.6rem] leading-relaxed text-muted">
        {zone === 'edge'
          ? 'The outline — what draws the silhouette against the background.'
          : 'The mass behind it — reads as volume, shouldn’t compete with the edge.'}
      </p>

      <div className="flex flex-col gap-3">
        {specs.map((spec, index) => (
          <label key={spec.id} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-[0.6rem] uppercase tracking-eyebrow text-muted">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border"
                style={{ background: spec.tint }}
                aria-hidden="true"
              />
              <span className="flex-1 truncate normal-case tracking-normal">{spec.label}</span>
              <span className="tabular-nums text-fg">{Math.round(weights[index])}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={TOTAL_PERCENT}
              step={1}
              value={weights[index]}
              onChange={(event) =>
                onWeightsChange(rebalance(weights, index, Number(event.target.value)))
              }
              className="accent-accent"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
