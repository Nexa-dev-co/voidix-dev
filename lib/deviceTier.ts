/**
 * How much this machine can be asked to draw — decided ONCE, at first ask, and never revisited.
 *
 * ── Why a tier and not another boolean ───────────────────────────────────────────────────────────
 * The site already had one of these: `lowPower`, computed inline in both heavy scene hooks as
 * `(pointer: coarse) || innerWidth < 760`. Two problems with it, and the second is why this file
 * exists rather than a third copy of that expression.
 *
 * It has two outcomes. A 2019 ultrabook with integrated graphics and a current desktop with a
 * discrete GPU both come out "not low power" and are handed exactly the same configuration — which is
 * sized for whichever of them we were last worried about. And a phone and a five-year-old tablet both
 * come out "low power" and are handed the same one, sized for the phone.
 *
 * And it is a VIEWPORT test wearing a capability test's name. Width and pointer type correlate with
 * GPU strength; they are not it. Narrowing a desktop window does not make its GPU slower.
 *
 * ── Why it is latched ────────────────────────────────────────────────────────────────────────────
 * Everything downstream of this allocates: render targets, composers, and (Phase 2) which model files
 * get downloaded. Re-deciding mid-session means reallocating them, which is a visible stall — the same
 * reason `adaptivePixelRatio` is frozen during crossings. `useIsLowPowerViewport` still reacts to
 * resize, and still should: unmounting the hero's optional effects when a window narrows is cheap and
 * reversible. This is the other thing, and it holds still.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────────────────────────
 * It does not measure. `lib/gpuProbe.ts` measures, and it cannot help here: it runs during the works
 * field's warm-up, which is after every composer on the site has already been allocated. This answers
 * the question that has to be answered BEFORE anything is built. The two are complementary and
 * `docs/adaptive-asset-tier-plan.md` §4 has the timeline.
 */

import { telemetryEnabled } from '@/lib/telemetryEnabled';

/** Coarsest to finest. Every consumer switches on this and nothing else. */
export type DeviceTier = 'potato' | 'low' | 'mid' | 'high';

/**
 * Matches `LOW_POWER_MAX_WIDTH` in `useIsLowPowerViewport`, and means the same thing there: below this
 * we are almost certainly on a phone rather than on a small window.
 */
const PHONE_MAX_WIDTH = 760;

/**
 * `navigator.deviceMemory`, in GB, is the single best proxy available for "will this hold a few
 * hundred megabytes of render target". It is Chromium-only and coarsely bucketed (0.25/0.5/1/2/4/8),
 * and 8 is the maximum it will ever report — a 64 GB workstation also says 8.
 */
const MEMORY_GB_MID = 4;
const MEMORY_GB_LOW = 2;

const CORES_MID = 4;

// ── What promotes a phone out of `low` ──
//
// ⚠ These three are the least evidenced numbers in this file. They are a guess at where "a phone that
// can hold the full material path" begins, and they are unverified against real handsets. They err
// low on purpose: a good phone rendered at `low` looks slightly plainer, while a weak phone rendered
// at `mid` drops frames through the whole works section, and those two mistakes do not cost the same.
const PHONE_PROMOTION_MEMORY_GB = 6;
const PHONE_PROMOTION_CORES = 6;
/** Apple's high-end panels are dpr 3; the SE line and older devices are 2. A proxy, not a capability. */
const PHONE_PROMOTION_PIXEL_RATIO = 3;

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

let decidedTier: DeviceTier | null = null;

