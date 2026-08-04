/**
 * The cool axis — the thing the site's amber is HOT against.
 *
 * Amber only reads as heat if something in frame is cold, and every scene already knew this: the
 * sun, the fleet, the works field, the meteors, the mark and the chamber each set up a cool key or
 * a cool substrate. What none of them had was a shared value, so each one picked its own blue.
 * There were eight, and three of them (0x9aa7bb, 0x9fb6d4, #aab2bd) were the same colour under
 * different names in different files. `0x2a3550` had gone the other way — SunModelCanvas and
 * useWorksField had independently arrived at the same literal with no link between them.
 *
 * These four are the survivors, sampled from what was already on screen so the consolidation is
 * imperceptible rather than a re-grade.
 *
 * ⚠ THE RULE: this axis is LIGHTING AND SUBSTRATE ONLY. It never carries brand, type or UI — that
 * is the heat ramp's job, and mixing the two is how a site ends up with two accents. If you want a
 * cool thing to be *important*, light it with the ramp; don't promote a slate.
 *
 * Mirrored as `--slate-*` in `app/globals.css` for the DOM side. Keep the two in step: these are
 * numbers because Three.js colours cannot read a CSS custom property.
 */

/** Void debris and rock albedo — the coldest substrate, barely above the page black. */
export const SLATE_200 = 0x1e2732;

/**
 * The fill light, everywhere. Every scene on the site that has a key/fill pair uses this as the
 * fill, which is what makes the sun, the fleet and the works field feel lit by one sky.
 */
export const SLATE_400 = 0x2a3550;

/** Cool keys and stone highlights — the lit face of anything that is not the subject. */
export const SLATE_600 = 0xa2aec2;

/**
 * The coldest KEY. Reserved for the two places that need light to read as unmistakably not-warm:
 * the works field's key (which is what makes the mark's amber geode read as heat rather than as
 * paint) and the chamber's screen light.
 */
export const SLATE_800 = 0xdfe7ff;
