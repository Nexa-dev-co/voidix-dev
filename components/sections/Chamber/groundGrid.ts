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
  uniform float uOpacity;
  uniform float uCell;        // world units between grid lines
  uniform float uLineWidth;   // in pixels, so it holds at any distance
  uniform float uFade;        // world radius at which the floor has dissolved (walls off)
  uniform float uClipRadius;  // …or the hard edge where it meets the wall (walls on)
  uniform float uFadeStartFraction;

  // ── The floor's light fittings ──
  uniform float uLightOn;          // 0 disables them entirely
  uniform vec3  uLightColor;       // the diffuser's own warm glow
  uniform vec3  uLightCoreColor;   // the lamp behind it, hot and near-white
  uniform float uLightEvery;       // tiles between one fitting and the next
  uniform float uPaverSize;        // the paver's half-size, as a fraction of the tile (0.5 fills it)
  uniform float uPaverBevel;       // how soft the paver's own edge is
  uniform float uCoreSigma;        // the lamp's size inside the diffuser, in tile fractions
  uniform float uCoreIntensity;
  uniform float uBodyIntensity;    // how brightly the whole diffuser panel burns
  uniform float uRimWidth;         // the shadowed edge of the recess the fitting sits in
  uniform float uRimDepth;
  uniform float uPoolSigma;        // how far light falls onto the tiles around it, in world units
  uniform float uPoolStrength;
  uniform float uLightLead;        // how far ahead of the floor around them the fittings strike

  // ── Where the floor runs into the wall ──
  uniform float uContactWidth;
  uniform float uContactStrength;

  varying vec3 vWorldPosition;

  ${SURFACE_LIGHTING_FUNCTIONS}

  /**
   * The floor's light fittings: whole TILES replaced by a lit paver.
   *
   * Not stripes in the seams — a real floor does this by dropping a fitting into the tiling, and that
   * is what this draws: a frosted square set flush where a tile would be, a lamp behind it, a shadowed
   * rim where it meets the tile it displaced, and a pool of light thrown onto the tiles around it.
   *
   * Returns, in order: the diffuser panel, the lamp inside it, the rim's darkening, and the pool.
   *
   * ── Laid on a STAGGERED lattice ──────────────────────────────────────────────────────────────────
   * One fitting every N tiles, with alternate rows offset by half a period. A plain lattice reads as
   * graph paper the moment you can see more than a few of them; staggering is what makes a floor look
   * laid. Closed form rather than hashed, so a fitting's position is exact and can never crawl.
   *
   * ── Why nine ─────────────────────────────────────────────────────────────────────────────────────
   * The POOL has to be gathered from the neighbouring fittings too. Sample only the nearest and it
   * clips to a hard edge halfway between two of them; nine is the smallest window symmetric in both
   * axes. The paver itself is only ever drawn on the one tile it occupies.
   *
   * ── The glow is wide and FAINT ───────────────────────────────────────────────────────────────────
   * The chamber has no bloom pass, so the pool stands in for one. A real bloom spreads a bright source
   * over a large radius at LOW amplitude. An earlier build of this floor had the radius but not the low
   * amplitude — 0.55 sigma against a 1-unit cell, where exp(-0.25/0.3025) never falls below 0.44
   * anywhere on a tile — and the result was a flat amber wash rather than light. If this ever reads as
   * coloured tiles again, that pairing is why. The reference for the look is the mark's crystal
   * (enableCrystalGrowth): a tight emissive at ~1.2 that lets a bloom supply the halo.
   */
  vec4 floorLights(vec2 worldXZ, vec2 cellCoord) {
    float period = max(uLightEvery, 1.0);
    vec2 cell = floor(cellCoord);
    vec4 result = vec4(0.0);

    float nearestRow = floor(cellCoord.y / period + 0.5);

    for (int rowStep = -1; rowStep <= 1; rowStep += 1) {
      float row = nearestRow + float(rowStep);
      // Alternate rows shifted half a period — the stagger.
      float rowOffset = mod(row, 2.0) * 0.5 * period;
      float nearestCol = floor((cellCoord.x - rowOffset) / period + 0.5);

      for (int colStep = -1; colStep <= 1; colStep += 1) {
        vec2 lightCell = vec2((nearestCol + float(colStep)) * period + rowOffset, row * period);
        vec2 lightCenter = (lightCell + 0.5) * uCell;
        float distance = length(worldXZ - lightCenter);

        result.w += exp(-(distance * distance) / max(uPoolSigma * uPoolSigma, 1e-6));

        // The fitting itself, only on the tile it actually occupies.
        if (abs(lightCell.x - cell.x) + abs(lightCell.y - cell.y) < 0.5) {
          // Where we are across this tile, -0.5 .. 0.5.
          vec2 local = (worldXZ - lightCenter) / max(uCell, 0.0001);
          // Chebyshev, not Euclidean: the paver is a SQUARE tile, and a round mask here is the single
          // most obvious way to make it stop belonging to the tiling.
          float square = max(abs(local.x), abs(local.y));

          float paver = 1.0 - smoothstep(uPaverSize - uPaverBevel, uPaverSize + uPaverBevel, square);
          result.x += paver;
          result.y += paver * exp(-dot(local, local) / max(uCoreSigma * uCoreSigma, 1e-6));
          // The shadowed edge of the recess. Inside the paver's own boundary, so the fitting reads as
          // sitting DOWN in the floor rather than laid on top of it.
          result.z += paver * smoothstep(uPaverSize - uRimWidth, uPaverSize, square);
        }
      }
    }
    return result;
  }

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

    // 5. The pool of tint under the hologram used to be here — a flat wash on the floor standing in for
    //    the panel having a source. It has been replaced by a real one: the plinth is an object in the
    //    room now (chamberPlinth.ts), so the floor no longer has to imply what is projecting.

    // 6. Where the floor runs into the wall. The two surfaces meet along the one edge a viewer is
    //    guaranteed to look at, and two flat colours butting together is what gives the room away as
    //    two shaders. Darkened toward the unlit colour rather than toward black, so the corner belongs
    //    to the room's own palette. Gated on the power-up: an unlit floor has no light to occlude.
    float towardWall = 1.0 - smoothstep(uClipRadius - uContactWidth, uClipRadius, distanceFromCenter);
    surface = mix(surface, uColor, (1.0 - towardWall) * uContactStrength * ignition.x);

    // 7. The light fittings. ADDED, not mixed: these are light sources in the room rather than colours
    //    on its floor, so they have to be able to burn past the surface they sit in — which is also what
    //    gives the lamp a white-hot centre once the tone map rolls it off, with no bloom pass involved.
    //
    //    On their OWN ignition, led slightly ahead of the floor around them (uLightLead): they are what
    //    lights the room, so they cannot come up after it. Cause, then effect. The wavefront is measured
    //    from the same origin as every other surface, so leading it can never desync them — this is the
    //    one clock, offset, not a second one.
    float distanceFromOrigin = length(vWorldPosition.xz - uIgniteOrigin.xz);
    vec2 lightIgnition = ignitionAtMoment(
      max(distanceFromOrigin / max(uIgniteRadius, 0.001) - uLightLead, 0.0)
    );
    vec4 fitting = floorLights(vWorldPosition.xz, cellCoord) * uLightOn * lightIgnition.x;
    float strike = 1.0 + lightIgnition.y;

    //    In build order, and the order is the whole trick:
    //    the pool falls on the floor first, then the recess is cut into it, then the fitting is set in
    //    the recess and lit. Light first and cut after, and the rim digs a hole through the glow — which
    //    is exactly how a fitting ends up looking printed on rather than installed.
    surface += uLightColor * fitting.w * uPoolStrength * strike;
    surface = mix(surface, uColor, clamp(fitting.z, 0.0, 1.0) * uRimDepth);
    surface += uLightColor * fitting.x * uBodyIntensity * strike;
    surface += uLightCoreColor * fitting.y * uCoreIntensity * strike;

    float alpha = fade * uOpacity;
    if (alpha <= 0.001) discard;

    gl_FragColor = vec4(surface, alpha);
  }
