# Arriving from another route — plan

> **Status: PROPOSED.** Two defects, one shared cause: *the navbar's four sections only exist on `/`,
> and every other route reaches them by leaving.* Part A fixes what `/about` and `/careers` do about
> that. Part B stops `/lite` needing to do it at all.

---

## 0 · What is wrong, precisely

### A · `/about`, `/careers` → the homepage shows you the hero first

Click **Work** on `/about`. The `<a href="/#work">` is a real navigation, so:

```
  full page load
  └─ IntroSequence: dust · counter · gate (waits for ALL assets)
     └─ finale: wordmark resolves · shards assemble the star in the "o"
        └─ handoff:  chrome out ─ VEIL LIFTS ─ star flies "o" → hero square   ← the hero appears
           └─ REVEAL_EVENT
              ├─ createTransition()     the pin is built
              ├─ playHeroEntrance()     headline rises, square fills, tagline  ← ~1.4s of hero
              └─ consumeArrivalHash() → requestSection('work')
                 └─ onGotoSection → beginCoveredJump
                    └─ SectionJumpVeil closes over the hero  (0.55s)           ← covered AGAIN
                       └─ glide (1.5–3.2s, unwatched)
                          └─ cover opens on Works
```

Nothing here is broken — every piece is doing its job. The defect is **ordering**: the loader's
handoff and the jump's cover are two separate curtains, and the hero is shown in the gap between
them. Roughly **2.5–3 seconds of a section the visitor did not ask for**, followed by a second
full-screen cover.

`JUMP_SECTION_DISTANCE` is `1` (`useHeroAnimation.ts:431`), so this is true of **all four**
destinations, Services included.

### B · `/lite` sends you away for sections it already has

`/lite` renders the same three registries the homepage does — `DECK_SERVICES`, `WORKS_PROJECTS`,
`FAQ_ENTRIES` — as `LITE_SECTIONS`:

| navbar item | `/lite` already has | today's click |
|---|---|---|
| `01 Services` | §01 *What we build* (`#build`) | full load of `/`, then §A above |
| `02 Work` | §02 *Selected work* (`#work`) | ditto |
| `03 FAQ` | §03 *Questions* (`#questions`) | ditto |
| `04 Contact` | the close block + `EnquiryPanel` | ditto |
| `Start Project` CTA | the close's own *Start a project* button | ditto |

So the one page that exists **because the visitor cannot afford the ten megabytes** answers every
nav click by fetching the ten megabytes. That is the whole bug.

---

## 1 · Why it is like this (so the fix doesn't undo the reasons)

Four constraints are load-bearing and the fix must not break any of them:

1. **Contract 2** — the pin is created *only* in the `REVEAL_EVENT` handler. Nothing scroll-driven
   may exist during the intro.
2. **`goToStop` needs the pin.** Before it exists the call degrades to setting an index. So the
   travel cannot start before `REVEAL_EVENT`.
3. **`html.scroll-locked` is `overflow: hidden`** (`globals.css:160`). `window.scrollTo` and
   `trigger.scroll()` both no-op under it. **The travel cannot happen while the intro's lock is on.**
4. **The journey must actually be travelled, never teleported.** The chamber room and the contact
   star are built lazily off crossing progress; a teleport arrives in a room that was never created.
   `lib/sectionJumpEvents.ts` records this at length — it is why a covered jump glides underneath
   rather than jumping.

Constraint 3 is the interesting one, and it is why the loader currently has to get out of the way
before the travel can begin. It is also why the current order is what it is rather than an oversight.

---

## 2 · Options considered

