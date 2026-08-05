import { useEffect, useState } from 'react';

/**
 * True when this device shouldn't be asked to run the hero's optional WebGL effects.
 *
 * The rule is the same one the 3D scenes already apply inline (`lowPower` in useServicesDeck /
 * useWorksField), lifted here so the whole site draws that line in one place: a coarse pointer, or a
 * viewport too narrow to be a laptop.
 *
 * This exists to stop work happening, not to hide pixels. CSS can hide a canvas; only unmounting it
 * stops its render loop — which is the entire point on a phone.
 */

// Matches PHONE_MAX_WIDTH in `lib/deviceTier.ts`. Still two copies, and still deliberately: that one is
// LATCHED — it decides what gets allocated, so it must not change when a window is dragged — while this
// one has to react to resize, because unmounting an effect is cheap and reversible in a way that
// reallocating a composer is not. Same number, two different questions. The scene hooks no longer have
// their own copy; they read the tier.
const LOW_POWER_MAX_WIDTH = 760;

const isLowPowerNow = () =>
  window.matchMedia('(pointer: coarse)').matches ||
  window.innerWidth < LOW_POWER_MAX_WIDTH;

export function useIsLowPowerViewport(): boolean {
  // Starts false so the server and the first client render agree — `window` doesn't exist during SSR,
  // and reading it during render would hydration-mismatch. The effect corrects it before paint.
  //
  // Erring toward "not low power" is the safe direction: mounting a canvas late is clean, and the
  // alternative (assume phone, then mount on correction) would flash the effects in on every desktop
  // load.
  const [isLowPower, setIsLowPower] = useState(false);

  useEffect(() => {
    const sync = () => setIsLowPower(isLowPowerNow());
    sync();

    // Both halves of the rule can change after load: a window drags narrower, and a hybrid device
    // switches between touch and trackpad.
    const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
    coarsePointerQuery.addEventListener('change', sync);
    window.addEventListener('resize', sync);

    return () => {
      coarsePointerQuery.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return isLowPower;
}
