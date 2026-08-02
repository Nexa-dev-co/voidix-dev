/**
 * The hero → services transition: the stretch of the hero pin from the top of the page to the moment
 * the fleet is on screen. The square growing to fill the viewport IS this transition, and the shared
 * sun changes state across it (peaceful → cracks — see SunModelCanvas).
 *
 * The pin dispatches this on every scroll update whose values changed. It is the same contract as
 * {@link HANDOFF_PROGRESS_EVENT} and {@link CHAMBER_PROGRESS_EVENT}, and exists for the same reason:
 * one scrubbed signal, consumed by a scene that eases its own copy per frame, so the choreography
 * cannot be outrun and reverses exactly.
 *
 * ── Why TWO fractions ──────────────────────────────────────────────────────────────────────────
 * Because the span contains a landmark the consumer needs but cannot derive: the moment the square
 * finishes covering the viewport. That is where the page goes black, the headline is cut, and the
 * fleet begins to reveal — and it sits partway through `progress` (currently ~0.68), at a position
 * that falls out of the carousel layout and would silently drift if a section were added.
 *
 * So the pin publishes both, and a consumer picks whichever space its effect actually lives in:
 * anything that must land ON the black uses `fill`; anything that must land on the FLEET uses
 * `progress`. Neither side hard-codes a derived constant.
 */
export const HERO_SERVICES_PROGRESS_EVENT = 'voidix:hero-services';

export interface HeroServicesProgressDetail {
  /** 0 at the top of the page → 1 with the fleet on screen (the first craft stop). */
  progress: number;
  /** 0 → 1 as the black square grows to cover the viewport. Reaches 1 partway through `progress`. */
  fill: number;
}

/** Safely pull both fractions out of a {@link HERO_SERVICES_PROGRESS_EVENT} listener's event. */
export function readHeroServicesProgress(event: Event): HeroServicesProgressDetail {
  const detail = (event as CustomEvent<HeroServicesProgressDetail>).detail;
  return {
    progress: typeof detail?.progress === 'number' ? detail.progress : 0,
    fill: typeof detail?.fill === 'number' ? detail.fill : 0,
  };
}
