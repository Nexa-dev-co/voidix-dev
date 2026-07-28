'use client';

import { useEffect, type RefObject } from 'react';
import {
  getAssetProgress,
  getSourceProgress,
  onAssetProgress,
  type AssetSource,
} from '@/lib/assetLoadProgress';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { SUN_ASSEMBLE_EVENT, SUN_ASSEMBLED_EVENT } from '../../introEvents';
import {
  MODULE_STATES,
  READOUT_INTERVAL_MS,
  SCRAMBLE_GLYPHS,
  SCRAMBLE_MS,
  THROUGHPUT_IDLE_FLOOR_MBPS,
  THROUGHPUT_SMOOTHING_PER_SECOND,
  TOTAL_PAYLOAD_BYTES,
  type ModuleFeed,
  type ModuleState,
} from '../loaderModules';

// Drives the loader's live readout from real load progress.
//
// WHY IT WRITES THE DOM DIRECTLY
// No React state anywhere in here. IntroSequence animates this chrome's opacity with GSAP, and a
// re-render would re-apply the JSX inline styles over the top of it — the same trap that comment in
// IntroSequence warns about for the wordmark. Values go straight onto text nodes and transforms instead,
// so the panel can update sixty times a second and never touch React.

const BYTES_PER_MEGABYTE = 1024 * 1024;
/** How fast the meter chases real progress. Progress lands in jumps as each source finishes. */
const METER_EASE_PER_SECOND = 2.4;
const MAX_FRAME_SECONDS = 0.05;

/** The sun is not one of the tracked asset sources, so its row is driven by its own two events. */
type ShellPhase = 'dormant' | 'forming' | 'online';

interface Row {
  feed: ModuleFeed;
  /** The row itself carries the state class, so CSS can dress the dot and the word together. */
  element: HTMLElement;
  stateElement: HTMLElement | null;
  valueElement: HTMLElement | null;
  /** What the row currently says, so a change can be detected and scrambled. */
  shownState: ModuleState | null;
  scrambleEndsAt: number;
}

const randomGlyph = () =>
  SCRAMBLE_GLYPHS.charAt(Math.floor(Math.random() * SCRAMBLE_GLYPHS.length));

/** Same length as the real word, so a scrambling row never changes width and nothing reflows. */
const scrambleOf = (word: string) =>
  word
    .split('')
    .map((character) => (character === ' ' ? ' ' : randomGlyph()))
    .join('');

