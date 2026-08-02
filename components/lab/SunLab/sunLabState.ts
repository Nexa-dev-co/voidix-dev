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

/** How the form-on-enter ramp is shaped: settle (out), accelerate/gravity (in), or both (in-out). */
export type FormEasing = "out" | "in" | "inout";

/** How a material composites against what's already been drawn. */
export type MaterialBlending = "normal" | "additive" | "multiply";

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
  // The three below are optional so a hand-written preset or an older saved state stays valid without
  // restating them — the promise `normalizeState` makes for `global`, kept here too. `readMaterialParams`
  // always emits them, so a resolved value is only ever missing one when it came from such a source, and
  // every consumer falls back to the model's own value.
  /**
   * Dielectric specular strength (MeshPhysicalMaterial only). 0 removes the specular term entirely, for
   * every light at every angle — the only way a black surface stays black under a bright key light.
   */
  specularIntensity?: number;
  /** "additive" makes stacked glow layers accumulate toward white instead of averaging to grey. */
  blending?: MaterialBlending;
  /** Off lets every layer of a stack show through, instead of the nearest one claiming the depth. */
  depthWrite?: boolean;
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
  /** Ramp shape: "out" opens+settles, "in" accelerates (gravity/collapse), "inout" does both. */
  formEasing: FormEasing;
  /** Model scale the form STARTS from (target is `modelScale`). <1 target = the sun shrinks as it forms. */
  formFromScale: number;
  /** The finale (explosion → black hole → particles) is active for this stage. Only Singularity sets it. */
  finaleEnabled: boolean;
  /** Final size of the black hole, relative to its fit-to-sun base. */
  blackHoleScale: number;
  /** Black hole idle spin, degrees/second. */
  blackHoleSpinSpeed: number;
  /** Black hole position offset from the sun's centre (world units). */
  blackHolePosition: Vector3Values;
  /** Black hole static rotation, DEGREES. */
  blackHoleRotation: Vector3Values;
  /** Which axis the black hole spins about: 0 = X, 1 = Y, 2 = Z. */
  blackHoleSpinAxis: number;
  /**
   * What the star DOES while it falls. Without these the collapse is a uniform scale-down — the model
   * gets smaller and nothing about it reads as matter being crushed.
   */
  finaleCollapse: {
    /**
     * How far the ten fracture shards are crushed inward, beyond the stage's own `fractureSpread`, in
     * cell-radius units. This is the difference between the star shrinking and the star imploding.
     */
    shards: number;
    /**
     * Gravitational redshift: how far the magma's glow reddens as it compresses. Light climbing out of a
     * deepening gravity well loses energy, and this is the cue that reads most as real physics. 0 = off.
     */
    redshift: number;
    /** The colour it reddens toward, `#rrggbb`. */
    redshiftColor: string;
    /**
     * Peak multiplier on the sun's spin (body + flares) as it contracts — conservation of angular
     * momentum, the figure-skater effect. 1 = no spin-up.
     */
    spinUp: number;
    /**
     * The anticipation beat, before anything actually falls: the star shudders, its spin lifts and its
     * core swells. One dial for the whole beat, in cell-radius units.
     *
     * Without it the finale opens mid-thought — nothing happens until the collapse curve bites around
     * 0.25, so the first half-second is dead air. A smooth ramp reads as "growing"; the shudder is what
     * makes it read as *struggling*, which is the difference between starting and building.
     */
    tremor: number;
  };
  /** Seconds the finale's Play button takes to run the sequence 0→1. */
  finaleDuration: number;
  /**
   * The supernova flash (see lib/burstShader.ts) — the moment that masks the handoff. Without it the sun is
   * visibly seen shrinking to nothing, which reads as two models cross-fading.
   */
  finaleFlash: {
    /** Master intensity. 0 = no flash at all. */
    strength: number;
    /**
     * Where on the sequence the flash peaks. Defaults to where the sun's collapse curve reaches zero, so
     * the star's last frame is hidden inside the glare — move one and you should move the other.
     */
    at: number;
    /**
     * How long the screen stays flooded after the peak, in sequence units. This is the plateau the black
     * hole forms inside — without it the flash reads as a camera pop rather than a detonation. At the
     * default 6s playback, 0.18 is a little over a second of held brightness.
     */
    hold: number;
    /** Colour of the burst, `#rrggbb`. */
    color: string;
  };
  /**
   * Screen-space gravitational lensing (see lib/lensingShader.ts) — the "space behaves like fluid" pass.
   * `strength` 0 turns the whole pass into a pass-through, so it costs nothing when unused.
   */
  lensing: {
    strength: number;
    /**
     * What the distortion centres on. "sun" makes the STAR read as molten liquid (its own light churning
     * through the ripple); "blackhole" is the gravitational-lens read. The radius follows whichever it
     * targets, so a collapsing sun carries its liquid down with it and needs no separate fade.
     */
    target: "sun" | "blackhole";
    /** Colour fringing: how far the R and B samples split from G. */
    aberration: number;
    /** Amplitude of the travelling ripple — the undulating-liquid read. */
    liquid: number;
    /** Brightness of the photon ring at the shadow edge. */
    ring: number;
    /** Darkening inside the shadow, so the silhouette stays hard against a bright disc. */
    shadow: number;
    /** Shadow radius as a fraction of the black hole's measured horizon. Tunes where the edge sits. */
    radiusScale: number;
  };
  /**
   * The accretion spiral (see lib/accretionShader.ts) — particles seeded from the sun's own mesh, wound into
   * arms by Keplerian shear. `strength` 0 hides it entirely.
   */
  accretion: {
    strength: number;
    /** Turns of winding — the spiral's tightness. */
    wind: number;
    /** How hard the sphere collapses into the disc plane. 1 = completely flat. */
    flatten: number;
    /** Organic displacement that breaks the arms into filaments. */
    turbulence: number;
    /** Point size. */
    size: number;
    /** Radius (in sun-radii) at which particles are swallowed. */
    innerRadius: number;
    /** Outer/cooler colour, `#rrggbb`. */
    colorCool: string;
    /** Inner/hotter colour, `#rrggbb`. */
    colorHot: string;
  };
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
  formEasing: "out",
  formFromScale: 1,
  finaleEnabled: false,
  blackHoleScale: 1,
  blackHoleSpinSpeed: 20,
  blackHolePosition: { x: 0, y: 0, z: 0 },
  blackHoleRotation: { x: 0, y: 0, z: 0 },
  blackHoleSpinAxis: 1,
  // Off by default; targets the sun, since that is what exists on a non-finale stage.
  lensing: {
    strength: 0,
    target: "sun",
    aberration: 0.18,
    liquid: 0.35,
    ring: 0,
    shadow: 0,
    radiusScale: 1,
  },
  // Off by default — only the finale has a star to detonate. Turned on by the Singularity preset.
  // `at: 0.5` is not arbitrary: FINALE_EXPLODE ends at 0.5 and the collapse curve is cubed, so the sun's
  // scale reaches exactly zero there. The flash peaks on the frame the star disappears.
  // All off by default — a non-finale stage should collapse exactly as its author posed it.
  finaleCollapse: { shards: 0, redshift: 0, redshiftColor: "#ff2600", spinUp: 1, tremor: 0 },
  finaleDuration: 6,
  finaleFlash: { strength: 0, at: 0.5, hold: 0.18, color: "#fff5e0" },
  accretion: {
    strength: 0,
    wind: 1.1,
    flatten: 0.85,
    turbulence: 0.12,
    size: 26,
    innerRadius: 0.28,
    colorCool: "#d92a05",
    colorHot: "#ffeeb8",
  },
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

