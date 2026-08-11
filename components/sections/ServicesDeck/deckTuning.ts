/**
 * The services deck's stage — where the camera stands and how the rig is lit.
 *
 * ── What lives here, and what deliberately doesn't ───────────────────────────────────────────────
 * This file owns the STAGE. It does not own the vessel's colour: each wave's accent lives in its
 * service's `profile` in deckServices.ts, which is the source of truth for it. Copying them here would
 * create two places to change a colour and one of them would rot.
 *
 * Nor does it own where the parts are. The nine clusters are placed by vesselParts.ts (where each one
 * WAITS, as a fraction of the live frame) and by the sockets baked into vessel.glb (where each one
 * BELONGS). Neither is a fixed world offset, so neither could sit in a table here.
 *
 * ⚠ `ships: ShipPlacement[]` and its `hiddenParts` culling are gone with the fleet (2026-08-11). Their
 * header explained that meshes had to be addressed by positional id because "the vessels are
 * third-party glbs whose mesh names are inconsistent, absent, or duplicated". That reasoning expired
 * the moment we started generating the model ourselves — scripts/buildVessel.mjs names every cluster,
 * and the runtime addresses them by name.
 */

export interface DeckTuning {
  // ── The camera ──
  // The deck's resting shot. NOTE: `cameraDistance` / `cameraHeight` are also the pose the
  // services→works flight departs from (lib/handoffFlightPath's first key is (0, 1.7, 8.2)) — move
  // these and the flight's opening frame no longer matches the deck you were just looking at.
  //
  // They are ALSO what deckFrame.ts measures the holding ring against, so moving them moves where
  // every loose part waits. That is correct — the ring is a fraction of what this camera can see.
  cameraFov: number;
  cameraDistance: number;
  cameraHeight: number;
  /** How far down the camera looks — what makes the craft read as landed rather than floating. */
  cameraLookY: number;

  // ── The rig ──
  // Multipliers over the base intensities in useServicesDeck, so the stage can be brightened as a
  // whole without rewriting the lights themselves.
  keyMultiplier: number;
  fillMultiplier: number;
  rimMultiplier: number;
  ambientIntensity: number;
  exposure: number;

  // ── Reflection + glow on the hull ──
  /** Hull brightness for a part still adrift (cold), and for one locked into the machine (full). */
  dormantBrightness: number;
  activeBrightness: number;
  /** The engine-glow breathing: how far it swings, and how fast. */
  emitPulseAmplitude: number;
  emitPulseSpeed: number;

  // ── The stage around it ──
  /** The starfield wrapping the deck. */
  starOpacity: number;
}

const DECK_TUNING: DeckTuning = {
  cameraFov: 34,
  cameraDistance: 8.2,
  cameraHeight: 1.7,
  cameraLookY: 0.75,

  // Key and fill stay OFF, on purpose (tuned 2026-07-28). The deck is not lit by a studio rig — the
  // cracked sun behind it is the only light in the scene, exactly as the chamber is lit only by its own
  // screen. Turning either of these up washes that out instantly.
  //
  // ⚠ THE RIM IS NOW ON, and it is not a retreat from that doctrine — it is the first honest
  // implementation of it. The doctrine says "the sun behind it is the only light", but the sun is a DOM
  // layer behind the canvas and casts no actual light, so until 2026-08-11 the sentence described an
  // intention rather than a rig, and the vessel had NOTHING lighting it but an environment map.
  //
  // That was survivable for the old fleet's mid-tone hulls. It is not survivable for this one: the
  // vessel's albedo is ~97% pure black with thin amber trim and carries no shading of its own (see
  // hullMaterial.ts), so with every light at zero the ship was a silhouette-shaped hole with some
  // glowing lines in it. The rim light is placed BEHIND and ABOVE, in the sun's own `--heat-600`, which
  // is where the sun actually is — so what it draws is the edge the sun would draw.
  //
  // ⚠ Two POINT lights left the scene with the portal gates (2026-08-11). Nothing at rest got darker —
  // the gates only ever lit during a swap — but it is a three.js program-cache-key change, because the
  // key includes the COUNT of lights. Safe here only because the count is now a constant decided at
  // build rather than something that toggles at runtime; the deck's warm-up diagnostic ("added NONE")
  // is the check that it stayed that way.
  keyMultiplier: 0,
  fillMultiplier: 0,
  rimMultiplier: 1,
  ambientIntensity: 0,
  exposure: 1,

  // A loose part is cold metal at the edge of frame; a locked one is part of a live machine. The gap
  // between these two is most of what makes the assembly read as powering up rather than as tidying up.
  dormantBrightness: 0.55,
  activeBrightness: 1.3,
  // ⚠ Shallow (was 0.35). This breathes the CIRCUITRY now, not a whole hull's accent, and at 0.35 a
  // freshly-locked part crossed the bloom threshold on every up-beat and fell back under on every
  // down-beat — a line that flickers in and out of bloom reads as a bug, not as a pulse.
  emitPulseAmplitude: 0.12,
  emitPulseSpeed: 2.9,

  // Pulled well down so the sun stays the brightest thing on the deck.
  starOpacity: 0.34,
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
