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
  showPad: boolean;
  padWidth: number;
  padY: number;
  padColor: string;
  padEmissiveColor: string;
  padEmissiveIntensity: number;
  /** Mesh ids switched off at load — `pad:<meshIndex>`. */
  padHiddenParts: string[];

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

  keyMultiplier: 1,
  fillMultiplier: 1,
  rimMultiplier: 1,
  ambientIntensity: 0.16,
  exposure: 1.18,

  litEmissiveIntensity: 1.3,
  dormantBrightness: 0.4,
  activeBrightness: 1.0,
  emitPulseAmplitude: 0.22,
  emitPulseSpeed: 1.6,

  shadowOpacity: 0.5,
  starOpacity: 0.85,

  showPad: true,
  padWidth: 5.0,
  padY: 0.6,
  padColor: '#16222b',
  padEmissiveColor: '#0b3a45',
  padEmissiveIntensity: 0.55,
  padHiddenParts: [],

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