| # | Idea | Verdict |
|---|---|---|
| 1 | Teleport the pin to the destination at `REVEAL_EVENT` | **Rejected.** Skips the lazy builds and leaves `currentStop`, `wasInFill`, `lastCommittedIndex`, `lastCrossingProgress` un-derived. This is the design already rejected in `sectionJumpEvents.ts`, for the same reasons. |
| 2 | Fire `requestSection` earlier, so the jump cover closes *before* the loader veil lifts | **Rejected.** `.section-jump-veil` and the intro overlay are **both `z-index: 10000`** (`globals.css:2459`, `IntroSequence.tsx:1061`) and the veil is later in `page.tsx`, so it paints **over** the loader — the black disc would grow across the wordmark. Two covers chasing each other is also exactly the multi-clock coupling this codebase keeps having to undo. |
| 3 | Point `/about` + `/careers` nav at `/lite#work` instead | **Rejected.** The visitor asked for the site, not the text version. |
| 4 | **The loader stays up and becomes the cover for the whole arrival** | **Recommended.** One curtain, not two. The wait the visitor already accepted absorbs the travel. |

Option 4 also makes the arrival **shorter than it is today**: it removes the veil fade (0.7s), the
sun flight (1.1s), the hero entrance (~1.4s), the jump cover's close (0.55s) and its open (0.7s), and
replaces all of it with the glide the site was going to run anyway.

---

## 3 · Part A — the loader lands you where you asked

### 3.1 The beat sheet

```
  ┌─ THE LOADER (unchanged) ─────────────────────────────────────────────────┐
  │  dust field · counter · telemetry · the gate                             │
  │  corner chrome now reads:   BOUND FOR 02 · WORK        ← the one new line │
  │  finale: wordmark resolves · the ten shards assemble the star in the "o"  │
  └──────────────────────────────────────────────────────────────────────────┘
                                   │
                    ╔══════════════╧═══════════════╗
                    ║   THE ARRIVAL  (new branch)  ║   the veil NEVER lifts here
                    ╚══════════════╤═══════════════╝
                                   │
   1. REVEAL_EVENT                 │   pin built · star's z → 9500, i.e. BEHIND the veil
   2. star parked                  │   gsap.set(.hero-sun-flight, {x:0,y:0,scale:1})  — NOT a tween
   3. loader chrome fades          │   wordmark, counter, frame, telemetry · veil stays opaque
   4. scroll unlocked              │   ⚠ must precede the travel — see §1.3
   5. ARRIVAL_TRAVEL_EVENT ───────►│   the pin glides, unwatched, exactly as a covered jump does
                                   │      · every crossing scrubbed
                                   │      · chamber room / contact star built on the way past
                                   │      · gestures swallowed the whole time
   6. ◄─────── ARRIVAL_SETTLED_EVENT    the pin has landed (epsilon on progress, not the tween)
   7. SECTION_ARRIVE_EVENT         │   the destination plays its own entrance…
   8. veil fades out ──────────────┘   …THROUGH the reveal, not behind it
                                   ▼
                              02 · WORK, arriving
```

Total after the wordmark: **the glide (1.5–3.2s) + a 0.7s fade.** Today the same span costs ~4.5s
*and* shows a hero.

### 3.2 The handshake

Three signals, no shared durations — the same contract as `JUMP_*` and `LOOP_REVERSE_*`. Nothing in
the intro knows how long the pin takes; nothing in the pin knows how long the veil takes.

| event | fired by | means |
|---|---|---|
| `voidix:arrival-travel` | `IntroSequence` | *I own the screen and the lock is off — go.* Carries `{ key }`. |
| `voidix:arrival-settled` | `useHeroAnimation` | *The pin's progress is at the destination stop.* |
| `voidix:section-arrive` | `IntroSequence` | Reused as-is. Fired as the veil starts fading, so the section assembles through the reveal. |

New file `lib/arrivalEvents.ts`, mirroring `lib/sectionJumpEvents.ts` in shape and in commentary.

### 3.3 `lib/arrivalSection.ts` — one reader of the hash

```ts
/** The section named in the URL on arrival, read and CONSUMED exactly once. */
export function readArrivalSection(): string | null
```

- Memoised at module scope, resolved on the first call, guarded for SSR. Both `IntroSequence` and
  `useHeroAnimation` ask, in whichever order React mounts them, and get the same answer.
- Consuming means `history.replaceState` — lifted verbatim from today's `consumeArrivalHash`
  (`useHeroAnimation.ts:1574`), including its reason: a leftover hash re-triggers the journey on a
  reload **and on the loop's teleport back to the hero**.