`;

export interface GroundGridUniforms extends SurfaceLightingUniforms {
  uLineColor: { value: THREE.Color };
  uOpacity: { value: number };
  uCell: { value: number };
  uLineWidth: { value: number };
  uFade: { value: number };
  uClipRadius: { value: number };
  uFadeStartFraction: { value: number };
  uLightOn: { value: number };
  uLightColor: { value: THREE.Color };
  uLightCoreColor: { value: THREE.Color };
  uLightEvery: { value: number };
  uPaverSize: { value: number };
  uPaverBevel: { value: number };
  uCoreSigma: { value: number };
  uCoreIntensity: { value: number };
  uBodyIntensity: { value: number };
  uRimWidth: { value: number };
  uRimDepth: { value: number };
  uPoolSigma: { value: number };
  uPoolStrength: { value: number };
  uLightLead: { value: number };
  uContactWidth: { value: number };
  uContactStrength: { value: number };
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
    uOpacity: { value: 1 },
    uCell: { value: 1 },
    uLineWidth: { value: 1.5 },
    uFade: { value: 26 },
    uClipRadius: { value: GROUND_EXTENT },
    uFadeStartFraction: { value: FADE_START_FRACTION },
    uLightOn: { value: 1 },
    uLightColor: { value: new THREE.Color('#ff8a1a') },
    uLightCoreColor: { value: new THREE.Color('#fff0d6') },
    uLightEvery: { value: 5 },
    uPaverSize: { value: 0.36 },
    uPaverBevel: { value: 0.02 },
    uCoreSigma: { value: 0.13 },
    uCoreIntensity: { value: 2.6 },
    uBodyIntensity: { value: 0.5 },
    uRimWidth: { value: 0.07 },
    uRimDepth: { value: 0.75 },
    uPoolSigma: { value: 1.1 },
    uPoolStrength: { value: 0.22 },
    uLightLead: { value: 0.12 },
    uContactWidth: { value: 2.4 },
    uContactStrength: { value: 0.42 },
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
