import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { createMarkLabRig, MARK_LAB_TARGET_SIZE } from '@/components/lab/markLabRig';
import { letterToShapes, svgToShapes } from '@/components/sections/WorksField/markBody';
import { MARKS } from '@/components/sections/WorksField/marks';
import { MARK_TRANSITION_FACTORIES } from '@/components/sections/WorksField/transitions/registry';
import type {
  MarkTransitionStrategy,
  PreparedMark,
  TransitionBuildMetrics,
  TransitionTuning,
} from '@/components/sections/WorksField/transitions/markTransition';
import type { MarkTransitionId } from '@/components/sections/WorksField/transitions/transitionCatalog';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';

/**
 * The comparison rig's scene.
 *
 * ── One effect, because the strategy is a ROUTE ──────────────────────────────────────────────────
 * Each candidate lives at its own URL, so `strategyId` cannot change while this is mounted. That is
 * worth stating because it is why this hook has none of `useLetterLab`'s cross-effect rebuild refs: a
 * strategy change is a navigation, the component unmounts, and everything is rebuilt from scratch.
 * Sub-routes bought that simplicity.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────────────────────────
 * The camera, the lights, the probe and the bloom belong to `markLabRig`, shared with the letter lab,
 * so no candidate can win by being lit more kindly. And the strategies themselves own no scene state
 * at all — they hand back an `Object3D` and take `(from, to, progress)`.
 */

const FONT_PATH = '/fonts/helvetiker_bold.typeface.json';
/** The shared rock surface. One texture for every candidate, so nobody wins on albedo. */
const SURFACE_TEXTURE_PATH = '/textures/meteor/basalt-magma.png';

const MARK_DEPTH = 0.7;

const IDLE_SPIN_DEGREES_PER_SECOND = 18;
const DRAG_YAW_SENSITIVITY = 0.008;
const DRAG_PITCH_SENSITIVITY = 0.006;
const DRAG_PITCH_CLAMP = 0.9;
const MAX_FRAME_SECONDS = 0.05;

/** Frame samples kept per bucket. 240 at ~60fps is a four-second window — long enough for a p95 to mean something. */
const FRAME_SAMPLE_COUNT = 240;
/**
 * How often measurements reach React.
 *
 * Not per frame, and this matters: pushing a number into state 60 times a second re-renders the panel
 * 60 times a second, which shows up in the very frame time being measured. The instrument would be
 * reporting its own cost.
 */
const READOUT_INTERVAL_MS = 250;

/** Progress within this of an end counts as "at rest", so the two frame-time buckets stay meaningful. */
const AT_REST_EPSILON = 0.001;

export interface TransitionLabControls {
  fromIndex: number;
  toIndex: number;
  /** Ignored while playing — the play head owns progress then, exactly as the geode's scrub does. */
  progress: number;
  isPlaying: boolean;
  /** Seconds for one full A→B (and one full B→A). Defaults to the field's own `MORPH_SECONDS`. */
  roundTripSeconds: number;
  isSpinning: boolean;
  /**
   * The strategy's own knobs.
   *
   * Already split by the caller: the live values drive anything read per frame, and the settled ones
   * are what a rebuild is allowed to see. The strategy still decides what a change costs.
   */
  tuning: TransitionTuning;
}

export interface FrameTiming {
  restMedian: number;
  rest95th: number;
  transitionMedian: number;
  transition95th: number;
}

export interface RenderTotals {
  drawCalls: number;
  triangles: number;
  programs: number;
}

export interface TransitionLabReadout {
  markLabels: string[];
  isBuilt: boolean;
  isReady: boolean;
  error: string | null;
  metrics: TransitionBuildMetrics | null;
  timing: FrameTiming;
  totals: RenderTotals;
  /** Where the play head is, so the scrub can follow it rather than fighting it. */
  playProgress: number;
}

const EMPTY_TIMING: FrameTiming = {
  restMedian: 0,
  rest95th: 0,
  transitionMedian: 0,
  transition95th: 0,
};

/** Nearest-rank percentile over a copy, so the live ring buffer is never reordered. */
function percentile(samples: number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((first, second) => first - second);
  const rank = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[rank];
}

/** A fixed-size ring of frame durations. */
class FrameSamples {
  private readonly samples: number[] = [];
  private cursor = 0;

  add(milliseconds: number): void {
    if (this.samples.length < FRAME_SAMPLE_COUNT) {
      this.samples.push(milliseconds);
      return;
    }
    this.samples[this.cursor] = milliseconds;
    this.cursor = (this.cursor + 1) % FRAME_SAMPLE_COUNT;
  }

