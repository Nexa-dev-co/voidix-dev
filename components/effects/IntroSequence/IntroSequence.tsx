"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import {
  getSourceProgress,
  areArrivedWarmupsDone,
  isSourceLoaded,
  getMillisecondsSinceActivity,
  onAssetProgress,
  markStageQuiet,
  ASSETS_WARMUP_EVENT,
} from "@/lib/assetLoadProgress";
import { startCacheTelemetry } from "@/lib/cacheTelemetry";
import {
  REVEAL_EVENT,
  INTRO_ACTIVE_EVENT,
  IGNITE_EVENT,
  SUN_ASSEMBLE_EVENT,
  SUN_ASSEMBLED_EVENT,
} from "./introEvents";
import GatherCanvas from "./GatherCanvas";
import LoaderTelemetry from "./LoaderTelemetry/LoaderTelemetry";
import MotionPrompt from "./MotionPrompt/MotionPrompt";

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
// A short beat of empty frame before the wordmark resolves, so it arrives into stillness rather than
// on top of the frame still settling in.
const WORDMARK_DELAY = 0.55;
const RESOLVE_DURATION = 0.9;
const SUN_FADE_IN = 0.45;
const SUN_SOLO_HOLD = 0.2; // the sun sits alone in the "o" before the letters arrive
const HOLD_BEFORE_HANDOFF = 0.45;
const CHROME_FADE_OUT = 0.4;
const VEIL_FADE_OUT = 0.7;
const SUN_FLIGHT_DURATION = 1.1;
const SETTLE_AFTER_REVEAL = 0.4;
const REDUCED_MOTION_DELAY = 0.3;

/**
 * When the motion offer appears, in seconds from mount.
 *
 * Past the wordmark's resolve (WORDMARK_DELAY + SUN_FADE_IN + SUN_SOLO_HOLD + RESOLVE_DURATION lands
 * around 2.1 s), so it arrives into the still beat where the gate waits rather than competing with
 * the most expensive thing this loader draws. It is an aside, and it should read as one — it must
 * never be the thing you are looking at while the wordmark is assembling.
 */
const MOTION_PROMPT_DELAY = 2.4;
/** The quiet path has no timeline to wait out — the stage is still from the first frame. */
const MOTION_PROMPT_DELAY_QUIET = 0.8;
/** Toggled by the loader rather than by React — see MotionPrompt's header for why. */
const MOTION_PROMPT_SHOWN_CLASS = "is-offered";
const MOTION_PROMPT_SELECTOR = ".intro-motion-prompt";

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
const WARMUP_WAIT_MAX_MS = 3500;
const ASSEMBLY_WAIT_MAX_MS = 3500;
const WARMUP_SETTLE_MS = 250;
/**
 * A held beat between the last compile and the first frame of the shard flight.
 *
 * The flight is the loader's finale and it is delta-timed with a clamp, so whatever it loses in its
 * opening frames it can never make back. Handing it the frame straight after two scenes have finished
 * compiling and allocating their composers is the one place on the loader where that is most likely.
 *
 * ⚠ It ADDS to the gate's serial caps. `ASSEMBLE_CUE_FALLBACK_MS` in SunModelCanvas has to stay past
 * WARMUP_WAIT_MAX_MS + this, or the sun cues its own assembly first and the two race — which is the
 * one comparison that survived the download wait becoming unbounded, because both sides of it are now
 * measured from the same moment: the model landing.
 */
