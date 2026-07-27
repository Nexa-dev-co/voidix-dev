import {
  GATHER_COUNT,
  GATHER_DEFAULTS,
  GATHER_FRAGMENT_SHADER,
  GATHER_VERTEX_SHADER,
} from "./gatherShader";

// The gather field's rendering — raw WebGL, no 3D engine.
//
// WHY NOT three
// This is a LOADING SCREEN: the one thing on the page that has to be drawing on its first frame. Built on
// three, the worker chunk carried the whole engine (5.8 MB unminified in dev), so on a slow connection the
// field could not draw a single particle until a 3D library finished downloading — a loader with its own
// loading screen. What it actually needed from three was a renderer, one buffer of points and one shader;
// the scene graph, matrix stack, materials and loaders were all dead weight. The vertex shader writes
// gl_Position directly, so even the camera was unused.
//
// WHERE IT RUNS
// Nothing here touches the DOM, `window` or `document`. It drives an OffscreenCanvas inside a worker on
// browsers that support it, and a normal canvas on the main thread everywhere else, and those two paths
// must not drift apart — so both construct this same object.

/** Everything the outside world can tell the field. All optional: it renders happily with none of it. */
export interface GatherFrameInput {
  /** Real asset progress, 0..1. Eased internally, so callers can post raw jumps. */
  progress?: number;
  /** Convergence point in aspect units (see gatherShader.ts). */
  targetX?: number;
  targetY?: number;
  /** Scale of the cloud particles settle into, in aspect units. */
  targetRadius?: number;
}

const MAX_FRAME_SECONDS = 0.05;
// How fast the eased progress chases the real value. Progress arrives in jumps as each asset lands.
const PROGRESS_EASE_PER_SECOND = 2.2;
const IGNITE_SECONDS = 0.55;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const UNIFORM_NAMES = [
  "uProgress",
  "uTime",
  "uIgnite",
  "uTarget",
  "uTargetRadius",
  "uWind",
  "uAspect",
  "uSize",
  "uOpacity",
  "uPixelRatio",
  "uColorCool",
  "uColorHot",
] as const;
type UniformName = (typeof UNIFORM_NAMES)[number];

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("gather: could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`gather: shader failed to compile — ${log}`);
  }
  return shader;
}

export class GatherRenderer {
  private readonly gl: GL;
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly uniforms = {} as Record<UniformName, WebGLUniformLocation | null>;
  private readonly particleLocation: number;
  private readonly pixelRatio: number;

  private easedProgress = 0;
  private targetProgress = 0;
  private igniting = false;
  private igniteProgress = 0;
  private targetX = 0;
  private targetY = 0;
  private targetRadius: number = GATHER_DEFAULTS.targetRadius;
  private lastFrameMs = 0;
  private readonly startedMs = performance.now();

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, pixelRatio: number) {
    this.pixelRatio = pixelRatio;
    // WebGL2 where available — it accepts these GLSL ES 1.00 shaders unchanged (no #version directive),
    // so there is one shader source rather than two.
    const options: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      // The field is drawn once per frame over a fresh clear; nothing needs the previous frame kept.
      preserveDrawingBuffer: false,
    };
    const gl = (canvas.getContext("webgl2", options) ??
      canvas.getContext("webgl", options)) as GL | null;
    if (!gl) throw new Error("gather: no WebGL context");
    this.gl = gl;

    const vertex = compile(gl, gl.VERTEX_SHADER, GATHER_VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, GATHER_FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("gather: could not create program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`gather: program failed to link — ${gl.getProgramInfoLog(program)}`);
    }
    // Linked; the shader objects themselves are no longer needed.
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    this.program = program;

    this.particleLocation = gl.getAttribLocation(program, "aParticle");
    UNIFORM_NAMES.forEach((name) => {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    });

    // Per-particle constants: x = start radius, y = start angle, z = seed.
    const constants = new Float32Array(GATHER_COUNT * 3);
    for (let particle = 0; particle < GATHER_COUNT; particle += 1) {
      const slot = particle * 3;
      // sqrt spreads them evenly across the disc rather than crowding the middle; starting out past the
      // frame edge means matter visibly arrives from outside.
      constants[slot] = 0.45 + Math.sqrt(Math.random()) * 1.75;
      constants[slot + 1] = Math.random() * Math.PI * 2;
      constants[slot + 2] = Math.random();
    }
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("gather: could not create buffer");
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, constants, gl.STATIC_DRAW);

    // The field is additive over a transparent clear: no depth, no culling, and source alpha added onto
    // whatever is behind so overlapping dust accumulates into brightness.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    // Everything that never changes is set once, here.
    gl.useProgram(program);
    gl.uniform1f(this.uniforms.uWind, GATHER_DEFAULTS.wind);
    gl.uniform1f(this.uniforms.uSize, GATHER_DEFAULTS.size);
    gl.uniform1f(this.uniforms.uOpacity, GATHER_DEFAULTS.opacity);
    gl.uniform1f(this.uniforms.uPixelRatio, pixelRatio);
    gl.uniform3fv(this.uniforms.uColorCool, GATHER_DEFAULTS.colorCool as unknown as number[]);
    gl.uniform3fv(this.uniforms.uColorHot, GATHER_DEFAULTS.colorHot as unknown as number[]);
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    // The drawing buffer is in device pixels; the CSS size is the caller's business.
    gl.canvas.width = Math.max(1, Math.floor(width * this.pixelRatio));
    gl.canvas.height = Math.max(1, Math.floor(height * this.pixelRatio));
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uAspect, width / height);
  }

  update(input: GatherFrameInput): void {
    if (input.progress !== undefined) this.targetProgress = input.progress;
    if (input.targetX !== undefined) this.targetX = input.targetX;
    if (input.targetY !== undefined) this.targetY = input.targetY;
    if (input.targetRadius !== undefined) this.targetRadius = input.targetRadius;
  }

  ignite(): void {
    this.igniting = true;
  }

  /**
   * Advance and draw one frame.
   *
   * Note what is NOT here: any reading of shared state. If the main thread is blocked it simply stops
   * posting, and this keeps running against the last value it was given — which is exactly why the field
   * never freezes during a glTF parse or a shader compile.
   */
  renderFrame(): void {
    const gl = this.gl;
    const nowMs = performance.now();
    // First frame has no previous timestamp to difference against.
    const delta = this.lastFrameMs === 0 ? 0 : Math.min((nowMs - this.lastFrameMs) / 1000, MAX_FRAME_SECONDS);
    this.lastFrameMs = nowMs;

    // Exponential approach, framerate-independent.
    this.easedProgress +=
      (this.targetProgress - this.easedProgress) *
      Math.min(1, PROGRESS_EASE_PER_SECOND * delta);

    if (this.igniting) {
      this.igniteProgress = Math.min(1, this.igniteProgress + delta / IGNITE_SECONDS);
    }

    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uProgress, this.easedProgress);
    gl.uniform1f(this.uniforms.uTime, (nowMs - this.startedMs) / 1000);
    gl.uniform1f(this.uniforms.uIgnite, this.igniteProgress);
    gl.uniform2f(this.uniforms.uTarget, this.targetX, this.targetY);
    gl.uniform1f(this.uniforms.uTargetRadius, this.targetRadius);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.particleLocation);
    gl.vertexAttribPointer(this.particleLocation, 3, gl.FLOAT, false, 0, 0);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, GATHER_COUNT);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
    // Free the GPU context immediately rather than waiting for GC — a worker may be terminated right after.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
