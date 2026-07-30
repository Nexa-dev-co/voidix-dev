import * as THREE from 'three';
import type { SunScreenRect } from '@/lib/sunPlacement';

/**
 * The sun, drawn INSIDE the space render.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * For the whole site the sun is a `position: fixed` DOM billboard sitting BEHIND the works canvas, and
 * it shows through wherever the space is empty. That works everywhere except the one place it matters
 * most. The chamber reveal shrinks the space into a screen standing in a room, and a screen-pinned DOM
 * element cannot go with it:
 *
 *   • behind the canvas it is invisible — the room sets an opaque `scene.background` and the display's
 *     own alpha closes over OPAQUE_WINDOW, so nothing behind the canvas survives past ~0.12
 *   • in front of it, it is a flat rectangle over a screen the tour views at an ANGLE, and a 2D
 *     transform cannot skew to match
 *
 * Both were tried. The fix is to stop compositing the sun over the picture and put it in the picture:
 * sample the sun's canvas as a texture and draw it as a backdrop inside the space scene. From then on
 * it is just another thing in the render — it lands on the table with correct perspective, it is
 * occluded by the mark, and it needs no per-section special cases at all.
 *
 * ── Why sampling the canvas is legal ─────────────────────────────────────────────────────────────
 * `SunModelCanvas` already runs `preserveDrawingBuffer: true`, because it is demand-rendered and its
 * last frame has to keep compositing while it is not drawing. That is exactly the condition a texture
 * upload needs: the buffer is still there to be read. Nothing had to change on the sun's side.
 *
 * ── Clip space, not a camera-attached quad ───────────────────────────────────────────────────────
 * The vertex shader writes `gl_Position` directly, so the sun's placement is a screen rectangle rather
 * than a world position at a depth. That matters because the works camera's field of view is authored
 * PER STOP (36–46°) — a world-space quad would change size every time the lens did, and the sun is
 * supposed to be infinitely far away and therefore fixed. This is the same trick `spacePresentMaterial`
 * uses for the full-bleed quad, for the same reason.
 */

const VERTEX_SHADER = /* glsl */ `
  uniform vec2 uCenter; // NDC
  uniform vec2 uSize;   // NDC, full width and height
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // PlaneGeometry(1, 1) spans -0.5..0.5, so this lands the quad exactly on the rectangle asked for.
    gl_Position = vec4(uCenter + position.xy * uSize, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uKnee;
  uniform float uCeiling;
  uniform float uOutputExposure;
  varying vec2 vUv;

  // The canvas is sRGB-encoded (it is a composited page canvas, not a linear render target), and this
  // material writes into the space pipeline, which is LINEAR — the encode happens later, in the screen
  // composer's OutputPass. A raw ShaderMaterial gets no automatic decode, so it is done by hand.
  vec3 srgbToLinear(vec3 channel) {
    return mix(
      channel / 12.92,
      pow((channel + 0.055) / 1.055, vec3(2.4)),
      step(0.04045, channel)
    );
  }

  // ── Stop the star blooming twice ──
  // The sun's canvas ALREADY contains its own bloom (see sunBloom.ts) — the glow is painted into the
  // pixels. Dropping those pixels into the space scene put them through the field's bloom pass as well,
  // and a near-white core is far over that pass's threshold, so the star flared the instant the render
  // took it over.
  //
  // Scaling the whole thing down is the obvious fix and the wrong one: it dims the soft falloff, which
  // is the part that is already correct and is most of what you actually see. So this is a soft KNEE
  // instead: below uKnee nothing changes at all, and above it the value asymptotes to uCeiling, which
  // is set just under the bloom pass's threshold. The core stops being able to trigger the pass;
  // everything else is untouched.
  //
  // Per channel rather than on luminance, deliberately: luminance is a weighted average and can never
  // exceed the largest channel, so clamping each channel under the ceiling guarantees the luminance is
  // under it too. Being conservative here is free.
  vec3 softKnee(vec3 channel) {
    vec3 excess = max(vec3(0.0), channel - uKnee);
    vec3 range = vec3(max(uCeiling - uKnee, 0.0001));
    return min(channel, uKnee + range * (1.0 - exp(-excess / range)));
  }

  // ── Undo the tone map this star is about to be put through a SECOND time ──
  // The sun's canvas is a FINISHED image: it was rendered with ACES and encoded to sRGB by its own
  // renderer. Dropping it into the space scene means the works pipeline then tone-maps it again on the
  // way out — Neutral, with an exposure of its own — and two tone maps in series is not a tone map. It
  // lifted the whole star and pushed its hue toward yellow, which is what made the copy on the tablet
  // visibly not match the one on screen beside it.
  //
  // So the value written here is pre-divided by that second operator. Only its below-knee branch is
  // inverted, which is the only branch this can reach: the compression below keeps every channel under
  // the ceiling, and the forward operator returns early for anything under its own start-compression.
  // The offset is estimated from the target rather than the source — they differ by less than the
  // offset itself, and it is at most 0.04.
  vec3 undoOutputToneMap(vec3 target) {
    float darkest = min(target.r, min(target.g, target.b));
    float offset = darkest < 0.08 ? darkest - 6.25 * darkest * darkest : 0.04;
    return (target + offset) / max(uOutputExposure, 0.0001);
  }

  void main() {
    vec4 texel = texture2D(uMap, vUv);
    // The browser composites a canvas with PREMULTIPLIED alpha, so the colour has to be recovered
    // before it can be decoded and then premultiplied again. Decoding it premultiplied would darken
    // every partially transparent pixel — which, on a star that is mostly soft falloff, is most of it.
    vec3 straight = texel.a > 0.0001 ? texel.rgb / texel.a : vec3(0.0);
    // Decode, undo the tone map that is coming, THEN compress. In that order: the knee has to be the
    // last word, because it is what the bloom pass will actually see.
    vec3 graded = softKnee(undoOutputToneMap(srgbToLinear(straight)));
    gl_FragColor = vec4(graded * texel.a, texel.a) * uOpacity;
  }
`;

