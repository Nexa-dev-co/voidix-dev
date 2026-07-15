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

/**
 * One pose on the showcase path: where the camera is, what it's looking at — AND where the screen is.
 *
 * The screen is only pinned while the reveal is running (it has to be: the camera starts on its normal,
 * and that's the seam). Once you're standing in the room it's free, so the showcase moves it too. That's
 * what lets the space feed lift out of the table and travel — into the podium's rings, say, which is
 * what a podium with three concentric rings is *for*.
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
  /**
   * Tuning only: while HOLD is on, view the RETURN choreography (close → turn → walk) instead of the
   * forward tour, so it can be scrubbed and dialled in with `revealAt` and `returnTurnEnd`.
   *
   * On the live page the direction is read from the scroll, but a HELD reveal isn't moving — so there's
   * nothing to read it from, and without this the freeze can only ever show the way IN. This is exactly why
   * "freeze at the hologram to tune the way out" didn't work before.
   */
  holdReturning: boolean;

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

  // ── The ring portal ──
  //
  // The rings, the turbine sitting in their mouth, and the cabling that feeds them: ONE machine, rigged
  // as one. Move or scale any of it on its own and the model comes apart.
  //
  // It needs placing independently of the podium as a whole, because it's what the hologram sits inside
  // and in the model it's half-buried in its own cabling (the cables stand 0.89 tall; the rings start at
  // 0.10). `podiumY` can't lift it out — the ground plane is in the same model and rises with it.
  //
  // The assembly gets a rig centred on ITSELF, and that last part matters: the optimizer bakes node
  // transforms into the geometry, so every mesh sits at the model's origin with its vertices out in model
  // space. Scale or turn one directly and it pivots around the model's ORIGIN and swings across the room.
  // A rig at the assembly's own centre makes it scale and turn on the spot.
  //
  // Offsets and scale are in the MODEL's coordinates, so they ride along with the podium's own transform.
  showRings: boolean;
  ringsX: number;
  ringsY: number;
  ringsZ: number;
  ringsScale: number;
  ringsRotX: number;
  ringsRotY: number;
  ringsRotZ: number;
  /**
   * Degrees per second the RINGS spin, on their own axis, inside the portal.
   *
   * Only the rings — the turbine and the cabling are bolted to the plinth and stay put. That means the
   * rings need a second rig INSIDE the assembly's, centred on themselves, or they'd swing around the
   * whole machine's centre instead of turning on the spot.
   */
  ringsSpin: number;

  // ── Colour ──
  // These MULTIPLY the models' own maps rather than replacing them, so the surface detail survives — a
  // flat repaint would throw away everything the texture is doing.
  //
  // The cable runs only: NOT their joiners, which are the dark connectors and want to stay dark.
  cablesColor: string;
  /**
   * How hard the cables glow, as a multiple of what the model shipped with.
   *
   * Needed because the cables are pure EMISSIVE — every light in this set is at zero, so their glow is
   * the whole of what you see. Tint that and nothing tempers it: you get a flat, saturated wash with no
   * life in it. The strength is what turns a colour into a light.
   */
  cablesGlow: number;

  /** The joiners — the connectors along the runs. Off by default: they read as hardware, not as light. */
  paintJoiners: boolean;
  joinersColor: string;
  joinersGlow: number;

  tableColor: string;

  /** Tuning only: which object a mouse drag rotates. Follows the panel's open tab. */
  dragTarget: 'podium' | 'table' | 'none';

  // ── The showcase: a camera move around the finished set ──
  //
  // Authored by flying a scout camera around and snapshotting poses you like, rather than by guessing
  // coordinates. While `freeCamera` is on the props are FROZEN (a drag orbits the camera instead of
  // turning a prop) and the reveal's own camera is ignored, so you can fly without disturbing anything.
  freeCamera: boolean;
  /** The scout camera you fly. Recording snapshots this. */
  scoutX: number;
  scoutY: number;
  scoutZ: number;
  /** …and what it's looking at. Dragging aims it; WASD then flies you that way. */
  scoutTargetX: number;
  scoutTargetY: number;
  scoutTargetZ: number;
  /** World units per second on WASD. Hold shift to sprint. */
  flySpeed: number;

  /** The recorded path, in order. Empty = no showcase. */
  showcaseKeys: ShowcaseKey[];
  /**
   * Seconds for the tour portion of the tuner's PREVIEW sweep ("play tour").
   *
   * It no longer sets the live tour's length — the tour is folded into the reveal's scrubbed span now, so
   * on the real page its speed is the reveal glide's (`REVEAL_STEP_DURATION × (1 − TOUR_START)` in
   * useHeroAnimation / chamberScene). This only paces the preview, so a designer can watch the path back at
   * a comfortable speed while recording keys. See docs/chamber-tour-smoothing-plan.md.
   */
  showcaseSeconds: number;
  /**
   * Handheld drift, in world units. A camera that glides on perfect rails reads as a machine; a little
   * incoherent wander is most of what makes a move feel like someone holding the thing.
   */
  showcaseSway: number;
  /**
   * The RETURN's turn-then-walk split, 0..1 along the tour. Above it the camera holds at the podium and
   * turns to face the table (while the hologram seals); below it, it walks back to the table looking at it.
   * Higher = longer spent turning on the spot before the walk. Only the return uses this — the way in is
   * the authored spline, look-around and all. See chamberScene / docs/chamber-tour-smoothing-plan.md.
   *
   * Only the FALLBACK uses it — when the showcase has no authored way-out keys (see returnKeyStart), the
   * return is synthesised from this instead. With a round-trip showcase it's inert.
   */
  returnTurnEnd: number;
  /**
   * Which showcase key the way OUT begins at. The keys before it are the way in (table → podium); this one
   * and everything after are the way out (podium → turn → table). The key BEFORE it — the pivot, i.e. the
   * podium — is shared by both, so entry and exit meet without a seam.
   *
   * If there aren't enough keys past the pivot to form a way out, the return falls back to the synthesised
   * close/turn/walk (returnTurnEnd).
   */
  returnKeyStart: number;
  /**
   * Evens out the way-out's PACE. The spline otherwise spends one flat slice of time per key, so the dwell
   * and turns at the podium (tiny moves) drag while the long walk back to the table gets rushed. The return
   * is re-timed to spend time in proportion to how far the shot travels — position AND aim — and this is how
   * many world units one radian of aim swing is worth in that budget. Higher = more time spent turning
   * on the spot; lower = more time spent walking. Only the way-out uses it.
   */
  returnAimWeight: number;
  /**
   * Ease-out on the way out, so it decelerates as it arrives back at the table rather than coasting in at
   * full speed and stopping dead into the pull-back. 1 = none (even pace all the way); higher = a longer,
   * softer landing. Only the way-out uses it.
   */
  returnEndEase: number;
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

  // ── …and what it's looking at when it gets there ──
  //
  // At progress 0 the camera MUST be aimed dead at the display — that, plus sitting on its normal, is
  // what makes the picture read 1:1. But the aim doesn't have to STAY there, and welding it to the
  // display is what made the screen "the pin": you could never end the reveal facing anything else.
  //
  // Eased from the display (at 0) to here (at 1), so the seam is untouched and the reveal can still land
  // looking at whatever you like — the podium across the room, for instance.
  camTargetX: number;
  camTargetY: number;
  camTargetZ: number;
  /** How much it creeps off the display before committing to the pull-back. */
  easePower: number;

  // ── The set ──
  // Each prop is placed independently: shown/hidden, scaled, moved, turned. Rotations in DEGREES.
  //
  // Scale is PER AXIS, not uniform. That's the honest way to make a prop's screen match the render's
  // shape: stretch the prop, rather than distorting the picture to fit it.
  // ── Pivots ──
  // The point, in the MODEL's own coordinates, that a prop scales and turns around.
  //
  // A model's origin is wherever the artist happened to export from, and it's rarely anywhere useful —
  // the podium's sits out by its rings, so scaling and rotating swing the whole thing around a spot
  // nobody cares about. Re-pivot it onto the podium itself and it turns on the spot instead. The panel
  // can set these from any part's centre in one click.
  podiumPivotX: number;
  podiumPivotY: number;
  podiumPivotZ: number;
  tablePivotX: number;
  tablePivotY: number;
  tablePivotZ: number;

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
  //
  // A DOM panel anchored to a point in the room (see lib/hologramPose.ts for why it's DOM and not a
  // texture on a plane). The chamber scene projects the anchor through its camera every frame; the
  // overlay reads that and places itself.
  //
  // Which is why the SIZES here are in WORLD UNITS, not pixels: they're multiplied by the projected
  // pixels-per-unit at the anchor's depth, so the panel grows as the camera walks toward it exactly as
  // a real object would. The pixel clamps below are the one exception, and they exist for legibility —
  // see holoMinWidthPx.
  showHologram: boolean;
  /** Where it floats, in world coordinates. The panel's CENTRE — it opens symmetrically about this. */
  holoX: number;
  holoY: number;
  holoZ: number;
  holoWidth: number;
  /** Past this the content scrolls INSIDE the panel rather than growing it any further. */
  holoMaxHeight: number;
  /**
   * Legibility floor / ceiling, in real pixels.
   *
   * A projected size is honest but not always readable: on a phone the anchor can project to a panel a
   * couple of hundred pixels wide, which is a FAQ nobody can read. These clamp it back into the range a
   * human can use — and they are load-bearing on portrait, not polish.
   */
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
  /**
   * How much of the camera's handheld drift the panel rides, 0..1.
   *
   * At 1 it's welded to the room and wanders with the camera — which is what sells it as being IN the
   * room. At 0 it holds still while the room breathes around it. The middle is usually right: enough to
   * belong, not so much that reading it feels like reading in a moving car.
   */
  holoSwayFollow: number;

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

