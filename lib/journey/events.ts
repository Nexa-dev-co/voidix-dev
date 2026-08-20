/**
 * The journey event taxonomy — what this site is allowed to record, as types.
 *
 * ── ⚠ THIS IS NOT CALLED TELEMETRY, AND THE DISTINCTION IS LOAD-BEARING ─────────────────────────
 * `lib/telemetryEnabled.ts`, `TelemetryConsole`, `LoaderTelemetry` and `cacheTelemetry` are DIAGNOSTIC
 * instruments: they run in development and on preview deploys, they print to a console, and they are
 * folded out of a production bundle at build time. This is the opposite in every respect — it runs in
 * production, for visitors, and sends data to a server. Four existing things already own the word
 * "telemetry" here, so nothing in this directory may use it.
 *
 * ── ⚠ THE TWO TIERS ARE A PROPERTY OF THE PAYLOAD, NOT TWO SYSTEMS ──────────────────────────────
 * Tier 1 is everyone: no identifier of any kind, no device storage, nothing that could single a
 * person out. Tier 2 begins only once a visitor has said yes, and adds exactly one thing — a
 * `visitorId` that survives between visits.
 *
 * ⚠ On a tier 1 event `visitorId` is ABSENT, not `null` and not an empty string. That is the whole
 * guarantee: a tier 1 row is structurally incapable of being joined to a person, rather than merely
 * being one `UPDATE` away from it. Anything that "helpfully" defaults it to a placeholder has broken
 * the promise the privacy notice makes.
 *
 * ⚠ `sessionId` is NOT an exception to that. It is generated per tab, held in memory, never written
 * to storage and gone when the tab closes — so it stitches one visit's events together and cannot
 * recognise anybody. Two visits from the same person share nothing at tier 1.
 *
 * ── ⚠ MIRRORED IN `voidix-cms`, AND NOTHING ENFORCES IT ─────────────────────────────────────────
 * The panel's intake validates against its own copy of these shapes. Two repos, one JSON document, no
 * shared package — exactly the hazard `lib/cms/publishedContent.ts` documents, with the same failure
 * mode: rename a field on one side only and it compiles on both, arrives `undefined`, and the event
 * is quietly stored with a hole in it. **Change one, change the other in the same sitting**, and bump
 * `JOURNEY_SCHEMA_VERSION` so the panel can say so out loud rather than guessing.
 */

/**
 * Bumped whenever a field is added, removed or given a new meaning.
 *
 * The panel rejects a batch it does not recognise rather than storing something it half-understands —
 * a partially-parsed analytics row is worse than a dropped one, because it looks like data.
 */
export const JOURNEY_SCHEMA_VERSION = 2;

/**
 * Which consent tier an event was recorded under.
 *
 * Stored on every row rather than inferred from `visitorId` being present, because "no visitor id"
 * and "tier 1" must be independently checkable. If they ever disagree, that is a bug worth being able
 * to see in a query.
 */
export type ConsentTier = 1 | 2;

/**
 * Every event this site may record. Adding one here is the only way to add one at all — the collector
 * has no generic `track(name)` escape hatch, deliberately, so the set of things being recorded is
 * always readable in a single file and can be pasted into the privacy notice without an audit.
 */
export type JourneyEventName =
  /* ── The loader. The reason this feature exists. ───────────────────────────────────────────── */
  | 'intro:start'
  | 'intro:depth'
  | 'intro:complete'
  | 'lite:taken'
  /* ── The journey itself. ───────────────────────────────────────────────────────────────────── */
  | 'section:arrive'
  | 'stop:dwell'
  | 'faq:open'
  | 'drawer:open'
  | 'nav:jump'
  | 'loop:taken'
  /* ── The contact funnel. ───────────────────────────────────────────────────────────────────── */
  | 'enquiry:open'
  | 'enquiry:start'
  | 'enquiry:step'
  | 'enquiry:submit'
  | 'enquiry:error'
  /* ── The cursor. Discrete only — movement does NOT come through here, see `CursorGrid`. ────── */
  | 'cursor:click'
  | 'cursor:hover'
  /* ── Once per load, and once per visit. ────────────────────────────────────────────────────── */
  | 'device:profile'
  | 'session:end';

