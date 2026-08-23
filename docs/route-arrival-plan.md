# Arriving from another route

> **BUILT, 2026-08-16 — both parts.**
>
> Two defects, one shared cause: *the navbar's four sections only exist on `/`, and every other route
> reaches them by leaving.* Part A fixes what `/about` and `/careers` do about that. Part B stops
> `/lite` needing to do it at all.

---

## 0 · What was wrong

### A · `/about`, `/careers` → the homepage showed you the hero first

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

Nothing there was broken — every piece was doing its job. The defect was **ordering**: the loader's
handoff and the jump's cover are two separate curtains, and the hero was shown in the gap between
them. Roughly **2.5–3 seconds of a section the visitor did not ask for**, followed by a second
full-screen cover.

`JUMP_SECTION_DISTANCE` is `1` (`useHeroAnimation.ts`), so this was true of **all four**
destinations, Services included.

### B · `/lite` sent you away for sections it already has

`/lite` renders the same three registries the homepage does, yet answered every nav click by fetching
the ten megabytes it exists to avoid — **including the phone's orbit fan, which is the only
navigation below 51.25em.** Not a small leak: the whole purpose of the page, undone by the chrome
around it. See §4.

---

## 1 · The constraints (which the fix does not get to break)

1. **Contract 2** — the pin is created *only* in the `REVEAL_EVENT` handler.
2. **`goToStop` needs the pin.** Before it exists the call degrades to setting an index.
3. **`html.scroll-locked` is `overflow: hidden`.** `window.scrollTo` and `trigger.scroll()` both
   no-op under it. **The travel cannot happen while the intro's lock is on.**
4. **The journey must be travelled, never teleported.** The chamber room and the contact star are
   built lazily off crossing progress; a teleport arrives in a room that was never created.
   `lib/sectionJumpEvents.ts` records this at length.

Constraint 3 is why the loader used to have to get out of the way before the travel could begin. It
is also why the old order was what it was rather than an oversight.

---

## 2 · What was built: the loader IS the cover

```
  ┌─ THE LOADER (byte-identical to an ordinary load) ────────────────────────┐
  │  dust field · counter · telemetry · the gate                             │
  │  corner chrome reads:   BOUND FOR 02 · WORK           ← the one new line  │
  │  finale: wordmark resolves · the ten shards assemble the star in the "o"  │
  └──────────────────────────────────────────────────────────────────────────┘
                                   │
                    ╔══════════════╧═══════════════╗
                    ║   6b · THE ARRIVAL           ║   the veil NEVER lifts here
                    ╚══════════════╤═══════════════╝
                                   │
   chrome + star fade out          │  0.4s — the loader's whole picture leaves as one thing
                                   │
   ▼ handOffToArrival(), inside the pause's own callback
   1. revealHero()                 │  pin built · star z 10001 → 9500, i.e. BEHIND the veil
   2. gsap.set(flight, home)       │  ⚠ a set, never a tween — see the trap below
   3. unlockScroll()               │  ⚠ must precede the travel
   4. requestSection(key, _, true) │  `alreadyCovered`
                                   │
        ┌──────────────────────────┴────────────────────────────┐
        │  the EXISTING covered-jump path, unchanged            │
        │  JUMP_BEGIN {alreadyCovered} → SectionJumpVeil enters │
        │  at the top of its HOLD: no collapse, card comes up   │
        │  JUMP_COVERED (next frame) ───────────────────────────┼──► loader veil fades, unmounts
        │  the glide runs, unwatched, every crossing scrubbed   │
        │  JUMP_ARRIVED → card out, hole opens, SECTION_ARRIVE  │
        └───────────────────────────────────────────────────────┘
                                   ▼
                              02 · WORK, arriving
```

**The transit card is the same one a navbar jump gets** — `02 / Work`, the section's own headline,
two derived readouts. One gesture means "you have been taken somewhere", whether the request came
from a click on this page or from a link on another one.

### Why the collapse is skipped rather than hidden

