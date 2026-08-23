/**
 * Where the cursor went — accumulated in the browser, summarised per section.
 *
 * ── ⚠ THE LISTENER DOES NOTHING BUT RECORD. THIS IS THE HOUSE RULE, NOT A PREFERENCE ────────────
 * `useCoreTelemetry` states it outright: *the listener only records — all math waits for the frame,
 * so pointermove stays O(1)*. There are already FIVE pointermove listeners on this site (the fluid
 * cursor, two HUD instruments, the deck's drag and the works field's drag-to-look) and this is the
 * sixth. `pointermove` fires at 60–120 Hz, so anything done inside the handler is done a hundred
 * times a second on a page with a measured 30 fps budget and an emergency valve that already fires.
 * The handler below assigns two numbers. Everything else happens on a frame we were having anyway.
 *
 * ── ⚠ MOVEMENT IS NEVER AN EVENT ───────────────────────────────────────────────────────────────
 * One row per sample would be ~600 rows a minute per visitor against an events table holding fifteen
 * rows for a whole visit. Instead a sparse grid accumulates in memory and ONE summary is emitted when
 * the section changes or the visit ends. `events.ts` has the arithmetic.
 *
 * ── ⚠ NOTHING HERE RUNS ON A TOUCH DEVICE ──────────────────────────────────────────────────────
 * A phone has no cursor, and its `pointermove` is a drag that the deck and the works field already
 * own — recording it would produce a "heatmap" of where people swipe, which is not the same question
 * and would quietly pollute the desktop figures it got averaged into.
 */

import { NARROW_QUERY } from '@/lib/hooks/useIsNarrowViewport';
import {
  CURSOR_GRID_COLUMNS,
  CURSOR_GRID_ROWS,
  CURSOR_GRID_SAMPLE_HZ,
  CURSOR_PATH_SAMPLE_HZ,
  type CursorGrid,
  type CursorPath,
} from './events';

/** Below this, a hover is a cursor passing over something rather than looking at it. */
const HOVER_MIN_DWELL_MS = 400;

/** Three clicks inside this radius and window is somebody telling you something is broken. */
const RAGE_CLICK_COUNT = 3;
const RAGE_CLICK_WINDOW_MS = 1000;
const RAGE_CLICK_RADIUS_PX = 40;

/**
 * ⚠ A path is capped so one idle tab cannot grow an unbounded array. At 20 Hz this is a little over
 * four minutes in a single section, which is far beyond any real dwell — and if it is ever hit, the
 * shape of the path is long since established.
 */
const PATH_MAX_POINTS = 5000;

/** Positions are stored per-thousand of the viewport, so a path means the same on any monitor. */
const POSITION_SCALE = 1000;

/**
 * The most one sample tick may contribute to a section's observed time.
 *
 * ⚠ TWO SAMPLE INTERVALS, so a normal tick counts in full and a RESUMPTION counts once. The gap
 * between two samples is unbounded — a hidden tab, a pointer that left the window, a machine asleep
 * — and without this clamp the first sample after an hour away would book the whole hour as time
 * somebody spent looking at the section.
 */
const MAX_OBSERVED_GAP_MS = Math.round((1000 / CURSOR_GRID_SAMPLE_HZ) * 2);

export interface CursorClick {
  cell: number;
  target: string;
  isDead: boolean;
  isRage: boolean;
}

export interface CursorHover {
  target: string;
  dwellMs: number;
}

/** What the collector receives when a section ends. Either half may be empty. */
export interface CursorSectionSummary {
  grid: CursorGrid | null;
  path: CursorPath | null;
}

interface RecentClick {
  x: number;
  y: number;
  at: number;
}

/**
 * ⚠ Identifies an element WITHOUT reading its text. A `data-journey` attribute if the element opts in,
 * otherwise a coarse structural description — never `textContent`, which on a form field is whatever
 * the visitor typed and is the one thing the journey layer must never carry.
 */
function describeTarget(element: Element | null): string {
  if (!element) return 'none';

  const opted = element.closest('[data-journey]')?.getAttribute('data-journey');
  if (opted) return opted.slice(0, 48);

  const interactive = element.closest('a, button, [role="button"], input, textarea, select');
  if (!interactive) return 'surface';

  const tag = interactive.tagName.toLowerCase();
  // A class is authored by us and is safe; an id or a value is not necessarily.
  const firstClass = interactive.classList.item(0);
  return firstClass ? `${tag}.${firstClass}`.slice(0, 48) : tag;
}

