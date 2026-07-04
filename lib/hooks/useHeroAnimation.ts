import { useCallback, useEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { measureUntransformedRect } from '@/lib/measureUntransformedRect';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT, GOTO_SERVICES_EVENT } from '@/components/sections/ServicesDeck/deckEvents';
import { WORKS_REVEAL_EVENT } from '@/components/sections/WorksField/worksEvents';

// Marks the hero while a full-black scene (fleet or works) is on screen. Scopes the layering (sun
// drops behind, intervening hero layers go transparent) so it never touches the fill phase.
const SERVICES_CLASS = 'is-services';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
// A mobile address bar showing/hiding fires a resize on almost every scroll. Don't re-pin /
// re-measure on those vertical-only changes — only on real (width / orientation) ones — or the
// pinned square + sun jitter as you scroll on a phone.
ScrollTrigger.config({ ignoreMobileResize: true });

// ── One pin, one continuous scroll ─────────────────────────────────────
// A single pinned ScrollTrigger owns the whole homepage journey so there's never a second pinned
// section glued on with a seam:
//   phase 1 (scrubbed) — the black square fills the screen, the sun rises
//   at fill = 1         — a carousel of "stops" begins, all on the now-full-black screen:
//     stops 0..craftCount-1        → the services fleet (one craft each)
//     stops craftCount..end        → the works field (one project meteor each)
//   The services→works handoff is just the next scroll step — the deck fades out, the field fades
//   in — so there is no separate works pin and no dead scroll between them.
const SCROLL_SCRUB     = 1.8;
const FILL_SCROLL_VH   = 120; // viewport-heights of scroll the square takes to fill
const STAGE_SCROLL_VH  = 100; // ...and per carousel stop after it (a craft, or a project meteor)
const SUN_SCROLL_SCALE = 1.1; // the sun grows to 1.1× as the square fills
const SUN_SCROLL_RISE  = 200; // px the sun lifts above the square's centre and holds

// Overlay reveal / hide, keyed to which stop the carousel is on.
const DECK_REVEAL_DURATION  = 0.6;
const DECK_HIDE_DURATION    = 0.4;
const WORKS_REVEAL_DURATION = 0.6;
const WORKS_HIDE_DURATION   = 0.4;
const GOTO_DURATION         = 0.6; // programmatic scroll when a label/arrow jumps to a stop
const SNAP_DURATION         = 0.5; // how quickly the carousel settles onto the nearest stop
// The carousel stops start a touch *past* the fill, so stop 0 lands on the fully revealed fleet
// instead of the fill/transition edge (which read as the section scrolling away).
const CAROUSEL_SETTLE_FRACTION = 0.06;

// ── Reveal (runs when the intro lands the sun in the square) ───────────
const TEXT_WIPE_DURATION   = 0.9;
const TEXT_WIPE_STAGGER    = 0.12;
const SQUARE_FILL_DURATION = 1.1; // the "cup filling with water" rise
const SUB_FADE_DURATION    = 0.6;
const FILL_START           = 0.25; // begins just after the headline starts rising
const FULL_CLIP  = 'inset(0% 0 0 0)';
const EMPTY_CLIP = 'inset(100% 0 0 0)';
// If the intro never fires its reveal (e.g. it was bypassed), reveal anyway.
const REVEAL_FALLBACK_MS = 7000;

const SUN_LAYER_SELECTOR = '.hero-sun-layer';
const DECK_SELECTOR      = '.services-deck';
const WORKS_SELECTOR     = '.works-field';

type Stage = 'fill' | 'services' | 'works';

interface HeroAnimationRefs {
  sectionRef:  RefObject<HTMLElement | null>;
  heroCardRef: RefObject<HTMLDivElement | null>;
  /** Set the craft on the pad — driven by the services stops of the pin. */
  setActiveCraft: (index: number) => void;
  /** How many craft the services carousel cycles through. */
  craftCount: number;
  /** Set the focused project — driven by the works stops of the pin. */
  setActiveProject: (index: number) => void;
  /** How many project meteors the works carousel cycles through. */
  projectCount: number;
}