- Validated through `findNavItem`, so `/#anything-else` is ignored rather than travelled to.

### 3.4 `useHeroAnimation.ts`

**One code path, one flag.** The covered-jump machinery already does everything an arrival needs —
gesture swallowing, the glide, the epsilon arrival detection, the two safety nets. The change is to
give `coveredJump` a `mode` and branch only where the *finishing dispatch* differs.

```ts
let coveredJump: {
  targetStop: number;
  durationSeconds: number;
  mode: 'jump' | 'arrival';        // ← the whole of the addition
} | null = null;
```

- `finishCoveredJump()` dispatches `JUMP_ARRIVED_EVENT` for `'jump'` and `ARRIVAL_SETTLED_EVENT` for
  `'arrival'`. Everything above it — `lockStepping(JUMP_ARRIVE_HOLD_MS)`, the net-clearing, the flag
  reset — is shared and untouched.
- `runReveal()` gains an arrival branch:
  ```ts
  createTransition();
  if (arrivalKey) settleHeroEntrance();   // instant final pose — see the trap in §3.6.3
  else            playHeroEntrance();
  ```
  and **no longer calls `requestSection`** — that call is what produced the second cover.
- New listener on `ARRIVAL_TRAVEL_EVENT`: resolves the key to a stop the same way `onGotoSection`
  does, then `beginCoveredJump(..., mode: 'arrival')` *skipping the cover request* — the loader is
  already the cover, so it goes straight to `startCoveredGlide()`.
- **Net:** if `runReveal` fires with an arrival pending and no `ARRIVAL_TRAVEL_EVENT` follows within
  `ARRIVAL_TRAVEL_FALLBACK_MS` (~2s), fall back to today's `requestSection(key)`. That covers a
  bypassed or crashed intro — the reveal fallback timers can fire with no `IntroSequence` alive at
  all. The old behaviour is the degraded mode, which is the right shape for a net.

### 3.5 `IntroSequence.tsx`

- Reads `readArrivalSection()` on mount, into a `const` the effect closes over.
- **Corner chrome.** `Entering the void` becomes `Bound for 02 · Work` when arriving. Static markup
  carrying `.intro-chrome`, so the existing fade-in and fade-out already cover it; the number and
  label come from `findNavItem`, never typed.
