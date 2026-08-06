"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import {
  MOTION_CHOICE_EVENT,
  shouldAskMotionChoice,
} from "@/lib/motionPreference";
import {
  getEntryProgress,
  areArrivedWarmupsDone,
  isSourceLoaded,
  getMillisecondsSinceActivity,
  onAssetProgress,
  markStageQuiet,
  ASSET_SOURCES,
  ASSETS_WARMUP_EVENT,
  type AssetSource,
} from "@/lib/assetLoadProgress";
import { startCacheTelemetry } from "@/lib/cacheTelemetry";
import {
  REVEAL_EVENT,
  INTRO_ACTIVE_EVENT,
  IGNITE_EVENT,
  SUN_ASSEMBLE_EVENT,
  SUN_ASSEMBLED_EVENT,
  BURN_IN_EVENT,
  BURN_IN_DONE_EVENT,
  FINALE_EVENT,
  MINIMUM_LOADER_MS,
} from "./introEvents";
import GatherCanvas from "./GatherCanvas";
import LoaderTelemetry from "./LoaderTelemetry/LoaderTelemetry";
import MotionPrompt from "./MotionPrompt/MotionPrompt";
import SkipToLite from "./SkipToLite/SkipToLite";

// The shared sun lives in HeroSun, as three nested elements so no two things ever own one transform:
//   .hero-sun-layer    — the outer layer (we fade its opacity in; the hero pin owns its transform)
//   .hero-sun-parallax — the works camera's drag-to-look (HeroSun; nothing here touches it)
//   .hero-sun-flight   — the inner element we fly from the "o" to the square
// Both selectors below are plain class lookups, so the intervening layer is invisible to them.
const SUN_LAYER_SELECTOR = ".hero-sun-layer";
const SUN_FLIGHT_SELECTOR = ".hero-sun-flight";
const HERO_SQUARE_SELECTOR = ".hero-sun-card";

// Letter spacing on the wordmark. In `em` so it scales with the fluid font size rather than closing up
// on large screens and crowding on small ones.
const WORDMARK_TRACKING = "0.07em";

// The wordmark is "voidix" with the sun standing in for the "o": v · [sun] · idix.
const WORDMARK_BEFORE_SUN = "v";
const WORDMARK_AFTER_SUN = "idix";
// Index into WORDMARK_AFTER_SUN that gets the accent colour — the second "i", so the highlight sits
// near the end of the word the way it did before the rebrand.
const WORDMARK_ACCENT_INDEX = 2;

// ── Timing (seconds) ───────────────────────────────────────────────────
// A short beat of empty frame after the editorial frame settles and before the gate takes over, so
// the loader arrives at its held beat rather than snapping into it.
//
// ⚠ `WORDMARK_DELAY` used to live here at 0.55 and is gone. The wordmark no longer has a delay — it
// has a PRECONDITION, which is the gate, and nothing about when it resolves is a function of the
// clock any more.
const HOLD_BEFORE_GATE = 0.55;
const RESOLVE_DURATION = 0.9;
const SUN_FADE_IN = 0.45;
const SUN_SOLO_HOLD = 0.2; // the sun sits alone in the "o" before the letters arrive
const CHROME_FADE_OUT = 0.4;
const VEIL_FADE_OUT = 0.7;
const SUN_FLIGHT_DURATION = 1.1;
const SETTLE_AFTER_REVEAL = 0.4;
const REDUCED_MOTION_DELAY = 0.3;

/**
 * When the motion offer appears, in seconds from mount.
 *
 * ⚠ THE REASON FOR THIS NUMBER HAS CHANGED, and the number has not. It used to be placed just past
 * the wordmark's resolve (which landed around 2.1 s) so the offer never competed with the most
 * expensive thing the loader draws. The wordmark is now on the far side of the gate, so there is
 * nothing left here to sit behind — what this measures into instead is the held beat, a couple of
 * seconds after the dust has begun gathering into its first drawing.
 *
 * It stays where it is on the same principle: an aside must not arrive on top of the thing it is an
 * aside to. Early enough that a visitor on a slow connection is offered the choice while the wait is
 * still ahead of them; late enough that the field has settled into something first.
 */
const MOTION_PROMPT_DELAY = 2.4;
/** The quiet path has no timeline to wait out — the stage is still from the first frame. */
const MOTION_PROMPT_DELAY_QUIET = 0.2;
/** Toggled by the loader rather than by React — see MotionPrompt's header for why. */
const MOTION_PROMPT_SHOWN_CLASS = "is-offered";
const MOTION_PROMPT_SELECTOR = ".intro-motion-prompt";

/**
 * The longest the loader will sit on an unanswered motion question before opening anyway.
 *
 * ⚠ This is a NEVER-STRAND guard, not a timeout in the usual sense — a minute of nobody pressing
 * anything is far more likely to be a prompt that failed to render than a visitor still reading two
 * sentences. Without it, one exception inside `MotionPrompt` would leave every touch visitor staring
 * at a loader that can no longer finish, which is a worse outcome than the unasked question.
 */
const MOTION_CHOICE_GIVE_UP_MS = 60_000;
/** Frames the loader will wait for `MotionPrompt`'s first render before it stops looking. */
const MOTION_PROMPT_RENDER_ATTEMPTS = 8;

// How smoothly the counter chases real load progress.
const COUNTER_EASE_SECONDS = 0.5;

// ── The gate waits for the STAR, and it waits as long as the star needs ──
//
// It used to give up on ALL assets after a flat 12 s. That is why the site opened with a hole where
// the sun goes: at 20 KB/s `fractured_sun.glb` needs ~78 s, so the deadline expired long before the
// subject of the hero could possibly arrive, every time, no matter how the download was ordered.
// No amount of prioritising beats a deadline shorter than the file.
//
// Three things changed together, and each covers a case the others do not:
//
//   · the gate waits on the STAR alone, not the whole 7.3 MB page. It is what the first screen is
//     made of; the fleet is a minute of scrolling away and has no business holding the reveal.
//   · it waits while the star is MOVING rather than until a clock runs out — so a slow connection is
//     waited out and a dead one is not (see ASSET_STALL_GIVE_UP_MS).
//   · and because that wait can genuinely be a minute, it is made legible: the counter tracks the
//     STAR's real fraction (not a weighted total that would sit near 18% for the whole download)
//     and the underline breathes while the gate holds, so a long wait reads as working rather than
//     as stuck. ⚠ There is no skip control. An earlier revision of this comment cited a
//     `SKIP_OFFER_ETA_SECONDS` and claimed the visitor was "given a way out" — neither the constant
//     nor the control was ever built. If one is wanted, build it; do not assume it is there.
//
// ⚠ There is still no unbounded wait anywhere. The old cap protected against a stalled asset; that
// job now belongs to the stall window, which is the same instrument `lib/yieldToStarDownload.ts`
// uses for the same reason.

