"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import {
  getAssetProgress,
  areAssetsReady,
  areWarmupsDone,
  onAssetProgress,
  markStageQuiet,
  ASSETS_WARMUP_EVENT,
} from "@/lib/assetLoadProgress";
import {
  REVEAL_EVENT,
  INTRO_ACTIVE_EVENT,
  IGNITE_EVENT,
  SUN_ASSEMBLE_EVENT,
  SUN_ASSEMBLED_EVENT,
} from "./introEvents";
import GatherCanvas from "./GatherCanvas";
import LoaderTelemetry from "./LoaderTelemetry/LoaderTelemetry";

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

// Loader gate: how smoothly the counter chases real load progress, and the longest we'll hold the
// reveal waiting for assets before proceeding anyway (a safety net so a stalled asset can't trap the
// user at the loader). Kept well under the hero's REVEAL fallback so the intro always reveals first.
const COUNTER_EASE_SECONDS = 0.5;
const ASSET_WAIT_TIMEOUT_MS = 12000;
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
// Each stage is capped, so a scene that never reports or a sun that never loads can't trap the loader.
// ⚠ They are SERIAL, so the caps ADD. `ASSEMBLE_CUE_FALLBACK_MS` in SunModelCanvas is the sun's own
// backstop and has to stay past ASSET_WAIT_TIMEOUT_MS + both of these, or on a stalled load it would cue
// the assembly itself, mid-compile — which is the exact thing this split exists to prevent.
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
 * ASSET_WAIT_TIMEOUT_MS + WARMUP_WAIT_MAX_MS + this, or on a stalled load the sun cues its own assembly
 * first and the two race.
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
    // Tell the hero an intro is actually running (so it extends its reveal-fallback and doesn't fire
    // early during a legitimate slow load). The hero's effect runs before this one, so its listener
    // is already registered.
    window.dispatchEvent(new Event(INTRO_ACTIVE_EVENT));

    const revealHero = () => window.dispatchEvent(new Event(REVEAL_EVENT));
    const sunLayer = document.querySelector(SUN_LAYER_SELECTOR);
    const sunFlight = document.querySelector(SUN_FLIGHT_SELECTOR);

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

    // Reduced motion: skip the show — drop the sun home, reveal, unmount.
    if (prefersReducedMotion()) {
      // Nothing is going to animate, so the stage is already as quiet as it will ever be. Said out
      // loud, because the timeline that normally says it is never built on this path — and a scene
      // waiting on it would never warm, and would compile on the frame it is first drawn instead.
      markStageQuiet();
      window.dispatchEvent(new Event(ASSETS_WARMUP_EVENT));
      if (counterRef.current) counterRef.current.textContent = "100";
      if (sunLayer) gsap.set(sunLayer, { autoAlpha: 1 });
      if (sunFlight) gsap.set(sunFlight, { x: 0, y: 0, scale: 1 });
      const timeoutId = window.setTimeout(() => {
        revealHero();
        unlockScroll();
        setDone(true);
      }, REDUCED_MOTION_DELAY * 1000);
      return () => {
        window.clearTimeout(timeoutId);
        unlockScroll();
      };
    }

    // Release the scroll lock when the intro actually finishes (the component returns
    // null but stays mounted, so the effect cleanup can't be relied on to unlock).
    const timeline = gsap.timeline({
      onComplete: () => {
        unlockScroll();
        setDone(true);
      },
    });

    // ── Honest loader: real asset progress + hold the reveal until it's in ──
    // The counter now reflects what's actually loading (eased so it climbs smoothly), and the intro
    // pauses at the pre-handoff beat until every asset the entry needs is loaded — or a safety
    // timeout elapses — so the reveal never lands on a half-built scene. See lib/assetLoadProgress.
    const counterDisplay = { value: 0 };
    const paintCounter = () => {
      if (counterRef.current) {
        counterRef.current.textContent = String(Math.round(counterDisplay.value));
      }
    };
    const syncCounterToAssets = () => {
      gsap.to(counterDisplay, {
        value: Math.round(getAssetProgress() * 100),
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
    let assetsTimedOut = false;
    let sunAssembled = false;
    let resumeFrame = 0;
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
        // The sun can already be assembled by the time we ask — under reduced motion it reports the
        // moment its model lands (SunModelCanvas), and it will not report a second time.
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
      if (warmupStarted && !assemblyCued && areWarmupsDone()) cueAssembly();
    };

    // ── Stage 1: 100% downloaded → wait for the shader compiles ──
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

    const tryBeginWarmup = () => {
      if (gateReached && (areAssetsReady() || assetsTimedOut)) beginWarmup();
    };

    const stopAssetProgress = onAssetProgress(() => {
      syncCounterToAssets();
      tryBeginWarmup(); // assets finished downloading → start compiling
      checkWarm();      // a scene reported its shaders warm → maybe start the shards
    });
    const assetWaitTimeout = window.setTimeout(() => {
      assetsTimedOut = true;
      tryBeginWarmup();
    }, ASSET_WAIT_TIMEOUT_MS);
    syncCounterToAssets(); // paint whatever has already loaded before the first new report

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
      if (areAssetsReady() || assetsTimedOut) beginWarmup();
      else startHoldPulse(); // still downloading — show life; the warm-up begins once assets are in
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
      window.clearTimeout(assetWaitTimeout);
      window.clearTimeout(gateTimeout);
      cancelAnimationFrame(resumeFrame);
      gsap.killTweensOf(counterDisplay);
      stopHoldPulse(); // a class now, not a tween — killTweensOf would no longer clear it
    };
  }, []);

  if (done) return null;

  return (
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
  );
}
