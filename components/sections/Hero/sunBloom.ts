import * as THREE from 'three';

/**
 * Bloom for the hero sun, on a TRANSPARENT canvas.
 *
 * WHY THIS EXISTS INSTEAD OF EffectComposer + UnrealBloomPass
 * ----------------------------------------------------------
 * The obvious approach was tried and it painted a visible RECTANGLE around the sun. A composer
 * ends with a full-screen quad blitting its render target to the canvas, and that quad writes
 * alpha across the WHOLE buffer — so the canvas stops being transparent and its box shows against
 * the cream hero. (The old procedural sun skipped post-processing for the same reason.)
 *
 * The fix is to never blit the base image. Instead:
 *
 *   1. render the scene into a target — used ONLY as the source for the glow
 *   2. bright-pass + blur that target down a small mip chain
 *   3. render the scene DIRECTLY to the canvas, exactly as before (so the base pixels and their
 *      alpha are byte-identical to the no-bloom path — nothing can regress)
 *   4. add the blurred glow on top with PURE additive blending, alpha included
 *
 * Step 4 is what makes it safe: with `One, One` on both colour and alpha, a pixel with no glow
 * adds nothing and stays fully transparent. Only where the star actually glows does alpha rise,
 * so the halo appears over the cream and the canvas box never does.
 *
 * The cost is rendering the scene twice per DRAWN frame, on the most overdraw-heavy surface on the
 * site (twenty additive corona planes over a fractured shell) — though step 1 now draws at
 * `GLOW_SOURCE_SCALE`, so the pair costs 1.25 full-resolution renders rather than 2. That used to be justified by the star
 * drawing "nothing at all for the whole services → works → chamber span" — which stopped being true
 * when the cracked star was given a collapse to play across the handoff. It now draws alongside the
 * fleet AND alongside the works field, so the second render is paid for most of the journey.
 *
 * Hence `refreshGlow`. Steps 4 and 5 — the base image and the composite — run on every drawn frame
 * and are untouched. Steps 1–3, which only ever feed the glow, may run on alternate frames: the mip
 * chain simply keeps its last contents, so the halo is at most one frame stale. At the star's idle
 * 11°/s that is 0.18° of lag on a wide blurred glow. The caller decides, and the rule it uses is
 * "never while anything is CHOREOGRAPHED" — see SunModelCanvas.
 */

// The sun's authored "Peaceful" bloom. This is now the only copy of it;
// they are the same three dials UnrealBloomPass exposes.
//
// NOTE ON `THRESHOLD`: UnrealBloom thresholds the composer's buffer, which sits at a different
// point in the tone-mapping chain than this pass does. The number is therefore a close analogue,
// not a guaranteed pixel match — expect to nudge it by eye.
/**
 * The resting grade — Peaceful. The works section eases past these into Collapse; see `setGrade`.
 *
 * ── ⚠ 1.32 → 0.85 ON 2026-08-13. THE HERO STAR WAS TOO BRIGHT, REPORTED TWICE. ──────────────────
 * This was the first stop of a journey-wide ramp added 2026-08-12 — **+5 % here, +17.5 % at works
 * (`COLLAPSE_BLOOM_STRENGTH`), +30 % at contact (`CONTACT_BLOOM_STRENGTH`)** — and that ramp's own
 * argument is what says this stop is the one to cut:
 *
 * > *"The hero is the one place the star sits against the CREAM rather than against black, which is
 * > why it takes the smallest share — the same glow reads far hotter on a light substrate."*
 *
 * The ramp was right that the hero needs the least and still gave it a rise. It needed a fall.
 *
 * ⚠ THE OTHER TWO STOPS ARE DELIBERATELY UNTOUCHED, and the ramp's "three stops on one line" property
 * is knowingly given up. Both of them play on BLACK — the collapse across the handoff and the death at
 * contact — where a hot star is the point and nothing has been reported as wrong. Dimming a finale to
 * preserve the evenness of a curve would be optimising the wrong thing. What actually changes is that
 * the collapse now climbs further from a lower base, which reads as more violent, not less.
 *
 * ⚠ It compounds with `MAGMA_EMISSIVE` 2.4 → 1.5 in the same sitting. The two are independent halves
 * of the same complaint: the magma is the light the star EMITS, this is the halo that light throws.
 * Cutting only one left it *"still a lot of brightness"*.
 *
 * Free: strength is a multiplier on an already-blurred mip chain. `BLOOM_RADIUS` and the mip count
 * are what cost, and neither moved.
 */