function classify(): DeviceTier {
  // No window means the server, and the server renders none of this. Answer conservatively so that a
  // value read during SSR can never be the one that sizes a buffer.
  if (typeof window === 'undefined') return 'mid';

  const navigatorWithHints = navigator as NavigatorWithHints;
  const deviceMemoryGb = navigatorWithHints.deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 0;
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const isNarrow = window.innerWidth < PHONE_MAX_WIDTH;

  // ── The visitor has asked for less. That is not a hint, it is an instruction. ──
  // `prefetchWhenAssetsReady` already honours this for speculative downloads; honouring it here too
  // means one answer to "does this person want us spending their resources" instead of two.
  if (navigatorWithHints.connection?.saveData) return 'potato';

  // ── Phones and tablets ──
  //
  // A coarse pointer is the strongest single signal here: it separates "a GPU sharing a phone's
  // thermal budget" from "a GPU with a fan". What it does NOT do is say how good the phone is, and the
  // spread inside this branch is wider than the spread across every laptop on the site — a current
  // flagship will out-render a 2018 ultrabook, and a budget handset will not survive the works field.
  //
  // ⚠ So a phone can reach `mid`. Capping the whole branch at `low` was the same two-outcome mistake
  // this file exists to undo, one level up: `isLowPowerDevice()` is true for `low`, and that costs
  // 90 shards instead of 260, icosphere detail 1, no clearcoat or iridescence on the hulls, weaker
  // bloom and no accretion spiral. That is the right call for a cheap handset and an insult to a good
  // one.
  //
  // ⚠ It cannot reach `high`, and that is not timidity. A phone's peak is not its sustained rate: it
  // throttles hard within a minute, and this site is a long scroll. It also runs at dpr 2–3, so
  // "native" is already 4–9× the pixels of a 1× panel before anything else is asked of it.
  if (isCoarsePointer || isNarrow) {
    if (deviceMemoryGb !== undefined) {
      if (deviceMemoryGb <= MEMORY_GB_LOW) return 'potato';
      // Android, where the hint exists and is worth something.
      return deviceMemoryGb >= PHONE_PROMOTION_MEMORY_GB && cores >= PHONE_PROMOTION_CORES
        ? 'mid'
        : 'low';
    }
    // ⚠ iOS Safari, which reports NO `deviceMemory` at all — and iPhones are most of the "good phones"
    // this branch is about. All that is left is core count and pixel density, and density is the
    // better of the two: Apple's high-end panels are dpr 3 while the SE line and older devices are 2.
    // It is a proxy for "recent flagship", not a capability, and it is the weakest inference in this
    // file. It errs low, and the probe is what should eventually settle it — see the note in
    // `docs/adaptive-asset-tier-plan.md` §7 on measuring the loader's own dust field, which runs
    // before any of this is allocated.
    return window.devicePixelRatio >= PHONE_PROMOTION_PIXEL_RATIO && cores >= PHONE_PROMOTION_CORES
      ? 'mid'
      : 'low';
  }

  // ── Everything with a mouse ──
  // ⚠ `mid` is the default and the honest answer for most visitors, including every Safari and Firefox
  // user — `deviceMemory` is Chromium-only, so on those browsers only `cores` is available and it is a
  // weak signal on its own. Erring to `mid` matters, and guessing upward is the exact mistake
  // `adaptivePixelRatio` was rewritten to stop making. See the block below on why nothing reaches
  // `high` from here at all.
  if (deviceMemoryGb === undefined) {
    return cores >= CORES_MID ? 'mid' : 'low';
  }
  // ── ⚠ `high` IS NOT REACHABLE FROM HINTS, AND THAT IS THE POINT ────────────────────────────────
  //
  // It used to be `deviceMemoryGb >= 8 && cores >= 8`, which reads like a demanding test and is not
  // one. BOTH signals saturate at exactly that threshold:
  //
  //   · `deviceMemory` is capped at 8 BY SPEC — a 64 GB workstation reports 8, same as an ultrabook.
  //     ">= 8" is therefore a check for "not ancient", not a check for "powerful".
  //   · `hardwareConcurrency` counts THREADS, so an ordinary 4-core/8-thread laptop reports 8.
  //
  // The conjunction is satisfied by the single most common laptop configuration in existence. It was
  // found by a visitor being told their mid laptop was `high` while it ran the works section at 27 fps
  // — they were right to disbelieve it, and the classifier had no way to be right.
  //
  // The deeper problem is that neither signal describes a GPU, which is the only thing this tier is
  // ever consulted about. That is the same error one level up that this file was written to undo:
  // *"Width and pointer type correlate with GPU strength; they are not it."* Replacing 8 with 12 or 16
  // would not fix it, it would just make a CPU test wrong less often.
  //
  // So nothing is guessed into the top tier any more. `high` stays in the union because it is what a
  // machine may be PROMOTED to on evidence — `gpuProbe` plus `hasEarnedExtraQuality()` in
  // `adaptivePixelRatio`, which already require a real measurement and four seconds of sustained
  // 50 fps at full resolution before anything optional is switched on.
  //
  // ⚠ This changes no allocation today: `BLOOM_MSAA_SAMPLES_BY_TIER` gives `low`, `mid` and `high` the
  // same 2 samples, and 4× has been earned rather than granted since it moved to the probe. The value
  // of the fix is that the console stops lying and the trap stops being loaded — the next `high`-only
  // branch anyone writes would have landed on every 8 GB laptop on the internet.
  if (deviceMemoryGb >= MEMORY_GB_MID && cores >= CORES_MID) return 'mid';
  return 'low';
}

/**
 * Say what was decided and what it was decided from — once per page, wherever telemetry is on.
 *
 * ⚠ This is the quietest decision on the site and it gates every allocation downstream of it: MSAA
 * floors, bloom strength, shard counts, icosphere detail, whether the accretion spiral exists.
 * Everything else here announces itself (`[cache]`, `[pixels]`, `[voidix] gpu probe`) and this did not,
 * which meant the only way to find out what tier you were on was to add a log first.
 *
 * The signals are printed with it, because the answer is almost never surprising once you can see the
 * inputs. **`pointer: coarse` and a narrow width are exactly what DevTools' responsive mode reports**,
 * so a desktop testing a phone layout is correctly classified as a phone — which looks like a bug in
 * the console and is not one. Printing `coarse` and `width` beside the tier makes that self-evident
 * instead of a ten-minute detour.
 */
function reportDecision(tier: DeviceTier): void {
  if (!telemetryEnabled || typeof window === 'undefined') return;
  const navigatorWithHints = navigator as NavigatorWithHints;
  console.log(
    `[voidix] device tier: ${tier}` +
      `\n  pointer ${window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'}` +
      `, width ${window.innerWidth}, dpr ${window.devicePixelRatio}` +
      `\n  deviceMemory ${navigatorWithHints.deviceMemory ?? 'unreported'} GB` +
      `, cores ${navigator.hardwareConcurrency ?? 'unreported'}` +
      `, saveData ${navigatorWithHints.connection?.saveData ? 'ON' : 'off'}`,
  );
}

/** This machine's tier. Decided on the first call and identical on every call after it. */
export function getDeviceTier(): DeviceTier {
  if (decidedTier === null) {
    decidedTier = classify();
    reportDecision(decidedTier);
  }
  return decidedTier;
}

/**
 * The old `lowPower` flag, expressed in terms of the tier so there is one authority rather than two.
 *
 * Kept as its own function because the scenes branch on it in a dozen places for things that have
 * nothing to do with antialiasing — shard counts, icosphere detail, bloom strength, whether the
 * accretion spiral exists at all — and `tier === 'potato' || tier === 'low'` at each of them would be
 * the same expression copied a dozen times, which is what this file is here to stop.
 */
export function isLowPowerDevice(): boolean {
  const tier = getDeviceTier();
  return tier === 'potato' || tier === 'low';
}
