/**
 * The chamber reveal's numbers, live-editable from an on-screen panel.
 *
 * Every value in the reveal — where the display hangs, where you end up standing, how the set is
 * arranged — had to be authored without being able to see the scene. They are all guesses until someone
 * looks. So they live here rather than as frozen constants: the scene reads this store every frame, and
 * `ChamberTuner` writes to it.
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
  /** Where to hold it (0 = the space full-screen, 1 = standing in the set). */
  revealAt: number;

  // ── The rig: the display, and the camera looking at it ──
  // The camera is DERIVED from the rig — it sits out along the display's facing direction and looks back
  // at it — so these move the whole shot as one, and the framing maths can never drift out of step.
  rigX: number;
  rigY: number;
  rigZ: number;
  /**
   * DEGREES, like every other rotation here. Which way the display faces; the camera is always on its
   * front, so turning it turns the whole shot.
   */
  rigYaw: number;
  /** DEGREES. Tilt the display up / down. */
  rigPitch: number;
  /**
   * DEGREES. Cant the display over sideways.
   *
   * Roll is the one rotation that interacts with the seam, so it's worth knowing what it does. At
   * progress 0 the display must fill the frustum EXACTLY — a canted display viewed by an upright camera
   * doesn't (its corners cut in, and the picture arrives rotated). So the camera is rolled to match it,
   * and then eased back upright as it pulls away.
   *
   * Which is better than merely "allowed": you start square-on to the screen and cannot tell it's
   * canted, and as you back off the room straightens while the screen rolls into its real mounting. The
   * tilt becomes part of the reveal.
   */
  rigRoll: number;

  /** World height of the display. Its WIDTH follows the viewport's aspect — that's what makes the seam exact. */
  displayHeight: number;

  // ── Trimming the picture's edges ──
  // Each is a 0..1 inset into the space render. The quad shrinks with them, so the picture is CROPPED
  // rather than squashed.
  //
  // These are RAMPED IN with the pull-back rather than applied flat, and that is not a detail: at
  // progress 0 the display must show the space render 1:1 or the seam dies — crop it there and the
  // reveal opens on a zoomed picture, i.e. a visible jump. So the trim is zero at the start and full by
  // the time you are standing in the room. (You tune at progress 1, so you see the full crop while you
  // work.)
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;

  /**
   * Meshes switched off, by id (see `getChamberParts`). Lets a prop's unwanted pieces — a stray screen,
   * a ground plane that fights the room — be removed without touching the model.
   */
  hiddenParts: string[];

  /** Tuning only: which object a mouse drag rotates. Follows the panel's open tab. */
  dragTarget: 'podium' | 'table' | 'none';
  // ── Where the camera ends up: a place in the room, and nothing to do with the display ──
  //
  // An ABSOLUTE world position, deliberately not "back off along the display's normal". Tie the resting
  // camera to the normal and rotating the display drags the entire shot around with it, which makes the
  // display impossible to aim. Here, turning the display just… turns the display. The camera stays where
  // you put it and watches it turn.
  //
  // The camera still has to START on the display's normal — that is the one place the display fills the
  // frustum and the picture reads 1:1, which is the whole seam — so rotating the display does still move
  // the FIRST frame of the reveal. It just no longer moves the shot you're looking at.
  //
  // The path lerps from that normal to here, so at progress 0 this has no effect at all.
  camX: number;
  camY: number;
  camZ: number;
  /** How much it creeps off the display before committing to the pull-back. */
  easePower: number;

  // ── The set ──
  // Each prop is placed independently: shown/hidden, scaled, moved, turned. Rotations in DEGREES.
  //
  // Scale is PER AXIS, not uniform. That's the honest way to make a prop's screen match the render's
  // shape: stretch the prop, rather than distorting the picture to fit it.
  showPodium: boolean;
  podiumScaleX: number;
  podiumScaleY: number;
  podiumScaleZ: number;
  podiumX: number;
  podiumY: number;
  podiumZ: number;
  podiumRotX: number;
  podiumRotY: number;
  podiumRotZ: number;

  showTable: boolean;
  tableScaleX: number;
  tableScaleY: number;
  tableScaleZ: number;
  tableX: number;
  tableY: number;
  tableZ: number;
  tableRotX: number;
  tableRotY: number;
  tableRotZ: number;

  // ── Light ──
  /** The display is the set's main light source. */
  screenLight: number;
  ambient: number;
  keyLight: number;
  /**
   * How hard the shared environment map hits the set's METAL. The scene borrows the works field's PMREM,
   * which is a bright studio box — at any real strength it turns a dim room into a chrome showroom.
   */
  envIntensity: number;
}

