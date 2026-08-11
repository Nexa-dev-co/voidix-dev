import * as THREE from 'three';

/**
 * The gate the fleet cycles through — one procedural portal, drawn on a single quad.
 *
 * The whole thing is a pure function of ONE uniform, `uFormation` (0 = nothing, 1 = a ready gate),
 * which walks the ten authored stages in order:
 *
 *   sparks → energy gathering → shaping → rim forming → rim stabilizing
 *          → energy flow → stabilizing → fully formed → stable → ready
 *
 * That single value is what makes the collapse free: run it back down and the gate un-forms through
 * the same stages in reverse, so there is no separate teardown animation to keep in sync.
 *
 * ── Why the stages fall out of two numbers ───────────────────────────────────────────────────────
 * The ellipse is described by its two semi-axes, and the early stages ARE degenerate ellipses:
 *
 *   ry grows first, rx stays ~0  →  a bright vertical LINE          (stages 2–3)
 *   rx then opens out           →  the line bows into an ellipse    (stages 4–5)
 *
 * So "shaping" is not a separate effect layered on top — it is the same ellipse with one axis still
 * closed. `rx` is floored at LINE_HALF_WIDTH rather than 0, and that floor is exactly the thickness
 * of the vertical line the reference shows in stage 3.
 *
 * ── Additive, and deliberately not bloomed ───────────────────────────────────────────────────────
 * The deck's bloom pass ships DISABLED (see BLOOM_ENABLED in useServicesDeck): with every stage light
 * at 0 the hulls are lit only by the cracked sun, and blooming their accents read as haze. So the
 * gate carries its own glow — a hot core plus a wide halo, additively blended — exactly as
 * `sunParticles` does for the sun's ring. Switching bloom back on for the gate would re-bloom the
 * whole fleet with it.
 *
 * Depth TESTING stays on while depth WRITING is off, so the craft correctly passes in front of the
 * gate on its way in and is hidden by nothing on its way out.
 *
 * ⚠ ── The gate's MESH hides. Its LIGHT never does. See `update`. ─────────────────────────────────
 * This used to hide the whole group, which took the point light out of the scene with it, and that
 * froze the craft for a few hundred milliseconds on the frame the gate closed. The reason is in
 * `update`'s comment; it is the single least obvious thing in this file.
 */

// ── The ring, and the room around it ──
// The shader works in its OWN space: the ring's semi-axes are the two numbers below, and the quad's
// border sits at ±QUAD_MARGIN. Everything else in here — filament thickness, halo falloff, the base
// flare, the spark column — is expressed against the RING, so the quad can be widened by changing one
// number and none of the rest has to be retuned.
//
// That room is not spare. It is where the glow fades out, and an additive glow still burning when it
// reaches the quad's border is cut flat and draws a lit RECTANGLE around the gate. Softening the cut
// is not enough on its own: a soft rectangular gradient is still a rectangle. The only real fix is
// for there to be nothing left by the time the border arrives.
const ELLIPSE_RADIUS_X = 0.40;
const ELLIPSE_RADIUS_Y = 0.78;
/** How far past the ring the quad reaches, in that same space. Pure fade room. */
const QUAD_MARGIN = 1.7;
/** How brightly the base burns during the column stages, relative to the formed gate. */
const BASE_EARLY_GAIN = 0.55;
/**
 * The ring as a fraction of the quad's HALF-SIZE — what the deck needs in order to place the gate:
 * its width decides whether a pair fits beside the hull, its height where the ring's centre sits.
 * Derived rather than authored, so the two can never disagree about how big the visible ring is.
 */
export const PORTAL_GATE_RADIUS_X = ELLIPSE_RADIUS_X / QUAD_MARGIN;
export const PORTAL_GATE_RADIUS_Y = ELLIPSE_RADIUS_Y / QUAD_MARGIN;
const RADIUS_X = ELLIPSE_RADIUS_X;
const RADIUS_Y = ELLIPSE_RADIUS_Y;
/** The floor on the horizontal semi-axis — and so the width of the vertical line in stage 3. */
const LINE_HALF_WIDTH = 0.014;

// ── Stage windows, as fractions of uFormation ──
// They overlap on purpose: the reference's ten frames are a continuous build, not ten states, so
// each beat is already under way before the previous has finished.
const COLUMN_RISE: [number, number] = [0.02, 0.30]; // the column climbs
const RIM_OPEN: [number, number] = [0.30, 0.62];    // …then bows out into the ellipse
const SPARKS: [number, number] = [0.00, 0.26];      // stage 1, gone by the time the line is bright
const RIM_POWER: [number, number] = [0.16, 0.72];   // how hard the rim and its filaments burn
const INTERIOR: [number, number] = [0.58, 0.94];    // the surface fills in

