import * as THREE from 'three';
import {
  SURFACE_LIGHTING_UNIFORMS,
  SURFACE_LIGHTING_FUNCTIONS,
  createSurfaceLightingUniforms,
  type SurfaceLightingUniforms,
} from './chamberSurfaceLighting';

/**
 * The floor of the room — a single plane carrying a procedural grid that dissolves to nothing.
 *
 * ── Why this isn't a model ───────────────────────────────────────────────────────────────────────
 * Every light in the chamber is at zero (see the light block in chamberTuning: the set is lit entirely
 * by its own emissives and by the display). A modelled floor wearing a standard material under those
 * conditions renders PURE BLACK — there is nothing to light it with. So the floor has to emit its own
 * image, which means a shader, which means it may as well be procedural and cost no download at all.
 *
 * ── How it ends ──────────────────────────────────────────────────────────────────────────────────
 * Two ways, and which one is in play depends on whether the room has walls.
 *  - WITH walls, the floor is CLIPPED at the wall's radius. A floor doesn't continue outside a room,
 *    and — since neither surface writes depth — floor left showing beyond the wall would draw straight
 *    through it.
 *  - WITHOUT them, it dissolves instead: fading the grid out before the geometry ends means the room
 *    has no measurable extent, it simply stops. That is what the darkness alone used to do.
 *
 * ── The one part that is easy to get wrong ───────────────────────────────────────────────────────
 * A naive `fract()` grid shimmers violently the moment the camera moves, because far-away cells fall
 * below one pixel and alias into moiré. This camera moves for the entire reveal, so that would be the
 * first thing anyone noticed. The fix is to measure the line's width in SCREEN space using `fwidth()`
 * — the derivative of the grid coordinate — so a line is always about one pixel wide no matter how far
 * away it is. Distant lines then fade out smoothly instead of tearing.
 */

// The plane is deliberately much larger than the fade radius: the shader is what ends the floor, not
// the geometry, so the mesh only has to be big enough that its edge is always past the fade. Two
// triangles — the size costs nothing but fragments, and the shader is cheap.
const GROUND_EXTENT = 240;

// Where the fade begins, as a fraction of its end radius. The grid holds full strength inside this,
// then falls away — so there's a readable floor around the camera and nothing at the horizon.
const FADE_START_FRACTION = 0.25;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