export function useLoaderTelemetry(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const quiet = prefersReducedMotion();

    const rows: Row[] = Array.from(
      root.querySelectorAll<HTMLElement>('[data-feed]'),
    ).map((element) => ({
      feed: element.dataset.feed as ModuleFeed,
      element,
      stateElement: element.querySelector<HTMLElement>('[data-role="state"]'),
      valueElement: element.querySelector<HTMLElement>('[data-role="value"]'),
      shownState: null,
      scrambleEndsAt: 0,
    }));

    const meterFill = root.querySelector<HTMLElement>('[data-role="meter-fill"]');
    const throughputElement = root.querySelector<HTMLElement>('[data-role="throughput"]');

    // ── The sun's row, fed by the assembly rather than by a download ──
    let shellPhase: ShellPhase = 'dormant';
    let shellStartedMs = 0;
    let shellSeconds = 0;
    const onShellStart = () => {
      shellPhase = 'forming';
      shellStartedMs = performance.now();
    };
    const onShellDone = () => {
      shellPhase = 'online';
      shellSeconds = (performance.now() - shellStartedMs) / 1000;
    };
    window.addEventListener(SUN_ASSEMBLE_EVENT, onShellStart);
    window.addEventListener(SUN_ASSEMBLED_EVENT, onShellDone);

    // ── Throughput, differentiated from real progress ──
    let lastSampleSeconds = performance.now() / 1000;
    let lastSampleProgress = getAssetProgress();
    let smoothedMegabytesPerSecond = 0;
    let easedProgress = getAssetProgress();
    let lastPaintMs = 0;

    const stateFor = (feed: ModuleFeed): ModuleState => {
      if (feed === 'shell') {
        if (shellPhase === 'online') return MODULE_STATES.online;
        return shellPhase === 'forming' ? MODULE_STATES.forming : MODULE_STATES.dormant;
      }
      const progress =
        feed === 'combined' ? getAssetProgress() : getSourceProgress(feed as AssetSource);
      if (progress >= 1) return MODULE_STATES.online;
      return progress > 0 ? MODULE_STATES.streaming : MODULE_STATES.queued;
    };

    const valueFor = (feed: ModuleFeed): string => {
      if (feed === 'shell') {
        if (shellPhase === 'dormant') return '--';
        const seconds =
          shellPhase === 'online' ? shellSeconds : (performance.now() - shellStartedMs) / 1000;
        return `${seconds.toFixed(1)}s`;
      }
      const progress =
        feed === 'combined' ? getAssetProgress() : getSourceProgress(feed as AssetSource);
      return `${Math.round(progress * 100)}%`;
    };

    const paintRows = (nowMs: number) => {
      rows.forEach((row) => {
        const nextState = stateFor(row.feed);
        if (nextState !== row.shownState) {
          row.shownState = nextState;
          row.scrambleEndsAt = quiet ? 0 : nowMs + SCRAMBLE_MS;
          // Streaming and forming are the "something is happening" states — the dot breathes on those.
          const active =
            nextState === MODULE_STATES.streaming || nextState === MODULE_STATES.forming;
          row.element.classList.toggle('is-active', active);
          row.element.classList.toggle('is-online', nextState === MODULE_STATES.online);
        }
        if (row.stateElement) {
          row.stateElement.textContent =
            nowMs < row.scrambleEndsAt ? scrambleOf(nextState) : nextState;
        }
        if (row.valueElement) row.valueElement.textContent = valueFor(row.feed);
      });
    };

    let animationFrame = 0;
    let lastFrameMs = performance.now();
    const tick = () => {
      animationFrame = requestAnimationFrame(tick);
      const nowMs = performance.now();
      const delta = Math.min((nowMs - lastFrameMs) / 1000, MAX_FRAME_SECONDS);
      lastFrameMs = nowMs;

      // The meter runs every frame — it is one transform, and a stepped bar would undo the point of it.
      const progress = getAssetProgress();
      easedProgress += (progress - easedProgress) * Math.min(1, METER_EASE_PER_SECOND * delta);
      if (meterFill) meterFill.style.transform = `scaleX(${easedProgress})`;

      // Text repaints are throttled: they cost layout, and past a few times a second nobody can read them
      // anyway. A scrambling row is exempt, or the shuffle would be a stutter instead of a blur.
      const scrambling = rows.some((row) => nowMs < row.scrambleEndsAt);
      if (scrambling || nowMs - lastPaintMs >= READOUT_INTERVAL_MS) {
        lastPaintMs = nowMs;
        paintRows(nowMs);

        const sampleSeconds = nowMs / 1000;
        const sampleDelta = sampleSeconds - lastSampleSeconds;
        if (sampleDelta > 0) {
          const megabytes =
            ((progress - lastSampleProgress) * TOTAL_PAYLOAD_BYTES) / BYTES_PER_MEGABYTE;
          const rate = megabytes / sampleDelta;
          smoothedMegabytesPerSecond +=
            (rate - smoothedMegabytesPerSecond) *
            Math.min(1, THROUGHPUT_SMOOTHING_PER_SECOND * sampleDelta);
          lastSampleSeconds = sampleSeconds;
          lastSampleProgress = progress;
        }
        if (throughputElement) {
          const shown = Math.max(smoothedMegabytesPerSecond, THROUGHPUT_IDLE_FLOOR_MBPS);
          throughputElement.textContent = `${shown.toFixed(2)} MB/S`;
        }
      }
    };
    tick();

    // Progress can land while the tab is backgrounded and rAF is paused; repaint on the next report so
    // the panel is never showing a stale state when the user comes back.
    const stopListening = onAssetProgress(() => paintRows(performance.now()));

    return () => {
      cancelAnimationFrame(animationFrame);
      stopListening();
      window.removeEventListener(SUN_ASSEMBLE_EVENT, onShellStart);
      window.removeEventListener(SUN_ASSEMBLED_EVENT, onShellDone);
    };
  }, [rootRef]);
}
