/**
 * The chamber reveal's numbers — fixed constants.
 *
 * Every value in the reveal (where the display hangs, where you end up standing, how the set is arranged,
 * the showcase path the camera walks) was authored against an on-screen tuning panel and then baked in
 * here. The panel is gone; these are the shipped numbers. The scene reads this once and the FAQ hologram
 * reads the `holo*` values for its look and size — both via {@link getChamberTuning}.
 *
 * To retune, edit the values below directly (there is no longer a live store or a panel writing to it).
 */

/**
 * One pose on the showcase path: where the camera is, what it's looking at — AND where the screen is.
 *
 * The screen is only pinned while the reveal is running (it has to be: the camera starts on its normal,
 * and that's the seam). Once you're standing in the room it's free, so the showcase moves it too.
 */
export interface ShowcaseKey {
  /** The camera. */
  x: number;
  y: number;
  z: number;
  /** What it's aimed at. */
  tx: number;
  ty: number;
  tz: number;
  /** The screen: where it is, how it's turned (degrees), and how big it is. */
  sx: number;
  sy: number;
  sz: number;
  syaw: number;
  spitch: number;
  sroll: number;
  sh: number;
}

export interface ChamberTuning {
  // ── The rig: the display, and the camera looking at it ──
  // The camera is DERIVED from the rig — it sits out along the display's facing direction and looks back
  // at it — so these move the whole shot as one, and the framing maths can never drift out of step.
  rigX: number;
  rigY: number;
  rigZ: number;
  /** DEGREES. Which way the display faces; the camera is always on its front, so turning it turns the shot. */
  rigYaw: number;
  /** DEGREES. Tilt the display up / down. */
  rigPitch: number;
  /**
   * DEGREES. Cant the display over sideways.
   *
   * Roll is the one rotation that interacts with the seam: at progress 0 the display must fill the frustum
   * EXACTLY — a canted display viewed by an upright camera doesn't (its corners cut in). So the camera is
   * rolled to match it, then eased back upright as it pulls away.
   */
  rigRoll: number;

  /** World height of the display. Its WIDTH follows the viewport's aspect — that's what makes the seam exact. */
  displayHeight: number;

  // ── Trimming the picture's edges ──
  // Each is a 0..1 inset into the space render, ramped in with the pull-back rather than applied flat: at
  // progress 0 the display must show the render 1:1 or the seam dies. Zero here — the render / table shapes
  // are reconciled by stretching the table, not by cropping the picture.
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;

  /**
   * Meshes culled at load, by positional id. Lets a prop's unwanted pieces — a stray screen, a ground plane
   * that fights the room — be removed without touching the model.
   */
  hiddenParts: string[];

  // ── The ring portal ──
  // The rings, the turbine in their mouth, and the cabling that feeds them: ONE machine, rigged as one and
  // placed independently of the podium (it's what the hologram sits inside, and in the model it's half-buried
  // in its own cabling). Offsets/scale are in the MODEL's coordinates, so they ride the podium's transform.
  showRings: boolean;
  ringsX: number;
  ringsY: number;
  ringsZ: number;
  ringsScale: number;
  ringsRotX: number;
  ringsRotY: number;
  ringsRotZ: number;
  /** Degrees per second the RINGS spin, on their own axis, inside the portal. */
  ringsSpin: number;

  // ── Colour ──
  // These MULTIPLY the models' own maps rather than replacing them, so the surface detail survives. The
  // cable runs only — NOT their joiners, the dark connectors that want to stay dark.
  cablesColor: string;
  /** How hard the cables glow, as a multiple of what the model shipped with — the cables are pure emissive. */
  cablesGlow: number;

  /** The joiners — the connectors along the runs. Off by default: they read as hardware, not as light. */
  paintJoiners: boolean;
  joinersColor: string;
  joinersGlow: number;

  tableColor: string;

  // ── The showcase: the camera's move around the room, as one continuous shot ──
  // A ROUND TRIP: the keys up to the podium are the way IN, the keys from the podium on are the way OUT
  // (they share the podium key — the pivot). `returnKeyStart` marks where the way out begins.
  /** The recorded path, in order. Empty = no showcase. */
  showcaseKeys: ShowcaseKey[];
  /** Handheld drift, in world units. A little incoherent wander is what makes the move feel hand-held. */
  showcaseSway: number;
  /**
   * The synthesised return's turn-then-walk split, 0..1 along the tour. Only the FALLBACK uses it — when the
   * showcase has no authored way-out keys. With a round-trip showcase it's inert.
   */
  returnTurnEnd: number;
  /**
   * Which showcase key the way OUT begins at. The keys before it are the way in (table → podium); this one
   * and after are the way out. The key BEFORE it — the pivot (the podium) — is shared by both.
   */
  returnKeyStart: number;
  /**
   * Evens out the way-out's PACE (it's re-timed to spend time in proportion to how far the shot travels —
   * position AND aim). This is how many world units one radian of aim swing is worth in that budget.
   */
  returnAimWeight: number;
  /** Ease-out on the way out, so it decelerates into the table rather than coasting in and stopping dead. */
  returnEndEase: number;

