# The reverse loop — travelling back to contact

> **Status: BUILT**, 2026-08-15. §1's two bugs are fixed and §2–§6 shipped. **§6 ② was wrong and the
> correction is the most important thing in this document — see §8.**

The site loops: contact → dive into the black hole → teleport → cream flood → hero. There is no way
back. This is the way back.

---

## 1 · What was already wrong, and is now fixed

Both of these were found while looking at the loop and are shipped independently of the feature below.

### 1a · The cream flood had a torn black border

The arrival's cream is a full-viewport layer carrying an SVG displacement filter:

```
feDisplacementMap scale=70   →   every pixel moves by up to ±35px
                                 by SAMPLING a neighbour
```

At the element's own edge the neighbour it samples is **outside the source graphic**, which is
transparent. So once the flood reached full coverage the frame looked like this:

```
   ▓▓▓░░▓░▓▓▓░░░▓▓▓▓░▓▓░▓▓▓▓░░▓▓        ▓ = near-black page showing through
   ░                            ░       ░ = torn, displaced nothing
   ▓        cream #e2dfd2       ▓
   ░                            ░       …a ripped stamp, not a liquid
   ▓▓░▓▓▓░░░▓▓▓░▓▓░░▓▓▓▓░▓▓░░▓▓▓▓
```

**Fix:** overscan the cream layer by `inset: -4rem`, comfortably past the ±35px the displacement can
reach, so the tear happens off-screen. The displacement is not reduced — it is the whole effect, and
the same number draws the *flood's* edge mid-frame, where it is wanted.

⚠ **Raise `scale` on the filter and the overscan has to follow it.**

### 1b · The second lap landed on craft 02

`justTeleported` suppresses the carousel's arrival glide for one update after the teleport. It was
only ever cleared *below* the fill's early return — and after a teleport **every** update is a fill
update, so the flag stayed raised for as long as the visitor stood on the hero:

```
 teleport ──► fill update ──► fill update ──► … ──► first update past the fill
              (returns early,   (same)                justTeleported is STILL true
               flag not cleared)                      → arrival glide SKIPPED
                                                      → the flick's momentum is not absorbed
                                                      → you land on craft 02
```

**Fix:** clear it in the fill branch too. The guard's real job survives — a genuinely *stale* update
carries the pre-teleport progress (≈1), which is past the fill, so it never reaches that branch and is
still caught below.

---

## 2 · The feature: what the visitor gets