export const CHAMBER_TUNING_DEFAULTS: ChamberTuning = {
  holdReveal: false,
  revealAt: 1,

  // The display laid FLAT into the table's surface (pitch 90), canted slightly. So the reveal opens
  // looking straight down at the table's screen — which is the only place the picture reads 1:1 — and
  // then flies out to `cam*` below.
  rigX: -4.87,
  rigY: 0.85,
  rigZ: 8.15,
  rigYaw: 180,
  rigPitch: 90,
  rigRoll: -10,

  displayHeight: 0.95,
  // Zero, and worth keeping that way. The render and the table's screen are different shapes, and the
  // fix for that is stretching the TABLE (its scale is per-axis) — not cropping the picture. Cropping
  // only ever moved the problem: negative insets sample past the render's edge and smear its border
  // pixels, and any crop at all has to be ramped in, because at progress 0 the display must show the
  // render 1:1 or the seam dies.
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  hiddenParts: [],
  dragTarget: 'none',
  // Standing at the table, just above the screen, looking down at it — with the podium beyond.
  camX: -4.6,
  camY: 2.1,
  camZ: 6.7,
  easePower: 2.4,

  // The podium's raw model is ~41 units across (it carries its own ground plane and a pyramid backdrop),
  // so it wants scaling down; the table is ~3 units and roughly life-sized already. Both need placing by
  // eye — that's what the panel is for.
  showPodium: true,
  podiumScaleX: 2,
  podiumScaleY: 2,
  podiumScaleZ: 2,
  podiumX: -4.4,
  podiumY: 0.05,
  podiumZ: -5.9,
  podiumRotX: 0,
  podiumRotY: 0,
  podiumRotZ: 0,

  showTable: true,
  // Deliberately NOT uniform: the table is stretched so its screen matches the render's shape. This is
  // what replaced cropping the picture — see the crop note above.
  tableScaleX: 0.9,
  tableScaleY: 0.85,
  tableScaleZ: 0.77,
  tableX: -4,
  tableY: 0.05,
  tableZ: 8.45,
  tableRotX: 0,
  tableRotY: -190,
  tableRotZ: 0,

  screenLight: 20.5,
  ambient: 0.48,
  keyLight: 0.8,
  envIntensity: 0.27,
};

const STORAGE_KEY = 'orbix:chamber-tuning';

const tuning: ChamberTuning = { ...CHAMBER_TUNING_DEFAULTS };
const listeners = new Set<() => void>();
let restored = false;

/**
 * The pieces a loaded prop is made of, so they can be switched off one at a time.
 *
 * The scene has to publish these rather than the panel knowing them up front: the panel is on screen
 * from page load, but the models aren't fetched until the visitor reaches Works. The ids are positional
 * because the meshes' own names are useless (the podium's are all literally "defaultMaterial") — the
 * MATERIAL names are the meaningful part, so they carry the label.
 */
export interface ChamberPart {
  id: string;
  label: string;
}

const chamberParts: Record<string, ChamberPart[]> = {};

export function reportChamberParts(model: string, parts: ChamberPart[]): void {
  chamberParts[model] = parts;
  listeners.forEach((listener) => listener());
}

export function getChamberParts(model: string): ChamberPart[] {
  return chamberParts[model] ?? [];
}

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
    if (!saved) return;
    // Only keys the tuning still HAS — so a stored session from an older shape of the set (when it was a
    // cloning-tank room with a bezel) can't resurrect fields that no longer mean anything.
    const parsed = JSON.parse(saved) as Partial<ChamberTuning>;
    for (const key of Object.keys(CHAMBER_TUNING_DEFAULTS) as (keyof ChamberTuning)[]) {
      if (key in parsed) Object.assign(tuning, { [key]: parsed[key] });
    }
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