export const BLOOM_STRENGTH = 0.85; // was 1.32, and 1.26 before the ramp
export const BLOOM_RADIUS = 0.92;
/**
 * ⚠ 0.59 → 0.42 on 2026-08-12, and this was not a taste change — at 0.59 THE STAR DID NOT BLOOM AT ALL.
 *
 * ── ⚠ WHAT IT IS COMPARED AGAINST — CORRECTED 2026-08-13 ────────────────────────────────────────
 * This block used to open *"the bright pass reads the scene through ACES tone mapping at `EXPOSURE`,
 * so what `uThreshold` is compared against is not the texture and not the linear colour but the
 * TONE-MAPPED luma"*. **It does not.** three applies tone mapping ONLY when the render target is null
 * — both `WebGLPrograms.js` and `WebGLRenderer.js` gate it on `currentRenderTarget === null` — and
 * `sceneTarget` is a render target. So step 1 writes LINEAR HDR, `BRIGHT_PASS_FRAGMENT_SHADER` applies
 * no curve of its own, and this number is a cut in LINEAR space. Against ACES at `EXPOSURE` 1.42, a
 * linear 0.42 displays at ≈ 0.56.
 *
 * ⚠ Which leaves the table below reading against an unstated space. If those percentiles were taken
 * off the tone-mapped image — which the sentence they were written under implies — the effective cut
 * sits nearer the surface's top 3–4 % than the "top fifth" claimed at the end of this block. **The
 * VALUE is not in doubt**: 0.42 was arrived at by eye, on screen, and the star blooms correctly at it.
 * Only the explanation was wrong. A future re-grade should re-measure the distribution in linear
 * rather than trust either reading here.
 *
 * Measured over `sunouter_baseColor` composited at its own α 0.815 over the magma's
 * emissive backdrop, the star's whole surface lands at:
 *
 *     p50 0.364 · p90 0.445 · p95 0.519 · p99 0.726 · MAX 0.809
 *
 * At 0.59 that is 2.17 % of the surface — and `THRESHOLD_KNEE` puts full contribution at 0.81, so
 * **the star's single brightest pixel (0.809) could not reach full bloom anywhere on it.** A sliver of
 * a sliver, at a few percent strength. Visually: nothing.
 *
 * 0.59 was correct for what used to be here. The plasma's own body colour (`--heat-600`) tone-maps to
 * 0.594 — the threshold was graded so the plasma's BODY sat exactly at the cutoff and only its hotter
 * granules bloomed. That surface is gone; the model's own is a much darker distribution, and the
 * threshold had to be re-graded onto it rather than inherited.
 *
 * 0.42 puts roughly the top fifth of the surface into the glow — the hot veins and the limb — with the
 * top 1 % at full contribution and the mid-surface ramping softly through the knee. Below ~0.35 more
 * than half the star blooms and it stops reading as a glow and starts reading as haze.
 */
/**
 * ⚠ THINGS GRADED AGAINST THIS VALUE, WHICH MOVING IT SILENTLY RE-GRADES. Nothing enforces this list;
 * it exists because the 0.59 → 0.42 move below updated one of them and missed the other for a day.
 *
 *   · `COLLAPSE_BLOOM_THRESHOLD` (SunModelCanvas) — moved with it, ratio 0.712 preserved.
 *   · `PARTICLE_BRIGHTNESS` (lib/sunParticles) — ⚠ MISSED. It is an additive brightness chosen so the
 *     ring's coldest grains fall just short of blooming, so a lower threshold means every grain blooms
 *     and the ring reads as a solid glowing hoop. Re-graded 2026-08-13 by the same 0.712.
 *
 * Anything whose job is described as "must clear the bloom threshold" belongs here.
 */
export const BLOOM_THRESHOLD = 0.42; // was 0.59

/** How soft the cutoff at the threshold is, so bright edges don't alias into the glow. */
const THRESHOLD_KNEE = 0.22;

