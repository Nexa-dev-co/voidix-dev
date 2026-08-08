import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { BLACK_STAGE_EVENT, readBlackStageActive } from '@/lib/blackStageEvent';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import {
  STABILITY_FLOOR,
  STABILITY_CEILING,
  STABILITY_FPS_LOW,
  STABILITY_FPS_HIGH,
  STABILITY_SETTLE_START,
  STABILITY_SMOOTHING_RATE,
  FPS_WINDOW_MS,
  FPS_WINDOW_DISCARD_MS,
  ENERGY_IDLE,
  ENERGY_PEAK,
  ENERGY_FULL_VELOCITY,
  ENERGY_RESPONSE_CURVE,
  ENERGY_ATTACK_RATE,
  ENERGY_DECAY_RATE,
} from '../heroReadouts';

// The Core OS telemetry engine: one rAF loop drives the two live readouts of the left panel by
// writing straight to the DOM — no React state, so the panel never re-renders.
//
//   Core Stability — frames are counted per one-second window, the resulting fps maps through a
//   smoothstep into 96–100%, and the displayed number glides toward that target exponentially.
//   Energy Output  — a passive pointermove listener only records positions; each frame turns the
//   accumulated travel into a velocity (normalised by the viewport diagonal so screen size doesn't
//   change the feel), curves it into a target output, and glides with a fast attack / slow decay.
//
// Nothing runs until REVEAL_EVENT (Contract 2 — the intro owns the hero until the sun lands), with
// the same fallback timeout the other hero hooks use. Under reduced motion the resting values in
// the markup already ARE the display, so the hook does nothing at all.

const REVEAL_FALLBACK_MS = 7000;
const MIN_FRAME_SECONDS = 1 / 240; // guards the velocity division against a zero-length frame
const MAX_FRAME_SECONDS = 0.1; // clamps the dt spike right after a hidden tab resumes

interface CoreTelemetryRefs {
  panelRef: RefObject<HTMLElement | null>;
}

