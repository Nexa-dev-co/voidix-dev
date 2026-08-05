/**
 * The chamber reveal's numbers — fixed constants.
 *
 * Every value in the reveal (where the display hangs, where you end up standing, how the set is arranged,
 * the showcase path the camera walks) was authored against an on-screen tuning panel and baked in here.
 * The scene reads this once and the FAQ hologram reads the `holo*` values for its look and size — both
 * via {@link getChamberTuning}.
 *
 * That panel is gone, along with every other authoring surface on the site: these values ship as they
 * are and are changed by editing this file. Nothing mutates the object at runtime, which is why the
 * scene can safely hold it by reference for the life of the room.
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

  /**
   * The aspect of the black PANEL the picture is set into — i.e. how much of the tabletop the screen
   * covers, independent of what shape the picture happens to be.
   *
   * ⚠ This exists because the display's width tracks the viewport's, and the table's does not. The
   * table is stretched per-axis (`tableScaleX/Y/Z`) so its surface matches the render's shape, and it
   * was stretched against a LANDSCAPE frame. Turn the same page portrait and the picture narrows to
   * well under half the tabletop, leaving bare slate down both sides of it.
   *
   * The panel is not a second object — the display's own quad simply grows to this aspect and its
   * shader paints everything outside the picture black (`uPictureSpan` in lib/spacePresentMaterial).
   * A separate plane would be coplanar with a display that is laid FLAT into the table, and would
   * z-fight against the tabletop for the whole reveal.
   *
   * The value is the aspect the room was authored on (a 1512×982 panel). It is a FLOOR, not a fixed
   * size: at any aspect wider than this the picture is already wider than the panel and the quad just
   * follows the picture, so every landscape viewport renders exactly as it did before this existed.
   * Retune it only if the table's own scale changes.
   */
  displayPanelAspect: number;

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

  // ── Colour ──
  // MULTIPLIES the model's own maps rather than replacing them, so the surface detail survives.
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

  // ── The ground ──
  // A procedural grid on one plane, not a model — the room's lights are all at zero, so a lit floor
  // would render black. See components/sections/Chamber/groundGrid.ts.
  showGround: boolean;
  /** Height the floor sits at. The table rests on it, so this and the table's Y move together. */
  groundY: number;
  /** World units between grid lines. */
  groundCell: number;
  /** Line thickness in PIXELS — held constant in screen space, which is what stops distant lines aliasing. */
  groundLineWidth: number;
  /** World radius at which the floor has faded to nothing, so the room never shows an edge. */
  groundFade: number;
  /** The floor before its cell has struck — the dark room. */
  groundColor: string;
  /** …and after. The colour arriving IS the room's lights coming on. Shared with the walls. */
  groundColorLit: string;
  /** The grid drawn ON the lit floor. Dark lines on a pale surface, not glowing lines in a void. */
  groundLineColor: string;
  groundOpacity: number;

  // ── The floor's light fittings ──
  // Whole TILES replaced by a lit paver — a frosted square set flush where a tile would be, a lamp
  // behind it, a shadowed rim where it meets the tile it displaced, and a pool of light on the floor
  // around it. They are the room's light SOURCE; everything else in here is a surface with no lamp on
  // it, and until these existed nothing explained why the room was bright.
  //
  // Drawn in the floor's own shader rather than through a bloom pass: the chamber goes through
  // `screenComposer` (RenderPass → OutputPass → SMAA) and the site's only UnrealBloomPass lives in the
  // space render, so a glow here would mean a second bloom on the heaviest scene on the site — for
  // something that is one `exp(-d²/σ²)` in a shader that is already running.
  showFloorLights: boolean;
  /**
   * Tiles between one fitting and the next.
   *
   * Laid on a STAGGERED lattice — alternate rows offset by half a period. A plain lattice reads as
   * graph paper the moment you can see more than a few; staggering is what makes a floor look laid.
   */
  floorLightEvery: number;
  /**
   * The paver's half-size as a fraction of the tile. 0.5 fills the tile exactly; below that it sits
   * inside the tile's own footprint with the floor showing around it.
   */
  floorPaverSize: number;
  /** How soft the paver's edge is. Small — this is a machined edge, not a fade. */
  floorPaverBevel: number;
  /**
   * The lamp's size behind the diffuser, in tile fractions. **Keep it well under `floorPaverSize`.**
   *
   * This is the pairing that decides whether a fitting reads as a LIGHT or as a coloured tile: a small
   * sigma at a high intensity is a lamp behind frosted glass; a large one at any intensity is a panel
   * painted amber. An earlier build of this floor got that backwards (a 0.55 sigma against a 1-unit
   * cell, where the falloff never drops below 0.44 anywhere on a tile) and rendered flat salmon
   * rectangles. If this ever reads as coloured tiles again, this number is why.
   */
  floorLightCoreSigma: number;
  /** How hard the lamp burns. Additive, so past ~1 the tone map rolls it toward white on its own. */
  floorLightCoreIntensity: number;
  /** How brightly the diffuser panel around the lamp glows. */
  floorLightBodyIntensity: number;
  /** The shadowed edge of the recess the fitting sits in — what puts it IN the floor, not on it. */
  floorLightRimWidth: number;
  floorLightRimDepth: number;
  /** How far light falls onto the surrounding tiles, in world units, and how strongly. */
  floorLightPoolSigma: number;
  floorLightPoolStrength: number;
  /** The diffuser's warm glow, and the hotter lamp behind it. */
  floorLightColor: string;
  floorLightCoreColor: string;
  /**
   * How far AHEAD of the floor around them the fittings strike, in the wavefront's own 0..1 units.
   *
   * Cause before effect: they are the light source, so the room cannot come up before them. Without
   * this the room simply becomes lit and nothing in the shot explains why.
   */
  floorLightLead: number;

  // ── Where the floor meets the wall ──
  /**
   * How many world units of the floor darken as they approach the wall.
   *
   * The two surfaces currently meet at a hard seam between two flat colours, which is the one edge that
   * gives the room away as two shaders rather than one space. Ambient occlusion is what makes a corner
   * look like a corner.
   */
  groundContactWidth: number;
  groundContactStrength: number;

  // ── The lights coming on ──
  // A wavefront spreading out from the display, each floor cell striking on its own. Driven by the
  // reveal's own progress, so it is reversible for free: scroll back and the room goes dark again.
  /** Reveal progress at which the first cell strikes. */
  groundPowerStart: number;
  /** …and at which the furthest one has. */
  groundPowerEnd: number;
  /** World distance the wavefront has travelled at full power. Larger = the sweep reaches further out. */
  groundIgniteRadius: number;
  /** How far out of turn a cell may fire. 0 = a clean expanding circle, which reads as a graphic. */
  groundIgniteJitter: number;
  /** How gradually one cell comes up. Small = a hard click on. */
  groundIgniteSoftness: number;
  /** The over-bright flare as a cell strikes, like a tube striking before it settles. */
  groundSurge: number;

  // ── The walls ──
  // One inward-facing cylinder of plain white — no grid, that belongs to the floor — riding the floor's
  // ignition. No corners and no ceiling: it fades out as it rises, so the room encloses you at eye level
  // without ever measuring itself. See chamberWalls.ts.
  showWalls: boolean;
  /** How far out the wall stands. Keep inside `groundFade` or the floor dies before it reaches the wall. */
  wallRadius: number;
  /** How far up it has faded to nothing. There is no ceiling — this is where it stops being visible. */
  wallHeight: number;
  /** Fraction of the height held at full strength before the rising fade starts. */
  wallFadeStart: number;
  wallOpacity: number;
  /**
   * THE WALL COLOUR. Kept separate from the floor's white rather than derived from it, so the two read
   * as different surfaces — a wall and a floor at the same value collapse into one seamless tube.
   */
  wallColor: string;
  /** ±fraction of low-frequency luminance wander, so the wall is a material rather than a fill. */
  wallGrain: number;
  /**
   * The finish on top of that wander: finer, streaked vertically like a brushed plate.
   *
   * ⚠ `wallTextureFade` is not polish. Noise this fine on a surface this large is the same moire the
   * floor's grid had to be rewritten around — past a certain depth one period falls below a pixel and
   * the whole wall crawls with the camera. The floor's answer was to hold a line at one pixel; this one
   * simply stops drawing before it gets there.
   */
  wallTexture: number;
  wallTextureScale: number;
  wallTextureFade: number;

  // ── Panelling: the wall as plates, not a tube ──
  // ⚠ The one place the documented "no grid on the walls" rule has been given up. That rule existed to
  // keep the room unmeasurable — and a ship's corridor is meant to be measured. See chamberWalls.ts.
  /** Vertical seams around the wall. **Rounded to an integer**, so the pattern closes at the atan wrap. */
  wallPanelColumns: number;
  /** World units between horizontal seams. */
  wallPanelRowHeight: number;
  /** A seam's half-width, in world units. */
  wallPanelSeam: number;
  wallPanelSeamDepth: number;
  /** The lit lip just OUTSIDE a seam — a plate's edge turning toward the light. */
  wallPanelBevel: number;

  // ── The light strip running the wall at eye height ──
  // Sited where the tour actually looks: every showcase key aims level or down, which is also why there
  // is still no ceiling to put lights in — panels up there would cost a mesh and never be in frame.
  showWallStrip: boolean;
  /** The band's centre, measured up from the floor line. */
  wallStripY: number;
  /** Half-thickness of the lit core, in world units. */
  wallStripHalf: number;
  /** Sigma of its skirt. Wide × faint is a glow; wide × strong is a wash — see the floor's own note. */
  wallStripGlow: number;
  wallStripBloom: number;
  wallStripIntensity: number;
  /** Breaks around the circumference. **Rounded to an integer**, same reason as the columns. */
  wallStripSegments: number;
  /** How much of each segment is gap, 0 .. 0.5. */
  wallStripGap: number;
  /** The channel the strip is set into — what puts it IN the wall rather than on it. */
  wallStripRecess: number;
  wallStripRecessDepth: number;
  wallStripColor: string;

  // ── The plinth: what the hologram is actually projected FROM ──
  // A black drum standing on the floor with a lit emitter in its throat, placed under the panel. It
  // replaced a wash of tint painted on the floor — that wash was standing in for a source, and a
  // projection with nothing projecting it is a sticker. See chamberPlinth.ts.
  showPlinth: boolean;
  plinthRadius: number;
  plinthHeight: number;
  /** The housing. Near-black: it is a machine, not a surface to look at. */
  plinthColor: string;
  /** Everything cut into it that glows — the vents, the ring and the top lip share one colour. */
  plinthGlowColor: string;
  /** Vertical slots around the drum, and how wide each is in turns of its circumference. */
  plinthVents: number;
  plinthVentWidth: number;
  /** The height band the run of slots occupies, as fractions of the drum. */
  plinthVentBottom: number;
  plinthVentTop: number;
  plinthVentGlow: number;
  /** A continuous band of light near the top — the drum's own horizon. */
  plinthRingY: number;
  plinthRingWidth: number;
  plinthRingGlow: number;
  /** The lit lip where the housing turns over into the throat. */
  plinthRimGlow: number;
  plinthBevel: number;
  /** The emitter standing in the throat: slim, additive, and fading as it rises toward the panel. */
  plinthCoreRadius: number;
  plinthCoreHeight: number;
  plinthCoreColor: string;
  plinthCoreIntensity: number;
  /** How much of the emitter's height is left by the time its light has gone. */
  plinthCoreFade: number;
  /** The shadow gap at the floor line, in world units, and how deep it goes. */
  wallSkirtHeight: number;
  wallSkirtDepth: number;
  /** How much darker the wall gets facing away from the display. Gives the room a light direction. */
  wallDirectional: number;

  // ── Pivots — the point, in the MODEL's own coordinates, a prop scales and turns around ──
  tablePivotX: number;
  tablePivotY: number;
  tablePivotZ: number;

  // ── The set — the table, placed: shown/hidden, scaled (PER AXIS), moved, turned (DEGREES) ──
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

  /**
   * The TEXT. Near-black, because the room is white now — the panel is transparent, so its type sits
   * directly on the room and has to be read against it.
   */
  holoInk: string;
  /**
   * The accent: indices, arrows, rules, hover washes.
   *
   * Deliberately NOT the raw `--accent` (#ff8a1a) — that is a colour for glowing on black and manages
   * only 2.36:1 on this white room. This is the same hue taken down far enough to hold its own: 5.34:1,
   * past the 4.72 of the teal it replaced. Check any retune against white before shipping it.
   */
  holoTint: string;
  /**
   * The panel's own glass — its backing colour, kept apart from {@link holoTint}.
   *
   * The tint is what the indices, arrows and rules are drawn in. Backing the panel with it as well would
   * put the type on its own accent and force one value to do two jobs, which is what the old
   * `rgba(tint, opacity)` backing did before a body was wanted at all.
   */
  holoPanelColor: string;
  /** How opaque that glass is. 0 is fully transparent — what the white room wanted, and nothing else. */
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
 * ⚠ STALE — these keys walk to a podium that no longer exists. The podium and its ring portal were
 * removed and the hologram moved to the table, so every pose below aims at empty space. They are kept
 * only so the scene still has a path to sample; replace this array wholesale once a new tour is
 * authored. The comments on each key describe the OLD tour.
 *
 * A ROUND TRIP. Keys up to the podium are the way IN (table → podium); keys from the podium on are the way
 * OUT (podium → turn → table). They SHARE the podium key — the pivot — so the two never seam, and
 * `returnKeyStart` marks where the way out begins. The first key is where the reveal LANDS, and the way
 * out's last key is where it re-enters the pull-back: both are the table pose, so neither hand-off seams.
 */
