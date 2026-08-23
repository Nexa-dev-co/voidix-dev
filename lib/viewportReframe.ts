/**
 * "The window is changing size" — as two signals, with one owner.
 *
 * ── Why this is not four private debounces ───────────────────────────────────────────────────────
 * Resizing this site is not one event, it is a burst of them: dragging a window edge fires `resize`
 * on nearly every frame, and everything expensive on the page reacts to it. `HeroSun` already had
 * this exact debounce written by hand (hide the star, wait for quiet, put it back), and the three
 * WebGL scenes each need the same shape for a much sharper reason — every one of their
 * `ResizeObserver` callbacks disposes and re-allocates a composer's ping-pong targets, which is tens
 * of megabytes apiece.
 *
 * So the burst is resolved once, here, and published. Nothing in this file touches GSAP, three or the
 * DOM: it REPORTS, it does not act.
 *
 * ── ⚠ IT DOES NOT DRIVE THE REFRESH — ITS CONSUMER DOES ─────────────────────────────────────────
 * The homepage's re-anchor rides on ScrollTrigger's `refresh` event rather than on the settle below,
 * because the thing that breaks the pin is a REFRESH, whatever caused it, and a font landing late
 * causes one too. Taking `autoRefreshEvents` away from GSAP to own the ordering here was considered
 * and rejected: it would mean re-implementing `ignoreMobileResize` against a different measurement,
 * on the one platform where getting it wrong costs a re-pin on every scroll.
 *
 * ⚠ But GSAP's own resize refresh CANNOT be relied on to arrive, and `useHeroAnimation` forces one on
 * the settle for that reason — see the long note at its `REFRAME_SETTLE_EVENT` listener. Short version:
 * `_refreshAll` defers itself while anything is still scrolling, and on a scrubbed pin driven by
 * `scrollTo` tweens that condition is nearly always true. The pin-spacer's width is written in pixels
 * and only during a refresh, so a missed one leaves the entire site rendering into a stale box.
 *
 * Consumers that need both should therefore treat SETTLE and ScrollTrigger's `refresh` as arriving in
 * an unspecified order and make their handler idempotent — `HeroSun` uses one function for both.
 */

/** The window has started changing size. Hide, freeze, stop measuring. */
export const REFRAME_BEGIN_EVENT = 'voidix:reframe-begin';

/** …and it has stopped. Re-place, re-size, come back. */
export const REFRAME_SETTLE_EVENT = 'voidix:reframe-settle';

/**
 * How long the window must be quiet before a resize counts as finished.
 *
 * Matched to GSAP's own `_resizeDelay` (0.2 s) on purpose. The two run independently and either may
 * land first, so keeping them level is what stops a consumer being told "everything is consistent
 * again" a visible beat before the pin has actually re-measured.
 */
export const REFRAME_SETTLE_MS = 200;

let watchers = 0;
let settleTimer = 0;
/** True between the first resize of a burst and the quiet that ends it. */
let bursting = false;
/** The size as of the last SETTLE — the baseline every test below is made against. */
let settledWidth = 0;
let settledHeight = 0;
let coarsePointerQuery: MediaQueryList | null = null;

/**
 * How far a WebGL canvas's CSS box may drift from the buffers behind it before the scene stops
 * waiting for the window to settle and re-sizes anyway.
 *
 * ── ⚠ WHY A SCENE WAITS AT ALL ──────────────────────────────────────────────────────────────────
 * Every `applyRendererSize` disposes and re-allocates a composer's ping-pong targets — tens of
 * megabytes apiece, twice per composer, and `useWorksField` has two composers. A `ResizeObserver`
 * fires about once a frame, so dragging a window edge for five seconds used to mean three hundred
 * reallocations. Waiting for the settle turns that into one.
 *
 * The price is that the image STRETCHES while the drag is under way: the buffers hold their old size
 * and the final quad scales them into the new box. That is the same trade `MAX_COMPOSITE_UPSCALE`
 * already makes deliberately, and for the length of a drag it reads as "the window is moving".
 *
 * ⚠ Past about a quarter it stops reading that way and starts reading as broken, which is what this
 * number is for. It is measured against the size the buffers were last ALLOCATED at, not against the
 * previous frame — so a slow drag accumulates toward it rather than sneaking under it forever.
 */
export const MAX_DEFERRED_STRETCH = 1.25;

/** False while the window is mid-burst — see `MAX_DEFERRED_STRETCH` for who asks and why. */
export function isViewportSettled(): boolean {
  return !bursting;
}

const settle = () => {
  settleTimer = 0;
  bursting = false;
  settledWidth = window.innerWidth;
  settledHeight = window.innerHeight;
  window.dispatchEvent(new Event(REFRAME_SETTLE_EVENT));
};

const beginBurst = () => {
  if (!bursting) {
    bursting = true;
    window.dispatchEvent(new Event(REFRAME_BEGIN_EVENT));
  }
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(settle, REFRAME_SETTLE_MS);
};

const onResize = () => {
  // ⚠ Mirrors ScrollTrigger's `ignoreMobileResize`, and for the same reason it exists there: a
  // phone's address bar sliding in and out fires a height-only `resize` on almost every scroll. Left
  // in, the star would blink and three composers would re-allocate once per scroll gesture.
  //
  // ⚠ Only the START of a burst is tested. Once a real drag is under way it reports plenty of
  // height-only frames in the middle of it, and dropping those would end the burst early.
  const widthChanged = window.innerWidth !== settledWidth;
  if (!bursting && !widthChanged && coarsePointerQuery?.matches) return;
  beginBurst();
};

const onVisibilityChange = () => {
  if (document.hidden) return;
  // ── ⚠ THE MINIMISED WINDOW ──
  // Minimising does not reliably fire `resize` — on Windows the page simply goes hidden and comes
  // back. It can come back a different size (restored onto another monitor, or the display scale
  // changed while it was down) having never fired one, so the size is checked by hand on the way in
  // rather than waited for.
  if (
    window.innerWidth === settledWidth &&
    window.innerHeight === settledHeight
  ) {
    return;
  }
  beginBurst();
};

/**
 * Start watching, and get back the stopper.
 *
 * Reference-counted, so every consumer calls it in its own effect and cleans up in its own teardown
 * without any of them having to be the designated owner. (It also makes StrictMode's
 * mount-unmount-mount harmless: the count goes 1 → 0 → 1 and the listeners are simply re-attached.)
 */
export function startViewportReframeWatch(): () => void {
  if (typeof window === 'undefined') return () => {};

  watchers += 1;
  if (watchers === 1) {
    settledWidth = window.innerWidth;
    settledHeight = window.innerHeight;
    coarsePointerQuery = window.matchMedia('(pointer: coarse)');
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    watchers -= 1;
    if (watchers > 0) return;
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.clearTimeout(settleTimer);
    settleTimer = 0;
    bursting = false;
    coarsePointerQuery = null;
  };
}
