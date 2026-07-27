"use client";

import { useEffect, useRef } from "react";
import { getAssetProgress } from "@/lib/assetLoadProgress";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import { GatherRenderer } from "./gatherRenderer";
import type { GatherMessage } from "./gatherMessages";
import { IGNITE_EVENT } from "./introEvents";

// The loader's gathering field — matter falling together into the star the page opens on.
//
// Motion lives in gatherShader.ts, rendering in gatherRenderer.ts. This file owns only the things that
// need the DOM: the canvas, where the wordmark's "o" actually is, and handing all of it to a worker.
//
// WHY A WORKER
// The particles used to freeze mid-load. The cause is not the animation — it is that parsing glTF,
// uploading geometry and compiling shaders are synchronous main-thread work, and while any of it runs the
// browser cannot call requestAnimationFrame at all. Moving the render loop to an OffscreenCanvas in a
// worker is the only thing that keeps it moving, because the compositor still presents the worker's
// frames. Browsers without OffscreenCanvas fall back to the old main-thread path, freeze and all.

/** The empty span the sun overlays in the wordmark — the point everything converges on. */
const O_SLOT_SELECTOR = ".intro-o-slot";

const MAX_DEVICE_PIXEL_RATIO = 2;
// Re-measuring the "o" every frame would force a synchronous layout while GSAP writes styles to that same
// subtree. It only moves on resize, so a periodic check is plenty.
const MEASURE_INTERVAL_MS = 250;
// How often progress is posted to the worker. Progress itself is eased inside the renderer, so this only
// needs to be often enough to feel live.
const POST_INTERVAL_MS = 100;
/**
 * Ring radius as a multiple of the glyph's height.
 *
 * The sun fills the "o" at `SUN_IN_O_RATIO` (1.3) of the glyph, so its *radius* is about 0.65 glyphs.
 * Anything near that and the dust sits on the star instead of orbiting it — this keeps the ring well
 * outside, at roughly 2.5× the sun's radius, so it reads as a disc around a star.
 */
const RING_TO_GLYPH_RATIO = 0.9;

/**
 * Workers already attached to a canvas, so a re-run of the effect reuses one instead of transferring
 * again.
 *
 * `transferControlToOffscreen()` can only ever be called ONCE per element — the second call throws
 * InvalidStateError — and this project runs `reactStrictMode: true`, which deliberately mounts, cleans up
 * and re-mounts every effect in development. React reuses the same DOM node across that cycle, so without
 * this the loader would throw on every dev page load.
 */
const WORKERS_BY_CANVAS = new WeakMap<
  HTMLCanvasElement,
  { worker: Worker; teardownTimer: number }
>();

export default function GatherCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Checked here rather than in render: this component is server-rendered, and a media query that
    // answers differently on the client would break hydration. Bailing in the effect also means no WebGL
    // context is ever created for someone who asked for less motion.
    if (prefersReducedMotion()) return;

    const pixelRatio = Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO);
    const canvasSize = () => ({
      width: canvas.clientWidth || 1,
      height: canvas.clientHeight || 1,
    });

    // Convert the "o" slot's screen box into the shader's aspect units. Returns null while the wordmark
    // has no layout yet, in which case the field keeps its current target (the centre by default).
    const measureTarget = () => {
      const slot = document.querySelector(O_SLOT_SELECTOR);
      if (!slot) return null;
      const rect = slot.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      const { width, height } = canvasSize();
      const aspect = width / height;
      // Screen pixels → NDC → aspect units. Y flips: screens count downward.
      return {
        targetX: (((rect.left + rect.width / 2) / width) * 2 - 1) * aspect,
        targetY: -(((rect.top + rect.height / 2) / height) * 2 - 1),
        targetRadius: (rect.height / height) * 2 * RING_TO_GLYPH_RATIO,
      };
    };

    // ── Two backends, one renderer ──
    let worker: Worker | null = null;
    let fallback: GatherRenderer | null = null;
    let fallbackFrame = 0;

    const post = (message: GatherMessage, transfer?: Transferable[]) => {
      if (worker) worker.postMessage(message, transfer ?? []);
    };

    const supportsOffscreen =
      typeof window.Worker === "function" &&
      typeof canvas.transferControlToOffscreen === "function";

    if (supportsOffscreen) {
      const existing = WORKERS_BY_CANVAS.get(canvas);
      if (existing) {
        // A StrictMode re-mount. The worker is still rendering — cancel its pending teardown and adopt it.
        window.clearTimeout(existing.teardownTimer);
        worker = existing.worker;
      } else {
        worker = new Worker(new URL("./gather.worker.ts", import.meta.url));
        const offscreen = canvas.transferControlToOffscreen();
        const { width, height } = canvasSize();
        // Transferred, not copied — after this the main thread can never draw to this canvas again.
        post(
          { type: "init", canvas: offscreen, width, height, pixelRatio },
          [offscreen],
        );
        WORKERS_BY_CANVAS.set(canvas, { worker, teardownTimer: 0 });
      }
    } else {
      fallback = new GatherRenderer(canvas, pixelRatio);
      const { width, height } = canvasSize();
      fallback.resize(width, height);
      const loop = () => {
        fallback?.renderFrame();
        fallbackFrame = requestAnimationFrame(loop);
      };
      loop();
    }

    const sendUpdate = () => {
      const measured = measureTarget();
      const update = { type: "update" as const, progress: getAssetProgress(), ...measured };
      if (worker) post(update);
      else fallback?.update(update);
    };

    const resize = () => {
      const { width, height } = canvasSize();
      if (worker) post({ type: "resize", width, height });
      else fallback?.resize(width, height);
      sendUpdate(); // the convergence point moves with the viewport
    };

    // A transferred canvas ignores width/height attributes set from here, so the worker is told the CSS
    // size instead and sizes its own drawing buffer.
    window.addEventListener("resize", resize);
    // Fonts change the glyph's box, so re-aim once they land.
    document.fonts?.ready.then(sendUpdate).catch(() => {});

    // Progress is cheap to read, so it goes often. Measuring the "o" forces a layout, so it goes rarely.
    const sendProgress = () => {
      const update = { type: "update" as const, progress: getAssetProgress() };
      if (worker) post(update);
      else fallback?.update(update);
    };

    sendUpdate();
    const progressTimer = window.setInterval(sendProgress, POST_INTERVAL_MS);
    const measureTimer = window.setInterval(sendUpdate, MEASURE_INTERVAL_MS);

    const onIgnite = () => {
      if (worker) post({ type: "ignite" });
      else fallback?.ignite();
    };
    window.addEventListener(IGNITE_EVENT, onIgnite);

    return () => {
      window.clearInterval(progressTimer);
      window.clearInterval(measureTimer);
      window.removeEventListener("resize", resize);
      window.removeEventListener(IGNITE_EVENT, onIgnite);
      // Deferred so a StrictMode re-mount (which runs in the same commit) can cancel it and adopt the
      // worker. A real unmount has nothing to cancel it, so the worker is genuinely torn down.
      const entry = WORKERS_BY_CANVAS.get(canvas);
      if (entry) {
        entry.teardownTimer = window.setTimeout(() => {
          entry.worker.postMessage({ type: "dispose" } satisfies GatherMessage);
          entry.worker.terminate();
          WORKERS_BY_CANVAS.delete(canvas);
        }, 0);
      }
      cancelAnimationFrame(fallbackFrame);
      fallback?.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}