- **The finale's branch.** Everything up to and including `waitForAssembly` is byte-identical. From
  the `handoff` label:

  | today | arriving |
  |---|---|
  | `IGNITE_EVENT` | `IGNITE_EVENT` (kept — the dust's last rush still resolves, under the veil) |
  | chrome + wordmark + counter → `autoAlpha: 0` | same |
  | **veil → `autoAlpha: 0`** | **veil untouched** |
  | `parkSunInO` then flight tween `→ x:0, y:0, scale:1` | `gsap.set` to the same values (see §3.6.1) |
  | `revealHero()` at `>-0.1` | `revealHero()`, then `unlockScroll()`, then `ARRIVAL_TRAVEL_EVENT` |
  | `SETTLE_AFTER_REVEAL` hold | `addPause` on `ARRIVAL_SETTLED_EVENT`, capped |
  | — | `SECTION_ARRIVE_EVENT`, veil → `autoAlpha: 0`, `setDone(true)` |

- `ARRIVAL_WAIT_MAX_MS` — the cap. Must clear `NAV_JUMP_MAX_DURATION` (3.2s) + the scrub's settle
  (`SCROLL_SCRUB` 1.8) + `JUMP_ARRIVE_GRACE_MS` (2.5s). **8000** with margin. Like every other cap in
  this file it exists so a page whose pin failed cannot strand the visitor behind a black veil.
- **Reduced motion** has its own early-return path (`IntroSequence.tsx:459`) and needs the same
  branch: after `revealHero()` + `unlockScroll()`, dispatch `ARRIVAL_TRAVEL_EVENT` and hold
  `setDone(true)` until settled or capped. It is not optional — that path is common on iOS.

### 3.6 The traps

**1 · `BLACK_STAGE_EVENT` will kill the sun's flight tween.** `HeroSun.tsx:200` runs
`gsap.to(flight, { scale, overwrite: true })` whenever the fill boundary is crossed — which the
arrival's glide crosses *by definition*. A flight tween still running would be overwritten mid-air
and the star would be stranded at its "o" offset for the rest of the session. **The arrival must
`gsap.set` the flight home, never tween it.** Safe to do invisibly, because…

**2 · …`REVEAL_EVENT` puts the star behind the veil.** `onReveal` moves it `Z_DURING_INTRO` 10001 →
`Z_AFTER_INTRO` 9500, and the veil is 10000. So the star vanishes behind the veil on the frame the
pin is built. Two consequences: the `gsap.set` in trap 1 is free, and **the star needs a short
`autoAlpha` fade before that frame** or it blinks out. Fade it out over ~0.25s, `set` the transform,
fade it back to 1 while it is safely behind the veil — so it is present and correctly placed when the
veil finally lifts on the destination.

**3 · The hero must not be left staged.** `playHeroEntrance` is what leaves the headline out of its
masks and the square filled. Skipping it entirely leaves the hero permanently half-built for anyone
who later scrolls back up (the loop replays it; a manual scroll up does not). Extract the existing
reduced-motion branch of `playHeroEntrance` as `settleHeroEntrance()` — three `gsap.set`s that
already exist in that function — and call it on the arrival path. **No new values.**

**4 · Unlocking scroll before the travel opens a one-tick window.** `unlockScroll` removes the
non-passive `wheel`/`touchmove` blockers. Mitigation: `unlockScroll()` and the
`ARRIVAL_TRAVEL_EVENT` dispatch happen **in the same synchronous callback**, and the pin sets
`coveredJump` synchronously in its listener — so `swallowDuringGlide` (`useHeroAnimation.ts:2001`)
owns every gesture from the next event onward, and `lockStepping(JUMP_ARRIVE_HOLD_MS)` covers the
tail. No frame passes unguarded.

**5 · Contract 1 says the lock is released exactly once, in `onComplete`.** It still is — just
earlier on this one path. `unlockScroll` is idempotent (a `classList.remove` and three
`removeEventListener`s), so the `onComplete` call remains harmless. **The contract's comment in
`IntroSequence` must be amended to say so**, or the next person reads a rule the code no longer keeps.

**6 · Nothing in the journey is skipped.** The glide is the ordinary `goToStop`. Every crossing is
scrubbed, `setStage` fires its `DECK_REVEAL_EVENT` / `DECK_HIDE_EVENT` as usual, the chamber room and
the contact star are built on the way past, and `adaptivePixelRatio` freezes across the crossings
exactly as it does for a covered jump. **The arrival is not a new journey — it is the existing one
with a different curtain.**

**7 · `--nav-progress-*` is published by the glide**, so the meters arrive correct with no extra work.

**8 · `SkipToLite` should carry the destination**: `/lite` → `/lite#work`, once Part B gives `/lite`
those anchors. One line, and it makes the escape hatch honour the intent instead of dropping the
visitor at the top of a document.

### 3.7 Optional, Phase 2 — name the destination on the hold

The jump veil holds a real transit card (`02 / Work`, the section's own headline, two derived
readouts — `jumpDestinations.ts`). The arrival hold is currently a fading wordmark. Extracting that
card into `components/effects/SectionJumpVeil/JumpDestinationCard.tsx` and rendering it inside the
loader too would give both holds one voice.

**Deliberately split out.** It is a refactor of a working component for presentation only, and
Part A is worth shipping without it. The corner-chrome line in §3.5 already answers "where am I
going" for a fraction of the risk.

---

## 4 · Part B — `/lite` keeps you on `/lite`

### 4.1 The mapping, and how to not have one

`LITE_SECTIONS`' keys are `build` / `work` / `questions`; the navbar's are `services` / `work` /
`faq` / `contact`. A translation table between them is a second place that names a section, which is
the thing `navItems.ts` and `docSections.ts` both open by arguing against.

**So: rename lite's keys to the navbar's, and the map disappears.**

```ts
export const LITE_SECTIONS: readonly DocSectionMeta[] = [
  { key: 'services',  number: '01', title: 'What we build' },   // was 'build'
  { key: 'work',      number: '02', title: 'Selected work' },
  { key: 'faq',       number: '03', title: 'Questions'     },   // was 'questions'
];
```

`key` is only the anchor `id`, the React key and the rail node's href (`DocSection.tsx`,
`OrbitRail.tsx`). **Nothing the visitor reads changes** — the titles are untouched. `aria-labelledby`
follows automatically because it is derived from the same key.

