import { formatTuningSource } from '@/lib/tunerExport';
import type { ChunkMaterialSpec } from '@/components/sections/WorksField/markChunkMaterial';
import type { GeodeMorphDefaults } from '@/components/sections/WorksField/markGeodeMorph';
import type { GeodePhaseTiming } from '@/components/sections/WorksField/markGeodePhases';

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
  shapeBlendSeconds: number;
  formationBaseFraction: number;
  formationStagger: number;
  formationEdgeDelay: number;
  formationOrder: number;
  freeRadius: number;
  freeDriftAmplitude: number;
}

/**
 * Everything the geode's GEOMETRY is carved from.
 *
 * Typed here rather than imported because these values have no module of their own yet — they live in
 * the lab's `DEFAULT_GEODE`, which is where a copied block gets pasted back. When the geode ships to
 * the works field this interface is what moves, and the export follows it.
 */
export interface GeodeBuildPreset {
  rockOffsetX: number;
  rockOffsetY: number;
  rockOffsetZ: number;
  rockRadius: number;
  rockStretchX: number;
  rockStretchY: number;
  rockStretchZ: number;
  rockSeed: number;
  rockCarveAmplitude: number;
  cling: number;
  crustThickness: number;
  markCarveAmplitude: number;
  markCarveFrequency: number;
  markCarveInPlaneDamping: number;
  silhouetteHold: number;
  crystalPatchScale: number;
  crystalFacetScale: number;
  crystalFacetAmplitude: number;
  capEdgeFraction: number;
  capSubdivisions: number;
  depthRings: number;
  holeSeedFraction: number;
}

/**
 * A geode session, split by where each half belongs in the source.
 *
 * `morph` and `phases` are typed against the real module interfaces on purpose: add a field to either
 * and this stops compiling until the export learns about it, which is the only reliable defence
 * against an exporter that quietly drops the knob you spent an hour on.
 */
export interface GeodePreset {
  build: GeodeBuildPreset;
  morph: GeodeMorphDefaults;
  phases: GeodePhaseTiming;
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
  geode: GeodePreset,
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
    // The geode goes first: it is the body being authored, and the three blocks below it belong to
    // the swarm it is meant to replace.
    sectionHeader('Geode build — paste into LetterLab.tsx DEFAULT_GEODE'),
    '// Baked into the vertex buffers — every one of these re-carves the body.',
    'const DEFAULT_GEODE_BUILD = {',
    formatTuningSource(geode.build),
    '};',
    '',
    sectionHeader('Geode look — paste into components/sections/WorksField/markGeodeMorph.ts'),
    '// Pushed onto uniforms every frame; nothing here rebuilds geometry.',
    'export const DEFAULT_GEODE_MORPH: GeodeMorphDefaults = {',
    formatTuningSource(geode.morph),
    '};',
    '',
    sectionHeader('Geode choreography — paste into components/sections/WorksField/markGeodePhases.ts'),
    'export const DEFAULT_GEODE_PHASE_TIMING: GeodePhaseTiming = {',
    formatTuningSource(geode.phases),
    '};',
    '',
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