/**
 * Mip levels in the blur chain. Each level halves again, so level 0 is a tight core glow and the
 * last one is the wide bleed.
 *
 * ── ⚠ 3 → 5 ON 2026-08-13, PAID FOR BY THE ABLATION ──────────────────────────────────────────────
 * This said *"UnrealBloom uses five; three is plenty at this canvas size"*, and that was a judgement
 * about COST, not about the look — the note it sat next to is *"keeps the per-frame cost of the second
 * render path down"*. `SUN_OMITTED_PARTS` has since taken `flare` and `blowout` out of the star,
 * cutting `sun · bloom` 2.00 → 0.87 ms per call on the reference desktop, and this is one of the
 * places that budget is being spent back.
 *
 * What two more levels buy is REACH. At a 458² canvas and ratio ~1.9 the chain runs 435 → 217 → 108
 * device pixels; levels 3 and 4 add 54 and 27, which upsampled across the full canvas is the very wide,
 * very soft falloff a star's corona has and a three-level chain simply cannot express. Cost is 1/64 and
 * 1/256 of the frame's pixels plus six small quad draws — the cheapest quality on this canvas by a wide
 * margin.
 *
 * ⚠ THE GRADE IS HELD CONSTANT ACROSS THIS CHANGE, and `MIP_WEIGHTS` is what does it. More levels means
 * more taps summed into one pixel, so the naive version of this raises the star's total glow by ~60 %
 * at an unchanged `BLOOM_STRENGTH` — silently re-grading the site's centrepiece and breaking the
 * journey-wide +5 % / +17.5 % / +30 % ramp this file's header documents. The weights are renormalised
 * to the three-level sums instead, so `uStrength` means exactly what it meant before and the only thing
 * that changes is WHERE the light sits: a little less in the core, a lot more in the far falloff.
 */
// Annotated `number` rather than left to infer the literal `5`: this is a DIAL, and the weight builder
// below guards a one-level chain. Against the inferred literal TypeScript calls that guard dead code.
const MIP_COUNT: number = 5;

/** Never let a mip collapse to nothing on a small canvas — a 0-sized target is a WebGL error. */
const MIN_MIP_SIZE = 4;

/**
 * How much of the canvas the GLOW'S SOURCE is rendered at.
 *
 * ── ⚠ THE STAR USED TO BE DRAWN INTO THIS AT FULL RESOLUTION AND AVERAGED DOWN ONE PASS LATER ────
 * Step 1 rendered the whole scene into `sceneTarget` at the canvas's full device resolution, and step
 * 2 — the only pass that ever reads it — downsampled it by half into `mipTargets[0]`. Three quarters
 * of those fragments were thrown away immediately, on the most overdraw-heavy surface on the site:
 * eleven double-sided blended shells over the core and ten magma cells, submitted TWICE per drawn
 * frame (steps 1 and 4).
 *
 * At 0.5 the source lands at exactly the size `mipTargets[0]` already had, so the chain below is
 * IDENTICAL and the bright pass simply stops resampling. `MIP_WEIGHTS`, `BLOOM_RADIUS` and
 * `BLOOM_STRENGTH` all keep their exact meanings — nothing is re-graded, and that is the whole reason
 * this is free rather than a change to the star's look. The scene's per-frame fill goes from 2.0
 * full-resolution renders to 1.25: **−37.5 %**, which is not spent here but handed back to
 * `adaptivePixelRatio` and turned into resolution for the star AND the field.
 *
 * ⚠ WHAT IT COSTS: mip 0's texels used to be bilinear averages of four full-resolution texels, and are
 * now single texels of a half-resolution render. Level 0 is the TIGHT core glow, so if anything shows,
 * it will be a faint shimmer on the hot veins as the star turns — with five blur passes downstream of
 * it. **If it shows, raise this to 0.707 rather than reverting**: half the pixels instead of a quarter
 * (−25 % fill), the bright pass resamples 1.41:1, and the chain below is still untouched.
 *
 * See `docs/sun-mobile-quality-plan.md` §4.3.
 */
const GLOW_SOURCE_SCALE = 0.5;

