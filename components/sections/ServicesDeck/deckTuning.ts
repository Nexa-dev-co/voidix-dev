import { DECK_SERVICES } from './deckServices';

/**
 * The services deck's stage — where the camera stands, how the rig is lit, and how
 * each vessel is placed on it.
 *
 * ── What lives here, and what deliberately doesn't ───────────────────────────────────────────────
 * This file owns the STAGE. It does not own the ships' colour: each vessel's `profile` (the graded
 * palette) and its `light` override already live in deckServices.ts, which is the source of truth for
 * them. Copying them here would create two places to change a hull colour and one of them would rot.
 *
 * So the fleet's numbers are split across two files:
 *   • placement, culling, the rig          → here
 *   • palette + per-ship light              → deckServices.ts
 *
 * ── Culling ──────────────────────────────────────────────────────────────────────────────────────
 * Every mesh in a model gets a positional id (`<shipIndex>:<meshIndex>`), and anything listed in a
 * ship's `hiddenParts` is switched off when the model loads. Positional rather than by name because
 * the vessels are third-party glbs whose mesh names are inconsistent, absent, or duplicated — an index
 * is the only identifier all of them actually have. It stays stable as long as the model does.
 */

export interface ShipPlacement {
  /** Offset from centre stage, applied on top of the model's normalised pose. */
  x: number;
  y: number;
  z: number;
  /** DEGREES, layered on the per-ship `modelRotation` baked into deckServices. */
  rotX: number;
  rotY: number;
  rotZ: number;
  /** Multiplies the normalisation that fits every hull to the same size. */
  scale: number;
  /** Mesh ids switched off at load — `<shipIndex>:<meshIndex>`. */
  hiddenParts: string[];
}

export interface DeckTuning {
  // ── The camera ──
  // The deck's resting shot. NOTE: `cameraDistance` / `cameraHeight` are also the pose the
  // services→works flight departs from (lib/handoffFlightPath's first key is (0, 1.7, 8.2)) — move
  // these and the flight's opening frame no longer matches the deck you were just looking at.
  cameraFov: number;
  cameraDistance: number;
  cameraHeight: number;
  /** How far down the camera looks — what makes the craft read as landed rather than floating. */
  cameraLookY: number;

  // ── The rig ──
  // Colours AND per-ship intensities live in deckServices (`light`), because the key is retinted for
  // each craft. These are MULTIPLIERS over whatever that resolves to — 1 leaves a ship exactly as
  // authored, so the stage can be brightened as a whole without flattening the per-ship differences.
  // (They have to be multipliers: writing an absolute intensity here every frame would overwrite the
  // per-ship tween and every craft would end up lit identically.)
  keyMultiplier: number;
  fillMultiplier: number;
  rimMultiplier: number;
  /** Absolute — the ambient is shared and has no per-ship override to scale. */
  ambientIntensity: number;
  exposure: number;

  // ── Reflection + glow on the hull ──
  // Per-ship reflectivity (metalness / roughness / clearcoat / iridescence / envIntensity) belongs to
  // each `profile` in deckServices. What lives here is the part that is the same for every craft.
  /** How hard a centred craft's own emissive maps burn — its lit windows and engine bells. */
  litEmissiveIntensity: number;
  /** Hull brightness as a craft leaves the stage (dim), and while it's centred (full). */
  dormantBrightness: number;
  activeBrightness: number;
  /** The engine-glow breathing on the centred craft: how far it swings, and how fast. */
  emitPulseAmplitude: number;
  emitPulseSpeed: number;

  // ── The stage around it ──
  /** The starfield wrapping the deck. */
  starOpacity: number;

  /** One entry per vessel, in DECK_SERVICES order. */
  ships: ShipPlacement[];
}

const restingShip = (): ShipPlacement => ({
  x: 0,
  y: 0,
  z: 0,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  scale: 1,
  hiddenParts: [],
});

const DECK_TUNING: DeckTuning = {
  cameraFov: 34,
  cameraDistance: 8.2,
  cameraHeight: 1.7,
  cameraLookY: 0.75,

  // Every stage light is OFF, on purpose (tuned 2026-07-28). The deck is no longer lit by a rig —
  // the cracked sun behind it is the only light in the scene, exactly as the chamber is lit only by
  // its own screen. Turning any of these back up washes that out instantly.
  //
  // Because nothing external lights the hulls any more, the ships have to carry their own
  // brightness: `dormantBrightness` and `activeBrightness` are both at 1.3 (a craft no longer dims
  // when it leaves the stage — there is no key light for it to fall out of), and the engine glow
  // breathes harder and faster to compensate.
  //
  // The landing pad was removed 2026-07-29 along with the light it cast up into the hulls, so the
  // only things reaching a craft now are the cracked sun behind the deck, the portal gate's own
  // light as it closes on one, and its emissive. Undersides are meant to be dark.
  keyMultiplier: 0,
  fillMultiplier: 0,
  rimMultiplier: 0,
  ambientIntensity: 0,
  exposure: 1,

  litEmissiveIntensity: 1.3,
  dormantBrightness: 1.3,
  activeBrightness: 1.3,
  emitPulseAmplitude: 0.35,
  emitPulseSpeed: 2.9,

  // Pulled well down so the sun stays the brightest thing on the deck.
  starOpacity: 0.34,

  // One per vessel, so adding a fifth ship to DECK_SERVICES can't leave the tuning short.
  ships: DECK_SERVICES.map(restingShip),
};

/**
 * The deck's fixed numbers. Read by the scene; never mutated.
 *
 * The writable handle and the reset that used to sit beside this are gone with the fleet's `?tune`
 * panel — they existed only so that panel could mutate this object in place. These values are now
 * edited here, in the file, like any other constant.
 */
export function getDeckTuning(): Readonly<DeckTuning> {
  return DECK_TUNING;
}
