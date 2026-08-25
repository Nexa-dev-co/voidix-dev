import * as THREE from 'three';

/**
 * Build a scene's programs and upload its maps before anything asks to draw it.
 *
 * ── Why both halves are needed ───────────────────────────────────────────────────────────────────
 * `renderer.compile()` builds PROGRAMS only. three uploads a texture the first time it is bound for a
 * real draw — so a scene that has been compiled but never drawn still has every one of its maps
 * waiting, and they all land together on the frame it first appears. A texture upload with mipmap
 * generation is the more expensive half of the two.
 *
 * ── Why this matters more than it looks ──────────────────────────────────────────────────────────
 * ⚠ THIS IS THE SHAPE OF THE BUG THAT FROZE THE LOADER, and it looked nothing like a shader compile:
 * the whole page stopped, INCLUDING a dust field rendering in a worker on an OffscreenCanvas, which
 * main-thread JavaScript cannot block at all. That is the tell. The stall is in the GPU PROCESS, and
 * the compositor cannot present anyone's frames while that is busy, worker canvases included. If a
 * freeze ever takes a worker canvas with it again, look for GPU work, not for a long task.
 *
 * The instance that taught us this was the hero sun's corona: ~23 programs and their maps, all held
 * `visible = false` for the whole download so the star could light inside its closing shell, all
 * turning visible on one frame in the middle of the loader's finale. Nothing is special about the sun
 * — any scene built lazily and drawn later has the same shape, which is why this lives in `lib/`.
 *
 * ── Fire and forget ──────────────────────────────────────────────────────────────────────────────
 * Nothing awaits the compile: the caller wants the work started on a quiet frame, not to know when it
 * finished, and the driver has long since finished linking by the time the scene is actually shown.
 * The catch only stops a failure surfacing as an unhandled rejection — a material that fails here
 * compiles late, exactly as it would have without this.
 *
 * ⚠ Call this on an IDLE frame, never inline with other GPU work. It is a deliberate stall; the whole
 * point is choosing where it lands.
 *
 * ── ⚠ AND IT IS WORTHLESS WITHOUT `drawnInto`, WHICH IS WHY THAT ARGUMENT EXISTS ────────────────
 * three keys a program on `toneMapping` AND `outputColorSpace`, and BOTH of those are read off
 * `renderer.getRenderTarget()` at compile time (WebGLPrograms `getParameters`): with nothing bound
 * they take the renderer's own values, and with a target bound they collapse to `NoToneMapping` and
 * the working colour space. So a compile run on a bare rAF — where the last thing anyone bound was
 * the default framebuffer — produces programs under a cache key that a scene rendered through an
 * EffectComposer will NEVER ask for, and every one of them is compiled again, synchronously, on the
 * frame it is first drawn. Exactly the stall this file exists to prevent, silently doing nothing.
 *
 * So `drawnInto` is a LIST of every surface the scene is drawn into, and it has no default: a wrong
 * answer here is silent, so every caller states one. Only null-ness is read, so any one of a composer's
 * targets stands for that composer, and `null` stands for the canvas.
 *
 * ⚠ It is a list because a scene drawn BOTH ways needs BOTH programs, and the hero sun is exactly that:
 * `sunBloom` renders it into `sceneTarget` to derive the glow and then again to the canvas for the
 * image. Warming one key leaves the other to compile on the frame that surface first sees the object —
 * which for the corona is the frame it lights inside the closing shell, i.e. the shot.
 */

/** Anything on a material that is actually a texture, without reaching for `any` to find it. */
function asTexture(value: unknown): THREE.Texture | null {
  return value instanceof THREE.Texture ? value : null;
}

export function warmSceneMaterials(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
  drawnInto: readonly (THREE.WebGLRenderTarget | null)[],
): void {
  // 1 · Programs, once per surface. `compile` walks with `traverse`, NOT `traverseVisible` (three r184
  //     — only its light gathering is visibility-filtered), so objects hidden until their moment are
  //     compiled here too.
  //     ⚠ It also runs SYNCHRONOUSLY: `compileAsync` calls `this.compile()` before it awaits anything,
  //     and only the wait for the driver to report linking done is offloaded. That is what lets the
  //     target be put back on the line after the call: the compile has already happened by then, and
  //     only the driver's linking report is still outstanding.
  const previousTarget = renderer.getRenderTarget();
  const previousCubeFace = renderer.getActiveCubeFace();
  const previousMipmapLevel = renderer.getActiveMipmapLevel();
  try {
    drawnInto.forEach((surface) => {
      renderer.setRenderTarget(surface);
      renderer.compileAsync(scene, camera).catch(() => {});
    });
  } finally {
    renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
  }

  // 2 · Maps, once for all of them — a texture upload is a property of the texture, not of whatever is
  //     going to sample it. See the header: `compile` does not do this half at all.
  const uploaded = new Set<THREE.Texture>();
  scene.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    if (!material) return;
    (Array.isArray(material) ? material : [material]).forEach((entry) => {
      Object.values(entry).forEach((value) => {
        const texture = asTexture(value);
        if (!texture || uploaded.has(texture)) return;
        uploaded.add(texture);
        renderer.initTexture(texture);
      });
    });
  });
}