`.section-jump-veil` is `z-index: 10000` and sits *after* `IntroSequence` in `page.tsx`, so it
already paints above the loader. It was tempting to let the collapse run and rely on black-over-black
hiding it — but the two blacks are **not** the same: the cover is `#000` (deliberately, so it reads
the same over every section) and the loader's veil is `--bg`, `#060606`. Near-identical is not
identical, and a 92%-feathered disc between them is a soft edge sweeping the frame. **Two values that
happen to be close is not a mechanism.**

Skipping costs nothing, because the two halves already meet by construction: a full-radius disc and a
zero-radius hole are both "entirely black".

### What this deleted from the first draft of the plan

Reusing `SectionJumpVeil` removed an `ARRIVAL_TRAVEL_EVENT`, an `ARRIVAL_SETTLED_EVENT`, a
`mode: 'jump' | 'arrival'` on `coveredJump`, and a second arrival-detection path. The intro calls
`requestSection` itself and waits on `JUMP_COVERED_EVENT`, which already existed.

---

## 3 · The files, and the traps in each

| file | change |
|---|---|
| `lib/arrivalSection.ts` **(new)** | reads and **consumes** the hash once, memoised. Three modules ask in an order React decides; whoever asks first spends it. |
| `introEvents.ts` | `MINIMUM_LOADER_ARRIVAL_MS` + `minimumLoaderMs()`. |
| `GatherCanvas.tsx` | paces its drawings off `minimumLoaderMs()`. |
| `sectionNavigation.ts` | `alreadyCovered` on `GotoSectionDetail`; third arg to `requestSection`. |
| `sectionJumpEvents.ts` | `alreadyCovered` on `JumpBeginDetail`. |
| `SectionJumpVeil.tsx` | the already-covered entry. |
| `useHeroAnimation.ts` | `settleHeroEntrance`, forced covered path, the net. |
| `IntroSequence.tsx` | `handOffToArrival`, branch 6b, the destination line, the quiet path. |

### The traps

**1 · `BLACK_STAGE_EVENT` will kill the sun's flight tween.** `HeroSun` runs
`gsap.to(flight, { scale, overwrite: true })` whenever the fill boundary is crossed — which the
glide crosses *by definition*. A flight tween still running would be overwritten mid-air and the star
would keep its "o" offset, hanging off-centre beside its square, for the rest of the session. **The
arrival fades the star out and `gsap.set`s it home. Never a tween.**

**2 · `REVEAL_EVENT` puts the star behind the veil.** `onReveal` moves it `Z_DURING_INTRO` 10001 →
`Z_AFTER_INTRO` 9500, and the veil is 10000. That is what makes trap 1's `set` free — and it is why
the star is faded out *first*, over `ARRIVAL_SUN_FADE`, so it leaves with the wordmark rather than
blinking out on the frame the pin is built.

**3 · The hero must not be left staged.** `settleHeroEntrance` is the old reduced-motion branch of
`playHeroEntrance`, extracted — no new values. Skipping the entrance entirely would leave the
headline under its masks and the square empty, permanently, for anyone who later scrolls back up.
(The loop replays it; a manual scroll up does not.)

**4 · Unlocking scroll before the travel opens a one-tick window.** `unlockScroll()` and
`requestSection` are in the same synchronous block, and the pin sets `coveredJump` synchronously in
its listener — so `swallowDuringGlide` owns every gesture from the next event onward, and
`lockStepping(JUMP_ARRIVE_HOLD_MS)` covers the tail. No frame passes unguarded.

**5 · Contract 1 says the lock is released exactly once, in `onComplete`.** It still is — just
earlier on this one path. `unlockScroll` is idempotent, so the `onComplete` call stays a no-op rather
than becoming a second release. **The comment in `IntroSequence` says so**; do not read the contract
without it.

**6 · `alreadyCovered` FORCES the covered path.** Both escape hatches in `onGotoSection` — reduced
motion, and the distance rule — would leave the visitor on a black screen that only
`JUMP_ARRIVED_EVENT` can open. Neither would fire in practice (an arrival starts at the hero, and
every section is at least `JUMP_SECTION_DISTANCE` away), but the guarantee must not rest on that.

**7 · The handoff runs inside the pause's own callback.** Two zero-duration items at one timeline
position resolve by insertion order, which is a fact about GSAP rather than a statement of intent. If
the pause won, the loader would hold for the full cap and only then ask to travel.

