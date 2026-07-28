import * as THREE from 'three';

/**
 * The one meteor — a single monumental rock, carved procedurally.
 *
 * ── Why it isn't a model any more ────────────────────────────────────────────────────────────────
 * It's built exactly the way the debris around it is (a subdivided icosphere pushed around by layered
 * directional lobes), just far larger and far denser. That's the point: the thing you're orbiting
 * should read as the biggest member of the same family as the chunks drifting past it, not as an
 * imported object that happens to share a scene with them. It also means the silhouette is a number
 * you can nudge rather than an asset you have to re-export, and it costs nothing to download.
 *
 * ── And why there's no fire shader ───────────────────────────────────────────────────────────────
 * The surface texture is dark basalt shot through with bright lava veins, so it is used as BOTH the
 * albedo and the emissive map. The rock is dark, so it emits almost nothing; the veins are bright, so
 * they emit hard — and the field's bloom pass turns that into real glow. One texture, no second mesh,
 * no procedural flame. The old fire shell existed to fake exactly this.
 *
 * ── The UV problem, which is the only fiddly part ────────────────────────────────────────────────
 * `IcosahedronGeometry` ships UVs that are per-face and wildly distorted — a detailed texture on them
 * looks shattered. So the UVs are rebuilt as a spherical projection, which means dealing with the seam
 * where the angle wraps: a triangle straddling it gets coordinates like 0.98 and 0.02 and smears the
 * entire texture across itself. The geometry is non-indexed (three's polyhedra are), so every triangle
 * owns its three vertices and the fix is local and exact — push the low side over by one whole turn.
 */

// The lobes that carve the sphere into a rock. Same three-scale structure as the debris — big bulges to
// break the round outline, craters, then fine chipping — but tuned coarser, because this body is an
// order of magnitude larger and the same frequencies would read as gravel.
const LOBE_LARGE = { frequency: 1.6, amplitude: 0.3 };
const LOBE_MEDIUM = { frequency: 3.4, amplitude: 0.15 };
const LOBE_FINE = { frequency: 7.1, amplitude: 0.06 };
// Clamp so a deep crater can never punch through the surface and turn it inside out.
const MIN_RADIUS = 0.55;
// A triangle whose U coordinates span more than this must be crossing the wrap.
const SEAM_SPAN = 0.5;

export interface MeteorBodyOptions {
  radius: number;
  detail: number;
  seed: number;
  stretchX: number;
  stretchY: number;
  stretchZ: number;
}

/**
 * One directional lobe: a product of sines over the vertex's direction, so the displacement swells and
 * dips around the surface instead of jittering per-vertex (which just stays spherical).
 */
function lobeAt(
  direction: THREE.Vector3,
  frequency: number,
  phase: number,
): number {
  return (
    Math.sin(direction.x * frequency + phase) *
    Math.sin(direction.y * frequency * 1.3 - phase * 1.7) *
    Math.sin(direction.z * frequency * 0.9 + phase * 0.5)
  );
}

/** Rebuild UVs as a spherical projection, then repair the triangles that straddle the wrap. */
function applySphericalUvs(geometry: THREE.BufferGeometry): void {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const uvs = new Float32Array(position.count * 2);
  const direction = new THREE.Vector3();

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    direction.fromBufferAttribute(position, vertexIndex).normalize();
    uvs[vertexIndex * 2] = Math.atan2(direction.z, direction.x) / (Math.PI * 2) + 0.5;
    uvs[vertexIndex * 2 + 1] =
      Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) / Math.PI + 0.5;
  }

  // Every three vertices is one triangle (non-indexed). If its U range spans more than half the sphere
  // it must be wrapping rather than genuinely that wide, so lift the low side by a full turn — which
  // puts all three on the same side of the seam and stops the texture being dragged across the face.
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    const u0 = uvs[triangle * 2];
    const u1 = uvs[(triangle + 1) * 2];
    const u2 = uvs[(triangle + 2) * 2];
    const span = Math.max(u0, u1, u2) - Math.min(u0, u1, u2);
    if (span <= SEAM_SPAN) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const uvIndex = (triangle + corner) * 2;
      if (uvs[uvIndex] < SEAM_SPAN) uvs[uvIndex] += 1;
    }
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

/** Carve one rock. Deterministic for a given seed — the same seed is always the same silhouette. */
export function createMeteorGeometry({
  radius,
  detail,
  seed,
  stretchX,
  stretchY,
  stretchZ,
}: MeteorBodyOptions): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  const direction = new THREE.Vector3();

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    vertex.fromBufferAttribute(position, vertexIndex);
    direction.copy(vertex).normalize();
    const displaced =
      1 +
      LOBE_LARGE.amplitude * lobeAt(direction, LOBE_LARGE.frequency, seed) +
      LOBE_MEDIUM.amplitude * lobeAt(direction, LOBE_MEDIUM.frequency, seed * 2.1) +
      LOBE_FINE.amplitude * lobeAt(direction, LOBE_FINE.frequency, seed * 3.7);
    vertex
      .copy(direction)
      .multiplyScalar(radius * Math.max(displaced, MIN_RADIUS))
      .multiply(new THREE.Vector3(stretchX, stretchY, stretchZ));
    position.setXYZ(vertexIndex, vertex.x, vertex.y, vertex.z);
  }

  // UVs from the carved shape, so the texture follows the real surface rather than the sphere it was.
  applySphericalUvs(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The rock's surface. One texture doing two jobs — see the note at the top of this file.
 *
 * `emissiveIntensity` is the knob that replaced the fire's strength: it is what decides whether the
 * veins are cooling embers or actively molten.
 */
export function createMeteorMaterial(
  surfaceTexture: THREE.Texture,
  flatShading: boolean,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: surfaceTexture,
    // The SAME texture. Dark rock emits nothing, bright veins emit hard — which is the whole trick.
    emissiveMap: surfaceTexture,
    emissive: new THREE.Color('#ff7a2a'),
    emissiveIntensity: 1.6,
    roughness: 0.92,
    metalness: 0.05,
    flatShading,
  });
}
