import { DECK_SERVICES } from './deckServices';
import { snapshotDefaults, restoreInPlace } from '@/lib/tunerReset';

/**
 * The services deck's stage — where the camera stands, how the rig is lit, how the pad sits, and how
 * each vessel is placed on it.
 *
 * ── What lives here, and what deliberately doesn't ───────────────────────────────────────────────
 * This file owns the STAGE. It does not own the ships' colour: each vessel's `profile` (the graded
 * palette) and its `light` override already live in deckServices.ts, which is the documented source of
 * truth for them and where the `?tune` panel has always baked them back to. Copying them here would
 * create two places to change a hull colour and one of them would rot.
 *
 * So the panel writes to two files, and says which is which:
 *   • placement, culling, the rig, the pad  → here
 *   • palette + per-ship light              → deckServices.ts
 *
 * ── Culling ──────────────────────────────────────────────────────────────────────────────────────
 * Every mesh in a model gets a positional id (`<shipIndex>:<meshIndex>`), and anything listed in a
 * ship's `hiddenParts` is switched off when the model loads. Positional rather than by name because
 * the vessels are third-party glbs whose mesh names are inconsistent, absent, or duplicated — an index
 * is the only identifier all of them actually have. It stays stable as long as the model does.
 */

export interface ShipPlacement {
  /** Offset from the pad's centre, applied on top of the model's normalised pose. */
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
  /** Hull brightness as a craft leaves the pad (dim), and while it's centred (full). */
  dormantBrightness: number;
  activeBrightness: number;
  /** The engine-glow breathing on the centred craft: how far it swings, and how fast. */
  emitPulseAmplitude: number;
  emitPulseSpeed: number;

  // ── The stage around it ──
  /** The soft contact shadow under the centred craft. */
  shadowOpacity: number;
  /** The starfield wrapping the deck. */
  starOpacity: number;

  // ── The pad ──
  // Authored in /pad-lab against a real craft; these are its numbers. The pad is not scenery here —
  // with every rig light at 0 it is the ONLY thing lighting a hull from underneath.
  showPad: boolean;
  /** The pad is normalised to this width in world units, so its framing is model-independent. */
  padWidth: number;
  padScale: number;
  padX: number;
  padY: number;
  padZ: number;
  /** DEGREES. `padRotX: 90` lays the model flat with its lit face upward — it is authored standing. */
  padRotX: number;
  padRotY: number;
  padRotZ: number;

  // ── The glow (see PAD_GLOW_MATERIALS) ──
  /** Master emissive on the pad's light-emitting materials, scaled by each one's weight. */
  glowIntensity: number;
  /**
   * How much of an emissive TEXTURE's own colour survives. 0 = the map is a mask and the craft's
   * `padGlow` owns the hue; 1 = the texture's authored colours. Two of the pad's panels ship an
   * ORANGE emissive map, so anything above 0 stops them matching the rest of the pad.
   */
  glowMapHue: number;
  /** Seconds the pad takes to cross-fade from one craft's colour to the next. */
  glowTransitionSeconds: number;

  // ── The light the pad casts up into the hull ──
  padLightEnabled: boolean;
  padLightIntensity: number;
  padLightX: number;
  padLightY: number;
  padLightZ: number;
  padLightDistance: number;
  padLightDecay: number;

  // ── Spin ──
  /** Which parts turn, by MATERIAL name (several meshes can share one). Empty spins nothing. */
  spinMaterial: string;
  /** Degrees per second; negative reverses. */
  spinSpeed: number;
  /** Local axis: 0 = X, 1 = Y, 2 = Z. Z is the pad's face. */
  spinAxis: number;

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
  // when it leaves the pad — there is no key light for it to fall out of), and the engine glow
  // breathes harder and faster to compensate.
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

  // Both pulled well down so the sun stays the brightest thing on the deck.
  shadowOpacity: 0.23,
  starOpacity: 0.34,

  showPad: true,
  padWidth: 5.0,
  padScale: 1.04,
  padX: 0.04,
  padY: 0.03,
  padZ: 0,
  padRotX: 90,
  padRotY: 0,
  padRotZ: 0,

  glowIntensity: 5.6,
  glowMapHue: 0,
  // Long enough to read as the pad re-tuning itself to the new craft rather than as a hard cut, and
  // short enough to have finished by the time the incoming ship settles (the swap runs ~1.2s).
  glowTransitionSeconds: 0.9,

  padLightEnabled: true,
  padLightIntensity: 6,
  padLightX: 0,
  padLightY: 0.25,
  padLightZ: 1.6,
  padLightDistance: 10,
  padLightDecay: 2,

  // Only the central hub turns. The lit-panel spinner authored in the lab is deliberately not
  // carried over — one moving element under a craft reads as machinery; two competing rotations
  // under a hovering ship read as busy.
  spinMaterial: 'Object01Mtl',
  spinSpeed: -18,
  spinAxis: 2,

  // One per vessel, so adding a fifth ship to DECK_SERVICES can't leave the tuning short.
  ships: DECK_SERVICES.map(restingShip),
};

// The shipped values, captured before the ?tune panel can touch them.
const DECK_DEFAULTS = snapshotDefaults(DECK_TUNING);

/**
 * Put every value back the way it shipped.
 *
 * Restored IN PLACE — the scene holds this object (and the arrays inside it) by reference, so handing
 * back a fresh one would leave it driving the old copy. See lib/tunerReset.
 */
export function resetDeckTuning(): void {
  restoreInPlace(DECK_TUNING, DECK_DEFAULTS);
}

/** The deck's fixed numbers. Read by the scene; never mutated in the app path. */
export function getDeckTuning(): Readonly<DeckTuning> {
  return DECK_TUNING;
}

/** The same object, writable — for the `?tune` panel and nothing else. */
export function getWritableDeckTuning(): DeckTuning {
  return DECK_TUNING;
}
