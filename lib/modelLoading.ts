import { Cache } from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * One Draco decoder and one file cache for the whole page.
 *
 * Every module that loads a `.glb` imports from here, which is what makes the module-scope line below
 * safe to rely on: it has necessarily run before anything on this site has fetched a model.
 *
 * ── Why one decoder ──────────────────────────────────────────────────────────────────────────────
 * There used to be four `new DRACOLoader()` — the hero sun, the fleet, the chamber and the contact
 * star. Three's `decoderPending` is PER INSTANCE (`DRACOLoader.js`, and `_loadLibrary` goes through
 * `FileLoader`), so each one independently fetched `draco_wasm_wrapper.js` (57 KB) and
 * `draco_decoder.wasm` (188 KB), and each one span up its own pool of decoder workers.
 *
 *     before   4 x 245 KB of decoder, 4 worker pools
 *     after    1 x 245 KB, 1 pool
 *
 * The preload in `app/layout.tsx` only ever covered the first of those four.
 *
 * ⚠ It is deliberately NEVER disposed. `dispose()` terminates the decoder workers, so a shared loader
 * torn down by whichever scene unmounted first would silently break decoding for every scene still
 * alive. Its lifetime is the page's, which is the same lifetime the four separate ones effectively
 * had anyway — the difference is that there is now one of them.
 */

const DRACO_DECODER_PATH = '/draco/';

/**
 * ── Why the file cache is on ─────────────────────────────────────────────────────────────────────
 * Off by default in three, and being off cost real bytes here, because two different things ask for
 * the same files:
 *
 *   · `fractured_sun.glb` (1.31 MB) is loaded TWICE — once by `SunModelCanvas` for the hero, once by
 *     `singularityScene` for the star that dies at contact. The second fetch happens mid-scroll,
 *     during the chamber reveal, which is the worst moment on the site to spend a megabyte.
 *   · the Draco decoder, four times over, before the change above.
 *
 * With the cache on, the second ask is answered from memory and never touches the network — including
 * across React StrictMode's development double-mount, which until now genuinely re-downloaded every
 * model on every dev page load.
 *
 * ⚠ The cost is real and worth stating: three's `Cache` is a plain Map with NO eviction, so every
 * response stays as a raw ArrayBuffer for the life of the page — roughly 10 MB across every model
 * here. That is system memory, not GPU memory, and this site's constraint is GPU memory
 * (`docs/lag-and-freeze-diagnosis.md` §1), so it is a good trade. It would stop being one if the
 * asset set grew several times over.
 *
 * It does NOT dedupe the parsed result: two loads of the same URL still produce two independent scene
 * graphs with their own geometries and textures. That is what the hero and the contact star each
 * need — only the download is shared.
 */
Cache.enabled = true;

let sharedDracoLoader: DRACOLoader | null = null;

/** The page's one Draco decoder. Hand it to a `GLTFLoader` with `setDRACOLoader`. */
export function getSharedDracoLoader(): DRACOLoader {
  if (!sharedDracoLoader) {
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  }
  return sharedDracoLoader;
}
