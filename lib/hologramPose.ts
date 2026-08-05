/**
 * Where the hologram is on screen, this frame.
 *
 * The FAQ hologram is DOM, not WebGL — it has to be, because everything it does (content-determined
 * height, a scroll area, clickable rows, selectable text) is a text-layout problem, and WebGL would
 * mean re-implementing layout, hit-testing and scrolling by hand. But it still has to look welded into
 * a 3D room, so it is anchored to a point in that room: the chamber scene projects that point through
 * its camera every frame and publishes the result here, and the overlay reads it and writes a
 * transform.
 *
 * A store rather than an event or a prop, for the same reason `chamberTuning` is one: the two ends have
 * different lifetimes and neither can hold a reference to the other. The chamber scene isn't built until
 * the visitor reaches Works; the overlay is in the DOM from the moment the page loads. And this is
 * written EVERY FRAME — a React state update or a CustomEvent per frame would be a re-render per frame.
 * The overlay reads it in its own rAF and writes `style.transform` directly.
 *
 * The pose object is stable and mutated in place. Read it, never mutate it.
 */

export interface HologramPose {
  /** The room is on screen and the anchor is in front of the camera. False = draw nothing. */
  visible: boolean;
  /** The anchor's position in CSS pixels from the top-left of the viewport — the panel's CENTRE. */
  x: number;
  y: number;
  /**
   * How many CSS pixels one world unit spans at the anchor's depth.
   *
   * This is what makes the panel a thing in the room rather than a sticker on the glass: its width, its
   * max height and its frames are all authored in WORLD units and multiplied through this, so it grows
   * as the camera approaches exactly as a real object would.
   */
  pixelsPerUnit: number;
}

/**
 * The width the panel is LAID OUT at, in CSS pixels. A transform then scales it into the room.
 *
 * This indirection is what keeps the whole thing sane. If the panel were laid out at its real on-screen
 * size, every measurement it makes — the content's height, where the frames sit — would change on every
 * frame the camera moved, and the height tween would be chasing a target that never held still. Laid out
 * at a fixed design width and scaled, the measurements are STABLE: the camera changes one number (the
 * scale), and nothing inside the panel notices.
 */
export const HOLOGRAM_DESIGN_WIDTH = 640;

/**
 * ── The phone's design width, and why a SECOND one is the fix ────────────────────────────────────
 * The panel's on-screen size is `scale = onScreenWidth / designWidth`, and on a phone the on-screen
 * width is pinned to the viewport (~359px on a 390px screen). Against a 640px design that is a scale
 * of 0.56 — so every size authored inside the panel renders at 56%, and 15px type arrives as 8px.
 * Nothing inside the panel can fix that, because everything inside the panel is multiplied by it.
 *
 * Laying the phone's panel out at a narrower design width is the one lever that does: the same 359px
 * of screen against a 460px design is a scale of 0.78, which is ~39% more type for no more pixels.
 * The content simply reflows to a narrower measure first — which is what you would have done by hand.
 */
export const HOLOGRAM_DESIGN_WIDTH_NARROW = 460;

/** Viewport width at or below which the narrow design applies. */
const NARROW_VIEWPORT_MAX_PX = 540;

/**
 * How much taller the narrow panel may grow before its content starts scrolling instead.
 *
 * ⚠ It needs its own number: the max height is authored in WORLD units, and the design width cancels
 * clean out of the conversion (`(h / holoWidth) × designWidth × onScreenWidth / designWidth`). So
 * narrowing the design makes the type bigger and leaves the panel exactly as short as it was — which,
 * with the content now reflowing to a narrower measure, is strictly worse. This is the other half.
 */
const NARROW_HEIGHT_GAIN = 1.5;

const isNarrowViewport = () =>
  typeof window !== 'undefined' && window.innerWidth <= NARROW_VIEWPORT_MAX_PX;

/** The design width in force for the current viewport. */
export function hologramDesignWidth(): number {
  return isNarrowViewport() ? HOLOGRAM_DESIGN_WIDTH_NARROW : HOLOGRAM_DESIGN_WIDTH;
}

/** Multiplier on the tuning's `holoMaxHeight` for the current viewport. See NARROW_HEIGHT_GAIN. */
export function hologramMaxHeightGain(): number {
  return isNarrowViewport() ? NARROW_HEIGHT_GAIN : 1;
}

/**
 * Convert one of the tuning's world-unit sizes into the panel's design pixels.
 *
 * Everything about the panel is authored in world units so it belongs to the room. Inside the panel,
 * what matters is the PROPORTION — a frame that is a twentieth of the panel's width stays a twentieth of
 * it whether the panel is 300px or 700px on screen. So the ratio is taken against `holoWidth`, and the
 * pixel clamps (which only change the panel's on-screen size, never its proportions) don't enter into it.
 *
 * ⚠ Reads the live design width, so this is viewport-dependent and must only be called on the client.
 * Every caller is inside a `useEffect`, which is the only place it makes sense anyway.
 */
export function toDesignPx(worldValue: number, holoWidth: number): number {
  return (worldValue / Math.max(holoWidth, 0.001)) * hologramDesignWidth();
}

const pose: HologramPose = {
  visible: false,
  x: 0,
  y: 0,
  pixelsPerUnit: 0,
};

/** The live pose. Read every frame by the overlay; never mutate the result. */
export function getHologramPose(): Readonly<HologramPose> {
  return pose;
}

export function publishHologramPose(next: Omit<HologramPose, 'visible'>): void {
  pose.visible = true;
  pose.x = next.x;
  pose.y = next.y;
  pose.pixelsPerUnit = next.pixelsPerUnit;
}

/**
 * The room isn't on screen, so neither is the hologram.
 *
 * This has to be said out loud rather than inferred from a stale pose: the chamber's `update` only runs
 * while the reveal is engaged, so once it stops running the last pose would sit here looking perfectly
 * valid, and the panel would hang over the meteor field.
 */
export function hideHologram(): void {
  pose.visible = false;
}
