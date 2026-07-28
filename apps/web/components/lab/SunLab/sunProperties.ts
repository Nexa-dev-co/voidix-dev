import { LAYER_LABEL, LAYER_ORDER, type LayerId, type SunState } from "./sunState";

// One flat, typed registry of every animatable property. The control panel renders sliders/colours
// from it, and the timeline keys tracks by `path` — so adding a knob here makes it BOTH controllable
// and keyframable, with no stringly-typed deep access (each entry carries its own typed get/set).

export interface NumberProperty {
  path: string;
  label: string;
  group: string;
  kind: "number";
  min: number;
  max: number;
  step: number;
  get: (state: SunState) => number;
  set: (state: SunState, value: number) => SunState;
}

export interface ColorProperty {
  path: string;
  label: string;
  group: string;
  kind: "color";
  get: (state: SunState) => string;
  set: (state: SunState, value: string) => SunState;
}

export type SunProperty = NumberProperty | ColorProperty;

// ── Small typed builders so the immutable nested set stays terse but never uses `any` ──

const number = (
  path: string,
  label: string,
  group: string,
  min: number,
  max: number,
  step: number,
  get: (state: SunState) => number,
  set: (state: SunState, value: number) => SunState,
): NumberProperty => ({ path, label, group, kind: "number", min, max, step, get, set });

const color = (
  path: string,
  label: string,
  group: string,
  get: (state: SunState) => string,
  set: (state: SunState, value: string) => SunState,
): ColorProperty => ({ path, label, group, kind: "color", get, set });

function layerProperties(id: LayerId): SunProperty[] {
  const group = `Layer · ${LAYER_LABEL[id]}`;
  const setLayer = (
    state: SunState,
    patch: Partial<SunState["layers"][LayerId]>,
  ): SunState => ({
    ...state,
    layers: { ...state.layers, [id]: { ...state.layers[id], ...patch } },
  });

  const props: SunProperty[] = [
    color(
      `layers.${id}.emissiveColor`,
      "Emissive",
      group,
      (s) => s.layers[id].emissiveColor,
      (s, v) => setLayer(s, { emissiveColor: v }),
    ),
    number(
      `layers.${id}.emissiveIntensity`,
      "Intensity",
      group,
      0,
      5,
      0.05,
      (s) => s.layers[id].emissiveIntensity,
      (s, v) => setLayer(s, { emissiveIntensity: v }),
    ),
    number(
      `layers.${id}.opacity`,
      "Opacity",
      group,
      0,
      1,
      0.01,
      (s) => s.layers[id].opacity,
      (s, v) => setLayer(s, { opacity: v }),
    ),
  ];

  // Base colour + surface response only bite on the lit magma shards.
  if (id === "shards") {
    props.push(
      color(
        `layers.${id}.baseColor`,
        "Base colour",
        group,
        (s) => s.layers[id].baseColor,
        (s, v) => setLayer(s, { baseColor: v }),
      ),
      number(
        `layers.${id}.roughness`,
        "Roughness",
        group,
        0,
        1,
        0.01,
        (s) => s.layers[id].roughness,
        (s, v) => setLayer(s, { roughness: v }),
      ),
      number(
        `layers.${id}.metalness`,
        "Metalness",
        group,
        0,
        1,
        0.01,
        (s) => s.layers[id].metalness,
        (s, v) => setLayer(s, { metalness: v }),
      ),
    );
  }
  return props;
}

