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
 * Pass the target the scene is really drawn into. Only its null-ness is read, so any of the
 * composer's targets is the right answer for a scene that lives in a composer, and `null` is the right
 * answer for one drawn straight to the canvas. It has NO default deliberately — a wrong answer here is
 * silent, so every caller states one.
 *
 * ⚠ A scene drawn BOTH ways needs both, and the hero sun is one: `sunBloom` renders it into
 * `sceneTarget` for the glow and again to the canvas for the image. It warms the canvas key only, so
 * its corona still pays one compile on the frame the glow first sees it. Left as it stands rather than
 * widened blind — the sun's warm-up sits inside a loader budget that is accounted for elsewhere.
 */

/** Anything on a material that is actually a texture, without reaching for `any` to find it. */
function asTexture(value: unknown): THREE.Texture | null {
  return value instanceof THREE.Texture ? value : null;
}

export function warmSceneMaterials(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
  drawnInto: THREE.WebGLRenderTarget | null,
): void {
  // 1 · Programs. `compile` walks with `traverse`, NOT `traverseVisible` (three r184 — only its light
  //     gathering is visibility-filtered), so objects hidden until their moment are compiled here too.
  //     ⚠ It also runs SYNCHRONOUSLY: `compileAsync` calls `this.compile()` before it awaits anything,
  //     and only the wait for the driver to report linking done is offloaded. That is what lets the
  //     target be put back on the line after the call: the compile has already happened by then, and
  //     only the driver's linking report is still outstanding.
  const previousTarget = renderer.getRenderTarget();
  const previousCubeFace = renderer.getActiveCubeFace();
  const previousMipmapLevel = renderer.getActiveMipmapLevel();
  renderer.setRenderTarget(drawnInto);
  try {
    renderer.compileAsync(scene, camera).catch(() => {});
  } finally {
    renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
  }

  // 2 · Maps. See the header: `compile` does not upload them.
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
