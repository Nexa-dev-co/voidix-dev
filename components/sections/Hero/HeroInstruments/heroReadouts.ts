// Single source of truth for the hero's instrument HUD: the left Core OS panel, the right
// Environment Telemetry panel, and the tuning constants for the live readouts. Copy lives here so
// the panels stay presentational and the numbers are easy to retune. Labels render uppercased via
// CSS, so store them in natural case.

// Left panel — the Orbix Core operating system. Five modules, top to bottom. `value` is the
// resting state the markup renders; `live` marks the two readouts useCoreTelemetry drives with
// real telemetry after the reveal (omit = static text for the whole hero).
export interface CoreModule {
  label: string;
  value: string;
  /** Which telemetry stream drives the value after reveal (omit = static text). */
  live?: 'stability' | 'energy';
  /** Orb-blue status treatment — the breathing ONLINE light. */
  accent?: boolean;
}

// ── Core Stability — real FPS mapped into a health percentage ────────────────
export const STABILITY_FLOOR = 96; // the brief clamps stability to 96–100
export const STABILITY_CEILING = 99.98; // a running system never claims a perfect 100
export const STABILITY_FPS_LOW = 24; // at/below this fps the readout rests on the floor
export const STABILITY_FPS_HIGH = 58; // at/above this fps the readout rests on the ceiling
export const STABILITY_SETTLE_START = 97.5; // pre-first-sample value — the reveal reads as a calibration settle
export const STABILITY_SMOOTHING_RATE = 1.6; // 1/s exponential glide toward the target — never jumps
export const FPS_WINDOW_MS = 1000; // brief: sample fps every second
export const FPS_WINDOW_DISCARD_MS = 2000; // a longer window means the tab was hidden; skip that sample

// ── Energy Output — cursor velocity injected into the core ───────────────────
export const ENERGY_IDLE = 0; // resting output (%) — with no cursor movement the core reads 0
export const ENERGY_PEAK = 100;
export const ENERGY_FULL_VELOCITY = 1.4; // viewport diagonals/second that read as full output
export const ENERGY_RESPONSE_CURVE = 0.6; // <1 lifts gentle movement so slow sweeps still register
export const ENERGY_ATTACK_RATE = 5; // 1/s glide when output rises (fast attack…)
export const ENERGY_DECAY_RATE = 0.55; // 1/s glide when it falls (…slow decay back to idle)

export const CORE_MODULES: CoreModule[] = [
  { label: 'Core Status', value: 'Online', accent: true },
  { label: 'Mission', value: 'Building Worlds' },
  { label: 'Active Module', value: 'Hero' },
  { label: 'Core Stability', value: `${STABILITY_CEILING.toFixed(2)}%`, live: 'stability' },
  { label: 'Energy Output', value: `${ENERGY_IDLE}%`, live: 'energy' },
];

export const SCROLL_CUE = { top: 'Scroll to', bottom: 'Explore' } as const;

// ── Right panel — the Environment Telemetry surrounding the Core ─────────────
// Five modules reading real state: the gravity field, the visitor's influence, the portal, the
// cursor's field distortion, and the orb's rotational vector. `metric` names the telemetry stream
// useEnvironmentTelemetry drives after the reveal; `value` is the resting text the markup renders.
export type EnvironmentMetric = 'gravity' | 'influence' | 'portal' | 'distortion' | 'vector';

export interface EnvironmentModule {
  label: string;
  value: string;
  metric: EnvironmentMetric;
}

export const ENVIRONMENT_MODULES: EnvironmentModule[] = [
  { label: 'Gravity Field', value: 'Active', metric: 'gravity' },
  { label: 'Cursor Influence', value: '0%', metric: 'influence' },
  { label: 'Portal Status', value: 'Standby', metric: 'portal' },
  { label: 'Field Distortion', value: '0.08', metric: 'distortion' },
  { label: 'Orbital Vector', value: '000°', metric: 'vector' },
];

// ── 01 Gravity Field — cursor proximity + press escalate the field state ─────
// The three states the field escalates through as the visitor approaches / touches the orb.
export const GRAVITY_STATES = {
  active: 'Active',
  intensifying: 'Intensifying',
  maximum: 'Maximum',
} as const;
// Proximity (0 far → 1 over the orb) thresholds, with hysteresis so the word never flickers at an
// edge: rise at the higher number, fall back only past the lower one.
export const GRAVITY_INTENSIFY_ENTER = 0.55;
export const GRAVITY_INTENSIFY_EXIT = 0.45;

// ── 02 Cursor Influence — distance-to-orb weighted, spiked by velocity ───────
export const INFLUENCE_MAX_DISTANCE_VMIN = 0.75; // distance (in viewport min-dimensions) at which influence reaches 0
export const INFLUENCE_BASE_WEIGHT = 0.82; // how much raw proximity contributes…
export const INFLUENCE_VELOCITY_WEIGHT = 0.55; // …and how much a fast cursor near the orb spikes it
export const INFLUENCE_SMOOTHING_RATE = 6; // 1/s exponential glide toward the target

// ── 03 Portal Status — dwell over the orb region arms the portal ─────────────
export const PORTAL_STATES = { standby: 'Standby', ready: 'Ready' } as const;
export const PORTAL_ARM_PROXIMITY = 0.4; // being at least this close counts as dwelling on the portal
export const PORTAL_READY_MS = 550; // dwell this long near/over the orb → READY
export const PORTAL_RESET_MS = 700; // stay away this long → back to STANDBY

// ── 04 Field Distortion — the fluid cursor sim's own speed ratio ─────────────
export const DISTORTION_IDLE = 0.08; // resting distortion the readout eases back to
export const DISTORTION_MAX = 0.85; // full-speed distortion
export const DISTORTION_ATTACK_RATE = 7; // 1/s glide when distortion rises (fast attack…)
export const DISTORTION_DECAY_RATE = 1.4; // 1/s glide when it falls (…gentler settle to idle)

// ── 05 Orbital Vector — mirrors the orb's hero spin so the HUD reads as synced ─
// The orb spins on Y at ROTATION_SPEED rad/frame in SunCanvas (no services speed-up in the hero).
// We can't read the orb (it must stay untouched), so we advance our own angle at the same rate:
// rad/frame × frames/sec × deg/rad = degrees per second. Keep these in step with SunCanvas.
export const ORB_ROTATION_SPEED_RAD_PER_FRAME = 0.0018; // mirrors SunCanvas ROTATION_SPEED
export const ORB_ASSUMED_FPS = 60;
export const VECTOR_DEG_PER_SECOND =
  ORB_ROTATION_SPEED_RAD_PER_FRAME * ORB_ASSUMED_FPS * (180 / Math.PI);

// Shared frame-timing guards for the telemetry loop.
export const TELEMETRY_MIN_FRAME_SECONDS = 1 / 240; // guard the velocity division against a zero-length frame
export const TELEMETRY_MAX_FRAME_SECONDS = 0.1; // clamp the dt spike right after a hidden tab resumes