/**
 * Give up on the star after this long with NO sign of life — not merely no progress.
 *
 * Measured against `reportSourceActivity`, so a server that sends no `Content-Length` (where the
 * fraction cannot move off 0 for the whole download) is still recognised as alive. Generous: the
 * only thing on the other side of it is revealing a hero without its subject.
 */
const ASSET_STALL_GIVE_UP_MS = 15000;

/** How often the gate re-asserts its heartbeat and re-checks for a stall. */
const GATE_TICK_MS = 500;
// ── The gate's two SERIAL waits ──
// Once the assets are in, the shader compiles kick off; only once BOTH scenes report warm do the sun's
// shards begin flying in; only once they land does the reveal go, after a short settle so it never
// starts on the tail of a compile.
//
// ⚠ Those two stages used to be cued on the same tick, and that was the loading freeze. `compileAsync`
// runs `renderer.compile()` SYNCHRONOUSLY before it awaits anything (three's own source) — so both heavy
// scenes were blocking the main thread across the exact frames the shard flight was trying to play on.
// The flight is delta-timed with a clamp, so it did not fast-forward to catch up: it stuck mid-air.
// Serialising costs nothing in wall-clock, because that compile time was being taken out of the
// animation either way. Nothing that has to look alive during the compile is on this thread any more —
// the dust field is in a worker, and the underline pulses on the compositor.
//
// Each stage is capped, so a scene that never reports can't trap the loader. ⚠ They are SERIAL, so the
// caps ADD — but they now add on top of a DOWNLOAD WAIT WITH NO FIXED LENGTH, so the total is a
// function of the visitor's bandwidth and cannot be written down here any more. That is why
// `ASSEMBLE_CUE_FALLBACK_MS` in SunModelCanvas is measured from the model landing rather than from
// page load: after the landing what is still owed is exactly these two, which is knowable.
/**
 * ⚠ RAISED FROM 3500 WHEN THE BURN-IN WAS ADDED, and the arithmetic matters.
 *
 * This caps how long the gate will wait for the scenes' warm-ups. That stage now contains one more
 * beat — the works field's burn-in, capped at `BURN_IN_MAX_MS` (1.5 s) — on top of the compile, the
 * allocations and the probe. On a slow machine `compileAsync` alone can run to two seconds, and at
 * 3500 the total would cross the cap: the gate would stop waiting and cue the shard assembly WHILE
 * the burn-in was still drawing works frames, which is the one thing the assembly is given a quiet
 * GPU to avoid.
 *
 * ⚠ THE ARITHMETIC THIS COMMENT USED TO CARRY IS GONE, AND SO IS THE TRAP. It said
 * `ASSEMBLE_CUE_FALLBACK_MS` (8000, in SunModelCanvas) had to stay past this plus the assembly lead —
 * and it was already wrong when `BURN_IN_WAIT_MAX_MS` was added underneath it (5000 + 2500 + 1000
 * exceeds 8000), which nobody noticed because the fallback re-armed on the intro's heartbeat.
 *
 * Sizing one file's timeout against the sum of another file's is not a thing to get right once; it is
 * a thing to stop doing. That fallback now re-arms on a heartbeat that runs for the WHOLE loader (see
 * `introHeartbeat`), so no combination of caps here can outrun it and nothing downstream has to be
 * recomputed when one of them moves.
 */
const WARMUP_WAIT_MAX_MS = 5000;

/**
 * The measurement stage's own cap.
 *
 * `runBurnIn` in `useWorksField` answers unconditionally — it dispatches its done event even when it
 * refuses — so this only ever matters when there is no works field listening at all: a page whose
 * scene failed to build, or a future route that renders the loader without it. Sized to comfortably
 * clear `BURN_IN_MAX_MS` (1.5 s) plus the frames either side of it.
 *
 * ⚠ It ADDS to the serial caps, so it also pushes `ASSEMBLE_CUE_FALLBACK_MS`'s margin. That timer
 * re-arms on the intro's heartbeat now, so a longer gate cannot outrun it — but if the heartbeat is
 * ever removed, check this.
 */
const BURN_IN_WAIT_MAX_MS = 2500;
const ASSEMBLY_WAIT_MAX_MS = 3500;
const WARMUP_SETTLE_MS = 250;
/**
 * A held beat between the wordmark resolving and the first frame of the shard flight, in SECONDS —
 * it lives on the timeline now rather than in a `setTimeout` (it was `ASSEMBLY_LEAD_MS = 1000`).
 *
 * Shorter than it was, and the reason is that its job changed. It used to cover the gap between two
 * scenes finishing their compiles and the flight starting. That gap is now filled by the whole
 * wordmark resolve, so all this has to cover is the tail of the underline — which is one cheap
 * `scaleX` tween.
 */
const ASSEMBLY_LEAD = 0.35;


// The sun is sized to a little over the "o" glyph so it reads as filling it.
const SUN_IN_O_RATIO = 1.3;

const OVERLAY_Z_INDEX = 10000;

/** Toggles the underline's "still working" breathing. A CSS animation — see startHoldPulse for why. */
const HOLD_PULSE_CLASS = "is-holding";