// ── Look ──
// The gate burns on the SUN's temperature ramp, not on a palette picked for this section: `#d92a05` →
// `#ffeeb8` are the accretion spiral's authored colours, and they are already what the
// loader's gather field runs on (see `gatherShader.ts` GATHER_DEFAULTS and
// `lib/accretionShader.ts`). Same matter, same light — the dust that builds the star, the gate the fleet flies
// through, and the spiral that falls into the black hole at the end are one arc. Keep all three in
// step if the spiral is ever retuned.
//
// (This was a blue ramp, which made the gate read as brand cyan — a portal lit by a different physics
// to everything around it.)
/** Starlight, at its hottest — the rim itself. */
const COLOR_CORE = new THREE.Color('#ffeeb8');
/** Cooling ember, radiating outward: filaments + halo. */
const COLOR_EDGE = new THREE.Color('#d92a05');
/** The churning surface inside the ring. The same ember, deep enough for the rim to burn against it. */
const COLOR_INNER = new THREE.Color('#6b1a04');
const INTENSITY = 1.0;

// ── The light the gate throws into the room ──
// Not decoration. Every rig light on this deck is 0, so without this the craft would fly into and out
// of a blazing gate completely unlit by it.
//
// Deliberately warmer and less saturated than COLOR_EDGE: a hull lit by raw `#d92a05` goes flat red
// and stops reading as metal. `#ff7a2a` is the amber the rest of the site already lights hot rock with
// (`meteorBody`'s emissive, the mark's `lava` variant).
const LIGHT_COLOR = 0xff7a2a;
// Raised with GATE_DEPTH: the gate now stands five units behind the pad, so with a decay of 2 the
// craft only really catches this light as it closes on the gate — which is the point, but it needs
// the headroom to read at all from the pad.
const LIGHT_INTENSITY = 10;
const LIGHT_DISTANCE = 14;
const LIGHT_DECAY = 2;
/** Sits slightly in front of the gate's plane, so it lights the hull rather than the gate's own back. */
const LIGHT_FORWARD_OFFSET = 0.5;

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vQuadPosition;

  void main() {
    // The quad is a unit plane, so this lands in -1..1 with y up.
    vQuadPosition = (uv - 0.5) * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uFormation;
  uniform float uIntensity;
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  uniform vec3 uColorInner;

  varying vec2 vQuadPosition;

  const float RADIUS_X = ${RADIUS_X.toFixed(3)};
  const float RADIUS_Y = ${RADIUS_Y.toFixed(3)};
  const float LINE_HALF_WIDTH = ${LINE_HALF_WIDTH.toFixed(4)};
  const float QUAD_MARGIN = ${QUAD_MARGIN.toFixed(3)};
  // A backstop, not a tuning. With the margin above there is nothing left to cut by the time the
  // border arrives (measured: under 0.003 of peak), so this never visibly bites — it is here so a
  // later change to the radii cannot quietly reintroduce the rectangle.
  const float EDGE_FADE = 0.25;
  // Nothing may arrive at full strength on the frame the gate becomes visible. The sparks in
  // particular are live from formation 0, so without this they pop in at full brightness the instant
  // the gate turns visible. Runs at both ends of the range, so the collapse lets go just as gently.
  const float EMERGENCE_FADE = 0.05;
  // ── The early reject's two thresholds — see the block in main() for the derivation ──
  // How far outside the ring anything can still be bright enough to matter, in ellipseDistance units.
  const float STRAND_REACH = 0.65;
  // What counts as "not there". Four terms are each bounded by this, so together they stay under the
  // 0.001 the discard at the bottom already rejects.
  const float NOTHING_HERE = 0.0002;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 offset = fract(p);
    offset = offset * offset * (3.0 - 2.0 * offset);
    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, offset.x), mix(c, d, offset.x), offset.y);
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 3; octave += 1) {
      sum += valueNoise(p) * amplitude;
      p *= 2.03;
      amplitude *= 0.5;
    }
    return sum;
  }

  float window(vec2 range, float value) {
    return clamp((value - range.x) / (range.y - range.x), 0.0, 1.0);
  }

  // Distance from p to the ellipse with semi-axes r, with the level set pushed out by bulge.
  //
  // The trailing k1 factor is not decoration. Without it this is (k1-1)/k2, which under-reports the
  // distance by a factor of k1 — fine near the rim where k1 is about 1, catastrophic anywhere else.
  // Stages 2-4 are a nearly COLLAPSED ellipse (rx is floored at LINE_HALF_WIDTH while ry is full), and
  // there k1 reaches ~70 out at the quad's border: every point in the quad then reports as sitting on
  // the rim, and the whole quad lights up. That was the flare on appear and collapse.
  //
  // With the factor it is exact on both axes and degrades gracefully in between, including when one
  // axis collapses to a line — which is precisely what the early stages are.
  float ellipseDistance(vec2 p, vec2 r, float bulge) {
    float k1 = length(p / r);
    float k2 = length(p / (r * r));
    return (k1 + bulge - 1.0) * k1 / max(k2, 1e-4);
  }

  mat2 rotation(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, -s, s, c);
  }

  void main() {
    // Into the shader's own space: the ring is RADIUS_X/Y here, the quad's border is QUAD_MARGIN.
    vec2 p = vQuadPosition * QUAD_MARGIN;

    float columnRise = smoothstep(0.0, 1.0, window(vec2(${COLUMN_RISE[0].toFixed(3)}, ${COLUMN_RISE[1].toFixed(3)}), uFormation));
    float rimOpen    = smoothstep(0.0, 1.0, window(vec2(${RIM_OPEN[0].toFixed(3)}, ${RIM_OPEN[1].toFixed(3)}), uFormation));
    float rimPower   = window(vec2(${RIM_POWER[0].toFixed(3)}, ${RIM_POWER[1].toFixed(3)}), uFormation);
    float interior   = window(vec2(${INTERIOR[0].toFixed(3)}, ${INTERIOR[1].toFixed(3)}), uFormation);
    float sparkLife  = 1.0 - window(vec2(${SPARKS[0].toFixed(3)}, ${SPARKS[1].toFixed(3)}), uFormation);

    // The two semi-axes. rx floored rather than zeroed — that floor IS the vertical line of stage 3.
    float rx = max(RADIUS_X * rimOpen, LINE_HALF_WIDTH);
    float ry = max(RADIUS_Y * columnRise, 0.001);

    // Signed distance to the ring itself. Needed by the halo and the interior below, and hoisted here
    // because the early reject is expressed in it.
    float haloDistance = ellipseDistance(p, vec2(rx, ry), 0.0);

    // ── The base ──
    // Where the gate meets the ground: a hot point with the ring standing out of it, and light
    // running away along the floor. Noise-free, so it is cheap enough to sit above the reject.
    vec2 basePoint = vec2(0.0, -ry);
    vec2 toBase = p - basePoint;
    float flare = exp(-length(toBase * vec2(1.6, 3.4)) * 5.5);
    float groundStreak = exp(-abs(toBase.y) * 26.0) * exp(-abs(toBase.x) * 3.6) * 0.4;
    // The base is lit through the column stages, before the rim has any power — but at a fraction of
    // its formed strength, or it sits at nearly full brightness while the ring is barely there.
    float base = (flare + groundStreak) * max(rimPower, columnRise * ${BASE_EARLY_GAIN.toFixed(2)});

    // ── Early reject — everything past this line is the expensive half of the shader ──
    // The strand loop and the interior swirl are 48 of this shader's ~50 noise samples, and the ring
    // is small inside a quad that reaches +/-QUAD_MARGIN purely so the glow has room to fade out (see
    // the note at the top of the file). Two of these quads cover roughly 64 percent of the screen for
    // the whole 2.8 s of a swap, and most of those fragments were ALREADY being thrown away by the
    // discard at the bottom — after being paid for in full.
    //
    // So bound every term that could still survive out here, using only what is computed above and no
    // noise whatsoever:
    //
    //   · the strands are the same ellipse pushed about by the bulge, whose magnitude is at most
    //     0.5 * 0.21 (the widest wobble times the widest wander), scaled by k1/k2 <= max(rx, ry) =
    //     0.78 — so a strand never sits more than 0.082 further out than haloDistance. The widest of
    //     them is exp(-d / 0.070) * 0.21, under NOTHING_HERE by d = 0.55. 0.55 + 0.082 rounds to 0.65.
    //   · the halo is exp(-d / 0.10) * 0.05, under NOTHING_HERE by d = 0.56 — inside the same reach.
    //   · the base and the spark column are noise-free, so they are simply evaluated and tested.
    //   · the surface only exists at haloDistance < 0, and cannot reach out here at all.
    //
    // Each bound is NOTHING_HERE, so all four together stay below the 0.001 the discard already
    // rejects: this can only remove fragments that were being discarded anyway, which is why it is
    // safe to call it free rather than nearly free.
    //
    // ⚠ Derived at uIntensity 1 (INTENSITY in this file). Raise that and both thresholds move.
    float sparkReach =
      exp(-abs(p.x) * 9.0) * exp(-max(p.y - basePoint.y, 0.0) * 1.4) * sparkLife * 2.2;
    if (haloDistance > STRAND_REACH && base < NOTHING_HERE && sparkReach < NOTHING_HERE) discard;

    // Direction around the ring, taken from the raw quad position so it has no seam at the angle
    // wrap — atan() here would put a hard discontinuity down the gate's left side.
    vec2 direction = normalize(p + vec2(1e-5));

    float energy = 0.0;

    // ── The rim, plus two looser filaments tangled around it ──
    // Each strand is the same ellipse with its radius pushed about by noise, so they read as one
    // discharge rather than three rings. The strands crawl at different rates and in opposite
    // directions, which is what stops the tangle looking like a texture being rotated.
    for (int strand = 0; strand < 3; strand += 1) {
      float index = float(strand);
      float crawl = uTime * (0.55 + index * 0.42) * (mod(index, 2.0) < 0.5 ? 1.0 : -1.0);
      float frequency = 2.6 + index * 3.1;
      float wobble = (fbm(rotation(crawl) * direction * frequency) - 0.5);

      // Strand 0 is the rim itself — tight and hot; the others wander further and burn softer.
      float wander = index < 0.5 ? 0.035 : 0.11 + index * 0.05;
      float thickness = index < 0.5 ? 0.024 : 0.040 + index * 0.015;
      float gain = index < 0.5 ? 1.0 : 0.42 / max(index, 1.0);

      // Gradient-normalised, so the band keeps an even thickness all the way round instead of
      // pinching at the ends of the ellipse.
      float distance = ellipseDistance(p, vec2(rx, ry), wobble * wander * rimOpen);

      energy += exp(-abs(distance) / thickness) * gain;
    }
    energy *= rimPower;

    // A soft halo so the gate sits in the air rather than being cut out of it.
    float halo = exp(-abs(haloDistance) / 0.10) * 0.05 * rimPower;

    // ── The surface inside the ring ──
    // Slow churning noise, only once the rim can hold it.
    float swirlAngle = uTime * 0.22;
    float swirl = fbm(rotation(swirlAngle) * p * 3.4 + vec2(uTime * 0.14, 0.0));
    float inside = smoothstep(0.0, -0.16, haloDistance) * interior;
    float surface = inside * (0.30 + swirl * 0.75);

    // ── Stage 1: the sparks, before there is anything to be part of ──
    // A narrow column of motes climbing out of the base point. They are gone by the time the line is
    // bright, so they only ever cost anything in the first quarter of the formation.
    float sparks = 0.0;
    if (sparkLife > 0.001) {
      vec2 sparkSpace = vec2(p.x * 14.0, (p.y - basePoint.y) * 5.0 - uTime * 1.6);
      vec2 cell = floor(sparkSpace);
      vec2 local = fract(sparkSpace) - 0.5;
      vec2 jitter = vec2(hash21(cell) - 0.5, hash21(cell + 7.3) - 0.5) * 0.7;
      float mote = exp(-length(local - jitter) * 9.0);
      // Fade with height, so they thin out as they climb rather than ending on a hard line.
      float column = exp(-abs(p.x) * 9.0) * exp(-max(p.y - basePoint.y, 0.0) * 1.4);
      sparks = mote * column * sparkLife * 2.2;
    }

    vec3 color =
      uColorCore * (energy + base) +
      uColorEdge * (halo + sparks) +
      uColorInner * surface;

    // Fade everything out before the quad's border, so no term can ever be cut flat by it.
    vec2 edgeDistance = vec2(QUAD_MARGIN) - abs(p);
    float border = smoothstep(0.0, EDGE_FADE, min(edgeDistance.x, edgeDistance.y));
    float emergence = smoothstep(0.0, EMERGENCE_FADE, uFormation);
    float master = border * emergence;

    float alpha = (energy + base + halo + sparks + surface) * uIntensity * master;
    if (alpha <= 0.001) discard;

    // Additive: alpha carries the same intensity so it composites correctly wherever it lands.
    gl_FragColor = vec4(color * uIntensity * master, alpha);
  }