export function useHeroAnimation(heroAnimationRefs: HeroAnimationRefs) {
  const { sectionRef, heroCardRef, setActiveCraft, craftCount, setActiveProject, projectCount } =
    heroAnimationRefs;

  // Keep the latest setters so the pin (built once at reveal) always calls the current closures.
  const setActiveCraftRef = useRef(setActiveCraft);
  setActiveCraftRef.current = setActiveCraft;
  const setActiveProjectRef = useRef(setActiveProject);
  setActiveProjectRef.current = setActiveProject;

  // The live jump fns live in refs so the returned callbacks stay stable across renders.
  const goToCraftImplRef = useRef<(index: number) => void>((index) =>
    setActiveCraftRef.current(index),
  );
  const goToProjectImplRef = useRef<(index: number) => void>((index) =>
    setActiveProjectRef.current(index),
  );

  useEffect(() => {
    const heroSection     = sectionRef.current;
    const heroCardElement = heroCardRef.current;
    if (!heroSection || !heroCardElement) return;

    const reduceMotion = prefersReducedMotion();

    // The carousel is one flat list of stops: [craft 0..N] then [project 0..M]. `steps` is the
    // number of gaps between them, so a uniform snap covers every stop.
    const totalStops = craftCount + projectCount;
    const steps      = Math.max(totalStops - 1, 1);
    const totalVh    = FILL_SCROLL_VH + steps * STAGE_SCROLL_VH;
    // The fraction of the pin the square-fill occupies; the carousel owns the rest.
    const fillFraction = FILL_SCROLL_VH / totalVh;
    // Stops sit in [carouselStart, 1] — a touch past the fill so stop 0 isn't on the reveal edge.
    const carouselStart = fillFraction + (1 - fillFraction) * CAROUSEL_SETTLE_FRACTION;
    const carouselSpan  = 1 - carouselStart;
    const projectSteps  = Math.max(projectCount - 1, 1);

    const textInners = heroSection.querySelectorAll('.hero-mask-inner');
    const squareFill = heroSection.querySelector('.hero-sun-fill');
    const subline    = heroSection.querySelector('.hero-sub');
    const sunLayer   = document.querySelector(SUN_LAYER_SELECTOR);
    const deck       = heroSection.querySelector<HTMLElement>(DECK_SELECTOR);
    const works      = heroSection.querySelector<HTMLElement>(WORKS_SELECTOR);

    // 1. Hide everything the reveal/transition will bring in. The intro veil covers
    //    the hero while this runs, so there's no flash.
    gsap.set(textInners, { yPercent: 115 });
    if (subline) gsap.set(subline, { autoAlpha: 0, y: 12 });
    if (squareFill) gsap.set(squareFill, { clipPath: EMPTY_CLIP });
    if (deck) gsap.set(deck, { autoAlpha: 0 });
    if (works) gsap.set(works, { autoAlpha: 0 });

    // ── Stage transitions — which full-black scene is on screen ──
    // The sun's "behind + energised" state is turned on when the fleet first reveals and stays on
    // through works; it's only turned back off (sun forward, calm) when we scroll back to the fill.
    const fade = (element: Element | null, alpha: number, duration: number) => {
      if (!element) return;
      gsap.to(element, {
        autoAlpha: alpha,
        duration:  reduceMotion ? 0 : duration,
        ease:      alpha ? 'power2.out' : 'power2.in',
        overwrite: true,
      });
    };

    let currentStage: Stage = 'fill';
    const enterFill = () => {
      heroSection.classList.remove(SERVICES_CLASS);
      fade(deck, 0, DECK_HIDE_DURATION);
      fade(works, 0, WORKS_HIDE_DURATION);
      // Return the sun to its calm hero look + front position.
      window.dispatchEvent(new Event(DECK_HIDE_EVENT));
    };
    const enterServices = () => {
      heroSection.classList.add(SERVICES_CLASS);
      fade(works, 0, WORKS_HIDE_DURATION);
      fade(deck, 1, DECK_REVEAL_DURATION);
      // Replay the centred craft's entrance + drop the sun behind the fleet / energise it.
      window.dispatchEvent(new Event(DECK_REVEAL_EVENT));
    };
    const enterWorks = () => {
      // Keep the services layering (sun stays behind), just swap the fleet overlay for the field.
      heroSection.classList.add(SERVICES_CLASS);
      fade(deck, 0, DECK_HIDE_DURATION);
      fade(works, 1, WORKS_REVEAL_DURATION);
      // Replay the focused meteor's ignition. We deliberately DON'T fire DECK_HIDE here, so the sun
      // stays parked behind (the works field's opaque backdrop covers it).
      window.dispatchEvent(new Event(WORKS_REVEAL_EVENT));
    };
    const setStage = (stage: Stage) => {
      if (stage === currentStage) return;
      currentStage = stage;
      if (stage === 'fill') enterFill();
      else if (stage === 'services') enterServices();
      else enterWorks();
    };

    // Free scrub through the fill, then snap to the nearest stop across both carousels.
    const snapProgress = (value: number) => {
      if (value <= carouselStart) return value; // free scrub through the fill + settle zone
      const carouselProgress = (value - carouselStart) / carouselSpan;
      const snapped = Math.round(carouselProgress * steps) / steps;
      return carouselStart + snapped * carouselSpan;
    };

    // 2. The single pin — built lazily at reveal, never on mount (Contract 2). While the loader
    //    plays the page is locked at the top, but the binding must not exist at all: a restored or
    //    stray scroll would otherwise drive the sun/square while it's still flying in.
    let scrollTimeline: ReturnType<typeof gsap.timeline> | null = null;
    let lastCraft = -1;
    let lastProject = -1;

    // Where the square + sun must travel/scale to fill the viewport. Measured from the square's
    // *untransformed* layout and recomputed on every ScrollTrigger refresh — see invalidateOnRefresh
    // / onRefreshInit below. This keeps the sun locked to the square on resize.
    const computeGeometry = () => {
      const rect = measureUntransformedRect(heroCardElement);
      const cardCenterX = rect.left + rect.width  / 2;
      const cardCenterY = rect.top  + rect.height / 2;
      return {
        translateX: document.documentElement.clientWidth / 2 - cardCenterX,
        translateY: window.innerHeight / 2 - cardCenterY,
        scaleX:     document.documentElement.clientWidth / rect.width,
        scaleY:     window.innerHeight / rect.height,
      };
    };
    let geometry = computeGeometry();

    const createTransition = () => {
      scrollTimeline = gsap.timeline({
        scrollTrigger: {
          trigger:       heroSection,
          start:         'top top',
          end:           `+=${totalVh}%`,
          pin:           true,
          scrub:         SCROLL_SCRUB,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onRefreshInit: () => { geometry = computeGeometry(); },
          snap:
            steps > 0
              ? { snapTo: snapProgress, duration: reduceMotion ? 0 : SNAP_DURATION, ease: 'power2.inOut' }
              : undefined,
          onUpdate: (self) => {
            const progress = self.progress;
            // Feed the navbar "home" meter with the fill phase only.
            document.documentElement.style.setProperty(
              '--nav-progress-home',
              String(Math.min(progress / fillFraction, 1)),
            );

            if (progress < fillFraction) {
              setStage('fill');
              document.documentElement.style.setProperty('--nav-progress-work', '0');
              return;
            }

            const carouselProgress = gsap.utils.clamp(0, 1, (progress - carouselStart) / carouselSpan);
            const stageProgress = carouselProgress * steps; // 0..steps across every stop
            const stop = Math.round(stageProgress);

            if (stop < craftCount) {
              setStage('services');
              document.documentElement.style.setProperty('--nav-progress-work', '0');
              if (stop !== lastCraft) {
                lastCraft = stop;
                setActiveCraftRef.current(stop);
              }
            } else {
              setStage('works');
              const project = stop - craftCount;
              // Fill the "work" meter across the project stops.
              const worksMeter = gsap.utils.clamp(0, 1, (stageProgress - craftCount) / projectSteps);
              document.documentElement.style.setProperty('--nav-progress-work', String(worksMeter));
              if (project !== lastProject) {
                lastProject = project;
                setActiveProjectRef.current(project);
              }
            }
          },
        },
      });

      // Phase 1 — the square expands to fill the viewport while the sun rises + grows.
      // Function-based values so invalidateOnRefresh recomputes them from fresh geometry.
      scrollTimeline.to(heroCardElement, {
        x:            () => geometry.translateX,
        y:            () => geometry.translateY,
        scaleX:       () => geometry.scaleX,
        scaleY:       () => geometry.scaleY,
        borderRadius: 0,
        ease:         'power1.inOut',
        duration:     fillFraction,
      }, 0);

      if (sunLayer) {
        scrollTimeline.to(sunLayer, {
          x:        () => geometry.translateX,
          y:        () => geometry.translateY - SUN_SCROLL_RISE, // sits a little above centre and holds
          scale:    SUN_SCROLL_SCALE,
          ease:     'power1.inOut',
          duration: fillFraction,
        }, 0);
      }

      // Phase 2 — hold the filled square + risen sun while the carousel scroll runs.
      scrollTimeline.to({}, { duration: 1 - fillFraction });
    };

    // 3. Reveal — fired once, when the intro lands the sun in the square. This is also
    //    the moment the pin is allowed to come online (Contract 2).
    let hasRevealed = false;
    const runReveal = () => {
      if (hasRevealed) return;
      hasRevealed = true;

      createTransition();

      if (prefersReducedMotion()) {
        gsap.set(textInners, { yPercent: 0 });
        if (subline) gsap.set(subline, { autoAlpha: 1, y: 0 });
        if (squareFill) gsap.set(squareFill, { clipPath: FULL_CLIP });
        return;
      }

      const revealTimeline = gsap.timeline();
      // a. headline rises out of its masks
      revealTimeline.to(textInners, {
        yPercent: 0,
        duration: TEXT_WIPE_DURATION,
        stagger:  TEXT_WIPE_STAGGER,
        ease:     'power4.out',
      }, 0);
      // b. the square pours in like water behind the sun
      if (squareFill) revealTimeline.to(squareFill, {
        clipPath: FULL_CLIP,
        duration: SQUARE_FILL_DURATION,
        ease:     'power2.inOut',
      }, FILL_START);
      // c. tagline settles last
      if (subline) revealTimeline.to(subline, {
        autoAlpha: 1, y: 0, duration: SUB_FADE_DURATION, ease: 'power2.out',
      }, '>-0.3');
    };

    window.addEventListener(REVEAL_EVENT, runReveal);
    const fallbackTimeout = window.setTimeout(runReveal, REVEAL_FALLBACK_MS);

    // The navbar "Services" link asks the pin to scroll to the revealed fleet (craft 0).
    const onGotoServices = () => goToCraftImplRef.current(0);
    window.addEventListener(GOTO_SERVICES_EVENT, onGotoServices);

    // Jump to a stop by scrolling to its snap point; onUpdate then re-stages it. Before the pin
    // exists (e.g. reduced-motion bypass), fall back to setting the index directly.
    const goToStop = (stop: number) => {
      const trigger = scrollTimeline?.scrollTrigger;
      if (!trigger) {
        if (stop < craftCount) setActiveCraftRef.current(stop);
        else setActiveProjectRef.current(stop - craftCount);
        return;
      }
      const targetProgress = carouselStart + (stop / steps) * carouselSpan;
      const targetScroll   = trigger.start + targetProgress * (trigger.end - trigger.start);
      gsap.to(window, {
        scrollTo:  targetScroll,
        duration:  reduceMotion ? 0 : GOTO_DURATION,
        ease:      'power2.inOut',
        overwrite: true,
      });
    };
    goToCraftImplRef.current = (index) => goToStop(gsap.utils.clamp(0, craftCount - 1, index));
    goToProjectImplRef.current = (index) =>
      goToStop(craftCount + gsap.utils.clamp(0, projectCount - 1, index));

    return () => {
      window.removeEventListener(REVEAL_EVENT, runReveal);
      window.removeEventListener(GOTO_SERVICES_EVENT, onGotoServices);
      window.clearTimeout(fallbackTimeout);
      gsap.killTweensOf(window);
      scrollTimeline?.scrollTrigger?.kill();
      scrollTimeline?.kill();
    };
    // Built once at reveal; the counts are constant for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRef, heroCardRef, craftCount, projectCount]);

  const goToCraft = useCallback((index: number) => goToCraftImplRef.current(index), []);
  const goToProject = useCallback((index: number) => goToProjectImplRef.current(index), []);
  return { goToCraft, goToProject };
}