// Scroll lock — held for the whole intro so a stray scroll can't drive the hero's
// pinned sun (ScrollTrigger is live from mount) before the intro lands it.
const SCROLL_LOCK_CLASS = "scroll-locked";
const SCROLL_BLOCK_KEYS = new Set([
  " ",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

export default function IntroSequence() {
  const rootRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const oSlotRef = useRef<HTMLSpanElement>(null);
  const counterRef = useRef<HTMLDivElement>(null);

  // `done` is the only state — everything animated is driven by GSAP/DOM refs so
  // the component never re-renders mid-intro (a re-render would re-apply JSX
  // inline styles and stomp GSAP's values, e.g. hiding the wordmark again).
  const [done, setDone] = useState(false);

  useEffect(() => {
    /** Mount, in the same clock `MINIMUM_LOADER_MS` is measured against. */
    const loaderStartedAt = performance.now();
    // What the network actually did, in the console, development only. Started here because this is
    // the earliest client component that always mounts — and it reads a BUFFERED observer, so the
    // resources that landed before this line ran are reported too. See lib/cacheTelemetry.ts.
    startCacheTelemetry();

    // Tell the hero an intro is actually running (so it extends its reveal-fallback and doesn't fire
    // early during a legitimate slow load). The hero's effect runs before this one, so its listener
    // is already registered.
    window.dispatchEvent(new Event(INTRO_ACTIVE_EVENT));

    const revealHero = () => window.dispatchEvent(new Event(REVEAL_EVENT));
    const sunLayer = document.querySelector(SUN_LAYER_SELECTOR);
    const sunFlight = document.querySelector(SUN_FLIGHT_SELECTOR);

    // ── The motion offer ──
    // A class, not React state, for the same reason the hold pulse is one: this component must not
    // re-render while the intro is running. Queried rather than held in a ref because the prompt is a
    // sibling of the intro's root, outside `rootRef` — it has to be, since that root is `aria-hidden`
    // with `pointer-events: none` and an offer you cannot click or hear is not an offer.
    let motionPromptTimer = 0;
    let motionPromptFrame = 0;
    let motionChoiceHeartbeat = 0;
    let motionChoiceGiveUp = 0;
    let motionChoiceListener: (() => void) | null = null;

    // ⚠ Retried, but only for a handful of frames. `MotionPrompt` decides whether to exist inside
    // its own effect and appears on the render that follows, so on a warm cache the gate can ask for
    // it a frame or two early. An UNBOUNDED retry would be a per-frame querySelector running for the
    // whole loader on every desktop visit, where the prompt is correctly never going to render.
    let motionPromptAttempts = MOTION_PROMPT_RENDER_ATTEMPTS;
    /** True only while the handoff is actually blocked on an answer. */
    let motionChoiceWaiting = false;
    const offerMotionChoice = () => {
      const prompt = document.querySelector(MOTION_PROMPT_SELECTOR);
      if (prompt) {
        prompt.classList.add(MOTION_PROMPT_SHOWN_CLASS);
        return;
      }
      if (motionPromptAttempts-- > 0) {
        motionPromptFrame = requestAnimationFrame(offerMotionChoice);
        return;
      }
      // ⚠ Give up LOUDLY, but only if someone is actually waiting. If the offer never rendered,
      // `awaitMotionChoice` is holding the handoff for a control that does not exist, and the only
      // thing that would free it is the 60 s never-strand timer — a minute of dead loader on every
      // touch device. Saying "answered" here costs an unasked question; not saying it costs the visit.
      if (motionChoiceWaiting) window.dispatchEvent(new Event(MOTION_CHOICE_EVENT));
    };

    const teardownMotionChoiceWait = () => {
      motionChoiceWaiting = false;
      cancelAnimationFrame(motionPromptFrame);
      window.clearInterval(motionChoiceHeartbeat);
      window.clearTimeout(motionChoiceGiveUp);
      if (motionChoiceListener) {
        window.removeEventListener(MOTION_CHOICE_EVENT, motionChoiceListener);
        motionChoiceListener = null;
      }
    };

    const withdrawMotionChoice = () => {
      window.clearTimeout(motionPromptTimer);
      teardownMotionChoiceWait();
      document
        .querySelector(MOTION_PROMPT_SELECTOR)
        ?.classList.remove(MOTION_PROMPT_SHOWN_CLASS);
    };

    /**
     * Hold the handoff until the visitor has answered — on the ONE visit where they are asked.
     *
     * ⚠ It asks `shouldAskMotionChoice()` rather than looking for the prompt on screen, because the
     * loader and the prompt have to reach the same answer and only one of them is a React render.
     * See that function's header.
     */
    const awaitMotionChoice = (proceed: () => void) => {
      if (!shouldAskMotionChoice()) {
        proceed();
        return;
      }
      // ⚠ ORDER MATTERS. The listener goes on FIRST, because `offerMotionChoice` can answer
      // synchronously — if its retries are already spent it dispatches immediately, and a dispatch
      // before the listener exists is a dispatch into nothing, which puts us right back on the 60 s
      // timer this was meant to avoid.
      const release = () => {
        teardownMotionChoiceWait();
        proceed();
      };
      motionChoiceListener = release;
      motionChoiceWaiting = true;
      window.addEventListener(MOTION_CHOICE_EVENT, release);

      // The delay may not have elapsed — a question the loader is WAITING on has to be on screen. The
      // retry budget is refreshed: the earlier attempts were a best-effort preview, this one is the
      // one the handoff depends on.
      window.clearTimeout(motionPromptTimer);
      motionPromptAttempts = MOTION_PROMPT_RENDER_ATTEMPTS;
      offerMotionChoice();

      // ⚠ Load-bearing, and easy to miss: by this point BOTH tickers have stopped, and the hero arms
      // a reveal fallback that is re-armed only by this event (REVEAL_FALLBACK_WITH_INTRO_MS). A
      // visitor who takes their time reading would otherwise have the hero reveal itself and build
      // its pin behind the veil while scroll is still locked.
      motionChoiceHeartbeat = window.setInterval(
        () => window.dispatchEvent(new Event(INTRO_ACTIVE_EVENT)),
        GATE_TICK_MS,
      );
      motionChoiceGiveUp = window.setTimeout(release, MOTION_CHOICE_GIVE_UP_MS);
    };

    // Hold the page at the top for the duration of the intro. overflow:hidden stops
    // the wheel/trackpad; the explicit listeners cover keyboard + any browser that
    // still leaks momentum scroll past overflow:hidden.
    const preventScroll = (scrollEvent: Event) => scrollEvent.preventDefault();
    const preventScrollKeys = (keyboardEvent: KeyboardEvent) => {
      if (SCROLL_BLOCK_KEYS.has(keyboardEvent.key)) keyboardEvent.preventDefault();
    };
    const lockScroll = () => {
      // Stop the browser restoring a previous scroll position on reload — otherwise the
      // page can start the intro already scrolled down, before this lock runs.
      if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
      }
      window.scrollTo(0, 0);
      document.documentElement.classList.add(SCROLL_LOCK_CLASS);
      window.addEventListener("wheel", preventScroll, { passive: false });
      window.addEventListener("touchmove", preventScroll, { passive: false });
      window.addEventListener("keydown", preventScrollKeys);
    };
    const unlockScroll = () => {
      document.documentElement.classList.remove(SCROLL_LOCK_CLASS);
      window.removeEventListener("wheel", preventScroll);
      window.removeEventListener("touchmove", preventScroll);
      window.removeEventListener("keydown", preventScrollKeys);
      // No ScrollTrigger.refresh() needed: the hero's scroll-expansion is built lazily
      // at REVEAL_EVENT (see useHeroAnimation / Contract 2), so it already measured a
      // settled, top-of-page layout.
    };

    lockScroll();

    // Offset the inner sun from the square (its home) into the "o" slot. Called
    // when the wordmark resolves and re-called right before the flight so the
    // measurements are fresh.
    const parkSunInO = () => {
      const oSlot = oSlotRef.current;
      const square = document.querySelector(HERO_SQUARE_SELECTOR);
      if (!oSlot || !square || !sunFlight) return;
      const oRect = oSlot.getBoundingClientRect();
      const squareRect = square.getBoundingClientRect();
      const scale = (oRect.height * SUN_IN_O_RATIO) / squareRect.height;
      const deltaX =
        oRect.left + oRect.width / 2 - (squareRect.left + squareRect.width / 2);
      const deltaY =
        oRect.top + oRect.height / 2 - (squareRect.top + squareRect.height / 2);
      gsap.set(sunFlight, { x: deltaX, y: deltaY, scale });
    };

    // ── Reduced motion: skip the SHOW, not the WAIT ──
    //
    // No dust, no wordmark resolve, no shard flight. But the gate below still has to happen, and
    // this path used to throw it away on a flat 300 ms timer while writing "100" into the counter.
    // Unlocking scroll that early hands a phone on cellular a fleet section with nothing in it —
    // the models are still tens of megabytes out, and every other path on this site waits for them.
    // Reduced motion asks for less MOVEMENT. It does not ask to arrive before the site exists, and
    // the visitors most likely to have it set (iOS, where it is a common everyday setting) are also
    // the most likely to be on the connection where the difference is a minute.
    //
    // Built from the same primitives as the real gate — `isSourceLoaded` and the stall window — so
    // there is one notion of "the star is in" rather than two that can disagree.
    //
    // ⚠ What it deliberately does NOT wait for is the shader warm-up and the shard assembly.
    // `ASSETS_WARMUP_EVENT` still fires immediately and each scene still warms itself when its own
    // assets land, so that work happens either way; waiting on it only protects a cinematic, and
    // this path has none. The assembly is force-completed by REVEAL_EVENT (see SunModelCanvas), so
    // there is nothing there to watch either.
    if (prefersReducedMotion()) {
      // Nothing is going to animate, so the stage is already as quiet as it will ever be. Said out
      // loud, because the timeline that normally says it is never built on this path — and a scene
      // waiting on it would never warm, and would compile on the frame it is first drawn instead.
      markStageQuiet();
      window.dispatchEvent(new Event(ASSETS_WARMUP_EVENT));
      if (sunLayer) gsap.set(sunLayer, { autoAlpha: 1 });
      if (sunFlight) gsap.set(sunFlight, { x: 0, y: 0, scale: 1 });

      const quietWaitStartedAt = performance.now();
      let quietTicker = 0;
      let quietRevealTimeout = 0;

      // The real fraction, painted straight in. The counter's usual `gsap.to` ease is itself motion,
      // and the hard "100" this used to write was simply untrue while the star was still arriving.
      const paintQuietCounter = () => {
        if (counterRef.current) {
          counterRef.current.textContent = String(
            Math.round(getEntryProgress() * 100),
          );
        }
      };

      /**
       * The same question `isGateSatisfied` asks on the animated path: is EVERY source either in or
       * demonstrably dead?
       *
       * ⚠ It waits for the whole page here too, and for the same reason. Reduced motion asks for less
       * MOVEMENT; it does not ask to arrive before the site exists. This path used to release on the
       * star alone and hand a phone on cellular a fleet section with nothing in it — which is exactly
       * the failure the animated gate has just been changed to stop having.
       */
      const areQuietAssetsSettled = () =>
        ASSET_SOURCES.every((source) => {
          if (isSourceLoaded(source)) return true;
          // ⚠ `null` means that source has never reported — its chunk may not have mounted yet — so
          // the wait is measured from when it started rather than read as "silent for 0 ms", which
          // would wait forever on a source that never begins. Same reasoning as `tickGate`.
          const sinceActivity = getMillisecondsSinceActivity(source);
          const silentFor = sinceActivity ?? performance.now() - quietWaitStartedAt;
          return silentFor > ASSET_STALL_GIVE_UP_MS;
        });

      const finishQuietIntro = () => {
        window.clearInterval(quietTicker);
        // The star is in; the only thing left to wait for is the visitor. On a warm cache this is
        // the whole loader, which is exactly the case where the offer used to flash past unread.
        awaitMotionChoice(() => {
          withdrawMotionChoice();
          quietRevealTimeout = window.setTimeout(() => {
            revealHero();
            unlockScroll();
            setDone(true);
          }, REDUCED_MOTION_DELAY * 1000);
        });
      };

      // Worth making the offer on THIS path above all others: the visitor has arrived with the OS
      // flag set, and this is where the site says so out loud and hands back the choice, rather than
      // stripping itself down without ever mentioning it.
      motionPromptTimer = window.setTimeout(
        offerMotionChoice,
        MOTION_PROMPT_DELAY_QUIET * 1000,
      );

      paintQuietCounter();
      if (areQuietAssetsSettled()) {
        // A warm cache lands straight here — it should not sit out a tick to discover that.
        finishQuietIntro();
      } else {
        quietTicker = window.setInterval(() => {
          paintQuietCounter();
          // ⚠ Load-bearing, not a status ping. The hero arms a reveal fallback and RE-ARMS it on
          // every one of these (REVEAL_FALLBACK_WITH_INTRO_MS). A download longer than that net,
          // with nothing beating, has the hero reveal itself and build its pin behind the veil
          // while scroll is still locked. The real gate dispatches this from `tickGate` for exactly
          // the same reason.
          window.dispatchEvent(new Event(INTRO_ACTIVE_EVENT));
          if (areQuietAssetsSettled()) finishQuietIntro();
        }, GATE_TICK_MS);
      }

      return () => {
        window.clearInterval(quietTicker);
        window.clearTimeout(quietRevealTimeout);
        window.clearTimeout(motionPromptTimer);
        teardownMotionChoiceWait();
        unlockScroll();
      };
    }

    motionPromptTimer = window.setTimeout(
      offerMotionChoice,
      MOTION_PROMPT_DELAY * 1000,
    );

    /**
     * ── One heartbeat, for the whole loader ──────────────────────────────────────────────────────
     *
     * ⚠ THIS USED TO BE TWO PARTIAL ONES AND THAT IS NO LONGER SURVIVABLE. `tickGate` dispatched
     * while the gate waited on downloads, and `awaitMotionChoice` dispatched while it waited on an
     * answer. Between them was a hole: the warm-up wait, the burn-in, the settle and now the minimum
     * hold — up to seventeen seconds during which nothing said the intro was alive.
     *
     * Two things re-arm on this and both would misfire in that hole:
     *   · the hero's REVEAL_FALLBACK_WITH_INTRO_MS, which would reveal the site and build its pin
     *     behind the veil while scroll is still locked;
     *   · `ASSEMBLE_CUE_FALLBACK_MS` in SunModelCanvas (8 s from the model landing), which would cue
     *     the shard assembly before the wordmark exists — so the star would assemble against a veil
     *     with nothing to assemble INTO, and the loader would reach its finale with it already built.
     *
     * That second one is the reason the serial caps no longer need to be added up and compared to a
     * constant in another file. They cannot outrun a signal that never stops.
     */
    const introHeartbeat = window.setInterval(() => {
      window.dispatchEvent(new Event(INTRO_ACTIVE_EVENT));
      // The counter's second clock only advances with time, so it needs a tick of its own — a warm
      // cache fires no further asset events at all, and the counter would freeze wherever the last
      // one left it. See `syncCounterToAssets`.
      syncCounterToAssets();
    }, GATE_TICK_MS);

    // Release the scroll lock when the intro actually finishes (the component returns
    // null but stays mounted, so the effect cleanup can't be relied on to unlock).
    const timeline = gsap.timeline({
      onComplete: () => {
        window.clearInterval(introHeartbeat);
        unlockScroll();
        setDone(true);
      },
    });

    // ── Honest loader: the counter measures THE THING BEING WAITED FOR ──
    //
    // ⚠ The star's own progress, not `getAssetProgress()`'s weighted total across all three sources.
    // The two agreed while the gate waited for the whole page; now that it waits for the star alone
    // they do not, and the total would be actively misleading — on a slow connection the star is
    // ~18% of the weighted download, so the loader would hand off at "18" and the visitor would watch
    // a counter fail to finish. 100 now means what it says: ready to enter.
    //
    // Nothing is hidden by this. `LoaderTelemetry` still reports each module's real progress, so the
    // fleet streaming on into the hero is visible to anyone looking for it.
    const counterDisplay = { value: 0 };
    const paintCounter = () => {
      if (counterRef.current) {
        counterRef.current.textContent = String(Math.round(counterDisplay.value));
      }
    };
    const syncCounterToAssets = () => {
      // ⚠ THE SLOWER OF TWO CLOCKS, and the second one is not padding.
      //
      // `getEntryProgress` is how close the PAGE is to being enterable. `MINIMUM_LOADER_MS` is how
      // close the LOADER is to being allowed to end. On a warm cache the first reaches 1 in under two
      // seconds and the second has seven to go — and a counter that reads 100 and then makes you wait
      // is precisely the dishonesty `assetLoadProgress`'s weighting exists to prevent. It was being
      // honest about one half of the wait and silent about the other, which is the same bug that file
      // records fixing twice before.
      //
      // 100 means what it has always meant here: the next thing you see is the site.
      const held = (performance.now() - loaderStartedAt) / MINIMUM_LOADER_MS;
      gsap.to(counterDisplay, {
        value: Math.round(Math.min(getEntryProgress(), held) * 100),
        duration: COUNTER_EASE_SECONDS,
        ease: "power1.out",
        overwrite: true,
        onUpdate: paintCounter,
      });
    };

    // The gate opens in three serial stages once the timeline reaches the pre-handoff hold: wait for the
    // assets to download → compile their shaders → fly the sun's shards in. Each stage is capped by a
    // timeout, and the reveal resumes exactly once, only after everything is smooth.
    let gateReached = false;
    let warmupStarted = false;
    let assemblyCued = false;
    let burnInStarted = false;
    let hasResumed = false;
    /** The star stopped showing any sign of life — proceed without it rather than wait forever. */
    let sunAssembled = false;
    let resumeFrame = 0;
    /** The gate's 500 ms clock: countdown, stall check, and when to offer the skip. */
    let gateTicker = 0;
    // One handle: the stages are strictly serial, so only one wait is ever armed at a time.
    let gateTimeout = 0;
    // While we WAIT at the gate (for assets to download, then for their shaders to compile), breathe
    // the accent underline so the hold reads as "loading" and alive — the 5%-opacity ghost counter
    // alone is too faint to signal it.
    //
    // ⚠ A CSS class, NOT a GSAP tween. This is the one piece of chrome whose whole job is to say "still
    // working" during the compile — and a GSAP tween would be interpolated on the main thread, which is
    // precisely the thread the compile is blocking. A CSS animation on `opacity` runs on the compositor
    // and keeps painting straight through a block. Same reason `.loader-dot` was always a keyframe.
    const startHoldPulse = () => {
      document.querySelector(".intro-underline")?.classList.add(HOLD_PULSE_CLASS);
    };
    const stopHoldPulse = () => {
      document.querySelector(".intro-underline")?.classList.remove(HOLD_PULSE_CLASS);
    };

    // ── The gate's last act: let the timeline run on into the finale ──
    //
    // ⚠ This used to resume straight into the HANDOFF, because the wordmark had already resolved at
    // ~2.1 s and the gate was a pause in the middle of the loader. It is now the other way round: the
    // wait is the loader, and everything the visitor came to see — the wordmark, the star, the
    // assembly, the flight — is on the far side of this. See the timeline below.
    //
    // Deferred a frame so it never runs inside addPause's own callback (GSAP can swallow that).
    const openFinale = () => {
      if (hasResumed) return;
      hasResumed = true;
      window.clearTimeout(gateTimeout);
      stopHoldPulse();
      // ⚠ `hasResumed` is already true, so nothing else can re-enter while this waits. The motion wait
      // is usually zero — it only holds on the one visit where a decision is owed.
      awaitMotionChoice(() => {
        // Taken off screen before the handoff, not left to fade with the veil — it is a SIBLING of
        // the intro root, so the veil's fade-out does not cover it and it would otherwise still be
        // sitting over the hero after the reveal.
        withdrawMotionChoice();
        const owed = MINIMUM_LOADER_MS - (performance.now() - loaderStartedAt);
        // ⚠ The minimum holds the SHOW, never the WORK. Everything above it has already run at full
        // speed; all this delays is the wordmark. On a warm cache that is the whole of the loader,
        // and the field spends it on the drawings rather than flashing past them.
        const start = () => {
          // Told, not inferred — see FINALE_EVENT. The gather field lets its drawings go on this and
          // has the whole wordmark to get its dust back into the stream before the shards fly.
          window.dispatchEvent(new Event(FINALE_EVENT));
          resumeFrame = requestAnimationFrame(() => timeline.resume());
        };
        if (owed > 0) gateTimeout = window.setTimeout(start, owed);
        else start();
      });
    };

    // ── The gate's last WAIT: the scenes are warm and measured → a short settle ──
    // A beat of nothing between the last compile and the first frame of the finale, so the wordmark
    // never begins on the tail of a reallocation.
    const settleThenOpen = () => {
      if (hasResumed) return;
      window.clearTimeout(gateTimeout);
      gateTimeout = window.setTimeout(openFinale, WARMUP_SETTLE_MS);
    };

    // ── The second pause: the shards are flying → hold the handoff until they land ──
    //
    // The assembly IS the loader's last beat, so revealing over the top of it would throw away the
    // payoff. Cued from the timeline (after the wordmark has resolved and put an empty "o" on screen
    // to assemble into), waited for here.
    let assemblyPassed = false;
    const releaseAssembly = () => {
      if (assemblyPassed) return;
      assemblyPassed = true;
      window.clearTimeout(gateTimeout);
      resumeFrame = requestAnimationFrame(() => timeline.resume());
    };
    const waitForAssembly = () => {
      assemblyCued = true;
      // The sun can already be assembled by the time we ask, and it will not report a second time.
      // Its own safety net (ASSEMBLE_CUE_FALLBACK_MS, armed from the model landing) can fire before
      // the cue does on a load where the warm stage runs long — so the star assembles itself and
      // reports into a listener that is not yet waiting for it.
      if (sunAssembled) releaseAssembly();
      else gateTimeout = window.setTimeout(releaseAssembly, ASSEMBLY_WAIT_MAX_MS);
    };

    const onSunAssembled = () => {
      sunAssembled = true;
      if (assemblyCued) releaseAssembly();
    };
    window.addEventListener(SUN_ASSEMBLED_EVENT, onSunAssembled);

    /**
     * ── Stage 2b: both scenes are warm → MEASURE, before anything is shown ───────────────────────
     *
     * The one quiet main thread the loader ever has: the downloads are done, both scenes have finished
     * compiling and allocating, the dust is in a worker, and the only thing drawing is the star — which
     * is exactly what will be drawing alongside the works field later. So this is where the frame gets
     * timed and the session's resolution is settled, before a single visible frame exists.
     *
     * ⚠ It is a STAGE because it failed as a step. Buried inside the works warm-up it ran while the
     * other scene was still compiling: frames were 300–500 ms, the twelve it needed could not fit its
     * cap, and it gave up silently every time. It also would have been measuring the machine while the
     * machine was still building the site, which reports it far weaker than it is.
     *
     * ⚠ Capped like every other stage. A page with no works field — or one whose scene failed to build
     * — must not sit here; `adaptivePixelRatio` falls back to calibrating on real frames later.
     */
    const beginBurnIn = () => {
      if (burnInStarted || hasResumed) return;
      burnInStarted = true;
      window.clearTimeout(gateTimeout);
      gateTimeout = window.setTimeout(settleThenOpen, BURN_IN_WAIT_MAX_MS);
      window.dispatchEvent(new Event(BURN_IN_EVENT));
    };

    const onBurnInDone = () => {
      window.clearTimeout(gateTimeout);
      settleThenOpen();
    };
    window.addEventListener(BURN_IN_DONE_EVENT, onBurnInDone);

    const checkWarm = () => {
      // ⚠ `areArrivedWarmupsDone`, not `areWarmupsDone`. The reveal waits on the star now, so on a
      // slow connection the fleet can still be streaming when the star is ready — and a scene that
      // has not downloaded cannot have compiled. Requiring it to would make every slow load sit out
      // this stage's full cap for a scene nobody will see for another minute. On a fast load all
      // three are in before this is consulted, so the two are the same function.
      // ⚠ Into the burn-in now, not straight to the assembly. The measurement is the last thing the
      // loader does before its finale, so it gets the still frame the finale used to get first.
      if (warmupStarted && !burnInStarted && areArrivedWarmupsDone()) beginBurnIn();
    };

    // ── Stage 1: the star is in → wait for the shader compiles ──
    // It no longer STARTS them: each scene warms itself once its own assets are in and the stage has
    // gone quiet (see the ASSETS_WARMUP_EVENT dispatch in the timeline below). By the time the last
    // byte lands, most of that work is usually already done — which is the point. This stage is only
    // the wait, and its cap.
    const beginWarmup = () => {
      if (warmupStarted) return;
      warmupStarted = true;
      startHoldPulse();
      gateTimeout = window.setTimeout(beginBurnIn, WARMUP_WAIT_MAX_MS);
      checkWarm(); // a scene can already be warm — on a fast load it will be
    };

    /**
     * ── What the reveal actually waits for: EVERY source ─────────────────────────────────────────
     *
     * ⚠ THIS WAS "THE STAR, AND NOTHING ELSE", AND THE REVERSAL IS DELIBERATE.
     *
     * That earlier reasoning was sound on its own terms: the hero opens on the star, the fleet and the
     * field are a minute of scrolling away, and holding the reveal for ~5.3 MB of vessels nobody was
     * about to look at cost every visitor a wait they could not see the point of. What it produced,
     * though, is a site that OPENS BEFORE IT IS LOADED — the first lap runs while the fleet is still
     * streaming, which is most of what "it feels heavy the first time" turned out to be.
     *
     * The objection to waiting was never that waiting is wrong. It was that a visitor on a weak
     * connection had no alternative but to sit through it. That is now answered: `SkipToLite` offers
     * `/lite` — the same services, work and answers as a document — the moment the wait looks long.
     * With a way out on screen, waiting for the whole page is the honest default rather than a
     * punishment.
     *
     * ⚠ A source that has STALLED still counts as satisfied. Otherwise one dead request traps the
     * loader forever, which is the failure the old star-only rule could not have.
     */
    const gaveUpSources = new Set<AssetSource>();
    const isGateSatisfied = () =>
      ASSET_SOURCES.every(
        (source) => isSourceLoaded(source) || gaveUpSources.has(source),
      );

    const tryBeginWarmup = () => {
      if (gateReached && isGateSatisfied()) beginWarmup();
    };

    const stopAssetProgress = onAssetProgress(() => {
      syncCounterToAssets();
      tryBeginWarmup(); // the star finished downloading → start compiling
      checkWarm();      // a scene reported its shaders warm → maybe start the shards
    });
    syncCounterToAssets(); // paint whatever has already loaded before the first new report

    // ── The gate's ticker: is the star still coming, and does the hero still trust us ──
    //
    // One interval rather than two timers, because both questions want the same clock. It runs only
    // while the gate is waiting and stops the moment the wait is over.
    let gateWaitStartedAt = 0;

    const stopGateTicker = () => {
      window.clearInterval(gateTicker);
      gateTicker = 0;
    };

    const tickGate = () => {
      if (hasResumed || warmupStarted) {
        stopGateTicker();
        return;
      }

      // (The "we are still here" heartbeat used to be dispatched from here. It is now one interval
      // running for the whole loader — see `introHeartbeat`, and the hole in the old arrangement that
      // made it necessary.)

      // ── Is each one still alive? ──
      // Against ACTIVITY, not against the fraction: a server sending no `Content-Length` cannot move
      // the fraction at all, and reading that as a stall would abandon a perfectly healthy download.
      // `null` means that source has never reported — its chunk may not even have mounted yet — so the
      // wait is measured from when the gate started instead of giving up on something not begun.
      //
      // ⚠ Per source, now that the gate waits for all of them. One dead request must retire itself
      // without taking the other two down, and without trapping the loader behind it.
      for (const source of ASSET_SOURCES) {
        if (isSourceLoaded(source) || gaveUpSources.has(source)) continue;
        const sinceActivity = getMillisecondsSinceActivity(source);
        const silentFor =
          sinceActivity ?? (gateWaitStartedAt ? performance.now() - gateWaitStartedAt : 0);
        if (silentFor > ASSET_STALL_GIVE_UP_MS) gaveUpSources.add(source);
      }

      if (isGateSatisfied()) {
        stopGateTicker();
        tryBeginWarmup();
      }
    };

    // 1. Editorial frame + corner chrome settle in. (fromTo, not from, so the end
    //    state is explicit — a bare from() mis-captures its end value under React
    //    Strict Mode's double-mount once we kill rather than revert the timeline.)
    timeline.fromTo(
      ".intro-chrome",
      { opacity: 0 },
      { opacity: 1, duration: 0.5, stagger: 0.05 },
      0,
    );
    timeline.fromTo(
      ".intro-frame",
      { scale: 1.04, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.7, ease: "power3.out" },
      0,
    );

    // 2. (The counter is driven by real asset progress above, not a scripted climb.)

    // ── The stage is now still: the heavy scenes may compile ──
    //
    // ⚠ Dispatched HERE, from the timeline, rather than from the gate at 100%. It does not mean "the
    // assets are in" — each scene knows that about itself — it means "the loader has finished
    // animating, so a GPU stall will not be seen".
    //
    // Both readings have been shipped and both were wrong on their own. Firing at 100% stacked two
    // compiles and two first composer allocations immediately before the shard flight. Firing on each
    // scene's own assets instead put them on top of the wordmark: five Syne 800 glyphs at up to 256 px
    // animating transform and opacity through a `back.out` overshoot is the most expensive thing this
    // loader ever draws, and on a fast connection the field's assets landed right in the middle of it.
    //
    // ⚠ It now lands MUCH earlier — a beat after the frame settles, rather than after the wordmark —
    // because the wordmark has moved to the far side of the gate. This is strictly better and it is
    // the point: from here until the finale the only thing on screen is the dust, and the dust is in a
    // worker, so every compile on the site has a stage it cannot be seen from.
    //
    // Recorded as STATE as well as fired as an event: both scenes are dynamically imported, so on a
    // slow connection a chunk can arrive after this line has already run, and a scene listening only
    // for the event would wait forever on one that had already gone. See `isStageQuiet`.
    timeline.add(() => {
      markStageQuiet();
      window.dispatchEvent(new Event(ASSETS_WARMUP_EVENT));
    });

    timeline.to({}, { duration: HOLD_BEFORE_GATE });

    // ══ THE GATE ═══════════════════════════════════════════════════════════════════════════════
    //
    // Everything past this point is the finale. Below the pause the loader is one held beat: the dust
    // gathers into its drawings and the page downloads, warms, measures and allocates behind them,
    // with no wordmark and no star on screen to be waited on.
    timeline.addPause(">", () => {
      gateReached = true;
      if (isGateSatisfied()) {
        beginWarmup();
        return;
      }
      // Still waiting on the page. Show life, and start the clock that watches for a dead source.
      startHoldPulse();
      gateWaitStartedAt = performance.now();
      gateTicker = window.setInterval(tickGate, GATE_TICK_MS);
      tickGate();
    });

    // ══ THE FINALE ═════════════════════════════════════════════════════════════════════════════
    //
    // 3. The wordmark resolves — and the sun appears alone in the "o" before the letters arrive, the
    //    same beat it has always had. Only its POSITION in the loader has changed: it is a receipt for
    //    a finished page rather than a title card over an unfinished one.
    timeline.set(".intro-word-wrap", { autoAlpha: 1 }, ">");
    timeline.add(parkSunInO);
    if (sunLayer)
      timeline.to(sunLayer, { autoAlpha: 1, duration: SUN_FADE_IN }, "<");

    // Hold — the sun sits alone in the "o" before the letters arrive.
    timeline.to({}, { duration: SUN_SOLO_HOLD });

    // 4. wordmark letters animate in after the sun has had its moment.
    timeline.fromTo(
      ".intro-letter",
      {
        yPercent: 140,
        rotation: () => gsap.utils.random(-35, 35),
        scale: 0.4,
        autoAlpha: 0,
      },
      {
        yPercent: 0,
        rotation: 0,
        scale: 1,
        autoAlpha: 1,
        duration: RESOLVE_DURATION,
        ease: "back.out(1.7)",
        stagger: { each: 0.08, from: "center" },
      },
      ">-0.05",
    );
    timeline.fromTo(
      ".intro-underline",
      { scaleX: 0 },
      { scaleX: 1, duration: 0.7, ease: "power3.inOut" },
      ">-0.4",
    );

    // 5. A quiet beat, then the shards fly in.
    //
    // ⚠ THE BEAT IS NOT PADDING. The shard flight is delta-timed with a clamp, so whatever it loses in
    // its opening frames — the ones that set the pace for the whole sweep — it can never make back.
    // What precedes it here is the most expensive thing this loader draws, and it used to be the
    // compiles; either way the flight must not be handed the very next frame. It was a setTimeout
    // (ASSEMBLY_LEAD_MS) when the assembly was cued from the gate; on the timeline it is simply a
    // hold, which is the same thing said in the same clock as everything around it.
    timeline.to({}, { duration: ASSEMBLY_LEAD });
    timeline.add(() => window.dispatchEvent(new Event(SUN_ASSEMBLE_EVENT)));
    // Hold the handoff until the last shard lands (capped) — the flight is watched start to finish.
    timeline.addPause(">", waitForAssembly);

    // 6. Handoff — chrome leaves, the dark veil lifts to reveal the cream hero,
    //    and the sun shrinks + flies from the "o" into the hero square.
    const handoffLabel = "handoff";
    timeline.addLabel(handoffLabel);
    // Ignite the gathering field: the last rush of matter into the star, timed to land under the sun's
    // flight out of the "o" rather than competing with it.
    timeline.add(
      () => window.dispatchEvent(new Event(IGNITE_EVENT)),
      handoffLabel,
    );
    timeline.to(
      [
        ".intro-chrome",
        ".intro-frame",
        ".intro-counter",
        ".intro-word-wrap",
        ".intro-underline",
      ],
      { autoAlpha: 0, duration: CHROME_FADE_OUT },
      handoffLabel,
    );
    timeline.to(
      veilRef.current,
      { autoAlpha: 0, duration: VEIL_FADE_OUT, ease: "power2.inOut" },
      `${handoffLabel}+=0.1`,
    );
    timeline.add(parkSunInO, `${handoffLabel}+=0.1`); // re-measure right before the flight
    if (sunFlight) {
      timeline.to(
        sunFlight,
        {
          x: 0,
          y: 0,
          scale: 1,
          duration: SUN_FLIGHT_DURATION,
          ease: "power2.inOut",
        },
        `${handoffLabel}+=0.1`,
      );
    }

    // 7. Reveal the hero (text + square fill) as the sun settles, then unmount.
    timeline.add(revealHero, ">-0.1");
    timeline.to({}, { duration: SETTLE_AFTER_REVEAL });

    return () => {
      timeline.kill();
      window.clearInterval(introHeartbeat);
      unlockScroll();
      stopAssetProgress();
      window.removeEventListener(SUN_ASSEMBLED_EVENT, onSunAssembled);
      window.removeEventListener(BURN_IN_DONE_EVENT, onBurnInDone);
      window.clearInterval(gateTicker);
      window.clearTimeout(gateTimeout);
      window.clearTimeout(motionPromptTimer);
      teardownMotionChoiceWait();
      cancelAnimationFrame(resumeFrame);
      gsap.killTweensOf(counterDisplay);
      stopHoldPulse(); // a class now, not a tween — killTweensOf would no longer clear it
    };
  }, []);

  if (done) return null;

  return (
    <>
    <div
      ref={rootRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: OVERLAY_Z_INDEX,
        color: "var(--fg)",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {/* Opaque veil — covers the hero until the handoff lifts it. */}
      <div
        ref={veilRef}
        style={{ position: "absolute", inset: 0, background: "var(--bg)" }}
      >
        {/* The gathering field — matter falling together into the "o". Sits directly on the veil, under
            everything else, and is driven by real load progress rather than the timeline. Rendered
            unconditionally (a `prefersReducedMotion()` check here would differ between server and client
            and break hydration); it opts out of its own WebGL setup instead. */}
        <GatherCanvas />

        {/* Hairline editorial frame */}
        <div
          className="intro-frame"
          style={{
            position: "absolute",
            inset: "clamp(0.9rem, 2.5vw, 1.6rem)",
            border: "1px solid var(--border)",
            pointerEvents: "none",
          }}
        />

        {/* Corner chrome */}
        <span
          className="intro-chrome eyebrow"
          style={{
            position: "absolute",
            top: "clamp(1.6rem, 4vw, 2.6rem)",
            left: "clamp(1.6rem, 4vw, 2.6rem)",
            color: "var(--muted)",
          }}
        >
          voidix™
        </span>
        <span
          className="intro-chrome eyebrow"
          style={{
            position: "absolute",
            top: "clamp(1.6rem, 4vw, 2.6rem)",
            right: "clamp(1.6rem, 4vw, 2.6rem)",
            color: "var(--muted)",
          }}
        >
          ©2026
        </span>
        <span
          className="intro-chrome eyebrow"
          style={{
            position: "absolute",
            bottom: "clamp(1.6rem, 4vw, 2.6rem)",
            left: "clamp(1.6rem, 4vw, 2.6rem)",
            color: "var(--muted)",
          }}
        >
          Entering the void
        </span>

        {/* Live instrument panel — module states, throughput, and the meter on the frame's bottom edge.
            Its rows carry .intro-chrome, so the timeline's existing fade-in/fade-out covers them. */}
        <LoaderTelemetry />


        {/* Ghost counter */}
        <div
          ref={counterRef}
          className="intro-counter"
          style={{
            position: "absolute",
            right: "clamp(0.5rem, 3vw, 3rem)",
            bottom: "-0.18em",
            fontFamily: "var(--font-syne), sans-serif",
            fontWeight: 800,
            fontSize: "clamp(8rem, 32vw, 26rem)",
            lineHeight: 0.8,
            color: "rgba(235,232,224,0.05)",
            letterSpacing: "-0.04em",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          0
        </div>

        {/* Centre stage: the wordmark, resolving out of the gathering field */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="intro-word-wrap"
            style={{
              position: "absolute",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.1rem",
              opacity: 0,
            }}
          >
            <span
              className="intro-word"
              style={{
                display: "flex",
                alignItems: "center",
                fontFamily: "var(--font-syne), sans-serif",
                fontWeight: 800,
                fontSize: "clamp(4.5rem, 19vw, 16rem)",
                lineHeight: 1,
                // Open, spaced-out letters. Positive tracking adds space AFTER the last glyph too, which
                // would push the whole word left of centre — the negative margin takes that back.
                letterSpacing: WORDMARK_TRACKING,
                marginRight: `-${WORDMARK_TRACKING}`,
              }}
            >
              {WORDMARK_BEFORE_SUN.split("").map((character, index) => (
                <span
                  key={`before-${index}`}
                  className="intro-letter"
                  style={{ display: "inline-block" }}
                >
                  {character}
                </span>
              ))}
              {/* the "o" — left empty; the sun overlays this slot. parkSunInO measures it live, so
                  moving it from the first letter to the second needs no change to the flight maths. */}
              <span
                ref={oSlotRef}
                aria-hidden
                // GatherCanvas measures this element to find where the gathering field converges.
                className="intro-o-slot"
                style={{
                  display: "inline-block",
                  width: "0.62em",
                  height: "0.62em",
                  // em, not px: a fixed nudge drifts as the fluid font size changes.
                  transform: "translateX(-0.04em)",
                }}
              />
              {WORDMARK_AFTER_SUN.split("").map((character, index) => (
                <span
                  key={`after-${index}`}
                  className="intro-letter"
                  style={{
                    display: "inline-block",
                    color:
                      index === WORDMARK_ACCENT_INDEX
                        ? "var(--sun-accent-bright)"
                        : "inherit",
                  }}
                >
                  {character}
                </span>
              ))}
            </span>
            <div
              className="intro-underline"
              style={{
                width: "min(52vw, 400px)",
                height: 1,
                background:
                  "linear-gradient(90deg, transparent, var(--sun-accent), transparent)",
                transform: "scaleX(0)",
              }}
            />

          </div>
        </div>
      </div>
    </div>

    {/* ⚠ A SIBLING of the root above, not a child of it. That root is `aria-hidden` with
        `pointer-events: none` — correct for a loader made entirely of decoration, and fatal for the
        one thing on it a visitor is meant to act on. Neither can be undone from inside: per spec,
        `aria-hidden="false"` on a descendant of an `aria-hidden="true"` element does not restore it.

        Rendered unconditionally and revealed by a class, so nothing here depends on a
        `prefersReducedMotion()` read during render — that would differ between server and client and
        break hydration, the same reason `GatherCanvas` always mounts. */}
    <MotionPrompt />
    {/* The exit, for a wait long enough to be worth escaping. A sibling for the same aria/pointer
        reason as above; unlike the motion offer it holds nothing and needs no wiring, so it decides
        its own timing. See SkipToLite. */}
    <SkipToLite />
    </>
  );
}
