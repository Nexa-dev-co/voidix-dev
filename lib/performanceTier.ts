import { getPerformanceSnapshot } from '@/lib/adaptivePixelRatio';

/**
 * How much this machine can actually afford — answered from frames it has already rendered.
 *
 * The chamber's textures are the one asset on the site big enough to need this: all 36 of its maps are
 * 1024², which is ~192 MB of GPU memory left resident, and a resize is the ONLY thing that can claw
 * that back (the adaptive-resolution controller scales the framebuffer, not textures). So it ships at
 * two tiers and we pick one.
 *
 * The usual way to pick would be a device sniff — `deviceMemory`, a coarse-pointer check, a user-agent
 * guess. We're in a much better position than that: nothing asks for a tier until the visitor reaches
 * Works, by which point the fleet and the meteor field have been rendering for a minute and
 * `adaptivePixelRatio` has a real, smoothed frame-time history for this exact GPU. So we answer from
 * what the machine *did*, not from what it claims to be.
 *
 * Biased toward the cheap tier: it must be affirmatively earned, and anything unknown resolves to low.
 */

export type PerformanceTier = 'low' | 'high';

// Don't answer off a handful of frames. Callers ask late, so this is a safety net rather than the
// normal path — but a tier chosen from two seconds of warm-up frames would be worthless.
const MIN_SAMPLED_SECONDS = 5;
// Sustained frame rate the GPU must be holding to earn the expensive textures. Deliberately near the
// refresh-rate ceiling: "coping" is not the same as "has room to spare".
const HIGH_TIER_FPS = 55;

export function getPerformanceTier(): PerformanceTier {
  const { sampledSeconds, framesPerSecond, hasHitLimit, isAtFloor } =
    getPerformanceSnapshot();

  // Nothing measured yet → assume the worst rather than gamble 192 MB on it.
  if (sampledSeconds < MIN_SAMPLED_SECONDS) return 'low';
  // The controller already found a resolution this GPU couldn't hold. It has nothing spare.
  if (hasHitLimit) return 'low';
  // Still scraping the lowest density after all that time → it never found any headroom at all.
  if (isAtFloor) return 'low';

  return framesPerSecond >= HIGH_TIER_FPS ? 'high' : 'low';
}
