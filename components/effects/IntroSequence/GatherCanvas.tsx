"use client";

import { useEffect, useRef } from "react";
import {
  areArrivedWarmupsDone,
  areAssetsReady,
  getAssetProgress,
} from "@/lib/assetLoadProgress";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import { createPageEtaEstimator } from "./downloadEta";
import { GatherRenderer } from "./gatherRenderer";
import { SUN_IN_O_RATIO, SUN_BODY_FILL, SUN_FRAMING_NUDGE_X } from "./gatherShader";
import type { GatherMessage } from "./gatherMessages";
import { IGNITE_EVENT, SUN_FORMING_EVENT, SUN_ASSEMBLED_EVENT } from "./introEvents";

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
 * The sun's BODY radius as a multiple of the "o" glyph's height.
 *
 * Everything in the field is measured in sun radii (see gatherShader.ts), so this one number registers
 * the dust to the star. It is derived, not tuned: the sun element is `SUN_IN_O_RATIO` of the glyph, the
 * model's body fills `SUN_BODY_FILL` of that element, and radius is half of it.
 *
 * The previous version had a hand-picked 0.9 here, which is roughly TWICE this — that, plus a shader
 * that biased particles outward, is what made the dust orbit at 2× the sun's radius instead of falling
 * into it.
 */
const SUN_RADIUS_PER_GLYPH = (SUN_IN_O_RATIO * SUN_BODY_FILL) / 2;

/**
 * Longest the dust will stay withdrawn from around the star waiting for an assembly to finish.
 *
 * Only the SECOND HALF of the flight is spent withdrawn now (the withdrawal starts at
 * `SUN_FORMING_EVENT`, the assembly's midpoint), so this only has to cover ~1.1 s of
 * `ASSEMBLY_SECONDS` plus room for slow frames.
 *
 * Belt-and-braces rather than load-bearing: keyed to the forming event there is a star by construction,
 * so `SUN_ASSEMBLED_EVENT` is genuinely coming. It stays because a hole left open in the loader's own
 * field is a bad enough failure to be worth two lines. See `onSunForming`.
 */
const CLEARING_MAX_MS = 3000;

/**
 * How far away the star has to look before the dust starts gathering into forms.
 *
 * The loader now waits for the star for as long as the star keeps arriving rather than giving up on a
 * deadline (see IntroSequence's gate), which on a weak connection means a minute or more on screen.
 * The stream alone cannot carry that — it is the same picture at second 3 and second 70 — so past this
 * estimate the field starts holding shapes instead.
 *
 * ⚠ Checked against the ESTIMATE, not against elapsed time, and that is the whole point of measuring:
 * a fast connection is already finished by the time a stopwatch would have fired, so it never sees a
 * form at all and its loader is exactly what it was.
 *
 * ⚠ WAS 10, AND THAT MEANT ALMOST NOBODY EVER SAW THIS. The estimate is the STAR's, not the page's —
 * the field's density tracks the star deliberately (see `sendUpdate`) — and the star is 1.25 MB against
 * the page's ~10 MB. So on real loads that ran 14–17 s end to end, the star was landing in 1–8 s and
 * the threshold was never crossed: a shipped feature that had effectively never run outside a
 * throttled tab.
 *
 * 4 s still leaves a genuinely fast load alone (a warm cache pulls the star in well under it, and a
 * two-second loader has no wait worth filling), while any load with a real gap in it now gets the
 * forms. Paired with the later release below, the shapes now cover the whole wait rather than a slice
 * of the download.
 */
