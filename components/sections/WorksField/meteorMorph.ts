import * as THREE from 'three';

/**
 * The rock changing shape — a real vertex morph, on the GPU.
 *
 * ── Why a morph is possible at all ───────────────────────────────────────────────────────────────
 * Every rock is carved by the same function from the same base solid: `IcosahedronGeometry(radius,
 * detail)` pushed around by lobes. For a given `detail` that solid always has the same vertex count in
 * the same order, and the carving only moves each vertex ALONG ITS OWN DIRECTION. So vertex *i* of one
 * rock is unambiguously the same vertex as *i* of another — the two shapes are topologically identical
 * and differ only in how far each point sits from the centre. That is exactly the condition a linear
 * vertex morph needs, and it's why this reads as one body reshaping rather than as a crossfade between
 * two objects.
 *
 * ── Why it's a shader and not a loop ─────────────────────────────────────────────────────────────
 * At `detail: 6` the body is ~246k vertices. Interpolating those on the CPU and re-running
 * `computeVertexNormals()` every frame is well over a frame's budget on its own, before the field's
 * bloom pass has drawn anything. Handing both positions to the GPU as attributes and mixing them in
 * the vertex shader costs effectively nothing per frame, and the morph runs at whatever rate the
 * timeline asks for.
 *
 * ── Why the material is still MeshStandardMaterial ───────────────────────────────────────────────
 * The rock's whole look — the basalt albedo, the lava veins burning through the emissive channel, the
 * roughness/metalness the tuner drives — is standard PBR. Replacing it with a hand-written
 * ShaderMaterial to get a morph would mean re-implementing all of that. Injecting into the existing
 * shader with `onBeforeCompile` keeps every one of those properties live and tunable. Same technique
 * the fleet's hull tint uses.
 *
 * ── The swell ────────────────────────────────────────────────────────────────────────────────────
 * A straight lerp between two rocks passes through their average, and an average of two irregular
 * bodies is always ROUNDER than either — so a plain morph visibly deflates toward a potato at the
 * halfway point and re-inflates. Pushing every vertex outward on a sine that peaks at mid-morph
 * cancels that, and reads as the rock swelling molten before it sets.
 *
 * It pushes along the vertex's RADIAL direction, never along its normal — the shader explains why at
 * length, but the short version is that face normals on non-indexed geometry tear the shell apart.
 *
 * ── UVs are deliberately not morphed ─────────────────────────────────────────────────────────────
 * `applySphericalUvs` derives each UV from the NORMALIZED vertex direction, and the carving is purely
 * radial — it changes how far a vertex sits, never which way. Two rocks that share a `detail` and a
 * stretch therefore have byte-identical UVs, so there is nothing to interpolate and the texture stays
 * pinned to the surface throughout.
 */

const TARGET_POSITION_ATTRIBUTE = 'aTargetPosition';
const TARGET_NORMAL_ATTRIBUTE = 'aTargetNormal';

export interface MeteorMorphUniforms {
  /** 0 = the current shape, 1 = the target shape. */
  uMorph: { value: number };
  /** World units every vertex bulges outward at mid-morph. See "the swell" above. */
  uSwell: { value: number };
}

/**
 * Teach a meteor material to interpolate between two shapes. Returns the uniforms to drive; the
 * material is otherwise untouched and every standard property keeps working.
 */
