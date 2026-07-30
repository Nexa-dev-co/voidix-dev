// The loader's star-birth: the sun's own matter, falling in from deep space and being absorbed.
//
// This is the ACCRETION SPIRAL RUN BACKWARDS. The site's finale collapses a star into a black hole; the
// loader is the other end of that same arc. Birth here, death there, one particle language for both.
//
// ── ONE SPACE, SHARED WITH THE SUN ──
// Everything here lives in a pinhole camera that MATCHES the one SunModelCanvas frames the model with:
// same field of view, same distance, measured in the same unit (the sun's body radius). The dust and the
// ten fracture shards are therefore the same flow of matter at different distances, not two effects
// sharing a spot on screen. That was the whole problem with the previous version: it was flat — its own
// header said "there is no camera and no projection matrix" — so nothing could ever look like it was
// coming from far away, because the only cues for distance are SIZE and BRIGHTNESS and it had neither.
//
// ── IT IS A FLOW, NOT A GATHERING ──
// Particles do not accumulate. Each one falls from deep space, flares as it reaches the sun's rim, dies,
// and respawns far out. That is what stops it forming the halo it used to: a ring at twice the sun's
// radius was the inevitable end state of "everything converges and stays".
//
// ── PROGRESS GATES DENSITY, NOT POSITION ──
// A loading screen's animation cannot be a function of position, because a stalled load then means a
// stationary pose. Real bytes-loaded drives how MANY particles exist and how fast the stream runs, so a
// slow load is a thin trickle from deep space and a finished one is a torrent — always moving, and you
// can feel the load without reading a number.
//
// ── PLAIN GLSL ES 1.00, NO ENGINE ──
// Compiled by raw WebGL (see gatherRenderer.ts), not by a three ShaderMaterial, so every attribute and
// uniform is declared explicitly. The loader must not wait on a 3D engine to download before it can draw.

/**
 * Enough to read as dust rather than as dots, and trivial for a loader to draw.
 *
 * Sized to the fact that particles now start anywhere on screen and converge, so they are spread over the
 * whole viewport instead of a band around the star. Because every particle passes through the same rim,
 * density rises as 1/radius on its own: sparse specks at the edges, a dense stream at the sun. This count
 * is what makes the near-sun end match the density the tight version had. **If the field looks sparse or
 * too hot, this is the first knob**, together with `size` below.
 */
export const GATHER_COUNT = 60000;

/**
 * ── THE THREE NUMBERS THAT TIE THIS TO THE SUN ──
 *
 * These mirror SunModelCanvas's framing. They are duplicated rather than imported on purpose: importing
 * would pull `three` into the loader's worker chunk, which is the one thing this file exists to avoid.
 *
 * If `CAMERA_FIT_MARGIN` in SunModelCanvas changes, `CAMERA_DISTANCE` here must change with it or the
 * dust will be in a subtly different space from the shards falling through it.
 */
/**
 * Padding around the sun, as a multiple of the hero square.
 *
 * The sun's canvas used to be exactly the square's size, which meant the star filled its own frame
 * edge to edge — and every glow that reached that edge was CUT FLAT by the canvas boundary, drawing
 * a hard rectangle around the sun (worst once bloom and the orbiting ring landed, both of which
 * bleed outward by design).
 *
 * So the canvas is now this much LARGER than the square, and the camera pulls back by exactly the
 * same factor. The star's on-screen size is therefore unchanged — the extra pixels are pure
 * headroom for light to fall off in. `HeroSun` grows the layer; `SunModelCanvas` pulls the camera.
 * Both read this one number, and it must stay that way or the sun changes size.
 */
// Raised from 1.6 when the works section put the star into its COLLAPSE pose. That grade runs bloom
// at strength 2.5 / radius 1 against Peaceful's 1.26 / 0.92, so the glow reaches roughly twice as far
// — and at 1.6 it hit the canvas edge and got cut off square, drawing a visible rectangle around the
// sun. This is also what buys `sunParticles` room for more than one ring: the frame edge sits at
// 1 / SUN_BODY_FILL body radii, so raising this pushes it from ~2.2 out to ~3.6.
//
// ⚠ Cost scales with the SQUARE of this: 1.6 → 2.6 is ~2.6x the pixels for the sun's own render and
// its bloom pass both. If that bites on the low tier, drop the sun canvas's pixel ratio rather than
// shrinking this back — the star would start clipping again.
export const SUN_CANVAS_HEADROOM = 2.6;

// fitDistance / bodyRadius = (2.224 / sin(22.5 deg)) * 0.575 / 1.0, then × SUN_CANVAS_HEADROOM for
// the padding above. Was 3.34 when the canvas hugged the square.
export const CAMERA_DISTANCE = 3.34 * SUN_CANVAS_HEADROOM;
/** The sun element is sized to this multiple of the "o" glyph (mirrors parkSunInO in IntroSequence). */
export const SUN_IN_O_RATIO = 1.3;
/**
 * How much of that element the model's BODY actually fills — the rest is flares and empty margin.
 *
 * Divided by the headroom for the same reason `CAMERA_DISTANCE` is multiplied by it: the body did
 * not shrink, the frame around it grew. Was 0.723.
 */
