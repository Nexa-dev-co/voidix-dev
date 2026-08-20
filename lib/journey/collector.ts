/**
 * The collector — the one thing on this site that records anything about a visit.
 *
 * ── ⚠ IT SUBSCRIBES; IT DOES NOT INSTRUMENT ────────────────────────────────────────────────────
 * Not one scene, section or component calls anything in this directory. The site narrates its whole
 * journey as CustomEvents, so this listens to what is already being said. A component that had to call
 * `track()` would be a component that could forget to, and would put an analytics import inside a
 * WebGL hook.
 *
 * ⚠ Seven of those events were ADDED for this (`STOP_COMMIT_EVENT`, `FAQ_ENTRY_OPEN_EVENT`,
 * `DRAWER_OPEN_EVENT`, the four `ENQUIRY_*`), and they are still domain events rather than analytics
 * calls: each says what the component did, in the component's own vocabulary, and carries only what
 * that component genuinely knows. Everything that turns one into a measurement — the dwell
 * subtraction, the origin of an enquiry, which carousel a stop belongs to — happens HERE. That
 * division is what keeps the principle true rather than nominally true.
 *
 * ── ⚠ NEVER THE PER-FRAME EVENTS ───────────────────────────────────────────────────────────────
 * `HANDOFF_PROGRESS_EVENT`, `CHAMBER_PROGRESS_EVENT`, `CONTACT_PROGRESS_EVENT` and
 * `HERO_SERVICES_PROGRESS_EVENT` all fire EVERY FRAME. Subscribing to any of them puts a listener
 * plus an allocation into a 30 fps budget with an emergency valve that already fires. Depth comes
 * from `SECTION_ARRIVE_EVENT`, which is discrete, and from a watermark — never from a progress value.
 *
 * ⚠ `onAssetProgress` is the ONE exception, and it is not one: it fires when a download reports, at
 * network pace, not at frame pace — and the handler below spends it on a comparison against three
 * watermarks, then unsubscribes the moment the loader hands over.
 *
 * ── ⚠ `pagehide` + `sendBeacon` IS THE WHOLE DROP-OFF MEASUREMENT ──────────────────────────────
 * Someone abandoning the loader closes the tab. A normal `fetch` is cancelled on unload, so the
 * visitors this feature exists to count are exactly the ones a naive implementation cannot see.
 * `pagehide` rather than `unload`, which iOS Safari does not reliably deliver.
 *
 * ── ⚠ A MODULE-LEVEL SINGLETON, BECAUSE STRICTMODE DOUBLE-MOUNTS ───────────────────────────────
 * `reactStrictMode: true` is on. Every effect runs twice in development, so a collector that
 * subscribed per mount would count everything twice and nobody would notice until the numbers were
 * compared with something real. `start()` is idempotent — the same shape `TelemetryConsole` uses.
 */

