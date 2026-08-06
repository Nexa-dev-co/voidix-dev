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
/**
 * ⚠ Now a TABLE, and it was a flat 60 000 on every machine.
 *
 * The field is fullscreen additive point sprites with a `discard` in the fragment shader — no early-z,
 * pure fill — and it is the one canvas on this loader that must never stutter. It was also the only
 * renderer on the site that answered to nothing: not `adaptivePixelRatio`, not `deviceTier`. A phone
 * drew the same 60 000 grains as a desktop, at up to dpr 3, while its cores were decoding 10 MB of
 * models.
 *
 * ⚠ Read on the MAIN THREAD and passed into the renderer. `getDeviceTier()` asks `matchMedia`, and
 * there is no `matchMedia` in a worker.
 */
export const GATHER_COUNT_BY_TIER = {
  potato: 18000,
  low: 28000,
  mid: 45000,
  high: 60000,
} as const;

/**
 * The most the field will ever draw, for anything sizing a buffer against the worst case.
 *
 * ⚠ The grain COUNT is not the same knob as the grain SIZE. If the field looks sparse on a low tier,
 * `GATHER_DEFAULTS.size` is the one to reach for — the dust is meant to thin out with the machine,
 * not to shrink.
 */
export const GATHER_COUNT_MAX = GATHER_COUNT_BY_TIER.high;

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
  // accretion spiral's authored colours (`#d92a05` → `#ffeeb8`, see
  // `lib/accretionShader.ts`). Same matter, same light — the dust
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

  // This grain's target in each of the four drawings, normalised to −1..1 and packed two to a vec4:
  //   aShapeAB = shape0.xy · shape1.xy      aShapeCD = shape2.xy · shape3.xy
  // Zeroed for shapes that do not exist, and their weights are zero too, so a bake of one or two
  // drawings costs nothing here. Three attributes against a guaranteed sixteen.
  attribute vec4 aShapeAB;
  attribute vec4 aShapeCD;

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
  uniform float uShapeHold;      // 0..1 — how far the field has left the flow for a held form
  // The drawing being left and the one being entered, each as a one-hot selector over the four, plus
  // how far the CYCLE has crossed between them. Owned by gatherRenderer, which runs the sequence off
  // its own delta time — so the morph stays smooth while the main thread is blocked parsing glTF,
  // which is the entire reason this field lives in a worker.
  //
  // ⚠ TWO SELECTORS AND A SCALAR, not one blended weight vector. A single set of weights makes every
  // grain cross at the same instant, and the midpoint of that is 60 000 grains at the average of two
  // unrelated silhouettes — which is a formless cloud, every time, for about a second of every cycle.
  // Kept apart, each grain can cross on its OWN clock (see SHAPE_MORPH_STAGGER) and what you see is
  // one drawing coming apart while the next assembles out of it.
  uniform vec4  uShapeFrom;
  uniform vec4  uShapeTo;
  uniform float uShapeMorph;

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

  /**
   * Fraction of the field alive at zero progress.
   *
   * ⚠ Was 0.18, and 0.18 is where "the field reports the truth" stopped being a virtue. Do the sum for
   * a stalled load: 18% of the grains alive, spread over the WHOLE viewport rather than a band, each
   * one far enough out that \`scale\` is ~0.15-0.28 — which puts its alpha at ~0.3 and its point size
   * under one pixel, so it clamps to SIZE_MIN_PIXELS. A screen of one-pixel dots at a third alpha on
   * near-black, drifting at 0.16 trips per second, is not a thin trickle from deep space. It is an
   * empty screen, and that is exactly what it was reported as.
   *
   * Half the field is the floor now. Progress still reads — density climbs to double this, and the
   * FLOW RATE (gatherRenderer) doubles with it, which is the cue that actually carries — but the
   * loader can no longer look switched off while it is working. The honest number the field cannot
   * give you is on the counter and the telemetry meter anyway.
   */
  const float MIN_DENSITY = 0.5;
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
  /**
   * How much wider the SPRITE is than the grain, to make room for the bloom's halo.
   *
   * The core stays the same apparent size (BLOOM_CORE_RADIUS is a fraction of the sprite, so it
   * scales with this) — what this buys is the pixels the glow spills into. See the fragment shader.
   */
  const float BLOOM_SPREAD = 1.7;

  // While the shards dock, the dust immediately around the star is pulled back so the docking reads
  // cleanly against empty space. Only this zone clears — the wider field keeps streaming, so the screen
  // never goes still. In sun radii, feathered so the hole has no edge.
  //
  // RAISE CLEAR_OUTER (and CLEAR_INNER with it) to clear more of the field; at ~14 it takes the whole
  // screen, which is the "hide all the dust during the assembly" reading of the same idea.
  const float CLEAR_INNER = 2.6;
  const float CLEAR_OUTER = 4.2;

  // ══ THE HELD FORMS ══════════════════════════════════════════════════════════════════════════════
  //
  // The loader is one held beat now: the same grains that make the stream leave it, gather into a
  // drawing, hold it, and dissolve into the next, for the whole of the download, the warm-up, the
  // measurement and the caching. No model is downloaded to do it — these are the dust it already has.
  //
  // ⚠ THESE USED TO BE THREE CLOSED-FORM FUNCTIONS of a particle's seed (a star shell, an accretion
  // annulus, a log spiral) and that was genuinely elegant — no buffers, no attributes, no CPU per
  // frame. It is also exactly why there could never be a fourth: there is no function that turns a
  // random seed into "a point inside this drawing". The forms are baked point clouds now, sampled
  // from SVG by scripts/buildLoaderShapes.mjs, and each grain carries its target in EVERY shape as a
  // vertex attribute. A morph is therefore one grain travelling from its place in one drawing to its
  // place in the next — the shape TRANSFORMS rather than dissolving and re-forming.
  //
  // ⚠ And the point index is not arbitrary. The bake walks the image in scan order, so index 0 is the
  // topmost ink in every shape and the last index is the lowest. Giving a grain the same INDEX in all
  // four shapes therefore makes the morph structurally coherent — tops travel to tops — instead of
  // 60 000 grains crossing each other at random. Do not shuffle the indices to "spread them out".
  //
  // ⚠ THEY MUST NEVER BE STILL. This file's rule is that a loading screen cannot animate on position,
  // because a stalled load then means a stationary pose. The old forms carried their turn in their
  // geometry — a shell reads its spin through the depth ramp, a disc through shear. A DRAWING IS
  // FLAT and, rotated in 3D, becomes an edge-on line. So the motion is authored instead, in the three
  // constants below: a slab of depth so the pinhole still grades it, a tilt that parallaxes the near
  // face against the far one without ever approaching edge-on, and a per-grain shimmer so the
  // silhouette breathes.

  const float TAU = 6.2831853;

  // ── How big a form is, and why it is measured against the FRAME ──
  //
  // Everything else in this file is measured in sun radii, and a form must not be: the sun's screen
  // radius is derived from the wordmark's "o", which is a fluid font size. On a 1440 px desktop the
  // frame is ~15 sun radii tall and on a 390 px phone it is ~48, so a form sized in radii would be
  // half the screen on one and a postage stamp on the other. These are fractions of the frame's own
  // half-height, which is 1 aspect unit by definition.
  const float SHAPE_FRAME_HALF = 0.72;
  /** …and of its half-WIDTH, which binds instead on anything portrait. The smaller of the two wins. */
  const float SHAPE_FRAME_WIDE = 0.80;

  // Pushes each form far enough back that nothing crosses the lens, in sun radii. It also decides how
  // big and how hot a grain in a form reads against one in the stream: at this offset a form's grains
  // sit at about half the apparent size of one being absorbed at the rim, which is what keeps the
  // held drawing from out-shouting the flow it came out of.
  const float SHAPE_DEPTH_OFFSET = 10.0;

  /**
   * How far a grain's own depth may stray from the form's plane, in DRAWING units (the −1..1 the bake
   * normalises to), and how many sun radii one of those units is worth.
   *
   * This is the whole reason a flat drawing reads as an object rather than as a decal: given a slab
   * of depth the pinhole grades near grains larger and hotter than far ones, and the tilt below then
   * has something to parallax.
   */
  const float SHAPE_SLAB = 0.34;
  const float SHAPE_DEPTH_SCALE = 14.0;
  /**
   * Radians of tilt about the vertical, and how fast it swings.
   *
   * ⚠ Deliberately small. A drawing is FLAT: rotate it far and it collapses to an edge-on line, which
   * is the one thing the old procedural forms could never do. At this angle a grain at the drawing's
   * edge moves ±2.2 sun radii in depth — real parallax between the near and far side — while losing
   * 1.3% of its width, which nobody can see.
   */
  const float SHAPE_TILT = 0.16;
  const float SHAPE_TILT_RATE = 0.31;
  /**
   * How far a grain circles its target, in drawing units.
   *
   * Load-bearing twice over. There are far more grains than sampled points — 60 000 against 4 096 —
   * so without this every grain sharing a point would sit on one identical pixel and the form would
   * be a plotted outline rather than dust. And it is what keeps a HELD form alive: the circling never
   * stops, so a form that is holding still is still moving. See this block's header on why that rule
   * is not negotiable.
   *
   * ⚠ Sized against the SOURCE ART. These drawings are line work about 2% of their own width, so a
   * drift much past this stops reading as a thickened stroke and starts reading as a blurred one.
   */
  const float SHAPE_SCATTER = 0.010;
  const float SHAPE_SHIMMER_RATE = 0.9;
  /**
   * How much larger a grain is once it has left the stream for a drawing.
   *
   * ⚠ THIS IS WHAT MAKES THE BLOOM READ, and without it the drawings came out gritty rather than lit.
   * A form sits at about half the apparent size of a grain being absorbed at the rim, so its sprites
   * were ~2.5 px across — too small for the halo in the fragment shader to have any pixels to spill
   * into, and far too small for neighbouring halos to sum along a stroke. Bloom in an additive field
   * IS that summing; a sprite that cannot reach its neighbour cannot do it.
   *
   * Only the sprite grows. The number of grains, where they are and how bright each one is are all
   * unchanged — so the stroke gets softer and hotter rather than thicker.
   */
  const float SHAPE_GRAIN_BOOST = 2.1;

  /**
   * Fraction of a crossing spent staggering the grains rather than moving them.
   *
   * Each grain waits out its own hashed share of the window before it starts, then crosses over what
   * is left. At 0 every grain moves together and the midpoint is the average of two silhouettes —
   * mush. At this value the first grains have arrived before the last have set off, so the old
   * drawing visibly comes apart while the new one assembles, which is the whole effect.
   *
   * ⚠ Do not take it much higher. What is left over — one minus this — is each grain's own travel
   * time; too little of it and the individual crossings snap.
   *
   * (And no backticks anywhere in this file, ever. This is the fourth time a comment has closed the
   * template literal the shader source lives in.)
   */
  const float SHAPE_MORPH_STAGGER = 0.55;
  /**
   * How far a grain bows through DEPTH on its way across, in drawing units.
   *
   * Without it a crossing is 60 000 straight lines and reads as a wipe. Bowed — half toward the lens,
   * half away, peaking mid-flight — the grains in transit separate from both drawings by size and
   * heat, so the crossing has its own volume.
   */
  const float SHAPE_MORPH_ARC = 0.55;

  float hash(float x) {
    return fract(sin(x) * 43758.5453123);
  }

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

    // ── Leaving the stream for a held form ──
    // Staggered per particle so the field gathers over a beat instead of snapping: each grain starts
    // its own crossing at a different point in uShapeHold, and the smoothstep gives it an ease.
    float holdStagger = clamp(uShapeHold * 1.45 - seed * 0.45, 0.0, 1.0);
    float hold = smoothstep(0.0, 1.0, holdStagger);

    if (hold > 0.001) {
      // ── Where this grain belongs, in the drawing it is leaving and the one it is entering ──
      // Because the same grain holds a target in EVERY drawing, a crossing is one grain TRAVELLING
      // from its place in one to its place in the next — the shape transforms rather than dissolving
      // and re-forming somewhere else.
      vec2 leaving =
        aShapeAB.xy * uShapeFrom.x + aShapeAB.zw * uShapeFrom.y +
        aShapeCD.xy * uShapeFrom.z + aShapeCD.zw * uShapeFrom.w;
      vec2 entering =
        aShapeAB.xy * uShapeTo.x + aShapeAB.zw * uShapeTo.y +
        aShapeCD.xy * uShapeTo.z + aShapeCD.zw * uShapeTo.w;

      // This grain's own crossing, inside the cycle's. It waits out its share of the stagger, then
      // travels over what is left — so the first grains land before the last ones leave.
      float grainStart = hash(seed * 17.31) * SHAPE_MORPH_STAGGER;
      float grainTravel =
        clamp((uShapeMorph - grainStart) / (1.0 - SHAPE_MORPH_STAGGER), 0.0, 1.0);
      float grainMorph = smoothstep(0.0, 1.0, grainTravel);
      vec2 drawing = mix(leaving, entering, grainMorph);

      // Circling its target — the form's own life, and what turns 4 096 sampled points into dust.
      float driftAngle =
        hash(seed * 21.71) * TAU + uTime * SHAPE_SHIMMER_RATE * (0.6 + hash(seed * 5.37));
      float driftRadius = SHAPE_SCATTER * (0.35 + hash(seed * 63.19));
      drawing += vec2(cos(driftAngle), sin(driftAngle)) * driftRadius;

      // The slab, and the tilt that makes it legible. Rotating about the VERTICAL swings the near
      // face across the far one; at SHAPE_TILT this is parallax and never an edge-on collapse.
      // The bow is added to the same axis, so a grain in transit is genuinely nearer or further than
      // both drawings rather than just sliding between them.
      float slab = (hash(seed * 45.13) - 0.5) * SHAPE_SLAB;
      slab += sin(grainMorph * 3.14159265) * SHAPE_MORPH_ARC * (hash(seed * 7.77) - 0.5) * 2.0;
      float tilt = sin(uTime * SHAPE_TILT_RATE) * SHAPE_TILT;
      float tiltSin = sin(tilt);
      float tiltCos = cos(tilt);
      vec2 turnedXZ = vec2(
        drawing.x * tiltCos + slab * tiltSin,
        -drawing.x * tiltSin + slab * tiltCos
      );

      // Through the SAME pinhole the flow uses, so a grain that leaves the stream keeps its depth cues
      // and the two states are one space rather than two effects sharing a screen. The base scale is
      // divided back out so a grain at the form's own plane lands exactly on the span below — depth
      // then only changes how big and how bright it is, never how large the drawing reads.
      float formScale =
        uCameraDistance / (uCameraDistance + SHAPE_DEPTH_OFFSET + turnedXZ.y * SHAPE_DEPTH_SCALE);
      float baseScale = uCameraDistance / (uCameraDistance + SHAPE_DEPTH_OFFSET);
      float span = min(SHAPE_FRAME_HALF, uAspect * SHAPE_FRAME_WIDE);
      vec2 formAspect =
        uTarget + vec2(turnedXZ.x, drawing.y) * span * (formScale / baseScale);

      aspectPosition = mix(aspectPosition, formAspect, hold);
      scale = mix(scale, formScale, hold);
    }

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

    // The flow's whole birth → absorb → die cycle is a function of PHASE, which keeps running while a
    // form is held — so left alone it would make the shape twinkle and dissolve at exactly the moment
    // it is meant to be a solid object. Faded out with the crossing, so the form holds steady and the
    // stream gets its lifecycle back on the way out.
    float lifecycle = born * extinguish * (1.0 + absorbed * ABSORB_FLARE);
    lifecycle = mix(lifecycle, 1.0, hold);

    // Heat is DEPTH, not progress: cold in the void, starlight at the surface. That is what makes the
    // stream read as travelling rather than as a field changing colour over time — and inside a form
    // it is what makes the near face read as nearer.

    // ⚠ CLAMPED, and it must be. In the flow the scale cannot exceed 1 — it is interpolated toward
    // the rim — but a form's near face sits closer than the sun does, so it goes above 1. Both uses
    // below are mix() endpoints, and mix EXTRAPOLATES past t=1: unclamped, the grains nearest the
    // camera come out hotter than starlight and brighter than the absorption flare, which additive
    // blending turns into white blobs. gl_PointSize deliberately keeps the raw value — nearer really
    // is bigger.
    //
    // (And no backticks in here, ever. This file's own header says so and this comment is where it
    // bit for the third time — a backtick closes the template literal the shader source lives in.)
    float shade = clamp(scale, 0.0, 1.0);

    vHeat = shade;
    vAlpha =
      uOpacity * alive * lifecycle *
      mix(0.18, 0.8, shade) *
      (1.0 - uClearing * nearStar) *
      (1.0 - smoothstep(0.55, 1.0, uIgnite));

    // ⚠ BLOOM_SPREAD is what gives the halo somewhere to live. The grain itself is still uSize
    // across — the core's radius is a fraction of the sprite (see the fragment shader) — so this
    // widens the glow, not the dust. Cost is the square of it and it is the only price the bloom
    // charges; it is roughly paid for by the drop from dpr 2 to 1.5 in GatherCanvas.
    //
    // The held form gets more again (SHAPE_GRAIN_BOOST), because that is where the glow has to carry a
    // drawing rather than a stream. Faded in with the hold, so nothing changes size at a threshold.
    gl_PointSize =
      max(SIZE_MIN_PIXELS, uSize * BLOOM_SPREAD * mix(1.0, SHAPE_GRAIN_BOOST, hold) * uPixelRatio * scale);
  }
