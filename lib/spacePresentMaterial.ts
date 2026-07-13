import * as THREE from 'three';

/**
 * The material that paints the rendered space onto a surface.
 *
 * The works→chamber reveal turns the space you've been flying through into a *feed on a screen* (see
 * docs/works-to-chamber-reveal.md). To do that, the space scene is rendered into a texture, and that
 * texture is then painted back out — full-bleed onto the canvas while you're browsing projects, and
 * onto the screen in the chamber once the camera pulls back. **It is the same texture and the same
 * material both times**, which is exactly what makes the reveal seamless: the image never changes,
 * only the geometry it's painted on.
 *
 * That "never changes" is the whole contract, and it's easy to break, so this is a raw passthrough
 * shader rather than a `MeshBasicMaterial`:
 *
 * 1. **Alpha survives.** The works canvas is transparent — the pinned sun shows *through* the empty
 *    space between the meteors. `MeshBasicMaterial` with `transparent: false` compiles with three's
 *    `OPAQUE` define, which forces `gl_FragColor.a = 1.0` and would silently paint the sun out of the
 *    site. Here the texel's alpha is written through untouched.
 * 2. **No tone mapping, no colour-space transform.** A plain `ShaderMaterial` gets neither unless its
 *    shader asks for them, and this one doesn't. The pixels land in the screen pipeline's buffer
 *    exactly as the space pipeline produced them, and the single OutputPass at the end of that
 *    pipeline applies the tone curve ONCE. (Tone-mapping the space on the way into the texture and
 *    then again on the way out is the trap here: it double-applies the curve and shifts the whole
 *    image the moment the reveal engages.)
 * 3. **No blending, no depth.** `NoBlending` means the texel is written, not composited — so a
 *    full-bleed quad is a bit-exact copy of the texture.
 *
 * `uOpaque` is the one thing that legitimately differs between the two uses. Browsing projects, the
 * space must keep its transparency so the sun reads behind it (`0`). Once you're in the room, a screen
 * is a solid object — the dark of space has to read as an unlit panel rather than a hole through to
 * the wall behind it (`1`). It's ramped, not switched, so the sun can fade out in step with it.
 *
 * `depth` is the other. The full-bleed quad is the only thing in its scene, so it skips depth entirely.
 * The chamber's display is a physical object in a room and has to occlude and be occluded properly, so
 * it depth-tests like anything else. Neither touches colour, so both uses still produce identical
 * pixels from identical input — which is the guarantee the whole reveal rests on.
 */

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uSpace;
  uniform float uOpaque; // 0 = keep the space's transparency, 1 = a solid screen
  varying vec2 vUv;

  void main() {
    vec4 space = texture2D(uSpace, vUv);
    // The rgb is passed through untouched — no tone mapping, no encoding. It is still linear HDR at
    // this point, and the screen pipeline's OutputPass is the one and only place that gets to change it.
    gl_FragColor = vec4(space.rgb, mix(space.a, 1.0, uOpaque));
  }
`;

export interface SpacePresentUniforms {
  uSpace: { value: THREE.Texture | null };
  uOpaque: { value: number };
}

export interface SpacePresentMaterial {
  material: THREE.ShaderMaterial;
  uniforms: SpacePresentUniforms;
}

interface SpacePresentOptions {
  /** True for the display inside the chamber, which sits in a room and must sort against it. */
  depth?: boolean;
}

export function createSpacePresentMaterial(
  spaceTexture: THREE.Texture,
  { depth = false }: SpacePresentOptions = {},
): SpacePresentMaterial {
  const uniforms: SpacePresentUniforms = {
    uSpace: { value: spaceTexture },
    uOpaque: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: uniforms as unknown as { [uniform: string]: THREE.IUniform },
    // Write the texel, don't composite it — a full-bleed quad is then a bit-exact copy, and the
    // chamber's display writes real alpha (so the empty dark of space can read as an unlit panel).
    blending: THREE.NoBlending,
    depthTest: depth,
    depthWrite: depth,
  });

  return { material, uniforms };
}
