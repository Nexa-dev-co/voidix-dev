import * as THREE from 'three';
import { buildCapMesh, type CapLoop } from './markCapMesh';
import { buildDiscMap } from './markDiscMap';
import {
  clingToRock,
  layeredLobeNoise,
  rockSkinPoint,
  signedDistanceToRock,
  type RockField,
} from './markRockField';

/**
 * The geode body — one mesh that is a rock at `p = 0` and the mark at `p = 1`.
 *
 * ── The topology problem, and why this is a prism ────────────────────────────────────────────────
 * A vertex morph needs the same vertex count in the same order at both ends. You cannot continuously
 * deform a sphere into a torus, so shrink-wrapping a rock onto an "O", an "A", the compass ring or the
 * shield's cutouts can only ever produce a dimple, not a hole — and a mark that doesn't read has
 * failed at the only job it has.
 *
 * So the body is a prism swept from the mark's own contours, and every hole ALREADY EXISTS at `p = 0`
 * as an ε-radius tube through the rock: real, sub-pixel, invisible. It opens as the morph runs.
 * Topology never changes, which is what makes a linear vertex morph legal.
 *
 *      p = 0                          p = 1
 *      ╭───────────╮                  ╭─╮     ╭─╮
 *     ╱             ╲                ╱   ╲   ╱   ╲
 *    │       ·  ←── the hole,       │     ╲ ╱     │
 *    │          a pinprick          │   ╭──▼──╮   │  ←── the hole, grown open
 *     ╲             ╱                ╲  │     │  ╱
 *      ╰───────────╯                  ╰─┴─────┴─╯
 *
 * ── One signed distance, four jobs ───────────────────────────────────────────────────────────────
 * The base rock is a radial height field (`markRockField.ts`), so `d` — how far a point sits from its
 * skin — is closed-form. Everything the geode needs comes out of that one number:
 *
 *   crust   a BAND around d = 0. Only the thin shell that genuinely WAS the rock's skin is crust;
 *           deep inside is freshly cut interior and far outside is new growth, and both are crystal.
 *   delay   normalised across the mark, so it grows outward from wherever the rock sits.
 *   charge  1 − crust, so the parts about to open glow through the intact crust first.
 *   cling   pulls the mark's surface back onto the skin, so the outer face bulges like the rock it
 *           came out of rather than reading as a laser-cut slab.
 *
 * See `docs/mark-core-rock-plan.md`.
 *
 * ── Geometry is per-mark, and that is deliberate ─────────────────────────────────────────────────
 * A mark change closes to the rock, swaps, and reopens — so two marks never have to share a vertex
 * layout, and the cap triangulation is free to follow each shape. The swap is invisible because the
 * rock's SHAPE is global (one seed, one carve): only its POSE is per-mark, and a pose is a transform,
 * not a rebuild.
 */

/** Caps can never take more than this share of the sphere's pole-to-pole parameter. */
const MIN_CAP_SHARE = 0.08;
const MAX_CAP_SHARE = 0.45;

/** Below this a normal is meaningless (degenerate triangles around a collapsed hole). */
const MIN_NORMAL_LENGTH = 1e-6;

export interface GeodeBodyOptions {
  shapes: THREE.Shape[];
  /** SVG outlines are Y-down; typeface outlines are already Y-up. */
  flipY: boolean;
  /** Largest dimension of the finished mark, in world units. */
  targetSize: number;
  /** Slab thickness before the rock claims any of it. */
  depth: number;

  /** Tessellation. The edge length is a fraction of the mark's largest dimension — see `markCapMesh`. */
  capEdgeFraction: number;
  capSubdivisions: number;
  depthRings: number;

  /** The base rock, posed in the mark's own normalised space. */
  rock: RockField;
  /** 0 = the mark keeps its own clean profile, 1 = its outer face IS the rock's skin. */
  cling: number;
  /** How thick the crust shell is, in world units. */
  crustThickness: number;

