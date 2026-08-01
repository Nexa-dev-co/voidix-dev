import * as THREE from 'three';
import type { ChamberTuning } from '@/lib/chamberTuning';

/**
 * How a surface in the chamber comes on — shared by the floor and the walls.
 *
 * The room lights as ONE event: a wavefront spreading out from the display, each cell of every surface
 * striking on its own as the front reaches it. The floor and the walls are two meshes with two shaders,
 * but they must agree perfectly about when any given point lights, or the sweep visibly splits at the
 * floor line — the one place the two surfaces meet, and the one place a viewer is guaranteed to look.
 *
 * So the maths lives here, once, as a GLSL chunk both shaders include and a uniform block both share.
 * Two copies of this that "should" stay identical is exactly the thing that rots.
 */

/** The uniform declarations. Paste at the top of any surface fragment shader. */
export const SURFACE_LIGHTING_UNIFORMS = /* glsl */ `
  uniform vec3  uColor;          // the surface before its cell has struck — the dark room
  uniform vec3  uColorLit;       // …and after
  uniform float uPower;          // 0 = dark, 1 = fully lit. Driven by the reveal's progress.
  uniform vec3  uIgniteOrigin;   // where the wavefront starts — the display you just backed out of
  uniform float uIgniteRadius;   // world distance the front has covered at full power
  uniform float uIgniteJitter;   // how far out of order a cell may fire
  uniform float uIgniteSoftness; // how gradually one cell comes up
  uniform float uSurge;          // the over-bright flare at the moment a cell strikes
`;

/**
 * The functions. Include after {@link SURFACE_LIGHTING_UNIFORMS}.
 *
 * `surfaceIgnition` returns the cell's steady lit amount in `.x` and its momentary strike flare in `.y`.
 * Distance is measured HORIZONTALLY (xz only) on purpose: the wavefront travels across the room's floor
 * plan, so a point high on a wall lights at the same time as the floor directly beneath it, and the
 * light climbs the walls as the front passes rather than racing ahead up them.
 */
export const SURFACE_LIGHTING_FUNCTIONS = /* glsl */ `
  // A stable per-cell value. Same cell, same number, every frame — so a panel's moment of ignition
  // belongs to it and doesn't crawl as the camera moves.
  float cellHash(vec2 cell) {
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Given the moment a patch of surface strikes, how lit it is now and how hard it's flaring.
  vec2 ignitionAtMoment(float moment) {
    // The latest possible moment is the far edge of the sweep, plus a full jitter, plus the time that
    // patch then takes to come up. Power has to run past that or the last of it is left half-lit at full
    // power — so the incoming 0..1 is stretched to cover the whole schedule. Both the jittered and the
    // smooth variants below use this same stretch, which is what keeps every surface on ONE clock.
    float power = uPower * (1.0 + uIgniteJitter + uIgniteSoftness);

    float lit = smoothstep(moment, moment + uIgniteSoftness, power);

    // The strike itself. A tube doesn't fade up, it flashes past its resting brightness and settles — so
    // a narrow bump centred on the moment rides on top of the steady state. This is the detail that
    // sells it as switching on rather than as a cross-fade.
    float sinceStrike = (power - moment) / max(uIgniteSoftness, 0.001);
    float surge = exp(-sinceStrike * sinceStrike * 4.0) * uSurge;

    return vec2(lit, surge);
  }

  // For a surface with CELLS. The distance term makes it read as a wavefront spreading from the display;
  // the per-cell offset stops that front being a clean expanding circle, which would read as a graphic
  // rather than as lighting. Cells near the front fire slightly out of turn, exactly like real strip
  // lighting striking down a corridor.
  vec2 surfaceIgnition(vec2 cell, vec3 worldPosition) {
    float distanceFromOrigin = length(worldPosition.xz - uIgniteOrigin.xz);
    return ignitionAtMoment(
      distanceFromOrigin / max(uIgniteRadius, 0.001) + cellHash(cell) * uIgniteJitter
    );
  }

  // For a surface with NO cells. The per-cell jitter needs cells to hide its edges in — apply it to a
  // smooth white wall and the wall lights in visible blotches, because there is no grid line for a
  // patch boundary to fall on. So an unbroken surface gets the clean wavefront instead.
  vec2 surfaceIgnitionSmooth(vec3 worldPosition) {
    float distanceFromOrigin = length(worldPosition.xz - uIgniteOrigin.xz);
    return ignitionAtMoment(distanceFromOrigin / max(uIgniteRadius, 0.001));
  }
`;

export interface SurfaceLightingUniforms {
  uColor: { value: THREE.Color };
  uColorLit: { value: THREE.Color };
  uPower: { value: number };
  uIgniteOrigin: { value: THREE.Vector3 };
  uIgniteRadius: { value: number };
  uIgniteJitter: { value: number };
  uIgniteSoftness: { value: number };
  uSurge: { value: number };
}

export function createSurfaceLightingUniforms(): SurfaceLightingUniforms {
  return {
    // ⚠ Placeholders only — `applySurfaceLighting` overwrites both on the first frame from the tuning.
    // They used to be the old brand cyan, which was harmless but a trap: anyone rendering a new surface
    // before wiring it up would have got a teal room and no clue where the colour came from. These are
    // the shipped values, so an unwired surface at least looks like the room it belongs to.
    uColor: { value: new THREE.Color('#0a0908') },
    uColorLit: { value: new THREE.Color('#efece3') },
    uPower: { value: 0 },
    uIgniteOrigin: { value: new THREE.Vector3() },
    uIgniteRadius: { value: 18 },
    uIgniteJitter: { value: 0.35 },
    uIgniteSoftness: { value: 0.18 },
    uSurge: { value: 1.6 },
  };
}

/**
 * Push the tuning onto one surface's lighting uniforms.
 *
 * `progress` is the reveal's RAW progress, not the eased pull-back: this is the room's own state rather
 * than part of the camera move, and easing it would make the sweep lurch whenever the camera did. Being
 * a pure function of progress also means it reverses for free — scroll back out and the room goes dark
 * again, cell by cell, in the order it lit.
 */
export function applySurfaceLighting(
  uniforms: SurfaceLightingUniforms,
  tuning: Readonly<ChamberTuning>,
  igniteOrigin: THREE.Vector3,
  progress: number,
): void {
  uniforms.uColor.value.set(tuning.groundColor);
  uniforms.uColorLit.value.set(tuning.groundColorLit);
  uniforms.uIgniteOrigin.value.copy(igniteOrigin);
  uniforms.uIgniteRadius.value = tuning.groundIgniteRadius;
  uniforms.uIgniteJitter.value = tuning.groundIgniteJitter;
  uniforms.uIgniteSoftness.value = tuning.groundIgniteSoftness;
  uniforms.uSurge.value = tuning.groundSurge;
  uniforms.uPower.value = THREE.MathUtils.clamp(
    (progress - tuning.groundPowerStart) /
      Math.max(tuning.groundPowerEnd - tuning.groundPowerStart, 0.001),
    0,
    1,
  );
}