`contact` has no numbered section, and should not get one — the close is the page *ending*, not a
fourth thing the page says, which is why it carries no rail station (`LitePage.tsx:139`). It gets a
plain anchor instead: `<div className="doc-close" id="contact">`.

```
   /lite
   ┌────────────────────────────────────────┐        navbar
   │  masthead                              │        ┌──────────────────────┐
   │                                        │        │ 01 Services  ────────┼──┐
   │  ● 01  WHAT WE BUILD      #services ◄──┼────────┤ 02 Work      ────────┼┐ │
   │  │ 02  SELECTED WORK      #work     ◄──┼────────┤ 03 FAQ       ───────┐││ │
   │  ● 03  QUESTIONS          #faq      ◄──┼────────┤ 04 Contact  ──────┐ │││ │
   │                                        │        │ [Start Project] ──┤ │││ │
   │  the close             #contact     ◄──┼────────┴───────────────────┘ │││ │
   │   └ Start a project ─► EnquiryPanel    │                              │││ │
   │  footer                                │                              │││ │
   └────────────────────────────────────────┘                              │││ │
                                    smooth scrollIntoView, scroll-margin-top ─┘
```

### 4.2 `lib/inPageSectionRoutes.ts`

```ts
/** Routes that carry the navbar's sections as real in-page anchors, so a nav click stays put. */
export const IN_PAGE_SECTION_ROUTES = new Set(['/lite']);

/** Travel to a section on such a route. Returns false if it isn't there — let the href do its job. */
export function scrollToSection(key: string): boolean
```

`scrollToSection` is `OrbitRail.travelToSection`'s body, lifted and shared — including both of its
reasons, which apply here unchanged:
- **`scrollIntoView`, not a hand-built `scrollTo`**, because only it honours `scroll-margin-top`,
  without which a travelled-to heading parks under the fixed navbar.
- **Not a bare `#anchor` href**, because making one glide means `html { scroll-behavior: smooth }`
  globally, and that is precisely what fights ScrollTrigger on the homepage — which shares this
  stylesheet.

`OrbitRail` then calls the shared function rather than keeping its own copy.

### 4.3 `Navbar.tsx` — a third route mode

Today the bar has two modes. It gets a third, resolved once from `usePathname`:

| mode | routes | a nav click does |
|---|---|---|
| `pin` | `/` | `requestSection(key, origin)` — the pin drives itself |
| `in-page` | `/lite` | `scrollToSection(key)`, `preventDefault` **only on success** |
| `navigate` | `/about`, `/careers`, anything else | falls through to the `href` → §A's arrival |

- **`href` follows the mode**: `#services` in `in-page`, `/#services` otherwise. A resolver
  `hrefForMode(item, mode)` beside `NAV_ITEMS`. This matters for middle-click, for copy-link, and for
  the no-JS case.
- **The CTA** (`Start Project`) in `in-page` mode scrolls to `#contact` — the close, where the page's
  own *Start a project* button and its `EnquiryPanel` already are. Deliberately a scroll and not a
  cross-component "open the panel" event: the button is 40px from where you land, and a new event to
  reach into a page's local `useState` is machinery this doesn't need.
