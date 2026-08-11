/**
 * The Services vessel's assembly progress — the one number the whole build runs on.
 *
 * The deck no longer shows four separate ships. It shows ONE ship that does not exist yet: its parts
 * adrift at the edges of the frame, arriving one wave per service, until the machine is complete at
 * the AI stop and flies you into Works (see docs/services-vessel-assembly-plan.md).
 *
 * ⚠ This is a SCRUB, not a cue, and that is the whole design. The portal swap it replaces was a ~2.8 s
 * GSAP timeline, which a carousel stop is allowed to be — but an assembly that is time-based can be
 * outrun by a fast flick, desyncs from the scroll, and cannot come apart when you scroll back up. As a
 * pure function of pin progress it reverses perfectly, cannot be outrun, and a resize just re-derives
 * it. Same rule as every crossing on the site (CLAUDE.md, "the rules that keep this working" §2).
 *
 * ── The mapping ──────────────────────────────────────────────────────────────────────────────────
 * `progress` is 0..1 across FOUR EQUAL QUARTERS, one per wave, so a wave's window is simply
 * `[(wave - 1) / 4, wave / 4]`:
 *
 *      0.00           0.25            0.50            0.75            1.00
 *       │  ── wave 1 ──│── wave 2 ────│── wave 3 ─────│── wave 4 ─────│
 *       │              │              │               │               │
 *   fill start      stop 01        stop 02         stop 03         stop 04
 *   (hero square)    Web           Mobile         Enterprise      AI + IGNITION
 *
 * Note the first quarter is the hero→services REVEAL, not a stop-to-stop glide: wave 1 (the spine and
 * body plates) lays itself down as the square fills, so the deck's entrance simply *is* the frame being
 * laid. That is why the deck no longer needs an entrance to replay.
 *
 * The pin owns the mapping because the pin owns the layout — the quarters are derived from
 * `carouselLayout`'s services span, not hardcoded here or in the deck.
 */
export const SERVICES_ASSEMBLY_EVENT = 'voidix:services-assembly';

export interface ServicesAssemblyDetail {
  /** 0..1 across the whole build; the boundary values are re-sent when the span is exited. */
  progress: number;
}

/** Safely pull the progress out of a {@link SERVICES_ASSEMBLY_EVENT} listener's event. */
export function readServicesAssembly(event: Event): number {
  const detail = (event as CustomEvent<ServicesAssemblyDetail>).detail;
  return typeof detail?.progress === 'number' ? detail.progress : 0;
}
