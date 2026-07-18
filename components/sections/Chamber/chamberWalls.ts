import * as THREE from 'three';
import {
  SURFACE_LIGHTING_UNIFORMS,
  SURFACE_LIGHTING_FUNCTIONS,
  createSurfaceLightingUniforms,
  type SurfaceLightingUniforms,
} from './chamberSurfaceLighting';

/**
 * The room's walls — one inward-facing cylinder of plain, unbroken white.
 *
 * ── Why a cylinder and not four walls ────────────────────────────────────────────────────────────
 * Corners are the single most legible cue that you're in a box of known dimensions, and a plain
 * surface has nothing else to distract from them — every corner would read as a hard vertical crease.
 * A cylinder has none, so the room encloses you without announcing its shape. It's also one mesh and
 * one draw call.
 *
 * ── And no ceiling ───────────────────────────────────────────────────────────────────────────────
 * The wall fades out as it rises, so there is no top edge and nothing overhead — the white simply
 * stops being. That's what keeps this from reading as a cylinder you're standing inside: you never see
 * enough of it to tell.
 *
 * ── Why there's no grid here ─────────────────────────────────────────────────────────────────────
 * The floor carries the grid; the walls are bare. That asymmetry is doing work — the grid reads as
 * something you stand ON, and repeating it up the walls would flatten the whole room into one
 * wallpapered tube. It also removes the hardest part of the old wall shader (wrapping a repeating grid
 * around a cylinder without a seam, and the `atan` derivative blowing out at the wrap), so what's left
 * is a gradient and a fade.
 */

// Radial segments. There is no grid to hold straight and the silhouette is never seen against
// anything, so this only has to be smooth enough that the fade doesn't facet.
const RADIAL_SEGMENTS = 64;

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

  uniform float uOpacity;
  uniform float uBaseY;     // the floor line, where the wall starts
  uniform float uHeight;    // how far up it has faded to nothing
  uniform float uFadeStart; // fraction of the height that holds full strength first
  uniform vec3  uWallColor; // the lit wall's own colour — independent of the floor's

  varying vec3 vWorldPosition;

  ${SURFACE_LIGHTING_FUNCTIONS}

  void main() {
    float heightFraction = (vWorldPosition.y - uBaseY) / max(uHeight, 0.001);
    // Below the floor line there is no wall. The cylinder is built to hang a little under it so no gap
    // can open at the join when the camera is low; this is what trims the excess.
    if (heightFraction < 0.0) discard;

    // Rising fade: full at the floor line, gone before the top. No ceiling, no top edge.
    float fade = 1.0 - smoothstep(uFadeStart, 1.0, heightFraction);

    // The SMOOTH wavefront, not the per-cell one — see chamberSurfaceLighting. There are no cells here
    // for a per-cell offset to hide inside, so jitter would light this wall in visible blotches.
    vec2 ignition = surfaceIgnitionSmooth(vWorldPosition);

    // Unlit, the wall is the dark room; lit, it's its own colour — kept separate from the floor's so the
    // two read as different surfaces rather than as one seamless tube. The strike flares it toward the
    // floor's brighter white, which is the only over-bright headroom a pale surface has.
    vec3 surface = mix(uColor, uWallColor, ignition.x);
    surface = mix(surface, uColorLit, clamp(ignition.y, 0.0, 1.0));

    float alpha = fade * uOpacity;
    if (alpha <= 0.001) discard;

    gl_FragColor = vec4(surface, alpha);
  }
`;

export interface ChamberWallsUniforms extends SurfaceLightingUniforms {
  uOpacity: { value: number };
  uBaseY: { value: number };
  uHeight: { value: number };
  uFadeStart: { value: number };
  uWallColor: { value: THREE.Color };
}

export interface ChamberWalls {
  mesh: THREE.Mesh;
  uniforms: ChamberWallsUniforms;
  /** The cylinder is built at unit size and scaled, so radius and height stay live knobs. */
  setShape: (radius: number, height: number, baseY: number) => void;
  dispose: () => void;
}

export function createChamberWalls(): ChamberWalls {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, RADIAL_SEGMENTS, 1, true);

  const uniforms: ChamberWallsUniforms = {
    ...createSurfaceLightingUniforms(),
    uOpacity: { value: 1 },
    uBaseY: { value: 0 },
    uHeight: { value: 9 },
    uFadeStart: { value: 0.15 },
    uWallColor: { value: new THREE.Color('#c9ced3') },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: uniforms as unknown as { [uniform: string]: THREE.IUniform },
    transparent: true,
    // Same reasoning as the floor: these are surfaces now, not glows in a void, so they composite
    // normally. Additive white would clip to flat white and lose the shade difference entirely.
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: true,
    // We stand inside it, so only the inward faces are ever wanted. Rendering the near wall as well
    // would draw a white sheet across the middle of the room.
    side: THREE.BackSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // It surrounds the camera at all times and its bounding sphere is enormous — culling it can only
  // ever be wrong.
  mesh.frustumCulled = false;
  // The floor draws AFTER the walls. Neither writes depth, so where they overlap on screen the later
  // one wins, and the floor is the surface that should be in front at the join.
  mesh.renderOrder = 0;

  return {
    mesh,
    uniforms,
    setShape: (radius, height, baseY) => {
      // The cylinder is centred on its own origin, so it's raised by half its height to stand ON the
      // floor line, with a little left hanging below (trimmed by the shader's `discard`).
      mesh.scale.set(radius, height, radius);
      mesh.position.y = baseY + height / 2;
      uniforms.uBaseY.value = baseY;
      uniforms.uHeight.value = height;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
