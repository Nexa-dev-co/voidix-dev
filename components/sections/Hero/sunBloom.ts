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
 * The cost is rendering the scene twice per DRAWN frame. That is affordable here and nowhere else:
 * the canvas is small, the model is ~10k verts, and `SunModelCanvas` is demand-rendered — it draws
 * nothing at all for the whole services → works → chamber span.
 */

// The sun's authored "Peaceful" bloom. This is now the only copy of it;
// they are the same three dials UnrealBloomPass exposes.
//
// NOTE ON `THRESHOLD`: UnrealBloom thresholds the composer's buffer, which sits at a different
// point in the tone-mapping chain than this pass does. The number is therefore a close analogue,
// not a guaranteed pixel match — expect to nudge it by eye.
/** The resting grade — Peaceful. The works section eases past these into Collapse; see `setGrade`. */
export const BLOOM_STRENGTH = 1.26;
export const BLOOM_RADIUS = 0.92;
export const BLOOM_THRESHOLD = 0.59;

/** How soft the cutoff at the threshold is, so bright edges don't alias into the glow. */
const THRESHOLD_KNEE = 0.22;

/**
 * Mip levels in the blur chain. UnrealBloom uses five; three is plenty at this canvas size and
 * keeps the per-frame cost of the second render path down. Each level halves again, so level 0 is
 * a tight core glow and level 2 is the wide bleed.
 */
const MIP_COUNT = 3;

/** Never let a mip collapse to nothing on a small canvas — a 0-sized target is a WebGL error. */
const MIN_MIP_SIZE = 4;

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
const COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tMip0;
  uniform sampler2D tMip1;
  uniform sampler2D tMip2;
  uniform float uStrength;
  uniform float uRadius;
  varying vec2 vUv;

  void main() {
    // uRadius blends the weighting between the tight mip and the wide ones, which is how
    // UnrealBloom turns one dial into "how far does the light spread".
    float w0 = mix(1.0, 0.40, uRadius);
    float w1 = mix(0.35, 0.75, uRadius);
    float w2 = mix(0.10, 1.00, uRadius);

    vec3 glow =
      texture2D(tMip0, vUv).rgb * w0 +
      texture2D(tMip1, vUv).rgb * w1 +
      texture2D(tMip2, vUv).rgb * w2;

    glow *= uStrength;

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
  /** Draw one frame: the scene to the canvas, then its glow on top. Replaces `renderer.render`. */
  render(scene: THREE.Scene, camera: THREE.Camera): void;
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
      tMip0: { value: null },
      tMip1: { value: null },
      tMip2: { value: null },
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
    sceneTarget.setSize(deviceWidth, deviceHeight);

    let mipWidth = deviceWidth;
    let mipHeight = deviceHeight;
    for (let level = 0; level < MIP_COUNT; level += 1) {
      mipWidth = Math.max(MIN_MIP_SIZE, Math.floor(mipWidth / 2));
      mipHeight = Math.max(MIN_MIP_SIZE, Math.floor(mipHeight / 2));
      mipTargets[level].setSize(mipWidth, mipHeight);
      blurTargets[level].setSize(mipWidth, mipHeight);
    }
  };

  const render = (scene: THREE.Scene, camera: THREE.Camera) => {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;

    // 1. The scene into a target — the glow's source, never shown.
    renderer.autoClear = true;
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

    // 4. The scene again, DIRECTLY to the canvas. Identical to the no-bloom path — the base image
    //    and its alpha never pass through a quad, so they cannot be corrupted by one.
    renderer.setRenderTarget(previousTarget);
    renderer.render(scene, camera);

    // 5. The glow, added on top. autoClear MUST be off here: `renderer.render` clears its target
    //    first by default, which would wipe the frame we just drew in step 4 and leave the glow
    //    floating on an empty canvas.
    renderer.autoClear = false;
    compositeMaterial.uniforms.tMip0.value = mipTargets[0].texture;
    compositeMaterial.uniforms.tMip1.value = mipTargets[1].texture;
    compositeMaterial.uniforms.tMip2.value = mipTargets[2].texture;
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

  return { render, setSize, setGrade, dispose };
}
