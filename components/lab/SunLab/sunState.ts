// The resolved description of the fractured sun at one instant. Everything upstream — the panel
// sliders and the keyframe timeline — produces a SunState; the scene (useSunLab) only ever consumes
// one. That single contract is what lets the lab's playhead today and the hero's scroll progress later
// drive the identical tuning (see docs/fractured-sun-lab-plan.md §5).

/** The five look-layers, one per material in the GLB (verified 1:1 — see the plan's parts map). */
export type LayerId = "core" | "shards" | "shell" | "blowout" | "cylinders";

/** Draw order for the control panel: from the sun's centre outward. */
export const LAYER_ORDER: LayerId[] = [
  "core",
  "shards",
  "shell",
  "blowout",
  "cylinders",
];

export const LAYER_LABEL: Record<LayerId, string> = {
  core: "Inner core",
  shards: "Magma shards",
  shell: "Outer shell",
  blowout: "Edge glow",
  cylinders: "Rays / cylinders",
};

/** glTF material name → the layer it belongs to. The scene groups meshes by this. */
export const MATERIAL_LAYER: Record<string, LayerId> = {
  sun_inner: "core",
  magma: "shards",
  sunouter: "shell",
  blowout: "blowout",
  flare: "cylinders",
};

/**
 * Per-layer look. Colours are hex strings so they bind straight to <input type="color">.
 * `baseColor` / `roughness` / `metalness` only bite on the lit magma shards; on the emissive glow
 * layers they're inert (those render pure emissive), so they're exposed only for the shards.
 * A layer with `opacity` 0 is effectively hidden.
 */
export interface LayerLook {
  opacity: number; // 0..1
  emissiveColor: string; // the layer's glow tint — the multi-colour mixing
  emissiveIntensity: number; // brightness; >1 is HDR and blooms
  baseColor: string; // lit albedo tint (shards)
  roughness: number;
  metalness: number;
}

export interface LightLook {
  color: string;
  intensity: number;
  position: [number, number, number];
}

export interface SunState {
  /** studio = our controllable lit/emissive materials; false = the model's authored materials (compare). */
  studioMaterials: boolean;
  layers: Record<LayerId, LayerLook>;
  bloom: { strength: number; radius: number; threshold: number };
  lights: {
    key: LightLook;
    fill: LightLook;
    rim: LightLook;
    ambient: number;
  };
  exposure: number;
  rotationSpeed: number;

  vibration: { amplitude: number; frequency: number };
  pulse: { amount: number; speed: number };
  cylinderReveal: number; // 0..1 — how far the rays have appeared
  shatter: {
    amount: number;
    spin: number;
    stagger: number;
    drift: number;
    distance: number; // how far shards fly (× rest radius) at full local shatter
  };
  blackHole: {
    amount: number;
    coreRadius: number;
    diskSpeed: number;
    inSpiral: number;
    diskColor: string;
    diskScale: number;
  };
}

const layer = (
  emissiveIntensity: number,
  emissiveColor = "#ffffff",
): LayerLook => ({
  opacity: 1,
  emissiveColor,
  emissiveIntensity,
  baseColor: "#ffffff",
  roughness: 0.55,
  metalness: 0.2,
});

// A faithful-ish canvas: emissive white so the authored textures read true, modest bloom, a warm key +
// cool rim so the lit shards have form. The lab exists to reshape this, so these are a start, not a goal.
export const DEFAULT_SUN_STATE: SunState = {
  studioMaterials: true,
  layers: {
    core: layer(1.2),
    shards: layer(1.0),
    shell: layer(0.9),
    blowout: layer(1.0),
    cylinders: layer(1.0),
  },
  bloom: { strength: 0.9, radius: 0.5, threshold: 0.8 },
  lights: {
    key: { color: "#fff3e0", intensity: 2.2, position: [3, 4, 3] },
    fill: { color: "#8fd8ff", intensity: 0.7, position: [-4, -1, -2] },
    rim: { color: "#00e5ff", intensity: 1.6, position: [0, 2, -5] },
    ambient: 0.15,
  },
  exposure: 1.1,
  rotationSpeed: 0.05,

  vibration: { amplitude: 0, frequency: 6 },
  pulse: { amount: 0, speed: 1 },
  cylinderReveal: 1,
  shatter: { amount: 0, spin: 0.5, stagger: 0.4, drift: 0.2, distance: 2.2 },
  blackHole: {
    amount: 0,
    coreRadius: 0.3,
    diskSpeed: 1,
    inSpiral: 1,
    diskColor: "#7fb3ff",
    diskScale: 1,
  },
};

/**
 * A three-stop core→mid→edge gradient distributed across the radial layers — a quick way to recolour
 * the whole star at once. Writes the per-layer emissive colours (which stay the source of truth), so
 * it's an authoring shortcut, not a separate system.
 */
