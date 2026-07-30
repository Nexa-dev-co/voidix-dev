import * as THREE from 'three';
import { layeredLobeNoise } from '../markRockField';

/**
 * The geode that grows on the mark's edges once the stone is whole.
 *
 * ── Read from the reference ──────────────────────────────────────────────────────────────────────
 * The crystals in the reference are not a texture. They are faceted, elongated points that BREAK the
 * silhouette — clusters of them erupting from cracks and cavities along the letter's edges, brightest
 * where they meet the stone and deepening toward the tips. Nothing painted on a surface produces that,
 * so these are real geometry.
 *
 *        ▲ ▲                    each cluster: several points radiating in a cone
 *       ◢█◤▲◥█◣                 about the outline's outward direction, varied in
 *      ─┴─┴─┴─┴──               length, girth and tilt — a druse, not a fence
 *       the stone's edge
 *
 * ── Why they are patchy, not evenly spaced ───────────────────────────────────────────────────────
 * The reference has crystal in SOME places and bare stone in others — a cluster at the top of one arm,
 * a seam down the middle, a cavity on the right. Evenly distributing them around the outline would
 * read as a decorative trim rather than as mineral growth. So a site only grows if a noise field over
 * its position clears the coverage threshold, which puts clusters in patches and leaves clean stone
 * between them.
 *
 * ── One instanced mesh, growing along its own axis ───────────────────────────────────────────────
 * A crystal grows LENGTHWISE, so the growth attribute scales the local Y hard and the girth only a
 * little. Scaling uniformly from zero is what makes a thing look like it faded in rather than grew.
 */

/** Sides on a point. Six reads as a mineral prism; more starts looking like a cone. */
const CRYSTAL_SIDES = 6;
/** Share of a crystal's length taken by the pyramidal tip. */
const TIP_FRACTION = 0.34;
/** How much the prism narrows toward the tip's base, so a point tapers rather than being a tube. */
const SHOULDER_SCALE = 0.82;

/** Girth as a share of length, before per-crystal jitter. Slender reads as quartz; fat reads as a rock. */
const GIRTH_RATIO = 0.26;

export interface AccretionCrystalOptions {
  /** Outline sites and their outward directions, from `buildAccretionChunks`. */
  rimPoints: THREE.Vector2[];
  rimNormals: THREE.Vector2[];
  depth: number;
  targetSize: number;

  /** Spacing between candidate sites along the outline, in world units. */
  siteSpacing: number;
  /** 0 leaves the mark bare; 1 grows crystal at every site. Thresholds the patch noise. */
  coverage: number;
  /** How large the patches are. Lower means bigger, cleaner runs of crystal and of bare stone. */
  patchScale: number;

  /** Crystals per site. */
  clusterSize: number;
  /** Length of a crystal, in world units, before jitter. */
  length: number;
  lengthJitter: number;
  /** Half-angle of the cone the cluster fans through, in radians. */
  spread: number;
  /** How far crystals sink into the stone, as a share of their length — so they emerge, not perch. */
  embed: number;

  seed: number;
}

export interface AccretionCrystals {
  geometry: THREE.BufferGeometry;
  /** One matrix per crystal: where it sits, which way it points, how long and thick it is. */
  matrices: THREE.Matrix4[];
  /** Normalised distance along the outline, so growth can run as a front rather than all at once. */
  order: number[];
}