const ASSEMBLY_LEAD_MS = 1000;

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
    const offerMotionChoice = () => {
      document
        .querySelector(MOTION_PROMPT_SELECTOR)
        ?.classList.add(MOTION_PROMPT_SHOWN_CLASS);
    };
    const withdrawMotionChoice = () => {
      window.clearTimeout(motionPromptTimer);
      document
        .querySelector(MOTION_PROMPT_SELECTOR)
        ?.classList.remove(MOTION_PROMPT_SHOWN_CLASS);
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
            Math.round(getSourceProgress("sun") * 100),
          );
        }
      };

      const isStarSettled = () => {
        if (isSourceLoaded("sun")) return true;
        // ⚠ `null` means the star has never reported — its chunk may not have mounted yet — so the
        // wait is measured from when it started rather than read as "silent for 0 ms", which would
        // wait forever on a source that never begins. Same reasoning as `tickGate`.
        const sinceActivity = getMillisecondsSinceActivity("sun");
        const silentFor =
          sinceActivity ?? performance.now() - quietWaitStartedAt;
        return silentFor > ASSET_STALL_GIVE_UP_MS;
      };

      const finishQuietIntro = () => {
        window.clearInterval(quietTicker);
        withdrawMotionChoice();
        quietRevealTimeout = window.setTimeout(() => {
          revealHero();
          unlockScroll();
          setDone(true);
        }, REDUCED_MOTION_DELAY * 1000);
      };

      // Worth making the offer on THIS path above all others: the visitor has arrived with the OS
      // flag set, and this is where the site says so out loud and hands back the choice, rather than
      // stripping itself down without ever mentioning it.
      motionPromptTimer = window.setTimeout(
        offerMotionChoice,
        MOTION_PROMPT_DELAY_QUIET * 1000,
      );

      paintQuietCounter();
      if (isStarSettled()) {
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
          if (isStarSettled()) finishQuietIntro();
        }, GATE_TICK_MS);
      }

      return () => {
        window.clearInterval(quietTicker);
        window.clearTimeout(quietRevealTimeout);
        window.clearTimeout(motionPromptTimer);
        unlockScroll();
      };
    }

    motionPromptTimer = window.setTimeout(
      offerMotionChoice,
      MOTION_PROMPT_DELAY * 1000,
    );

    // Release the scroll lock when the intro actually finishes (the component returns
    // null but stays mounted, so the effect cleanup can't be relied on to unlock).
    const timeline = gsap.timeline({
      onComplete: () => {
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
      gsap.to(counterDisplay, {
        value: Math.round(getSourceProgress('sun') * 100),
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
    let hasResumed = false;
    /** The star stopped showing any sign of life — proceed without it rather than wait forever. */
    let starGaveUp = false;
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

    // Resume the timeline into the handoff/reveal. Deferred a frame so it never runs inside addPause's
    // own callback (GSAP can swallow that) — and only ever once the star is actually built.
    const resumeReveal = () => {
      if (hasResumed) return;
      hasResumed = true;
      window.clearTimeout(gateTimeout);
      stopHoldPulse();
      // Taken off screen before the handoff, not left to fade with the veil — it is a SIBLING of the
      // intro root, so the veil's fade-out does not cover it and it would otherwise still be sitting
      // over the hero after the reveal.
      withdrawMotionChoice();
      resumeFrame = requestAnimationFrame(() => timeline.resume());
    };

    // ── Stage 3: the shards have landed → a short settle, then the reveal ──
    // The settle is a beat of smooth animation before the handoff, so the reveal never begins on the
    // tail of anything. This is what stops the loader "stopping" as it hands off.
    const settleThenReveal = () => {
      if (hasResumed) return;
      window.clearTimeout(gateTimeout);
      gateTimeout = window.setTimeout(resumeReveal, WARMUP_SETTLE_MS);
    };

    // ── Stage 2: the scenes are warm → NOW fly the shards in ──
    // The hold continues through the assembly: that flight IS the loader's last beat, so revealing over
    // the top of it would throw away the payoff. It gets a quiet main thread to play on because the
    // compiles are already behind us.
    const cueAssembly = () => {
      if (assemblyCued || hasResumed) return;
      assemblyCued = true;
      window.clearTimeout(gateTimeout);
      // ── One quiet beat before the star moves ──
      // The frame that precedes this one has just finished compiling two WebGL scenes and allocating
      // their composers. Handing the shard flight the very next frame means its opening — the part that
      // sets the pace for the whole 2.2 s sweep — is drawn on a GPU that has not yet caught its breath,
      // and the flight is delta-timed with a clamp, so it cannot make that time back up.
      //
      // A second of stillness costs a second of loader and buys the finale a clean start. It also reads
      // better: the star arrives into a held frame rather than on the tail of the counter hitting 100.
      gateTimeout = window.setTimeout(() => {
        window.dispatchEvent(new Event(SUN_ASSEMBLE_EVENT));
        // The sun can already be assembled by the time we ask, and it will not report a second
        // time. Its own safety net (ASSEMBLE_CUE_FALLBACK_MS, armed from the model landing) can
        // fire before this cue does on a load where the warm stage runs long — so the star
        // assembles itself and reports into a listener that is not yet waiting for it.
        // ⚠ NOT because of reduced motion, which an earlier revision of this comment claimed: that
        // path returns before this gate is ever built.
        if (sunAssembled) settleThenReveal();
        else gateTimeout = window.setTimeout(settleThenReveal, ASSEMBLY_WAIT_MAX_MS);
      }, ASSEMBLY_LEAD_MS);
    };

    const onSunAssembled = () => {
      sunAssembled = true;
      if (assemblyCued) settleThenReveal();
    };
    window.addEventListener(SUN_ASSEMBLED_EVENT, onSunAssembled);

    const checkWarm = () => {
      // ⚠ `areArrivedWarmupsDone`, not `areWarmupsDone`. The reveal waits on the star now, so on a
      // slow connection the fleet can still be streaming when the star is ready — and a scene that
      // has not downloaded cannot have compiled. Requiring it to would make every slow load sit out
      // this stage's full cap for a scene nobody will see for another minute. On a fast load all
      // three are in before this is consulted, so the two are the same function.
      if (warmupStarted && !assemblyCued && areArrivedWarmupsDone()) cueAssembly();
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
      gateTimeout = window.setTimeout(cueAssembly, WARMUP_WAIT_MAX_MS);
      checkWarm(); // a scene can already be warm — on a fast load it will be
    };

    // ── What the reveal actually waits for ──
    // The STAR, and nothing else. The hero opens on it; the fleet and the field are a minute of
    // scrolling away and used to hold the reveal for no reason anyone could point at.
    const tryBeginWarmup = () => {
      if (gateReached && (isSourceLoaded('sun') || starGaveUp)) beginWarmup();
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

      // ── Tell the hero we are still here ──
      // Its ultimate reveal-fallback is a fixed 20 s (REVEAL_FALLBACK_WITH_INTRO_MS), sized back when
      // this gate gave up after 12 s. It now waits for as long as the star keeps arriving, which on a
      // slow connection is far longer than that — so without this heartbeat the hero would reveal
      // itself behind the veil, building its pin while scroll is still locked. Its handler clears and
      // re-arms on every one of these, which is precisely what is wanted.
      window.dispatchEvent(new Event(INTRO_ACTIVE_EVENT));

      // ── Is it still alive? ──
      // Against ACTIVITY, not against the fraction: a server sending no `Content-Length` cannot move
      // the fraction at all, and reading that as a stall would abandon a perfectly healthy download.
      // `null` means the star has never reported — its chunk may not even have mounted yet — so the
      // wait is measured from when the gate started instead of giving up on something not begun.
      const sinceActivity = getMillisecondsSinceActivity('sun');
      const silentFor =
        sinceActivity ?? (gateWaitStartedAt ? performance.now() - gateWaitStartedAt : 0);
      if (silentFor > ASSET_STALL_GIVE_UP_MS) {
        starGaveUp = true;
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

    // 3. Reveal wordmark container + sun — the sun appears alone in the "o". No slot-machine words
    //    any more: the gathering field IS the loader's motion, and a word cycle on top of it was two
    //    things competing for the same beat.
    timeline.set(".intro-word-wrap", { autoAlpha: 1 }, WORDMARK_DELAY);
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

    // ── The stage is now still: the heavy scenes may compile ──
    //
    // ⚠ Dispatched HERE, from the timeline, rather than from the gate at 100%. It no longer means
    // "the assets are in" — each scene knows that about itself — it means "the loader has finished
    // animating, so a GPU stall will not be seen".
    //
    // Both readings have been shipped and both were wrong on their own. Firing at 100% stacked two
    // compiles and two first composer allocations immediately before the shard flight. Firing on each
    // scene's own assets instead put them on top of the wordmark: five Syne 800 glyphs at up to 256 px
    // animating transform and opacity through a `back.out` overshoot is the most expensive thing this
    // loader ever draws, and on a fast connection the field's assets land right in the middle of it.
    //
    // A scene warms when BOTH are true, which is this signal and its own readiness — so the compile
    // lands in the still beat below, where the only thing that has to look alive is the dust, and the
    // dust is in a worker.
    //
    // Recorded as STATE as well as fired as an event: both scenes are dynamically imported, so on a
    // slow connection a chunk can arrive after this line has already run, and a scene listening only
    // for the event would wait forever on one that had already gone. See `isStageQuiet`.
    timeline.add(() => {
      markStageQuiet();
      window.dispatchEvent(new Event(ASSETS_WARMUP_EVENT));
    });

    timeline.to({}, { duration: HOLD_BEFORE_HANDOFF });

    // Hold here until the assets are in (or the safety timeout fires). If they're already loaded this
    // resumes on the same frame, so a fast / cached load feels exactly like before.
    timeline.addPause(">", () => {
      gateReached = true;
      if (isSourceLoaded('sun') || starGaveUp) {
        beginWarmup();
        return;
      }
      // Still waiting on the star. Show life, and start the clock that decides whether this wait is
      // short enough to simply sit through or long enough to need explaining.
      startHoldPulse();
      gateWaitStartedAt = performance.now();
      gateTicker = window.setInterval(tickGate, GATE_TICK_MS);
      tickGate();
    });

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
      unlockScroll();
      stopAssetProgress();
      window.removeEventListener(SUN_ASSEMBLED_EVENT, onSunAssembled);
      window.clearInterval(gateTicker);
      window.clearTimeout(gateTimeout);
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
    </>
  );
}