Two ways to ask, one commit path — the same rule the forward loop follows, and for the same reason (a
button that scrolled by itself would be a second path through one cinematic, and the two would drift
the first time the dive's length changed).

1. **A button on the hero.**
2. **Scrolling up at the top of the page**, where today nothing happens at all.

And what they see is a **black iris closing inward from the edges**, and then **the dive played
backwards**: the cover opens from the middle onto a heavily lensed black hole, the lensing relaxes into
a plain one as the camera pulls out, and the contact copy fades back up around it.

---

## 3 · The shape — the forward loop, mirrored

The forward loop, as it plays:

```
  CONTACT ── zoom IN, lensing grows ──► frame goes fully BLACK ──► cream floods
             (the dive, scroll-scrubbed)      (teleport in here)    from the MIDDLE out
                                                                        │
                                                            hero content + sun appear
```

So the reverse is that read backwards, beat for beat:

```
  HERO ── black closes from the EDGES in ──► solid BLACK ──► iris opens from the middle
          (the iris — a liquid mask)         (teleport      onto heavy lensing, ALREADY
                                               in here)      zoomed in
                                                                  │
                                                       zoom OUT: the lensing relaxes into
                                                       a plain black hole
                                                                  │
                                                       contact's content fades back in
```

⚠ **The zoom-out is authored; nothing scrolls.** The first build made the return the dive *scrubbed
backwards*: park the scrollbar partway into the dive, then glide it to contact. Elegant on paper — and
it shipped three defects at once, all of them consequences of that one decision. See §10.

What replaced it is smaller. The jump lands on the **contact stop**, the settled state a covered nav
jump has produced since the navbar was wired, and the pin then **does not move again**. The zoom-out is
one tween of one number, and everything it drives — the camera's distance, the lensing's strength and
liquid, the horizon's shadow, the contact copy's fade — is already a pure function of that number, so
there is nothing else to write.

Two contributors, one published value, combined rather than taking turns:

```
  published dive = max( crossing , arrival )
                        │          └─ the return's zoom-out, tweened by the pin
                        └─ the scroll, resting at 0 for the whole return
```

`max`, so the arrival can never be pulled down by the crossing sitting at its resting 0 — and a visitor
who scrolls down mid-arrival is handed straight back to the scroll, because the crossing's rising value
simply overtakes the decaying one. It is the shape `combineChamberTarget` already uses in the works
field, for the same reason.

## 4 · The one number that matters — and the first value of it was wrong

`REVERSE_ENTRY_DIVE_PROGRESS` — where the teleport parks inside the dive.

**It shipped at 0.98 and that was a bug**, reported as *"when I go back to contact there is no black
hole."* There was one; you were inside it.

```
   0 ─── 0.2 ────────── 0.6 ───── 0.68 ───────── 0.93 ── 1.0
   │      │              ▲          │              │      │
 contact  LOOP_CONTACT_ PARK    DIVE_BLACKOUT   whole   commitTeleport
 lands    UI_FADE ends  HERE    starts          frame   fires at EXACTLY 1
                                                black
```

`DIVE_BLACKOUT` is `[0.68, 0.93]`. At 0.98 the lensing pass paints the entire frame black and the camera
sits at the origin, inside the horizon — so the cover opened onto nothing, and the glide's
`power2.inOut` ease meant it *stayed* on nothing for the first seconds of the return.

The mistake was picking the number against the **boundary** (how close can I get to 1 without touching
it?) instead of against the **windows the dive actually has**. 0.6 is picked the second way:

| bound | why |
|---|---|
| below `DIVE_BLACKOUT[0]` = 0.68 | the shadow is at its resting value, so the hole is VISIBLE the instant the cover opens. This is the one that fixes the bug. |
| high enough for the lensing | the eased dive is ~0.65 here, so `DIVE_LENSING_STRENGTH`/`_LIQUID` are near full — the cover reveals a heavily lensed hole that then relaxes to a plain one. **That relaxation is the shot.** |
| above `LOOP_CONTACT_UI_FADE`'s end = 0.2 | the contact copy is still hidden on arrival and fades in over the last fifth of the return, rather than being there to greet you. |

⚠ The old hazard is now academic and must stay that way: **exactly 1 commits the forward teleport**,
the one irreversible action on the site apart from the intro. Park on it and the reverse bounces into
the forward loop for ever.

## 5 · What has to change

| file | change |
|---|---|
| `lib/loopEvents.ts` | `LOOP_REVERSE_REQUEST_EVENT`. And **re-document** `LOOP_RESET_EVENT`: it means *"the scrollbar was thrown somewhere else outright — snap, do not ease"*, not *"…to the top"*. Every consumer already does `current = target`, which is direction-agnostic; only the prose is wrong. |
| `useHeroAnimation.ts` | `commitReverseTeleport()`, the mirror of `commitTeleport`. The scroll-up detector in `handleWheel` / `handleTouchMove`. A listener for the request. |
| `LoopVeil.tsx` | A third layer, `.loop-veil-iris`: black, liquid-filtered, closing inward and opening again. Plus a latch so the dive's progress reports do not kill it mid-close — see §6 ①. |
| `Hero/` | The button, and its gate. |
| `globals.css` | The button. |
| `CLAUDE.md` | The loop is bidirectional now; the ASCII spine at the top says it is not. |

---

## 6 · The four traps

**① The veil will kill its own flood.** `onLoopProgress`'s `progress <= 0` branch exists to clear the
cream when you scroll back *out* of a dive. During a reverse the dive sits at 0 (we are at the hero)
while the flood is running, so the very first progress event would kill it. Needs the same shape of
latch `coveringLoop` already uses — and for the same stated reason: *"latched rather than fixed by
reordering, because ordering is a timing fix and this needs to hold by construction."*

**② The pin jumps 0 → ~1, running every crossing at its end value in one frame.** This is the exact
mirror of the forward teleport and `LOOP_RESET_EVENT` already covers it. ✅ *Verified:* nothing has to
be **built** at that instant — `useWorksField`'s `beginPreflight` constructs the chamber and the
contact star in the loader, and `ensureChamber` / `ensureSingularity` remain idempotent safety nets on
the progress events.

**③ The deck/works gating.** Coming from the hero, the fleet has never been entered. The teleport must
leave `BLACK_STAGE_EVENT`, `DECK_HIDE_EVENT` and the stop bookkeeping in the state the loop stop
expects. To check during implementation, not assumed.

**④ Reversing mid-entrance.** The hero's entrance plays on `LOOP_COVERED_EVENT`. Refuse a reverse
request while it is running, the same way `onLoopRequest` refuses when `!hasRevealed`.

---

## 7 · Open questions

**7a · When is it available?** See the decision below — this is the one that changes the shape of the
work, because "always" means a first-time visitor can scroll up on the hero and be thrown to the end
of a site they have not seen.

**7b · What does the button say?** The forward one is *Travel in time* and goes to the beginning, so
the hero is the past and the return is a return to the present. Candidates: **Return to now**
(recommended — mirrors the fiction rather than the mechanism), *Travel forward*, *Back to contact*
(plain, and the only one that says where it goes).

**7c · Where does it sit?** Paired with `HeroScrollCue` at the bottom of the hero reads best — the cue
says *scroll on*, this says *or go back* — but the hero is the site's first frame and its Awwwards
shot. That is an argument for 7a's gated answer.

**Answered, and shipped as:** gated on a completed loop (7a); **"Back to the horizon"** (7b), which
names the event horizon — the thing actually waiting at the far end and the last thing seen before the
cream took the screen; bottom-centre of the hero, stacked above the narrow scroll cue (7c).

---

## 8 · ⚠ The correction: `LOOP_RESET_EVENT` is NOT direction-agnostic

§6 ② said the pin jumping 0 → ~1 "is the exact mirror of the forward teleport and `LOOP_RESET_EVENT`
already covers it." **That was wrong, and it would have broken the feature silently.**

The event's own documentation described it as forcing `current = target`. The handlers do no such
thing — **every one of them writes ZERO**:

```
useWorksField.onLoopReset      SunModelCanvas.onLoopReset
  chamberState.reveal  = 0       revealProgress = 0
  chamberState.contact = 0       targetCracks   = 0
  flightState.target   = 0       targetCollapse = 0
  diveProgress         = 0       cracks         = 0
  singularity.reset()            collapse       = 0
```

Which is correct — the forward loop's destination *is* progress 0, so it can afford to hardcode it.
And it means the event cannot be reused by a jump that lands anywhere else. Fired after a reverse, it
would have told every scene to be at the **hero's** state while the pin sat at the **bottom** of the
page: no chamber, no black hole, the star alive, and the cream lifting on all of it.

**The fix is `LOOP_SNAP_EVENT`** — the direction-agnostic half. `current = target`, and nothing else.
It never writes a target, because by the time it fires the targets are already right:

```
  commitReverseTeleport()
    scrollTo + trigger.scroll         move the scrollbar
    trigger.update()                  ┐ flush the 1.8s scrub, or the pin eases down the
    trigger.getTween().progress(1)    ┘ whole page playing every crossing forwards

    applyCrossings(targetProgress)          ⚠ BY HAND. trigger.update() makes progress true
    applyHeroServicesProgress(targetProgress)  "on the next frame", one frame too late for a
                                               snap that has to read the new targets.
    dispatch LOOP_SNAP_EVENT          ← only now. Fire it first and every scene snaps to
                                        the state it is LEAVING, which is worse than not
                                        snapping at all: an eased value at least arrives.
```

`singularityScene` needed a matching `settle()` beside its `reset()` — the mirror, landing on the END
of whatever is being asked for. Only `sequence` is time-driven in the finale; everything else is a
closed-form function of it, of `presence` or of `dive`, all three of which the crossings have already
set. Hence three lines, not a second copy of the scene's state.

**The general lesson**, which is why this section exists: *a signal named for a destination cannot be
reused for a different destination, however direction-agnostic its prose claims to be.* Read the
handlers, not the doc comment. The doc comment was wrong for months and nothing noticed, because until
now there was only ever one place to jump to.

---

## 8b · ⚠ The transient that killed the arrival — and why a scrubbed pin needs THREE defences

Second report after §4's fix: *"the lensing appears for a split second then disappears and I cannot
see the model."* Both halves are one cause.

`CONTACT_STAR_PRESENCE` is `[0.18, 0.42]`, and `presence` multiplies **everything** in this scene:

```
  group.visible      = ready && presence > PRESENCE_EPSILON      ← the black hole MODEL hangs off this
  lensing strength   = max(finale, dive) × presence               ← …and so does the lensing
```

So one report of `contact` below 0.18 takes the model and the lensing **together**, which is exactly
the pair of symptoms. And `contact` below 1 also disarms: the horizon then rewinds over
`FINALE_REWIND_SECONDS` and has to climb back over `FINALE_SECONDS` — seconds of nothing.

Where does a low `contact` come from when the pin was just parked at ~0.97? **The pin is scrubbed.**
`SCROLL_SCRUB` is 1.8s, and `commitTeleport`'s own note admits the flush only makes progress true *"on
the next frame"*. In between, the pin can publish one update carrying a progress it is still easing
away from. Forward that is harmless — the destination is 0, so a stale report is wrong in the direction
everything is already heading. **Backwards it is fatal**, and nothing in the codebase had ever needed to
care, because until now every jump landed at 0.

Three defences, each closing a different frame:

| | where | closes |
|---|---|---|
| **hold** | `REVERSE_HOLD_SECONDS` — the pull-out waits before the scroll tween starts | the window where a glide drags the pin before it has finished landing |
| **re-assert** | one `requestAnimationFrame` after the jump, re-apply the parked crossings + snap | the single stale update, if one lands |
| **guard** | `settleGuardSeconds` in `singularityScene` | every frame in between — a settle may not be walked BACK by a later report |

⚠ The guard is a guard on a **transient**, not a second owner of the state: it only refuses reports
that would lower presence or disarm, only for 2.4s after a settle, and nothing in it writes a value it
was not given. Reports moving the other way land immediately.

⚠ And the general lesson, which is the one worth carrying: **`SCROLL_SCRUB` means the pin's progress is
not trustworthy for one frame after any programmatic jump.** Every existing consumer got away with it
because the only jump was to 0. Any future jump to a non-zero destination inherits this problem and
needs the same three answers.

---

## 10 · ⚠ Why the scrubbed-glide version had to go — three defects, one decision

Reported: *"the black comes from the edges but never reaches the middle — there is a hole, and through
it I can see the website scrolling; then the black stays and I can see only part of the black hole."*
Every clause is a separate bug, and two of them are mine outright.

**① The iris never closed.** The mask was
`radial-gradient(…, transparent R%, black (R+9)%)` with `R` tweened to 0 — so the shut state was
`transparent 0%, black 9%`, which is not black, it is black *with a hole punched through the middle of
the screen*. The feather has to collapse with the aperture. It scales with it now, so shut is
`transparent 0%, black 0%`: opaque everywhere.

**② The iris froze.** It ran on `creamTimeline`, the forward arrival's variable — and
`onLoopProgress`'s `progress <= 0` branch **kills that timeline** (correctly: scrolling back out of a
dive must clear a half-played arrival). The first dive report of 0 during a return therefore killed the
cover mid-gesture and left the black stuck on screen. Two covers, two timelines, neither able to reach
the other.

