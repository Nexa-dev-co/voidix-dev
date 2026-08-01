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

  uniform float uGrain;        // low-frequency luminance wander — the wall's material
  uniform float uTexture;      // the finish on top of it: finer, streaked, and distance-faded
  uniform float uTextureScale;
  uniform float uTextureFade;  // world distance past which the finish stops drawing at all
  uniform float uSkirtHeight;  // the shadow gap where the wall meets the floor
  uniform float uSkirtDepth;
  uniform float uDirectional;  // how much darker it gets facing away from the display

  uniform float uRadius;       // how far out the wall stands. Turns a seam width into an angle.

  // ── Panelling — the wall as plates, not a tube ──
  uniform float uPanelColumns;   // vertical seams around the wall. Rounded to an INTEGER; see wallTurns.
  uniform float uPanelRowHeight; // world units between horizontal seams
  uniform float uPanelSeam;      // a seam's half-width, in world units
  uniform float uPanelSeamDepth;
  uniform float uPanelBevel;     // the lit lip just outside a seam, where a plate's edge catches light

  // ── The light strip running the wall at eye height ──
  uniform float uStripOn;
  uniform vec3  uStripColor;
  uniform float uStripY;         // the band's centre, measured up from the floor line
  uniform float uStripHalf;      // half-thickness of the lit core, in world units
  uniform float uStripGlow;      // sigma of its skirt. SMALL relative to the wall — see the floor's note.
  uniform float uStripBloom;
  uniform float uStripIntensity;
  uniform float uStripSegments;  // breaks around the circumference. Rounded to an INTEGER, same reason.
  uniform float uStripGap;       // how much of each segment is gap, 0 .. 0.5
  uniform float uStripRecess;    // the channel the strip is set into
  uniform float uStripRecessDepth;

  varying vec3 vWorldPosition;

  ${SURFACE_LIGHTING_FUNCTIONS}

  /**
   * Where we are around the wall, in TURNS (0 at the seam behind us, 1 all the way round).
   *
   * Two traps live here, and both are avoided by construction rather than by clamping.
   *
   * 1. atan wraps from +PI to -PI, and any pattern built on it seams at that jump. Working in turns and
   *    giving every pattern an INTEGER period puts the wrap exactly on a period boundary, so fract() is
   *    continuous across it and there is no seam to hide. This is why the counts are rounded.
   * 2. Taking fwidth of atan blows up at that same wrap — a hairline becomes a full-screen flare on the
   *    frames the derivative crosses it, which is what made the old wall grid unshippable. So nothing
   *    here differentiates the angle at all: seam widths are given in WORLD units and converted with the
   *    circumference, which is exact and has no derivative in it.
   */
  float wallTurns(vec3 worldPosition) {
    return atan(worldPosition.z, worldPosition.x) / 6.2831853 + 0.5;
  }

  /** Distance to the nearest repeat boundary, converted back into world units. */
  float seamDistance(float repeats, float worldPeriod) {
    return (0.5 - abs(fract(repeats) - 0.5)) * worldPeriod;
  }

  // Cheap value noise. Two octaves is enough: this is a slow wander across metres of wall, not a
  // texture — anything finer would alias into a crawl as the camera moves, which is the exact failure
  // the floor's grid had to be rewritten around.
  float wallNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = cellHash(i);
    float b = cellHash(i + vec2(1.0, 0.0));
    float c = cellHash(i + vec2(0.0, 1.0));
    float d = cellHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

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

    // ── The wall's material ──
    // A slow luminance wander across metres of surface. This is the single thing that stops a flat fill
    // reading as a colour and starts it reading as plaster: a perfectly even wall has no scale, and
    // without scale a cylinder is just a gradient. Sampled in world space, so it is fixed to the room
    // rather than swimming with the camera. Only where the wall is lit — unlit, there is no material to
    // see the variation in.
    float grain = (wallNoise(vWorldPosition.xz * 0.35 + vWorldPosition.y * 0.12) - 0.5) * 2.0;
    surface *= 1.0 + grain * uGrain * ignition.x;

    // ── The finish, on top of the wander ──
    // A finer, ANISOTROPIC noise: the sample is stretched vertically, so it streaks up the wall the way
    // a brushed plate does rather than reading as static.
    //
    // ⚠ Faded out with distance, and that is not polish. Fine noise on a surface this large is exactly
    // the moire the floor's grid had to be rewritten around: past a certain depth one period falls below
    // a pixel and the whole wall crawls as the camera moves. Killing it before it gets there is the same
    // answer, arrived at from the other direction — the floor holds a line at one pixel, this stops
    // drawing.
    float toCamera = length(vWorldPosition - cameraPosition);
    float finishFade = 1.0 - smoothstep(uTextureFade * 0.45, uTextureFade, toCamera);
    vec2 finishCoord = vec2(
      (wallTurns(vWorldPosition) * 6.2831853 * uRadius) * uTextureScale,
      vWorldPosition.y * uTextureScale * 0.18
    );
    float finish = (wallNoise(finishCoord) - 0.5) * 2.0;
    surface *= 1.0 + finish * uTexture * finishFade * ignition.x;

    // ── A light direction ──
    // Every surface in this room lights by DISTANCE from the display and nothing else, which is why a
    // bare cylinder reads as an evenly filled tube. Facing matters too: the far side of the room should
    // be the dark side. Nearly free — the origin is already a uniform.
    vec2 toOrigin = uIgniteOrigin.xz - vWorldPosition.xz;
    // The inward normal of a cylinder centred on the origin is simply -normalize(position).
    float facing = dot(normalize(toOrigin + 1e-6), normalize(-vWorldPosition.xz + 1e-6));
    surface *= 1.0 - uDirectional * (1.0 - clamp(facing * 0.5 + 0.5, 0.0, 1.0)) * ignition.x;

    // ── Panelling ──
    // The wall as PLATES rather than as one surface: a groove at every seam, and a lit lip just outside
    // it where a plate's edge catches the light. This is most of what separates a machined interior from
    // a tube, and it is the one place the old "no grid on the walls" rule has been deliberately given up
    // — that rule existed to keep the room unmeasurable, and a ship's corridor is meant to be measured.
    //
    // Counts are ROUNDED to integers so the pattern closes on itself at the atan wrap. See wallTurns.
    float columns = max(floor(uPanelColumns + 0.5), 1.0);
    float circumference = 6.2831853 * max(uRadius, 0.001);
    float columnSeam = seamDistance(wallTurns(vWorldPosition) * columns, circumference / columns);
    float rowSeam = seamDistance(
      (vWorldPosition.y - uBaseY) / max(uPanelRowHeight, 0.001),
      max(uPanelRowHeight, 0.001)
    );
    float nearestSeam = min(columnSeam, rowSeam);

    float groove = 1.0 - smoothstep(uPanelSeam, uPanelSeam * 2.0, nearestSeam);
    // Just OUTSIDE the groove, never inside it — a bevel is the plate's own edge turning toward the
    // light, so it has to sit on the plate rather than in the gap between two.
    float bevel = (1.0 - smoothstep(uPanelSeam * 2.0, uPanelSeam * 4.5, nearestSeam)) * (1.0 - groove);
    surface *= 1.0 + bevel * uPanelBevel * ignition.x;
    surface = mix(surface, uColor, groove * uPanelSeamDepth * ignition.x);

    // ── The shadow gap at the floor line ──
    // The other half of the floor's own contact darkening. Both surfaces pulling down into the join is
    // what gives it weight; one of them doing it alone reads as a gradient on the floor.
    float skirt = 1.0 - smoothstep(0.0, uSkirtHeight, vWorldPosition.y - uBaseY);
    surface = mix(surface, uColor, skirt * uSkirtDepth * ignition.x);

    // ── The light strip ──
    // A band running the wall at eye height, broken into segments — the signature of the reference, and
    // sited where the tour actually looks: every showcase key aims level or down, which is also why
    // there is still no ceiling to put lights in.
    //
    // Built in the same order as the floor's fittings, for the same reason: cut the channel, THEN light
    // it. Light first and the channel digs a hole through its own glow.
    float segments = max(floor(uStripSegments + 0.5), 1.0);
    float alongStrip = abs(fract(wallTurns(vWorldPosition) * segments) - 0.5);
    float withinSegment = step(alongStrip, 0.5 - uStripGap);

    float fromStrip = abs((vWorldPosition.y - uBaseY) - uStripY);
    float channel = (1.0 - smoothstep(uStripHalf, max(uStripRecess, uStripHalf + 1e-4), fromStrip))
                    * withinSegment;
    surface = mix(surface, uColor, channel * uStripRecessDepth * ignition.x);

    float stripCore = 1.0 - smoothstep(uStripHalf, uStripHalf * 1.6, fromStrip);
    float stripSkirt = exp(-(fromStrip * fromStrip) / max(uStripGlow * uStripGlow, 1e-6)) * uStripBloom;
    surface += uStripColor * (stripCore + stripSkirt) * withinSegment
               * uStripIntensity * uStripOn * ignition.x * (1.0 + ignition.y);

    // The floor fittings' spill up the wall used to be here. It went when the wall got a light source
    // of its own: a band at eye height is a far better reason for the wall to be lit than a wash from
    // below, and the two together only flattened the panelling.

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
  uGrain: { value: number };
  uTexture: { value: number };
  uTextureScale: { value: number };
  uTextureFade: { value: number };
  uSkirtHeight: { value: number };
  uSkirtDepth: { value: number };
  uDirectional: { value: number };
  uRadius: { value: number };
  uPanelColumns: { value: number };
  uPanelRowHeight: { value: number };
  uPanelSeam: { value: number };
  uPanelSeamDepth: { value: number };
  uPanelBevel: { value: number };
  uStripOn: { value: number };
  uStripColor: { value: THREE.Color };
  uStripY: { value: number };
  uStripHalf: { value: number };
  uStripGlow: { value: number };
  uStripBloom: { value: number };
  uStripIntensity: { value: number };
  uStripSegments: { value: number };
  uStripGap: { value: number };
  uStripRecess: { value: number };
  uStripRecessDepth: { value: number };
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
    uGrain: { value: 0.025 },
    uTexture: { value: 0.06 },
    uTextureScale: { value: 2.6 },
    uTextureFade: { value: 16 },
    uSkirtHeight: { value: 0.35 },
    uSkirtDepth: { value: 0.55 },
    uDirectional: { value: 0.4 },
    uRadius: { value: 14 },
    uPanelColumns: { value: 24 },
    uPanelRowHeight: { value: 2.2 },
    uPanelSeam: { value: 0.02 },
    uPanelSeamDepth: { value: 0.55 },
    uPanelBevel: { value: 0.22 },
    uStripOn: { value: 1 },
    uStripColor: { value: new THREE.Color('#ff8a1a') },
    uStripY: { value: 1.15 },
    uStripHalf: { value: 0.045 },
    uStripGlow: { value: 0.16 },
    uStripBloom: { value: 0.45 },
    uStripIntensity: { value: 2.4 },
    uStripSegments: { value: 24 },
    uStripGap: { value: 0.12 },
    uStripRecess: { value: 0.11 },
    uStripRecessDepth: { value: 0.8 },
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
      // The panelling needs it: a seam width is authored in world units and converted to an angle
      // through the circumference, so the shader has to know how far out the wall actually stands.
      uniforms.uRadius.value = radius;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