/**
 * The shape of the screen a grid was gathered on — v4.
 *
 * ⚠ READ AT FLUSH TIME, which is the one imprecision here and it is deliberate. A grid accumulates
 * across a whole section, so a visitor who drags their window across the layout breakpoint mid-section
 * produces cells from two layouts filed under whichever one they finished in. Closing the grid on a
 * resize would be exact, and it is not worth a `matchMedia` listener plus a second flush path for a
 * gesture nobody performs while a scroll-pinned scene is playing. If it ever matters, the fix is to
 * flush on the media query changing — not to average the two.
 *
 * ⚠ `matchMedia` rather than `innerWidth > 820`. See `NARROW_QUERY` — the layout's breakpoint is in
 * `em` and moves with the visitor's root font size, so only the browser can answer it correctly.
 */
function readViewportShape(): Pick<
  CursorGrid,
  'viewportWidth' | 'viewportHeight' | 'isNarrowLayout'
> {
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    // The tracker only ever runs in a browser with a fine pointer, so `matchMedia` exists by the time
    // anything here is reachable — `isSupported` has already required it.
    isNarrowLayout: window.matchMedia(NARROW_QUERY).matches,
  };
}

/** True when a click landed on nothing that could respond to it. */
function isDeadTarget(element: Element | null): boolean {
  if (!element) return true;
  return !element.closest('a, button, [role="button"], input, textarea, select, label, summary');
}

export class CursorTracker {
  /** Only ever written by the pointer handler, only ever read on a frame. */
  private pointerX = 0;
  private pointerY = 0;
  private hasPointer = false;

  private section = 'hero';
  private route = '/';

  private cells = new Map<number, number>();
  /**
   * ⚠ ACTIVE time in the current section, accumulated per sample — NOT `now - start`.
   *
   * See the accumulation in `sample()` for the measurement this replaced and why it was wrong. The
   * honest sentence for this number is "how long the cursor was actually being watched here", which
   * is what the panel now labels it.
   */
  private observedMs = 0;

  private pathPoints: number[] = [];
  /** Rate limiting — when the path was last *considered* for a sample. */
  private pathLastSampleMs = 0;
  /**
   * ⚠ Not the same number as above, despite tracking it closely. This is the timestamp of the last
   * point actually WRITTEN, and it is the base every delta is measured from. They diverge the moment
   * `samplePath` declines to record — at the point cap, or before the first point exists — and a
   * single field serving both would silently encode a delta against a point that was never stored.
   */
  private pathLastPointAtMs = 0;
  private pathLastX = 0;
  private pathLastY = 0;
  private pathHasFirstPoint = false;

  private gridLastSampleMs = 0;

  private hoverTarget: string | null = null;
  private hoverSinceMs = 0;

  private recentClicks: RecentClick[] = [];

  private isTrackingPaths = false;
  private isRunning = false;
  private frameHandle = 0;

  constructor(
    private readonly onClick: (click: CursorClick) => void,
    private readonly onHover: (hover: CursorHover) => void,
  ) {}