**③ The site was visibly scrolling.** That was the `goToStop` glide doing exactly what it was told. It
is gone: there is no scroll in the return at all.

⚠ **The lesson is ③, not ① or ②.** Reversing a scroll-driven crossing by driving the scroll backwards
sounds like the smallest possible change — rule 2 seems to hand it to you free. It does not, because the
scrollbar is shared state with a scrubbed pin, a snap, a stepper and a teleport, and borrowing it for a
cinematic means every one of those has an opinion about where you are. Authoring the arrival against a
**still** pin is less code, has no shared state, and cannot be outrun.

---

## 11 · ⚠ The fill-exit arrival glide, which has now hijacked three different journeys

Reported: *"when I click back to the horizon it gets me to the first ship in services, and there is no
lensing."* One cause; the second clause is a symptom of the first (you never reach contact, so there is
no lensing to see).

`onUpdate` has a branch that fires the first time the pin passes out of the fill:

```ts
if (wasInFill && !justTeleported) {
  wasInFill = false;
  if (!committedGlide) goToStop(0, CAROUSEL_ARRIVAL_DURATION);   // stop 0 = CRAFT 01
}
```

It exists to absorb the momentum of the flick that carried you out of the hero — without it a hard
scroll overshoots onto craft 02. It is correct, and it is a **scroll hijack**: `goToStop` overwrites
whatever else owns the scrollbar.