  /** The mark's own rocky surface. */
  markCarveAmplitude: number;
  markCarveFrequency: number;
  /**
   * 0 carves the silhouette as hard as the faces; 1 leaves the silhouette alone entirely. Displacement
   * in the mark's plane is what eats a counter or rounds off a "V", so this protects legibility.
   */
  markCarveInPlaneDamping: number;

  /**
   * How long the body holds its rock silhouette before the mark's concavities cut in, 0..1.
   *
   * 0 leaves the delay as pure distance-from-the-rock. That sounds right and is not: the rock encloses
   * the whole mark, so every vertex gets a near-identical delay, they all travel together, and a
   * letter's notch — a V's crotch, a C's mouth — starts opening on the first frame and gapes for the
   * entire morph. What you watch is a rock with a hole in it rather than a rock coming apart.
   *
   * 1 delays each vertex by how FAR it has to go instead. That is the signal that generalises across
   * every glyph: the vertices that carve a concavity are exactly the ones travelling furthest, from
   * the rock's convex skin down into the notch. Hold them and the body stays solid while the rest of
   * the shape resolves, then the cuts arrive last.
   */
  silhouetteHold: number;
  /**
   * How coarse the crystal PATCHES are — the plates that actually turn to crystal, as opposed to the
   * facets carved into them. Deliberately a lower frequency than `crystalFacetScale`, so one patch
   * covers several facets instead of speckling them one at a time.
   */
  crystalPatchScale: number;
  /** The crystal facets, on the revealed interior only. */
  crystalFacetScale: number;
  crystalFacetAmplitude: number;

  textureRepeat: number;
  /** Radius the collapsed hole tubes hold at `p = 0`, as a fraction of the rock's radius. */
  holeSeedFraction: number;
}

export interface GeodeBody {
  /**
   * `position` / `normal` are the ROCK. `aTargetPosition` / `aTargetNormal` are the mark, and
   * `aCrust` / `aGrowthDelay` drive the rest. Feed it to `markGeodeMorph`.
   */
  geometry: THREE.BufferGeometry;
  /** Mean crust across the surface. Placing the rock badly can drive this to zero — show it. */
  crustShare: number;
  vertexCount: number;
  dispose: () => void;
}

/**
 * The furthest a vertex may be delayed. The shader runs each vertex across `(uGrow - delay) / (1 -
 * delay)`, so a delay of exactly 1 is a vertex that never arrives and a mark that is never whole.
 */
const MAX_GROWTH_DELAY = 0.85;

/** Keeps the patch pattern from landing exactly on top of the facet pattern it shares a noise with. */
const CRYSTAL_PATCH_SEED_OFFSET = 37.1;

/** Piecewise-constant per cell, so the crystal reads as flat chunky plates rather than lumps. */
function cellNoise(
  point: THREE.Vector3,
  scale: number,
  seed: number,
): number {
  const cellX = Math.floor(point.x * scale);
  const cellY = Math.floor(point.y * scale);
  const cellZ = Math.floor(point.z * scale);
  const raw =
    Math.sin(cellX * 127.1 + cellY * 311.7 + cellZ * 74.7 + seed * 13.7) * 43758.5453;
  return raw - Math.floor(raw) - 0.5;
}

/** A direction on the unit sphere. `polar` 0 is the front pole, π the back. */
function sphereDirection(
  polar: number,
  azimuth: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const sinPolar = Math.sin(polar);
  return target.set(sinPolar * Math.cos(azimuth), sinPolar * Math.sin(azimuth), Math.cos(polar));
}

/** Vertex normals that survive the collapsed hole tubes, where every triangle is near-degenerate. */
function computeGuardedNormals(
  positions: Float32Array,
  indices: number[],
  fallbackCentre: THREE.Vector3,
): Float32Array {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const normals = Float32Array.from(
    (geometry.attributes.normal as THREE.BufferAttribute).array as Float32Array,
  );
  geometry.dispose();

  const radial = new THREE.Vector3();
  for (let vertex = 0; vertex < normals.length / 3; vertex += 1) {
    const offset = vertex * 3;
    const x = normals[offset];
    const y = normals[offset + 1];
    const z = normals[offset + 2];
    const length = Math.hypot(x, y, z);
    if (Number.isFinite(length) && length > MIN_NORMAL_LENGTH) continue;

    // Nothing usable — point it away from the body's centre, which is always defined.
    radial
      .set(
        positions[offset] - fallbackCentre.x,
        positions[offset + 1] - fallbackCentre.y,
        positions[offset + 2] - fallbackCentre.z,
      )
      .normalize();
    if (radial.lengthSq() < 0.5) radial.set(0, 0, 1);
    normals[offset] = radial.x;
    normals[offset + 1] = radial.y;
    normals[offset + 2] = radial.z;
  }
  return normals;
}

