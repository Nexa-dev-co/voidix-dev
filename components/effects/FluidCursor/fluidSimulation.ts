// The fluid solver: a trimmed TypeScript port of Pavel Dobryakov's
// WebGL-Fluid-Simulation (MIT). It owns one WebGL context and exposes a small
// imperative API (splat / frame / resize / dispose) that the React hook drives.
// No GUI, no bloom, no sunrays, no random startup splats — just the physics and
// the custom dark-ink display pass.

import {
  ADVECTION_SHADER,
  BASE_VERTEX_SHADER,
  CLEAR_SHADER,
  CURL_SHADER,
  DISPLAY_SHADER,
  DIVERGENCE_SHADER,
  GRADIENT_SUBTRACT_SHADER,
  PRESSURE_SHADER,
  SPLAT_SHADER,
  VORTICITY_SHADER,
} from './fluidShaders';
import {
  DYE_SPLAT_AMOUNT,
  DYE_TO_PRESENCE,
  FluidConfig,
  INK_COLOR,
  INK_PEAK_ALPHA,
  STAR_BRIGHTNESS,
  STAR_CELL_SIZE_PX,
  STAR_FILL_RATIO,
  STAR_PALETTE,
  STAR_TWINKLE_SPEED,
} from './fluidConfig';

const MAX_DEVICE_PIXEL_RATIO = 2;

type WebGLRenderingContextBoth = WebGLRenderingContext | WebGL2RenderingContext;
type UniformMap = Record<string, WebGLUniformLocation | null>;

interface SupportedFormat {
  internalFormat: number;
  format: number;
}

interface WebGLExtensions {
  formatRGBA: SupportedFormat | null;
  formatRG: SupportedFormat | null;
  formatR: SupportedFormat | null;
  halfFloatTexType: number;
  supportLinearFiltering: boolean;
}

interface Framebuffer {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  attach(textureUnit: number): number;
}

interface DoubleFramebuffer {
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  read: Framebuffer;
  write: Framebuffer;
  swap(): void;
}

export interface FluidSimulation {
  /** Inject ink + velocity at a UV position (0..1, origin bottom-left). */
  splat(uvX: number, uvY: number, forceX: number, forceY: number, radiusPixels: number): void;
  /** Advance the simulation and render the ink to the canvas. */
  frame(deltaSeconds: number, elapsedSeconds: number): void;
  /** Re-sync framebuffers to the current canvas backing-store size. */
  resize(): void;
  /** Release all GL resources. */
  dispose(): void;
}