`;

export interface PortalGate {
  /** Add this to the deck's scene. */
  object: THREE.Group;
  /**
   * Place the gate and turn it to face a point (the camera). The quad is scaled uniformly, so `size`
   * is its full height in world units and the ellipse's proportions stay as authored.
   */
  setPose(position: THREE.Vector3, faceTarget: THREE.Vector3, size: number): void;
  /** Drive the whole gate from its formation value. */
  update(elapsedSeconds: number, formation: number): void;
  dispose(): void;
}

/**
 * One gate. The deck builds two and hands each its own pose — see the layout in `useServicesDeck`,
 * which decides whether they sit either side of the pad or collapse to a single gate behind it.
 */
export function createPortalGate(): PortalGate {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFormation: { value: 0 },
      uIntensity: { value: INTENSITY },
      uColorCore: { value: COLOR_CORE.clone() },
      uColorEdge: { value: COLOR_EDGE.clone() },
      uColorInner: { value: COLOR_INNER.clone() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Drawn after the hulls. Additive blending is order-independent, so this is only about the DEPTH
  // test: the gate stands behind the craft, and drawing it later lets the hull correctly occlude the
  // part of the ring it is in front of.
  mesh.renderOrder = 2;
  // Driven by `update` from here on. The GROUP stays visible for the life of the page — see below.
  mesh.visible = false;

  const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_DISTANCE, LIGHT_DECAY);

  const object = new THREE.Group();
  object.add(mesh, light);

  const forward = new THREE.Vector3();

  const setPose = (position: THREE.Vector3, faceTarget: THREE.Vector3, size: number) => {
    object.position.copy(position);
    mesh.scale.setScalar(size);
    // Yaw only. A full lookAt would tip the gate off the floor as the camera sits above it, and the
    // base flare has to stay where the gate meets the ground.
    object.rotation.y = Math.atan2(faceTarget.x - position.x, faceTarget.z - position.z);
    // Push the light toward whatever the gate faces, so it throws light into the room.
    forward.set(faceTarget.x - position.x, 0, faceTarget.z - position.z).normalize();
    light.position.copy(forward).multiplyScalar(LIGHT_FORWARD_OFFSET);
  };

  const update = (elapsedSeconds: number, formation: number) => {
    const standing = formation > 0.001;

    // ⚠ ── Hide the MESH. Never the group, and never the LIGHT. ─────────────────────────────────────
    // This was `object.visible = formation > 0.001`, which is the obvious way to write it and cost a
    // few hundred milliseconds of frozen craft on the frame the gate finished closing.
    //
    // The deck's rig is three DirectionalLights and an AmbientLight, so THESE ARE THE SCENE'S ONLY
    // POINT LIGHTS. Taking the group out of the scene took the light with it, walking the visible
    // point-light count 0 → 2 → 0 across every swap. And `numPointLights` is part of three's program
    // cache key (WebGLPrograms.js, `getProgramCacheKeyParameters`) — so on the frame the count
    // changed, every visible material had to compile and LINK a fresh GLSL program. The hulls are
    // MeshPhysicalMaterial with clearcoat, iridescence and an injected shader: about the most
    // expensive program three can build, and a single one of them was traced here at 69 ms.
    //
    // It landed on the CLOSE rather than the open because of which programs already existed. The
    // warm-up opens the gates to PORTAL_PREWARM_FORMATION with every hull forced visible, so the
    // whole fleet gets warmed at 2 point lights — but only the centred craft is drawn afterwards, so
    // only IT ever built the 0-light variant. Every other ship first needed one at the instant the
    // gate shut behind it, which is the instant it had just arrived and was the only thing moving.
    //
    // Keeping the light in the scene at intensity 0 pins the count at 2 for the life of the page: the
    // warm-up compiles the same variant every real frame then uses, nothing is ever relinked, and the
    // fix cannot be re-broken by a later change to the gate's own visibility. The cost is two light
    // loop iterations per hull fragment, which does not register beside this shader.
    //
    // (Warming BOTH variants in the loader was the alternative. Rejected: it doubles the link work on
    // the one thing the loader gate actually waits for, and it only patches this instance — any future
    // light that comes and goes would reintroduce the same stall.)
    mesh.visible = standing;
    // The light follows the rim's own power rather than the raw formation, so the room does not
    // brighten while there is still only a column of sparks standing there.
    light.intensity = standing ? LIGHT_INTENSITY * formation * formation : 0;
    if (!standing) return;

    material.uniforms.uTime.value = elapsedSeconds;
    material.uniforms.uFormation.value = formation;
  };

  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };

  return { object, setPose, update, dispose };
}