function lightProperties(which: "key" | "fill" | "rim"): SunProperty[] {
  const group = "Light rig";
  const label = which[0].toUpperCase() + which.slice(1);
  const setLight = (
    state: SunState,
    patch: Partial<SunState["lights"][typeof which]>,
  ): SunState => ({
    ...state,
    lights: {
      ...state.lights,
      [which]: { ...state.lights[which], ...patch },
    },
  });
  const setAxis = (state: SunState, axis: 0 | 1 | 2, value: number): SunState => {
    const position: [number, number, number] = [
      ...state.lights[which].position,
    ];
    position[axis] = value;
    return setLight(state, { position });
  };

  return [
    color(
      `lights.${which}.color`,
      `${label} colour`,
      group,
      (s) => s.lights[which].color,
      (s, v) => setLight(s, { color: v }),
    ),
    number(
      `lights.${which}.intensity`,
      `${label} intensity`,
      group,
      0,
      6,
      0.05,
      (s) => s.lights[which].intensity,
      (s, v) => setLight(s, { intensity: v }),
    ),
    number(
      `lights.${which}.x`,
      `${label} X`,
      group,
      -8,
      8,
      0.1,
      (s) => s.lights[which].position[0],
      (s, v) => setAxis(s, 0, v),
    ),
    number(
      `lights.${which}.y`,
      `${label} Y`,
      group,
      -8,
      8,
      0.1,
      (s) => s.lights[which].position[1],
      (s, v) => setAxis(s, 1, v),
    ),
    number(
      `lights.${which}.z`,
      `${label} Z`,
      group,
      -8,
      8,
      0.1,
      (s) => s.lights[which].position[2],
      (s, v) => setAxis(s, 2, v),
    ),
  ];
}