  // ── Where the camera ends up: a place in the room, and nothing to do with the display ──
  // Only used when there is no showcase at all; with one, the reveal lands on its first key instead. The
  // path lerps from the display's normal to here, so at progress 0 this has no effect.
  camX: number;
  camY: number;
  camZ: number;
  camTargetX: number;
  camTargetY: number;
  camTargetZ: number;
  /** How much it creeps off the display before committing to the pull-back. */
  easePower: number;

  // ── Pivots — the point, in the MODEL's own coordinates, a prop scales and turns around ──
  podiumPivotX: number;
  podiumPivotY: number;
  podiumPivotZ: number;
  tablePivotX: number;
  tablePivotY: number;
  tablePivotZ: number;

  // ── The set — each prop placed independently: shown/hidden, scaled (PER AXIS), moved, turned (DEGREES) ──
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

  // ── The FAQ hologram ──
  // A DOM panel anchored to a point in the room (see lib/hologramPose.ts). The scene projects the anchor
  // through its camera every frame; the overlay reads that and places itself. SIZES are in WORLD UNITS
  // (multiplied by the projected pixels-per-unit at the anchor's depth) so the panel grows like a real
  // object as the camera approaches — the pixel clamps are the legibility exception.
  showHologram: boolean;
  /** Where it floats, in world coordinates. The panel's CENTRE — it opens symmetrically about this. */
  holoX: number;
  holoY: number;
  holoZ: number;
  holoWidth: number;
  /** Past this the content scrolls INSIDE the panel rather than growing it any further. */
  holoMaxHeight: number;
  /** Legibility floor / ceiling, in real pixels — load-bearing on portrait, not polish. */
  holoMinWidthPx: number;
  holoMaxWidthPx: number;

  /** The black bars that cap the panel. Sealed together when it's closed; the content parts them. */
  holoFrameHeight: number;
  /** How far the frames overhang the lit area to either side. Negative tucks them inside it. */
  holoFrameInset: number;
  holoFrameColor: string;

  holoTint: string;
  /** The cyan wash's strength. This is a hologram: it should be barely there. */
  holoOpacity: number;
  holoGlow: number;
  holoScanlines: number;
  /** Chromatic split, in pixels at 1× scale — the colour fringing that says "projected light". */
  holoFringe: number;

  holoOpenSeconds: number;
  holoRowStagger: number;
  /** How much of the camera's handheld drift the panel rides, 0..1 (1 = welded to the room, 0 = holds still). */
  holoSwayFollow: number;

  // ── Light ──
  // Every light OFF, on purpose. The set is lit entirely by its own emissive maps and by the display — in a
  // black room, the only thing throwing light is the screen you're looking at. A key light or environment
  // washes that out instantly.
  /** The display is the set's main light source. */
  screenLight: number;
  ambient: number;
  keyLight: number;
  /** How hard the shared environment map hits the set's METAL (the works field's PMREM is a bright studio box). */
  envIntensity: number;
}

/**
 * The showcase: the camera's move around the room, as ONE continuous shot the reveal progress scrubs.
 *
 * A ROUND TRIP. Keys up to the podium are the way IN (table → podium); keys from the podium on are the way
 * OUT (podium → turn → table). They SHARE the podium key — the pivot — so the two never seam, and
 * `returnKeyStart` marks where the way out begins. The first key is where the reveal LANDS, and the way
 * out's last key is where it re-enters the pull-back: both are the table pose, so neither hand-off seams.
 */
export const SHOWCASE_KEYS: ShowcaseKey[] = [
  // ── The way IN: table → podium (keys 0–3) ──
  // 1. At the table, looking down at the screen you just backed out of.
  { x: -4.75, y: 1.77, z: 6.86, tx: -6.68, ty: -6.39, tz: 18.43, sx: -4.87, sy: 0.85, sz: 8.15, syaw: 180, spitch: 90, sroll: -10, sh: 0.95 },
  // 2. Look up and away, across the room.
  { x: -4.75, y: 1.77, z: 6.86, tx: -15.61, ty: -0.36, tz: -2.18, sx: -4.87, sy: 0.85, sz: 8.15, syaw: 180, spitch: 90, sroll: -10, sh: 0.95 },
  // 3. Turn to face the podium.
  { x: -4.75, y: 1.77, z: 6.86, tx: -4.03, ty: 0.34, tz: -7.34, sx: -4.87, sy: 0.85, sz: 8.15, syaw: 180, spitch: 90, sroll: -10, sh: 0.95 },
  // 4. Arrive at the podium. The PIVOT — the last key of the way in, shared as the first of the way out.
  { x: -4.57, y: 1.4, z: -0.6, tx: -4.08, ty: 0.89, tz: -14.87, sx: -4.87, sy: 0.85, sz: 8.15, syaw: 180, spitch: 90, sroll: -10, sh: 0.95 },
  // ── The way OUT: podium → turn → table (keys 4–7). `returnKeyStart` = 4 points here. ──
  // 5. Still at the podium (≈ key 3) — the dwell while the hologram seals.
  { x: -4.36, y: 1.38, z: -0.33, tx: -4.7, ty: 0.59, tz: -14.58, sx: -4.87, sy: 0.85, sz: 8.15, syaw: 180, spitch: 90, sroll: -10, sh: 0.95 },
  // 6. Turn away — look back across the room.
  { x: -4.36, y: 1.38, z: -0.33, tx: -17.81, ty: 2.21, tz: 4.38, sx: -4.87, sy: 0.85, sz: 8.15, syaw: 180, spitch: 90, sroll: -10, sh: 0.95 },
  // 7. Turn further, round toward the table.
  { x: -4.36, y: 1.38, z: -0.33, tx: -5.28, ty: 1.61, tz: 13.91, sx: -4.87, sy: 0.85, sz: 8.15, syaw: 180, spitch: 90, sroll: -10, sh: 0.95 },
  // 8. Walk back to the table, looking down at it (≈ key 0's place, so the pull-back picks up clean).
  { x: -4.48, y: 1.71, z: 6.84, tx: -7.06, ty: -5.2, tz: 19.06, sx: -4.87, sy: 0.85, sz: 8.15, syaw: 180, spitch: 90, sroll: -10, sh: 0.95 },
];

