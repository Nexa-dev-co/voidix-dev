import { snapshotDefaults, restoreInPlace } from '@/lib/tunerReset';

// The pad's model knowledge — glow materials, authored per-material look, and the emissive-map
// patch — lives with the SECTION that ships it, not here. The lab is the authoring tool for that
// data; duplicating the tables would guarantee the two drift apart.
export { PAD_GLOW_MATERIALS, PAD_MATERIAL_DEFAULTS } from '@/components/sections/ServicesDeck/padModel';

/**
 * The pad lab's stage — everything that isn't a property of the model itself.
 *
 * ── What lives here, and what deliberately doesn't ───────────────────────────────────────────────
 * This file owns the STAGE: the lights the pad casts, where the pad sits, the test ship, the camera
 * and the environment. It does NOT hold per-part transforms or per-material colours, because those
 * are properties of a model this file has never seen — their shape depends on what
 * `champion_astro_ring.glb` actually contains. The panel edits those live on the objects and the
 * exporter reads them back off the scene, exactly as the deck panel does for hull palettes.
 *
 * ── The point of this lab ────────────────────────────────────────────────────────────────────────
 * The pad is meant to be THE LIGHT SOURCE on the services deck — every rig light there is now at 0,
 * so the only thing lighting a craft from below is this prop. So the lights below are not scene
 * decoration: they are the thing being authored. Tune them here against a real ship, then paste the
 * numbers into the deck.
 */

/** One spinning piece of the pad. */
export interface PadSpinTuning {
  /**
   * Which parts spin, named by MATERIAL. Empty string spins nothing.
   *
   * By material rather than by mesh index for two reasons. First, a mesh index depends on the glb's
   * traverse order, which a re-export can change without warning — the material names are authored
   * and stable. Second, and the reason this changed: some pieces of this pad are SEVERAL meshes
   * sharing one material. The two lit panels are `Object_13` and `Object_17`, both
   * `c_sd_Meatcleaver_on`, and they have to turn together — an index could only ever grab one of
   * them.
   *
   * The trade is that two meshes sharing a material can't be spun separately. On this model that is
   * exactly the behaviour you want; if it ever isn't, this becomes a list of indices.
   */
  material: string;
  /** Degrees per second. NEGATIVE REVERSES — that is how you counter-rotate two parts. */
  speed: number;
  /**
   * Local axis: 0 = X, 1 = Y, 2 = Z.
   *
   * Z is usually the one you want here. The model is authored standing upright and is laid flat by
   * `padRotX: -90`, so the axis running through the pad's face — the one a ring turns about — is its
   * LOCAL Z, not the world's Y. Spinning on Y would tumble it end over end.
   */
  axis: number;
}

/** One light the pad casts. Positions are in pad-local units, so they follow the pad if it moves. */
export interface PadLightTuning {
  enabled: boolean;
  color: string;
  intensity: number;
  x: number;
  y: number;
  z: number;
  /** 0 = no falloff limit. Beyond this distance the light contributes nothing. */
  distance: number;
  /** Physical falloff exponent. 2 is inverse-square (realistic); lower reaches further and flatter. */
  decay: number;
  /** Draw a small marker at the light's position, so you can see where it actually is. */
  showHelper: boolean;
}

export interface PadLabTuning {
  // ── The glow — the pad IS the light ──
  /** Master emissive on every material in PAD_GLOW_MATERIALS, scaled by that table's per-material weight. */
  glowIntensity: number;
  /**
   * Take the glow colour from the craft on the pad instead of `glowColor`.
   *
   * On by default because this is the thing being authored: each ship gets a pad tinted to it, so
   * switching craft in the panel should show you that craft's pad rather than the last one's.
   */
  glowColorFollowsShip: boolean;
  /** Used when `glowColorFollowsShip` is off. */
  glowColor: string;
  /**
   * How much of an emissive TEXTURE's own colour survives, for the glow materials that have one.
   *
   * This exists because of a real trap. three computes emissive as `emissive × emissiveMap`, so on a
   * material with a map the colour you set can only ever MULTIPLY what is painted there — it can
   * darken channels, it cannot remove a hue. Two of this pad's parts (`Object_13` / `Object_17`,
   * both `c_sd_Meatcleaver_on`) ship an ORANGE emissive map, so tinting them red gave orange-red
   * while the map-less rings went pure red. The pad could never be one colour.
   *
   * At 0 the map is used for its LUMINANCE only — it keeps the streaks and the shape, and the glow
   * colour decides the hue, so every lit surface matches and the per-craft tint actually works.
   * At 1 it behaves as three normally would, with the texture's authored colours.
   */
  glowMapHue: number;
  /** One glow colour per craft, in DECK_SERVICES order. */
  shipGlowColors: string[];
  /**
   * The cast light takes the glow's colour.
   *
   * This is the coupling that makes the pad a real light source rather than a prop with a lamp next
   * to it: tint the rings and the hull above them is tinted by the same colour, automatically.
   */
  lightFollowsGlow: boolean;

  // ── Bloom ──
  // The lab canvas is OPAQUE, so a normal EffectComposer is fine here — unlike the hero sun, whose
  // transparent canvas needed the hand-rolled additive pass in `sunBloom.ts`.
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;

  // ── The pad ──
  padScale: number;
  padX: number;
  padY: number;
  padZ: number;
  /** DEGREES. The model ships standing vertically — `padRotX: -90` lays it flat as a pad. */
  padRotX: number;
  padRotY: number;
  padRotZ: number;

  // ── Spin ──
  /**
   * Independent spinners, so separate pieces can turn at different rates — or the same rate in
   * OPPOSITE directions, which is the counter-rotation that makes a ring assembly read as machinery
   * rather than as one turntable. Add entries freely; each targets one part.
   */
  spins: PadSpinTuning[];