import { REVEAL_EVENT, LITE_TAKEN_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { DRAWER_OPEN_EVENT, readDrawerKey } from '@/components/ui/Drawer/drawerEvents';
import {
  ENQUIRY_ERROR_EVENT,
  ENQUIRY_OPEN_EVENT,
  ENQUIRY_START_EVENT,
  ENQUIRY_STEP_EVENT,
  ENQUIRY_SUBMIT_EVENT,
  readEnquiryErrorReason,
  readEnquiryStep,
  readEnquiryVariant,
} from '@/components/ui/EnquiryForm/enquiryEvents';
import { STOP_COMMIT_EVENT, readStopCommit } from '@/lib/sectionJumpEvents';
import { CURRENT_SECTION_EVENT, readCurrentSection } from '@/lib/currentSectionEvent';
import { FAQ_ENTRY_OPEN_EVENT, readFaqEntryIndex } from '@/lib/chamberEvents';
import { GOTO_SECTION_EVENT, readGotoSection } from '@/lib/sectionNavigation';
import { LOOP_ARRIVED_EVENT, LOOP_REVERSE_COVERED_EVENT } from '@/lib/loopEvents';
import { getAssetProgress, onAssetProgress } from '@/lib/assetLoadProgress';
import { getDeviceTier } from '@/lib/deviceTier';
import { PIXELS_ALLOCATED_EVENT, getPixelRatio, getSunPixelRatio } from '@/lib/adaptivePixelRatio';
import { isReducedMotion } from '@/lib/motionPreference';
import {
  JOURNEY_INTAKE_PATH,
  JOURNEY_MAX_BATCH_BYTES,
  JOURNEY_MAX_BATCH_EVENTS,
  JOURNEY_SCHEMA_VERSION,
  type CarouselKey,
  type CursorGrid,
  type CursorPath,
  type IntroDepth,
  type JourneyBatch,
  type JourneyEvent,
} from './events';
import { isJourneyConsentGranted, subscribeJourneyConsent } from './consent';
import { getVisitorId } from './visitorId';
import { getSessionId } from './session';
import { CursorTracker } from './cursor';

/** A quiet buffer is flushed anyway, so a visitor who stops moving is not lost until they leave. */
const IDLE_FLUSH_MS = 10_000;

/** The section the journey opens on, before anything has been arrived at. */
const FIRST_SECTION = 'hero';

/**
 * The homepage's sections IN ORDER, which is what makes `maxSection` a maximum rather than a last.
 *
 * ⚠ `loop` is deliberately absent, and it is not an oversight. It is a landing pad the pin passes
 * through to perform the teleport back to the top — arriving there IS the loop — so counting it as a
 * section reached would put a place nobody stands at the end of every completed circuit. `loop:taken`
 * already records that journey.
 *
 * ⚠ A section not in this list ranks -1, which is exactly right for a document route: `/about`'s
 * stations have no position in the homepage's journey, so `maxSection` stops advancing and stays the
 * route's own name. "This was an /about visit" is the honest answer there, and it falls out of the
 * comparison rather than needing a branch.
 */
const JOURNEY_ORDER: readonly string[] = ['hero', 'services', 'work', 'faq', 'contact'];

/**
 * ⚠ THE ONLY ROUTE WITH A LOADER. `IntroSequence` is mounted in `app/page.tsx` and nowhere else, so on
 * every other route the intro can never complete — see `hasIntro` for what that cost before it was
 * checked.
 */
const INTRO_ROUTE = '/';

/**
 * ⚠ QUARTERS, and only the three that mean anything. 0 is `intro:start` and 100 is `intro:complete`,
 * both of which are already events — a fourth watermark at 100 would be the same fact twice, counted
 * twice, in a funnel whose whole job is to compare the two.
 */
const INTRO_DEPTH_WATERMARKS: readonly IntroDepth[] = [25, 50, 75];

/** The two carousels a dwell is worth measuring on. The others are single-stop sections. */
const DWELL_CAROUSELS: readonly string[] = ['services', 'work'];

/** Below this a "dwell" is a stop being scrolled THROUGH, not looked at. */
const MIN_DWELL_MS = 250;

class JourneyCollector {
  private isRunning = false;
  private events: JourneyEvent[] = [];
  private grids: CursorGrid[] = [];
  private paths: CursorPath[] = [];

  private section = FIRST_SECTION;
  private maxSection = FIRST_SECTION;
  private startedAtMs = 0;
  private introStartedAtMs = 0;
  private isIntroComplete = false;

  /**
   * ⚠ WHETHER THIS VISIT HAS A LOADER AT ALL, and the reason it is a field rather than a check at the
   * point of use: it is the answer for the WHOLE visit, decided where the visit began. A client-side
   * navigation from `/` to `/about` does not retroactively mean the loader never happened.
   *
   * ⚠ Without it, `session:end` reported `duringIntro: true` for every visit to `/about`, `/careers`
   * and `/lite` — routes that have no `IntroSequence` and therefore no `REVEAL_EVENT` to complete one.
   * That is the drop-off figure this whole feature exists to produce, and document traffic was landing
   * in it as abandonment. It also inflated the panel's `introFunnel` denominator, which counts distinct
   * sessions carrying `intro:start`.
   *
   * ⚠ A route check rather than `INTRO_ACTIVE_EVENT`: that fires from a child effect during the page's
   * mount, and this collector is started from the LAYOUT, whose effects run after its children's. The
   * event is already gone by the time there is anything here to hear it.
   */
  private hasIntro = false;

  /** ⚠ Once per load. See `recordDeviceProfile` for why it cannot be sent at start. */
  private hasProfiled = false;

  private introDepthIndex = 0;
  private stopSinceMs = 0;
  private openStop: { carousel: CarouselKey; index: number } | null = null;

  private idleTimer = 0;
  private cursor: CursorTracker | null = null;
  private unsubscribeConsent: (() => void) | null = null;
  private unsubscribeAssetProgress: (() => void) | null = null;

  start(): void {
    if (this.isRunning || typeof window === 'undefined') return;
    // No session id means no `crypto`, which means nothing here can be recorded correctly. Staying
    // switched off is the honest answer; inventing an id is not.
    if (!getSessionId()) return;

    this.isRunning = true;
    this.startedAtMs = performance.now();
    this.introStartedAtMs = this.startedAtMs;
    this.hasIntro = this.route() === INTRO_ROUTE;
    this.section = this.initialSection();
    this.maxSection = this.section;

    this.cursor = new CursorTracker(
      (click) => this.record({ name: 'cursor:click', ...click }),
      (hover) => this.record({ name: 'cursor:hover', ...hover }),
    );
    this.cursor.start(this.route(), this.section, isJourneyConsentGranted());

    // Tier 2 can begin or end mid-visit, because the bar is answered mid-visit.
    this.unsubscribeConsent = subscribeJourneyConsent(() => {
      this.cursor?.setPathTracking(isJourneyConsentGranted());
    });

    this.subscribe();

    // ⚠ Only where there is one to start. See `hasIntro`.
    if (this.hasIntro) {
      this.record({ name: 'intro:start' });
      this.watchIntroDepth();
    }

    this.armIdleFlush();
  }

  private route(): string {
    // Path only — no query string, no hash. Nothing a visitor typed ends up in a route column.
    return window.location.pathname;
  }

  /**
   * What to call the section before anything has announced one.
   *
   * ⚠ NOT ALWAYS `hero`. Only `/` has a hero; on a document route the first thing the visitor sees is
   * the masthead, and defaulting to `hero` there filed `/about`'s cursor grid — and its whole opening
   * scroll — into the HOMEPAGE'S heatmap. Two routes' data in one picture, under a section name that
   * does not exist on either of them.
   */
  private initialSection(): string {
    const route = this.route();
    return route === INTRO_ROUTE ? FIRST_SECTION : route.replace(/^\//, '') || FIRST_SECTION;
  }

  private subscribe(): void {
    window.addEventListener(REVEAL_EVENT, this.onReveal);
    window.addEventListener(LITE_TAKEN_EVENT, this.onLiteTaken);
    window.addEventListener(CURRENT_SECTION_EVENT, this.onCurrentSection);
    window.addEventListener(STOP_COMMIT_EVENT, this.onStopCommit);
    window.addEventListener(FAQ_ENTRY_OPEN_EVENT, this.onFaqOpen);
    window.addEventListener(DRAWER_OPEN_EVENT, this.onDrawerOpen);
    window.addEventListener(ENQUIRY_OPEN_EVENT, this.onEnquiryOpen);
    window.addEventListener(ENQUIRY_START_EVENT, this.onEnquiryStart);
    window.addEventListener(ENQUIRY_STEP_EVENT, this.onEnquiryStep);
    window.addEventListener(ENQUIRY_SUBMIT_EVENT, this.onEnquirySubmit);
    window.addEventListener(ENQUIRY_ERROR_EVENT, this.onEnquiryError);
    window.addEventListener(GOTO_SECTION_EVENT, this.onNavJump);
    window.addEventListener(LOOP_ARRIVED_EVENT, this.onLoopForward);
    window.addEventListener(LOOP_REVERSE_COVERED_EVENT, this.onLoopReverse);
    window.addEventListener(PIXELS_ALLOCATED_EVENT, this.onPixelsAllocated);
    // ⚠ `visibilitychange` as well as `pagehide`: a tab switched away from on mobile may never fire
    // `pagehide` at all if the browser kills it in the background, so this is the earlier, safer net.
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /**
   * How far into the download somebody got before they left.
   *
   * ⚠ Watermarks, not samples. `assetLoadProgress` reports continuously and the index below only ever
   * moves forward, so three events is the most this can ever produce — against the hundreds a
   * per-update handler would buffer for a number nobody reads to that precision.
   */
  private watchIntroDepth(): void {
    this.unsubscribeAssetProgress = onAssetProgress(() => {
      const percent = getAssetProgress() * 100;
      while (
        this.introDepthIndex < INTRO_DEPTH_WATERMARKS.length &&
        percent >= INTRO_DEPTH_WATERMARKS[this.introDepthIndex]
      ) {
        this.record({ name: 'intro:depth', depth: INTRO_DEPTH_WATERMARKS[this.introDepthIndex] });
        this.introDepthIndex += 1;
      }
    });
  }

  private onReveal = (): void => {
    if (this.isIntroComplete) return;
    this.isIntroComplete = true;
    // Nothing further to watch, and the download's own listener set should not carry a dead entry for
    // the rest of the session.
    this.unsubscribeAssetProgress?.();
    this.unsubscribeAssetProgress = null;
    this.record({
      name: 'intro:complete',
      durationMs: Math.round(performance.now() - this.introStartedAtMs),
    });
  };

  private onLiteTaken = (): void => {
    this.record({ name: 'lite:taken' });
  };

  private onCurrentSection = (event: Event): void => {
    const key = readCurrentSection(event);
    if (key) this.enterSection(key);
  };

  /**
   * The visitor is now in a different section — on any route, however they got there.
   *
   * ⚠ ONE PATH FOR BOTH KINDS OF ROUTE. The pin's stage machine and the document routes' orbit rail
   * both publish `CURRENT_SECTION_EVENT`, so everything downstream — the arrival event, the depth
   * figure and which section a cursor summary is filed under — is decided in exactly one place and
   * cannot disagree between a scroll, a navbar jump and a document page.
   */
  private enterSection(key: string): void {
    if (key === this.section) return;

    // ⚠ The cursor summary belongs to the section being LEFT, so it is taken before the switch. It is
    // also the reason this must not be driven from a per-frame signal: each call closes a heatmap.
    this.flushCursorSection(key);
    this.section = key;

    // ⚠ A MAXIMUM, not the latest. Scrolling back up from contact to the fleet must not walk the
    // depth figure backwards — how far someone got is the question, and they got to contact.
    if (JOURNEY_ORDER.indexOf(key) > JOURNEY_ORDER.indexOf(this.maxSection)) this.maxSection = key;

    this.record({ name: 'section:arrive', section: key });

    // ⚠ SYNTHESISED, and it is honest rather than convenient. `ContactSection` renders `EnquiryForm`
    // directly instead of through `EnquiryPanel`, so its form is never "opened" — it is simply on
    // screen when you arrive. The panel's funnel divides every later step by `enquiry:open`, so
    // without this a contact submission is a step with no denominator and the funnel reads over 100 %.
    if (key === 'contact') {
      this.record({ name: 'enquiry:open', origin: 'contact', variant: 'enquiry' });
    }
  }

  /**
   * A craft or a project was committed.
   *
   * ⚠ THE DWELL IS EMITTED FOR THE STOP BEING LEFT, not the one arriving — a dwell is only knowable
   * once it is over. `commitStop` de-duplicates at source, so every dispatch is a real change.
   */
  private onStopCommit = (event: Event): void => {
    const detail = readStopCommit(event);
    if (!detail) return;

    this.closeStop();

    if (!DWELL_CAROUSELS.includes(detail.key)) return;
    this.openStop = { carousel: detail.key as CarouselKey, index: detail.index };
    this.stopSinceMs = performance.now();
  };

  private closeStop(): void {
    if (!this.openStop) return;
    const dwellMs = Math.round(performance.now() - this.stopSinceMs);
    const { carousel, index } = this.openStop;
    this.openStop = null;
    // A stop crossed on the way to another one is not a stop that was looked at.
    if (dwellMs < MIN_DWELL_MS) return;
    this.record({ name: 'stop:dwell', carousel, stopIndex: index, dwellMs });
  }

  private onFaqOpen = (event: Event): void => {
    const index = readFaqEntryIndex(event);
    if (index === null) return;
    this.record({ name: 'faq:open', entryIndex: index });
  };

  private onDrawerOpen = (event: Event): void => {
    // Three of the four sheets ARE their section, so the journey's own position is the right label.
    // `EnquiryPanel` is the exception and names itself — see `drawerEvents.ts`.
    this.record({ name: 'drawer:open', section: readDrawerKey(event) ?? this.section });
  };

  /**
   * Where an enquiry was opened FROM.
   *
   * ⚠ Derived here rather than passed in, so that none of the seven places rendering `EnquiryPanel`
   * has to carry a prop about analytics. On `/` the pin already publishes where the visitor is
   * standing; everywhere else the route is the answer and is more specific than the pin would be.
   */
  private enquiryOrigin(): string {
    const route = this.route();
    return route === INTRO_ROUTE ? this.section : route.replace(/^\//, '') || 'home';
  }

  private onEnquiryOpen = (event: Event): void => {
    this.record({
      name: 'enquiry:open',
      origin: this.enquiryOrigin(),
      variant: readEnquiryVariant(event),
    });
  };

  private onEnquiryStart = (event: Event): void => {
    this.record({ name: 'enquiry:start', variant: readEnquiryVariant(event) });
  };

  private onEnquiryStep = (event: Event): void => {
    const step = readEnquiryStep(event);
    if (step === null) return;
    this.record({ name: 'enquiry:step', step });
  };

  private onEnquirySubmit = (event: Event): void => {
    this.record({ name: 'enquiry:submit', variant: readEnquiryVariant(event) });
  };

  private onEnquiryError = (event: Event): void => {
    this.record({ name: 'enquiry:error', reason: readEnquiryErrorReason(event) });
  };

  private onNavJump = (event: Event): void => {
    const detail = readGotoSection(event);
    if (detail) this.record({ name: 'nav:jump', section: detail.key });
  };

  private onLoopForward = (): void => {
    this.record({ name: 'loop:taken', direction: 'forward' });
  };

  /**
   * ⚠ `LOOP_REVERSE_COVERED_EVENT`, not an arrival — the reverse loop has no arrival to listen for.
   * `LOOP_ARRIVED_EVENT` is dispatched from the FORWARD loop's cover handler and nowhere else, so
   * before this the `'reverse'` direction in the taxonomy was unreachable and the hero → contact
   * journey was invisible. The teleport happens synchronously inside this dispatch, which makes it
   * exactly the moment the reverse loop was taken.
   */
  private onLoopReverse = (): void => {
    this.record({ name: 'loop:taken', direction: 'reverse' });
  };

  private onPixelsAllocated = (): void => {
    this.recordDeviceProfile();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) this.flush(false);
  };

  private onPageHide = (): void => {
    this.closeStop();
    this.flushCursorSection(null);
    // ⚠ The fallback half of the profile. A visit that never allocated — a document route with no
    // WebGL, reduced motion, a burn-in that refused — still gets exactly one, and `hasProfiled` is
    // what keeps a visit that DID allocate from getting a second.
    this.recordDeviceProfile();
    this.record({
      name: 'session:end',
      maxSection: this.maxSection,
      durationMs: Math.round(performance.now() - this.startedAtMs),
      // ⚠ The headline number, and `hasIntro` is what makes it true. Without it every visit to a route
      // that has no loader reported itself as having been abandoned during one.
      duringIntro: this.hasIntro && !this.isIntroComplete,
    });
    this.flush(true);
  };

  /**
   * A client-side navigation.
   *
   * ⚠ The cursor summary is closed BEFORE the route changes, so it is filed against the route it was
   * actually gathered on. `CursorTracker` captures its route once at `start()` — events re-read
   * `location.pathname` per record, but a grid does not, so without this a `next/link` to `/about`
   * filed its heatmap under `/`.
   */
  noteRouteChange(pathname: string): void {
    if (!this.isRunning || !this.cursor) return;
    if (pathname === this.cursor.currentRoute()) return;

    this.closeStop();
    this.flushCursorSection(null);
    this.cursor.setRoute(pathname);

    // ⚠ Re-based, not carried over. The sections on the route just left do not exist on the one just
    // entered, so holding the old key would file the new page's first heatmap under the old page's
    // last section — the same mix-up `initialSection` exists to prevent on a cold load.
    this.section = this.initialSection();
  }

  private flushCursorSection(nextSection: string | null): void {
    const summary = this.cursor?.flushSection(nextSection, getVisitorId());
    if (!summary) return;
    if (summary.grid) this.grids.push(summary.grid);
    if (summary.path) this.paths.push(summary.path);
  }

  /**
   * ⚠ IT CANNOT BE RECORDED AT `start()`, WHICH IS WHERE IT USED TO BE. The collector starts on layout
   * mount; the allocator does not solve anything until the burn-in has run behind the loader. Before
   * that `getPixelRatio()` is 1 and `getSunPixelRatio()` returns the shared ratio, so every visitor on
   * every machine reported `modelRatio: 1, sunRatio: 1` — which looks exactly like a real allocation on
   * a weak machine, and made the one field this feature was best placed to answer uniformly wrong.
   *
   * So it waits for `PIXELS_ALLOCATED_EVENT`, with `pagehide` as the backstop for the visits where no
   * allocation ever happens.
   */
  private recordDeviceProfile(): void {
    if (this.hasProfiled) return;
    this.hasProfiled = true;

    this.record({
      name: 'device:profile',
      deviceTier: getDeviceTier(),
      modelRatio: Number(getPixelRatio().toFixed(3)),
      sunRatio: Number(getSunPixelRatio().toFixed(3)),
      devicePixelRatio: Number((window.devicePixelRatio || 1).toFixed(2)),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      reducedMotion: isReducedMotion(),
      coarsePointer: !CursorTracker.isSupported(),
    });
  }

  /**
   * ⚠ THE ONLY PLACE AN EVENT IS BUILT, so the tier and the visitor id are decided once.
   *
   * `visitorId` is spread in only when it exists — so a tier 1 event has no such KEY, rather than a
   * key holding undefined. `events.ts` explains why absent and null are not the same promise.
   */
  private record(partial: JourneyEventInput): void {
    const sessionId = getSessionId();
    if (!sessionId) return;

    const visitorId = getVisitorId();
    const event = {
      ...partial,
      occurredAt: Date.now(),
      sessionId,
      route: this.route(),
      tier: visitorId ? 2 : 1,
      ...(visitorId ? { visitorId } : {}),
    } as JourneyEvent;

    this.events.push(event);
    if (this.events.length >= JOURNEY_MAX_BATCH_EVENTS) this.flush(false);
  }

  private armIdleFlush(): void {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.flush(false);
      this.armIdleFlush();
    }, IDLE_FLUSH_MS);
  }

  private flush(isFinal: boolean): void {
    if (this.events.length === 0 && this.grids.length === 0 && this.paths.length === 0) return;

    const events = this.events;
    const grids = this.grids;
    const paths = this.paths;
    this.events = [];
    this.grids = [];
    this.paths = [];

    // ⚠ Taken once. Consent can be withdrawn mid-visit, and a path may only be sent while it holds —
    // `cursor.ts` drops what it has collected on withdrawal, but a path already handed over lives here.
    const maySendPaths = isJourneyConsentGranted();

    for (const body of serialiseBatches(events, grids, maySendPaths ? paths : [])) {
      this.send(body, isFinal);
    }
  }

  private send(body: string, isFinal: boolean): void {
    // ⚠ The final flush MUST be a beacon. See the header.
    if (isFinal && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(JOURNEY_INTAKE_PATH, new Blob([body], { type: 'application/json' }));
      return;
    }

    void fetch(JOURNEY_INTAKE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      // Analytics must never hold a navigation open or surface an error to a visitor.
      keepalive: true,
    }).catch(() => {
      // Deliberately silent. A visitor's experience does not degrade because a count was lost.
    });
  }
}