const CHAMBER_TUNING: ChamberTuning = {
  // The display laid FLAT into the table's surface (pitch 90), canted slightly. So the reveal opens looking
  // straight down at the table's screen — the only place the picture reads 1:1 — then flies out to `cam*`.
  rigX: -4.87,
  rigY: 0.85,
  rigZ: 8.15,
  rigYaw: 180,
  rigPitch: 90,
  rigRoll: -10,

  displayHeight: 0.95,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  // The podium's ground plane / backdrop and the table's extra pieces — everything but the one surface and
  // the ring portal the room needs. CULLED at load (removed and their geometry freed), not drawn invisibly.
  hiddenParts: [
    'podium:8',
    'podium:7',
    'podium:6',
    'podium:5',
    'podium:4',
    'table:7',
    'table:6',
    'table:5',
    'table:4',
    'table:3',
    'table:2',
    'table:1',
  ],

  showRings: true,
  ringsX: 0,
  ringsY: -0.85,
  ringsZ: 0.7,
  ringsScale: 0.63,
  ringsRotX: 0,
  ringsRotY: 0,
  ringsRotZ: 0,
  ringsSpin: 10,

  // A deep navy that reads as a cold light in the dark rather than as blue paint — the cables are pure
  // emissive, so the colour IS the glow.
  cablesColor: '#000e2e',
  cablesGlow: 1,
  paintJoiners: false,
  joinersColor: '#000000',
  joinersGlow: 1,
  tableColor: '#3b3e43',

  showcaseKeys: SHOWCASE_KEYS,
  // The handheld drift is coupled to the camera's SPEED, so it breathes through the tour and settles to
  // perfectly still the moment the camera arrives.
  showcaseSway: 0.21,
  returnTurnEnd: 0.7,
  // The showcase runs table(0) → podium(3) in, then podium(4) → turn(5,6) → table(7) out.
  returnKeyStart: 4,
  returnAimWeight: 3,
  returnEndEase: 2.4,

  // Only used when there is no showcase at all. With one, the reveal lands on its FIRST key instead.
  camX: -4.6,
  camY: 2.1,
  camZ: 6.7,
  camTargetX: -4.87,
  camTargetY: 0.85,
  camTargetZ: 8.15,
  easePower: 2.4,

  podiumPivotX: 0,
  podiumPivotY: 0,
  podiumPivotZ: 0,
  tablePivotX: 0,
  tablePivotY: 0,
  tablePivotZ: 0,

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
  // Deliberately NOT uniform: the table is stretched so its screen matches the render's shape (this is what
  // replaced cropping the picture).
  tableScaleX: 0.95,
  tableScaleY: 0.85,
  tableScaleZ: 0.76,
  tableX: -3.9,
  tableY: 0.05,
  tableZ: 8.45,
  tableRotX: 0,
  tableRotY: -190,
  tableRotZ: 0,

  // Floating above the plinth, in front of the ring portal — so the rings glow around it as a backdrop
  // rather than fighting it for the frame.
  showHologram: true,
  holoX: -4.4,
  holoY: 1.65,
  holoZ: -4.8,
  holoWidth: 2.6,
  holoMaxHeight: 1.65,
  holoMinWidthPx: 295,
  holoMaxWidthPx: 690,

  holoFrameHeight: 0.13,
  holoFrameInset: 0.06,
  holoFrameColor: '#000000',

  holoTint: '#26abba',
  holoOpacity: 0.035,
  holoGlow: 2,
  holoScanlines: 0.56,
  holoFringe: 1.3,

  holoOpenSeconds: 1.55,
  holoRowStagger: 0.06,
  holoSwayFollow: 0.1,

  screenLight: 0,
  ambient: 0,
  keyLight: 0,
  envIntensity: 0,
};

/** The chamber's fixed numbers. Read once by the scene and the hologram; never mutated. */
export function getChamberTuning(): Readonly<ChamberTuning> {
  return CHAMBER_TUNING;
}