/**
 * How the levels are weighted into the final glow, at each end of the `uRadius` dial.
 *
 * `uRadius` is what turns one number into *"how far does the light spread"* — at 0 the tight mip
 * dominates and the glow hugs the star, at 1 the wide ones do and it bleeds across the frame. The two
 * profiles below are the shapes that produced the authored three-level look:
 *
 *     tight   1.00 · 0.35 · 0.10      a geometric falloff, ratio ≈ 1/3
 *     wide    0.40 · 0.75 · 1.00      a straight ramp from near to far
 *
 * They are expressed as CURVES rather than as three literals so the chain length is a real dial, and
 * then renormalised to the sums those literals had. See MIP_COUNT for why the renormalisation is not
 * optional.
 */
/**
 * Where the glow starts and finishes fading toward the canvas edge, in the composite's own radial
 * metric: **0 is the centre, 1.0 is the nearest edge, 1.414 is a corner.**
 *
 * The star's BODY only reaches ~0.28 in that metric (`SUN_BODY_FILL` 0.723 ÷ `SUN_CANVAS_HEADROOM`
 * 2.6, halved), so a fade beginning at 0.75 leaves the glow untouched out to nearly three body radii
 * and only takes hold across the last quarter — where the alternative is not "more glow", it is a
 * straight-edged cut. Ending exactly at 1.0 puts zero on the edge itself.
 *
 * ⚠ Raising START toward 1.0 makes the fade tighter and brings the hard cut back; lowering it dims a
 * corona that is not in any trouble. If the halo now reads clipped rather than cut, the fix is a
 * bigger canvas (§4.6 stage 2), not this pair.
 */
const EDGE_FADE_START = 0.75;
const EDGE_FADE_END = 1;

const TIGHT_FALLOFF_PER_LEVEL = 1 / 3;
const WIDE_WEIGHT_NEAR = 0.4;
const WIDE_WEIGHT_FAR = 1;
/** The sums the authored three-level chain produced, and therefore what `uStrength` is graded against. */
const AUTHORED_TIGHT_SUM = 1.45;
const AUTHORED_WIDE_SUM = 2.15;

/** `[tight, wide]` per level, already renormalised. Mixed by `uRadius` in the composite shader. */
const MIP_WEIGHTS = (() => {
  const tight = Array.from({ length: MIP_COUNT }, (_, level) =>
    TIGHT_FALLOFF_PER_LEVEL ** level,
  );
  const wide = Array.from({ length: MIP_COUNT }, (_, level) =>
    MIP_COUNT === 1
      ? WIDE_WEIGHT_FAR
      : WIDE_WEIGHT_NEAR + (WIDE_WEIGHT_FAR - WIDE_WEIGHT_NEAR) * (level / (MIP_COUNT - 1)),
  );
  const tightScale = AUTHORED_TIGHT_SUM / tight.reduce((sum, value) => sum + value, 0);
  const wideScale = AUTHORED_WIDE_SUM / wide.reduce((sum, value) => sum + value, 0);
  return tight.map((value, level) => [value * tightScale, wide[level] * wideScale] as const);
})();

const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Rec. 709 luma — the same weighting the rest of the site reasons about brightness with.
const BRIGHT_PASS_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tScene;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;

  void main() {
    vec4 scene = texture2D(tScene, vUv);
    float luma = dot(scene.rgb, vec3(0.2126, 0.7152, 0.0722));
    // Soft knee: fade in across uKnee above the threshold rather than clipping, so a moving
    // highlight does not pop in and out of the glow as it crosses the cutoff.
    float contribution = smoothstep(uThreshold, uThreshold + uKnee, luma);
    // Weight by the scene's own alpha so transparent background pixels can never seed a glow.
    gl_FragColor = vec4(scene.rgb * contribution * scene.a, 1.0);
  }