// The New-black-hole tab's starting point (rebuilt 2026-07-27, when the model stopped being rebuilt at
// runtime and started loading its own real materials).
//
// Deliberately there are NO material overrides here beyond hiding the Planet: every colour, roughness and
// emissive now comes from the model itself, so this is scene grade only. That is what makes "Reset" on
// this tab mean "back to the actual model" instead of "back to somebody's guess".
export function createBlackHoleInitialState(): SunLabState {
  return {
    global: {
      ...structuredClone(DEFAULT_GLOBAL_PARAMS),
      // The lab lights the scene with a studio RoomEnvironment. A black hole in deep space has nothing to
      // reflect, so 0 keeps a room that isn't there from showing up on the rings.
      envIntensity: 0,
      exposure: 1.0,
      // The accretion layers are genuinely emissive now (light1 runs at 2.0 with its full-colour map), so
      // the threshold is high on purpose: only the brightest arcs bloom. Pushing it lower hazes the hole
      // itself, because bloom bleeds inward from the disc around it.
      bloom: { strength: 0.35, radius: 0.6, threshold: 0.75 },
      // The sun's core light sits at the origin — inside the black hole. Always 0 on this tab.
      coreLight: { color: "#ffd9a0", intensity: 0, distance: 0 },
      // The rings and Planet carry no emissive, so they are lit entirely by these. The glow layers ignore
      // them completely. Raise `key` if the disc reads too dark; it cannot brighten the horizon.
      key: { color: "#ffffff", intensity: 2.0 },
      fill: { color: "#2a3550", intensity: 0.4 },
      ambient: { color: "#ffffff", intensity: 0.6 },
      background: { color: "#000000", transparent: false },
      camera: { fov: 49 },
      blackHoleScale: 1.94,
      blackHoleSpinSpeed: 4,
      blackHoleSpinAxis: 1,
      // OFF for now — the black hole is meant to read plain here. The pass and its controls are fully
      // wired and waiting: set `strength` above 0 with target "blackhole" and the lensing comes straight
      // back. Deliberately parked, not removed.
      lensing: {
        strength: 0,
        target: "blackhole",
        aberration: 0.18,
        liquid: 0.35,
        ring: 0.5,
        shadow: 0.7,
        radiusScale: 1,
      },
    },
    // The model ships with a small off-centre Planet that has nothing to do with the black hole.
    objects: { Planet_Planet_0: { visible: false } },
    sharedMaterials: {},
    fractureSpread: 0,
  };
}

// Fill in any fields a saved/preset state is missing (e.g. a global field added after it was saved), so
// older localStorage data and hand-written presets both stay valid as the schema grows.
export function normalizeState(loaded: SunLabState): SunLabState {
  return {
    global: {
      ...DEFAULT_GLOBAL_PARAMS,
      ...loaded.global,
      // Nested groups need their own merge — a spread only replaces them wholesale, so a state saved
      // before a field was added to one would otherwise resolve it as undefined.
      lensing: { ...DEFAULT_GLOBAL_PARAMS.lensing, ...loaded.global?.lensing },
      accretion: { ...DEFAULT_GLOBAL_PARAMS.accretion, ...loaded.global?.accretion },
      finaleFlash: { ...DEFAULT_GLOBAL_PARAMS.finaleFlash, ...loaded.global?.finaleFlash },
      finaleCollapse: { ...DEFAULT_GLOBAL_PARAMS.finaleCollapse, ...loaded.global?.finaleCollapse },
    },
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

/**
 * The material a slot should show: the override layered over the captured default.
 *
 * Merged rather than swapped so a state saved before a field existed still resolves — the missing field
 * falls back to the model's own value instead of arriving `undefined`.
 */
export function resolveMaterial(
  override: MaterialParams | undefined,
  fallback: MaterialParams,
): MaterialParams {
  return override ? { ...fallback, ...override } : fallback;
}