export const SUN_BODY_FILL = 0.723 / SUN_CANVAS_HEADROOM;
/**
 * Horizontal framing nudge, as a fraction of the sun camera's frame HALF-height. Positive moves the sun
 * left. Lives here rather than in SunModelCanvas because the dust has to move with it: the field
 * converges on the "o", so a sun nudged off the glyph's centre would stop being concentric with the
 * stream falling into it. Both sides read this one number. See SunModelCanvas for why it is not zero.
 */
export const SUN_FRAMING_NUDGE_X = 0.05;

/** Starting values for the tunable uniforms. Plain data — no engine types. */
export const GATHER_DEFAULTS = {
  /** Radians of sweep a particle accumulates over its whole fall. Most of it lands in the last stretch. */
  wind: 3.4,
  /**
   * Point size in pixels at the sun's own distance, before device pixel ratio — so this is the size of a
   * grain in the instant before it is absorbed. Far dust scales down from here, to a 1px floor.
   */
  size: 3.4,
  /** Master fade, so the whole field can be pulled out without tearing it down. */
  opacity: 1,
  // The temperature ramp is the SUN's own, not a palette picked for the loader: these are the
  // accretion spiral's authored colours from the lab (`#d92a05` → `#ffeeb8`, see
  // `sunLabState.ts` DEFAULT accretion / `accretionShader.ts`). Same matter, same light — the dust
  // that builds the star here is the dust that falls into the black hole at the end, so the two
  // ends of the site read as one arc. Keep them in step if the spiral is ever retuned.
  //
  // It is also the physically honest ramp: cooling matter glows deep red and whitens as it heats.
  // (This was a blue→gold ramp, which made the loader read as brand cyan rather than as a star.)
  /** Cold dust in the void — deep ember. */
  colorCool: [0.85, 0.16, 0.02],
  /** Starlight, at the moment it is absorbed. */
  colorHot: [1.0, 0.93, 0.72],
} as const;