/**
 * ⚠ BYTES, NOT `String.length`. `length` counts UTF-16 code units, and the constant it is compared
 * against is named for bytes — anything non-ASCII in a batch (a `data-journey` label, a route) makes
 * the two disagree in the one direction that matters, by under-counting.
 */
function byteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}

/**
 * Split a flush into bodies that each fit under the cap.
 *
 * ── ⚠ IT SPLITS; IT DOES NOT MERELY SHED ───────────────────────────────────────────────────────
 * The previous version dropped `cursorPaths` when the body was too large and then sent whatever was
 * left regardless — so a full event buffer plus grids could still clear the cap, and `sendBeacon`
 * refuses an oversized body by returning **false, silently**. On `pagehide` that is the abandonment
 * this feature exists to measure, lost to the one failure mode the constant was written to prevent.
 *
 * ── ⚠ THE ORDER IS THE PRIORITY, AND IT IS DELIBERATE ──────────────────────────────────────────
 * Events first, then grids, then paths. A lost path costs a heatmap some detail; a lost grid costs a
 * heatmap; a lost `session:end` costs the drop-off figure entirely. So the cheapest thing to lose is
 * packed last and is the only thing allowed to be dropped outright.
 *
 * ⚠ Multiple beacons are queued rather than sent, and a user agent may cap the TOTAL queued. Two
 * bodies of 24 kB sit well inside the ~64 kB browsers advertise, and are in any case strictly better
 * than one body of 30 kB that is guaranteed to be refused.
 */
