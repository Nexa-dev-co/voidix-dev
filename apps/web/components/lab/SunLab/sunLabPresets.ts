import { DEFAULT_GLOBAL_PARAMS, type SunLabState } from "./sunLabState";

// Built-in starting points you can drop into the document. These are authored numbers, not defaults —
// a preset is just a named SunLabState. Add more here and they appear as buttons in the snapshot bar.

export interface SunLabPreset {
  name: string;
  state: SunLabState;
}

// Stage 1 — Peaceful: the pose the user authored (slow whole-model spin + gentle flare spin), warm and
// bloomed on pure black.
const PEACEFUL_STATE: SunLabState = {
  global: {
    // Spread the defaults first so a field added to GlobalParams later doesn't break every preset in this
    // file — each preset then states only what it actually authors. Every value below is an explicit
    // override, so this changes nothing about how Peaceful looks.
    ...DEFAULT_GLOBAL_PARAMS,
    modelScale: 1,
    rotation: { x: 5, y: 106, z: -59 },
    autoRotateSpeed: 16,
    flareSpinSpeed: 15,
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
    coreLight: { color: "#ffd9a0", intensity: 0, distance: 0 },
    bloom: { strength: 1.26, radius: 0.92, threshold: 0.59 },
    key: { color: "#fff4e0", intensity: 2.7 },
    fill: { color: "#2a3550", intensity: 0.5 },
    ambient: { color: "#ffffff", intensity: 0.25 },
    exposure: 1.42,
    envIntensity: 1.77,
    background: { color: "#000000", transparent: false },
    camera: { fov: 45 },
  },
  objects: {
    Cylinder002_0: { rotation: { x: 0, y: 0, z: 0 } },
  },
  sharedMaterials: {},
  fractureSpread: 0,
};

// Stage 2 — Cracks: peaceful base, but the shards part a little so the magma glows through the widening
// gaps (emissive lifted + a soft inner light), and it spins a touch more restlessly. A first attempt to
// tune from — the fracture spread and magma emissive are the two knobs that decide how "cracked" it reads.
const CRACKS_STATE: SunLabState = {
  global: {
    ...PEACEFUL_STATE.global,
    autoRotateSpeed: 20,
    flareSpinSpeed: 22,
    // A gentle warm light from the core, pushing through the opening gaps.
    coreLight: { color: "#ffb060", intensity: 4, distance: 0 },
    // The cracks breathe — a slow inward (gravity) tug on the shards.
    fracturePulse: 0.12,
    fracturePulseSpeed: 0.3,
    // Form on enter — the shards start assembled and open into the cracked pose over ~1.4s.
    formOnEnter: true,
    formDuration: 1.4,
    formFromSpread: 0,
    formEasing: "out",
  },
  objects: { ...PEACEFUL_STATE.objects },
  sharedMaterials: {
    // Only the glow changes; every other magma field is its real model default (see inspection).
    magma: {
      color: "#ffffff",
      emissive: "#ffffff",
      emissiveIntensity: 2.4,
      metalness: 0,
      roughness: 1,
      opacity: 1,
      transparent: false,
      wireframe: false,
    },
  },
  // Small positive = a little crack open (× the cell radius). Negative would collapse (Stage 3).
  fractureSpread: 0.18,
};

// Stage 3 — Collapse: entering it, the sun IMPLODES — the shards rush from the cracked pose past
// assembled into a tight crushed core (ease-IN = accelerating gravity), spun up and white-hot, ready to
// hand off to a black hole later. No breathing; the drama is the one-way pull-in.
const COLLAPSE_STATE: SunLabState = {
  global: {
    ...PEACEFUL_STATE.global,
    // Shrinks to a dense core as it implodes (the form ramps scale 1 → 0.5 alongside the spread).
    modelScale: 0.5,
    autoRotateSpeed: 45,
    flareSpinSpeed: 40,
    // White-hot compression light from the core, and super-glowy bloom + exposure.
    coreLight: { color: "#ffe6c8", intensity: 18, distance: 0 },
    bloom: { strength: 2.5, radius: 1, threshold: 0.42 },
    exposure: 1.6,
    fracturePulse: 0,
    fracturePulseSpeed: 0.3,
    formOnEnter: true,
    formDuration: 2,
    formFromSpread: 0.18, // starts from the cracked pose…
    formEasing: "in", // …and accelerates inward like gravity
    formFromScale: 1, // …from full size, shrinking to modelScale as it crushes in
  },
  objects: { ...PEACEFUL_STATE.objects },
  sharedMaterials: {
    magma: {
      color: "#ffffff",
      emissive: "#ffffff",
      emissiveIntensity: 5, // super-glowy molten core
      metalness: 0,
      roughness: 1,
      opacity: 1,
      transparent: false,
      wireframe: false,
    },
  },
  fractureSpread: -0.5, // …to a crushed, imploded core
};

