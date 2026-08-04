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
 * ── ⚠ THE FILE CACHE MUST STAY OFF. Turning it on breaks the works field. ────────────────────────
 *
 * It is tempting: `fractured_sun.glb` (1.31 MB) is genuinely loaded TWICE — by `SunModelCanvas` for
 * the hero and by `singularityScene` for the star that dies at contact — and the second fetch lands
 * mid-scroll during the chamber reveal. Enabling three's `Cache` deduplicates exactly that.
 *
 * It also breaks the section, via a real defect in three's own `ImageLoader`. Its cache entry is
 * added BEFORE the image has finished decoding (its error path calls `Cache.remove`, which is only
 * meaningful if an incomplete entry can exist), so a second request for a still-loading image takes
 * this branch:
 *
 *     if ( cached.complete === true ) {
 *       scope.manager.itemStart( url );                  // bookkeeping happens
 *       setTimeout( () => { onLoad( cached ); scope.manager.itemEnd( url ); }, 0 );
 *     } else {
 *       _loading.get( cached ).push( { onLoad, onError } );   // <-- and NOTHING ELSE
 *     }
 *
 * The queued callback does fire, so the texture arrives — but that request's `LoadingManager` is
 * never told an item started or ended. Its `itemsTotal` stays 0, and `LoadingManager.onLoad` only
 * ever fires from `itemEnd`.
 *
 * `useWorksField` hangs its ENTIRE build off `loadingManager.onLoad`. Under React StrictMode the
 * effect runs twice against the same texture URL, so with the cache on:
 *
 *     run #1  starts the image, is torn down, its onLoad fires, build bails on `disposed`  ✓ correct
 *     run #2  finds the in-flight cache entry, takes the else branch, manager never fires  ✗ no build
 *
 * The surviving run therefore never calls `onStatus({ isLoading: false })` and the section sits
 * behind "Charting the field · 100%" forever. Diagnosed 2026-08-04 from the `[works #N]` trace in
 * `useWorksField`, which is still there and will say so again in one line if this is ever retried.
 *
 * The Draco duplication this was also meant to solve is already fixed properly, by the single shared
 * loader below. What is left on the table is one 1.31 MB re-download. If that is ever worth
 * reclaiming, do it WITHOUT this flag: fetch the star's bytes once into a module-level promise and
 * hand the same ArrayBuffer to `GLTFLoader.parse()` twice. The two consumers need separate scene
 * graphs anyway, so only the download was ever shareable.
 */
Cache.enabled = false;

let sharedDracoLoader: DRACOLoader | null = null;

/** The page's one Draco decoder. Hand it to a `GLTFLoader` with `setDRACOLoader`. */
export function getSharedDracoLoader(): DRACOLoader {
  if (!sharedDracoLoader) {
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  }
  return sharedDracoLoader;
}