export const SUN_PROPERTIES: SunProperty[] = [
  // ── Global ──
  number(
    "rotationSpeed",
    "Rotation speed",
    "Global",
    -1,
    1,
    0.01,
    (s) => s.rotationSpeed,
    (s, v) => ({ ...s, rotationSpeed: v }),
  ),
  number(
    "exposure",
    "Exposure",
    "Global",
    0.2,
    2.5,
    0.05,
    (s) => s.exposure,
    (s, v) => ({ ...s, exposure: v }),
  ),

  // ── Bloom ──
  number(
    "bloom.strength",
    "Bloom strength",
    "Bloom",
    0,
    3,
    0.05,
    (s) => s.bloom.strength,
    (s, v) => ({ ...s, bloom: { ...s.bloom, strength: v } }),
  ),
  number(
    "bloom.radius",
    "Bloom radius",
    "Bloom",
    0,
    1.5,
    0.01,
    (s) => s.bloom.radius,
    (s, v) => ({ ...s, bloom: { ...s.bloom, radius: v } }),
  ),
  number(
    "bloom.threshold",
    "Bloom threshold",
    "Bloom",
    0,
    1.5,
    0.01,
    (s) => s.bloom.threshold,
    (s, v) => ({ ...s, bloom: { ...s.bloom, threshold: v } }),
  ),

  // ── Light rig ──
  number(
    "lights.ambient",
    "Ambient",
    "Light rig",
    0,
    1,
    0.01,
    (s) => s.lights.ambient,
    (s, v) => ({ ...s, lights: { ...s.lights, ambient: v } }),
  ),
  ...lightProperties("key"),
  ...lightProperties("fill"),
  ...lightProperties("rim"),

  // ── Layers ──
  ...LAYER_ORDER.flatMap((id) => layerProperties(id)),

  // ── Stage 1 · rays ──
  number(
    "cylinderReveal",
    "Cylinder reveal",
    "Stage 1 · rays",
    0,
    1,
    0.01,
    (s) => s.cylinderReveal,
    (s, v) => ({ ...s, cylinderReveal: v }),
  ),

  // ── Stage 2 · vibration ──
  number(
    "vibration.amplitude",
    "Vibration amplitude",
    "Stage 2 · vibration",
    0,
    1,
    0.01,
    (s) => s.vibration.amplitude,
    (s, v) => ({ ...s, vibration: { ...s.vibration, amplitude: v } }),
  ),
  number(
    "vibration.frequency",
    "Vibration frequency",
    "Stage 2 · vibration",
    1,
    20,
    0.1,
    (s) => s.vibration.frequency,
    (s, v) => ({ ...s, vibration: { ...s.vibration, frequency: v } }),
  ),
  number(
    "pulse.amount",
    "Emissive pulse",
    "Stage 2 · vibration",
    0,
    1,
    0.01,
    (s) => s.pulse.amount,
    (s, v) => ({ ...s, pulse: { ...s.pulse, amount: v } }),
  ),
  number(
    "pulse.speed",
    "Pulse speed",
    "Stage 2 · vibration",
    0,
    8,
    0.05,
    (s) => s.pulse.speed,
    (s, v) => ({ ...s, pulse: { ...s.pulse, speed: v } }),
  ),

  // ── Stage 3 · shatter ──
  number(
    "shatter.amount",
    "Shatter amount",
    "Stage 3 · shatter",
    0,
    1,
    0.01,
    (s) => s.shatter.amount,
    (s, v) => ({ ...s, shatter: { ...s.shatter, amount: v } }),
  ),
  number(
    "shatter.distance",
    "Explode distance",
    "Stage 3 · shatter",
    0,
    5,
    0.05,
    (s) => s.shatter.distance,
    (s, v) => ({ ...s, shatter: { ...s.shatter, distance: v } }),
  ),
  number(
    "shatter.spin",
    "Tumble spin",
    "Stage 3 · shatter",
    0,
    1,
    0.01,
    (s) => s.shatter.spin,
    (s, v) => ({ ...s, shatter: { ...s.shatter, spin: v } }),
  ),
  number(
    "shatter.stagger",
    "Stagger",
    "Stage 3 · shatter",
    0,
    0.9,
    0.01,
    (s) => s.shatter.stagger,
    (s, v) => ({ ...s, shatter: { ...s.shatter, stagger: v } }),
  ),
  number(
    "shatter.drift",
    "Drift / gravity",
    "Stage 3 · shatter",
    0,
    1,
    0.01,
    (s) => s.shatter.drift,
    (s, v) => ({ ...s, shatter: { ...s.shatter, drift: v } }),
  ),

  // ── Stage 4 · black hole ──
  number(
    "blackHole.amount",
    "Collapse amount",
    "Stage 4 · black hole",
    0,
    1,
    0.01,
    (s) => s.blackHole.amount,
    (s, v) => ({ ...s, blackHole: { ...s.blackHole, amount: v } }),
  ),
  number(
    "blackHole.coreRadius",
    "Core radius",
    "Stage 4 · black hole",
    0,
    1,
    0.01,
    (s) => s.blackHole.coreRadius,
    (s, v) => ({ ...s, blackHole: { ...s.blackHole, coreRadius: v } }),
  ),
  number(
    "blackHole.inSpiral",
    "In-spiral",
    "Stage 4 · black hole",
    0,
    1,
    0.01,
    (s) => s.blackHole.inSpiral,
    (s, v) => ({ ...s, blackHole: { ...s.blackHole, inSpiral: v } }),
  ),
  number(
    "blackHole.diskSpeed",
    "Disk speed",
    "Stage 4 · black hole",
    0,
    4,
    0.05,
    (s) => s.blackHole.diskSpeed,
    (s, v) => ({ ...s, blackHole: { ...s.blackHole, diskSpeed: v } }),
  ),
  number(
    "blackHole.diskScale",
    "Disk size",
    "Stage 4 · black hole",
    0.2,
    3,
    0.05,
    (s) => s.blackHole.diskScale,
    (s, v) => ({ ...s, blackHole: { ...s.blackHole, diskScale: v } }),
  ),
  color(
    "blackHole.diskColor",
    "Disk colour",
    "Stage 4 · black hole",
    (s) => s.blackHole.diskColor,
    (s, v) => ({ ...s, blackHole: { ...s.blackHole, diskColor: v } }),
  ),
];

/** Lookup by path — the timeline resolves a track's property this way. */
export const PROPERTY_BY_PATH: Map<string, SunProperty> = new Map(
  SUN_PROPERTIES.map((property) => [property.path, property]),
);

/** Panel grouping, preserving registry order. */
export function groupedProperties(): { group: string; properties: SunProperty[] }[] {
  const groups: { group: string; properties: SunProperty[] }[] = [];
  for (const property of SUN_PROPERTIES) {
    let bucket = groups.find((entry) => entry.group === property.group);
    if (!bucket) {
      bucket = { group: property.group, properties: [] };
      groups.push(bucket);
    }
    bucket.properties.push(property);
  }
  return groups;
}
