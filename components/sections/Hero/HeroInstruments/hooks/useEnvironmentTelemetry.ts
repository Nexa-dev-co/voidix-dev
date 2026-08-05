import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { measureUntransformedRect } from '@/lib/measureUntransformedRect';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import {
  POINTER_SPEED_REFERENCE,
  GRAVITY_STATES,
  GRAVITY_INTENSIFY_ENTER,
  GRAVITY_INTENSIFY_EXIT,
  INFLUENCE_MAX_DISTANCE_VMIN,
  INFLUENCE_BASE_WEIGHT,
  INFLUENCE_VELOCITY_WEIGHT,
  INFLUENCE_SMOOTHING_RATE,
  PORTAL_STATES,
  PORTAL_ARM_PROXIMITY,
  PORTAL_READY_MS,
  PORTAL_RESET_MS,
  DISTORTION_IDLE,
  DISTORTION_MAX,
  DISTORTION_ATTACK_RATE,
  DISTORTION_DECAY_RATE,
  VECTOR_DEG_PER_SECOND,
  TELEMETRY_MIN_FRAME_SECONDS,
  TELEMETRY_MAX_FRAME_SECONDS,
} from '../heroReadouts';

// The Environment Telemetry engine: one rAF loop drives the five right-panel readouts by writing
// straight to the DOM — no React state, so the panel never re-renders. Everything it shows is real:
//
//   Gravity Field     — escalates as the cursor nears / presses the orb (a discrete word, crossfaded).
//   Cursor Influence  — cursor distance-to-orb weighted by velocity → 0–100% + a hairline bar.
//   Portal Status     — a dwell over the orb region arms STANDBY → READY.
//   Field Distortion  — the fluid cursor sim's own speed ratio, eased (fast attack / slow settle).
//   Orbital Vector    — an angle advancing at the orb's hero spin rate, wrapping 0–359°.
//
// Nothing runs until REVEAL_EVENT (the intro owns the hero until the sun lands), with the same
// fallback timeout the other hero hooks use. Under reduced motion the resting values in the markup
// already ARE the display, so the hook does nothing.

const REVEAL_FALLBACK_MS = 7000;
const CROSSFADE_HALF_MS = 130; // half of a state-word swap: fade out, swap text, fade back in

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

// A discrete word (Gravity Field, Portal Status) that crossfades on change instead of snapping.
// Opacity is only touched while a swap is in flight, so it never fights the entrance tween.
interface CrossfadeWord {
  element: HTMLElement;
  displayed: string;
  phase: 'idle' | 'out' | 'in';
  phaseStart: number;
  pendingText: string;
  pendingAccent: boolean;
}

interface EnvironmentTelemetryRefs {
  panelRef: RefObject<HTMLElement | null>;
}