`;

export const GATHER_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform vec3 uColorCool;
  uniform vec3 uColorHot;

  varying float vAlpha;
  varying float vHeat;

  // ══ THE BLOOM ═══════════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ IT IS IN THE SPRITE, NOT IN A POST PASS, and that is a decision rather than a shortcut.
  //
  // A real bloom means a framebuffer, a downsample, two blur passes and a composite — and this is the
  // ONE canvas on the site that has to be drawing on its first frame and must never stutter, on a
  // thread that is simultaneously decoding 10 MB of models. It is also the canvas whose cost is very
  // nearly pure fill rate, so a post chain is the most expensive thing that could be added to it.
  //
  // What makes bloom READ is three things, and a point sprite can do all three for the price of a few
  // more pixels per grain: additive blending (already), a hot core that saturates toward white, and a
  // wide soft halo around it. The field is additive on near-black with 4 096 sampled points shared by
  // tens of thousands of grains — so the halos of neighbouring grains sum along a stroke, which is
  // exactly the light-bleeding-between-sources that a blur pass would be simulating.
  //
  // If a true post-processed bloom is ever wanted, the honest place to spend it is a quarter-res FBO
  // with a single separable blur. Do not add one on top of this — retune these first.

  /** How far out the core reaches, as a fraction of the sprite radius, and how hard it falls off. */
  const float BLOOM_CORE_RADIUS = 0.42;
  const float BLOOM_CORE_FALLOFF = 2.0;
  /** The halo runs the whole sprite. Higher falloff = tighter glow; lower = softer and wider. */
  const float BLOOM_HALO_FALLOFF = 2.6;
  const float BLOOM_HALO_STRENGTH = 0.55;
  /**
   * How far the core burns toward white where it is brightest.
   *
   * This is the part that reads as LIGHT rather than as a coloured dot. Real bloom whitens at the
   * source and keeps its colour in the spill, so the halo below is left on the temperature ramp.
   */
  const float BLOOM_WHITE_CORE = 0.55;

  void main() {
    if (vAlpha <= 0.0) discard;
    // 0 at the centre, 1 at the sprite's edge — so every radius below is a plain fraction.
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    if (radius > 1.0) discard;

    float core = pow(max(0.0, 1.0 - radius / BLOOM_CORE_RADIUS), BLOOM_CORE_FALLOFF);
    float halo = pow(max(0.0, 1.0 - radius), BLOOM_HALO_FALLOFF);
    float glow = core + halo * BLOOM_HALO_STRENGTH;

    // Cold ember in the void, warming toward starlight as it falls in.
    vec3 color = mix(uColorCool, uColorHot, vHeat);
    vec3 lit = mix(color, vec3(1.0), core * BLOOM_WHITE_CORE);

    // The absorption flare pushes intensity past 1 on purpose — the colour carries it (additive
    // blending saturates it into white-hot), while the alpha channel stays legal.
    float intensity = glow * vAlpha;
    gl_FragColor = vec4(lit * intensity, min(1.0, intensity));
  }
`;
