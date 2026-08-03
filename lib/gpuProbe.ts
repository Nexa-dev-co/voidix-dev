import type * as THREE from 'three';

/**
 * How long this machine's GPU actually takes to draw one frame of a real pipeline.
 *
 * ── Why measure at all ───────────────────────────────────────────────────────────────────────────
 * `adaptivePixelRatio` used to guess: it assumed every machine could afford to render ABOVE native
 * and let the live controller claw that back if frames came in slow. Two things are wrong with
 * guessing upward. The claw-back only happens after the resolution has already been raised — which
 * means the composers have already been reallocated at 2.25× the memory, on exactly the machine that
 * could not afford it. And the controller's own dead zone is wide enough that a laptop sitting at
 * 38 fps never trips it at all, so the guess is never corrected.
 *
 * A measurement inverts that: native is the default, and rendering above it has to be EARNED.
 *
 * ── Why it is nearly free ────────────────────────────────────────────────────────────────────────
 * The loader already renders each heavy scene once, to force its post-processing chain to compile
 * (`ASSETS_WARMUP_EVENT`). That render is a full frame of the real pipeline at the real canvas size —
 * i.e. it is already the benchmark. All this adds is a second draw and two pipeline drains.
 *
 * ── Why `finish()` rather than a timer query ─────────────────────────────────────────────────────
 * `EXT_disjoint_timer_query_webgl2` is the "proper" instrument and is unavailable often enough
 * (disabled for side-channel reasons, absent on some drivers) that a path depending on it would be
 * dead on the machines this exists to help. `gl.finish()` blocks until the GPU has drained, so
 * wall-clock across it is the honest cost of the work — with driver overhead included, which is part
 * of the truth on the tier we care about.
 *
 * ⚠ It over-reports slightly. A real frame pipelines CPU and GPU work; this deliberately does not, so
 * the number is a pessimistic bound. `PIPELINE_FRAME_BUDGET_MS` in `adaptivePixelRatio` is set
 * against that, not against a raw 16.7.
 */

/**
 * Below this, the measurement is not believable and must not be acted on.
 *
 * Some drivers treat `finish()` as little more than a flush. That returns a near-zero reading, which
 * would be read as "this machine is enormously fast" and would raise the resolution on the strength
 * of an instrument that did not work. Treated as "unknown" instead — and unknown means native, which
 * is the safe answer either way.
 */
const MIN_BELIEVABLE_MILLISECONDS = 0.15;

/** A frame so slow the reading is more likely a hitch (a tab switch, a GC pause) than a frame cost. */
const MAX_BELIEVABLE_MILLISECONDS = 400;

export interface GpuFrameCost {
  /** Wall-clock milliseconds for one drained frame, or null if the reading could not be trusted. */
  milliseconds: number | null;
  /** Device pixels the frame covered, in millions — the measurement is meaningless without it. */
  megapixels: number;
}

/**
 * Time one drained draw of `drawFrame`.
 *
 * ⚠ The caller MUST have drawn this same pipeline at least once already, on an earlier frame. The
 * first draw of anything carries costs that are not what a steady frame costs — render targets
 * allocated, textures uploaded, programs linked — and measuring those would report a machine as far
 * slower than it is. The warm-up has to pay them anyway; it just must not be what gets timed.
 *
 * Taking that first draw on an EARLIER FRAME rather than immediately before this one is deliberate.
 * Two full pipeline drains back to back is a long contiguous stall, and this runs during the loader,
 * where a long contiguous GPU stall is the exact thing being removed (`docs/loader-freeze-plan.md` §7
 * — the compositor cannot present anyone's frames while the GPU process is busy, worker canvases
 * included). Split across two frames, each half is one hitch instead of one long one.
 */
export function measureGpuFrameCost(
  renderer: THREE.WebGLRenderer,
  drawFrame: () => void,
): GpuFrameCost {
  const context = renderer.getContext();
  // Read off the context rather than through `renderer.getDrawingBufferSize`, which wants a Vector2 to
  // write into — this file holds a TYPE-only import of three deliberately, so that it can be reasoned
  // about (and tested) without pulling the library in.
  const megapixels = (context.drawingBufferWidth * context.drawingBufferHeight) / 1e6;

  try {
    // Drain whatever is still outstanding from earlier frames, so none of it is charged to us.
    context.finish();

    const startedAt = performance.now();
    drawFrame();
    context.finish();
    const milliseconds = performance.now() - startedAt;

    const believable =
      milliseconds >= MIN_BELIEVABLE_MILLISECONDS &&
      milliseconds <= MAX_BELIEVABLE_MILLISECONDS &&
      megapixels > 0;

    return { milliseconds: believable ? milliseconds : null, megapixels };
  } catch {
    // A context loss mid-probe is the realistic failure here. Report unknown and let the caller fall
    // back to native — never let a measurement failure take the section down with it.
    return { milliseconds: null, megapixels };
  }
}
