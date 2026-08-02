// The four vessels that sit on the Services deck. Each ship is dormant until the
// visitor hovers (lights ignite) or clicks (it powers up and steps forward).
//
// This is the single source of truth for the services copy — short display `name`
// plus the richer eyebrow / description / capability detail surfaced when active —
// and for each ship's full visual identity (its `profile`).

// Model → service assignment. Each ship is one line — swap a path to reassign a
// vessel. The carousel shows one craft at a time, so every bay gets a distinct hull.
const WEB_VESSEL        = '/models/spaceship.glb';
const MOBILE_VESSEL     = '/models/spaceship3.glb';
const ENTERPRISE_VESSEL = '/models/cargo_spaceship.glb';
const AI_VESSEL         = '/models/star_aventure_spaceship_starship_fighter.glb';

// Each hull is re-graded onto its own palette instead of being washed to one flat hue. The
// model's own albedo *luminance* drives a three-tone map (shadow → hull → highlight), so panels,
// recesses, and bright faces stay distinct (the ship reads as real, multi-material — never one
// solid colour). `accent` is the engine/window glow that blooms; `rim` is the silhouette edge
// catch. The four accents deliberately span blue / mint / warm-amber / magenta so no two ships
// share a colour family. See hullMaterial.ts for how these are applied.
export interface GradedProfile {
  /** Discriminates the material treatment; omitted = graded (the default). */
  kind?: 'graded';
  /** Deep tone the darkest albedo maps to (recesses, shadowed panels). */
  shadow: string;
  /** Primary mid-tone — the hull's "body" colour. */
  hull: string;
  /** Bright tone the lightest albedo maps to (top faces, worn edges). */
  highlight: string;
  /** Emissive glow colour for engines / windows / trim — this is what blooms. */
  accent: string;
  /** Fresnel edge-catch colour traced along the silhouette. */
  rim: string;
  /** PBR feel. */
  metalness: number;
  roughness: number;
  /** Lacquered-hull sheen (a thin reflective coat over the base material). */
  clearcoat: number;
  clearcoatRoughness: number;
  /** Exotic shifting sheen — only the AI ship uses it (0 elsewhere). */
  iridescence: number;
  iridescenceIOR: number;
  /** Luminance pivot between the hull mid-tone and the highlight (≈0.5). */
  gradeMid: number;
  /** Albedo luminance above which a texel is treated as a light (→ accent glow). */
  emitThreshold: number;
  /** How hard those picked-out lights glow (feeds bloom). */
  emitStrength: number;
  /** Per-ship environment-reflection strength. */
  envIntensity: number;
}

// The original pre-overhaul hull treatment, kept for ships that read best as a flat two-tone tint:
// the model's texture is multiplied by a fresnel mix from `colorCore` (facing the camera) to
// `colorEdge` (grazing edges). No graded palette, no clearcoat/iridescence — the model keeps its
// native metalness/roughness.
export interface LegacyProfile {
  kind: 'legacy';
  /** Hull colour where the surface faces the camera. */
  colorCore: string;
  /** Hull colour at grazing / edge angles. */
  colorEdge: string;
}

export type ShipProfile = GradedProfile | LegacyProfile;

// Per-ship key-light override, so the stage light matches each craft's vibe (the rim light already
// adapts via the profile's rim / colorEdge). Omit `light` to keep the rig's default warm key.
export interface ShipLight {
  /** Key-light colour (CSS hex). */
  color: string;
  /** Key-light intensity; defaults to the rig's base when omitted. */
  intensity?: number;
  /** Fill-light colour override; defaults to the rig's cool fill when omitted (use to kill any cool cast). */
  fill?: string;
}

export interface DeckService {
  /** Two-digit ordinal shown beside the label, e.g. "01". */
  index: string;
  /** Short display name shown on the deck. */
  name: string;
  /** Poetic kicker revealed above the description when the service is active. */
  eyebrow: string;
  description: string;
  /** Capability tags surfaced under the active description. */
  capabilities: string[];
  /** Path to this service's vessel — a Draco-compressed .glb under /public/models. */
  modelPath: string;
  /** The ship's full visual identity (palette + material + glow). */
  profile: ShipProfile;
  /** Optional per-ship key-light override (see ShipLight); omit for the default warm key. */
  light?: ShipLight;
  /** Optional base model rotation in DEGREES, applied before framing (e.g. flip a mis-oriented hull). */
  modelRotation?: { x?: number; y?: number; z?: number };
}

