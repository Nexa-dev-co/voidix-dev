import * as THREE from 'three';
import type { MarkTransitionId } from './transitionCatalog';

/**
 * The contract every mark→mark transition implements, so four of them can be compared honestly.
 *
 * ── What is being compared ───────────────────────────────────────────────────────────────────────
 * The works field shows four projects, and on each step one mark has to become the next. Today it
 * cannot: `attachMorphTarget` bails when two geometries disagree on vertex count, which two extruded
 * marks always do, so `useWorksField` falls back to a hard cut hidden behind the spin. Four candidate
 * replacements exist and they differ by what carries the mark's identity across the change —
 * connectivity, pieces, a field, or a seed. See `docs/mark-transition-comparison.md`.
 *
 * ── Why a contract rather than four hooks ────────────────────────────────────────────────────────
 * Because the comparison is the deliverable. If each candidate brings its own camera, its own
 * framing, its own lighting and its own idea of how big a mark is, then what gets compared is four
 * different scenes and the answer is whichever one was tuned last. One harness owns the scene; a
 * strategy owns nothing but geometry, its material, and how it interpolates.
 *
 * ── The rules the contract enforces ──────────────────────────────────────────────────────────────
 * 1 · `setTransition` is a PURE FUNCTION of (from, to, progress). No internal timers, no "arrived"
 *     flags, no tweens. Scrubbing has to be indistinguishable from playing — which is the site's ONE
 *     CLOCK rule (`CLAUDE.md`) turned into a test instrument. A transition that cannot be scrubbed
 *     backwards cannot be trusted inside the pin later.
 * 2 · Every strategy is built with the SAME `targetSize` and the same world-unit `depth`, so no
 *     candidate wins by being framed more generously.
 * 3 · A strategy reports only what the renderer cannot know — how long it took to build and how many
 *     bytes it holds. Triangles, draw calls and programs are read from `renderer.info` by the harness,
 *     because a strategy asked to grade its own vertex count will grade it kindly.
 */

// Owned by the catalogue, which carries no three.js and can therefore be read by a Server Component.
// Re-exported so a strategy only ever needs this one module.
export type { MarkTransitionId };

/**
 * A mark's outlines, resolved and ready to build from.
 *
 * Handed over as shapes rather than as a URL or a glyph because fetching and font loading are the
 * harness's job — and because every strategy needs the SAME outlines. Two strategies that each parsed
 * the SVG themselves would be one `curveSegments` change away from comparing different shapes.
 */
export interface PreparedMark {
  id: string;
  label: string;
  /** Outer contours counter-clockwise, holes clockwise, in the source's own units. */
  shapes: THREE.Shape[];
  /**
   * True when the source is an SVG, whose Y axis points down.
   *
   * Left as a flag rather than pre-flipped because the two families of builder want it applied at
   * different moments: an extrusion fixes it on the finished geometry with a rotation (a mirror would
   * invert every winding — see `markBody.ts`), while anything that generates its own faces negates Y
   * on the outline and emits correct windings from the start.
   */
  flipY: boolean;
}

export interface MarkTransitionBuildOptions {
  /** Largest dimension of every finished mark, in world units. Identical for all marks and all strategies. */
  targetSize: number;
  /**
   * Slab thickness, in WORLD units — never in the source's units.
   *
   * Stated because it is the trap: an SVG arrives with a 95-unit viewBox and a glyph at size 100, so a
   * depth carried through the source-to-world scale gives the same slider two different thicknesses.
   * `markGeodeBody` gets this right and is the reference.
   */
  depth: number;
  /** The shared rock surface. One texture for everyone, so nobody wins on albedo. */
  surfaceTexture: THREE.Texture | null;
  /** Lets a strategy pick a step count or an instance budget without measuring the device itself. */
  performanceTier: 'low' | 'high';
}

/**
 * What a strategy knows about itself that the renderer cannot see.
 *
 * Deliberately small. Everything observable from outside — triangles, calls, programs, frame time — is
 * measured by the harness instead, so these numbers cannot be used to flatter a candidate.
 */
export interface TransitionBuildMetrics {
  /** Wall-clock milliseconds spent preparing every mark. ②'s deciding number. */
  buildMilliseconds: number;
  /** Bytes of GPU buffer held right now. */
  bufferBytes: number;
  /**
   * Bytes added per additional mark, so 4 → 6 can be projected rather than guessed — the brief names
   * six services and the deck currently ships four.
   */
  perMarkBytes: number;
}

