"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import {
  getAssetProgress,
  areAssetsReady,
  areWarmupsDone,
  onAssetProgress,
  ASSETS_WARMUP_EVENT,
} from "@/lib/assetLoadProgress";
import { REVEAL_EVENT, INTRO_ACTIVE_EVENT } from "./introEvents";

// The shared sun lives in HeroSun. The intro only drives it:
//   .hero-sun-layer  — the outer layer (we fade its opacity in)
//   .hero-sun-flight — the inner element we fly from the "o" to the square
const SUN_LAYER_SELECTOR = ".hero-sun-layer";
const SUN_FLIGHT_SELECTOR = ".hero-sun-flight";
const HERO_SQUARE_SELECTOR = ".hero-sun-card";

// Slot-machine words that rip through before resolving to the wordmark.
const CYCLE_WORDS = [
  "WORLDS",
  "MOTION",
  "ORBIT",
  "STORIES",
  "SIGNAL",
  "STUDIO",
];
const ACCENT_WORD = "ORBIT";

// ── Timing (seconds) ───────────────────────────────────────────────────
const WORD_STEP = 0.2;
const WORD_START = 0.15;
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
// After assets download, kick off the (async) shader compiles and hold the reveal until the scenes
// report warm — capped so a machine that never reports can't trap the loader — then a short settle so
// the reveal always begins on a smooth beat rather than on the tail of a compile.
const WARMUP_WAIT_MAX_MS = 3000;
const WARMUP_SETTLE_MS = 250;

// The sun is sized to a little over the "o" glyph so it reads as filling it.
const SUN_IN_O_RATIO = 1.3;

