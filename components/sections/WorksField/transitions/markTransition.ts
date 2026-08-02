import * as THREE from 'three';

/**
 * The contract the mark→mark transition implements.
 *
 * ── What this is ────────────────────────────────────────────────────────────────────────────────
 * The works field shows four projects, and on each step one mark has to become the next. It cannot do
 * that by morphing: `attachMorphTarget` bails when two geometries disagree on vertex count, which two
 * extruded marks always do. So the change is owned by a strategy that holds every mark at once and
 * interpolates between two of them — see `accretionTransition.ts`, the one that shipped.
 *
 * ── The rules it enforces ───────────────────────────────────────────────────────────────────────
 * 1 · `setTransition` is a PURE FUNCTION of (from, to, progress). No internal timers, no "arrived"
 *     flags, no tweens. Scrubbing has to be indistinguishable from playing — which is the site's ONE
 *     CLOCK rule (`CLAUDE.md`). A transition that cannot be scrubbed backwards cannot live in the pin.
 * 2 · Marks are built to one `targetSize` and one world-unit `depth`, so the section's framing holds
 *     whichever mark is on screen.
 * 3 · A strategy reports only what the renderer cannot know — how long it took to build and how many
 *     bytes it holds. Everything observable from outside is read from `renderer.info` instead.
 *
 * It stayed an interface after the comparison rig that justified it was deleted, because the boundary
 * is still worth having: `useWorksField` is 2,000 lines of camera, layout and scroll, and this keeps
 * the geometry on the other side of a wall from all of it.
 */

/**
 * A mark's outlines, resolved and ready to build from.
 *
 * Handed over as shapes rather than as a URL or a glyph because fetching and font loading belong to
 * the section (`prepareMarks.ts`) — and because every mark has to be parsed identically. Parsing per
 * mark would be one `curveSegments` change away from four marks cut to different fidelities.
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
  /** Lets a strategy pick a step count or an instance budget without measuring the device itself. */
  performanceTier: 'low' | 'high';
}

/**
 * What a strategy knows about itself that the renderer cannot see.
 *
 * Deliberately small. Everything observable from outside — triangles, calls, programs, frame time —
 * is on `renderer.info` already, and duplicating it here would be a second number to keep honest.
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

export interface MarkTransitionStrategy {
  /** Added to the section's rig. A strategy never touches the camera, the lights or the composer. */
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
  dispose(): void;
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
