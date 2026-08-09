// The outer shell of a GLB, as an SVG.
//
// Decodes the model's geometry, projects it orthographically from an orbit angle, rasterises the
// union of every triangle, and traces the coverage field with marching squares. The result is the
// hull's true silhouette from that angle — not a drawing of a ship, the ship.
//
// ── What it is FOR: PICKING THE ANGLE. Nothing it writes ships ───────────────────────────────────
// Four views of the fighter were extracted and only one reads as a starfighter — that judgement needs
// pictures, and this makes them. A true silhouette is the right rendering for judging a SHAPE, where
// the feature-edge blueprint next door is the right one for drawing a ship.
//
// The art in deck-shapes-src/ and the point clouds the deck actually holds both come from
// `buildFleetDrawings.mjs`. This is an exploratory tool: run it by hand with explicit yaw/pitch
// arguments, look at the PNGs, then set the chosen view in `shipGeometry.PLAN_VIEW`.
//
// Usage:
//   node scripts/buildShipSilhouette.mjs <model.glb> <outputDirectory> [yaw,pitch …]

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readWorldTriangles, orbitBasis, PLAN_VIEW } from './shipGeometry.mjs';
import { coveragePng, rasteriseSegments } from './previewImage.mjs';

/** Supersampling factor for the triangle raster, box-filtered down into the coverage field. */
const SUPERSAMPLE = 4;
/** The coverage grid the contour is traced on, and the SVG's viewBox. */
const GRID = 1024;
/** Fraction of the shape's size a simplified vertex may stray from the true contour. */
const SIMPLIFY_TOLERANCE = 0.0012;
/** Contours enclosing less than this fraction of the frame are noise, not features. */
const MIN_CONTOUR_AREA = 0.0004;
/**
 * Outline weight, as a fraction of the viewBox.
 *
 * The loader's own sources draw at ~2%. This is thinner because this shape has real thin features —
 * the wing pylons are a couple of percent wide themselves, and a 2% stroke welds each one into a
 * solid bar instead of drawing its two edges.
 */
const STROKE_FRACTION = 0.011;
/** Empty frame kept around the ink, as a fraction of the shape's largest dimension. */
const FRAME_MARGIN = 0.02;

// ── Projection ───────────────────────────────────────────────────────────────────────────────────

function project(triangles, basis) {
  const { right, up } = basis;
  const points = new Float64Array((triangles.length / 3) * 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let vertex = 0; vertex < triangles.length; vertex += 3) {
    const x = triangles[vertex] * right[0] + triangles[vertex + 1] * right[1] + triangles[vertex + 2] * right[2];
    const y = triangles[vertex] * up[0] + triangles[vertex + 1] * up[1] + triangles[vertex + 2] * up[2];
    points[(vertex / 3) * 2] = x;
    points[(vertex / 3) * 2 + 1] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { points, minX, minY, maxX, maxY };
}

/** The union of every projected triangle, as a coverage field on a GRID × GRID lattice. */
function rasterise(projected) {
  const size = GRID * SUPERSAMPLE;
  const mask = new Uint8Array(size * size);

  const extent = Math.max(projected.maxX - projected.minX, projected.maxY - projected.minY) * (1 + FRAME_MARGIN * 2);
  const centreX = (projected.minX + projected.maxX) / 2;
  const centreY = (projected.minY + projected.maxY) / 2;
  const scale = size / extent;

  const toPixelX = (x) => (x - centreX) * scale + size / 2;
  // Y flips: an image counts downward and the view's space counts up.
  const toPixelY = (y) => size / 2 - (y - centreY) * scale;

  const { points } = projected;
  for (let triangle = 0; triangle < points.length; triangle += 6) {
    const ax = toPixelX(points[triangle]);
    const ay = toPixelY(points[triangle + 1]);
    const bx = toPixelX(points[triangle + 2]);
    const by = toPixelY(points[triangle + 3]);
    const cx = toPixelX(points[triangle + 4]);
    const cy = toPixelY(points[triangle + 5]);

    const top = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const bottom = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    const left = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const rightEdge = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    if (top > bottom || left > rightEdge) continue;

    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    const inverseArea = 1 / area;

    for (let row = top; row <= bottom; row += 1) {
      const pointY = row + 0.5;
      for (let column = left; column <= rightEdge; column += 1) {
        const pointX = column + 0.5;
        const w0 = ((bx - ax) * (pointY - ay) - (by - ay) * (pointX - ax)) * inverseArea;
        const w1 = ((pointX - ax) * (cy - ay) - (pointY - ay) * (cx - ax)) * inverseArea;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) mask[row * size + column] = 1;
      }
    }
  }

  // Box-downsample the binary mask into a coverage field the contour tracer can interpolate.
  const coverage = new Float32Array(GRID * GRID);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      let hits = 0;
      for (let subRow = 0; subRow < SUPERSAMPLE; subRow += 1) {
        const base = (row * SUPERSAMPLE + subRow) * size + column * SUPERSAMPLE;
        for (let subColumn = 0; subColumn < SUPERSAMPLE; subColumn += 1) hits += mask[base + subColumn];
      }
      coverage[row * GRID + column] = hits / samples;
    }
  }
  return coverage;
}

