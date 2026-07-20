import { formatTuningSource } from '@/lib/tunerExport';
import type { ChunkMaterialSpec } from '@/components/sections/WorksField/markChunkMaterial';

/**
 * Turn a lab session into source you can paste.
 *
 * Same job as `lib/tunerExport`'s dock button, and it borrows that module's formatter so the numbers
 * round the same way — but the lab isn't a `?tune` panel on a live scene, so it doesn't join that
 * registry. It prints one self-contained block instead: the chunk mix and the layout, named and typed
 * exactly as `markChunkMaterial.ts` and the works field expect them.
 *
 * The point is that nothing has to be transcribed by hand. What you approved in the lab is what lands
 * in the file.
 */

export interface MarkLayoutPreset {
  edgeChunkCount: number;
  edgeChunkScale: number;
  interiorChunkScale: number;
  interiorChunkCount: number;
  depth: number;
}

/** The assembly timing, exported alongside the layout — it's as much part of the look as the mix is. */
export interface MarkFormationPreset {
  formationSeconds: number;
  formationBaseFraction: number;
  formationStagger: number;
  formationEdgeDelay: number;
  freeRadius: number;
  freeDriftAmplitude: number;
}

const HEADER_WIDTH = 78;

function sectionHeader(label: string): string {
  return `// ── ${label} ${'─'.repeat(Math.max(2, HEADER_WIDTH - label.length))}`;
}

/** One spec as a source object literal, keys in the order the interface declares them. */
function formatSpec(spec: ChunkMaterialSpec): string {
  const lines = [
    `    id: '${spec.id}',`,
    `    label: '${spec.label}',`,
    `    texturePath: '${spec.texturePath}',`,
    `    treatment: '${spec.treatment}',`,
    `    tint: '${spec.tint}',`,
    `    textureRepeat: ${Number(spec.textureRepeat.toFixed(4))},`,
    `    roughness: ${Number(spec.roughness.toFixed(4))},`,
    `    emissiveIntensity: ${Number(spec.emissiveIntensity.toFixed(4))},`,
    `    edgeWeight: ${Number(spec.edgeWeight.toFixed(4))},`,
    `    interiorWeight: ${Number(spec.interiorWeight.toFixed(4))},`,
  ];
  return ['  {', ...lines, '  },'].join('\n');
}

/**
 * Print the whole session.
 *
 * Both zones' shares are included as a trailing comment, because the weights are relative — a bare
 * `edgeWeight: 55` tells you nothing on its own, and the percentages are what you were actually
 * looking at when you decided you liked it.
 */
export function formatMarkPresetSource(
  chunkSpecs: ChunkMaterialSpec[],
  layout: MarkLayoutPreset,
  formation: MarkFormationPreset,
): string {
  const edgeTotal = chunkSpecs.reduce((sum, spec) => sum + spec.edgeWeight, 0);
  const interiorTotal = chunkSpecs.reduce((sum, spec) => sum + spec.interiorWeight, 0);
  const share = (weight: number, total: number) =>
    total > 0 ? `${((weight / total) * 100).toFixed(0)}%` : '—';

  const mixSummary = chunkSpecs
    .map(
      (spec) =>
        `//   ${spec.label.padEnd(22)} edge ${share(spec.edgeWeight, edgeTotal).padStart(4)}` +
        `   interior ${share(spec.interiorWeight, interiorTotal).padStart(4)}`,
    )
    .join('\n');

  return [
    sectionHeader('Mark chunk mix — paste into components/sections/WorksField/markChunkMaterial.ts'),
    '// Resulting shares:',
    mixSummary,
    'export const DEFAULT_CHUNK_SPECS: ChunkMaterialSpec[] = [',
    ...chunkSpecs.map(formatSpec),
    '];',
    '',
    sectionHeader('Mark layout — paste into the works field tuning'),
    'export const DEFAULT_MARK_LAYOUT = {',
    formatTuningSource(layout),
    '};',
    '',
    sectionHeader('Mark formation — how the mark gathers out of the dark'),
    'export const DEFAULT_MARK_FORMATION = {',
    formatTuningSource(formation),
    '};',
  ].join('\n');
}