/** Drawn before everything else in the space scene, so the mark and the debris occlude it. */
const BACKDROP_RENDER_ORDER = -1000;

/**
 * How far under the field's bloom threshold the star's brightest pixel is allowed to land.
 *
 * Derived from the threshold rather than authored, so re-grading the field's bloom cannot silently
 * reintroduce the double-flare. The margin only has to clear the pass's soft knee.
 */
const BLOOM_HEADROOM = 0.04;
/** Where the compression starts, as a fraction of the ceiling. Below this the star is untouched. */
const KNEE_FRACTION = 0.78;

export interface SunBackdrop {
  object: THREE.Mesh;
  /** Place it on the screen rectangle the DOM sun occupies. Call on setup and on resize. */
  setRect: (rect: SunScreenRect, viewportWidth: number, viewportHeight: number) => void;
  /**
   * Cross-fade against the DOM sun. 0 hides it entirely AND stops the per-frame texture upload, so it
   * costs nothing outside the reveal.
   */
  setOpacity: (opacity: number) => void;
  /** Re-read the sun's canvas. Call once per drawn frame while the backdrop is visible. */
  refresh: () => void;
  dispose: () => void;
}

/**
 * Build it, or return null if the sun's canvas isn't in the DOM.
 *
 * Null rather than throwing because the sun is genuinely optional: `useIsLowPowerViewport` can unmount
 * the hero's effects, and a phone that never mounts a sun should still get a works field.
 */
export function createSunBackdrop(
  sunCanvas: HTMLCanvasElement | null,
  /** The field's bloom threshold, so the knee below can be derived from it rather than guessed. */
  bloomThreshold: number,
  /** The works renderer's tone-mapping exposure, so the shader can cancel it. */
  outputExposure: number,
): SunBackdrop | null {
  if (!sunCanvas) return null;

  const ceiling = Math.max(bloomThreshold - BLOOM_HEADROOM, 0.05);

  const texture = new THREE.CanvasTexture(sunCanvas);
  // Already premultiplied by the browser's compositor — asking for it again would square the alpha.
  texture.premultiplyAlpha = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uSize: { value: new THREE.Vector2(1, 1) },
      uOpacity: { value: 0 },
      uKnee: { value: ceiling * KNEE_FRACTION },
      uCeiling: { value: ceiling },
      uOutputExposure: { value: outputExposure },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    // Premultiplied "over". Three's stock NormalBlending multiplies by src alpha a second time, which
    // on already-premultiplied pixels dims the star by its own coverage.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
  });

  const object = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  object.renderOrder = BACKDROP_RENDER_ORDER;
  // Its vertices are clip-space, so its bounding volume means nothing to the frustum test.
  object.frustumCulled = false;
  object.visible = false;

  let opacity = 0;

  return {
    object,
    setRect: (rect, viewportWidth, viewportHeight) => {
      if (viewportWidth <= 0 || viewportHeight <= 0) return;
      material.uniforms.uCenter.value.set(
        (rect.centerX / viewportWidth) * 2 - 1,
        -((rect.centerY / viewportHeight) * 2 - 1),
      );
      material.uniforms.uSize.value.set(
        (rect.width / viewportWidth) * 2,
        (rect.height / viewportHeight) * 2,
      );
    },
    setOpacity: (next) => {
      opacity = next;
      material.uniforms.uOpacity.value = next;
      object.visible = next > 0.001;
    },
    refresh: () => {
      // Only while it is actually on screen. This is a full canvas upload, and doing it every frame of
      // the works section — where the DOM sun is still the one you can see — would be paying the cost
      // for an invisible object.
      if (opacity > 0.001) texture.needsUpdate = true;
    },
    dispose: () => {
      object.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
