import {
  LOADER_SHAPES_URL,
  LOADER_SHAPE_HEADER_BYTES,
  LOADER_SHAPE_MAGIC,
  LOADER_SHAPE_MAX,
  LOADER_SHAPE_VERSION,
} from "./loaderShapeManifest";

// The held forms' point clouds, fetched and validated.
//
// ── Why this is a fetch and not an import ────────────────────────────────────────────────────────
// Four shapes is 64 KB of point data. Base64'd into a module it would be ~87 KB of incompressible
// payload inside the LOADER's own chunk — the one piece of JavaScript on this site that has to arrive
// before anything can be drawn at all, and the thing whose whole job is to already be on screen while
// everything else downloads. A binary in `public/` costs the same bytes at a moment when they are
// free: the field streams as it always did until this lands, and only then can it gather.
//
// ── Where it runs ───────────────────────────────────────────────────────────────────────────────
// In the WORKER, on the same thread as the render loop, so the decode never touches the main thread
// while it is parsing glTF. `fetch` and `DataView` are both available there. The main-thread fallback
// path (browsers without OffscreenCanvas) calls the same function, which is why nothing here touches
// `window` or `document`.
//
// ⚠ EVERY failure path returns null rather than throwing. A loading screen that cannot load its own
// decoration must still be a loading screen — the field falls back to the plain stream, which is what
// it did for its entire life before the forms existed.

export interface LoaderShapePoints {
  shapeCount: number;
  pointCount: number;
  /** `shapeCount × pointCount × 2`, normalised −1..1 scaled to the Int16 range. */
  points: Int16Array;
}

export async function fetchLoaderShapes(): Promise<LoaderShapePoints | null> {
  try {
    const response = await fetch(LOADER_SHAPES_URL, { credentials: "same-origin" });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < LOADER_SHAPE_HEADER_BYTES) return null;

    const header = new DataView(buffer);
    // A stale or half-written file must not be read as coordinates. Both checks are cheap and both
    // have a real failure behind them: a cached bin from an older bake, and a server that answered a
    // 404 page with a 200.
    if (header.getUint32(0, true) !== LOADER_SHAPE_MAGIC) return null;
    if (header.getUint16(4, true) !== LOADER_SHAPE_VERSION) return null;

    const shapeCount = header.getUint16(6, true);
    const pointCount = header.getUint32(8, true);
    if (shapeCount < 1 || shapeCount > LOADER_SHAPE_MAX || pointCount < 1) return null;

    const expected = shapeCount * pointCount * 2;
    if (buffer.byteLength < LOADER_SHAPE_HEADER_BYTES + expected * 2) return null;

    return {
      shapeCount,
      pointCount,
      points: new Int16Array(buffer, LOADER_SHAPE_HEADER_BYTES, expected),
    };
  } catch {
    // Offline, aborted, blocked — the stream is the fallback and it is a good one.
    return null;
  }
}
