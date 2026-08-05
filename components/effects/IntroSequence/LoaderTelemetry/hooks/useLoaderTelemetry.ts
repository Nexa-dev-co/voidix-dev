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
/**
 * How long the meter takes to glide to a newly reported progress value.
 *
 * ⚠ This is a CSS transition, not a per-frame ease, and the difference is the whole reason it changed.
 * Progress lands in jumps as each source finishes, so the bar has to interpolate — but it used to do so
 * in this hook's rAF loop, on the main thread, which is precisely the thread that the mark build and the
 * two shader compiles BLOCK. The one element on the loader whose job is to show that something is still
 * happening was freezing whenever something actually was. Handing the interpolation to the compositor
 * means it keeps gliding straight through a block. `.loader-dot`'s pulse always worked this way.
 *
 * Roughly matches the old exponential chase (2.4/s ≈ a 420ms time constant), so it reads the same.
 */
const METER_GLIDE_MS = 420;

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

    // ── The meter, driven by progress reports rather than by frames ──
    // Set on each report and left to the compositor to interpolate. A reduced-motion visitor gets the
    // value with no glide at all — a progress bar is information, so it still moves, it just doesn't
    // animate.
    if (meterFill) {
      meterFill.style.transition = quiet ? 'none' : `transform ${METER_GLIDE_MS}ms linear`;
    }
    const paintMeter = () => {
      if (meterFill) meterFill.style.transform = `scaleX(${getAssetProgress()})`;
    };
    paintMeter();

    // ── Throughput, differentiated from real progress ──
    let lastSampleSeconds = performance.now() / 1000;
    let lastSampleProgress = getAssetProgress();
    let smoothedMegabytesPerSecond = 0;
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

    // Only the throttled text readouts run per frame now; the meter is driven by progress reports.
    let animationFrame = 0;
    const tick = () => {
      animationFrame = requestAnimationFrame(tick);
      const nowMs = performance.now();
      const progress = getAssetProgress();

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

    // The meter's only driver. Also repaints the rows: progress can land while the tab is backgrounded
    // and rAF is paused, so the panel would otherwise show a stale state when the user comes back.
    const stopListening = onAssetProgress(() => {
      paintMeter();
      paintRows(performance.now());
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      stopListening();
      window.removeEventListener(SUN_ASSEMBLE_EVENT, onShellStart);
      window.removeEventListener(SUN_ASSEMBLED_EVENT, onShellDone);
    };
  }, [rootRef]);
}