`commitReverseTeleport` set `wasInFill = false` at its END, but `trigger.update()` drives `onUpdate`
**synchronously** several lines earlier. So at that instant the pin was already past the fill with
`wasInFill` still true — and the return glided to craft 01.

⚠ **The forward teleport never had to think about this, and none of its safety transfers.** Its
destination is progress 0, *inside* the fill, so its update takes the early return and the branch is
unreachable. Every jump that lands anywhere else inherits the problem.

**Third time.** The branch's own header records the other two: a navbar jump to Work "got overwritten
with a glide to craft 01" and needed a second click, and a stale update after the forward loop would
have "ended in SERVICES instead of the hero".

**The rule, which is the durable part:** *every piece of state `onUpdate` reads must be set BEFORE the
scrollbar is moved* — `committedGlide`, `currentStop`, `wasInFill`, `justTeleported`,
`lastCrossingProgress`, `lastCommittedIndex`. Moving the scroll is not a statement, it is a call into
`onUpdate`.

### The full scroll-ownership map, since it is what makes this class of bug possible

Only five things ever write the scroll position on the homepage:

| writer | when |
|---|---|
| `goToStop` → `gsap.to(window, {scrollTo, overwrite: true})` | the stepper, navbar jumps, covered jumps, **the fill-exit arrival** |
| `commitTeleport` → `scrollTo(0,0)` | the forward loop |
| `commitReverseTeleport` → `scrollTo(contact stop)` | the return |
| ScrollTrigger's own `snap` | when scrolling settles |
| `IntroSequence` → `scrollTo(0,0)` | while the loader holds the page |