export function useEnvironmentTelemetry({ panelRef }: EnvironmentTelemetryRefs) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || prefersReducedMotion()) return;

    const gravityValue = panel.querySelector<HTMLElement>('[data-metric="gravity"]');
    const influenceValue = panel.querySelector<HTMLElement>('[data-metric="influence"]');
    const influenceFill = panel.querySelector<HTMLElement>('[data-influence-fill]');
    const portalValue = panel.querySelector<HTMLElement>('[data-metric="portal"]');
    const distortionValue = panel.querySelector<HTMLElement>('[data-metric="distortion"]');
    const vectorValue = panel.querySelector<HTMLElement>('[data-metric="vector"]');

    const heroSection = panel.closest<HTMLElement>('.hero-section');
    const pointerSurface: HTMLElement | Window = heroSection ?? window;

    // ── Orb geometry — the portal square's untransformed box, cached on reveal + resize ──
    let orbCenterX = 0;
    let orbCenterY = 0;
    let orbLeft = 0;
    let orbTop = 0;
    let orbWidth = 0;
    let orbHeight = 0;
    const measureOrb = () => {
      const square = heroSection?.querySelector<HTMLElement>('.hero-sun-card');
      if (!square) return;
      const rect = measureUntransformedRect(square);
      orbLeft = rect.left;
      orbTop = rect.top;
      orbWidth = rect.width;
      orbHeight = rect.height;
      orbCenterX = rect.left + rect.width / 2;
      orbCenterY = rect.top + rect.height / 2;
    };

    // ── Pointer tracking — record only; all math waits for the frame ──
    let travelledSinceFrame = 0;
    let pointerX = 0;
    let pointerY = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let hasPointer = false;
    let pressed = false;
    const handlePointerMove = (event: PointerEvent) => {
      if (hasPointer) {
        travelledSinceFrame += Math.hypot(event.clientX - lastPointerX, event.clientY - lastPointerY);
      }
      pointerX = event.clientX;
      pointerY = event.clientY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      hasPointer = true;
    };
    const handlePointerDown = () => { pressed = true; };
    const handlePointerUp = () => { pressed = false; };

    // ── Smoothed metric state ──
    let gravityLevel = 0; // 0 active · 1 intensifying · 2 maximum
    let influenceDisplay = 0;
    let influenceText = '';
    let portalReady = false;
    let portalDwellNear = 0;
    let portalDwellAway = 0;
    let distortionDisplay = DISTORTION_IDLE;
    let distortionText = '';
    let vectorAngle = 0;
    let vectorText = '';

    const gravityWord: CrossfadeWord | null = gravityValue
      ? { element: gravityValue, displayed: GRAVITY_STATES.active, phase: 'idle', phaseStart: 0, pendingText: '', pendingAccent: false }
      : null;
    const portalWord: CrossfadeWord | null = portalValue
      ? { element: portalValue, displayed: PORTAL_STATES.standby, phase: 'idle', phaseStart: 0, pendingText: '', pendingAccent: false }
      : null;

    // Advance a crossfading word toward its desired text/accent. Opacity is written only mid-swap.
    const driveWord = (word: CrossfadeWord, desiredText: string, desiredAccent: boolean, now: number) => {
      if (word.phase === 'idle') {
        if (desiredText !== word.displayed) {
          word.phase = 'out';
          word.phaseStart = now;
          word.pendingText = desiredText;
          word.pendingAccent = desiredAccent;
        }
        return;
      }
      const progress = (now - word.phaseStart) / CROSSFADE_HALF_MS;
      if (word.phase === 'out') {
        if (progress >= 1) {
          word.element.textContent = word.pendingText;
          word.element.dataset.state = word.pendingAccent ? 'accent' : 'base';
          word.displayed = word.pendingText;
          word.element.style.opacity = '0';
          word.phase = 'in';
          word.phaseStart = now;
        } else {
          word.element.style.opacity = String(1 - progress);
        }
        return;
      }
      // phase === 'in'
      if (progress >= 1) {
        word.element.style.opacity = '1';
        word.phase = 'idle';
      } else {
        word.element.style.opacity = String(progress);
      }
    };

    let animationFrameId = 0;
    let lastFrameTime = 0;

    const frame = (now: number) => {
      animationFrameId = requestAnimationFrame(frame);
      if (!lastFrameTime) {
        lastFrameTime = now;
        return;
      }
      const deltaSeconds = Math.min(
        Math.max((now - lastFrameTime) / 1000, TELEMETRY_MIN_FRAME_SECONDS),
        TELEMETRY_MAX_FRAME_SECONDS,
      );
      lastFrameTime = now;

      // Shared per-frame scalars — cursor speed (sim-normalized) and orb proximity.
      const pixelSpeed = travelledSinceFrame / deltaSeconds;
      travelledSinceFrame = 0;
      const velocityRatio = clamp01(pixelSpeed / window.innerHeight / POINTER_SPEED_REFERENCE);

      const maxDistance = INFLUENCE_MAX_DISTANCE_VMIN * Math.min(window.innerWidth, window.innerHeight);
      const distance = hasPointer ? Math.hypot(pointerX - orbCenterX, pointerY - orbCenterY) : maxDistance;
      const proximity = clamp01(1 - distance / maxDistance);
      const insideOrb =
        hasPointer &&
        pointerX >= orbLeft && pointerX <= orbLeft + orbWidth &&
        pointerY >= orbTop && pointerY <= orbTop + orbHeight;

      // 01 Gravity Field — over-orb (or a press while near it) forces MAXIMUM; otherwise proximity
      //    with hysteresis. Gating the press on proximity keeps a click elsewhere from spiking it.
      if (gravityWord) {
        if (insideOrb || (pressed && proximity >= GRAVITY_INTENSIFY_EXIT)) {
          gravityLevel = 2;
        } else if (gravityLevel === 2) {
          gravityLevel = proximity >= GRAVITY_INTENSIFY_EXIT ? 1 : 0;
        } else if (proximity >= GRAVITY_INTENSIFY_ENTER) {
          gravityLevel = 1;
        } else if (proximity <= GRAVITY_INTENSIFY_EXIT) {
          gravityLevel = 0;
        }
        const gravityText =
          gravityLevel === 2 ? GRAVITY_STATES.maximum : gravityLevel === 1 ? GRAVITY_STATES.intensifying : GRAVITY_STATES.active;
        driveWord(gravityWord, gravityText, gravityLevel >= 1, now);
      }

      // 02 Cursor Influence — proximity, lifted by a fast cursor, eased toward the target.
      if (influenceValue) {
        const influenceTarget = 100 * clamp01(proximity * (INFLUENCE_BASE_WEIGHT + velocityRatio * INFLUENCE_VELOCITY_WEIGHT));
        influenceDisplay += (influenceTarget - influenceDisplay) * (1 - Math.exp(-deltaSeconds * INFLUENCE_SMOOTHING_RATE));
        const nextInfluenceText = `${Math.round(influenceDisplay)}%`;
        if (nextInfluenceText !== influenceText) {
          influenceText = nextInfluenceText;
          influenceValue.textContent = nextInfluenceText;
        }
        if (influenceFill) {
          influenceFill.style.transform = `scaleX(${(influenceDisplay / 100).toFixed(4)})`;
        }
      }

      // 03 Portal Status — dwell near/over the orb arms it; time away disarms it.
      if (portalWord) {
        const dwelling = insideOrb || proximity >= PORTAL_ARM_PROXIMITY;
        if (dwelling) {
          portalDwellNear += deltaSeconds * 1000;
          portalDwellAway = 0;
        } else {
          portalDwellAway += deltaSeconds * 1000;
          portalDwellNear = 0;
        }
        if (portalReady) {
          if (portalDwellAway >= PORTAL_RESET_MS) portalReady = false;
        } else if (portalDwellNear >= PORTAL_READY_MS) {
          portalReady = true;
        }
        driveWord(portalWord, portalReady ? PORTAL_STATES.ready : PORTAL_STATES.standby, portalReady, now);
      }

      // 04 Field Distortion — the sim's speed ratio, fast to rise and slow to settle to idle.
      if (distortionValue) {
        const distortionTarget = DISTORTION_IDLE + (DISTORTION_MAX - DISTORTION_IDLE) * velocityRatio;
        const distortionRate = distortionTarget > distortionDisplay ? DISTORTION_ATTACK_RATE : DISTORTION_DECAY_RATE;
        distortionDisplay += (distortionTarget - distortionDisplay) * (1 - Math.exp(-deltaSeconds * distortionRate));
        const nextDistortionText = distortionDisplay.toFixed(2);
        if (nextDistortionText !== distortionText) {
          distortionText = nextDistortionText;
          distortionValue.textContent = nextDistortionText;
        }
      }

      // 05 Orbital Vector — advance at the orb's spin rate, wrap, zero-pad to three digits.
      if (vectorValue) {
        vectorAngle = (vectorAngle + VECTOR_DEG_PER_SECOND * deltaSeconds) % 360;
        const nextVectorText = `${String(Math.floor(vectorAngle)).padStart(3, '0')}°`;
        if (nextVectorText !== vectorText) {
          vectorText = nextVectorText;
          vectorValue.textContent = nextVectorText;
        }
      }
    };

    let hasStarted = false;
    const startTelemetry = () => {
      if (hasStarted) return;
      hasStarted = true;
      measureOrb();
      pointerSurface.addEventListener('pointermove', handlePointerMove as EventListener, { passive: true });
      pointerSurface.addEventListener('pointerdown', handlePointerDown as EventListener, { passive: true });
      window.addEventListener('pointerup', handlePointerUp, { passive: true });
      window.addEventListener('resize', measureOrb);
      animationFrameId = requestAnimationFrame(frame);
    };

    window.addEventListener(REVEAL_EVENT, startTelemetry);
    const fallbackTimeout = window.setTimeout(startTelemetry, REVEAL_FALLBACK_MS);

    return () => {
      window.removeEventListener(REVEAL_EVENT, startTelemetry);
      window.clearTimeout(fallbackTimeout);
      pointerSurface.removeEventListener('pointermove', handlePointerMove as EventListener);
      pointerSurface.removeEventListener('pointerdown', handlePointerDown as EventListener);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('resize', measureOrb);
      cancelAnimationFrame(animationFrameId);
    };
  }, [panelRef]);
}
