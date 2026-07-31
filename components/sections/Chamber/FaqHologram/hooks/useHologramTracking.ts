import { useEffect, type RefObject } from 'react';
import {
  getHologramPose,
  toDesignPx,
  HOLOGRAM_DESIGN_WIDTH,
} from '@/lib/hologramPose';
import { getChamberTuning, type ChamberTuning } from '@/lib/chamberTuning';

/**
 * Keep the panel welded to its anchor in the room.
 *
 * The chamber scene projects the anchor through its camera every frame and publishes the result (see
 * lib/hologramPose.ts). This reads that and writes ONE property — the panel's `transform`. It owns that
 * property outright: the unseal animates heights and opacities on the elements *inside* the panel, and
 * never touches the transform, because two owners of one property is how you get a panel that fights
 * itself. (The sun has the same rule, for the same reason — see useHeroAnimation.)
 *
 * Everything else it writes is a CSS variable, and those only change when the tuning does — so the
 * per-frame cost is a single transform write.
 */

/** Never wider than this much of the screen. On a phone the projected size alone is unreadable. */
const VIEWPORT_WIDTH_FRACTION = 0.92;

/** `#ff8a1a` → `255, 138, 26`, so the CSS can build any alpha it likes off one variable. */
function toRgbTriplet(hex: string): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(value)) return '255, 138, 26';
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

function applyTuningVariables(panel: HTMLElement, tuning: ChamberTuning): void {
  const style = panel.style;
  style.setProperty('--holo-ink-rgb', toRgbTriplet(tuning.holoInk));
  style.setProperty('--holo-tint-rgb', toRgbTriplet(tuning.holoTint));
  style.setProperty('--holo-frame-color', tuning.holoFrameColor);
  style.setProperty('--holo-opacity', String(tuning.holoOpacity));
  style.setProperty('--holo-glow', String(tuning.holoGlow));
  style.setProperty('--holo-scan', String(tuning.holoScanlines));
  style.setProperty('--holo-fringe', String(tuning.holoFringe));
  // The frames are sized in world units like everything else, then expressed in the panel's own stable
  // design pixels — so they stay the same fraction of it at any distance.
  style.setProperty(
    '--holo-frame-height',
    `${toDesignPx(tuning.holoFrameHeight, tuning.holoWidth)}px`,
  );
  style.setProperty(
    '--holo-frame-inset',
    `${toDesignPx(tuning.holoFrameInset, tuning.holoWidth)}px`,
  );
}

export function useHologramTracking(
  panelRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    applyTuningVariables(panel, getChamberTuning());

    let frameId = 0;
    // Only touch the DOM when the answer actually changes — this runs every frame.
    let wasVisible: boolean | null = null;

    const trackFrame = () => {
      frameId = requestAnimationFrame(trackFrame);

      const pose = getHologramPose();
      if (pose.visible !== wasVisible) {
        wasVisible = pose.visible;
        panel.dataset.visible = String(pose.visible);
      }
      if (!pose.visible) return;

      const tuning = getChamberTuning();
      // The projected size is the honest one, but it isn't always a readable one — hence the clamps.
      // The viewport ceiling is the one that matters on a phone, where the panel would otherwise run
      // off both edges of the screen.
      const maxWidth = Math.min(
        tuning.holoMaxWidthPx,
        window.innerWidth * VIEWPORT_WIDTH_FRACTION,
      );
      const width = Math.min(
        Math.max(tuning.holoWidth * pose.pixelsPerUnit, tuning.holoMinWidthPx),
        maxWidth,
      );
      const scale = width / HOLOGRAM_DESIGN_WIDTH;

      // Read right-to-left: centre the panel on its own origin, scale it about that point, then put it
      // where the room says. The centring comes FIRST so the scale can't drag it off the anchor, and the
      // −50% of the height is re-read as the panel grows — which is what makes it open symmetrically
      // about the anchor rather than dropping downward out of it.
      panel.style.transform = `translate(${pose.x}px, ${pose.y}px) scale(${scale}) translate(-50%, -50%)`;
    };
    trackFrame();

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [panelRef]);
}
