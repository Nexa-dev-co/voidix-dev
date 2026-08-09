// Preview images for the shape bakes: a greyscale PNG encoder and a line rasteriser.
//
// ── Why not sharp ────────────────────────────────────────────────────────────────────────────────
// sharp is a devDependency and it is not always installed (it is a platform binary). A preview that
// nobody ships is not worth making an extraction fail on, and an 8-bit greyscale PNG is a header, one
// deflate stream and a CRC — all of which node has in the box.
//
// The point of these previews is that every bake in this directory is LOOKED at before it is
// committed. A stroke weight that welds two lines into one, or a crease threshold that turns a hull
// into a hairball, is invisible in the numbers and obvious in the picture.

import { deflateSync } from 'node:zlib';

// ── PNG ──────────────────────────────────────────────────────────────────────────────────────────

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, body) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, 'ascii');
  const trailer = Buffer.alloc(4);
  // The CRC covers the type and the body, but not the length.
  trailer.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])), 0);
  return Buffer.concat([header, body, trailer]);
}

/** An 8-bit greyscale PNG from a size × size coverage field, inked DARK on white. */
export function coveragePng(field, size) {
  // Filter byte 0 ("none") in front of every row.
  const raw = Buffer.alloc((size + 1) * size);
  for (let row = 0; row < size; row += 1) {
    const rowStart = row * (size + 1);
    raw[rowStart] = 0;
    for (let column = 0; column < size; column += 1) {
      raw[rowStart + 1 + column] = 255 - Math.round(Math.max(0, Math.min(1, field[row * size + column])) * 255);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // colour type: greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Lines ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Draw round-capped segments into a coverage field.
 *
 * `segments` is a flat [x1,y1, x2,y2, …] in pixel coordinates. Coverage is a one-pixel linear ramp
 * on the distance to the segment, which is enough antialiasing to judge a stroke weight by.
 */
export function rasteriseSegments(segments, strokeWidth, size) {
  const field = new Float32Array(size * size);
  const radius = strokeWidth / 2;
  const reach = Math.ceil(radius) + 1;

  for (let segment = 0; segment < segments.length; segment += 4) {
    const x1 = segments[segment];
    const y1 = segments[segment + 1];
    const dx = segments[segment + 2] - x1;
    const dy = segments[segment + 3] - y1;
    const lengthSquared = dx * dx + dy * dy;

    const left = Math.max(0, Math.floor(Math.min(x1, x1 + dx)) - reach);
    const right = Math.min(size - 1, Math.ceil(Math.max(x1, x1 + dx)) + reach);
    const top = Math.max(0, Math.floor(Math.min(y1, y1 + dy)) - reach);
    const bottom = Math.min(size - 1, Math.ceil(Math.max(y1, y1 + dy)) + reach);

    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        // Distance to the segment, with the projection clamped to its ends — round caps, which is
        // also what stroke-linejoin="round" gives at a corner.
        const t = lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((column + 0.5 - x1) * dx + (row + 0.5 - y1) * dy) / lengthSquared));
        const distance = Math.hypot(column + 0.5 - (x1 + t * dx), row + 0.5 - (y1 + t * dy));
        const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
        const at = row * size + column;
        if (coverage > field[at]) field[at] = coverage;
      }
    }
  }
  return field;
}

/** Draw points as square dots — for previewing a sampled cloud rather than the lines it came from. */
export function rasterisePoints(points, dotRadius, size) {
  const field = new Float32Array(size * size);
  const reach = Math.ceil(dotRadius);
  for (let point = 0; point < points.length; point += 2) {
    const centreX = points[point];
    const centreY = points[point + 1];
    for (let row = Math.max(0, Math.floor(centreY) - reach); row <= Math.min(size - 1, Math.ceil(centreY) + reach); row += 1) {
      for (let column = Math.max(0, Math.floor(centreX) - reach); column <= Math.min(size - 1, Math.ceil(centreX) + reach); column += 1) {
        const distance = Math.hypot(column + 0.5 - centreX, row + 0.5 - centreY);
        const coverage = Math.max(0, Math.min(1, dotRadius + 0.5 - distance));
        const at = row * size + column;
        if (coverage > field[at]) field[at] = coverage;
      }
    }
  }
  return field;
}
