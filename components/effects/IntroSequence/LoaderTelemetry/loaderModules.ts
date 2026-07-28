import type { AssetSource } from '@/lib/assetLoadProgress';

// Copy and tuning for the loader's live readout. Presentational config only — the values themselves are
// derived from real load progress in useLoaderTelemetry.
//
// The language is the site's own, not a generic tech HUD: everything the entry needs is described as
// matter falling into a forming star, which is literally what the dust field on screen is doing. It also
// means the hero's Core OS panel reads as the payoff of this rather than an unrelated instrument.

/** What each row is fed by. `combined` is the weighted total; `shell` is the sun's own assembly. */
export type ModuleFeed = AssetSource | 'combined' | 'shell';

export interface LoaderModule {
  /** Row label. Rendered uppercase by CSS, so stored in natural case. */
  label: string;
  feed: ModuleFeed;
}

export const LOADER_MODULES: LoaderModule[] = [
  { label: 'Accretion', feed: 'combined' },
  { label: 'Fleet', feed: 'deck' },
  { label: 'Field', feed: 'works' },
  { label: 'Core Shell', feed: 'shell' },
];

/** The states a row moves through. A row shows exactly one at a time. */
export const MODULE_STATES = {
  dormant: 'Dormant',
  queued: 'Queued',
  streaming: 'Streaming',
  forming: 'Forming',
  online: 'Online',
} as const;

export type ModuleState = (typeof MODULE_STATES)[keyof typeof MODULE_STATES];

/**
 * Rough total download the entry pulls, in bytes — the fleet's vessels plus the field's basalt texture.
 *
 * Only used to turn a progress rate into a throughput readout, so it needs to be the right order of
 * magnitude, not exact. **Re-measure this if either scene's assets change size**, for the same reason
 * SOURCE_WEIGHTS in assetLoadProgress has to be re-weighed.
 */
export const TOTAL_PAYLOAD_BYTES = 12 * 1024 * 1024;

/** Throughput is differentiated progress, which is spiky; smooth it hard or the number is unreadable. */
export const THROUGHPUT_SMOOTHING_PER_SECOND = 2.2;
/** Below this the readout would flicker between tiny values while nothing is really moving. */
export const THROUGHPUT_IDLE_FLOOR_MBPS = 0.01;

/** How often the readouts repaint. Fast enough to feel live, slow enough to stay legible. */
export const READOUT_INTERVAL_MS = 90;

// ── Scramble ──
// A changed value shuffles through junk glyphs before settling, so every state change registers and the
// panel always has something moving in it.
export const SCRAMBLE_MS = 220;
export const SCRAMBLE_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\<>*';
