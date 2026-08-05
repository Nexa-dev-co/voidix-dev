import { Cache } from 'three';
import type { WebGLRenderer } from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

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
const BASIS_TRANSCODER_PATH = '/basis/';

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

/**
 * ── The page's one KTX2 transcoder ───────────────────────────────────────────────────────────────
 *
 * KTX2 (Basis Universal) textures stay COMPRESSED in GPU memory. Today's WebP maps do not: WebP is a
 * download format, and the driver expands every one of them to raw RGBA plus a mip chain the moment it
 * is uploaded. One 1024² map costs ~5.6 MB resident that way; the same map as ETC1S is ~0.7 MB and as
 * UASTC ~1.4 MB, at the SAME resolution. Across this site's models that is ~169 MB of texture becoming
 * roughly 30 — without shrinking a single picture. See `docs/adaptive-asset-tier-plan.md` §5.0.
 *
 * ⚠ INERT UNTIL THE ASSETS ARE RE-ENCODED. `GLTFLoader` only consults this loader for a model that
 * declares `KHR_texture_basisu`, and every GLB in `public/models` currently declares
 * `EXT_texture_webp` instead. Wiring it ahead of the encode is deliberate: it is the risky half (four
 * call sites, three renderers, an initialisation order that throws if you get it wrong) and it can be
 * reviewed on its own, with nothing visible riding on it.
 *
 * ⚠ Shared for the same reason Draco is, and more so. A `KTX2Loader` fetches `basis_transcoder.wasm`
 * (527 KB) and spins its own worker pool per instance. Four of them would be over 2 MB of transcoder.
 *
 * ⚠ Never disposed, exactly as above: `dispose()` terminates the workers, so the first scene to unmount
 * would break decoding for every scene still alive.
 *
 * ⚠ There is no preload link for the transcoder yet, on purpose. It is 527 KB and nothing fetches it
 * until a model actually carries a KTX2 texture — preloading it today would spend that on every
 * visitor for nothing. Add it beside Draco's in `app/layout.tsx` in the same change that ships the
 * re-encoded models, and for the same reason Draco has one: the transcoder is a SERIAL dependency, not
 * a parallel cost.
 */
let sharedKtx2Loader: KTX2Loader | null = null;

/**
 * Tell the KTX2 loader which compressed formats this machine's GPU accepts.
 *
 * ⚠ This is not optional and it has no Draco equivalent — `KTX2Loader.load()` throws outright if it
 * has never been called. Basis Universal is a *transcode* target, not a GPU format: the file has to be
 * turned into ASTC, ETC2, BC7 or whatever this particular driver supports, and the loader cannot know
 * which until it has been shown a renderer.
 *
 * Call it immediately after creating a renderer. Repeat calls are harmless — `detectSupport` only
 * reads extension flags off the context and writes them to a config object, so the last renderer wins
 * and every renderer on one page reports the same GPU anyway.
 *
 * ⚠ Two of the four model loaders on this site have no renderer to offer: `chamberScene` and
 * `singularityScene` are drawn by the works field's renderer and deliberately never receive it (a GPU
 * texture cannot cross a WebGL context, which is the whole reason they live inside that hook). They
 * are safe regardless, because `useWorksField` — the thing that constructs them — has already called
 * this with the renderer they will be drawn by.
 */
export function detectKtx2Support(renderer: WebGLRenderer): void {
  getSharedKtx2Loader().detectSupport(renderer);
}

/** The page's one KTX2 transcoder. Hand it to a `GLTFLoader` with `setKTX2Loader`. */
export function getSharedKtx2Loader(): KTX2Loader {
  if (!sharedKtx2Loader) {
    sharedKtx2Loader = new KTX2Loader();
    sharedKtx2Loader.setTranscoderPath(BASIS_TRANSCODER_PATH);
  }
  return sharedKtx2Loader;
}
