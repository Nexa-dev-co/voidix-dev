/**
 * The heat ramp, for WebGL.
 *
 * `app/globals.css` owns `--heat-000 … --heat-950` and CLAUDE.md owns the rule they follow: it is a
 * TEMPERATURE scale, not a tint scale — the hue rotates 11° → 46° as luminance climbs, because that is
 * what hot matter does. Luminance is strictly monotonic and several consumers were graded against a
 * stop's value rather than its hue, so keep it that way.
 *
 * ⚠ Mirrored by hand, exactly as `lib/coolPalette.ts` is for the cool axis, and for the same blunt
 * reason: a `THREE.Color` cannot read a CSS custom property. Keep the two in step. The payoff is that
 * retuning `--heat-600` still moves the star — the anchor stays one number even though it is written
 * twice.
 *
 * ⚠ The bottom half is NOT for type (`--heat-400` and below fail 4.5:1 even on the page black). That
 * rule is about the DOM. Here the low stops are exactly what they say they are — the colour of matter
 * that is barely glowing — and the plasma's shadowed troughs live down there.
 */

/** `--heat-000` · ember-black. Unlit metal; the plasma's coldest trough. */
export const HEAT_000 = 0x1a0d05;
/** `--heat-100` · char. */
export const HEAT_100 = 0x3d1503;
/** `--heat-200` · the throat of things. */
export const HEAT_200 = 0x6b1a04;
/** `--heat-300` · deep molten. */
export const HEAT_300 = 0xa82600;
/** `--heat-400` · the spiral, cold dust. */
export const HEAT_400 = 0xd92a05;
/** `--heat-500` · the room's fittings. */
export const HEAT_500 = 0xff7b00;
/** `--heat-600` · ⭐ THE ANCHOR — the sun's own light. Everything amber on this site resolves here. */
export const HEAT_600 = 0xff8a1a;
/** `--heat-700` · lamp bodies. */
export const HEAT_700 = 0xffa200;
/** `--heat-800` · brushed warm metal. */
export const HEAT_800 = 0xffb24d;
/** `--heat-900` · pale hot core. */
export const HEAT_900 = 0xffcd8c;
/** `--heat-950` · white-hot compression. Already the value `COLLAPSE_CORE_LIGHT_COLOR` uses. */
export const HEAT_950 = 0xffe6c8;

/** A stop as a `vec3` literal for GLSL, linear-ish sRGB values in 0..1. */
export function heatToVec3(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}
