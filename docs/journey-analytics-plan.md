# Journey analytics — plan of record, 2026-08-17; **completed 2026-08-19**

What visitors actually do on this site, in two tiers of consent, written to the studio's own panel.
Spans **two repositories**: `orbix-dev` collects, `voidix-cms` stores and reports.

> ⚠ **This document is the record for both sides.** The panel has no copy of it. If the two ever
> disagree about the payload, `lib/journey/events.ts` (site) and `lib/journey/intakeSchema.ts` (panel)
> are the contract and this file is the explanation.

---

## Status — P1–P5 complete, one thing outstanding

Revised **2026-08-19**: the ten remaining events are wired, five defects found by reading the built
code are fixed, and the retention sweep has a trigger.

| | |
|---|---|
| P1 · the contract | ✅ types + schema + migrations, **migrations applied** |
| P2 · consent | ✅ bar, control, GPC, versioned record |
| P3 · collection | ✅ **19 of 19 events wired** |
| P4 · retention + legal | ✅ **pg_cron**, `prisma/scripts/journey-maintenance-cron.sql` — ⚠ must be RUN once per database |
| P5 · dashboard | ✅ `/user-activity`, empty until events arrive |

⚠ **Nothing has still been seen end to end.** No event has reached the database and nobody has
watched the consent bar appear. That is the whole of what is left — see
[What is not built](#what-is-not-built).

`tsc --noEmit` clean in both repos. `voidix-cms` builds. `orbix-dev` builds when its dev server is
not running — the two share `.next` and fight over it, which shows up as a spurious ENOENT on
`pages-manifest.json` *after* a successful compile.

---

## ⚠ It is NOT called telemetry

`lib/telemetryEnabled.ts`, `TelemetryConsole`, `LoaderTelemetry` and `cacheTelemetry` already exist
and mean the opposite thing: **diagnostics**, running in development and on preview deploys, printing
to a console, and compiled out of a production bundle at build time.

This runs **in production, for visitors, and sends data to a server**. Four existing things own the
word, so everything here lives under `lib/journey/`. The two look alike in the layout file and mean
opposite things — `JourneyCollector`'s header says so where somebody would actually read it.

---

## The decisions

Taken 2026-08-17, in conversation, and each one changed the build:

| question | answer | consequence |
|---|---|---|
| What to learn | all four | drop-off, contact funnel, attention, device reality |
| Where the data goes | **the studio's own panel** | no third party ever touches visitor data |
| Identity | **two-tier** | anonymous for everyone; persistent id on consent |
| Scope | capture **+ dashboard** | both repos, one migration, one legal rewrite |
| Consent bar | quiet bar, **during the loader** | reversed mid-build — see below |
| Retention | raw 90 days, rollups kept | needs a scheduled job |
| Cursor | clicks, dead/rage, hover, **full paths** | grid for all, precise for consented |
| Cursor scope | everywhere, tagged by section | |
| Rollup runner | **a protected route**, trigger decided later | works with Vercel Cron or `pg_cron` |
| Path retention | same 90 days as everything | one rule, one sweep |

### ⚠ Two of these fight each other, and the two-tier model is the resolution

The top goal is **loader drop-off**. A persistent id **requires consent before it is set**. Put the
bar after the intro to protect the opening move, and everyone who abandons during the 8.8 MB download
has by definition never consented — the data would be systematically blind to exactly the population
it was built to see, and would look fine.

So: **tier 1 needs no consent and runs for everybody** (no identifier, nothing written to the device),
and **tier 2 layers a persistent id on top for those who accept**. Strictly more than either pure
option.

### ⚠ The bar moved into the loader, and that was a reversal

The first cut waited for `REVEAL_EVENT` plus a settle delay. It now appears **during** the download,
on `MotionPrompt`'s own argument — *the loader is the one beat on this site where the visitor is
already waiting, so asking costs nothing.* It also fixes what the deferred version could not: a
visitor who leaves during the loader never reached the old bar at all.

---

## The shape

Nothing is instrumented into a scene. The site already narrates its journey as ~30 CustomEvents, so
the collector subscribes and the components never learn they are being watched.

```
  orbix-dev                                            voidix-cms
  ─────────                                            ──────────

  the existing CustomEvents
  REVEAL · SECTION_ARRIVE · GOTO_SECTION · LOOP_ARRIVED
         │
         │  subscribe (NEVER the per-frame ones — trap 1)
         ▼
  lib/journey/collector.ts ◄── lib/journey/cursor.ts
         │   buffer in memory                (one passive pointermove,
         │   flush: 40 events │ 24 kB │       O(1); a rAF samples it)
         │          10 s idle │ tab hidden │ pagehide (beacon)
         ▼
  app/api/journey/route.ts ──── x-voidix-secret ────► app/api/journey/route.ts
         │  (holds the secret)                              │  zod · bot filter · tier check
         │                                                  ▼
  lib/journey/consent.ts                          journey_events        (raw, 90 d)
         │  unset │ granted │ denied              journey_cursor_grids  (raw, 90 d)
         │  + globalPrivacyControl                journey_cursor_paths  (tier 2 only)
         ▼                                                  │
  ConsentBar  (during the loader)                 POST /api/journey/maintenance
         │                                                  │  rollup → delete
         └─ granted → visitorId.ts                          ▼
                        localStorage,                journey_daily     (kept forever)
                        tier 2 begins                       │
                                                            ▼
  ConsentControl (/privacy)                          /user-activity
         └─ withdraw.ts ──► /api/journey/forget ──►  paths DELETED, events downgraded to tier 1
```

---

## The two tiers

| | tier 1 | tier 2 |
|---|---|---|
| who | everybody | those who accept the bar |
| consent | **not required** | required |
| identifier | none | `visitorId`, a random UUID in localStorage |
| stored on device | **nothing** | the id + the consent record |
| cursor | grid (a histogram) | grid **+ the actual path** |
| answers | drop-off, depth, device, friction | returning visitors, cross-session funnels |

⚠ **On a tier 1 event `visitorId` is ABSENT, not `null`.** That is the whole guarantee: a tier 1 row
is structurally incapable of being joined to a person rather than one `UPDATE` away from it. The
panel **rejects** a batch containing a `tier: 1` event that carries a `visitorId` rather than tidying
it up — it cannot happen from our own collector, so it is either a bug worth seeing or a forgery.

⚠ **`sessionId` is not a loophole.** Generated per tab, held in a module variable, never written to
storage, gone when the tab closes. Two visits by the same person share nothing at tier 1.

⚠ **Not `sessionStorage`**, which sounds like the obvious home and is not: it survives a reload and
is restored on a back-navigation, turning "this tab, right now" into "this tab, across page loads",
and it persists to disk. The accepted consequence is that **a reload is a new session** — visit counts
count page loads that reached the loader, not people.

---

## Consent

`lib/journey/consent.ts`, modelled closely on `lib/motionPreference.ts`, which had already solved
three states rather than a boolean, a module-level value, a listener set, and `try`/`catch` around
every storage call because **Safari in private browsing throws on localStorage**.

- **`unset | granted | denied`** — "never asked" and "said no" are the same for collection and
  completely different for whether to show the bar.
- **`decidedAt` is stored.** Consent has to be demonstrable.
- **`JOURNEY_CONSENT_VERSION`** — ⚠ bump it when what is collected materially changes. Every stored
  decision below the current number is retired and the visitor is asked again. A yes given to one set
  of facts is not a yes to a different set.
- **Escape records a denial.** Under the GDPR the absence of an answer is not consent, so dismissing
  can only mean no — and treating it as "ask again next time" would turn someone's attempt to be rid
  of the bar into a reason to show it again.

### ⚠ Global Privacy Control is honoured, and it is this file's `prefers-reduced-motion`

The parallel is exact: motion has an OS switch a site must honour unasked, and so does this. GPC is a
legally recognised opt-out. A browser sending it is treated as **denied** and **never shown the bar** —
asking someone who has already globally said no is the dark-pattern version of consent.

They still get **tier 1**, deliberately. GPC is an objection to being *tracked*; anonymous counts with
nothing stored are not what that signal is about, and stopping them would cost the site its drop-off
data for its most privacy-conscious visitors while protecting nobody. They can opt in from `/privacy`
— it is just never solicited.

---

## What is collected

`lib/journey/events.ts` is the **whole list**, by design: there is no generic `track(name)` escape
hatch, so the taxonomy can be read straight into the privacy notice without an audit.

| event | how it is collected |
|---|---|
| `intro:start` · `intro:complete` | `REVEAL_EVENT`; `intro:start` **only on `/`** — see defect 1 |
| `intro:depth` | `onAssetProgress`, at 25/50/75 watermarks. ⚠ No component edit — `assetLoadProgress` already published a subscribe API |
| `lite:taken` | `LITE_TAKEN_EVENT` ← `SkipToLite`'s anchor |
| `section:arrive` · `nav:jump` | `SECTION_ARRIVE_EVENT` · `GOTO_SECTION_EVENT` |
| `stop:dwell` | `STOP_COMMIT_EVENT` ← `commitStop`. The pin says *which stop*; the collector does the subtraction |
| `faq:open` | `FAQ_ENTRY_OPEN_EVENT` ← `useHologramReveal` |
| `drawer:open` | `DRAWER_OPEN_EVENT` ← `Drawer`, one dispatch covering all four callers |
| `loop:taken` | `LOOP_ARRIVED_EVENT` (forward) · `LOOP_REVERSE_COVERED_EVENT` (reverse) — see defect 3 |
| `enquiry:open` | `ENQUIRY_OPEN_EVENT` ← `EnquiryPanel`, **plus a synthesised one** at contact — see below |
| `enquiry:start/step/submit/error` | the four `ENQUIRY_*` events ← `EnquiryForm` |
| `cursor:click` · `cursor:hover` | `CursorTracker` |
| `device:profile` | `PIXELS_ALLOCATED_EVENT` — see defect 2 |
| `session:end` | `pagehide` |

⚠ **The seven new events are DOMAIN events, not analytics calls, and that is what keeps "subscribe,
never instrument" true rather than nominally true.** Each says what a component did, in that
component's own vocabulary, carrying only what it genuinely knows. Everything that turns one into a
measurement — the dwell subtraction, an enquiry's origin, which carousel a stop belongs to — happens
in the collector. No component imports anything from `lib/journey/`.

⚠ **The panel needed NO changes for any of them.** `intakeSchema.ts` types an event name as
`z.string().min(1).max(32)` with `.passthrough()`, deliberately, so an unknown name is stored rather
than rejecting the batch around it. `activityReport.ts` already queried `introFunnel`, `attention` and
`enquiryFunnel`; those three dashboard sections stop self-hiding on their own.

⚠ **`enquiry:open` is synthesised at contact, and it is honest rather than convenient.**
`ContactSection` renders `EnquiryForm` **directly** rather than through `EnquiryPanel`, so its form is
never opened — it is simply on screen when you arrive. The panel's funnel divides every later step by
`enquiry:open`, so without this a contact submission is a step with no denominator and the funnel
reads over 100 %. The collector emits it on `section:arrive { contact }`.

**`device:profile` is the cheapest data here.** `deviceTier`, the allocator and the burn-in already
compute the tier, both pixel ratios and the frame cost on every load and then throw them away. It is
the first time anyone can see the distribution the quality budget is really serving — which until now
was tuned against one laptop.

---

## The cursor

⚠ **Movement is never an event.** `mousemove` fires at 60–120 Hz. One row per sample is ~600 rows per
minute per visitor against a table holding about fifteen rows for an entire visit. The browser
accumulates and posts **one summary per section left**.

|  | naive | as built |
|---|---|---|
| tier 1 grid | ~600 rows/min/visitor | **~4 rows per visit** |
| 1,000 visits/month | ~2.4 M rows | **~4,000 rows** |

**The grid** (tier 1) is a 32×18 histogram normalised to the viewport — no ordering, no path, no
precision. Two people who moved completely differently but rested in the same places produce
identical rows. That is what makes it collectable without asking.

**The path** (tier 2) is the actual trail, delta-encoded, positions per-thousand of the viewport.
⚠ **This is session replay in all but name.** Mouse dynamics — velocity, tremor, the shape of a
correction — are an established behavioural biometric, so a path can identify a person in a way
nothing else in the database can. `journey_cursor_paths.visitor_id` is **NOT NULL**, the only such
column, precisely so a path nobody agreed to is unrepresentable.

⚠ **Nothing is collected on a touch device.** A phone has no cursor, and its `pointermove` is a drag
the deck and works field already own — recording it would produce a "heatmap" of where people swipe.

---

## ⚠ The traps

**1 · The per-frame events.** `HANDOFF_PROGRESS_EVENT`, `CHAMBER_PROGRESS_EVENT`,
`CONTACT_PROGRESS_EVENT` and `HERO_SERVICES_PROGRESS_EVENT` fire **every frame**. The collector
subscribes to none of them. Depth comes from `SECTION_ARRIVE_EVENT`, which is discrete.

**2 · The pointer handler does two assignments.** `useCoreTelemetry` states the house rule — *the
listener only records; all math waits for the frame*. This is the **sixth** `pointermove` listener on
this site.

**3 · `sendBeacon` is the entire drop-off measurement.** Someone abandoning the loader closes the tab;
a normal `fetch` is cancelled on unload. `pagehide`, not `unload`, which iOS Safari does not reliably
deliver.

**4 · Batches split on BYTES, not count.** One `CursorPath` is 3–5 kB, so an event count says nothing
about payload size — and `sendBeacon` refuses an oversized body by returning **false, silently**.
`JOURNEY_MAX_BATCH_BYTES` is 24 kB, well under the ~64 kB browsers advertise. When a batch is too
large the **paths** are dropped first: a lost path costs a heatmap some detail, a lost `session:end`
costs the drop-off figure entirely.

**5 · `/api/journey` had to go in `PUBLIC_PATHS`.** The final batch is a beacon during `pagehide`,
which cannot follow a redirect and cannot report failure — behind the panel's auth proxy a 307 to the
login page would have silently discarded exactly the events that record somebody leaving.
⚠ `/api/journey/maintenance` is deliberately **not** public; it deletes.

**6 · `Omit` is not distributive.** `Omit<JourneyEvent, keyof BaseFields>` on a discriminated union
computes `keyof` across the **intersection**, so every field that distinguishes one event from another
vanishes and every call site reports "property does not exist" for exactly the property that makes it
that event. `DistributiveOmit` with its `T extends unknown` clause is the fix.

**7 · A `UNIQUE` over a nullable column does not do what it looks like.** Postgres treats NULLs in a
unique index as **distinct from one another**, so `journey_daily(day, name, NULL)` could insert twice
and the nightly job would duplicate rather than update — every count wrong, no constraint to catch it.
`section` is `NOT NULL DEFAULT ''` on the rollup table and nullable on the raw table, where it is
absent data rather than a grouping key.

**8 · Roll up first, delete second.** Deleting first discards the rows the rollup was about to read
and the loss is silent. ⚠ Re-running cannot zero an earlier day, and the reason is structural: the
rollup is `INSERT … SELECT … GROUP BY`, so a day with no remaining raw rows produces **no row**, and
`ON CONFLICT` never fires. Rewrite it as read-then-write in application code and that property is lost.

**9 · Withdrawal has an ordering requirement.** `setJourneyConsent('denied')` erases the visitor id
synchronously, so by the time it returns there is nothing left to tell the server. `withdraw.ts`
captures the id, sends it, *then* withdraws. A naive version deletes the local copy and leaves every
path on the server forever, reporting success.

**10 · StrictMode double-mounts.** `reactStrictMode: true` is on, so a collector that subscribed per
mount would count everything twice. `startJourneyCollector` is idempotent.

**12 · `commitStop` runs BEFORE `SECTION_ARRIVE_EVENT`, and the dwell measurement depends on it.**
Crossing into works commits project 01 and only *then* announces the arrival — so by the time the
collector hears "arrived at work", the open stop is already the new section's first one, with a dwell
of about zero. The obvious-looking `closeStop()` in the arrival handler (which the first cut of this
had) therefore drops that dwell as too short **and** leaves nothing open until the visitor steps off
it, making the first stop of every section the one stop that never reports. `onStopCommit` owns the
whole lifecycle; the previous section's last stop was already closed by the commit that brought you
here. ⚠ The cursor summary is the opposite case and IS closed on arrival — it belongs to the section
being left, and nothing else closes it.

**11 · Browser clocks lie.** `occurred_at` is the browser's and is stored **untrusted** — it exists
only to order events within a session and give an honest dwell, which the server stamp cannot (ten
events flushed together share a millisecond). ⚠ **Every report groups by `received_at`.**

---

## ⚠ The five defects — found 2026-08-19 by reading the built code, all fixed

None of these was caught by `tsc`, a build, or a review of the plan. Every one of them was a thing the
code did that the prose said it did not.

**1 · Every document-route visit was counted as a loader abandonment.** `start()` recorded
`intro:start` unconditionally, but `IntroSequence` mounts only in `app/page.tsx` — so on `/about`,
`/careers` and `/lite` the intro could never complete and `session:end` reported `duringIntro: true`.
That is the headline number this feature exists to produce, and it also inflated the panel's
`introFunnel` denominator, which counts distinct sessions carrying `intro:start`. Now gated on
`hasIntro`, decided once from the route the visit began on. ⚠ Not on `INTRO_ACTIVE_EVENT`: that fires
from a child effect during the page's mount and this collector starts from the LAYOUT, whose effects
run after its children's — the event is gone before there is anything to hear it.

**2 · `device:profile` reported ratios that had not been allocated yet.** It was recorded in
`start()`, at layout mount, long before the burn-in — where `pixelRatio` is 1 and `sunPixelRatio` is
`null`. **Every visitor on every machine would have reported `modelRatio: 1, sunRatio: 1`**, which
looks exactly like a real allocation on a weak machine. The one field this feature was best placed to
answer was the one field that would have been uniformly wrong, and no credibility check could have
caught it. Now on `PIXELS_ALLOCATED_EVENT`, with `pagehide` as the backstop for visits that never
allocate. ⚠ That event is fired by `lockPhase()` and therefore by **all three** solvers — the burn-in,
the section split and the runtime calibrator. Subscribing to `reportSectionCosts` alone would have
missed most loads, since it returns early once `phase` is locked.

**3 · `loop:taken` could only ever be `'forward'`.** `LOOP_ARRIVED_EVENT` has one dispatch site, in
the FORWARD loop's `LOOP_COVERED_EVENT` handler. The reverse loop runs through
`LOOP_REVERSE_COVERED_EVENT`, so the `'reverse'` variant in the taxonomy was unreachable and the
hero → contact journey was invisible. Now subscribed — no new event, because the teleport happens
synchronously inside that dispatch, which is exactly the moment the reverse loop was taken.

**4 · Cursor grids were mislabelled after a client-side navigation.** Events re-read
`location.pathname` per record, but `CursorTracker` captures its route once at `start()` — and
`setRoute`, which existed and was exported, was never called. A `next/link` to `/about` filed its
heatmap under `/`. `JourneyCollector` now watches `usePathname()`; the collector closes the open
summary **before** accepting the new route, so each half lands where it was gathered.

**5 · The batch cap did not split — it only shed.** `flush()` dropped `cursorPaths` when the body was
too large and then sent whatever remained regardless, so a full event buffer plus grids could still
clear the cap — and `sendBeacon` refuses an oversized body by returning **false, silently**, which on
`pagehide` is the abandonment this feature exists to measure. It also measured with `String.length`,
which is UTF-16 code units against a constant named for bytes. `serialiseBatches` now packs into as
many bodies as it takes, in priority order (events, then grids, then paths), measuring with
`TextEncoder`. ⚠ An item too large for a batch of its own is dropped **only if it is droppable** — a
cursor payload is detail, an event may be the `session:end`.

⚠ **Defect 5's fix had a bug of its own, caught by a unit harness rather than by reading it**: an
oversized path arriving *after* an event opened a fresh batch and was pushed into it without
re-checking, producing exactly the over-cap body the fix existed to prevent. It recurses now. The
lesson is the obvious one — a packing loop with three shedding rules is not reviewable by eye.

---

## Files

### `orbix-dev`

```
lib/journey/
  events.ts        the taxonomy, the batch envelope, the grid constants, the byte cap
  consent.ts       three states, GPC, versioned record; owns BOTH storage key names
  visitorId.ts     the tier 2 UUID
  session.ts       per-tab, in memory
  uuid.ts          one generator, shared — never Math.random()
  cursor.ts        the tracker: passive listener + rAF sampling + click/hover
  collector.ts     subscribe · buffer · flush · beacon
  withdraw.ts      the ordering that makes the control real
components/ui/ConsentBar/
  ConsentBar.tsx       the bar; portals to body; z 10001 during the intro, 9700 after
  ConsentControl.tsx   /privacy's permanent control — the one client island on that route
components/effects/JourneyCollector/JourneyCollector.tsx    renders nothing, starts the collector
app/api/journey/route.ts           holds the secret, forwards a batch
app/api/journey/forget/route.ts    forwards a withdrawal
```
Added 2026-08-19, the seven domain events the last ten wirings needed — each with its own domain, none
of them in `lib/journey/`:
```
lib/sectionJumpEvents.ts                     + STOP_COMMIT_EVENT
lib/chamberEvents.ts                         + FAQ_ENTRY_OPEN_EVENT
lib/adaptivePixelRatio.ts                    + PIXELS_ALLOCATED_EVENT  (and `lockPhase`)
components/effects/IntroSequence/introEvents.ts  + LITE_TAKEN_EVENT
components/ui/Drawer/drawerEvents.ts             the sheet
components/ui/EnquiryForm/enquiryEvents.ts       the five funnel events
```
Modified: `app/layout.tsx` (mount), `app/globals.css` (+234), `app/privacy/page.tsx`,
`components/pages/Legal/LegalPage.tsx` (the `aside` slot), `privacyContent.ts` (the rewrite).

### `voidix-cms`

```
lib/journey/
  intakeSchema.ts     zod mirror of the site's types + the grid constants
  maintenance.ts      rollup SQL, retention sweep, forgetVisitor
  activityReport.ts   buildActivityReport — funnels, attention, devices, friction, heatmaps
app/api/journey/route.ts              intake: secret · bot filter · tier check · batch insert
app/api/journey/forget/route.ts       withdrawal
app/api/journey/maintenance/route.ts  the nightly job, its own secret
app/(panel)/user-activity/
  page.tsx           the dashboard
  CursorHeatmap.tsx  576 divs, server-rendered, no canvas and no chart library
prisma/migrations/20260817000000_journey_analytics/   journey_events, journey_daily
prisma/migrations/20260817000001_journey_cursor/      journey_cursor_grids, journey_cursor_paths
prisma/scripts/journey-maintenance-cron.sql           ⚠ the pg_cron schedule — RUN BY HAND, once
```
Modified: `prisma/schema.prisma`, `lib/supabase/proxy.ts` (`PUBLIC_PATHS`),
`components/layout/SidebarNav.tsx`.

---

## Withdrawal

⚠ **Paths are deleted; events are downgraded.** The asymmetry is the point. A path could only ever
have been collected with consent, so withdrawing destroys it. Strip the `visitor_id` from an event and
what remains is exactly a tier 1 event — an anonymous count that needed no permission in the first
place. **The link was the sensitive part, and the link is what goes.** `tier` moves to 1 in the same
statement so the row cannot later read as a consented one with a missing id. Both in one transaction:
a half-erasure that left paths behind is the failure that matters and it would look like success.

The visitor id is the only credential on `/api/journey/forget`, and that is acceptable: it is
unguessable, it is not a login, and the worst an attacker achieves is **deleting** analytics about a
stranger. Erasure is the privacy-preserving direction.

---

## What is not built

1. **⚠ Nothing has been verified end to end. This is the only remaining prerequisite for production.**
   No event has ever reached the database. It needs the site running against the panel with the intake
   secrets matching — which they already do locally, and `VOIDIX_CMS_URL` already points at
   `http://localhost:3000`. The checklist is in [Verification](#verification--measured-2026-08-17-not-inferred).
2. **⚠ The pg_cron script has to be RUN.** `prisma/scripts/journey-maintenance-cron.sql` exists and is
   documented, but it is a manual step by design — it carries a secret and must not schedule a job on
   every database a migration touches. **Until it is run against production, `/privacy`'s ninety days
   is a claim rather than a behaviour.** `JOURNEY_MAINTENANCE_SECRET` is set locally and needs setting
   in the panel's deployed environment.
3. **The bar's timing has not been seen by anyone.** 1.5 s into the loader, or 0.9 s after a motion
   choice. Needs a browser.
4. **No alerting.** A panel that stops accepting batches looks identical to a quiet week. Deliberately
   deferred; `cron.job_run_details` and `net._http_response` are where a silent failure shows, and the
   SQL script has both queries written out. ⚠ Note that `net.http_post` succeeds by QUEUEING, so a 401
   from a wrong secret is a cron job that reports success — the second query is the one that can tell.

## Open decisions

| | recommendation |
|---|---|
| ~~Rollup trigger~~ | **Decided 2026-08-19: `pg_cron`**, as a one-time script rather than a migration. See Part 3 of `journey-maintenance-cron.sql`'s header for why a migration was wrong. |
| Sampling, if volume bites | `stop:dwell` first — highest frequency of the discrete events |
| `/lite` | instrument at tier 1 only. It is the population that could not load the site, which is the most interesting group and the one least wanting extra requests |

---

## Verification — measured, not inferred

- `npx tsc --noEmit` clean in **both** repos.
- `voidix-cms` builds; `/user-activity` in the route table.
- `orbix-dev` builds when its dev server is stopped. ⚠ `next build` and `next dev` share `.next`; the
  symptom is ENOENT on `pages-manifest.json` **after** "Compiled successfully", which reads as a code
  fault and is not one.
- Both migrations **applied** to the live Supabase instance; `prisma migrate status` reports up to date.
- `/privacy` on the dev server: 200, **2,213 words**, 9 numbered sections, the cursor section present,
  the path disclosure present, the 90-day period stated, the consent control rendering.
- The consent bar is **absent from server-rendered HTML on every route** — gated behind three flags
  that are all false on the server, so no hydration mismatch.

**2026-08-19:**

- `npx tsc --noEmit` clean and `npm run build` green in **both** repos, after all of the above.
- `serialiseBatches` exercised against six cases in a standalone harness — an empty flush, a small
  one, 40 events + 4 grids + 4 full-length paths, an unsendable path beside a live event, paths-only
  where all are unsendable, and 400 events. **No body exceeds `JOURNEY_MAX_BATCH_BYTES` and nothing
  droppable is lost.** The fourth case is the one that failed first; see the defects section.

⚠ **Still not verified: everything that needs a browser or a database.** See What is not built.

---

## Related

- `docs/cms-integration-plan.md` — the panel connection this is built on top of, and the
  search-visibility work that shares its components.
- `lib/journey/events.ts` — the contract. Read it before changing anything here.
- `CLAUDE.md` — **updated 2026-08-19**: the seven new events are in its event-contract table and
  `lib/journey/` is in its `lib/` table.
