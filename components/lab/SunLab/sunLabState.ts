// The Sun Lab's data model — pure types + defaults + merge helpers. No THREE, no React.
//
// The split that keeps this tool GENERAL (see docs/sun-lab-plan.md): the scene owns the *defaults*
// (captured from the model at load); React owns *sparse overrides* on top of them. A control always
// shows `override ?? default`; editing writes an override. Snapshots (Phase 2) are just a bag of these
// overrides, so nothing here is wired to a particular outcome — every field automatically participates
// in copy / reset / snapshot because it lives in this one schema.

export interface Vector3Values {
  x: number;
  y: number;
  z: number;
}

/** Everything editable about one material slot. Applies to a MeshStandardMaterial. */
export interface MaterialParams {
  /** Base colour, `#rrggbb`. */
  color: string;
  /** Emissive colour, `#rrggbb` — the glow tint. */
  emissive: string;
  /** How hard the emissive (and its map) glows; feeds bloom. */
  emissiveIntensity: number;
  metalness: number;
  roughness: number;
  /** 0..1; only visible when `transparent`. */
  opacity: number;
  transparent: boolean;
  wireframe: boolean;
}

/** The model's as-imported values for one object, captured once at load. Reset returns here. */
export interface ObjectDefaults {
  visible: boolean;
  /** LOCAL transform, in the object's own parent frame. Rotation in DEGREES. */
  position: Vector3Values;
  rotation: Vector3Values;
  scale: Vector3Values;
  /** One entry per material slot (cells have two: inner + magma). */
  materials: MaterialParams[];
}

/** A sparse override on top of an object's defaults — only the fields the user actually touched. */
export interface ObjectOverride {
  visible?: boolean;
  position?: Vector3Values;
  rotation?: Vector3Values;
  scale?: Vector3Values;
  /** Per-slot material overrides, keyed by slot index. */
  materials?: Record<number, MaterialParams>;
}

/** Whole-sun controls. None of these assume a "stage" — they're just the scene's global knobs. */
export interface GlobalParams {
  /** Uniform multiplier on the model root. */
  modelScale: number;
  /** Static pose of the whole model, DEGREES. */
  rotation: Vector3Values;
  /** Continuous spin about world-Y, degrees/second. 0 = still. Lives on a separate spinner parent. */
  autoRotateSpeed: number;
  /** Each flare cylinder drills about its own long axis at this many degrees/second. 0 = still. */
  flareSpinSpeed: number;
  /** Cracks breathe: how far (in cell-radius units) the shards are tugged toward centre. 0 = still. */
  fracturePulse: number;
  /** Speed of that breathing, in cycles/second. */
  fracturePulseSpeed: number;
  /** Play a one-shot fracture "form" when this stage is entered (shards animate from → target spread). */
  formOnEnter: boolean;
  /** Seconds the form takes. */
  formDuration: number;
  /** Spread the form STARTS from (target is the stage's fractureSpread). 0 = closed/assembled. */
  formFromSpread: number;
  /** A point light at the sun's centre — pours through the fracture gaps when the cells part. */
  coreLight: { color: string; intensity: number; distance: number };
  bloom: { strength: number; radius: number; threshold: number };
  key: { color: string; intensity: number };
  fill: { color: string; intensity: number };
  ambient: { color: string; intensity: number };
  /** Tone-mapping exposure. */
  exposure: number;
  /** Environment-reflection strength pushed onto every material. */
  envIntensity: number;
  background: { color: string; transparent: boolean };
  camera: { fov: number };
}

/** The full authored state — the thing snapshots capture and Copy serialises. */
export interface SunLabState {
  global: GlobalParams;
  /** Sparse per-object overrides, keyed by stable object id. */
  objects: Record<string, ObjectOverride>;
  /** Shared-material overrides, keyed by material name (the Materials group). */
  sharedMaterials: Record<string, MaterialParams>;
  /** Signed radial offset of the fracture cells, in units of the cell radius. + opens, − collapses. */
  fractureSpread: number;
}

export const DEFAULT_GLOBAL_PARAMS: GlobalParams = {
  modelScale: 1,
  rotation: { x: 0, y: 0, z: 0 },
  autoRotateSpeed: 0,
  flareSpinSpeed: 0,
  fracturePulse: 0,
  fracturePulseSpeed: 0.3,
  formOnEnter: false,
  formDuration: 1.2,
  formFromSpread: 0,
  // Off by default — Phase 1 shouldn't force a look. Warm so it reads as sunlight when turned up.
  coreLight: { color: "#ffd9a0", intensity: 0, distance: 0 },
  // Threshold high enough that only the bright magma blooms, not the whole hull.
  bloom: { strength: 0.7, radius: 0.5, threshold: 0.62 },
  key: { color: "#fff4e0", intensity: 1.2 },
  fill: { color: "#2a3550", intensity: 0.5 },
  ambient: { color: "#ffffff", intensity: 0.25 },
  exposure: 1.1,
  envIntensity: 0.6,
  background: { color: "#060606", transparent: false },
  camera: { fov: 42 },
};

export function createInitialState(): SunLabState {
  return {
    global: structuredClone(DEFAULT_GLOBAL_PARAMS),
    objects: {},
    sharedMaterials: {},
    fractureSpread: 0,
  };
}

// Fill in any fields a saved/preset state is missing (e.g. a global field added after it was saved), so
// older localStorage data and hand-written presets both stay valid as the schema grows.
export function normalizeState(loaded: SunLabState): SunLabState {
  return {
    global: { ...DEFAULT_GLOBAL_PARAMS, ...loaded.global },
    objects: loaded.objects ?? {},
    sharedMaterials: loaded.sharedMaterials ?? {},
    fractureSpread: loaded.fractureSpread ?? 0,
  };
}

/** The value a transform field should show: the override if present, else the model default. */
export function resolveVector(
  override: Vector3Values | undefined,
  fallback: Vector3Values,
): Vector3Values {
  return override ?? fallback;
}

/** The material a slot should show: the override if present, else the captured default. */
export function resolveMaterial(
  override: MaterialParams | undefined,
  fallback: MaterialParams,
): MaterialParams {
  return override ?? fallback;
}