/**
 * The showcase: the camera's move around the room, as ONE continuous shot (no longer a stop per pose —
 * the whole path is a spline the reveal progress scrubs; see chamberScene / the plan doc).
 *
 * It's a ROUND TRIP. The keys up to the podium are the way IN (table → podium); the keys from the podium
 * onward are the way OUT (podium → turn → table). They SHARE the podium key — the pivot — so the two never
 * seam, and `returnKeyStart` marks where the way out begins (the first key past the pivot).
 *
 * The first key is where the reveal LANDS, and the way out's last key is where it re-enters the pull-back:
 * both are the table pose, so neither the entry nor the exit hand-off can seam. Keep them there.
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

export const CHAMBER_TUNING_DEFAULTS: ChamberTuning = {
  holdReveal: false,
  revealAt: 1,
  holdReturning: false,

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
  // The podium's ground plane / backdrop and the table's extra pieces — everything but the one surface
  // and the ring portal the room actually needs. These are CULLED at load (removed and their geometry
  // freed), not drawn invisibly every frame — see the cull in chamberScene's loadProp.
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
  dragTarget: 'none',

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
  // Only used when there is no showcase at all. With one, the reveal lands on its FIRST key instead —
  // the same pose twice, so the hand-off from the reveal to the tour cannot seam.
  camX: -4.6,
  camY: 2.1,
  camZ: 6.7,
  camTargetX: -4.87,
  camTargetY: 0.85,
  camTargetZ: 8.15,
  easePower: 2.4,

  freeCamera: false,
  scoutX: -4.48,
  scoutY: 1.71,
  scoutZ: 6.84,
  scoutTargetX: -7.06,
  scoutTargetY: -5.2,
  scoutTargetZ: 19.06,
  flySpeed: 4,
  showcaseKeys: SHOWCASE_KEYS,
  // The whole tour, end to end, off a single scroll.
  showcaseSeconds: 2.6,
  // The handheld drift is coupled to the camera's SPEED, so it breathes through the tour and settles to
  // perfectly still the moment the camera arrives. It cannot wander while parked.
  showcaseSway: 0.21,
  returnTurnEnd: 0.7,
  // The showcase runs table(0) → podium(3) in, then podium(4) → turn(5,6) → table(7) out. Key 4 is the
  // podium again (≈ key 3) — the dwell while the panel seals.
  returnKeyStart: 4,
  returnAimWeight: 3,
  returnEndEase: 2.4,

  // The podium's raw model is ~41 units across (it carries its own ground plane and a pyramid backdrop),
  // so it wants scaling down; the table is ~3 units and roughly life-sized already. Both need placing by
  // eye — that's what the panel is for.
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
  // Deliberately NOT uniform: the table is stretched so its screen matches the render's shape. This is
  // what replaced cropping the picture — see the crop note above.
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
  // rather than fighting it for the frame. Placed by eye from the podium's own coordinates
  // (podium at x −4.4, z −5.9); the panel is what the last showcase pose walks you up to.
  showHologram: true,
  holoX: -4.4,
  holoY: 1.65,
  holoZ: -4.8,
  holoWidth: 2.6,
  holoMaxHeight: 1.65,
  holoMinWidthPx: 295,
  holoMaxWidthPx: 690,

  // Tall enough for the bracket's centre spine to read — at a hairline it just looks like a rectangle
  // that someone nicked.
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

  // Every light OFF, on purpose. The set is lit entirely by its own emissive maps and by the display —
  // which is the point: in a black room, the only thing throwing light is the screen you're looking at.
  // Adding a key light or an environment here washes that out instantly.
  screenLight: 0,
  ambient: 0,
  keyLight: 0,
  envIntensity: 0,
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
  /** Its centre in the model's own coordinates — so a prop can be re-pivoted onto it in one click. */
  center: [number, number, number];
}

