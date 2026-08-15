# The reverse loop — travelling back to contact

> **Status: PROPOSED.** Written 2026-08-15. The two bugs described in §1 are **FIXED**; §2 onward is
> the unbuilt feature.

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

And what they see is **the dive, played backwards**: the black recedes, the hole pulls away, the
contact form fades back up around it.

---

## 3 · Why this is nearly free

> *"Every visual in a crossing is a pure function of its progress `0..1`."* — CLAUDE.md, rule 2

That rule is what pays for this. **There is no reverse animation to write.** The dive already reverses
perfectly — scroll back out of it today and you are at the contact form again. All the feature has to
do is get the scrollbar to the far end of the dive without anyone watching, and then glide it back.

```
 ①  HERO, pin progress 0
     │   wheel-up at scrollY 0, or the button
     ▼
 ②  ASK FOR THE COVER                    LOOP_REVERSE_REQUEST_EVENT → the pin
     │                                   the pin locks stepping and asks LoopVeil to close
     ▼
 ③  CREAM FLOODS  ░▒▓█                   the arrival's own liquid flood, run as a CLOSE
     │                                   LoopVeil says LOOP_COVERED_EVENT when it owns the screen
     ▼
 ④  TELEPORT — unwatched                 scrollTo(dive at REVERSE_ENTRY_DIVE_PROGRESS)
     │                                   trigger.update(); flush the scrub tween
     │                                   dispatch LOOP_RESET_EVENT  ← every eased value snaps
     │                                   currentStop = loopStop
     ▼
 ⑤  CREAM CLEARS onto BLACK              the dive is at ~0.98: the hole owns the frame anyway
     │
     ▼
 ⑥  THE DIVE RUNS BACKWARDS              goToStop(contactStop, LOOP_STEP_DURATION)
     │                                   ── not new animation. The same scrubbed crossing,
     │                                      scrolled the other way. ──
     ▼
    CONTACT
```

Compare the forward loop, which is the same four beats in the other order:

```
  FORWARD   contact ─ dive (scrub) ─► black ─ teleport ─► cream floods ─► cream clears ─► hero
  REVERSE   hero ─ cream floods ─► teleport ─► cream clears ─► black ─ dive (scrub) ─► contact
```

---

## 4 · The one number that matters

`REVERSE_ENTRY_DIVE_PROGRESS = 0.98` — where the teleport parks inside the dive. It is bounded on
**both** sides and neither bound is cosmetic:

```
  0.82 ─────────── 0.97 ──── 0.98 ──── 0.995 ─────────── 1.0
   │                │          ▲          │               │
   │                │          │          │               └─ applyContactToHeroLoop fires
   VEIL_BLACK_IN    black is   PARK        1 − CROSSING_      commitTeleport at EXACTLY 1
   starts           fully in   HERE        SNAP_EPSILON       — the forward loop
                                           (rounds up to 1)
```

- **Above 0.97** so the screen is already black by the veil's own rule when the cream clears. A soft
  bound: if it drifted you would see a hair of the hole, not a break.
- **Below 0.995** or `applyCrossings` rounds it to 1 — see `CROSSING_SNAP_EPSILON`.
- **Below 1**, which is the hard one. Exactly 1 fires `commitTeleport`, and *"this is the one
  irreversible action on the site apart from the intro"*. **Park on 1 and the reverse bounces straight
  back into the forward loop, forever.** No threshold, no drift, no rounding may reach it.

---

## 5 · What has to change

| file | change |
|---|---|
| `lib/loopEvents.ts` | `LOOP_REVERSE_REQUEST_EVENT`. And **re-document** `LOOP_RESET_EVENT`: it means *"the scrollbar was thrown somewhere else outright — snap, do not ease"*, not *"…to the top"*. Every consumer already does `current = target`, which is direction-agnostic; only the prose is wrong. |
| `useHeroAnimation.ts` | `commitReverseTeleport()`, the mirror of `commitTeleport`. The scroll-up detector in `handleWheel` / `handleTouchMove`. A listener for the request. |
| `LoopVeil.tsx` | A **close** sequence (flood in, hold, clear) for the reverse, and a latch so the dive's progress reports do not kill the flood — see §6. |
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