`;

// Separable 9-tap Gaussian. Run once horizontally, once vertically, per mip.
const BLUR_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uDirection; // texel-sized step, already scaled by the spread
  varying vec2 vUv;

  void main() {
    // Weights for sigma ~2 over 9 taps, normalised.
    const float w0 = 0.2270270270;
    const float w1 = 0.1945945946;
    const float w2 = 0.1216216216;
    const float w3 = 0.0540540541;
    const float w4 = 0.0162162162;

    vec3 sum = texture2D(tSource, vUv).rgb * w0;
    sum += texture2D(tSource, vUv + uDirection * 1.0).rgb * w1;
    sum += texture2D(tSource, vUv - uDirection * 1.0).rgb * w1;
    sum += texture2D(tSource, vUv + uDirection * 2.0).rgb * w2;
    sum += texture2D(tSource, vUv - uDirection * 2.0).rgb * w2;
    sum += texture2D(tSource, vUv + uDirection * 3.0).rgb * w3;
    sum += texture2D(tSource, vUv - uDirection * 3.0).rgb * w3;
    sum += texture2D(tSource, vUv + uDirection * 4.0).rgb * w4;
    sum += texture2D(tSource, vUv - uDirection * 4.0).rgb * w4;

    gl_FragColor = vec4(sum, 1.0);
  }
`;

// The one pass that touches the canvas. Pure additive on colour AND alpha — see the header.
//
// ⚠ BUILT FROM `MIP_COUNT`, not written out by hand. It used to name tMip0/1/2 and three literal
// weight pairs in three places (here, the uniform block and step 5), so changing the chain length
// meant finding all three and the compiler could not tell you if you missed one. Plain words only
// inside the template — a backtick in here terminates the string.
const COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
  ${MIP_WEIGHTS.map((_, level) => `uniform sampler2D tMip${level};`).join('\n  ')}
  uniform float uStrength;
  uniform float uRadius;
  varying vec2 vUv;

  void main() {
    // uRadius blends the weighting between the tight mip and the wide ones, which is how
    // UnrealBloom turns one dial into "how far does the light spread".
    vec3 glow = vec3(0.0);
    ${MIP_WEIGHTS.map(
      ([tight, wide], level) =>
        `glow += texture2D(tMip${level}, vUv).rgb * mix(${tight.toFixed(5)}, ${wide.toFixed(5)}, uRadius);`,
    ).join('\n    ')}

    glow *= uStrength;

    // ── Fade the glow out before the canvas edge, so running out of room is invisible ────────────
    //
    // ⚠ THE GLOW REACHES THE EDGE AND IS CUT FLAT, which draws a straight-sided rectangle around the
    // star. SUN_CANVAS_HEADROOM (2.6) exists to stop exactly this and is no longer enough — most
    // visibly on a phone, where the hero square hits its 7rem floor and the layer is only ~291 CSS px
    // while the pin scales the star to SUN_SCROLL_SCALE across the fill.
    //
    // (No backticks anywhere in here. They terminate the template literal — the trap this file's
    // header and CLAUDE.md both record, and it has now bitten three times, every one from a comment.)
    //
    // This does NOT give the glow more room; it makes the boundary unfindable, which is the actual
    // complaint. Real room means a bigger canvas — see sun-mobile-quality-plan §4.6 stage 2, which is
    // a project rather than a constant and costs 2.4x the fill on the device least able to pay it.
    //
    // Measured from the CENTRE in UV space, so it is aspect-correct on a square canvas and slightly
    // oval on any other — which is what you want, since the falloff should follow the frame it is
    // hiding rather than a circle inscribed in it. Multiplicative on the summed glow, so it costs one
    // length, one smoothstep and one multiply per pixel, and cannot alter the grade anywhere the star
    // actually is: FADE_START is beyond where a correctly-framed corona has anything left.
    float edgeDistance = length(vUv - vec2(0.5)) * 2.0;
    glow *= 1.0 - smoothstep(${EDGE_FADE_START.toFixed(5)}, ${EDGE_FADE_END.toFixed(5)}, edgeDistance);

    // Alpha carries the glow's own brightness, so the halo is visible over the cream hero while a
    // pixel with no glow contributes exactly nothing and the canvas stays transparent there.
    //
    // MAX, not luminance, on purpose: a WebGL canvas composites as PREMULTIPLIED alpha, which is
    // only well-formed while every colour channel is <= alpha. Luminance under-weights red, so a
    // warm glow (which this always is) would come out with r > a and the browser would composite it
    // blown out. Taking the max keeps it valid. If the halo instead reads too SOLID, this is the
    // line to soften — scale it down, or swap to a luminance dot for a hotter, more additive look.
    float alpha = clamp(max(max(glow.r, glow.g), glow.b), 0.0, 1.0);
    gl_FragColor = vec4(glow, alpha);
  }
