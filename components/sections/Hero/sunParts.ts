/**
 * Which parts of `fractured_sun.glb` this site actually draws.
 *
 * ── ⚠ WHY THIS IS A SHARED MODULE AND NOT A CONSTANT IN ONE FILE ─────────────────────────────────
 * There are TWO stars built from this model — the hero sun (`SunModelCanvas`) and the one that dies at
 * contact (`Contact/singularityScene`) — and CLAUDE.md already records that they must not drift:
 * *"the star you leave at works and the star you come back to at contact."* Until now that rule was
 * enforced by a comment, and the two files each walked the model with their own copy of the material
 * names.
 *
 * The moment the hero star stopped drawing three of the model's five materials, a copied list would
 * have meant the star at contact still had its flares, its blowout planes and eleven translucent
 * shells — the same object, visibly rebuilt, at the one moment the site asks you to recognise it.
 * So the list lives here and both read it.
 */

/** The material names in `fractured_sun.glb` that anything may choose to omit. */
export type SunPartMaterial = 'flare' | 'blowout' | 'sunouter';

/**
 * Parts of the star that do not ship. Decided 2026-08-08 from a per-group ablation measured on two
 * machines — hiding `flare` and `blowout` took `sun · bloom` from 2.00 to 0.87 ms per call on a
 * desktop (a 57 % cut) and 17.5 to 7.4 ms on the reference laptop.
 *
 * ── ⚠ `sunouter` CAME BACK on 2026-08-12, and the procedural plasma went with it ──────────────────
 * It had been omitted because `sunPlasma.ts` replaced it: one animated surface instead of eleven
 * blended meshes drawn twice a frame. That trade was sound on frame time and wrong on identity — the
 * shells carry `sunouter_baseColor`, the largest map in the file and the star's ACTUAL SKIN, and the
 * plasma painted over it with something the model never had. The brief asks for the model's own
 * surface, so the shells are the star again and `sunPlasma.ts` is deleted (recoverable from git; it
 * was itself recovered from the `enhancement` branch once already).
 *
 * ⚠ The frame time the plasma existed to save is NOT bought back. `SUN_ABLATION_KEEP_SHELLS` was set
 * to 4 for one day on the theory that the shells stack and saturate; they do not — ten of the eleven
 * are per-shard skins, so a partial keep leaves bare shards rather than a thinner atmosphere. See that
 * constant. All eleven cost ~5.8 ms of `sun · bloom` on the reference laptop, and that is the honest
 * price of the model's own surface.
 *
 * ⚠ EMPTYING THIS ENTIRELY IS STILL NOT A COMPLETE REVERT — `flare` and `blowout` took two other
 * things with them, and both would have to move back:
 *
 *   `SUN_FRAMING_NUDGE_X`   0.05 → 0   it corrected for the asymmetry `flare` and `blowout` caused
 *   the hero's centring       now reads the drawn geometry, not the full bounding box
 */
export const SUN_OMITTED_PARTS: readonly SunPartMaterial[] = ['flare', 'blowout'];

/** True when this material's meshes should not be drawn. Safe on any string. */
export function isOmittedSunPart(materialName: string): boolean {
  return SUN_OMITTED_PARTS.includes(materialName as SunPartMaterial);
}