/** What every event carries, whatever it is. */
interface JourneyEventBase {
  name: JourneyEventName;
  /**
   * ⚠ Captured WHEN IT HAPPENED, not when it was flushed. Events are buffered and can sit for ten
   * seconds or until the tab closes, so stamping at send time would compress a whole visit into one
   * instant and make every dwell and ordering measurement meaningless.
   */
  occurredAt: number;
  /** Per-tab, in memory only. See the header — this is not an identifier. */
  sessionId: string;
  /** ⚠ ABSENT at tier 1. Never null, never a placeholder. */
  visitorId?: string;
  tier: ConsentTier;
  /** The route it happened on — `/`, `/lite`, `/about`. Not the full URL: no query, no hash. */
  route: string;
}

/**
 * How far into the download someone got before they left.
 *
 * ⚠ Reported in QUARTERS, not as a continuous percentage. `assetLoadProgress` updates continuously and
 * a per-update event would be hundreds of rows per visit for a number nobody reads that precisely.
 */
export type IntroDepth = 25 | 50 | 75;

/** Which carousel a `stop:dwell` belongs to. Both are four-stop carousels inside the one pin. */
export type CarouselKey = 'services' | 'work';

export type JourneyEvent =
  | (JourneyEventBase & { name: 'intro:start' })
  | (JourneyEventBase & { name: 'intro:depth'; depth: IntroDepth })
  | (JourneyEventBase & {
      name: 'intro:complete';
      /** How long the loader held, in ms. The honest measure of what the 8.8 MB costs. */
      durationMs: number;
    })
  | (JourneyEventBase & { name: 'lite:taken' })
  | (JourneyEventBase & {
      name: 'section:arrive';
      /** A `carouselLayout` section key — `services`, `work`, `faq`, `contact`. */
      section: string;
    })
  | (JourneyEventBase & {
      name: 'stop:dwell';
      carousel: CarouselKey;
      /** 0-based index of the craft or project. */
      stopIndex: number;
      dwellMs: number;
    })
  | (JourneyEventBase & { name: 'faq:open'; entryIndex: number })
  | (JourneyEventBase & { name: 'drawer:open'; section: string })
  | (JourneyEventBase & { name: 'nav:jump'; section: string })
  | (JourneyEventBase & { name: 'loop:taken'; direction: 'forward' | 'reverse' })
  | (JourneyEventBase & {
      name: 'enquiry:open';
      /** `contact`, `services`, `work`, `faq`, `about` — where the form was opened from. */
      origin: string;
      variant: 'enquiry' | 'application';
    })
  | (JourneyEventBase & { name: 'enquiry:start'; variant: 'enquiry' | 'application' })
  | (JourneyEventBase & { name: 'enquiry:step'; step: number })
  | (JourneyEventBase & { name: 'enquiry:submit'; variant: 'enquiry' | 'application' })
  | (JourneyEventBase & {
      name: 'enquiry:error';
      /** The route's own reason, never the visitor's field values. */
      reason: 'invalid' | 'rate-limited' | 'unavailable';
    })
  | (JourneyEventBase & {
      name: 'cursor:click';
      /** Grid cell, so a click map and the movement heatmap share one coordinate space. */
      cell: number;
      /**
       * What was under it — a stable identifier, never the element's text.
       * ⚠ Text would put the visitor's own words in here the moment somebody clicks inside a form
       * field, which is the one thing the journey layer must never carry.
       */
      target: string;
      /** Landed on nothing interactive. The cheapest frustration signal there is. */
      isDead: boolean;
      /** Three or more clicks in one small area inside a second. The loudest one. */
      isRage: boolean;
    })
  | (JourneyEventBase & {
      name: 'cursor:hover';
      target: string;
      dwellMs: number;
    })
  | (JourneyEventBase & {
      name: 'device:profile';
      /** `deviceTier`'s latched answer. */
      deviceTier: 'potato' | 'low' | 'mid' | 'high';
      /** What the allocator gave the models, and what was left for the star. */
      modelRatio: number;
      sunRatio: number;
      devicePixelRatio: number;
      viewportWidth: number;
      viewportHeight: number;
      reducedMotion: boolean;
      /** Coarse pointer — the `useIsLowPowerViewport` question, recorded rather than inferred. */
      coarsePointer: boolean;
    })
  | (JourneyEventBase & {
      name: 'session:end';
      /** The furthest section reached, so an abandonment still reports how far it got. */
      maxSection: string;
      durationMs: number;
      /** True when the visit ended while the loader was still up. The headline number. */
      duringIntro: boolean;
    });

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
   THE CURSOR

   ⚠ MOVEMENT IS NOT AN EVENT, AND THAT IS THE WHOLE DESIGN. `mousemove` fires at 60–120 Hz. One row
   per sample is ~600 rows per minute per visitor — against a table already holding roughly fifteen
   rows for an entire visit, and a 90-day retention promise. Measured against a thousand visits a
   month it is the difference between ~4,000 rows and ~2.4 million.

   So the browser accumulates and sends ONE payload per section it leaves. The server stores a
   summary, never a stream, and the two shapes below go to their own tables rather than to
   `journey_events` — a path is not fifteen hundred events, it is one object about one span of time.

   ⚠ NEITHER IS COLLECTED ON A PHONE. `useIsLowPowerViewport` already gates the cursor effects off
   below 760px and on coarse pointers, and a touch device has no cursor to follow — a `pointermove`
   there is a drag, which the deck and the works field already own.
   ───────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ 16:9, so a cell is roughly square on the shape most desktops actually are. Normalised to the
 * VIEWPORT rather than the document, because on `/` there is no document to speak of — it is one
 * pinned viewport that four different scenes take turns occupying.
 */