function serialiseBatches(
  events: JourneyEvent[],
  grids: CursorGrid[],
  paths: CursorPath[],
): string[] {
  const batches: JourneyBatch[] = [];

  const bodyOf = (batch: JourneyBatch): string =>
    JSON.stringify({
      schemaVersion: batch.schemaVersion,
      events: batch.events,
      // ⚠ Absent, not empty — the panel treats a present `cursorPaths` array as a tier 2 claim.
      ...(batch.cursorGrids?.length ? { cursorGrids: batch.cursorGrids } : {}),
      ...(batch.cursorPaths?.length ? { cursorPaths: batch.cursorPaths } : {}),
    });

  const isEmpty = (batch: JourneyBatch): boolean =>
    batch.events.length === 0 && !batch.cursorGrids?.length && !batch.cursorPaths?.length;

  const openBatch = (): JourneyBatch => {
    const batch: JourneyBatch = { schemaVersion: JOURNEY_SCHEMA_VERSION, events: [] };
    batches.push(batch);
    return batch;
  };

  /**
   * Put one item in the last batch, opening another if it no longer fits.
   *
   * `isDroppable` is what happens when an item does not fit even alone — true for a cursor payload,
   * which is detail, and false for an event, which may be the drop-off measurement itself.
   */
  const add = <T>(
    item: T,
    listOf: (batch: JourneyBatch) => T[],
    isDroppable: boolean,
  ): void => {
    const batch = batches.length > 0 ? batches[batches.length - 1] : openBatch();
    const wasEmpty = isEmpty(batch);
    const list = listOf(batch);

    list.push(item);
    if (byteLength(bodyOf(batch)) <= JOURNEY_MAX_BATCH_BYTES) return;
    list.pop();

    if (wasEmpty) {
      // A batch of its own would be no smaller, so this is as small as the item gets.
      // An event this large is not really possible — the taxonomy's widest is a few hundred bytes —
      // but sending it and letting the panel judge beats silently discarding a `session:end`.
      if (!isDroppable) list.push(item);
      return;
    }

    // ⚠ RECURSE, rather than pushing into the fresh batch. An item can be too large for a batch of
    // its OWN — a long cursor path is tens of kB — and pushing it here unconditionally would send a
    // body over the cap, which `sendBeacon` refuses silently. Going back through the top means the
    // now-empty batch takes the `wasEmpty` branch above and the item is judged on its own size.
    openBatch();
    add(item, listOf, isDroppable);
  };

  for (const event of events) add(event, (batch) => batch.events, false);
  for (const grid of grids) add(grid, (batch) => (batch.cursorGrids ??= []), true);
  for (const path of paths) add(path, (batch) => (batch.cursorPaths ??= []), true);

  // An item refused for being too large on its own can leave an empty batch behind it.
  return batches.filter((batch) => !isEmpty(batch)).map(bodyOf);
}