export function createFluidSimulation(
  canvas: HTMLCanvasElement,
  config: FluidConfig
): FluidSimulation | null {
  const context = getWebGLContext(canvas);
  if (!context) return null;
  const { gl, ext } = context;
  if (!ext.formatRGBA || !ext.formatRG || !ext.formatR) return null;

  const formatRGBA = ext.formatRGBA;
  const formatRG = ext.formatRG;
  const formatR = ext.formatR;
  const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

  // ── Shared fullscreen-quad blit ──────────────────────────────────────
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  const quadIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  const blit = (target: Framebuffer | null) => {
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };

  // ── Program helpers ──────────────────────────────────────────────────
  const trackedShaders: WebGLShader[] = [];
  const trackedPrograms: WebGLProgram[] = [];

  function compileShader(type: number, source: string, keywords?: string[]): WebGLShader {
    const finalSource = keywords ? keywords.map((word) => `#define ${word}\n`).join('') + source : source;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');
    gl.shaderSource(shader, finalSource);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      console.error(gl.getShaderInfoLog(shader));
    trackedShaders.push(shader);
    return shader;
  }

  function buildProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      console.error(gl.getProgramInfoLog(program));
    trackedPrograms.push(program);

    const uniforms: UniformMap = {};
    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let index = 0; index < uniformCount; index++) {
      const info = gl.getActiveUniform(program, index);
      if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  }

  const baseVertexShader = compileShader(gl.VERTEX_SHADER, BASE_VERTEX_SHADER);
  const clearProgram = buildProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, CLEAR_SHADER));
  const splatProgram = buildProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, SPLAT_SHADER));
  const advectionProgram = buildProgram(
    baseVertexShader,
    compileShader(gl.FRAGMENT_SHADER, ADVECTION_SHADER, ext.supportLinearFiltering ? undefined : ['MANUAL_FILTERING'])
  );
  const divergenceProgram = buildProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, DIVERGENCE_SHADER));
  const curlProgram = buildProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, CURL_SHADER));
  const vorticityProgram = buildProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, VORTICITY_SHADER));
  const pressureProgram = buildProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, PRESSURE_SHADER));
  const gradientSubtractProgram = buildProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, GRADIENT_SUBTRACT_SHADER));
  const displayProgram = buildProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, DISPLAY_SHADER));

  // ── Framebuffer creation ─────────────────────────────────────────────
  const trackedTextures: WebGLTexture[] = [];
  const trackedFramebuffers: WebGLFramebuffer[] = [];

  function createFramebuffer(
    width: number,
    height: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number
  ): Framebuffer {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to create texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Failed to create framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    trackedTextures.push(texture);
    trackedFramebuffers.push(fbo);

    return {
      texture,
      fbo,
      width,
      height,
      texelSizeX: 1.0 / width,
      texelSizeY: 1.0 / height,
      attach(textureUnit: number) {
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return textureUnit;
      },
    };
  }

  function createDoubleFramebuffer(
    width: number,
    height: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number
  ): DoubleFramebuffer {
    let first = createFramebuffer(width, height, internalFormat, format, type, param);
    let second = createFramebuffer(width, height, internalFormat, format, type, param);
    return {
      width,
      height,
      texelSizeX: first.texelSizeX,
      texelSizeY: first.texelSizeY,
      get read() {
        return first;
      },
      get write() {
        return second;
      },
      swap() {
        const temp = first;
        first = second;
        second = temp;
      },
    };
  }

  // ── Fields ───────────────────────────────────────────────────────────
  let dye: DoubleFramebuffer;
  let velocity: DoubleFramebuffer;
  let divergence: Framebuffer;
  let curlField: Framebuffer;
  let pressure: DoubleFramebuffer;

  function getResolution(resolution: number) {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
    const min = Math.round(resolution);
    const max = Math.round(resolution * aspectRatio);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: max, height: min }
      : { width: min, height: max };
  }

  function initFramebuffers() {
    const simResolution = getResolution(config.simulationResolution);
    const dyeResolution = getResolution(config.dyeResolution);
    const type = ext.halfFloatTexType;

    gl.disable(gl.BLEND);
    dye = createDoubleFramebuffer(dyeResolution.width, dyeResolution.height, formatRGBA.internalFormat, formatRGBA.format, type, filtering);
    velocity = createDoubleFramebuffer(simResolution.width, simResolution.height, formatRG.internalFormat, formatRG.format, type, filtering);
    divergence = createFramebuffer(simResolution.width, simResolution.height, formatR.internalFormat, formatR.format, type, gl.NEAREST);
    curlField = createFramebuffer(simResolution.width, simResolution.height, formatR.internalFormat, formatR.format, type, gl.NEAREST);
    pressure = createDoubleFramebuffer(simResolution.width, simResolution.height, formatR.internalFormat, formatR.format, type, gl.NEAREST);
  }

  initFramebuffers();

  // ── Simulation step ──────────────────────────────────────────────────
  function step(deltaSeconds: number) {
    gl.disable(gl.BLEND);

    gl.useProgram(curlProgram.program);
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curlField);

    gl.useProgram(vorticityProgram.program);
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curlField.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.curl);
    gl.uniform1f(vorticityProgram.uniforms.dt, deltaSeconds);
    blit(velocity.write);
    velocity.swap();

    gl.useProgram(divergenceProgram.program);
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    gl.useProgram(clearProgram.program);
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.pressure);
    blit(pressure.write);
    pressure.swap();

    gl.useProgram(pressureProgram.program);
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (let iteration = 0; iteration < config.pressureIterations; iteration++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    gl.useProgram(gradientSubtractProgram.program);
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    // Advect velocity, then dye, each with its own dissipation.
    gl.useProgram(advectionProgram.program);
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering)
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    const velocityTextureUnit = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityTextureUnit);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityTextureUnit);
    gl.uniform1f(advectionProgram.uniforms.dt, deltaSeconds);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.velocityDissipation);
    blit(velocity.write);
    velocity.swap();

    if (!ext.supportLinearFiltering)
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.densityDissipation);
    blit(dye.write);
    dye.swap();
  }

  // ── Display (dark ink + stars) ───────────────────────────────────────
  function render(elapsedSeconds: number) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    gl.useProgram(displayProgram.program);
    gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
    gl.uniform2f(displayProgram.uniforms.uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(displayProgram.uniforms.uTime, elapsedSeconds);
    gl.uniform3f(displayProgram.uniforms.uInkColor, INK_COLOR[0], INK_COLOR[1], INK_COLOR[2]);
    gl.uniform1f(displayProgram.uniforms.uInkPeakAlpha, INK_PEAK_ALPHA);
    gl.uniform1f(displayProgram.uniforms.uDyeToPresence, DYE_TO_PRESENCE);
    gl.uniform1f(displayProgram.uniforms.uStarCellSize, STAR_CELL_SIZE_PX * currentPixelRatio());
    gl.uniform1f(displayProgram.uniforms.uStarFillRatio, STAR_FILL_RATIO);
    gl.uniform1f(displayProgram.uniforms.uStarBrightness, STAR_BRIGHTNESS);
    gl.uniform1f(displayProgram.uniforms.uStarTwinkleSpeed, STAR_TWINKLE_SPEED);
    gl.uniform3f(displayProgram.uniforms.uStarColorA, STAR_PALETTE[0][0], STAR_PALETTE[0][1], STAR_PALETTE[0][2]);
    gl.uniform3f(displayProgram.uniforms.uStarColorB, STAR_PALETTE[1][0], STAR_PALETTE[1][1], STAR_PALETTE[1][2]);
    blit(null);
  }

  function currentPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
  }

  // ── Splatting ────────────────────────────────────────────────────────
  function splatRadiusFromPixels(radiusPixels: number) {
    // The splat shader falls off as exp(-r^2 / radius) with r in UV space, so a
    // blob of `radiusPixels` corresponds to (radiusPixels / canvasHeight)^2,
    // then aspect-corrected to stay round.
    const uvRadius = radiusPixels / gl.drawingBufferHeight;
    let radius = uvRadius * uvRadius;
    const aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) radius *= aspectRatio;
    return radius;
  }

  function splat(uvX: number, uvY: number, forceX: number, forceY: number, radiusPixels: number) {
    const aspectRatio = canvas.width / canvas.height;
    const radius = splatRadiusFromPixels(radiusPixels);

    gl.disable(gl.BLEND);
    gl.useProgram(splatProgram.program);

    // Velocity splat (the push that makes it move).
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, aspectRatio);
    gl.uniform2f(splatProgram.uniforms.point, uvX, uvY);
    gl.uniform3f(splatProgram.uniforms.color, forceX, forceY, 0);
    gl.uniform1f(splatProgram.uniforms.radius, radius);
    blit(velocity.write);
    velocity.swap();

    // Dye splat (the ink presence we later render dark).
    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, DYE_SPLAT_AMOUNT, DYE_SPLAT_AMOUNT, DYE_SPLAT_AMOUNT);
    blit(dye.write);
    dye.swap();
  }

  return {
    splat,
    frame(deltaSeconds: number, elapsedSeconds: number) {
      step(deltaSeconds);
      render(elapsedSeconds);
    },
    resize() {
      initFramebuffers();
    },
    dispose() {
      trackedFramebuffers.forEach((fbo) => gl.deleteFramebuffer(fbo));
      trackedTextures.forEach((texture) => gl.deleteTexture(texture));
      trackedPrograms.forEach((program) => gl.deleteProgram(program));
      trackedShaders.forEach((shader) => gl.deleteShader(shader));
      gl.deleteBuffer(quadBuffer);
      gl.deleteBuffer(quadIndexBuffer);
    },
  };

  // ── WebGL context + format detection ─────────────────────────────────
  function getWebGLContext(targetCanvas: HTMLCanvasElement) {
    const contextOptions: WebGLContextAttributes = {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    };

    let glContext: WebGLRenderingContextBoth | null = targetCanvas.getContext(
      'webgl2',
      contextOptions
    ) as WebGL2RenderingContext | null;
    const usingWebGL2 = !!glContext;
    if (!glContext)
      glContext = (targetCanvas.getContext('webgl', contextOptions) ||
        targetCanvas.getContext('experimental-webgl', contextOptions)) as WebGLRenderingContext | null;
    if (!glContext) return null;

    const renderingContext: WebGLRenderingContextBoth = glContext;
    let halfFloat: OES_texture_half_float | null = null;
    let supportLinearFiltering: boolean;

    if (usingWebGL2) {
      (renderingContext as WebGL2RenderingContext).getExtension('EXT_color_buffer_float');
      supportLinearFiltering = !!renderingContext.getExtension('OES_texture_float_linear');
    } else {
      halfFloat = renderingContext.getExtension('OES_texture_half_float');
      supportLinearFiltering = !!renderingContext.getExtension('OES_texture_half_float_linear');
    }

    renderingContext.clearColor(0, 0, 0, 0);

    const halfFloatTexType = usingWebGL2
      ? (renderingContext as WebGL2RenderingContext).HALF_FLOAT
      : halfFloat
        ? halfFloat.HALF_FLOAT_OES
        : renderingContext.UNSIGNED_BYTE;

    const detected: WebGLExtensions = usingWebGL2
      ? {
          formatRGBA: getSupportedFormat(renderingContext, (renderingContext as WebGL2RenderingContext).RGBA16F, renderingContext.RGBA, halfFloatTexType),
          formatRG: getSupportedFormat(renderingContext, (renderingContext as WebGL2RenderingContext).RG16F, (renderingContext as WebGL2RenderingContext).RG, halfFloatTexType),
          formatR: getSupportedFormat(renderingContext, (renderingContext as WebGL2RenderingContext).R16F, (renderingContext as WebGL2RenderingContext).RED, halfFloatTexType),
          halfFloatTexType,
          supportLinearFiltering,
        }
      : {
          formatRGBA: getSupportedFormat(renderingContext, renderingContext.RGBA, renderingContext.RGBA, halfFloatTexType),
          formatRG: getSupportedFormat(renderingContext, renderingContext.RGBA, renderingContext.RGBA, halfFloatTexType),
          formatR: getSupportedFormat(renderingContext, renderingContext.RGBA, renderingContext.RGBA, halfFloatTexType),
          halfFloatTexType,
          supportLinearFiltering,
        };

    return { gl: renderingContext, isWebGL2: usingWebGL2, ext: detected };
  }

  function getSupportedFormat(
    glContext: WebGLRenderingContextBoth,
    internalFormat: number,
    format: number,
    type: number
  ): SupportedFormat | null {
    if (!supportRenderTextureFormat(glContext, internalFormat, format, type)) {
      const gl2 = glContext as WebGL2RenderingContext;
      switch (internalFormat) {
        case gl2.R16F:
          return getSupportedFormat(glContext, gl2.RG16F, gl2.RG, type);
        case gl2.RG16F:
          return getSupportedFormat(glContext, gl2.RGBA16F, glContext.RGBA, type);
        default:
          return null;
      }
    }
    return { internalFormat, format };
  }

  function supportRenderTextureFormat(
    glContext: WebGLRenderingContextBoth,
    internalFormat: number,
    format: number,
    type: number
  ) {
    const texture = glContext.createTexture();
    glContext.bindTexture(glContext.TEXTURE_2D, texture);
    glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MIN_FILTER, glContext.NEAREST);
    glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MAG_FILTER, glContext.NEAREST);
    glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_S, glContext.CLAMP_TO_EDGE);
    glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_T, glContext.CLAMP_TO_EDGE);
    glContext.texImage2D(glContext.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    const fbo = glContext.createFramebuffer();
    glContext.bindFramebuffer(glContext.FRAMEBUFFER, fbo);
    glContext.framebufferTexture2D(glContext.FRAMEBUFFER, glContext.COLOR_ATTACHMENT0, glContext.TEXTURE_2D, texture, 0);
    const status = glContext.checkFramebufferStatus(glContext.FRAMEBUFFER);

    glContext.deleteTexture(texture);
    glContext.deleteFramebuffer(fbo);
    return status === glContext.FRAMEBUFFER_COMPLETE;
  }
}