export const DECK_SERVICES: DeckService[] = [
  {
    index: '01',
    name: 'Web Experiences',
    eyebrow: 'Interfaces with escape velocity',
    description:
      'Bespoke platforms engineered from the metal up — no templates, no compromise. Every interaction is hand-tuned until the product moves like it has its own momentum.',
    capabilities: ['Next.js', 'WebGL / GLSL', 'Realtime', 'Design Systems'],
    modelPath: WEB_VESSEL,
    // Ember Noir — a full-black hull lit almost neutrally; only a faint dark-red rim catch remains as a
    // nod to the red. Predominantly black. Matte, low-reflectance.
    profile: {
      shadow: '#040404',
      hull: '#060606',
      highlight: '#0c0c0c',
      accent: '#a01824',
      rim: '#4a0f13',
      metalness: 0.25,
      roughness: 0.72,
      clearcoat: 0.04,
      clearcoatRoughness: 0.6,
      iridescence: 0,
      iridescenceIOR: 1.3,
      gradeMid: 0.5,
      emitThreshold: 0.86,
      emitStrength: 1.4,
      envIntensity: 0.4,
    },
    light: { color: '#c9c2bc', intensity: 2.0, fill: '#4a4644' },
  },
  {
    index: '02',
    name: 'Mobile Systems',
    eyebrow: 'Native, in every dimension',
    description:
      'Apps that feel like an extension of the device, not a website in a frame. Sixty frames a second, offline-first, and tactile in the hand.',
    capabilities: ['iOS / Android', 'Offline-first', 'Motion', 'Haptics'],
    modelPath: MOBILE_VESSEL,
    // Deep Navy — a dark blue hull (navy → steel-blue) raked by a reddish key light for a cinematic
    // warm/cool contrast. The ship itself stays cool/blue; the red mood comes from the light.
    profile: {
      shadow: '#050a14',
      hull: '#14233f',
      highlight: '#5276a8',
      accent: '#cfe0f5',
      rim: '#8fb0dd',
      metalness: 0.25,
      roughness: 0.72,
      clearcoat: 0.04,
      clearcoatRoughness: 0.6,
      iridescence: 0,
      iridescenceIOR: 1.3,
      gradeMid: 0.5,
      emitThreshold: 0.86,
      emitStrength: 1.5,
      envIntensity: 0.4,
    },
    light: { color: '#ff5e47', intensity: 1.9 },
  },
  {
    index: '03',
    name: 'Enterprise Platforms',
    eyebrow: 'Gravity for your pipeline',
    description:
      'Operational cores that pull every signal into one orbit. We model the way your business actually works, then make the software disappear into the workflow.',
    capabilities: ['Workflow Engines', 'Integrations', 'Roles & Access', 'Reporting'],
    modelPath: ENTERPRISE_VESSEL,
    // Gunmetal hull with a WARM amber accent — the one ship that breaks the cool palette, and
    // brushed rather than lacquered, so the fleet reads as four distinct machines.
    profile: {
      shadow: '#0e1218',
      hull: '#3a4856',
      highlight: '#aebccb',
      accent: '#ffb24d',
      rim: '#ffd9a0',
      metalness: 0.5,
      roughness: 0.68,
      clearcoat: 0.05,
      clearcoatRoughness: 0.6,
      iridescence: 0,
      iridescenceIOR: 1.3,
      gradeMid: 0.55,
      emitThreshold: 0.8,
      emitStrength: 2.6,
      envIntensity: 0.7,
    },
  },
  {
    index: '04',
    name: 'Artificial Intelligence',
    eyebrow: 'Intelligence in orbit',
    description:
      'Models wired into real products, not demos. Retrieval, agents, and inference pipelines designed around your data — useful on day one, smarter every week.',
    capabilities: ['LLM Pipelines', 'RAG', 'Agents', 'Evaluation'],
    modelPath: AI_VESSEL,
    // Pre-overhaul original look (restored on request): a flat two-tone tint — purple body fading
    // to cyan at the edges. Keeps the model's native metalness/roughness; no graded palette.
    profile: {
      kind: 'legacy',
      colorCore: '#7a4ad0',
      colorEdge: '#36e6ff',
    },
    // The hull imports facing the wrong way — flip it 180° on X to show the correct side.
    modelRotation: { x: -180 },
  },
];
