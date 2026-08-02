import * as THREE from "three";

// Screen-space gravitational lensing — the "space behaves like fluid" pass.
//
// Lives in `lib/`, not in the lab that authors it: the contact finale runs this same code on the site
// (docs/contact-singularity-plan.md). One copy on purpose — two would mean tuning one and shipping the
// other.
//
// ⚠ On the site this runs inside `useWorksField`'s `spaceComposer`, whose output alpha is load-bearing
// (see createSpacePresentMaterial). The `alpha = 1.0` written below would seal the canvas and paint the
// pinned sun out of the page — carry the sampled alpha through before enabling it there.
//
// WHAT THIS IS: a post-process that bends the already-rendered image radially around the black hole,
// splits the sample per colour channel (chromatic aberration), undulates the bend with animated noise
// (the liquid/glass read), and adds a photon ring at the shadow edge.
//
// WHAT THIS IS NOT: real gravitational lensing. Light that never reached the camera cannot be recovered
// from a rendered frame, so the far side of the disc will not arc over the top the way it does in a
// raymarched metric. This buys ~80% of the look for ~5% of the cost; the real thing is a different
// project. Do not let anyone believe otherwise from the results.
//
// Physical anchor: the deflection angle of light passing a mass falls off as 1/b (impact parameter), so
// the bend below is an inverse-square-ish falloff in units of the shadow radius — strong at the edge,
// gone by a few radii out. It is an approximation shaped to look right, not a solution to anything.

export const LENSING_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** Black hole centre in screen UV (0..1). */
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    /** Shadow radius in screen UV (vertical units — aspect is corrected in the shader). */
    uRadius: { value: 0.1 },
    /** Master bend amount. 0 makes the whole pass a pass-through. */
    uStrength: { value: 0 },
    /** How far the R and B samples split from G. This is the colour fringing. */
    uAberration: { value: 0 },
    /** Amplitude of the travelling ripple in the bend field — the "undulating liquid". */
    uLiquid: { value: 0 },
    /** Brightness of the photon ring at the shadow edge. */
    uRingStrength: { value: 0 },
    uRingColor: { value: new THREE.Color(0xffd9a0) },
    /** Darkening applied inside the shadow, so the silhouette reads hard against the disc. */
    uShadow: { value: 0 },
    uTime: { value: 0 },
    /** width / height, so the distortion stays circular instead of following the viewport. */
    uAspect: { value: 1 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2  uCenter;
    uniform float uRadius;
    uniform float uStrength;
    uniform float uAberration;
    uniform float uLiquid;
    uniform float uRingStrength;
    uniform vec3  uRingColor;
    uniform float uShadow;
    uniform float uTime;
    uniform float uAspect;

    varying vec2 vUv;

    // Sample with the bend applied. Undoing the aspect correction on the way out keeps the offset in UV
    // space, or the distortion would smear horizontally on a wide viewport.
    //
    // Returns the full RGBA rather than just the colour, because ALPHA IS LOAD-BEARING on the site: the
    // works field's space stage renders to a transparent texture, and createSpacePresentMaterial is a
    // raw shader specifically so that alpha survives to the canvas. Writing a constant 1.0 here would
    // seal the canvas and paint the pinned hero sun out of the page. In /sun-lab the scene is opaque, so
    // every alpha sampled is 1 and this is exactly equivalent to what it did before.
    // (No backticks in here - they would terminate the template literal. See CLAUDE.md.)
    vec4 sampleBent(vec2 uv, vec2 direction, float bend) {
      vec2 offset = direction * bend;
      offset.x /= uAspect;
      return texture2D(tDiffuse, uv - offset);
    }

    void main() {
      // Work in aspect-corrected space so "radius" means the same thing in x and y.
      vec2 delta = (vUv - uCenter) * vec2(uAspect, 1.0);
      float distance = length(delta);
      float radius = max(uRadius, 1e-4);
      // Everything below is in units of the shadow radius: 1.0 sits exactly on the edge.
      float normalized = distance / radius;
      vec2 direction = delta / max(distance, 1e-5);

      // 1. The bend. Inverse-square in normalized units, clamped so the centre can't blow up, and faded
      //    out past a few radii so distant parts of the frame are left alone. The 0.25 floor caps the
      //    bend at 4x its edge value — without it, samples near the centre reach right across the frame.
      float falloff = 1.0 / max(normalized * normalized, 0.25);
      float reach = 1.0 - smoothstep(1.0, 7.0, normalized);
      float bend = uStrength * radius * falloff * reach;

      // 2. The liquid. A ripple travelling outward, plus a slow angular wobble, so the bend field is
      //    never static — this is what stops it reading as a fixed lens and starts it reading as water.
      float angle = atan(direction.y, direction.x);
      float ripple = sin(normalized * 6.0 - uTime * 1.6) * 0.6
                   + sin(angle * 3.0 + uTime * 0.7) * 0.4;
      bend *= 1.0 + uLiquid * ripple * reach;

      // 3. Chromatic aberration — each channel bends by a slightly different amount, exactly as a real
      //    dispersive medium would separate them. Red bends least, blue most.
      float split = uAberration * bend;
      // The unsplit sample carries the green channel AND the alpha the frame is composited with.
      vec4 middle = sampleBent(vUv, direction, bend);
      vec3 color;
      color.r = sampleBent(vUv, direction, bend - split).r;
      color.g = middle.g;
      color.b = sampleBent(vUv, direction, bend + split).b;

      // 4. Photon ring — a thin bright band hugging the shadow edge, where grazing light piles up.
      float ring = smoothstep(1.18, 1.0, normalized) * smoothstep(0.88, 1.02, normalized);
      color += uRingColor * ring * uRingStrength;

      // 5. Shadow — darken inside the edge so the silhouette stays hard even when the disc is blazing.
      color *= mix(1.0, smoothstep(0.72, 1.0, normalized), uShadow);

      gl_FragColor = vec4(color, middle.a);
    }
  `,
};