const SHAPE_ONSET_ETA_SECONDS = 4;

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
      // The sun is framed slightly left of the glyph's centre (SUN_FRAMING_NUDGE_X), so the stream has to
      // follow it or the dust would be absorbed off to one side of the star. The nudge is a fraction of
      // the sun camera's half-frame, and that half-frame is half the sun element's height on screen.
      const sunNudge = (SUN_FRAMING_NUDGE_X * (rect.height * SUN_IN_O_RATIO)) / height;
      // Screen pixels → NDC → aspect units. Y flips: screens count downward.
      return {
        targetX: (((rect.left + rect.width / 2) / width) * 2 - 1) * aspect - sunNudge,
        targetY: -(((rect.top + rect.height / 2) / height) * 2 - 1),
        // The full canvas height is 2 aspect units, so a pixel height maps in at (px / height) * 2.
        sunRadius: (rect.height / height) * 2 * SUN_RADIUS_PER_GLYPH,
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

    // ── Does this wait need filling? ──
    // Owned here rather than driven from the intro's gate, because everything the decision needs is
    // already in this file: the field, its inputs, and the star's progress. One estimator, sampled on
    // the same tick that posts progress.
    //
    // ── When the shapes let go ──
    // The rule this file has always held is that THE FINALE IS THE FLOW'S, not a shape's: the dust has
    // to be back in its stream before the shards fly. That is unchanged and must stay.
    //
    // ⚠ What changed is where the wait ends. It used to release on the star LANDING, on the reasoning
    // that the warm-up beat after it was short. It is not any more — the two scenes compile, allocate
    // and now run a burn-in of up to 1.5 s (see `reportBurnIn`), so releasing at the landing left the
    // field back to plain dust for seconds while the loader was still visibly working.
    //
    // Releasing when the ARRIVED warm-ups are done instead puts the release at the start of
    // `ASSEMBLY_LEAD_MS` — the held beat the intro already inserts before the flight. So the shapes
    // cover the whole wait, and the dust still gets its full second of stream before the first shard
    // moves. Both rules satisfied, rather than one traded for the other.
    const pageEta = createPageEtaEstimator();
    let shapeHold = 0;
    const resolveShapeHold = () => {
      pageEta.sample();
      if (areAssetsReady() && areArrivedWarmupsDone()) {
        shapeHold = 0;
        return;
      }
      // Latched: once the wait has been judged long, it stays long. Without this the estimate
      // wobbling either side of the threshold would gather and release the whole field repeatedly.
      if (shapeHold === 0) {
        const remaining = pageEta.secondsRemaining();
        if (remaining !== null && remaining >= SHAPE_ONSET_ETA_SECONDS) shapeHold = 1;
      }
    };

    // ── The field's density tracks THE WHOLE PAGE ──
    // It tracked the star, on the stated reasoning that the star "is what the gate waits for, so it is
    // what the loader should be reporting". That reasoning is kept and its premise has changed: the
    // gate now holds for every source (see `isGateSatisfied` in IntroSequence). Left on the star, the
    // field would reach full density around 18 % of the way through the download and then sit there
    // for the rest of it — dense, still, and saying nothing — which is the same lie the counter was
    // just taken off the star to stop telling.
    const sendUpdate = () => {
      resolveShapeHold();
      const measured = measureTarget();
      const update = {
        type: "update" as const,
        progress: getAssetProgress(),
        shapeHold,
        ...measured,
      };
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
      resolveShapeHold();
      // Same reading as `sendUpdate` — the whole page, not the star. Two call sites, one source of
      // truth, or the field's density would flicker between two different ideas of "how far in".
      const update = { type: "update" as const, progress: getAssetProgress(), shapeHold };
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

    // Withdraw the dust from around the star for exactly the span of the assembly — the shards need clean
    // space to dock into — then let it flow back. Only the zone around the star clears; the rest of the
    // field keeps streaming, so the screen is never still.
    const setClearing = (clearing: number) => {
      const update = { type: "update" as const, clearing };
      if (worker) post(update);
      else fallback?.update(update);
    };
    // ⚠ Keyed to SUN_FORMING, not to SUN_ASSEMBLE. The cue is the intro ASKING for the assembly; the
    // forming event is the star actually lighting inside its shell, halfway through the flight. Keying
    // the withdrawal to the cue meant that on a slow load — where the gate gives up on assets and asks
    // for an assembly the sun has no model to perform — the dust pulled back from around an empty "o"
    // and stayed pulled back for the whole remaining download. The field's own hole, with nothing
    // arriving to fill it.
    //
    // On the forming event there is a star there by construction, and the dust has been streaming
    // uninterrupted for the entire wait and the whole first half of the flight.
    let clearingFallback = 0;
    const onSunForming = () => {
      setClearing(1);
      window.clearTimeout(clearingFallback);
      clearingFallback = window.setTimeout(() => setClearing(0), CLEARING_MAX_MS);
    };
    const onAssembleEnd = () => {
      window.clearTimeout(clearingFallback);
      setClearing(0);
    };
    window.addEventListener(SUN_FORMING_EVENT, onSunForming);
    window.addEventListener(SUN_ASSEMBLED_EVENT, onAssembleEnd);

    return () => {
      window.clearInterval(progressTimer);
      window.clearInterval(measureTimer);
      window.removeEventListener("resize", resize);
      window.removeEventListener(IGNITE_EVENT, onIgnite);
      window.removeEventListener(SUN_FORMING_EVENT, onSunForming);
      window.removeEventListener(SUN_ASSEMBLED_EVENT, onAssembleEnd);
      window.clearTimeout(clearingFallback);
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