const chamberParts: Record<string, ChamberPart[]> = {};

export function reportChamberParts(model: string, parts: ChamberPart[]): void {
  chamberParts[model] = parts;
  listeners.forEach((listener) => listener());
}

export function getChamberParts(model: string): ChamberPart[] {
  return chamberParts[model] ?? [];
}

/**
 * One-shot commands from the panel to the scene — the panel holds no reference to it (the scene isn't
 * even built until the visitor reaches Works), so it can't just call a method.
 */
export type ChamberCommand =
  | { type: 'showcase:play' }
  | { type: 'showcase:stop' }
  /**
   * Put the screen dead centre in a part. The SCENE answers this rather than the panel computing it,
   * because the panel would have to reproduce the whole transform chain — and it would get it wrong the
   * moment a part is inside a moved assembly. The scene just measures the mesh where it actually is.
   */
  | { type: 'screen:to-part'; partId: string }
  /** The same trick for the hologram's anchor: drop it dead centre in a part rather than hunting for
   *  coordinates. The plinth is the one you want. */
  | { type: 'holo:to-part'; partId: string };

const commandListeners = new Set<(command: ChamberCommand) => void>();

export function sendChamberCommand(command: ChamberCommand): void {
  commandListeners.forEach((listener) => listener(command));
}

export function onChamberCommand(
  listener: (command: ChamberCommand) => void,
): () => void {
  commandListeners.add(listener);
  return () => {
    commandListeners.delete(listener);
  };
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
