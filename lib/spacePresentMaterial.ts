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
 *
 * `uPictureSpan` is the third, and it exists for the phone. The display's WIDTH tracks the viewport's
 * aspect (that match is what makes progress 0 pixel-exact), so on a portrait phone the picture is far
 * narrower than the tabletop it is laid into and the bare table showed down either side of it. This
 * lets the QUAD be wider than the picture, with the surplus painted solid black — so the display reads
 * as a screen in a black panel at every aspect, rather than as a picture floating on a slate desk.
 *
 * It is deliberately part of THIS material rather than a second plane behind the display. The display
 * lies flat INTO the table's surface (`rigPitch: 90`), so anything coplanar with it z-fights against
 * the tabletop; one quad has one depth and cannot fight anything.
 *
 * At `(1, 1)` — which is what the full-bleed pass always uses — every added instruction folds to an
 * exact identity, so the bit-exact copy the reveal rests on is untouched. See the shader for how.
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
  uniform float uOpaque;    // 0 = keep the space's transparency, 1 = a solid screen
  uniform vec4 uCrop;       // trim the picture's edges: (left, right, top, bottom), each 0..1
  uniform vec2 uPictureSpan; // quad size / picture size, per axis. (1,1) = the picture fills the quad
  varying vec2 vUv;

  void main() {
    // 1. Quad space to PICTURE space. The picture sits centred in the quad occupying 1/uPictureSpan of
    //    it, so anything past the edge lands outside 0..1 and becomes the black panel below.
    //
    //    Written as an offset from vUv rather than the obvious (vUv - 0.5) * span + 0.5, and the
    //    difference matters: at span 1.0 the term (uPictureSpan - 1.0) is exactly zero, so this is
    //    vUv + 0.0 and the full-bleed pass keeps the bit-exact copy it is promised. The centred form
    //    would round-trip through a subtract and an add and could come back a ulp off.
    vec2 pictureUv = vUv + (vUv - 0.5) * (uPictureSpan - 1.0);

    // 2. Read from a sub-rectangle of the render rather than all of it, so the display's borders can be
    //    trimmed. All zero = the whole picture, which is what the full-bleed pass always uses.
    vec2 uv = vec2(
      mix(uCrop.x, 1.0 - uCrop.y, pictureUv.x),
      mix(uCrop.w, 1.0 - uCrop.z, pictureUv.y)
    );
    vec4 space = texture2D(uSpace, uv);

    // 3. Inside the picture, or out on the panel? Inclusive at both edges — step(e, x) is 1 when x == e
    //    — so at span 1.0 this is 1.0 across the whole quad and step 4 folds to an identity.
    float inPicture = step(0.0, pictureUv.x) * step(pictureUv.x, 1.0)
                    * step(0.0, pictureUv.y) * step(pictureUv.y, 1.0);

    // 4. The rgb is passed through untouched — no tone mapping, no encoding. It is still linear HDR at
    //    this point, and the screen pipeline's OutputPass is the one and only place that gets to change
    //    it. The panel is black and always OPAQUE, whatever uOpaque is doing: it is the screen's own
    //    body, not the dark of space, and it must never be a hole through to the room behind it.
    gl_FragColor = vec4(
      space.rgb * inPicture,
      mix(1.0, mix(space.a, 1.0, uOpaque), inPicture)
    );
  }
`;

export interface SpacePresentUniforms {
  uSpace: { value: THREE.Texture | null };
  uOpaque: { value: number };
  /** (left, right, top, bottom) edge insets, 0..1. All zero shows the whole picture. */
  uCrop: { value: THREE.Vector4 };
  /**
   * Quad size ÷ picture size, per axis. `(1, 1)` — the default — means the picture fills the quad
   * exactly and the material behaves precisely as it did before this uniform existed. Anything above 1
   * on an axis widens the QUAD, leaving opaque black either side of an unchanged picture.
   */
  uPictureSpan: { value: THREE.Vector2 };
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
    uCrop: { value: new THREE.Vector4(0, 0, 0, 0) },
    uPictureSpan: { value: new THREE.Vector2(1, 1) },
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