export function applyGradientRamp(
  layers: SunState["layers"],
  coreColor: string,
  midColor: string,
  edgeColor: string,
): SunState["layers"] {
  const mix = (a: string, b: string) => mixHex(a, b, 0.5);
  return {
    core: { ...layers.core, emissiveColor: coreColor },
    shards: { ...layers.shards, emissiveColor: mix(coreColor, midColor) },
    shell: { ...layers.shell, emissiveColor: midColor },
    blowout: { ...layers.blowout, emissiveColor: mix(midColor, edgeColor) },
    cylinders: { ...layers.cylinders, emissiveColor: edgeColor },
  };
}

/** Linear RGB-ish blend of two hex colours. Good enough for authoring; not colour-managed. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const value = hex.replace("#", "");
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const channel = (from: number, to: number) =>
    Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

/**
 * The four life stages as quick-set snapshots. Each sets the motion params + a gradient ramp tuned to
 * the stage's emotional temperature; per-layer intensity/opacity stay as the user left them. Starting
 * points to react to — and, in the timeline, they stamp as keyframes at a stage marker.
 */
export interface StagePreset {
  id: string;
  label: string;
  ramp: { core: string; mid: string; edge: string };
  patch: Pick<
    SunState,
    | "rotationSpeed"
    | "vibration"
    | "pulse"
    | "cylinderReveal"
    | "shatter"
    | "blackHole"
    | "bloom"
  >;
}

export const STAGE_PRESETS: StagePreset[] = [
  {
    id: "peaceful",
    label: "1 · Peaceful",
    ramp: { core: "#fff2d6", mid: "#00e5ff", edge: "#8febff" },
    patch: {
      rotationSpeed: 0.06,
      vibration: { amplitude: 0, frequency: 6 },
      pulse: { amount: 0.12, speed: 0.5 },
      cylinderReveal: 1,
      shatter: { amount: 0, spin: 0.5, stagger: 0.4, drift: 0.2, distance: 2.2 },
      blackHole: {
        amount: 0,
        coreRadius: 0.3,
        diskSpeed: 1,
        inSpiral: 1,
        diskColor: "#7fb3ff",
        diskScale: 1,
      },
      bloom: { strength: 0.85, radius: 0.5, threshold: 0.8 },
    },
  },
  {
    id: "vibrating",
    label: "2 · Vibrating",
    ramp: { core: "#ffffff", mid: "#ffd24a", edge: "#ff8a3d" },
    patch: {
      rotationSpeed: 0.09,
      vibration: { amplitude: 0.45, frequency: 9 },
      pulse: { amount: 0.6, speed: 3 },
      cylinderReveal: 1,
      shatter: { amount: 0, spin: 0.5, stagger: 0.4, drift: 0.2, distance: 2.2 },
      blackHole: {
        amount: 0,
        coreRadius: 0.3,
        diskSpeed: 1,
        inSpiral: 1,
        diskColor: "#7fb3ff",
        diskScale: 1,
      },
      bloom: { strength: 1.1, radius: 0.55, threshold: 0.7 },
    },
  },
  {
    id: "shattering",
    label: "3 · Shattering",
    ramp: { core: "#fff1c0", mid: "#ff6a1a", edge: "#ff2a00" },
    patch: {
      rotationSpeed: 0.12,
      vibration: { amplitude: 0.15, frequency: 7 },
      pulse: { amount: 0.3, speed: 2 },
      cylinderReveal: 1,
      shatter: { amount: 0.6, spin: 0.6, stagger: 0.4, drift: 0.3, distance: 2.4 },
      blackHole: {
        amount: 0,
        coreRadius: 0.3,
        diskSpeed: 1,
        inSpiral: 1,
        diskColor: "#ff7a3d",
        diskScale: 1,
      },
      bloom: { strength: 1.2, radius: 0.6, threshold: 0.65 },
    },
  },
  {
    id: "blackhole",
    label: "4 · Black hole",
    ramp: { core: "#08080f", mid: "#2a4a8f", edge: "#7fb3ff" },
    patch: {
      rotationSpeed: 0.18,
      vibration: { amplitude: 0, frequency: 6 },
      pulse: { amount: 0, speed: 1 },
      cylinderReveal: 0.2,
      shatter: { amount: 1, spin: 0.7, stagger: 0.3, drift: 0.2, distance: 2.6 },
      blackHole: {
        amount: 0.75,
        coreRadius: 0.34,
        diskSpeed: 1.6,
        inSpiral: 1,
        diskColor: "#7fb3ff",
        diskScale: 1.2,
      },
      bloom: { strength: 1.4, radius: 0.65, threshold: 0.55 },
    },
  },
];

/** Merge a stage preset onto a state: its motion + bloom + gradient ramp. */
export function applyStagePreset(
  current: SunState,
  preset: StagePreset,
): SunState {
  return {
    ...current,
    ...preset.patch,
    layers: applyGradientRamp(
      current.layers,
      preset.ramp.core,
      preset.ramp.mid,
      preset.ramp.edge,
    ),
  };
}