export const GATHER_VERTEX_SHADER = /* glsl */ `
  precision highp float;

  // Not a location — the particle's constants:
  //   xy = start point on screen, x in -1..1 (scaled by aspect), y in -1..1
  //   z  = phase offset 0..1     w = seed 0..1
  attribute vec4 aParticle;

  uniform float uFlow;           // accumulated inflow; advances every frame, faster as progress climbs
  uniform float uProgress;       // real bytes-loaded 0..1 — gates DENSITY only
  uniform float uTime;
  uniform float uIgnite;
  uniform float uClearing;       // 0..1 — how far the dust has withdrawn from around the star
  uniform vec2  uTarget;         // the "o", in aspect units
  uniform float uSunRadius;      // the sun's body radius on screen, in aspect units
  uniform float uCameraDistance; // camera to sun, in sun radii
  uniform float uWind;
  uniform float uAspect;
  uniform float uSize;
  uniform float uOpacity;
  uniform float uPixelRatio;

  varying float vAlpha;
  varying float vHeat;

  // Where a particle ends, in sun radii — just inside the rim, so it is absorbed BEHIND the star and the
  // flare glows out through the model's fractures rather than burning a ring in open space.
  const float SWARM_INNER = 0.85;
  // …and the closest it may ever start. A particle whose random screen point lands on the "o" would
  // otherwise have a start radius inside the rim and would fall OUTWARD.
  const float SWARM_MIN_START = 1.6;

  // How deep the stream reaches, in sun radii. The shards fall through the near half of this band.
  const float DEPTH_NEAR = 22.0;
  const float DEPTH_FAR = 54.0;

  /** Fraction of the field alive at zero progress — enough to read as a field, sparse enough to grow. */
  const float MIN_DENSITY = 0.18;
  /**
   * How much brighter a particle burns in the instant it is absorbed at the rim, and how narrow that
   * window is. Kept narrow on purpose: everything converges at the rim, so a wide flare window means a
   * large fraction of the field is burning at once and the inner edge saturates to a white ring.
   */
  const float ABSORB_FLARE = 1.6;
  const float ABSORB_START = 0.84;
  const float ABSORB_PEAK = 0.95;
  /** Distant dust must still cover a pixel or it stops existing at all. */
  const float SIZE_MIN_PIXELS = 1.0;

  // While the shards dock, the dust immediately around the star is pulled back so the docking reads
  // cleanly against empty space. Only this zone clears — the wider field keeps streaming, so the screen
  // never goes still. In sun radii, feathered so the hole has no edge.
  //
  // RAISE CLEAR_OUTER (and CLEAR_INNER with it) to clear more of the field; at ~14 it takes the whole
  // screen, which is the "hide all the dust during the assembly" reading of the same idea.
  const float CLEAR_INNER = 2.6;
  const float CLEAR_OUTER = 4.2;

  void main() {
    float phaseOffset = aParticle.z;
    float seed        = aParticle.w;

    // Where this grain begins: a random point anywhere on the viewport, not a ring around the star. The
    // fall itself is unchanged — it is still expressed in polar coordinates around the sun — so each
    // particle simply gets its own start radius and angle instead of sharing one.
    vec2 startPoint = vec2(aParticle.x * uAspect, aParticle.y);
    vec2 startOffset = startPoint - uTarget;
    float startAngle = atan(startOffset.y, startOffset.x);
    float startScreenRadius = max(length(startOffset), SWARM_MIN_START * uSunRadius);

    // One trip, wrapping forever. Offsets are spread across 0..1, so at any instant the stream holds
    // particles at every stage of the fall rather than pulsing.
    float phase = fract(phaseOffset + uFlow);

    // Decorrelated from the phase offset, or every particle at a given depth would arrive together.
    float depthJitter = fract(seed * 37.13);
    float startDepth = mix(DEPTH_NEAR, DEPTH_FAR, depthJitter);

    // ── The pinhole camera ──
    // Apparent size is cameraDistance / (cameraDistance + depth). Making THAT the quantity that moves
    // linearly is the difference between a fall you can see and one that happens in the last few frames:
    // ease the position instead and a particle 40 radii out spends most of its life at 8% size, growing
    // imperceptibly, then does everything at once. So: interpolate apparent size, then solve back for
    // where the particle has to be. (SunModelCanvas paces the shards the same way.)
    float scaleFar = uCameraDistance / (uCameraDistance + startDepth);
    float scale = mix(scaleFar, 1.0, phase);
    float travel = (uCameraDistance / scale - uCameraDistance) / startDepth; // 1 at birth, 0 at the rim

    // Aim at the rim, not the centre: matter is absorbed by a star's surface, it does not converge to a
    // point. Dividing the start radius back out through the perspective means a particle begins EXACTLY
    // on its random screen point, whatever depth it was dealt — depth then only affects how big and how
    // bright it is on the way in, never where it enters.
    float startRadius = (startScreenRadius / uSunRadius) / scaleFar;
    float radius = mix(SWARM_INNER, startRadius, travel);

    // Keplerian shear, as in the finale's accretion: the deeper the fall the faster the sweep, so the
    // stream winds into arms on its own instead of being drawn as a spiral. Referenced to the start so a
    // particle accumulates uWind radians total no matter how far out it began.
    float windNow   = pow(max(radius, SWARM_INNER) / SWARM_INNER, -1.5);
    float windStart = pow(startRadius / SWARM_INNER, -1.5);
    float angle = startAngle + uWind * (windNow - windStart);
    // A slow lateral sway, strongest far out where matter is still loosely bound.
    angle += sin(uTime * 0.7 + seed * 53.0) * 0.06 * travel;

    float screenRadius = radius * scale * uSunRadius;
    // Ignition: the last rush into the star, squared so it snaps.
    screenRadius *= 1.0 - uIgnite * uIgnite;

    vec2 aspectPosition = uTarget + vec2(cos(angle), sin(angle)) * screenRadius;
    // Aspect units back to clip space.
    gl_Position = vec4(aspectPosition.x / uAspect, aspectPosition.y, 0.0, 1.0);

    // ── Density is the progress bar ──
    // Each particle owns a threshold; the field fills in as real progress crosses them. Fading over a
    // small band per particle keeps them from popping in.
    float density = mix(MIN_DENSITY, 1.0, uProgress);
    float alive = smoothstep(seed - 0.04, seed, density);

    // 1 on the star, falling to 0 further out — the shape of the hole the assembly opens.
    float nearStar =
      1.0 - smoothstep(CLEAR_INNER * uSunRadius, CLEAR_OUTER * uSunRadius, screenRadius);

    float born = smoothstep(0.0, 0.06, phase);
    float absorbed = smoothstep(ABSORB_START, ABSORB_PEAK, phase);
    float extinguish = 1.0 - smoothstep(0.92, 1.0, phase);

    // Heat is DEPTH, not progress: cold in the void, starlight at the surface. That is what makes the
    // stream read as travelling rather than as a field changing colour over time.
    vHeat = scale;
    vAlpha =
      uOpacity * alive * born * extinguish *
      mix(0.18, 0.8, scale) *
      (1.0 + absorbed * ABSORB_FLARE) *
      (1.0 - uClearing * nearStar) *
      (1.0 - smoothstep(0.55, 1.0, uIgnite));

    gl_PointSize = max(SIZE_MIN_PIXELS, uSize * uPixelRatio * scale);
  }
`;

export const GATHER_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform vec3 uColorCool;
  uniform vec3 uColorHot;

  varying float vAlpha;
  varying float vHeat;

  void main() {
    if (vAlpha <= 0.0) discard;
    float distanceFromCentre = length(gl_PointCoord - 0.5);
    if (distanceFromCentre > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, distanceFromCentre);
    // Cold blue dust in the void, warming toward starlight as it falls in.
    vec3 color = mix(uColorCool, uColorHot, vHeat);
    // The absorption flare pushes intensity past 1 on purpose — the colour carries it (additive blending
    // saturates it into white-hot), while the alpha channel stays legal.
    float intensity = glow * vAlpha;
    gl_FragColor = vec4(color * intensity, min(1.0, intensity));
  }
`;