${SURFACE_LIGHTING_UNIFORMS}

  uniform vec3  uLineColor;   // the grid itself — dark lines ON the surface, not glowing lines in a void
  uniform vec3  uGlowColor;   // the tint pooled under the hologram
  uniform float uOpacity;
  uniform float uCell;        // world units between grid lines
  uniform float uLineWidth;   // in pixels, so it holds at any distance
  uniform float uFade;        // world radius at which the floor has dissolved (walls off)
  uniform float uClipRadius;  // …or the hard edge where it meets the wall (walls on)
  uniform vec3  uGlowCenter;  // the hologram's anchor — the floor tints beneath it
  uniform float uGlowRadius;
  uniform float uGlowStrength;
  uniform float uFadeStartFraction;

  varying vec3 vWorldPosition;

  ${SURFACE_LIGHTING_FUNCTIONS}

  void main() {
    float distanceFromCenter = length(vWorldPosition.xz);
    // A floor stops at the wall. Beyond it there is nothing to draw — and drawing it would show through
    // the wall, since neither surface writes depth.
    if (distanceFromCenter > uClipRadius) discard;

    // 1. The grid. Distance to the nearest line, measured in PIXELS via the screen-space derivative of
    //    the cell coordinate — this is what keeps a line one pixel wide at every depth instead of
    //    aliasing into moiré as it recedes.
    vec2 cellCoord = vWorldPosition.xz / uCell;
    vec2 distanceToLine = abs(fract(cellCoord - 0.5) - 0.5) / fwidth(cellCoord);
    float nearestLine = min(distanceToLine.x, distanceToLine.y);
    float gridStrength = 1.0 - clamp(nearestLine / uLineWidth, 0.0, 1.0);

    // 2. The dissolve, for a room with no walls to stop at.
    float fade = 1.0 - smoothstep(uFade * uFadeStartFraction, uFade, distanceFromCenter);

    // 3. The lights coming on, one cell at a time — the same wavefront the walls ride, so the two
    //    surfaces light together where they meet (see chamberSurfaceLighting.ts).
    vec2 cell = floor(cellCoord);
    vec2 ignition = surfaceIgnition(cell, vWorldPosition);

    // 4. The surface. The strike momentarily WASHES THE LINES OUT — a flash bright enough to lose the
    //    grid in — and they resolve back as it settles. On a pale floor that reads far better than
    //    brightening an already-bright surface, which would do nothing at all.
    float lineAmount = gridStrength * clamp(1.0 - ignition.y, 0.0, 1.0);
    vec3 surface = mix(uColorLit, uLineColor, lineAmount);
    //    Before its cell has struck, this patch of floor is still the dark room.
    surface = mix(uColor, surface, ignition.x);

    // 5. The pool under the hologram, so the panel reads as actually being above a surface rather than
    //    composited over one. A TINT rather than a lift — on a pale floor there is no headroom to
    //    brighten into, so the colour is what carries it. It belongs to the hologram, not to the room's
    //    lighting, so it isn't gated on the power-up.
    float distanceFromGlow = length(vWorldPosition.xz - uGlowCenter.xz);
    float pool = 1.0 - smoothstep(0.0, uGlowRadius, distanceFromGlow);
    pool *= pool; // squared, so the pool has a soft shoulder rather than a linear cone
    surface = mix(surface, uGlowColor, pool * uGlowStrength);

    float alpha = fade * uOpacity;
    if (alpha <= 0.001) discard;

    gl_FragColor = vec4(surface, alpha);
  }
`;

export interface GroundGridUniforms extends SurfaceLightingUniforms {
  uLineColor: { value: THREE.Color };
  uGlowColor: { value: THREE.Color };
  uOpacity: { value: number };
  uCell: { value: number };
  uLineWidth: { value: number };
  uFade: { value: number };
  uClipRadius: { value: number };
  uGlowCenter: { value: THREE.Vector3 };
  uGlowRadius: { value: number };
  uGlowStrength: { value: number };
  uFadeStartFraction: { value: number };
}

export interface GroundGrid {
  mesh: THREE.Mesh;
  uniforms: GroundGridUniforms;
  dispose: () => void;
}

export function createGroundGrid(): GroundGrid {
  const geometry = new THREE.PlaneGeometry(GROUND_EXTENT, GROUND_EXTENT);

  const uniforms: GroundGridUniforms = {
    ...createSurfaceLightingUniforms(),
    uLineColor: { value: new THREE.Color('#0a0a0a') },
    uGlowColor: { value: new THREE.Color('#4fd8e8') },
    uOpacity: { value: 1 },
    uCell: { value: 1 },
    uLineWidth: { value: 1.5 },
    uFade: { value: 26 },
    uClipRadius: { value: GROUND_EXTENT },
    uGlowCenter: { value: new THREE.Vector3() },
    uGlowRadius: { value: 4 },
    uGlowStrength: { value: 0.35 },
    uFadeStartFraction: { value: FADE_START_FRACTION },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: uniforms as unknown as { [uniform: string]: THREE.IUniform },
    transparent: true,
    // NORMAL blending, not additive. Additive can only ever add light, so it physically cannot draw a
    // dark line on a pale floor — black adds nothing. The floor is a surface now rather than a glow in
    // a void, so it composites like one.
    blending: THREE.NormalBlending,
    // Depth-TESTED so the table properly stands on the floor and occludes the lines behind it, but it
    // must not WRITE depth: an additive surface that wrote depth would z-fight the props resting on it
    // and punch holes in anything drawn after.
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Built in the XY plane; laid flat.
  mesh.rotation.x = -Math.PI / 2;
  // It reaches far past anything else in the room, and its bounding sphere leaves the frustum long
  // before the visible part of it does — so let it draw unconditionally rather than pop out at the edges.
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
