import {
  CAMERA_DISTANCE,
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
  /** The sun's body radius on screen, in aspect units — the unit the whole flow is measured in. */
  sunRadius?: number;
  /** 1 while the shards are docking, 0 otherwise. Eased internally into the withdrawal. */
  clearing?: number;
  /**
   * 1 to gather the field into held forms, 0 to return it to the stream. Eased internally.
   *
   * Only worth engaging when the wait is genuinely long — see GatherCanvas, which decides from a
   * measured download ETA rather than from a stopwatch.
   */
  shapeHold?: number;
}

const MAX_FRAME_SECONDS = 0.05;
// How fast the eased progress chases the real value. Progress arrives in jumps as each asset lands.
const PROGRESS_EASE_PER_SECOND = 2.2;
const IGNITE_SECONDS = 0.55;

// ── Flow rate ──
// Trips per second: how fast a particle falls from the far edge of the stream to the sun's rim. This is
// where real progress is spent — a cold start is a slow trickle from deep space, a finished load is a
// torrent — so the field reports the truth while never once holding a still pose.
// ⚠ IDLE was 0.16 — one trip every SIX SECONDS. Against a grain clamped to a single pixel (see
// SIZE_MIN_PIXELS), six seconds of travel is not slow motion, it is stillness: nothing on screen
// visibly moves, which is the one thing this field exists to guarantee during a long wait. 0.3 is
// ~3.3s per trip, which reads as a current. The ratio to FULL is still 1:1.7, so the stream visibly
// quickens as the load completes and progress remains legible without a number.
const FLOW_TRIPS_PER_SECOND_IDLE = 0.3; //  ~3.3s per trip
const FLOW_TRIPS_PER_SECOND_FULL = 0.5; //  ~2s per trip
/** Ignition dumps whatever is left into the star, so the stream surges as the sun lights. */
const FLOW_IGNITE_SURGE = 3;

/** Fallback sun radius (aspect units) until the "o" has been measured — roughly its desktop value. */
const DEFAULT_SUN_RADIUS = 0.17;

/** Floats per particle: startX, startY, phaseOffset, seed. */
const PARTICLE_STRIDE = 4;

/**
 * How quickly the dust withdraws from around the star, and returns.
 *
 * Asymmetric on purpose: it clears briskly so the frame is empty before the first shard crosses in, and
 * flows back gently once the star is whole, so the return reads as the field settling rather than as a
 * light being switched on.
 */
const CLEAR_OUT_PER_SECOND = 2.4;
const CLEAR_IN_PER_SECOND = 1.1;

// ── The held forms ──
/**
 * How long one form lasts, cue to cue: it holds for SHAPE_HOLD_FRACTION of this and spends the rest
 * dissolving into the next. Slow on purpose — this exists to fill a minute, and a shape that arrives
 * and leaves in three seconds reads as a slideshow rather than as something forming out of the dust.
 */
const SHAPE_CYCLE_SECONDS = 9;
/**
 * How fast the field crosses between the stream and a form.
 *
 * Asymmetric, for the same reason the clearing is: it gathers unhurriedly because that crossing IS
 * the effect, and it releases briskly because the only thing that ever releases it is the star having
 * landed — at which point the loader has a finale to get to and the dust should already be back in
 * its stream.
 */