And four intercept gestures: the pin's `handleWheel`/`handleTouchMove` (`preventDefault` in the carousel
region), `swallowDuringGlide`, `useModalLayer` and `useScrollGuard` (both `stopPropagation`), plus the
intro's lock.

⚠ **The return now touches none of them.** It does not call `goToStop`, so the glide primitive cannot
fight it; the pin does not move after the jump, so `snap` resolves to the stop it is already on; and
`lockStepping` plus `carouselDirection` swallow the residual wheel momentum of the gesture that asked
for it. That is the main practical argument for §10's decision, beyond the three defects it fixed.

---

## 9 · Two more things the build added that the plan did not have

**9a · The net.** Between the request and the cover answering, `reverseActive` makes the pin swallow
every wheel and touch — so if the answer never comes the page is not merely stuck on the hero, it is
**unscrollable**. `LoopVeil` is mounted in `page.tsx` and normally answers in ~1.15s, but *normally* is
not a guarantee. `REVERSE_COVER_NET_MS` (2600) proceeds without it, which is the same call
`armCoveredJumpNet` makes for the same situation: a transition you can see is a blemish, a page that
ignores the wheel is a bug report.

**9b · `setStage('contact')`, explicitly.** The stop the reverse parks on belongs to the `loop`
section, whose `enterLoop` is a deliberate no-op — going forwards you can only reach it *from* contact,
with every DOM change already made. Arriving there from the hero, nothing would have added
`.is-services`, and the cover would have lifted on a cream page with the headline still on it.

**And one thing that turned out to be free:** the reverse's end state is identical to a covered nav
jump from the hero to contact, which the navbar has done since it was wired. Same crossings at 1, same
`fill → contact` stage change, same lazily-built scenes (both preflighted in the loader — see
`useWorksField`'s `beginPreflight`). The only differences are the dive parked at 0.98 instead of 0 and
a cream cover instead of a black one.