export const CURSOR_GRID_COLUMNS = 32;
export const CURSOR_GRID_ROWS = 18;

/** Deliberately below frame rate. The heatmap needs where the cursor lingers, not every pixel of it. */
export const CURSOR_GRID_SAMPLE_HZ = 12;

/** Tier 2 only, and higher because a path is judged on its shape rather than its density. */
export const CURSOR_PATH_SAMPLE_HZ = 20;

/**
 * Where the cursor spent its time in one section — tier 1, everybody.
 *
 * ⚠ A GRID CELL IS NOT A COORDINATE, and that distinction is what keeps this out of tier 2. There is
 * no path, no ordering and no precision: two visitors who moved completely differently but rested in
 * the same places produce the same object. Mouse dynamics can identify a person; a count per cell
 * cannot, which is why this may be collected without asking and the path below may not.
 */
export interface CursorGrid {
  route: string;
  /** ⚠ Required. A heatmap of `/` without this is four scenes smeared over each other — see below. */
  section: string;
  /** Sparse — cell index → sample count. Most of 576 cells are empty in any given section. */
  cells: Record<number, number>;
  /** How long the cursor was observed here. The denominator; without it a long visit just looks hot. */
  observedMs: number;
}

/**
 * The actual trail — TIER 2 ONLY, and the most invasive thing in this feature.
 *
 * ⚠ THIS IS SESSION REPLAY IN ALL BUT NAME, and it is consent-gated for that reason rather than as a
 * formality. Mouse dynamics — velocity, tremor, the shape of a correction — are an established
 * behavioural biometric, so a path is capable of identifying a person in a way none of the rest of
 * this taxonomy is. The privacy notice has to describe it in those words rather than as "cursor data".
 *
 * ⚠ Delta-encoded and quantised: `[t, x, y, dt, dx, dy, …]`. Absolute values only for the first
 * point. Positions are per-thousand of the viewport, not pixels, so a path means the same thing on
 * two different monitors and carries no information about the visitor's screen that
 * `device:profile` has not already recorded honestly.
 */
export interface CursorPath {
  route: string;
  section: string;
  points: number[];
  sampleHz: number;
}