/** Where one vertex sits on the source rock. */
interface SurfaceCoordinate {
  azimuth: number;
  /** 0 at the front pole, 1 at the back. Used by everything that lies ON the skin. */
  surfaceParam: number;
  /**
   * Set ONLY for hole WALL vertices: how far through the tunnel, 0 at the front rim and 1 at the back.
   *
   * The tube has to be a CHORD through the rock's interior, not a path along its surface. Walking the
   * surface parameter from the front rim to the back one looks reasonable on paper and traces a line
   * over the equator — a thin tube lying exactly on the skin, z-fighting it the whole way round. So
   * these vertices ignore `surfaceParam` entirely and interpolate between the two rim POSITIONS.
   */
  holeThrough: number | null;
  /** The rim's own surface parameter, so both ends of the chord can be rebuilt. */
  holeAnchorParam: number;
}

export function buildGeodeBody(options: GeodeBodyOptions): GeodeBody {
  const capMesh = buildCapMesh(options.shapes, options.flipY, {
    edgeFraction: options.capEdgeFraction,
    subdivisions: options.capSubdivisions,
  });

  const capPointCount = capMesh.points.length;
  if (capPointCount === 0 || capMesh.triangles.length === 0) {
    return {
      geometry: new THREE.BufferGeometry(),
      crustShare: 0,
      vertexCount: 0,
      dispose: () => undefined,
    };
  }

  // ── 1 · Normalise the mark to `targetSize`, so every mark is framed identically ──
  const bounds = new THREE.Box2();
  capMesh.points.forEach((point) => bounds.expandByPoint(point));
  const size = new THREE.Vector2();
  bounds.getSize(size);
  // Only X and Y come from the source outline. `depth` is authored in WORLD units, exactly as the
  // swarm's slab depth is, so it must not be dragged through the source-to-world scale — an SVG with a
  // 95-unit viewBox and a font glyph at size 100 would otherwise end up with different thicknesses
  // from the same slider.
  const largestDimension = Math.max(size.x, size.y);
  const normaliseScale = largestDimension > 0 ? options.targetSize / largestDimension : 1;
  const rawCentre = new THREE.Vector2();
  bounds.getCenter(rawCentre);

  const markPoints = capMesh.points.map((point) =>
    point.clone().sub(rawCentre).multiplyScalar(normaliseScale),
  );
  const halfDepth = options.depth / 2;

  // ── 2 · The disc map, and how much of the sphere each part of the body gets ──
  // Every cap point's place on a unit disc, fold-free for concave marks — which the star-shaped polar
  // map this replaced was not. See `markDiscMap.ts`; that file is where the "V opens a hole in the
  // rock" failure is explained in full.
  const discMap = buildDiscMap(capMesh, { holeRadius: options.holeSeedFraction });

  const markCentroid = new THREE.Vector2();
  capMesh.outerPoints.forEach((point) => markCentroid.add(point));
  if (capMesh.outerPoints.length > 0) markCentroid.divideScalar(capMesh.outerPoints.length);
  markCentroid.sub(rawCentre).multiplyScalar(normaliseScale);

  // Mean distance from the centroid out to the outline, in world units — how much surface the caps
  // carry compared with the wall.
  const normalisedOuter = new THREE.Vector2();
  let meanBoundaryRadius = 0;
  capMesh.outerPoints.forEach((point) => {
    normalisedOuter.copy(point).sub(rawCentre).multiplyScalar(normaliseScale);
    meanBoundaryRadius += normalisedOuter.distanceTo(markCentroid);
  });
  if (capMesh.outerPoints.length > 0) meanBoundaryRadius /= capMesh.outerPoints.length;

  // How much of the sphere's pole-to-pole span each cap gets. Split in proportion to how much surface
  // each actually carries, so a deep slab gives the wall a wide band and a thin one barely any.
  const capShare = THREE.MathUtils.clamp(
    (0.5 * meanBoundaryRadius) / Math.max(meanBoundaryRadius + halfDepth, 1e-4),
    MIN_CAP_SHARE,
    MAX_CAP_SHARE,
  );

  // Disc radius → how far down the sphere, EQUAL-AREA. Lambert's r ∝ sin(θ/2) rather than a linear
  // radius, so the cap's triangles spread evenly instead of crowding at the pole. At radius 1 it
  // lands exactly on capShare·π, which is what keeps the cap's rim and the wall's top row on one ring.
  const capPolarLimit = capShare * Math.PI;
  const capSine = Math.sin(capPolarLimit / 2);
  const surfaceParamOfDiscRadius = (discRadius: number): number =>
    (2 * Math.asin(THREE.MathUtils.clamp(discRadius * capSine, -1, 1))) / Math.PI;

  // Precomputed per cap point, because the two caps and every wall column reuse it. A hole's rim needs
  // no special case any more: the disc map already sits it on an ε-circle, so it comes out as a small
  // ring on the rock for free.
  const discPolar: { azimuth: number; surfaceParam: number }[] = [];
  for (let point = 0; point < capPointCount; point += 1) {
    const discX = discMap.coordinates[point * 2];
    const discY = discMap.coordinates[point * 2 + 1];
    discPolar.push({
      azimuth: Math.atan2(discY, discX),
      surfaceParam: surfaceParamOfDiscRadius(Math.min(Math.hypot(discX, discY), 1)),
    });
  }

  // ── 3 · Lay out the vertices ──
  const frontCapOffset = 0;
  const backCapOffset = capPointCount;

  interface WallSpan {
    capLoop: CapLoop;
    offset: number;
    columns: number;
  }
  const wallSpans: WallSpan[] = [];
  let vertexCursor = capPointCount * 2;
  capMesh.loops.forEach((capLoop) => {
    if (capLoop.indices.length < 3) return;
    // One extra column duplicating the first, so the wall's UV can run 0 → 1 without a wrapping seam.
    const columns = capLoop.indices.length + 1;
    wallSpans.push({ capLoop, offset: vertexCursor, columns });
    vertexCursor += columns * (options.depthRings + 1);
  });

  const vertexCount = vertexCursor;
  const targetPositions = new Float32Array(vertexCount * 3);
  const sourcePositions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const crust = new Float32Array(vertexCount);
  const crystalPatch = new Float32Array(vertexCount);
  const growthDelay = new Float32Array(vertexCount);
  const travelDistance = new Float32Array(vertexCount);
  const preClingDistance = new Float32Array(vertexCount);
  const coordinates: SurfaceCoordinate[] = new Array(vertexCount);

  const writeVertex = (
    vertexIndex: number,
    markPoint: THREE.Vector2,
    z: number,
    coordinate: SurfaceCoordinate,
    u: number,
    v: number,
  ) => {
    const offset = vertexIndex * 3;
    targetPositions[offset] = markPoint.x;
    targetPositions[offset + 1] = markPoint.y;
    targetPositions[offset + 2] = z;
    uvs[vertexIndex * 2] = u;
    uvs[vertexIndex * 2 + 1] = v;
    coordinates[vertexIndex] = coordinate;
  };

  const uvScale = options.textureRepeat / Math.max(options.targetSize, 1e-4);

  // Caps.
  for (let point = 0; point < capPointCount; point += 1) {
    const markPoint = markPoints[point];
    const { azimuth, surfaceParam } = discPolar[point];

    const u = (markPoint.x + options.targetSize / 2) * uvScale;
    const v = (markPoint.y + options.targetSize / 2) * uvScale;

    writeVertex(
      frontCapOffset + point,
      markPoint,
      halfDepth,
      {
        azimuth,
        surfaceParam,
        // A cap vertex sits ON the skin, hole rim included; only the tube between the rims is a chord.
        holeThrough: null,
        holeAnchorParam: surfaceParam,
      },
      u,
      v,
    );
    writeVertex(
      backCapOffset + point,
      markPoint,
      -halfDepth,
      {
        azimuth,
        surfaceParam: 1 - surfaceParam,
        holeThrough: null,
        holeAnchorParam: surfaceParam,
      },
      u,
      v,
    );
  }

  // Walls.
  wallSpans.forEach(({ capLoop, offset, columns }) => {
    const loopLength = capLoop.loop.totalLength * normaliseScale;
    const uSpan = loopLength * uvScale;
    const vSpan = halfDepth * 2 * uvScale;

    for (let column = 0; column < columns; column += 1) {
      const pointIndex = capLoop.indices[column % capLoop.indices.length];
      const markPoint = markPoints[pointIndex];
      const { azimuth, surfaceParam } = discPolar[pointIndex];

      for (let ring = 0; ring <= options.depthRings; ring += 1) {
        const through = ring / options.depthRings;
        const z = halfDepth - through * halfDepth * 2;

        writeVertex(
          offset + column * (options.depthRings + 1) + ring,
          markPoint,
          z,
          {
            // The outline was pinned to the disc's rim by ARC LENGTH, so its azimuths advance
            // monotonically around the loop and the band is swept once. That is the second half of
            // the old map's failure fixed: with a centroid outside the polygon the azimuth used to
            // sweep back and forth, covering the arms twice and the notch not at all.
            azimuth,
            // An outline's wall is the band of skin between the two caps; a hole's is a chord through
            // the interior, anchored at its own rim rather than at the band.
            surfaceParam: capLoop.isHole
              ? surfaceParam
              : capShare + through * (1 - 2 * capShare),
            holeThrough: capLoop.isHole ? through : null,
            holeAnchorParam: surfaceParam,
          },
          (column / (columns - 1)) * uSpan,
          through * vSpan,
        );
      }
    }
  });

  // ── 4 · Indices ──
  const indices: number[] = [];
  for (let triangle = 0; triangle < capMesh.triangles.length; triangle += 3) {
    const a = capMesh.triangles[triangle];
    const b = capMesh.triangles[triangle + 1];
    const c = capMesh.triangles[triangle + 2];
    // Every cap triangle is forced counter-clockwise by `buildCapMesh`, so as-is it faces +Z and the
    // back is the same triangle reversed.
    indices.push(frontCapOffset + a, frontCapOffset + b, frontCapOffset + c);
    indices.push(backCapOffset + c, backCapOffset + b, backCapOffset + a);
  }

  wallSpans.forEach(({ offset, columns }) => {
    for (let column = 0; column < columns - 1; column += 1) {
      for (let ring = 0; ring < options.depthRings; ring += 1) {
        const stride = options.depthRings + 1;
        const a = offset + column * stride + ring;
        const b = offset + (column + 1) * stride + ring;
        const c = offset + (column + 1) * stride + ring + 1;
        const d = offset + column * stride + ring + 1;
        // Wound so the face points AWAY from the mark's material. Outlines run counter-clockwise and
        // holes clockwise, so one winding is correct for both.
        indices.push(a, c, b, a, d, c);
      }
    }
  });

  // ── 5 · The rock: where every vertex comes from ──
  const direction = new THREE.Vector3();
  const skin = new THREE.Vector3();
  const tangentU = new THREE.Vector3();
  const tangentV = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, 1);
  const sideways = new THREE.Vector3(1, 0, 0);

  const chordEnd = new THREE.Vector3();
  const axis = new THREE.Vector3();

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const coordinate = coordinates[vertex];

    if (coordinate.holeLoop && coordinate.holeThrough !== null) {
      // Straight through the rock, rim to rim. The interior is opaque, so the tunnel is invisible
      // until it opens — which is the entire trick that lets a holed mark morph at all.
      sphereDirection(coordinate.holeAnchorParam * Math.PI, coordinate.azimuth, direction);
      rockSkinPoint(options.rock, direction, skin);
      sphereDirection((1 - coordinate.holeAnchorParam) * Math.PI, coordinate.azimuth, direction);
      rockSkinPoint(options.rock, direction, chordEnd);
      axis.copy(chordEnd).sub(skin);
      skin.lerp(chordEnd, coordinate.holeThrough);
      if (axis.lengthSq() < 1e-12) axis.copy(forward);
      axis.normalize();
    } else {
      sphereDirection(coordinate.surfaceParam * Math.PI, coordinate.azimuth, direction);
      rockSkinPoint(options.rock, direction, skin);
      // A rim ring lies in the plane tangent to the skin, so the mouth of the tunnel sits flush.
      axis.copy(direction);
    }

    if (coordinate.holeLoop) {
      // A hole is a real tunnel at p = 0, just an ε-thin one. Ringing it about the local axis keeps it
      // a tube rather than a crease, and keeps each rim vertex at the same angle around the tunnel as
      // it sits around the open hole — so it cannot twist as it grows.
      tangentU.copy(axis).cross(forward);
      if (tangentU.lengthSq() < 1e-8) tangentU.copy(axis).cross(sideways);
      tangentU.normalize();
      tangentV.copy(axis).cross(tangentU).normalize();
      skin
        .addScaledVector(tangentU, Math.cos(coordinate.holeRingAngle) * holeSeedRadius)
        .addScaledVector(tangentV, Math.sin(coordinate.holeRingAngle) * holeSeedRadius);
    }

    const offset = vertex * 3;
    sourcePositions[offset] = skin.x;
    sourcePositions[offset + 1] = skin.y;
    sourcePositions[offset + 2] = skin.z;
  }

  // ── 6 · Cling, crust and delay ──
  const point = new THREE.Vector3();
  const clung = new THREE.Vector3();
  let minDistance = Infinity;
  let maxDistance = -Infinity;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    point.set(targetPositions[offset], targetPositions[offset + 1], targetPositions[offset + 2]);

    // Measured BEFORE the cling. With cling at 1 every outside vertex lands exactly on the skin, so a
    // post-cling range would collapse to nothing and the whole mark would open at once.
    const distance = signedDistanceToRock(options.rock, point);
    preClingDistance[vertex] = distance;
    minDistance = Math.min(minDistance, distance);
    maxDistance = Math.max(maxDistance, distance);

    clingToRock(options.rock, point, options.cling, clung);
    targetPositions[offset] = clung.x;
    targetPositions[offset + 1] = clung.y;
    targetPositions[offset + 2] = clung.z;
  }

  const distanceSpan = Math.max(maxDistance - minDistance, 1e-4);
  let crustTotal = 0;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    point.set(targetPositions[offset], targetPositions[offset + 1], targetPositions[offset + 2]);

    // Crust is a BAND around the skin, measured after the cling — deep inside is fresh cut and far
    // outside is new growth, and both of those are crystal.
    const settled = Math.abs(signedDistanceToRock(options.rock, point));
    const crustValue =
      1 - THREE.MathUtils.smoothstep(settled, 0, Math.max(options.crustThickness, 1e-4));
    crust[vertex] = crustValue;
    crustTotal += crustValue;

    growthDelay[vertex] = (preClingDistance[vertex] - minDistance) / distanceSpan;
  }

  // ── 7 · Carve the mark's surface ──
  const bodyCentre = new THREE.Vector3(0, 0, 0);
  const provisionalNormals = computeGuardedNormals(targetPositions, indices, bodyCentre);
  const normal = new THREE.Vector3();

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    point.set(targetPositions[offset], targetPositions[offset + 1], targetPositions[offset + 2]);
    normal.set(
      provisionalNormals[offset],
      provisionalNormals[offset + 1],
      provisionalNormals[offset + 2],
    );

    // Displacement across the mark's plane is what eats a counter or rounds off a "V", so it is damped
    // independently of displacement through the thickness.
    const inPlaneProtection = THREE.MathUtils.lerp(
      1,
      Math.abs(normal.z),
      THREE.MathUtils.clamp(options.markCarveInPlaneDamping, 0, 1),
    );
    const rockDisplacement =
      layeredLobeNoise(point, options.markCarveFrequency, options.rock.seed) *
      options.markCarveAmplitude *
      inPlaneProtection;

    // Which plates of the opened surface are allowed to BE crystal. Same piecewise-constant cell noise
    // as the facets, so a patch is always a whole number of plates rather than a smear across them —
    // but offset in seed and coarser in scale, so the patches are their own pattern. Stored 0..1; the
    // shader thresholds it against the wanted coverage (see uCrystalCoverage).
    crystalPatch[vertex] =
      cellNoise(point, options.crystalPatchScale, options.rock.seed + CRYSTAL_PATCH_SEED_OFFSET) + 0.5;

    // Crystal only where the rock was actually opened.
    const crystalDisplacement =
      cellNoise(point, options.crystalFacetScale, options.rock.seed) *
      options.crystalFacetAmplitude *
      (1 - crust[vertex]);

    point.addScaledVector(normal, rockDisplacement + crystalDisplacement);
    targetPositions[offset] = point.x;
    targetPositions[offset + 1] = point.y;
    targetPositions[offset + 2] = point.z;
  }

  // ── 7.5 · Hold the silhouette ──
  // Re-weight the delay by how far each vertex actually travels, now that the targets are final. It
  // has to happen here rather than in step 6: travel is not knowable until the carve has finished
  // moving the target surface.
  if (options.silhouetteHold > 0) {
    let longestTravel = 0;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = vertex * 3;
      const travel = Math.hypot(
        targetPositions[offset] - sourcePositions[offset],
        targetPositions[offset + 1] - sourcePositions[offset + 1],
        targetPositions[offset + 2] - sourcePositions[offset + 2],
      );
      travelDistance[vertex] = travel;
      if (travel > longestTravel) longestTravel = travel;
    }
    const travelScale = longestTravel > 1e-6 ? 1 / longestTravel : 0;
    const hold = THREE.MathUtils.clamp(options.silhouetteHold, 0, 1);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      growthDelay[vertex] = THREE.MathUtils.lerp(
        growthDelay[vertex],
        travelDistance[vertex] * travelScale,
        hold,
      );
    }
  }

  // Capped below 1 so every vertex still has a slice of the ramp left to arrive in — the shader
  // divides by (1 - delay), and a vertex at exactly 1 never finishes.
  //
  // OUTSIDE the block above on purpose. The raw distance delay is normalised across the mesh, so the
  // furthest vertex sits at exactly 1 BY CONSTRUCTION — which meant that with the hold at 0, one
  // vertex was left behind on the rock at p = 1 and the mark was never quite whole.
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    growthDelay[vertex] = Math.min(growthDelay[vertex], MAX_GROWTH_DELAY);
  }

  // ── 8 · Hand it over ──
  const targetNormals = computeGuardedNormals(targetPositions, indices, bodyCentre);
  const sourceNormals = computeGuardedNormals(sourcePositions, indices, options.rock.centre);

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(sourcePositions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(sourceNormals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aTargetPosition', new THREE.BufferAttribute(targetPositions, 3));
  geometry.setAttribute('aTargetNormal', new THREE.BufferAttribute(targetNormals, 3));
  geometry.setAttribute('aCrust', new THREE.BufferAttribute(crust, 1));
  geometry.setAttribute('aGrowthDelay', new THREE.BufferAttribute(growthDelay, 1));
  geometry.setAttribute('aCrystalPatch', new THREE.BufferAttribute(crystalPatch, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  return {
    geometry,
    crustShare: vertexCount > 0 ? crustTotal / vertexCount : 0,
    vertexCount,
    dispose: () => geometry.dispose(),
  };
}

/**
 * Where a point sits around a hole's centre.
 *
 * This is what keeps the collapsed tube a tube: a vertex on the hole's rim ends up at the same angle
 * around the ε-ring as it sits around the real hole, so the tunnel doesn't twist as it opens.
 */
function angleAround(point: THREE.Vector2, centre: THREE.Vector2): number {
  return Math.atan2(point.y - centre.y, point.x - centre.x);
}