/** The base fields `record` fills in, so callers pass only what makes their event distinct. */
type BaseFields = {
  occurredAt: number;
  sessionId: string;
  visitorId?: string;
  tier: 1 | 2;
  route: string;
};

/**
 * ⚠ A PLAIN `Omit<JourneyEvent, keyof BaseFields>` DOES NOT WORK HERE, and it fails in a way that
 * looks like the taxonomy is wrong rather than the type.
 *
 * `Omit` is not distributive: handed a union it computes `keyof` across the whole thing, which is the
 * INTERSECTION of the members' keys — so every field that distinguishes one event from another
 * (`durationMs`, `section`, `direction`, `deviceTier`) vanishes, and every call site reports
 * "property does not exist" for exactly the property that makes it that event.
 *
 * The `T extends unknown` clause is what makes it distribute over the union instead, applying `Omit`
 * to each member and rebuilding the union from the results. It is not a redundant constraint.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type JourneyEventInput = DistributiveOmit<JourneyEvent, keyof BaseFields>;

const collector = new JourneyCollector();

/** Idempotent — see the header on StrictMode. */
export function startJourneyCollector(): void {
  collector.start();
}

/** The App Router moved to another route without a page load. See `noteRouteChange`. */
export function noteJourneyRouteChange(pathname: string): void {
  collector.noteRouteChange(pathname);
}