const SHOWCASE_KEYS: ShowcaseKey[] = [
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
  // 1512 / 982 — the panel the table's stretch was authored against. See the interface note.
  displayPanelAspect: 1.54,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  // The table's extra pieces — everything but the one surface the room needs. CULLED at load (removed and
  // their geometry freed), not drawn invisibly.
  hiddenParts: [
    'table:7',
    'table:6',
    'table:5',
    'table:4',
    'table:3',
    'table:2',
    'table:1',
  ],

  /**
   * Still the one COOL object in a warm room — but taken right down for the dark one.
   *
   * At #3b3e43 it was mid-grey, which on a white floor read as equipment and on this one would be the
   * palest thing in the frame: a bright slab in a dark room, pulling the eye off the display it is
   * supposed to be holding. Same hue, four stops down, so it still separates from the floor's warmth
   * without announcing itself.
   */
  tableColor: '#1c1f23',

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

  showGround: true,
  groundY: 0,
  groundCell: 1,
  groundLineWidth: 1.5,
  groundFade: 26,
  // ── THE ROOM IS DARK, and the fittings in the floor are the only thing lighting it ──
  //
  // It was a bright studio: a white floor and the hero's cream on the walls, so the room resolved to the
  // colour the site opened on. That rhyme has been deliberately given up. The rest of the site — the
  // fleet, the field, contact — is amber on `--bg` black, and a white room was the one place that stopped
  // being true; it also gave the floor's lamps nothing to be bright against, which is the entire reason
  // architectural floor lighting is photographed in the dark.
  //
  // ⚠ This is a PALETTE, not five independent colours. A dark room forces the hologram's ink to invert
  // (near-black type has nothing to sit on) and its tint back to the raw accent, and it makes the table's
  // cool grey the palest thing in the frame. Change any one of these back and check the others.

  /** Exactly `--bg`. Before the lights reach it, a patch of room is not dark — it is the void. */
  groundColor: '#060606',
  /**
   * The lit floor. Neutral graphite, barely cool — the deck of a ship rather than a warm interior.
   *
   * It was warm (#17140f) while the room's own colour was doing the work. It is not any more: the wall
   * strip and the floor fittings are, and against amber a neutral surround reads far cleaner than a
   * brown one, which merely agreed with the light and flattened it.
   *
   * The step up from unlit is deliberately small. The room's "lights on" beat is carried by the FITTINGS
   * striking and by the surge flare, not by the floor changing value.
   */
  groundColorLit: '#17181a',
  /**
   * The seams, LIGHTER than the tiles they separate — grout catching light, which is what a joint does
   * on a dark floor. On the old white floor this was the other way round.
   */
  groundLineColor: '#2c2e31',
  groundOpacity: 1,

  showFloorLights: true,
  // Authored against the running room. One every four tiles, with a fitting that is larger,
  // softer-edged and altogether more lit than the first pass: a bigger lamp behind a fuller diffuser,
  // which on a DARK floor reads as a real fixture rather than as a pinpoint.
  floorLightEvery: 4,
  floorPaverSize: 0.4,
  floorPaverBevel: 0.1,
  floorLightCoreSigma: 0.3,
  floorLightCoreIntensity: 2.7,
  floorLightBodyIntensity: 1.34,
  floorLightRimWidth: 0.045,
  floorLightRimDepth: 0.75,
  // A little over one tile of spill. Far enough to reach the neighbours, short enough that the floor
  // between fittings is genuinely unlit.
  floorLightPoolSigma: 0.5,
  floorLightPoolStrength: 0.17,
  // The accent — the sun's amber. The room is lit by the same colour the star is.
  floorLightColor: '#ff7b00',
  // The lamp itself, near-white with the warmth left in. A pure white core reads as a blown highlight;
  // this keeps the fitting the same temperature all the way down.
  floorLightCoreColor: '#ffa200',
  // A little over a tenth of the wavefront ahead of the floor: enough to see them come on first,
  // not so much that they hang lit in a dark room waiting for it.
  floorLightLead: 0.12,

  groundContactWidth: 2.4,
  groundContactStrength: 0.42,

  // Starts once the pull-back has actually left the display (before that the floor is depth-hidden
  // behind it anyway) and completes as the tour gets going, so the room is lit by the time you walk.
  groundPowerStart: 0.1,
  groundPowerEnd: 0.62,
  groundIgniteRadius: 18,
  groundIgniteJitter: 0.35,
  groundIgniteSoftness: 0.18,
  groundSurge: 1.6,

  showWalls: true,
  // Comfortably inside groundFade (26), so the floor is still alive where it meets the wall.
  wallRadius: 14,
  wallHeight: 9,
  wallFadeStart: 0.15,
  wallOpacity: 1,
  /**
   * LIGHTER than the floor, so the table, the hologram and the strip all silhouette against it and the
   * room gains a horizon. Neutral graphite — a machined plate, not a painted surface.
   *
   * This has now been three things. It was the HERO's cream (#e2dfd2), deliberately: the room resolved
   * to the colour the site opened on. Then it went darker than the floor (#12100e) so it would recede
   * and the eye would stay down. Both were answers for a room with no lights ON the wall; there is one
   * now, and a strip needs a plate to be set into and something for its glow to fall across.
   */
  wallColor: '#2a2c2f',
  /** ±fraction of low-frequency luminance wander. What makes a wall read as plaster, not a colour fill. */
  wallGrain: 0.025,
  wallTexture: 0.06,
  wallTextureScale: 2.6,
  // Just past the far side of the room at wallRadius 14, so the finish is gone before it can crawl.
  wallTextureFade: 16,

  // 24 plates around, and a horizontal break a little under every two metres — close enough that the
  // wall has a readable scale, far enough that it does not become a mesh.
  wallPanelColumns: 24,
  wallPanelRowHeight: 2.2,
  wallPanelSeam: 0.02,
  wallPanelSeamDepth: 0.55,
  wallPanelBevel: 0.22,

  showWallStrip: true,
  // Eye height for a camera standing at y ≈ 1.4–1.8 and looking level: the strip is in frame for the
  // whole tour rather than under it.
  wallStripY: 1.15,
  wallStripHalf: 0.045,
  wallStripGlow: 0.08,
  wallStripBloom: 0.26,
  wallStripIntensity: 3.95,
  // One break per plate, so the strip reads as sitting in the panelling rather than crossing it.
  wallStripSegments: 24,
  wallStripGap: 0.12,
  wallStripRecess: 0.08,
  wallStripRecessDepth: 0.8,
  wallStripColor: '#ff7b00',

  // ── The plinth ──
  // Sited under the panel by the scene, from holoX / holoZ — it IS the hologram's source, so the two
  // can never drift apart. Its top sits below holoY (1.65) with the emitter rising into the gap.
  showPlinth: true,
  plinthRadius: 0.34,
  // Authored against the running room. Squatter than it was first guessed at: a drum two thirds as tall
  // as it is wide reads as a fitting bolted to the floor, where the taller version read as a pedestal
  // holding something up — and the panel is projected, not displayed.
  plinthHeight: 0.56,
  plinthColor: '#0a0a0b',
  plinthGlowColor: '#ff7b00',
  // Enough slots that the drum reads as machined from any angle, narrow enough that it stays mostly
  // housing — a drum that is more light than metal stops being an object.
  plinthVents: 18,
  plinthVentWidth: 0.16,
  plinthVentBottom: 0.16,
  plinthVentTop: 0.72,
  plinthVentGlow: 0.5,
  plinthRingY: 0.86,
  plinthRingWidth: 0.018,
  plinthRingGlow: 1.5,
  plinthRimGlow: 0.9,
  plinthBevel: 0.04,
  // Slim and short: it has to read as the throat of the housing, not as a second column. It stops
  // short of the panel and fades out well before it, so the light thins into air.
  plinthCoreRadius: 0.1,
  // Short: the emitter is the throat of the housing, not a beam reaching for the panel. It stops well
  // under holoY (1.65) and its own fade takes the light out before it arrives, so what fills the gap is
  // air rather than a column.
  plinthCoreHeight: 0.23,
  plinthCoreColor: '#ffa200',
  plinthCoreIntensity: 1.8,
  plinthCoreFade: 0.8,
  /** A shadow gap where the wall meets the floor — the other half of the floor's own contact darkening. */
  wallSkirtHeight: 0.35,
  wallSkirtDepth: 0.55,
  /**
   * How much darker the wall gets facing AWAY from the display.
   *
   * The room has no light direction otherwise — every surface lights by distance alone, which is why a
   * bare cylinder reads as a flat tube. Nearly free: the ignition origin is already a uniform.
   */
  wallDirectional: 0.4,

  tablePivotX: 0,
  tablePivotY: 0,
  tablePivotZ: 0,

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

  // Floating with the table. The podium and its ring portal that used to back it are gone; the ground's
  // grid is the backdrop now. These coordinates are the OLD plinth's and still want re-authoring.
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

  // The site's own `--fg`. Near-black ink was a consequence of the white room and has nothing to sit on
  // in this one.
  holoInk: '#ebe8e0',
  // The RAW accent, not the deepened #a85400. That value exists to hold 5.34:1 against white; against a
  // dark panel it is mud. CLAUDE.md calls #ff8a1a "a colour for glowing on black", which is now the job.
  holoTint: '#ff8a1a',
  /**
   * The panel's own glass — a translucent slab, exactly as `.contact-panel` is over the black hole.
   *
   * Kept apart from `holoTint` on purpose. The tint is the indices, arrows and rules; making it the
   * backing as well would put the type on its own accent colour and force one value to do two jobs.
   */
  holoPanelColor: '#0b0a09',
  // Was 0 — fully transparent, which is what the WHITE room wanted. A dark room wants a body: light type
  // needs something to sit on, and 0.55 is close to the 0.62 the contact panel uses for the same reason.
  holoOpacity: 0.55,
  // ── The three below are a hologram's "projected light" vocabulary, and they are BACK ──
  // They were zeroed for the white room, where a glow had nothing to glow against, scanlines became a
  // grey haze over dark type, and the chromatic fringe read as printing misregistration rather than as
  // projection. The note left with them said "in case the room ever goes dark again". It has.
  holoGlow: 0.55,
  holoScanlines: 0.3,
  holoFringe: 0.6,

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
