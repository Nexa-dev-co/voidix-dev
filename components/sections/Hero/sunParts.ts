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
 * `sunouter` — the eleven translucent shells that were the star's atmosphere — is omitted because
 * `sunPlasma.ts` replaces it: one procedural surface instead of eleven blended meshes drawn twice a
 * frame. **It must not be omitted without that plasma present**, or the star is a bare fractured rock.
 *
 * ⚠ EMPTYING THIS IS NOT A COMPLETE REVERT. Three other things moved on the same day because these
 * groups left, and all would have to move back:
 *
 *   `SUN_FRAMING_NUDGE_X`   0.05 → 0   it corrected for the asymmetry `flare` and `blowout` caused
 *   the hero's centring       now reads the drawn geometry, not the full bounding box
 *   `sunPlasma`               now supplies the atmosphere `sunouter` used to
 */
export const SUN_OMITTED_PARTS: readonly SunPartMaterial[] = ['flare', 'blowout', 'sunouter'];

/** True when this material's meshes should not be drawn. Safe on any string. */
export function isOmittedSunPart(materialName: string): boolean {
  return SUN_OMITTED_PARTS.includes(materialName as SunPartMaterial);
}