const OVERLAY_Z_INDEX = 10000;

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
  const cycleRef = useRef<HTMLSpanElement>(null);
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

    // The gate opens in two stages once the timeline reaches the pre-handoff hold: first wait for the
    // assets to download, THEN kick off their shader compiles and wait for the scenes to report warm
    // (both capped by timeouts). The reveal resumes exactly once, only after everything is smooth.
    let gateReached = false;
    let warmupStarted = false;
    let hasResumed = false;
    let assetsTimedOut = false;
    let resumeFrame = 0;
    let warmupWaitTimeout = 0;
    // While we WAIT at the gate (for assets to download, then for their shaders to compile), breathe
    // the accent underline so the hold reads as "loading" and alive — the 5%-opacity ghost counter
    // alone is too faint to signal it. Idempotent so repeated calls don't stack tweens.
    const startHoldPulse = () => {
      gsap.killTweensOf(".intro-underline");
      gsap.to(".intro-underline", {
        opacity: 0.35, duration: 0.85, repeat: -1, yoyo: true, ease: "sine.inOut",
      });
    };
    const stopHoldPulse = () => {
      gsap.killTweensOf(".intro-underline");
      gsap.set(".intro-underline", { opacity: 1 });
    };

    // Resume the timeline into the handoff/reveal. Deferred a frame so it never runs inside addPause's
    // own callback (GSAP can swallow that) — and only ever once the scenes are actually warm.
    const resumeReveal = () => {
      if (hasResumed) return;
      hasResumed = true;
      window.clearTimeout(warmupWaitTimeout);
      stopHoldPulse();
      resumeFrame = requestAnimationFrame(() => timeline.resume());
    };

    // Scenes report when their shaders have finished compiling; once both are warm, wait a short
    // settle (a beat of smooth animation) then reveal — so the reveal never starts on the tail of a
    // compile. This is what stops the loader "stopping" as it hands off.
    const checkWarmup = () => {
      if (warmupStarted && !hasResumed && areWarmupsDone()) {
        window.clearTimeout(warmupWaitTimeout);
        warmupWaitTimeout = window.setTimeout(resumeReveal, WARMUP_SETTLE_MS);
      }
    };

    // Assets are in → kick off the async shader compiles and keep holding on the wordmark until the
    // scenes report warm (capped, so a machine that never reports can't trap the loader).
    const beginWarmupThenReveal = () => {
      if (warmupStarted) return;
      warmupStarted = true;
      startHoldPulse();
      window.dispatchEvent(new Event(ASSETS_WARMUP_EVENT));
      warmupWaitTimeout = window.setTimeout(resumeReveal, WARMUP_WAIT_MAX_MS);
      checkWarmup();
    };

    const tryBeginWarmup = () => {
      if (gateReached && (areAssetsReady() || assetsTimedOut)) beginWarmupThenReveal();
    };

    const stopAssetProgress = onAssetProgress(() => {
      syncCounterToAssets();
      tryBeginWarmup(); // assets finished downloading → start compiling
      checkWarmup();    // a scene reported its shaders warm → maybe settle + reveal
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

    // 3. Slot-machine word cycle, each ripping up through the centre.
    const cycle = cycleRef.current;
    CYCLE_WORDS.forEach((word, index) => {
      const at = WORD_START + index * WORD_STEP;
      timeline.add(() => {
        if (!cycle) return;
        cycle.textContent = word;
        cycle.style.color =
          word === ACCENT_WORD ? "var(--accent)" : "var(--fg)";
      }, at);
      timeline.fromTo(
        ".intro-cycle",
        { yPercent: 70, autoAlpha: 0, scaleX: 1.5 - index * 0.05 },
        {
          yPercent: 0,
          autoAlpha: 1,
          scaleX: 1,
          duration: 0.14,
          ease: "power3.out",
        },
        at,
      );
      timeline.to(
        ".intro-cycle",
        {
          yPercent: -70,
          autoAlpha: 0,
          scaleX: 0.6,
          duration: 0.12,
          ease: "power3.in",
        },
        at + 0.16,
      );
    });

    // 4. Reveal wordmark container + sun first — the sun appears alone in the "o".
    timeline.set(".intro-cycle-wrap", { autoAlpha: 0 }, ">");
    timeline.set(".intro-word-wrap", { autoAlpha: 1 });
    timeline.add(parkSunInO);
    if (sunLayer)
      timeline.to(sunLayer, { autoAlpha: 1, duration: SUN_FADE_IN }, "<");

    // Hold — the sun sits alone in the "o" before the letters arrive.
    timeline.to({}, { duration: SUN_SOLO_HOLD });

    // 5. "rbix" letters animate in after the sun has had its moment.
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

    timeline.to({}, { duration: HOLD_BEFORE_HANDOFF });

    // Hold here until the assets are in (or the safety timeout fires). If they're already loaded this
    // resumes on the same frame, so a fast / cached load feels exactly like before.
    timeline.addPause(">", () => {
      gateReached = true;
      if (areAssetsReady() || assetsTimedOut) beginWarmupThenReveal();
      else startHoldPulse(); // still downloading — show life; the warm-up begins once assets are in
    });

    // 6. Handoff — chrome leaves, the dark veil lifts to reveal the cream hero,
    //    and the sun shrinks + flies from the "o" into the hero square.
    const handoffLabel = "handoff";
    timeline.addLabel(handoffLabel);
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
      window.clearTimeout(assetWaitTimeout);
      window.clearTimeout(warmupWaitTimeout);
      cancelAnimationFrame(resumeFrame);
      gsap.killTweensOf(counterDisplay);
      gsap.killTweensOf(".intro-underline");
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
          orbix™
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
          Entering orbit
        </span>

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

        {/* Centre stage: cycle words → wordmark */}
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
            className="intro-cycle-wrap"
            style={{
              position: "absolute",
              width: "100%",
              textAlign: "center",
              overflow: "hidden",
            }}
          >
            <span
              ref={cycleRef}
              className="intro-cycle"
              style={{
                display: "inline-block",
                fontFamily: "var(--font-syne), sans-serif",
                fontWeight: 800,
                fontSize: "clamp(4rem, 17vw, 16rem)",
                lineHeight: 1,
                whiteSpace: "nowrap",
                letterSpacing: "-0.02em",
              }}
            >
              WORLDS
            </span>
          </div>

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
                fontSize: "clamp(3.5rem, 15vw, 12rem)",
                lineHeight: 1,
                letterSpacing: "-0.01em",
              }}
            >
              {/* the "o" — left empty; the sun overlays this slot */}
              <span
                ref={oSlotRef}
                aria-hidden
                style={{
                  display: "inline-block",
                  width: "0.62em",
                  height: "0.62em",
                  transform: "translateX(-5px)",
                }}
              />
              {"rbix".split("").map((character, index) => (
                <span
                  key={index}
                  className="intro-letter"
                  style={{
                    display: "inline-block",
                    color: character === "i" ? "var(--accent)" : "inherit",
                  }}
                >
                  {character}
                </span>
              ))}
            </span>
            <div
              className="intro-underline"
              style={{
                width: "min(40vw, 280px)",
                height: 1,
                background:
                  "linear-gradient(90deg, transparent, var(--accent), transparent)",
                transform: "scaleX(0)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