- **`handleStationSelect`** (the phone's orbit fan) currently does `window.location.href = '/#key'`
  — a full page load. It routes through the same resolver, so the fan behaves like the bar on every
  route. ⚠ This is the item most easily forgotten: the fan is the *only* navigation below 51.25em.

### 4.4 The traps

**1 · The meters stay homepage-only.** `--nav-progress-*` has exactly one writer, the hero pin.
`/lite` must not start feeding them — `isHomepage` remains the gate for that block, and it is a
*different question* from the new mode. Three routes, two booleans, and they are not the same
boolean.

**2 · `.doc-close` needs `scroll-margin-top`.** `.doc-section` has it (`globals.css:6231`) with a
comment explaining the fixed 4.5rem navbar. The close has never been scrolled to before. Add it there
too; it is inert on `/about` and `/careers` until something scrolls to them.

**3 · Fall through, never swallow.** If `getElementById` misses — a key renamed on one side only —
`scrollToSection` returns false and the click is left alone, so the `href` navigates to `/#key` and
Part A catches it. A silently dead nav item is the failure mode to design out; `OrbitRail` already
makes exactly this choice and says so.

**4 · `/lite` is `robots: { index: false }`.** Anchors on it are internal navigation only; nothing
here creates an indexable duplicate of the homepage's sections.

**5 · `/about` and `/careers` are NOT in-page routes** and must not be added. They have none of these
sections — they have their own, on their own rail. They keep the `navigate` mode and get Part A's
arrival, which is what the ask actually was for them.

---

## 5 · Reduced motion

- **Part A:** `IntroSequence`'s quiet path gets the same branch (§3.5). The pin's `reduceMotion`
  already sets the glide duration to 0; the scrub still eases, and the epsilon arrival detection
  handles that unchanged.
- **Part B:** `scrollToSection` passes `behavior: prefersReducedMotion() ? 'auto' : 'smooth'` — the
  same call `OrbitRail` makes today.

---

## 6 · What this deliberately does not touch

- The scroll spine, the crossings, the carousel layout, `carouselLayout.ts`.
- `SectionJumpVeil` and the `JUMP_*` handshake — a navbar click *on the homepage* behaves exactly as
  it does today. The arrival is a parallel path, not a rewrite of that one.
- The loader's gate, its serial waits, the burn-in, the quality allocator. The arrival branch begins
  strictly after `SUN_ASSEMBLED_EVENT`.
- `/about` and `/careers` markup and copy.
- Any visible copy on `/lite` (§4.1 renames keys, not titles).

---

## 7 · Order of work

| # | Change | Independently shippable |
|---|---|---|
| 1 | `lib/arrivalSection.ts`, `lib/arrivalEvents.ts` | — |
| 2 | `useHeroAnimation`: `mode` on `coveredJump`, `settleHeroEntrance`, the travel listener, the net | — |
| 3 | `IntroSequence`: the arrival branch + the destination chrome (both paths) | ✅ Part A done |
| 4 | `liteContent.ts` keys + `id="contact"` on the close + `.doc-close` scroll margin | — |
| 5 | `lib/inPageSectionRoutes.ts`; `OrbitRail` reads it | — |
| 6 | `Navbar`: the three modes, the href resolver, the CTA, `handleStationSelect` | ✅ Part B done |
| 7 | *(optional)* `SkipToLite` carries the section; the shared transit card (§3.7) | — |

---

## 8 · Verification

`npx tsc --noEmit` and `npm run build`, then **the user runs it** — these are all timing and
compositing behaviours that only show up in a browser.

What to look at:

1. `/about` → **Work**. The hero must never appear. One curtain, not two. The star must be in the
   right place and the right size when the veil lifts, and must not be stranded off-centre.
2. Same, to **Services**, **FAQ**, **Contact** — Contact is the long one (it crosses the chamber
   reveal and builds the singularity on the way).
3. `/about` → **Work** with reduced motion on.
4. Land at **FAQ**, then scroll **up** all the way to the hero: the headline must be out of its
   masks and the square filled (trap §3.6.3).
5. Land at **Contact**, then take the loop forward, and the reverse loop back.
6. A homepage nav click, from the homepage — must be unchanged.
7. `/lite`: all four items and the CTA, on desktop and through the phone's orbit fan. Each must land
   with its heading clear of the navbar, and none may navigate away.
8. `/lite` with JavaScript off: the four hrefs must still be real anchors that work.