**8 · The loader must be unmounted before the hole opens.** The shortest glide (hero → Services) is a
little over a second; `VEIL_FADE_OUT` at 0.7s plus React's unmount is uncomfortably close to it, and
what it would cost is the destination revealed through a hole with the loader's veil still behind it.
Hence `ARRIVAL_VEIL_FADE` at 0.35 — which also stops `GatherCanvas` rendering onto a GPU that is at
that moment scrubbing several crossings.

**9 · The destination line is written by the effect, not rendered.** `readArrivalSection` reads
`location`, which does not exist on the server, so a branch during render is a hydration mismatch.
Same rule `GatherCanvas` follows.

**10 · Reduced motion has its own path and needed the same branch.** It is a common everyday setting
on iOS; without it, an arrival there would reveal the hero and have the pin's net drag the visitor
away a beat later — the exact two-curtain sequence this removes, on the platform least able to
absorb it.

**11 · Nothing in the journey is skipped.** The glide is the ordinary `goToStop`. Every crossing is
scrubbed, `setStage` fires its deck events, the chamber room and the contact star are built on the
way past, `--nav-progress-*` arrives correct, and `adaptivePixelRatio` freezes across the crossings
exactly as it does for any covered jump.

### The two nets

| net | where | catches |
|---|---|---|
| `ARRIVAL_HANDOFF_NET_MS` (1200) | `useHeroAnimation` | **no intro at all** — `runReveal` also fires off `REVEAL_FALLBACK_NO_INTRO_MS`. Falls back to the old behaviour: travel, uncovered, because nothing is covering anything. |
| `TRANSIT_COVER_WAIT_MAX_MS` (2500) | `IntroSequence` | **no transit cover** — `SectionJumpVeil` failed to mount. The loader fades out and the journey is watched. Sized just past the pin's own `JUMP_COVER_TIMEOUT_MS` (2000) so the pin moves *before* the veil lifts, and what is seen is travel rather than a stationary hero. |

---

## 3b · The loader floor

`MINIMUM_LOADER_MS` (6500) is a floor on the **show**, never on the work — everything downloads,
compiles and measures at full speed regardless. It exists because on a warm cache the gate is
satisfied in ~1.5s and the field would be released before finishing its first drawing.

An arrival gets `MINIMUM_LOADER_ARRIVAL_MS` (3500) instead. Someone who clicked *Work* on `/about` is
not being introduced: they have met the site, named where they want to be, and still have the shard
assembly and the travel itself ahead of them.

⚠ **Both readers go through `minimumLoaderMs()`.** `GatherCanvas` paces its drawings off the same
number, and a field budgeted for 6.5s in a loader that ends at 3.5s is cut off mid-drawing — which is
a worse picture than the one the floor protects.

⚠ **It only bites on a warm cache.** On a cold arrival the download is longer than either floor.

Time from clicking *Work* on `/about` to standing in Works, warm cache:

| | before | after |
|---|---|---|
| gate | 6.5s | **3.5s** |
| finale — wordmark + shards | 4.5s | 4.5s |
| veil lifts, sun flies to square | 1.2s | — |
| **hero entrance nobody asked for** | ~1.0s | — |
| jump cover closes over it | 0.55s | — |
| chrome + star fade, card up | — | 0.4s |
| the glide, card held | ~2.5s | ~2.5s |
| hole opens onto Works | 0.7s | 0.7s |
| **total** | **~17s** | **~11.6s** |

⚠ **No ordinary load changes.** `/` with no hash never enters any of this — same loader, same floor,
same hero, same star flight into the square.

---

## 4 · Part B — `/lite` keeps you on `/lite`

| navbar item | before | now |
|---|---|---|
| `01 Services` | load `/`, then §2 | scrolls to §01 *What we build* (`#services`) |
| `02 Work` | load `/`, then §2 | scrolls to §02 *Selected work* (`#work`) |
| `03 FAQ` | load `/`, then §2 | scrolls to §03 *Questions* (`#faq`) |
| `04 Contact` | load `/`, then §2 | scrolls to the close (`#contact`) |
| `Start Project` CTA | load `/#contact` | the same close, where the real button is |
| the phone's orbit fan | `window.location.href` | all four, as above |

