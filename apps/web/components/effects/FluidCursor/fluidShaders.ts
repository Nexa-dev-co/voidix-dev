// GLSL for the fluid solver. This is a trimmed port of Pavel Dobryakov's
// WebGL-Fluid-Simulation (MIT) — the real Navier-Stokes GPU solver — with the
// bloom / sunrays / dithering passes removed and a custom display shader that
// renders the field as dark ink + a subtle star field instead of colourful dye.

export const BASE_VERTEX_SHADER = /* glsl */ `
  precision highp float;

  attribute vec2 aPosition;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform vec2 texelSize;

  void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

export const CLEAR_SHADER = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;

  varying highp vec2 vUv;
  uniform sampler2D uTexture;
  uniform float value;

  void main () {
    gl_FragColor = value * texture2D(uTexture, vUv);
  }
`;

export const SPLAT_SHADER = /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;

  void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`;

// The advection shader has two variants selected via a #define keyword:
// MANUAL_FILTERING for hardware without linear float filtering.
export const ADVECTION_SHADER = /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform vec2 dyeTexelSize;
  uniform float dt;
  uniform float dissipation;

  vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);

    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
  }

  void main () {
  #ifdef MANUAL_FILTERING
    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
    vec4 result = bilerp(uSource, coord, dyeTexelSize);
  #else
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    vec4 result = texture2D(uSource, coord);
  #endif
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
  }
`;

export const DIVERGENCE_SHADER = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;

  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uVelocity;

  void main () {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;

    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }

    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

export const CURL_SHADER = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;

  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uVelocity;

  void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`;

export const VORTICITY_SHADER = /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;

  void main () {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;

    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;

    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

export const PRESSURE_SHADER = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;

  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;

  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

export const GRADIENT_SUBTRACT_SHADER = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;

  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;

  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

// Custom display: turn the dye field into dark ink + a masked star field.
// Output is premultiplied alpha so the canvas composites cleanly over the page,
// and the ink alpha peaks below 1 so the inverted text beneath can glow through.
export const DISPLAY_SHADER = /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  varying vec2 vUv;
  uniform sampler2D uTexture;     // the dye field (fluid presence)
  uniform vec2 uResolution;       // canvas size in device pixels
  uniform float uTime;
  uniform vec3 uInkColor;
  uniform float uInkPeakAlpha;
  uniform float uDyeToPresence;
  uniform float uStarCellSize;
  uniform float uStarFillRatio;
  uniform float uStarBrightness;
  uniform float uStarTwinkleSpeed;
  uniform vec3 uStarColorA;
  uniform vec3 uStarColorB;

  float hash (vec2 cell) {
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // Each cell's star is one of the two palette colours, picked by its hash.
  vec3 starColorFor (vec2 cell) {
    return hash(cell + 4.3) < 0.5 ? uStarColorA : uStarColorB;
  }

  // One star per grid cell. We scan the 3×3 cells around the current pixel so a star
  // whose glow spills past its own cell border is still drawn whole by the neighbour —
  // sampling only the home cell is what clipped stars to halves at the boundaries.
  // Returns rgb = colour * intensity, a = intensity (for the alpha punch-through).
  vec4 starField (vec2 uv) {
    vec2 grid = uv * (uResolution / uStarCellSize);
    vec2 baseCell = floor(grid);
    vec2 inCell = fract(grid);

    vec4 accumulated = vec4(0.0);
    for (int offsetY = -1; offsetY <= 1; offsetY++) {
      for (int offsetX = -1; offsetX <= 1; offsetX++) {
        vec2 neighbor = vec2(float(offsetX), float(offsetY));
        vec2 cell = baseCell + neighbor;

        float exists = step(uStarFillRatio, hash(cell));
        // Star position expressed relative to the current cell's origin, so the
        // distance is measured in the pixel's own cell space.
        vec2 starPosition = neighbor + vec2(hash(cell + 1.7), hash(cell + 9.2));
        float distanceToStar = length(inCell - starPosition);

        // soft halo + tight core
        float glow = smoothstep(0.30, 0.0, distanceToStar) * 0.35
                   + smoothstep(0.06, 0.0, distanceToStar);
        float twinkle = 0.55 + 0.45 * sin(uTime * uStarTwinkleSpeed + hash(cell) * 6.2831);

        float intensity = exists * glow * twinkle;
        accumulated.rgb += starColorFor(cell) * intensity;
        accumulated.a += intensity;
      }
    }
    return accumulated;
  }

  void main () {
    float density = length(texture2D(uTexture, vUv).rgb);
    float presence = clamp(density * uDyeToPresence, 0.0, 1.0);
    float inkAlpha = presence * uInkPeakAlpha;

    // Premultiplied ink veil.
    vec3 color = uInkColor * inkAlpha;
    float alpha = inkAlpha;

    // Stars only exist inside the fluid. Guarding on presence also skips the costly
    // 3×3 scan for the (vast majority of) pixels outside the blob.
    if (presence > 0.001) {
      vec4 stars = starField(vUv) * (uStarBrightness * presence);
      color += stars.rgb;
      alpha = clamp(alpha + stars.a, 0.0, 1.0);
    }

    gl_FragColor = vec4(color, alpha);
  }
`;
