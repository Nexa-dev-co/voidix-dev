// Single source of truth for the hero's instrument HUD — the telemetry readouts flanking the
// headline. Copy lives here so the panel is presentational and the numbers are easy to retune.
// `live` marks a value the hook animates (a quiet drift, so the readout reads as a live system);
// omit it for static text. Labels render uppercased via CSS, so store them in natural case.

export interface Readout {
  label: string;
  value: string;
  /** Which live behaviour drives the value (omit = fixed text). */
  live?: 'energy' | 'field';
}

// Left column — the core status stack.
export const CORE_LABEL = 'Orbix Core';

export const LEFT_READOUTS: Readout[] = [
  { label: 'Status', value: 'Online' },
  { label: 'Gravity', value: 'Active' },
  { label: 'Energy', value: '97%', live: 'energy' },
  { label: 'Field Strength', value: '1.618', live: 'field' },
];

export const SCROLL_CUE = { top: 'Scroll to', bottom: 'Explore' } as const;

// Right column — orbital telemetry. Coordinates render as their own two-line block.
export const COORD_LINES = ['31° 14\' 08" N', '121° 29\' 47" E'] as const;

export const RIGHT_READOUTS: Readout[] = [{ label: 'Orbit', value: 'Stable' }];

// Live-drift bounds. The values only ever wander a hair, so it feels like a running instrument
// rather than a fidgeting number.
export const ENERGY_MIN = 96;
export const ENERGY_MAX = 98;
export const FIELD_BASE = 1.618;
export const FIELD_JITTER = 0.004; // ± on the last digits
export const LIVE_TICK_MS = 1400; // how often a live value re-samples