### 4.1 Rename lite's keys instead of writing a map

A translation table between `build`/`work`/`questions` and `services`/`work`/`faq` is a second place
that names a section — the thing `navItems.ts` and `docSections.ts` both open by arguing against.

```ts
export const LITE_SECTIONS: readonly DocSectionMeta[] = [
  { key: 'services',  number: '01', title: 'What we build' },   // was 'build'
  { key: 'work',      number: '02', title: 'Selected work' },
  { key: 'faq',       number: '03', title: 'Questions'     },   // was 'questions'
];
```

`key` is only the anchor `id`, the React key and the rail node's href. **No visible copy changes.**
`contact` gets a plain `id` on the close block — not a numbered section, because the close is the
page *ending* and carries no rail station by design.

### 4.2 `lib/inPageSectionRoutes.ts`

`IN_PAGE_SECTION_ROUTES = new Set(['/lite'])`, plus `scrollToSection(key)` lifted from
`OrbitRail.travelToSection` and shared with it. Both of its reasons carry over: `scrollIntoView`
because only it honours `scroll-margin-top`, and not a bare `#anchor` because global
`scroll-behavior: smooth` is what fights ScrollTrigger on the homepage, which shares this stylesheet.

### 4.3 `Navbar.tsx` — a third route mode

| mode | routes | a click does |
|---|---|---|
| `pin` | `/` | `requestSection(key, origin)` |
| `in-page` | `/lite` | `scrollToSection(key)`, `preventDefault` **only on success** |
| `navigate` | `/about`, `/careers` | falls through to the `href` → §2's arrival |

- `href` follows the mode (`#services` vs `/#services`) — for middle-click, copy-link and no-JS.
- The CTA in `in-page` mode scrolls to `#contact`, where the page's own *Start a project* button is.
- ⚠ **`handleStationSelect`** (the phone's orbit fan) hard-codes `window.location.href = '/#key'` and
  is the *only* navigation below 51.25em. It is the item most easily forgotten.

### 4.4 Traps

1. **The meters stay homepage-only.** `--nav-progress-*` has one writer, the hero pin. `isHomepage`
   remains the gate for that block, and it is a *different question* from the new mode.
2. **`.doc-close` needs `scroll-margin-top`**, as `.doc-section` has, or Contact lands under the bar.
3. **Fall through, never swallow.** A missing id returns false and the `href` navigates — §2 catches
   it. A silently dead nav item is the failure mode to design out.
4. **`/about` and `/careers` are NOT in-page routes.** They have none of these sections.
5. `SkipToLite` carries the destination now — `/lite#work` when the loader was bound for Work. ⚠ It
   reads `readArrivalSection` **past its `if (!isOffered) return null`**, not at the top of the
   component: everything above that line runs on the server too, and only past it is the component
   client-only by construction (it has already been through an effect and a state change).

### 4.5 Verification

7. `/lite`: all four items and the CTA, on desktop and through the phone's orbit fan. Each must land
   with its heading clear of the fixed navbar, and **none may navigate away**.
8. `/lite` with JavaScript off: the four hrefs must still be real anchors that work.
9. `/about` and `/careers`: their nav items must still leave for the homepage, and land via §2.

---

## 5 · Verification

`npx tsc --noEmit` ✓ and `npm run build` ✓. The rest is timing and compositing and needs a browser:

1. `/about` → **Work**. The hero must never appear. One curtain. The star must be in the right place
   and the right size when the hole opens, and must not be stranded off-centre.
2. Same to **Services** (the shortest glide — check the loader is gone before the hole opens),
   **FAQ**, and **Contact** (the longest — it crosses the chamber reveal and builds the singularity).
3. `/about` → **Work** with reduced motion on.
4. Land at **FAQ**, then scroll **up** to the hero: the headline must be out of its masks and the
   square filled (trap 3).
5. Land at **Contact**, then take the loop forward, and the reverse loop back.
6. **A plain visit to `/`** — must be unchanged, including the 6.5s floor.
7. A navbar click from the homepage — must be unchanged.
