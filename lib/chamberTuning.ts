/**
 * The chamber reveal's numbers, live-editable from an on-screen panel.
 *
 * Every value in the reveal — where the display hangs, where you end up standing, how big the room is,
 * how the bezel fits — had to be authored without being able to see the scene. They are all guesses
 * until someone looks. So they live here rather than as frozen constants: the scene reads this store
 * every frame, and `ChamberTuner` writes to it.
 *
 * A store (rather than a panel that owns the state) because the two have different lifetimes: the
 * chamber scene isn't built until the visitor reaches Works, but the panel has to be on screen from the
 * moment the page loads.
 *
 * In production this is inert — `isChamberTuningEnabled` is false, nothing is restored from storage,
 * no panel renders, and the values below are simply the constants the reveal ships with.
 */

export interface ChamberTuning {
  /**
   * Pin the reveal at `revealAt` and ignore the scroll.
   *
   * The reveal is a committed glide between two scroll stops, so scrolling can only ever leave you at
   * progress 0 or 1 — there is no way to stop halfway and look at it. This is the only way to hold it
   * still while you tune it.
   */
  holdReveal: boolean;
  /** Where to hold it (0 = the space full-screen, 1 = standing in the room). */
  revealAt: number;

  /** The room can be hidden to judge the display + bezel against plain black. */
  showRoom: boolean;

  // The rig: where the display hangs and which way it faces. The camera is DERIVED from it — it sits
  // out along the display's facing direction and looks back — so these move the whole shot as one.
  // This is what walks the camera out of the cloning tank and onto clear floor.
  rigX: number;
  rigY: number;
  rigZ: number;
  /** Radians. Which way the display faces; the camera is always on its front. */
  rigYaw: number;

  /** World height of the display. Its WIDTH follows the viewport's aspect — that's what makes the seam exact. */
  displayHeight: number;
  /** How far the camera ends up from the display, i.e. how much of the room you see. */
  restDistance: number;
  /** How far it lifts on the way back, bringing the floor into view. */
  restRise: number;
  /** How much it creeps off the display before committing to the pull-back. */
  easePower: number;

  /** How far the frame's face oversteps the display. Too small and it CROPS the picture. */
  bezelOversize: number;
  /** How the frame sits against the display, along its facing direction. */
  bezelZ: number;

  // The frame model is exported lying FLAT — its face spans x/z with y as thickness — so it has to be
  // stood up before it can frame anything. Which way "up" is depends on how the artist exported it, and
  // guessing wrong leaves you looking at the frame edge-on. So the orientation is a control, in DEGREES.
  // Once it's right, these get baked into the defaults and never touched again.
  bezelRotX: number;
  bezelRotY: number;
  bezelRotZ: number;

  /** World units per raw model unit. */
  roomScale: number;

  /** The display is the room's main light source. */
  screenLight: number;
  ambient: number;
}

export const CHAMBER_TUNING_DEFAULTS: ChamberTuning = {
  holdReveal: false,
  revealAt: 1,
  showRoom: true,

  // The tank and its tubes stand across the MIDDLE of the room (measured from the model: raw
  // x −626…234, z 530…750), so a camera backing away through the centre reverses straight into them.
  // The right-hand side is clear floor at every depth — so the rig stands there, and the cloning tanks
  // end up off to the left of frame, which is the better shot anyway.
  rigX: 2.9,
  rigY: 1.5,
  rigZ: -3.2,
  rigYaw: 0,

  displayHeight: 1.6,
  restDistance: 4.2,
  restRise: 0.35,
  easePower: 2.2,

  bezelOversize: 1.35,
  bezelZ: -0.04,
  bezelRotX: -90,
  bezelRotY: 0,
  bezelRotZ: 0,

  roomScale: 0.0073,

  screenLight: 9,
  ambient: 0.14,
};

const STORAGE_KEY = 'orbix:chamber-tuning';

const tuning: ChamberTuning = { ...CHAMBER_TUNING_DEFAULTS };
const listeners = new Set<() => void>();
let restored = false;

/** On localhost, or anywhere with `?tune`. Never in the deployed site. */
export function isChamberTuningEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname, search } = window.location;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    new URLSearchParams(search).has('tune')
  );
}

/** Values survive a reload — and a Fast Refresh — so saving a file doesn't throw the session away. */
function restoreOnce(): void {
  if (restored || !isChamberTuningEnabled()) return;
  restored = true;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) Object.assign(tuning, JSON.parse(saved) as Partial<ChamberTuning>);
  } catch {
    // A corrupt entry just means we start from the defaults.
  }
}

function persist(): void {
  if (!isChamberTuningEnabled()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch {
    // Private mode / quota — tuning still works, it just won't persist.
  }
}

/** The live values. Read every frame by the scene; never mutate the result. */
export function getChamberTuning(): Readonly<ChamberTuning> {
  restoreOnce();
  return tuning;
}

export function setChamberTuning(patch: Partial<ChamberTuning>): void {
  Object.assign(tuning, patch);
  persist();
  listeners.forEach((listener) => listener());
}

export function resetChamberTuning(): void {
  Object.assign(tuning, CHAMBER_TUNING_DEFAULTS);
  persist();
  listeners.forEach((listener) => listener());
}

export function subscribeChamberTuning(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
