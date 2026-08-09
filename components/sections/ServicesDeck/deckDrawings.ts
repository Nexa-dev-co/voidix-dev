import {
  DECK_DRAWINGS_COORDINATE_SCALE,
  DECK_DRAWINGS_HEADER_BYTES,
  DECK_DRAWINGS_MAGIC,
  DECK_DRAWINGS_URL,
  DECK_DRAWINGS_VERSION,
  DECK_HERO_LIFT_Y,
  DECK_PLAN_DORSAL,
  DECK_PLAN_NOSE,
  DECK_PLAN_RIGHT,
} from './deckDrawingsManifest';

// The fleet's four drawings, fetched and validated.
//
// ── Why a fetch and not an import ────────────────────────────────────────────────────────────────
// 153 KB of Int16 is ~204 KB base64'd into a module, and incompressible. It would sit in the deck's
// own chunk, downloading before the scene can be constructed at all. As a binary in public/ it
// streams alongside the one hull that still ships and costs nothing until then.
//
// ⚠ EVERY failure path returns null rather than throwing, exactly as the loader's own shape decoder
// does. What the deck does without it is the real question, and the answer is: not much — three of
// the four stops ARE this file. So the fallback is the hull alone at the hero stop and an empty stage
// elsewhere, which is bad but is not a crash, and the loader's counter still completes.

export interface FleetDrawings {
  shapeCount: number;
  pointCount: number;
  /** Which drawing becomes a ship. Every other stop is a drawing and never anything else. */
  heroIndex: number;
  segmentCount: number;
  /** `shapeCount × pointCount × 2` — every craft's drawing, in the plane spanned by RIGHT and NOSE. */
  drawings: Float32Array;
  /** `pointCount × 3` — where each of those points lives on the hero's actual hull. */
  heroSolid: Float32Array;
  /** `segmentCount × 2 × 3` — the hero's feature edges, for the wireframe. */
  heroSegments: Float32Array;
  /**
   * All of the above are in DECK UNITS: the craft's largest dimension spans 1, centred on its own
   * bounding box. Multiply by TARGET_SIZE and lift by TARGET_SIZE × this to land exactly where
   * prepareVessel puts the hull.
   */
  heroLiftY: number;
  planRight: readonly [number, number, number];
  planNose: readonly [number, number, number];
  planDorsal: readonly [number, number, number];
}

export async function fetchFleetDrawings(): Promise<FleetDrawings | null> {
  try {
    const response = await fetch(DECK_DRAWINGS_URL, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < DECK_DRAWINGS_HEADER_BYTES) return null;

    const header = new DataView(buffer);
    // A stale or half-written file must not be read as coordinates. Both checks are cheap and both
    // have a real failure behind them: a cached bin from an older bake, and a server that answered a
    // 404 page with a 200.
    if (header.getUint32(0, true) !== DECK_DRAWINGS_MAGIC) return null;
    if (header.getUint16(4, true) !== DECK_DRAWINGS_VERSION) return null;

    const shapeCount = header.getUint16(6, true);
    const pointCount = header.getUint32(8, true);
    const heroIndex = header.getUint16(12, true);
    const segmentCount = header.getUint32(16, true);
    // Four is the shader's limit — every grain carries its place in every drawing as a vertex
    // attribute, packed two shapes to a vec4. A fifth needs the targets in a data texture read by the
    // VERTEX shader, so this fails closed rather than silently dropping one.
    if (shapeCount < 1 || shapeCount > 4 || pointCount < 1) return null;
    if (heroIndex >= shapeCount || segmentCount < 1) return null;

    const drawingValues = shapeCount * pointCount * 2;
    const solidValues = pointCount * 3;
    const wireValues = segmentCount * 6;
    const total = drawingValues + solidValues + wireValues;
    if (buffer.byteLength < DECK_DRAWINGS_HEADER_BYTES + total * 2) return null;

    const stored = new Int16Array(buffer, DECK_DRAWINGS_HEADER_BYTES, total);
    const scale = 1 / DECK_DRAWINGS_COORDINATE_SCALE;
    const dequantise = (from: number, count: number) => {
      const values = new Float32Array(count);
      for (let value = 0; value < count; value += 1) values[value] = stored[from + value] * scale;
      return values;
    };

    return {
      shapeCount,
      pointCount,
      heroIndex,
      segmentCount,
      drawings: dequantise(0, drawingValues),
      heroSolid: dequantise(drawingValues, solidValues),
      heroSegments: dequantise(drawingValues + solidValues, wireValues),
      heroLiftY: DECK_HERO_LIFT_Y,
      planRight: DECK_PLAN_RIGHT,
      planNose: DECK_PLAN_NOSE,
      planDorsal: DECK_PLAN_DORSAL,
    };
  } catch {
    // Offline, aborted, blocked.
    return null;
  }
}