/**
 * One authored knob, declared by a factory so the harness can render a slider for it.
 *
 * Declared rather than owned because the values have to live in React (they are UI state) while the
 * meaning lives with the strategy. A candidate that shipped with no knobs could not be authored at all
 * — and the whole reason each of these exists is that the numbers are not guessable.
 */
export interface TuningControl {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Digits in the read-out. 0 for counts and layer numbers. */
  decimals?: number;
  /**
   * A slider unless stated. `toggle` renders as an on/off button and stores 0 or 1 — some knobs are
   * genuinely binary ("is this the first formation?") and dragging a slider between two values is a
   * worse control than a button.
   */
  kind?: 'slider' | 'toggle';
  /**
   * True when changing it re-does work heavy enough to stutter a drag — a re-pack, a re-carve, a
   * reallocation. The harness debounces these and pushes everything else live, so a look knob stays
   * glued to the cursor while a geometry knob waits for you to let go.
   */
  rebuilds: boolean;
}

/** Current values by key. Flat numbers on purpose: a schema the harness can render without knowing anything. */
export type TransitionTuning = Record<string, number>;

/** Starting values, straight off a factory's declared controls. */
export function tuningDefaults(controls: TuningControl[] | undefined): TransitionTuning {
  const values: TransitionTuning = {};
  controls?.forEach((control) => {
    values[control.key] = control.value;
  });
  return values;
}

export interface MarkTransitionStrategy {
  readonly id: MarkTransitionId;
  /** Added to the harness's spin rig. A strategy never touches the camera, the lights or the composer. */
  readonly object: THREE.Object3D;
  readonly metrics: TransitionBuildMetrics;
  /**
   * Show the transition from one mark to another, at `progress` 0..1.
   *
   * MUST be pure: the same arguments always produce the same frame, and progress may jump, reverse or
   * be scrubbed at any rate. `from === to` is legal and means "sit still on this mark".
   */
  setTransition(fromIndex: number, toIndex: number, progress: number): void;
  /**
   * Idle motion only — tumble, breathing, drift. Anything that belongs to the TRANSITION goes in
   * `setTransition`, or it becomes a second clock and stops being scrubbable.
   */
  update(elapsedSeconds: number): void;
  /**
   * Take new values for the factory's declared controls.
   *
   * A strategy decides internally what a given change costs — the harness has no business knowing
   * which knob re-packs a mark and which is a uniform. Absent when a candidate has nothing to author.
   */
  applyTuning?(tuning: TransitionTuning): void;
  dispose(): void;
}

/**
 * How the lab discovers and builds a candidate.
 *
 * `identity` is shown in the panel next to the tab, because the comparison stays honest only while it
 * is obvious that these four are answers to one question rather than four unrelated effects.
 */
export interface MarkTransitionFactory {
  id: MarkTransitionId;
  label: string;
  /** One line: what carries the mark's identity across the change. */
  identity: string;
  /** Knobs the harness should offer. Omitted when there is nothing to author. */
  tuningControls?: TuningControl[];
  create(
    marks: PreparedMark[],
    options: MarkTransitionBuildOptions,
    tuning: TransitionTuning,
  ): Promise<MarkTransitionStrategy>;
}

/** Clamp to the closed unit interval. Progress arrives from a slider, a tween or a scroll and none of them promise a range. */
export function clampProgress(progress: number): number {
  return progress < 0 ? 0 : progress > 1 ? 1 : progress;
}

/** Bytes a geometry's attributes occupy, for `bufferBytes`. Indices included — they are uploaded too. */
export function measureGeometryBytes(geometry: THREE.BufferGeometry): number {
  let total = 0;
  Object.values(geometry.attributes).forEach((attribute) => {
    const typed = attribute as THREE.BufferAttribute;
    const array = typed.array as ArrayLike<number> & { byteLength?: number };
    total += array.byteLength ?? typed.count * typed.itemSize * 4;
  });
  const index = geometry.getIndex();
  if (index) {
    const array = index.array as ArrayLike<number> & { byteLength?: number };
    total += array.byteLength ?? index.count * 4;
  }
  return total;
}