  clear(): void {
    this.samples.length = 0;
    this.cursor = 0;
  }

  median(): number {
    return percentile(this.samples, 0.5);
  }

  ninetyFifth(): number {
    return percentile(this.samples, 0.95);
  }
}

/** Resolve every registry mark to the outlines each strategy builds from. */
async function prepareMarks(): Promise<PreparedMark[]> {
  const needsFont = MARKS.some((mark) => mark.kind === 'letter');
  const font: Font | null = needsFont
    ? await new Promise<Font | null>((resolve) => {
        new FontLoader().load(
          FONT_PATH,
          resolve,
          undefined,
          () => resolve(null),
        );
      })
    : null;

  const prepared = await Promise.all(
    MARKS.map(async (mark): Promise<PreparedMark | null> => {
      try {
        if (mark.kind === 'svg') {
          const response = await fetch(mark.source);
          if (!response.ok) return null;
          // SVG's Y axis points down; the flag travels with the mark so each strategy can correct it
          // wherever suits its own construction. See `markTransition`'s note on `flipY`.
          return {
            id: mark.id,
            label: mark.label,
            shapes: svgToShapes(await response.text()),
            flipY: true,
          };
        }
        if (!font) return null;
        return {
          id: mark.id,
          label: mark.label,
          shapes: letterToShapes(mark.source, font),
          flipY: false,
        };
      } catch {
        // A mark that fails to load is simply absent, exactly as `loadMarks` treats it — one bad file
        // should not cost the whole comparison.
        return null;
      }
    }),
  );

  return prepared.filter((mark): mark is PreparedMark => mark !== null);
}

function loadSurfaceTexture(): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      SURFACE_TEXTURE_PATH,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        resolve(texture);
      },
      undefined,
      () => resolve(null),
    );
  });
}