  /**
   * ⚠ Refuses on a coarse pointer, which is the same question `useIsLowPowerViewport` asks before
   * unmounting the hero's cursor effects. Mirrored rather than imported: that hook is a React hook
   * and this is not a component.
   */
  static isSupported(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: fine)').matches;
  }

  start(route: string, section: string, isTrackingPaths: boolean): void {
    if (this.isRunning || !CursorTracker.isSupported()) return;

    this.isRunning = true;
    this.route = route;
    this.section = section;
    this.isTrackingPaths = isTrackingPaths;
    // ⚠ Primed, not left at 0 — otherwise the first sample's gap is measured from the epoch and
    // the clamp is the only thing standing between that and an absurd observed time.
    this.gridLastSampleMs = performance.now();
    this.observedMs = 0;

    // ⚠ `passive` because this handler never calls preventDefault, and saying so lets the browser
    // stop waiting to find out — which on a scroll-driven site is the difference between a smooth
    // gesture and a stuttering one.
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    window.addEventListener('pointerdown', this.handlePointerDown, { passive: true });
    this.frameHandle = requestAnimationFrame(this.sample);
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerdown', this.handlePointerDown);
    cancelAnimationFrame(this.frameHandle);
  }

  /** Tier 2 can begin or end mid-visit, because the bar is answered mid-visit. */
  setPathTracking(isTrackingPaths: boolean): void {
    if (this.isTrackingPaths === isTrackingPaths) return;
    this.isTrackingPaths = isTrackingPaths;
    // Starting: begin a fresh path here rather than pretending to have watched the earlier part.
    // Stopping: drop what was collected — consent was withdrawn, so it may not be sent.
    this.pathPoints = [];
    this.pathHasFirstPoint = false;
  }

  /** ⚠ The ONLY handler on the hot path. Two assignments, nothing else. */
  private handlePointerMove = (event: PointerEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.hasPointer = true;
  };

  private handlePointerDown = (event: PointerEvent): void => {
    // ⚠ `pointerdown` rather than `click`, because a click that lands on nothing interactive may
    // never produce a `click` event that reaches window in the first place — and a dead click is one
    // of the two things this is here to catch.
    if (event.pointerType !== 'mouse') return;

    const element = document.elementFromPoint(event.clientX, event.clientY);
    const now = performance.now();

    this.recentClicks = this.recentClicks.filter((click) => now - click.at < RAGE_CLICK_WINDOW_MS);
    this.recentClicks.push({ x: event.clientX, y: event.clientY, at: now });

    const nearby = this.recentClicks.filter(
      (click) =>
        Math.hypot(click.x - event.clientX, click.y - event.clientY) < RAGE_CLICK_RADIUS_PX,
    );

    this.onClick({
      cell: this.cellFor(event.clientX, event.clientY),
      target: describeTarget(element),
      isDead: isDeadTarget(element),
      isRage: nearby.length >= RAGE_CLICK_COUNT,
    });
  };

  private cellFor(x: number, y: number): number {
    const column = Math.min(
      CURSOR_GRID_COLUMNS - 1,
      Math.max(0, Math.floor((x / window.innerWidth) * CURSOR_GRID_COLUMNS)),
    );
    const row = Math.min(
      CURSOR_GRID_ROWS - 1,
      Math.max(0, Math.floor((y / window.innerHeight) * CURSOR_GRID_ROWS)),
    );
    return row * CURSOR_GRID_COLUMNS + column;
  }

  /**
   * The frame. Everything the pointer handler refused to do happens here, at a rate well below the
   * frame rate — a heatmap wants where the cursor lingers, not every pixel it crossed.
   */
  private sample = (): void => {
    this.frameHandle = requestAnimationFrame(this.sample);
    if (!this.hasPointer || document.hidden) return;

    const now = performance.now();

    if (now - this.gridLastSampleMs >= 1000 / CURSOR_GRID_SAMPLE_HZ) {
      /**
       * ⚠ OBSERVED TIME IS ACCUMULATED HERE, ONE CLAMPED TICK AT A TIME — it is NOT the wall clock.
       *
       * It used to be `now - observedFromMs` at flush, which counted every second the section was
       * open whether or not anyone was there. Measured on real data: 6,292 s of "cursor watched"
       * against 341 s of actual cursor movement — 95 % of it idle, and the three worst grids were
       * 98–99 % idle tabs left open. The loader's whole wait landed in it too, because the collector
       * starts at layout mount while the section is still `hero`.
       *
       * This line runs only when a sample is actually taken, which already requires a pointer to
       * have been seen and the tab to be visible. The clamp is what makes a resumption cheap: coming
       * back to a tab after an hour adds one tick, not an hour.
       */
      this.observedMs += Math.min(now - this.gridLastSampleMs, MAX_OBSERVED_GAP_MS);
      this.gridLastSampleMs = now;
      const cell = this.cellFor(this.pointerX, this.pointerY);
      this.cells.set(cell, (this.cells.get(cell) ?? 0) + 1);
      this.sampleHover(now);
    }

    if (this.isTrackingPaths && now - this.pathLastSampleMs >= 1000 / CURSOR_PATH_SAMPLE_HZ) {
      this.pathLastSampleMs = now;
      this.samplePath(now);
    }
  };

  private sampleHover(now: number): void {
    const element = document.elementFromPoint(this.pointerX, this.pointerY);
    const target = describeTarget(element);

    if (target === this.hoverTarget) return;

    // Emitted on LEAVE, so the dwell is a completed fact rather than a running total.
    if (this.hoverTarget && this.hoverTarget !== 'surface' && this.hoverTarget !== 'none') {
      const dwellMs = Math.round(now - this.hoverSinceMs);
      if (dwellMs >= HOVER_MIN_DWELL_MS) this.onHover({ target: this.hoverTarget, dwellMs });
    }

    this.hoverTarget = target;
    this.hoverSinceMs = now;
  }

  private samplePath(now: number): void {
    if (this.pathPoints.length >= PATH_MAX_POINTS * 3) return;

    const x = Math.round((this.pointerX / window.innerWidth) * POSITION_SCALE);
    const y = Math.round((this.pointerY / window.innerHeight) * POSITION_SCALE);

    if (!this.pathHasFirstPoint) {
      // Absolute for the first point only; everything after it is a delta.
      this.pathPoints.push(Math.round(now), x, y);
      this.pathHasFirstPoint = true;
    } else {
      this.pathPoints.push(
        Math.round(now - this.pathLastPointAtMs),
        x - this.pathLastX,
        y - this.pathLastY,
      );
    }

    this.pathLastPointAtMs = now;
    this.pathLastX = x;
    this.pathLastY = y;
  }

  /**
   * Close the current section and hand back its summary, then begin the next.
   *
   * ⚠ Called on section change AND on `pagehide`, which is why it resets rather than merely reading:
   * a summary that could be emitted twice would double every heatmap it landed in.
   */
  flushSection(nextSection: string | null, visitorId: string | undefined): CursorSectionSummary {
    const now = performance.now();
    const observedMs = Math.round(this.observedMs);

    const grid: CursorGrid | null =
      this.cells.size === 0
        ? null
        : {
            route: this.route,
            section: this.section,
            cells: Object.fromEntries(this.cells),
            observedMs,
            ...readViewportShape(),
          };

    // ⚠ The visitor id is checked HERE as well as by the caller. A path without one cannot be
    // stored — the column is NOT NULL precisely so that a path nobody consented to is unrepresentable
    // — so building one would produce a payload the panel must reject.
    const path: CursorPath | null =
      !this.isTrackingPaths || !visitorId || this.pathPoints.length === 0
        ? null
        : {
            route: this.route,
            section: this.section,
            points: this.pathPoints,
            sampleHz: CURSOR_PATH_SAMPLE_HZ,
          };

    this.cells = new Map();
    this.pathPoints = [];
    this.pathHasFirstPoint = false;
    this.observedMs = 0;
    // The next section's first sample measures its gap from here, not from the old section's tick.
    this.gridLastSampleMs = now;
    if (nextSection) this.section = nextSection;

    return { grid, path };
  }

  /** What the open grid and path will be filed under. See `noteRouteChange` in the collector. */
  currentRoute(): string {
    return this.route;
  }

  /**
   * Re-file the OPEN grid under a different section, WITHOUT closing it.
   *
   * ── ⚠ THIS IS A CORRECTION, NOT A TRANSITION, AND THE DIFFERENCE IS WHY IT MUST NOT FLUSH ─────
   * `flushSection` closes the current picture and starts a new one, which is right when the visitor
   * genuinely moved. This is for when they did not: the pin's stage said `contact` while the visitor
   * was demonstrably still in the chamber, so the cells gathered since that stage change were
   * gathered in the FAQ and belong to the FAQ. Flushing here would file them under the wrong section
   * and then start a second wrong picture; relabelling puts them where they were actually collected.
   *
   * ⚠ It follows that this may only be called by something that PROVES the location — see
   * `confirmSection` in the collector. Calling it on a guess would silently move real cells.
   */
  relabelSection(section: string): void {
    this.section = section;
  }

  /** What the open grid would currently be filed under. */
  currentSection(): string {
    return this.section;
  }

  setRoute(route: string): void {
    this.route = route;
  }
}