function createRandom(seed: number): () => number {
  let state = (Math.imul(Math.floor(seed) ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One crystal point, unit length along +Y, unit radius.
 *
 * Built non-indexed so `computeVertexNormals` gives every facet its own plane — a crystal that shades
 * smoothly is a lump, and the facets are the entire reason this reads as mineral.
 */
export function createCrystalGeometry(): THREE.BufferGeometry {
  const shoulderY = 1 - TIP_FRACTION;
  const positions: number[] = [];
  const uvs: number[] = [];

  const ringPoint = (side: number, radius: number, y: number): THREE.Vector3 => {
    const angle = (side / CRYSTAL_SIDES) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  };

  const tip = new THREE.Vector3(0, 1, 0);
  const base = new THREE.Vector3(0, 0, 0);

  for (let side = 0; side < CRYSTAL_SIDES; side += 1) {
    const nextSide = (side + 1) % CRYSTAL_SIDES;

    const bottomA = ringPoint(side, 1, 0);
    const bottomB = ringPoint(nextSide, 1, 0);
    const shoulderA = ringPoint(side, SHOULDER_SCALE, shoulderY);
    const shoulderB = ringPoint(nextSide, SHOULDER_SCALE, shoulderY);

    // Shaft. UV.y runs 0 at the base to the shoulder, so the material can brighten toward the root.
    positions.push(
      bottomA.x, bottomA.y, bottomA.z,
      bottomB.x, bottomB.y, bottomB.z,
      shoulderB.x, shoulderB.y, shoulderB.z,
    );
    uvs.push(0, 0, 1, 0, 1, shoulderY);
    positions.push(
      bottomA.x, bottomA.y, bottomA.z,
      shoulderB.x, shoulderB.y, shoulderB.z,
      shoulderA.x, shoulderA.y, shoulderA.z,
    );
    uvs.push(0, 0, 1, shoulderY, 0, shoulderY);

    // Tip facet.
    positions.push(
      shoulderA.x, shoulderA.y, shoulderA.z,
      shoulderB.x, shoulderB.y, shoulderB.z,
      tip.x, tip.y, tip.z,
    );
    uvs.push(0, shoulderY, 1, shoulderY, 0.5, 1);

    // Base cap, so a crystal seen from behind is not hollow.
    positions.push(
      base.x, base.y, base.z,
      bottomB.x, bottomB.y, bottomB.z,
      bottomA.x, bottomA.y, bottomA.z,
    );
    uvs.push(0.5, 0, 1, 0, 0, 0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** Where every crystal of one mark sits. */
export function placeAccretionCrystals(
  options: AccretionCrystalOptions,
): { matrices: THREE.Matrix4[]; order: number[] } {
  const matrices: THREE.Matrix4[] = [];
  const order: number[] = [];
  const siteCount = options.rimPoints.length;
  if (siteCount === 0 || options.clusterSize <= 0) return { matrices, order };

  const random = createRandom(options.seed);
  const halfDepth = options.depth / 2;

  // Sites are sampled from the dense outline rather than used wholesale, so `siteSpacing` means the same
  // thing whatever tessellation the cap mesh happened to produce.
  const spacing = Math.max(options.siteSpacing, 1e-3);
  const patchSample = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const along = new THREE.Vector3();
  const tilt = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  let travelled = Infinity;
  for (let site = 0; site < siteCount; site += 1) {
    const point = options.rimPoints[site];
    const previous = options.rimPoints[(site - 1 + siteCount) % siteCount];
    travelled += point.distanceTo(previous);
    if (travelled < spacing) continue;
    travelled = 0;

    // Patchy on purpose — see the header. The noise is over position, so the patches stay put when any
    // other knob moves.
    patchSample.set(point.x, point.y, 0);
    const patch =
      layeredLobeNoise(patchSample, options.patchScale, options.seed) * 0.5 + 0.5;
    if (patch > THREE.MathUtils.clamp(options.coverage, 0, 1)) continue;

    const normal = options.rimNormals[site];
    outward.set(normal.x, normal.y, 0);
    // Along the outline, so a cluster can fan sideways as well as outward.
    along.set(-normal.y, normal.x, 0);

    for (let member = 0; member < Math.round(options.clusterSize); member += 1) {
      const length =
        options.length * (1 - options.lengthJitter + random() * options.lengthJitter * 2);
      if (length <= 1e-4) continue;
      const girth = length * GIRTH_RATIO * (0.7 + random() * 0.6);

      // A direction inside the cone: outward, pushed sideways along the outline and through the depth.
      const spreadAlong = (random() * 2 - 1) * options.spread;
      const spreadDepth = (random() * 2 - 1) * options.spread;
      tilt
        .copy(outward)
        .addScaledVector(along, Math.tan(spreadAlong))
        .add(new THREE.Vector3(0, 0, Math.tan(spreadDepth)))
        .normalize();

      // Sunk into the stone by `embed`, so it emerges from the surface rather than perching on it.
      position
        .set(point.x, point.y, THREE.MathUtils.lerp(-halfDepth, halfDepth, random()))
        .addScaledVector(tilt, -length * options.embed);

      quaternion.setFromUnitVectors(up, tilt);
      scale.set(girth, length, girth);
      matrices.push(new THREE.Matrix4().compose(position, quaternion, scale));
      order.push(site / siteCount);
    }
  }

  return { matrices, order };
}
