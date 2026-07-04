// The active project's meteor burns. This is NOT the hero sun re-used verbatim — it's the sun's
// *motion recipe* (domain-warped simplex noise → churning granulation → sharp flares → hot fresnel
// rim) applied over the meteor's own `fire_meteor.jpg` texture and mapped onto a WARM molten ramp
// (deep ember → amber → white-hot), so it reads as a burning rock, not a cyan star.
//
// The surface is self-lit (emissive) so it feeds the bloom pass. `uIgnite` (0→1) drives the
// cross-fade as a meteor lights up / cools back to its stone material underneath, via alpha.

export const FIRE_METEOR_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;

  void main() {
    vUv = uv;
    // Local position drives the noise so the flame is "painted onto" the rock and tumbles with it,
    // rather than swimming in screen space.
    vLocalPosition = position;

    vViewNormal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDirection = normalize(-viewPosition.xyz);

    gl_Position = projectionMatrix * viewPosition;
  }
`;

export const FIRE_METEOR_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;

  uniform float     uTime;
  uniform sampler2D uMap;        // fire_meteor.jpg — the rock's own fiery texture
  uniform vec3      uEmber;      // deepest tone (cooling crust)
  uniform vec3      uMid;        // molten body — tinted per project (accent)
  uniform vec3      uHot;        // white-hot brightest granules / flares
  uniform float     uNoiseScale; // size of the convection cells
  uniform float     uFlowSpeed;  // how fast the surface boils
  uniform float     uContrast;   // granulation contrast
  uniform float     uFlare;      // flare energy — breathed 0.6..1 by the render loop
  uniform float     uIgnite;     // 0 = cool (invisible), 1 = fully lit — drives the cross-fade alpha

  // ── Motion tuning (mirrors sunShaders.ts) ─────────────────────────
  const int   FBM_OCTAVES     = 5;
  const float FBM_INITIAL_AMP = 0.5;
  const float FBM_LACUNARITY  = 2.0;
  const float FBM_GAIN        = 0.5;
  const float WARP_FREQUENCY  = 1.6;
  const float WARP_STRENGTH   = 0.35;
  const float UV_WARP_STRENGTH = 0.04; // how much the flame drags the sampled texture

  // ── Heat ramp thresholds ──────────────────────────────────────────
  const float HEAT_EMBER_EDGE = 0.18;
  const float HEAT_HOT_EDGE   = 0.62;

  // ── Flares (sharp bright active spots) ────────────────────────────
  const float FLARE_FREQUENCY = 2.1;
  const float FLARE_SHARPNESS = 3.0;

  // ── Fresnel rim (hot silhouette) ──────────────────────────────────
  const float RIM_POWER     = 3.0;
  const float RIM_INTENSITY = 0.85;

  // ── Ashima Arts 3D simplex noise (webgl-noise, MIT) — shared with sunShaders.ts ──
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float fbm(vec3 point) {
    float total = 0.0;
    float amplitude = FBM_INITIAL_AMP;
    for (int octave = 0; octave < FBM_OCTAVES; octave++) {
      total += snoise(point) * amplitude;
      point *= FBM_LACUNARITY;
      amplitude *= FBM_GAIN;
    }
    return total;
  }

  void main() {
    vec3 spherePoint = normalize(vLocalPosition);
    float flow = uTime * uFlowSpeed;

    // 1. Domain-warp the sample point so the flame swirls/churns instead of scrolling past.
    vec3 sampleCoord = spherePoint * uNoiseScale;
    float warp = snoise(sampleCoord * WARP_FREQUENCY + vec3(0.0, 0.0, flow));
    vec3 churned = sampleCoord + warp * WARP_STRENGTH;

    // 2. Boiling convection cells (fbm granulation).
    float granulation = fbm(churned + vec3(flow * 0.15, -flow * 0.1, flow * 0.05));
    float heat = clamp(granulation * 0.5 + 0.5, 0.0, 1.0);
    heat = pow(heat, uContrast);

    // 3. Fold in the rock's own fiery texture (dragged by the same warp), so the meteor keeps its
    //    material detail rather than becoming a featureless blob of noise.
    vec3 texel = texture2D(uMap, vUv + warp * UV_WARP_STRENGTH).rgb;
    float textureHeat = dot(texel, vec3(0.299, 0.587, 0.114));
    float surface = clamp(heat * 0.6 + textureHeat * 0.6, 0.0, 1.0);

    // 4. Map the combined heat onto the molten ramp: ember → amber → white-hot.
    vec3 color = mix(uEmber, uMid, smoothstep(HEAT_EMBER_EDGE, HEAT_HOT_EDGE, surface));
    color = mix(color, uHot, smoothstep(HEAT_HOT_EDGE, 1.0, surface));

    // 5. Sharp flares layered over the body (faster-moving hot spots).
    float flarePattern = fbm(churned * FLARE_FREQUENCY - vec3(flow * 0.3));
    float flares = pow(clamp(flarePattern, 0.0, 1.0), FLARE_SHARPNESS);
    color += uHot * flares * uFlare;

    // 6. Hot chromosphere rim so the silhouette glows rather than going flat (fresnel to camera).
    float fresnel = 1.0 - max(dot(normalize(vViewNormal), normalize(vViewDirection)), 0.0);
    color += uMid * pow(fresnel, RIM_POWER) * RIM_INTENSITY;

    // 7. Ignite fade: alpha cross-fades over the cool stone meteor underneath; a touch of extra
    //    lift on the way in so it reads as catching light rather than just becoming opaque.
    gl_FragColor = vec4(color * mix(0.4, 1.0, uIgnite), uIgnite);
  }
`;