`;

export interface SunBloom {
  /**
   * Draw one frame: the scene to the canvas, then its glow on top. Replaces `renderer.render`.
   *
   * `refreshGlow` false reuses the previous frame's mip chain instead of re-deriving it — half the
   * scene renders, an identical base image, a halo one frame behind. Default true; see the header for
   * when it is safe to pass false.
   */
  render(scene: THREE.Scene, camera: THREE.Camera, refreshGlow?: boolean): void;
  setSize(width: number, height: number): void;
  /**
   * Re-grade the glow.
   *
   * Exposed because the star is not one look for the whole site: the works section eases it into the
   * Collapse pose, which is graded far hotter (2.5 / 1 / 0.42 against the resting
   * 1.26 / 0.92 / 0.59). Those three live in this module's uniforms, so without a setter the collapse
   * could change the star's shape and its light but not how that light blooms — which is most of what
   * makes a collapse read as a collapse.
   *
   * Cheap to call every frame: three uniform writes, no reallocation.
   */
  setGrade(strength: number, radius: number, threshold: number): void;
  /**
   * The target step 1 renders the scene into — the glow's source, never shown.
   *
   * Exposed for ONE purpose: this module draws the star's scene into two different surfaces (here, and
   * the canvas in step 4), and three builds a separate program for each. Anything warming this scene's
   * materials has to name both or half the work lands on the frame the glow first sees an object that
   * was hidden until then. Read `lib/warmScene.ts`'s header before touching it, and do not render into
   * it from outside — the mip chain below assumes it is written exactly once per glow refresh.
   */
  readonly glowSourceTarget: THREE.WebGLRenderTarget;
  dispose(): void;
}

function createTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    // Half-float so bright highlights keep their headroom above 1.0 instead of clipping before
    // they ever reach the bright pass — that headroom IS the bloom.
    type: THREE.HalfFloatType,
  });
  target.texture.generateMipmaps = false;
  return target;
}

export function createSunBloom(renderer: THREE.WebGLRenderer): SunBloom {
  // A flat quad rendered with a clip-space vertex shader, so no camera transform is involved. The
  // ortho camera is the conventional three full-screen-pass setup; the shader ignores its matrices
  // anyway, but keeping it conventional avoids surprises if a pass ever needs them.
  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const sceneTarget = createTarget(1, 1);
  const mipTargets: THREE.WebGLRenderTarget[] = [];
  const blurTargets: THREE.WebGLRenderTarget[] = [];
  for (let level = 0; level < MIP_COUNT; level += 1) {
    mipTargets.push(createTarget(1, 1));
    blurTargets.push(createTarget(1, 1));
  }

  const brightMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      uThreshold: { value: BLOOM_THRESHOLD },
      uKnee: { value: THRESHOLD_KNEE },
    },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: BRIGHT_PASS_FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });

  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: { tSource: { value: null }, uDirection: { value: new THREE.Vector2() } },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: BLUR_FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });

  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      // One sampler per level, built from the same list the shader was — see COMPOSITE_FRAGMENT_SHADER.
      ...Object.fromEntries(
        MIP_WEIGHTS.map((_, level) => [`tMip${level}`, { value: null as THREE.Texture | null }]),
      ),
      uStrength: { value: BLOOM_STRENGTH },
      uRadius: { value: BLOOM_RADIUS },
    },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: COMPOSITE_FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    // PURE additive, on colour and on alpha. This is the whole reason the canvas stays
    // transparent — three's stock AdditiveBlending multiplies by src alpha, which would dim the
    // glow by its own coverage and leave alpha untouched. See the header.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });

  // Built last so it can start on a real material — a throwaway placeholder would just be a
  // material to remember to dispose. `drawQuad` swaps it per pass.
  const quadMesh = new THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>(
    quadGeometry,
    brightMaterial,
  );
  quadMesh.frustumCulled = false;
  quadScene.add(quadMesh);

  const drawQuad = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => {
    quadMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  };

  const setSize = (width: number, height: number) => {
    // The targets work in DEVICE pixels, matching what the renderer actually draws, or the glow
    // would be sampled at the wrong scale on a retina panel.
    const pixelRatio = renderer.getPixelRatio();
    const deviceWidth = Math.max(MIN_MIP_SIZE, Math.round(width * pixelRatio));
    const deviceHeight = Math.max(MIN_MIP_SIZE, Math.round(height * pixelRatio));
    // ⚠ The SOURCE scales, the CHAIN does not. `mipTargets[0]` below keeps the size it has always had
    // — that is what makes this a saving rather than a re-grade. See GLOW_SOURCE_SCALE.
    sceneTarget.setSize(
      Math.max(MIN_MIP_SIZE, Math.floor(deviceWidth * GLOW_SOURCE_SCALE)),
      Math.max(MIN_MIP_SIZE, Math.floor(deviceHeight * GLOW_SOURCE_SCALE)),
    );

    let mipWidth = deviceWidth;
    let mipHeight = deviceHeight;
    for (let level = 0; level < MIP_COUNT; level += 1) {
      mipWidth = Math.max(MIN_MIP_SIZE, Math.floor(mipWidth / 2));
      mipHeight = Math.max(MIN_MIP_SIZE, Math.floor(mipHeight / 2));
      mipTargets[level].setSize(mipWidth, mipHeight);
      blurTargets[level].setSize(mipWidth, mipHeight);
    }
  };

  const render = (scene: THREE.Scene, camera: THREE.Camera, refreshGlow = true) => {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    // Set here rather than inside step 1, because step 4 depends on it and step 1 is now optional.
    renderer.autoClear = true;

    // Steps 1–3 exist ONLY to fill the mip chain. Skipping them leaves the previous frame's chain in
    // place, which step 5 then composites unchanged — the whole of what `refreshGlow` costs.
    if (refreshGlow) {
      // 1. The scene into a target — the glow's source, never shown.
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);

      // 2. Bright pass, straight into the first mip (which also downsamples it by half).
      brightMaterial.uniforms.tScene.value = sceneTarget.texture;
      drawQuad(brightMaterial, mipTargets[0]);

      // 3. Blur each mip, then downsample it into the next — so each level is progressively wider.
      for (let level = 0; level < MIP_COUNT; level += 1) {
        const target = mipTargets[level];
        const scratch = blurTargets[level];

        blurMaterial.uniforms.tSource.value = target.texture;
        blurMaterial.uniforms.uDirection.value.set(1 / target.width, 0);
        drawQuad(blurMaterial, scratch);

        blurMaterial.uniforms.tSource.value = scratch.texture;
        blurMaterial.uniforms.uDirection.value.set(0, 1 / target.height);
        drawQuad(blurMaterial, target);

        // Seed the next (smaller) level from this blurred one.
        const next = mipTargets[level + 1];
        if (next) {
          blurMaterial.uniforms.tSource.value = target.texture;
          blurMaterial.uniforms.uDirection.value.set(1 / target.width, 0);
          drawQuad(blurMaterial, next);
        }
      }
    }

    // 4. The scene again, DIRECTLY to the canvas. Identical to the no-bloom path — the base image
    //    and its alpha never pass through a quad, so they cannot be corrupted by one.
    renderer.setRenderTarget(previousTarget);
    renderer.render(scene, camera);

    // 5. The glow, added on top. autoClear MUST be off here: `renderer.render` clears its target
    //    first by default, which would wipe the frame we just drew in step 4 and leave the glow
    //    floating on an empty canvas.
    renderer.autoClear = false;
    mipTargets.forEach((target, level) => {
      compositeMaterial.uniforms[`tMip${level}`].value = target.texture;
    });
    drawQuad(compositeMaterial, previousTarget);

    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  };

  const dispose = () => {
    sceneTarget.dispose();
    mipTargets.forEach((target) => target.dispose());
    blurTargets.forEach((target) => target.dispose());
    quadGeometry.dispose();
    brightMaterial.dispose();
    blurMaterial.dispose();
    compositeMaterial.dispose();
  };

  const setGrade = (strength: number, radius: number, threshold: number) => {
    compositeMaterial.uniforms.uStrength.value = strength;
    compositeMaterial.uniforms.uRadius.value = radius;
    brightMaterial.uniforms.uThreshold.value = threshold;
  };

  return { render, setSize, setGrade, glowSourceTarget: sceneTarget, dispose };
}