// Stage 4 — Singularity: opens ALREADY collapsed + super-glowing (Collapse's end look, no form), with the
// finale armed. Scrub the "sequence" slider or hit Play: the star's own matter is released into a spiral
// that winds inward, and the black hole forms at its centre.
const SINGULARITY_STATE: SunLabState = {
  ...COLLAPSE_STATE,
  global: {
    ...COLLAPSE_STATE.global,
    formOnEnter: false, // it's already collapsed at sequence 0 — the finale takes over from here
    finaleEnabled: true,
    blackHoleScale: 1,
    blackHoleSpinSpeed: 24,
    // ── Roughly half the brightness of the Collapse stage it inherits from ──
    // Collapse was authored as a white-hot end state and is fine on its own. Singularity then stacks a
    // supernova flash AND 120k additively-blended particles on top of that same grade, which clips the
    // frame to white and buries everything it is meant to be revealing. Every contributor is pulled down
    // together — grading only one just moves where the clipping happens.
    exposure: 1.05, // was 1.6
    bloom: { strength: 1.15, radius: 1, threshold: 0.42 }, // strength was 2.5
    coreLight: { color: "#ffe6c8", intensity: 8, distance: 0 }, // was 18
    // The star doesn't just shrink: its ten shards are crushed inward on the same accelerating curve,
    // its glow reddens as it compresses (light losing energy climbing out of a deepening well), and it
    // winds up as it contracts — conservation of angular momentum.
    finaleCollapse: {
      shards: 1.2,
      redshift: 0.85,
      redshiftColor: "#ff2600",
      spinUp: 5,
      // The anticipation beat — the star shudders and strains before anything actually falls.
      tremor: 0.09,
    },
    // Peaks at 0.5 — exactly where FINALE_EXPLODE's cubed collapse takes the sun's scale to zero, so the
    // star's last frame is inside the glare rather than visibly shrinking away.
    finaleFlash: { strength: 0.5, at: 0.5, hold: 0.18, color: "#fff5e0" },
    // The accretion spiral carries the collapse — this is the stage it exists for.
    accretion: {
      strength: 0.6,
      wind: 1.1,
      flatten: 0.85,
      turbulence: 0.12,
      size: 26,
      innerRadius: 0.28,
      colorCool: "#d92a05",
      colorHot: "#ffeeb8",
    },
    // The liquid belongs to the BLACK HOLE, and only while it is forming. `strength` here is the PEAK —
    // the finale scales it by an envelope that swells in during the held flash (so the hole is born as a
    // liquid distortion inside the glare) and drains to 0 as that brightness leaves. By the end it is a
    // plain black hole, which is why nothing needs to be turned off by hand.
    //
    // `shadow` is on, unlike the sun — a dark silhouette IS a black-hole feature.
    lensing: {
      strength: 0.9,
      target: "blackhole",
      aberration: 0.24,
      liquid: 0.6,
      // No photon ring on this stage — the accretion spiral is already drawing a bright edge around the
      // hole, and a second ring on top of it just reads as a hard outline.
      ring: 0,
      shadow: 0.7,
      radiusScale: 1,
    },
  },
  objects: { ...COLLAPSE_STATE.objects },
  sharedMaterials: {
    ...COLLAPSE_STATE.sharedMaterials,
    // The sun's only emissive material, and the single biggest source of blowout on this stage.
    magma: { ...COLLAPSE_STATE.sharedMaterials.magma, emissiveIntensity: 2.5 }, // was 5
  },
};

export const SUN_LAB_PRESETS: SunLabPreset[] = [
  { name: "Peaceful", state: PEACEFUL_STATE },
  { name: "Cracks", state: CRACKS_STATE },
  { name: "Collapse", state: COLLAPSE_STATE },
  { name: "Singularity", state: SINGULARITY_STATE },
];

export const PEACEFUL_PRESET = SUN_LAB_PRESETS[0];