const SHAPE_GATHER_PER_SECOND = 0.42;
const SHAPE_RELEASE_PER_SECOND = 1.3;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const UNIFORM_NAMES = [
  "uFlow",
  "uProgress",
  "uTime",
  "uIgnite",
  "uClearing",
  "uTarget",
  "uSunRadius",
  "uCameraDistance",
  "uWind",
  "uAspect",
  "uSize",
  "uOpacity",
  "uPixelRatio",
  "uColorCool",
  "uColorHot",
  "uShapeHold",
  "uShapePhase",
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
  private sunRadius = DEFAULT_SUN_RADIUS;
  private clearing = 0;
  private targetClearing = 0;
  /** 0 = streaming, 1 = fully gathered into a held form. Eased; the caller posts a raw target. */
  private shapeHold = 0;
  private targetShapeHold = 0;
  /**
   * Which form, and how far into the next — advanced HERE rather than posted.
   *
   * The main thread posts roughly ten times a second, which is fine for a value the shader eases but
   * would make a morph visibly stair-step. The worker owns the render loop and its own clock, so the
   * sequence runs off delta time and stays smooth even while the main thread is blocked parsing glTF —
   * which is the whole reason the field lives out here.
   */
  private shapePhase = 0;
  /** Accumulated trips. Only ever increases, so the stream can never stutter or reverse. */
  private flow = 0;
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

    // Per-particle constants: xy = start point on screen, z = phase offset, w = seed.
    //
    // The start point is uniform over the viewport in normalised units — the shader multiplies x by the
    // aspect, so the field covers the whole screen at any window shape without regenerating the buffer.
    //
    // The phase offsets are spread evenly rather than randomly: a random spread clumps, and a clumped
    // stream pulses instead of flowing. The seed stays random — it is the density threshold, and it must
    // not correlate with where in its fall a particle happens to be.
    const constants = new Float32Array(GATHER_COUNT * PARTICLE_STRIDE);
    for (let particle = 0; particle < GATHER_COUNT; particle += 1) {
      const slot = particle * PARTICLE_STRIDE;
      constants[slot] = Math.random() * 2 - 1;
      constants[slot + 1] = Math.random() * 2 - 1;
      constants[slot + 2] = particle / GATHER_COUNT;
      constants[slot + 3] = Math.random();
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
    gl.uniform1f(this.uniforms.uCameraDistance, CAMERA_DISTANCE);
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
    if (input.sunRadius !== undefined) this.sunRadius = input.sunRadius;
    if (input.clearing !== undefined) this.targetClearing = input.clearing;
    if (input.shapeHold !== undefined) this.targetShapeHold = input.shapeHold;
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

    // The stream runs faster the more of the site has landed, and surges as the star lights. Progress is
    // spent HERE rather than on particle positions — see the header of gatherShader.ts.
    const trips =
      FLOW_TRIPS_PER_SECOND_IDLE +
      (FLOW_TRIPS_PER_SECOND_FULL - FLOW_TRIPS_PER_SECOND_IDLE) * this.easedProgress;
    this.flow += delta * trips * (1 + this.igniteProgress * FLOW_IGNITE_SURGE);

    const clearRate =
      this.targetClearing > this.clearing ? CLEAR_OUT_PER_SECOND : CLEAR_IN_PER_SECOND;
    const clearStep = clearRate * delta;
    this.clearing +=
      Math.sign(this.targetClearing - this.clearing) *
      Math.min(clearStep, Math.abs(this.targetClearing - this.clearing));

    const shapeRate =
      this.targetShapeHold > this.shapeHold ? SHAPE_GATHER_PER_SECOND : SHAPE_RELEASE_PER_SECOND;
    const shapeStep = shapeRate * delta;
    this.shapeHold +=
      Math.sign(this.targetShapeHold - this.shapeHold) *
      Math.min(shapeStep, Math.abs(this.targetShapeHold - this.shapeHold));

    // Only runs while a form is actually on screen, so the sequence always begins at the first one
    // rather than wherever a free-running clock happened to be when the field was asked to gather.
    if (this.shapeHold > 0) this.shapePhase += delta / SHAPE_CYCLE_SECONDS;

    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uFlow, this.flow);
    gl.uniform1f(this.uniforms.uClearing, this.clearing);
    gl.uniform1f(this.uniforms.uShapeHold, this.shapeHold);
    gl.uniform1f(this.uniforms.uShapePhase, this.shapePhase);
    gl.uniform1f(this.uniforms.uProgress, this.easedProgress);
    gl.uniform1f(this.uniforms.uTime, (nowMs - this.startedMs) / 1000);
    gl.uniform1f(this.uniforms.uIgnite, this.igniteProgress);
    gl.uniform2f(this.uniforms.uTarget, this.targetX, this.targetY);
    gl.uniform1f(this.uniforms.uSunRadius, this.sunRadius);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.particleLocation);
    gl.vertexAttribPointer(this.particleLocation, PARTICLE_STRIDE, gl.FLOAT, false, 0, 0);

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