/**
 * What actually crosses the wire.
 *
 * ⚠ Batched, and the batch is capped. `navigator.sendBeacon` refuses payloads over roughly 64 KB and
 * refuses them SILENTLY — it returns false and the whole batch is lost, which on `pagehide` means
 * losing exactly the abandonment this feature exists to measure. The collector enforces the cap; this
 * type is where the number is written down.
 */
export interface JourneyBatch {
  schemaVersion: number;
  /**
   * ⚠ THE BATCH OWNS THE SESSION ID, AND IT MUST NOT BE INFERRED FROM `events[0]` — v2, and the
   * reason is a defect that cost every heatmap on two whole paths through the site.
   *
   * The cursor payloads carry no identity of their own: they belong to the same visit as whatever
   * else is in the flush. The panel used to read that identity off the first event, which was true
   * for as long as a flush was one body — and stopped being true the moment `serialiseBatches`
   * began SPLITTING on bytes. Events are packed first, so every body after the first carries only
   * grids and paths and no event at all, and the panel dropped all of it.
   *
   * ⚠ It is not only the split, which is what made this easy to miss. `noteRouteChange` closes the
   * open cursor summary and records NO event, so a client-side navigation flushes a grid alone in a
   * body of its own — under the cap, never split, and dropped just the same.
   *
   * Measured before the fix: a consented visit of 40 events + 4 grids + 4 paths packs into
   * 23,545 bytes (40 events, 4 grids, 2 paths) and 10,106 bytes (0 events, 2 paths) — the second
   * body's paths discarded on arrival.
   */
  sessionId: string;
  /**
   * Who to attribute the cursor payloads to — ⚠ ABSENT AT TIER 1, exactly as on an event, and for
   * exactly the same reason. `journey_cursor_paths.visitor_id` is NOT NULL so that a path nobody
   * consented to is unrepresentable; this is where the panel gets the value that keeps it that way.
   *
   * ⚠ It is the identity AT FLUSH TIME, not the identity of any particular event, and the two can
   * legitimately differ. Consent granted mid-buffer leaves earlier events at tier 1 with no id and
   * later ones at tier 2 with one; consent WITHDRAWN mid-buffer leaves lawfully-collected tier 2
   * events carrying their id while this field is correctly gone, taking the paths with it.
   */
  visitorId?: string;
  events: JourneyEvent[];
  /** One per section left. Tier 1 — sent for everybody. */
  cursorGrids?: CursorGrid[];
  /** ⚠ Tier 2 ONLY. Must be absent, not empty, when consent has not been given. */
  cursorPaths?: CursorPath[];
}

/**
 * ⚠ Well under the beacon's ~64 KB ceiling. The largest event here is `device:profile` at a few
 * hundred bytes, so 40 is roughly 12 KB — a wide margin, deliberately, because the ceiling is a
 * browser implementation detail rather than a specification and Safari has historically been meaner
 * about it than the number suggests.
 */
export const JOURNEY_MAX_BATCH_EVENTS = 40;

/**
 * ⚠ THE EVENT CAP IS NO LONGER SUFFICIENT ON ITS OWN, because cursor payloads are not event-sized.
 *
 * Forty events is roughly 12 KB. One `CursorPath` is 3–5 KB by itself, so four of them plus a full
 * event buffer clears 30 KB and a long consented visit could approach the beacon ceiling — where the
 * failure is silent: `sendBeacon` returns false and the entire batch is dropped, which on `pagehide`
 * means losing precisely the abandonment this feature exists to measure.
 *
 * So the collector measures the SERIALISED payload and splits on bytes, with this as the ceiling.
 * Well under the ~64 KB browsers advertise, because that figure is an implementation detail rather
 * than a specification and Safari has historically been meaner about it than the number suggests.
 */
export const JOURNEY_MAX_BATCH_BYTES = 24_000;

/** Where the site's own route forwards from. Named for what it measures, not for what it is. */
export const JOURNEY_INTAKE_PATH = '/api/journey';