  // ── The light the pad throws ──
  lights: PadLightTuning[];

  // ── Environment ──
  /** Deliberately near-zero by default: the pad has to earn the lighting, not the rig. */
  ambientIntensity: number;
  ambientColor: string;
  envIntensity: number;
  exposure: number;
  backgroundColor: string;
  /** A dark ground plane, so you can see the pad's light pooling around it. */
  showGround: boolean;
  groundColor: string;

  // ── The test craft ──
  // Not part of the pad. It exists so the light can be judged against the thing it has to light.
  showShip: boolean;
  /** Index into DECK_SERVICES. */
  shipIndex: number;
  /** Height above the pad's origin. */
  shipY: number;
  shipScale: number;
  shipRotY: number;
  /** Strip the ship to a neutral grey, so its own baked colours don't disguise the pad's light. */
  shipNeutral: boolean;
}

const padLight = (
  overrides: Partial<PadLightTuning> = {},
): PadLightTuning => ({
  enabled: true,
  color: '#ffb060',
  intensity: 12,
  x: 0,
  y: 0.6,
  z: 0,
  distance: 14,
  decay: 2,
  showHelper: false,
  ...overrides,
});

const PAD_LAB_TUNING: PadLabTuning = {
  // Well above 1: these have to clear the bloom threshold to read as light rather than as a bright
  // paint colour. The rings in the reference are blown out at their core, which is what selling them
  // as a light source depends on.
  glowIntensity: 5.6,
  glowColorFollowsShip: true,
  glowColor: '#ff2233',
  // 0 — the maps become masks and the whole pad takes one colour. Raise it if you want the orange
  // detailing in those two panels back.
  glowMapHue: 0,
  // Seeded from each craft's own accent in `deckServices`, brightened to emissive levels — a dark
  // accent like the Web hull's #a01824 is a hull colour, not a glow. Craft 01 lands on the reference's
  // red, which is where this look was designed.
  shipGlowColors: ['#ff2233', '#9fd4ff', '#ffb24d', '#36e6ff'],
  lightFollowsGlow: true,

  // Very low, and that is not a mistake: the emissive materials are already blown out on their own,
  // so the bloom here is a fine halo that sells them as light rather than the glow itself. Pushing
  // strength up washes the pad into a single red smear and loses the ring detail entirely.
  bloomEnabled: true,
  bloomStrength: 0.03,
  bloomRadius: 0.04,
  bloomThreshold: 0.69,

  padScale: 1.04,
  padX: 0.04,
  padY: 0.27,
  padZ: 0,
  // The model stands vertically as exported (its bbox is 45 × 366 × 366), so it needs laying down
  // before it reads as something a ship lands on. +90 rather than −90: both lay it flat, but only
  // this one puts its lit face upward, toward the craft.
  padRotX: 90,
  padRotY: 0,
  padRotZ: 0,

  // Two, counter-rotating on the pad's local Z: the lit panels one way, the central hub the other.
  //
  // Every node in this model sits at translation [0,0,0] with the offset baked into its geometry, so
  // a Z rotation carries a part AROUND the pad's centre rather than spinning it on the spot. That is
  // why these read as machinery turning rather than as pieces twisting in place.
  spins: [
    { material: 'c_sd_Meatcleaver_on', speed: 12, axis: 2 },
    { material: 'Object01Mtl', speed: -18, axis: 2 },
  ],

  // One live light, sitting slightly forward and just above the pad's face. The second is kept but
  // switched off — the pad's own emissive surfaces carry most of the read, and two point lights
  // flattened the hull's underside rather than shaping it.
  //
  // Both take the glow's colour at runtime (`lightFollowsGlow`), so the colours stored here are only
  // the fallback for when that is switched off.
  lights: [
    padLight({ enabled: false }),
    padLight({ color: '#4fd8e8', intensity: 6, y: 0.25, z: 1.6, distance: 10 }),
  ],

  // ── These three mirror the deck's stage, so this lab is a PREVIEW and not just a nice render ──
  // The deck lights a craft with nothing but the pad: every rig multiplier and its ambient are 0,
  // and its exposure is 1. Any of these sitting higher here flatters the pad with light it will not
  // have on the site, and the glow gets tuned too dim as a result.
  ambientIntensity: 0,
  ambientColor: '#ffffff',
  // 1, not the 0.15 this was authored at. The pad's environment response moved onto the materials
  // themselves (`PAD_ENV_INTENSITY`) so the deck could match the lab without darkening its ships —
  // leaving this at 0.15 too would multiply the two and light the pad at 0.0225. This is now a
  // neutral global multiplier over the authored value, and 1 is what the deck runs.
  envIntensity: 1,
  exposure: 1,
  backgroundColor: '#050505',
  showGround: true,
  groundColor: '#0a0a0c',

  showShip: true,
  shipIndex: 0,
  shipY: 1.6,
  shipScale: 1,
  shipRotY: -37,
  shipNeutral: false,
};

const PAD_LAB_DEFAULTS = snapshotDefaults(PAD_LAB_TUNING);

/**
 * Put every value back the way it shipped. Restored IN PLACE — the scene holds this object (and the
 * lights array inside it) by reference, so handing back a fresh one would leave it driving the old
 * copy. See lib/tunerReset.
 */
export function resetPadLabTuning(): void {
  restoreInPlace(PAD_LAB_TUNING, PAD_LAB_DEFAULTS);
}

/** Read-only view, for the scene. */
export function getPadLabTuning(): Readonly<PadLabTuning> {
  return PAD_LAB_TUNING;
}

/** The same object, writable — for the panel and nothing else. */
export function getWritablePadLabTuning(): PadLabTuning {
  return PAD_LAB_TUNING;
}