export function useTransitionLab(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  strategyId: MarkTransitionId,
  controls: TransitionLabControls,
): TransitionLabReadout {
  // The loop reads the latest controls through this rather than being rebuilt when one moves.
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const [markLabels, setMarkLabels] = useState<string[]>([]);
  const [isBuilt, setIsBuilt] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<TransitionBuildMetrics | null>(null);
  const [timing, setTiming] = useState<FrameTiming>(EMPTY_TIMING);
  const [totals, setTotals] = useState<RenderTotals>({
    drawCalls: 0,
    triangles: 0,
    programs: 0,
  });
  const [playProgress, setPlayProgress] = useState(0);

  // Set once the strategy exists, so a knob can reach it without the scene effect re-running. Also
  // re-reads the metrics, because a rebuilding knob changes the reported build time.
  const applyTuningRef = useRef<((tuning: TransitionTuning) => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const factory = MARK_TRANSITION_FACTORIES[strategyId];
    if (!factory) {
      setIsBuilt(false);
      setIsReady(false);
      return;
    }
    setIsBuilt(true);

    const rig = createMarkLabRig(canvas);
    let isDisposed = false;
    let strategy: MarkTransitionStrategy | null = null;
    let surfaceTexture: THREE.Texture | null = null;

    const restSamples = new FrameSamples();
    const transitionSamples = new FrameSamples();

    // ── Drag to inspect ──
    let isDragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let dragYaw = 0;
    let dragPitch = 0;

    const onPointerDown = (event: PointerEvent) => {
      isDragging = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!isDragging) return;
      dragYaw += (event.clientX - lastPointerX) * DRAG_YAW_SENSITIVITY;
      dragPitch = THREE.MathUtils.clamp(
        dragPitch + (event.clientY - lastPointerY) * DRAG_PITCH_SENSITIVITY,
        -DRAG_PITCH_CLAMP,
        DRAG_PITCH_CLAMP,
      );
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      isDragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    const resizeObserver = new ResizeObserver(rig.resize);
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    const reduceMotion = prefersReducedMotion();
    const clock = new THREE.Clock();
    let frameHandle = 0;
    let idleSpin = 0;
    // Kept out of React entirely — 60 progress values a second in state would re-render the panel at
    // 60Hz, which is exactly the cost the frame-time instrument is trying to measure.
    let playHead = 0;
    let playDirection = 1;
    let lastReadoutAt = 0;

    const renderFrame = () => {
      frameHandle = requestAnimationFrame(renderFrame);
      const frameStartedAt = performance.now();
      const deltaSeconds = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);
      const elapsed = clock.elapsedTime;
      const current = controlsRef.current;

      if (current.isPlaying && !reduceMotion) {
        const cycle = Math.max(current.roundTripSeconds, 0.1);
        playHead += (deltaSeconds / cycle) * playDirection;
        if (playHead >= 1) {
          playHead = 1;
          playDirection = -1;
        } else if (playHead <= 0) {
          playHead = 0;
          playDirection = 1;
        }
      } else if (!current.isPlaying) {
        // Seek, so pressing play resumes from wherever the scrub was left.
        playHead = current.progress;
        playDirection = 1;
      }

      // Reduced motion gets the destination, never the journey.
      const progress = reduceMotion ? 1 : current.isPlaying ? playHead : current.progress;

      if (strategy) {
        strategy.setTransition(current.fromIndex, current.toIndex, progress);
        strategy.update(reduceMotion ? 0 : elapsed);
      }

      if (current.isSpinning && !reduceMotion && !isDragging) {
        idleSpin += THREE.MathUtils.degToRad(IDLE_SPIN_DEGREES_PER_SECOND) * deltaSeconds;
      }
      rig.spin.rotation.y = idleSpin + dragYaw;
      rig.spin.rotation.x = dragPitch;

      // Totalled across every composer pass, which is why `autoReset` is off in the rig: each pass
      // calls `renderer.render`, and with the default on, `info` would describe only the last
      // fullscreen quad instead of the frame.
      rig.renderer.info.reset();
      rig.composer.render();

      const frameMilliseconds = performance.now() - frameStartedAt;
      const isAtRest =
        !current.isPlaying &&
        (progress <= AT_REST_EPSILON || progress >= 1 - AT_REST_EPSILON);
      if (isAtRest) restSamples.add(frameMilliseconds);
      else transitionSamples.add(frameMilliseconds);

      if (frameStartedAt - lastReadoutAt >= READOUT_INTERVAL_MS) {
        lastReadoutAt = frameStartedAt;
        setTiming({
          restMedian: restSamples.median(),
          rest95th: restSamples.ninetyFifth(),
          transitionMedian: transitionSamples.median(),
          transition95th: transitionSamples.ninetyFifth(),
        });
        setTotals({
          drawCalls: rig.renderer.info.render.calls,
          triangles: rig.renderer.info.render.triangles,
          programs: rig.renderer.info.programs?.length ?? 0,
        });
        if (current.isPlaying) setPlayProgress(playHead);
      }
    };

    Promise.all([prepareMarks(), loadSurfaceTexture()])
      .then(async ([marks, texture]) => {
        if (isDisposed) return;
        surfaceTexture = texture;
        if (marks.length === 0) throw new Error('No marks could be loaded.');
        setMarkLabels(marks.map((mark) => mark.label));

        const created = await factory.create(
          marks,
          {
            targetSize: MARK_LAB_TARGET_SIZE,
            depth: MARK_DEPTH,
            surfaceTexture: texture,
            // The rig is for authoring on a desktop; a candidate that needs the low tier can be measured
            // by throttling the GPU rather than by being handed a smaller budget here.
            performanceTier: 'high',
          },
          controlsRef.current.tuning,
        );
        if (isDisposed) {
          created.dispose();
          return;
        }
        strategy = created;
        rig.spin.add(created.object);

        applyTuningRef.current = (next) => {
          created.applyTuning?.(next);
          // Spread, so React sees a new object — the strategy reassigns its own metrics in place.
          setMetrics({ ...created.metrics });
        };
        // Marks load asynchronously, so a knob may already have moved since `create` was handed its
        // values. Catch up once rather than leaving the panel and the scene disagreeing.
        applyTuningRef.current(controlsRef.current.tuning);

        setMetrics({ ...created.metrics });
        setIsReady(true);
      })
      .catch((cause: unknown) => {
        if (isDisposed) return;
        setError(cause instanceof Error ? cause.message : 'Failed to build the transition.');
      });

    renderFrame();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      applyTuningRef.current = null;
      if (strategy) {
        rig.spin.remove(strategy.object);
        strategy.dispose();
      }
      surfaceTexture?.dispose();
      rig.dispose();
    };
  }, [canvasRef, strategyId]);

  // Compared by serialised value, not by reference: the panel builds a fresh tuning object on every
  // keystroke, and re-packing four marks for an identical set of numbers would fight the sliders.
  const tuningKey = JSON.stringify(controls.tuning);
  useEffect(() => {
    applyTuningRef.current?.(controlsRef.current.tuning);
  }, [tuningKey]);

  return {
    markLabels,
    isBuilt,
    isReady,
    error,
    metrics,
    timing,
    totals,
    playProgress,
  };
}