export function useCoreTelemetry({ panelRef }: CoreTelemetryRefs) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || prefersReducedMotion()) return;

    const stabilityValue = panel.querySelector<HTMLElement>('[data-live="stability"]');
    const energyValue = panel.querySelector<HTMLElement>('[data-live="energy"]');
    const energyFill = panel.querySelector<HTMLElement>('[data-energy-fill]');
    if (!stabilityValue && !energyValue) return;

    // Cursor travel is scoped to the hero; the panel only exists there anyway.
    const pointerSurface = panel.closest<HTMLElement>('.hero-section') ?? window;

    // The listener only records — all math waits for the frame, so pointermove stays O(1).
    let travelledSinceFrame = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let hasPointer = false;
    const handlePointerMove = (event: PointerEvent) => {
      if (hasPointer) {
        travelledSinceFrame += Math.hypot(event.clientX - lastPointerX, event.clientY - lastPointerY);
      }
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      hasPointer = true;
    };

    let animationFrameId = 0;
    let lastFrameTime = 0;
    let frameCount = 0;
    let fpsWindowStart = 0;
    let stabilityTarget = STABILITY_CEILING;
    let stabilityDisplay = STABILITY_SETTLE_START;
    let stabilityText = '';
    let energyDisplay = ENERGY_IDLE;
    let energyText = '';

    const frame = (now: number) => {
      animationFrameId = requestAnimationFrame(frame);
      if (!lastFrameTime) {
        lastFrameTime = now;
        fpsWindowStart = now;
        return;
      }
      const deltaSeconds = Math.min(
        Math.max((now - lastFrameTime) / 1000, MIN_FRAME_SECONDS),
        MAX_FRAME_SECONDS,
      );
      lastFrameTime = now;

      // 1. FPS window → stability target. Smoothstep between the fps bounds so the mapping has no
      //    corners; an overlong window means the tab was hidden, so that sample is thrown away.
      frameCount += 1;
      const windowElapsed = now - fpsWindowStart;
      if (windowElapsed >= FPS_WINDOW_MS) {
        if (windowElapsed < FPS_WINDOW_DISCARD_MS) {
          const framesPerSecond = (frameCount * 1000) / windowElapsed;
          const healthRaw = Math.min(
            Math.max((framesPerSecond - STABILITY_FPS_LOW) / (STABILITY_FPS_HIGH - STABILITY_FPS_LOW), 0),
            1,
          );
          const health = healthRaw * healthRaw * (3 - 2 * healthRaw);
          stabilityTarget = STABILITY_FLOOR + (STABILITY_CEILING - STABILITY_FLOOR) * health;
        }
        frameCount = 0;
        fpsWindowStart = now;
      }

      // 2. Stability glides toward its target — frame-rate-independent exponential smoothing, so
      //    the number never steps even when the target moves a full point.
      if (stabilityValue) {
        stabilityDisplay += (stabilityTarget - stabilityDisplay) * (1 - Math.exp(-deltaSeconds * STABILITY_SMOOTHING_RATE));
        const nextStabilityText = `${stabilityDisplay.toFixed(2)}%`;
        if (nextStabilityText !== stabilityText) {
          stabilityText = nextStabilityText;
          stabilityValue.textContent = nextStabilityText;
        }
      }

      // 3. Cursor travel → energy target → asymmetric glide. Velocity is measured in viewport
      //    diagonals per second so a sweep feels identical on a phone and a 4K display.
      if (energyValue) {
        // Guard the division: a minimised/zero-size window gives a 0 diagonal, and 0/0 is NaN —
        // once energyDisplay goes NaN it stays NaN forever. No motion must read exactly 0, not NaN.
        const viewportDiagonal = Math.hypot(window.innerWidth, window.innerHeight);
        const velocity = viewportDiagonal > 0 ? travelledSinceFrame / viewportDiagonal / deltaSeconds : 0;
        travelledSinceFrame = 0;
        const drive = Number.isFinite(velocity)
          ? Math.min(Math.max(velocity, 0) / ENERGY_FULL_VELOCITY, 1) ** ENERGY_RESPONSE_CURVE
          : 0;
        const energyTarget = ENERGY_IDLE + (ENERGY_PEAK - ENERGY_IDLE) * drive;
        const glideRate = energyTarget > energyDisplay ? ENERGY_ATTACK_RATE : ENERGY_DECAY_RATE;
        energyDisplay += (energyTarget - energyDisplay) * (1 - Math.exp(-deltaSeconds * glideRate));

        const nextEnergyText = `${Math.round(energyDisplay)}%`;
        if (nextEnergyText !== energyText) {
          energyText = nextEnergyText;
          energyValue.textContent = nextEnergyText;
        }
        if (energyFill) {
          energyFill.style.transform = `scaleX(${(energyDisplay / ENERGY_PEAK).toFixed(4)})`;
        }
      }
    };

    let hasStarted = false;
    let inVoid = false;

    // Resuming is not just "call rAF again" — three counters have to be re-seeded or the first frame
    // back lies. `lastFrameTime = 0` takes the loop's own re-seed path (dt AND the fps window);
    // `frameCount` would otherwise carry frames from before the pause into a window that now starts
    // `now`, reporting a frame rate the machine never reached; and `travelledSinceFrame` would hand a
    // whole journey's worth of cursor travel to one frame and slam Energy Output to 100%.
    const startLoop = () => {
      if (inVoid || animationFrameId !== 0) return;
      lastFrameTime = 0;
      frameCount = 0;
      travelledSinceFrame = 0;
      animationFrameId = requestAnimationFrame(frame);
    };

    const startTelemetry = () => {
      if (hasStarted) return;
      hasStarted = true;
      pointerSurface.addEventListener('pointermove', handlePointerMove as EventListener, { passive: true });
      startLoop();
    };

    // ── The HUD only exists on the hero ──
    // Past the fill boundary a full-black scene owns the page and both panels are off screen, but this
    // loop kept running for the whole journey — a rAF, a viewport read and DOM writes every frame,
    // competing for exactly the frames the works field can least spare. The fluid cursor and the
    // constellation are already gated on this same event.
    //
    // ⚠ It has to RE-ARM, and the case that catches you is the TELEPORT: the loop's `scrollTo(0)` puts
    // the visitor back on the hero, the stage machine publishes `active: false`, and without this the
    // readouts sit frozen wherever contact left them for the whole second lap.
    //
    // The pointermove listener deliberately stays attached while suspended. It is O(1), and detaching
    // it would leave `lastPointer*` stale, so the first move back would measure a jump across the
    // screen instead of a frame's worth of travel.
    const onBlackStage = (event: Event) => {
      inVoid = readBlackStageActive(event);
      if (inVoid) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
      } else if (hasStarted) {
        startLoop();
      }
    };
    window.addEventListener(BLACK_STAGE_EVENT, onBlackStage);

    window.addEventListener(REVEAL_EVENT, startTelemetry);
    const fallbackTimeout = window.setTimeout(startTelemetry, REVEAL_FALLBACK_MS);

    return () => {
      window.removeEventListener(REVEAL_EVENT, startTelemetry);
      window.removeEventListener(BLACK_STAGE_EVENT, onBlackStage);
      window.clearTimeout(fallbackTimeout);
      pointerSurface.removeEventListener('pointermove', handlePointerMove as EventListener);
      cancelAnimationFrame(animationFrameId);
    };
  }, [panelRef]);
}