// ── Contour tracing ──────────────────────────────────────────────────────────────────────────────

/** Marching squares at half coverage, with linear interpolation along each crossed cell edge. */
function traceContours(field) {
  const segments = [];
  const sample = (column, row) =>
    column < 0 || row < 0 || column >= GRID || row >= GRID ? 0 : field[row * GRID + column];
  const crossing = (a, b) => (0.5 - a) / (b - a);

  for (let row = -1; row < GRID; row += 1) {
    for (let column = -1; column < GRID; column += 1) {
      const topLeft = sample(column, row);
      const topRight = sample(column + 1, row);
      const bottomRight = sample(column + 1, row + 1);
      const bottomLeft = sample(column, row + 1);

      const code =
        (topLeft >= 0.5 ? 8 : 0) | (topRight >= 0.5 ? 4 : 0) |
        (bottomRight >= 0.5 ? 2 : 0) | (bottomLeft >= 0.5 ? 1 : 0);
      if (code === 0 || code === 15) continue;

      const top = [column + crossing(topLeft, topRight), row];
      const rightEdge = [column + 1, row + crossing(topRight, bottomRight)];
      const bottom = [column + crossing(bottomLeft, bottomRight), row + 1];
      const leftEdge = [column, row + crossing(topLeft, bottomLeft)];

      // Wound so the inside stays on the left, which is what makes holes come out reversed and lets
      // fill-rule="evenodd" knock them through.
      const push = (from, to) => segments.push([from, to]);
      switch (code) {
        case 1: push(leftEdge, bottom); break;
        case 2: push(bottom, rightEdge); break;
        case 3: push(leftEdge, rightEdge); break;
        case 4: push(rightEdge, top); break;
        case 5: push(leftEdge, top); push(bottom, rightEdge); break;
        case 6: push(bottom, top); break;
        case 7: push(leftEdge, top); break;
        case 8: push(top, leftEdge); break;
        case 9: push(top, bottom); break;
        case 10: push(top, leftEdge); push(bottom, rightEdge); break;
        case 11: push(top, rightEdge); break;
        case 12: push(rightEdge, leftEdge); break;
        case 13: push(rightEdge, bottom); break;
        case 14: push(bottom, leftEdge); break;
      }
    }
  }

  // Link the segments end to end into closed loops. Endpoints are exact repeats of the same
  // interpolation, so a quantised key matches them without a tolerance search.
  const key = ([x, y]) => `${Math.round(x * 4096)}:${Math.round(y * 4096)}`;
  const starts = new Map();
  for (const segment of segments) {
    const at = key(segment[0]);
    if (!starts.has(at)) starts.set(at, []);
    starts.get(at).push(segment);
  }

  const loops = [];
  const used = new Set();
  for (const segment of segments) {
    if (used.has(segment)) continue;
    const loop = [segment[0]];
    let current = segment;
    while (current && !used.has(current)) {
      used.add(current);
      loop.push(current[1]);
      current = (starts.get(key(current[1])) ?? []).find((candidate) => !used.has(candidate));
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** Douglas–Peucker on an open polyline. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let furthest = -1;
    let furthestDistance = tolerance;
    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let index = first + 1; index < last; index += 1) {
      const [x, y] = points[index];
      const distance = Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / length;
      if (distance > furthestDistance) {
        furthest = index;
        furthestDistance = distance;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

/**
 * Douglas–Peucker on a CLOSED loop.
 *
 * ⚠ Run naively, a closed loop simplifies to nothing: the anchor chord runs from the first point to
 * the last, which are the same point, so every vertex measures zero deviation from it and the whole
 * outline collapses to two. Cutting the loop at its most distant vertex gives each half a chord with
 * real length.
 */
function simplifyLoop(points, tolerance) {
  if (points.length < 4) return points;
  const [originX, originY] = points[0];
  let furthest = 0;
  let furthestDistance = -1;
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.hypot(points[index][0] - originX, points[index][1] - originY);
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthest = index;
    }
  }
  const front = simplify(points.slice(0, furthest + 1), tolerance);
  const back = simplify(points.slice(furthest), tolerance);
  return front.concat(back.slice(1, -1));
}

// ── Output ───────────────────────────────────────────────────────────────────────────────────────

function pathData(loops) {
  return loops
    .map((loop) =>
      loop.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join('') + 'Z',
    )
    .join('\n        ');
}

/** The outer shell as solid ink. */
function toFilledSvg(loops) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${GRID}" height="${GRID}">
  <path fill="#000000" fill-rule="evenodd" d="
        ${pathData(loops)}"/>
</svg>
`;
}

/**
 * The same shell as line art.
 *
 * A filled silhouette reads as a solid slab; an outline puts every mark on an EDGE, which is both
 * what reads as a drawing of a ship and what a wireframe is already made of.
 */
function toOutlinedSvg(loops) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${GRID}" height="${GRID}">
  <path fill="none" stroke="#000000" stroke-width="${(GRID * STROKE_FRACTION).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round" d="
        ${pathData(loops)}"/>
</svg>
`;
}

/** Loops → the flat segment list the previewer draws. */
function loopsToSegments(loops) {
  const segments = [];
  for (const loop of loops) {
    for (let index = 0; index < loop.length; index += 1) {
      const [x1, y1] = loop[index];
      const [x2, y2] = loop[(index + 1) % loop.length];
      segments.push(x1, y1, x2, y2);
    }
  }
  return segments;
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────

const [modelPath, outputDirectory, ...viewArguments] = process.argv.slice(2);
if (!modelPath || !outputDirectory) {
  console.error('Usage: node scripts/buildShipSilhouette.mjs <model.glb> <outputDirectory> [yaw,pitch …]');
  process.exit(1);
}

const skipMeshes = new Set((process.env.SKIP_MESHES ?? '').split(',').filter(Boolean).map(Number));
mkdirSync(outputDirectory, { recursive: true });

const triangles = await readWorldTriangles(modelPath, skipMeshes);
console.log(`${triangles.length / 9} triangles`);

const views = viewArguments.length > 0
  ? viewArguments.map((view) => {
      const [yaw, pitch] = view.split(',').map(Number);
      return { yaw, pitch };
    })
  : [PLAN_VIEW];

for (const { yaw, pitch } of views) {
  const projected = project(triangles, orbitBasis(yaw, pitch));
  const coverage = rasterise(projected);

  const loops = traceContours(coverage)
    .map((loop) => ({ loop, area: Math.abs(polygonArea(loop)) }))
    .filter(({ area }) => area > MIN_CONTOUR_AREA * GRID * GRID)
    .sort((a, b) => b.area - a.area)
    .map(({ loop }) => simplifyLoop(loop, SIMPLIFY_TOLERANCE * GRID));

  const name = `yaw${yaw}-pitch${pitch}`;
  writeFileSync(join(outputDirectory, `${name}-fill.svg`), toFilledSvg(loops));
  writeFileSync(join(outputDirectory, `${name}-outline.svg`), toOutlinedSvg(loops));
  writeFileSync(join(outputDirectory, `${name}-fill.png`), coveragePng(coverage, GRID));
  writeFileSync(
    join(outputDirectory, `${name}-outline.png`),
    coveragePng(rasteriseSegments(loopsToSegments(loops), GRID * STROKE_FRACTION, GRID), GRID),
  );

  console.log(
    `${name.padEnd(16)} ${loops.length} contour(s), ${loops.reduce((sum, loop) => sum + loop.length, 0)} points`,
  );
}