export function enableMeteorMorph(
  material: THREE.MeshStandardMaterial,
): MeteorMorphUniforms {
  const uniforms: MeteorMorphUniforms = {
    uMorph: { value: 0 },
    uSwell: { value: 0 },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMorph = uniforms.uMorph;
    shader.uniforms.uSwell = uniforms.uSwell;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec3 ${TARGET_POSITION_ATTRIBUTE};
         attribute vec3 ${TARGET_NORMAL_ATTRIBUTE};
         uniform float uMorph;
         uniform float uSwell;`,
      )
      // Normals first: three declares `objectNormal` here, and the lighting chunks downstream read it.
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         objectNormal = normalize( mix( objectNormal, ${TARGET_NORMAL_ATTRIBUTE}, uMorph ) );`,
      )
      // Then the position. `transformed` is what every later chunk (and the projection) works from.
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed = mix( transformed, ${TARGET_POSITION_ATTRIBUTE}, uMorph );
         // The swell is RADIAL, and it has to be.
         //
         // The obvious direction is objectNormal, and it tears the rock to pieces. The geometry is
         // non-indexed, so computeVertexNormals gives every triangle a FACE normal shared by its three
         // vertices — displace along that and each triangle slides off in its own direction, opening a
         // gap along every single edge. Mid-morph the body becomes a cloud of separated facets you can
         // see straight through.
         //
         // A vertex's direction from the centre is a property of its POSITION, not of the face it
         // belongs to. Two coincident vertices on neighbouring triangles therefore get the exact same
         // direction and move together, so the surface can never come apart. It's also the more
         // truthful motion: the rock inflates, rather than every facet fleeing its neighbours.
         //
         // Safe to normalize — the carve clamps every vertex to MIN_RADIUS, so none sits at the origin.
         transformed += normalize( transformed ) * sin( uMorph * 3.141592653589793 ) * uSwell;`,
      );
  };

  // The injection is the same for every meteor material, so the default cache key is fine — but state
  // it, because a silent program-cache collision is a miserable thing to debug later.
  material.customProgramCacheKey = () => 'meteor-morph';
  material.needsUpdate = true;
  return uniforms;
}

/**
 * Point a geometry at the shape it should morph toward.
 *
 * Returns false when the two aren't compatible (different vertex counts — which can only happen if
 * `meteorDetail` changed between the two builds). The caller is expected to fall back to a hard swap
 * rather than render a garbled body.
 */
export function attachMorphTarget(
  geometry: THREE.BufferGeometry,
  targetGeometry: THREE.BufferGeometry,
): boolean {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const targetPosition = targetGeometry.attributes.position as THREE.BufferAttribute;
  const targetNormal = targetGeometry.attributes.normal as THREE.BufferAttribute;
  if (!targetPosition || !targetNormal) return false;
  if (targetPosition.count !== position.count) return false;

  // Allocated once, then written in place for every morph after that.
  //
  // Handing `setAttribute` a NEW BufferAttribute each time would leak: three caches the GPU buffer
  // against the attribute object and only releases it when the geometry is disposed, so every project
  // change would orphan two buffers — ~5.9 MB a step at detail 6. Reusing the attribute means one
  // allocation for the life of the section and a plain re-upload per morph.
  const existingPosition = geometry.attributes[TARGET_POSITION_ATTRIBUTE] as
    | THREE.BufferAttribute
    | undefined;
  const existingNormal = geometry.attributes[TARGET_NORMAL_ATTRIBUTE] as
    | THREE.BufferAttribute
    | undefined;

  if (existingPosition && existingNormal) {
    (existingPosition.array as Float32Array).set(targetPosition.array as Float32Array);
    (existingNormal.array as Float32Array).set(targetNormal.array as Float32Array);
    existingPosition.needsUpdate = true;
    existingNormal.needsUpdate = true;
    return true;
  }

  // First morph — copied rather than referenced, because the target geometry is disposed as soon as
  // the morph is armed and a disposed geometry's buffers are not ours to keep pointing at.
  geometry.setAttribute(
    TARGET_POSITION_ATTRIBUTE,
    new THREE.BufferAttribute(Float32Array.from(targetPosition.array), 3),
  );
  geometry.setAttribute(
    TARGET_NORMAL_ATTRIBUTE,
    new THREE.BufferAttribute(Float32Array.from(targetNormal.array), 3),
  );
  return true;
}

/**
 * Make the target the new resting shape, so the next morph can start from here.
 *
 * Called when a morph finishes: the target is copied into the real position/normal attributes and the
 * uniform goes back to 0. The body never gets rebuilt — after the first build the same mesh, the same
 * buffers and the same draw call carry every shape the section ever shows.
 */
export function bakeMorphTarget(geometry: THREE.BufferGeometry): void {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const normal = geometry.attributes.normal as THREE.BufferAttribute;
  const targetPosition = geometry.attributes[TARGET_POSITION_ATTRIBUTE] as
    | THREE.BufferAttribute
    | undefined;
  const targetNormal = geometry.attributes[TARGET_NORMAL_ATTRIBUTE] as
    | THREE.BufferAttribute
    | undefined;
  if (!targetPosition || !targetNormal) return;

  (position.array as Float32Array).set(targetPosition.array as Float32Array);
  (normal.array as Float32Array).set(targetNormal.array as Float32Array);
  position.needsUpdate = true;
  normal.needsUpdate = true;
  // The bounding volumes are what culling and raycasting test against; a reshaped body with a stale
  // sphere can be culled while it's plainly on screen.
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}
