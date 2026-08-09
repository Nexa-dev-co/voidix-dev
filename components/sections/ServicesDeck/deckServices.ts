// The four vessels that sit on the Services deck. Each ship is dormant until the
// visitor hovers (lights ignite) or clicks (it powers up and steps forward).
//
// This is the single source of truth for the services copy — short display `name`
// plus the richer eyebrow / description / capability detail surfaced when active —
// and for each ship's full visual identity (its `profile`).

import type { DisciplineId } from '@/lib/enquirySubjects';

/**
 * THE HERO — the one craft that is ever actually built.
 *
 * The deck used to fly four models, swapped through portal gates. It draws four and builds one: every
 * stop gathers its craft out of dust as a flat plan-view drawing, and only the LAST of them goes
 * further — turning out of plan view into three dimensions, wireframing, and skinning into this hull.
 * Stops 01–03 are drawings and never anything else, so they need no geometry at all.
 *
 * ⚠ The other three craft still EXIST — as point clouds in `public/deck-drawings.bin`, traced from
 * the models that used to ship. Their GLBs are gone (2.1 MB + 196 KB + 2.9 MB against a 153 KB bake
 * that carries all four drawings), which is **5.2 MB off the loader's critical path** and the largest
 * single download saving available on this site. To change a drawing, restore its model into
 * `public/models`, edit `FLEET` in `scripts/buildFleetDrawings.mjs`, and re-run `npm run
 * build:drawings`.
 *
 * ⚠ `SOURCE_WEIGHTS` in lib/assetLoadProgress.ts was re-weighed to match. The loader's counter is a
 * weighted blend of each source's bytes, so shrinking one side by 89 % invalidates it exactly as much
 * as growing it would.
 *
 * ⚠ Which drawing is the hero is decided by the BAKE (`DECK_HERO_INDEX`), and the bake's `FLEET` is
 * in DECK_SERVICES order. Reorder one and you must reorder the other.
 */
export const DECK_CRAFT = {
  path: '/models/star_aventure_spaceship_starship_fighter.glb',
  /** The hull imports facing the wrong way — flip it 180° on X to show the correct side. */
  rotation: { x: -180 } as { x?: number; y?: number; z?: number },
} as const;

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

// The original pre-overhaul hull treatment, and the one the AI craft still wears: the model's texture
// multiplied by a fresnel mix from `colorCore` (facing the camera) to `colorEdge` (grazing edges). No
// graded palette, no clearcoat/iridescence — the model keeps its native metalness/roughness.
//
// It bakes its two colours into the program rather than into uniforms, which is fine and always was:
// a hull is skinned once, at load, from the profile of the service it belongs to, and never re-graded.
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
  /**
   * Which discipline this craft sells — what the CTA's enquiry arrives already knowing.
   *
   * Separate from `name` on purpose: the name is the brand talking ("Web Experiences"), the discipline
   * is the plain thing a visitor would write in an email ("Web Development"). `worksProjects.ts` points
   * at the same vocabulary, which is what lets a project's type key and a service's button mean the
   * same thing. See lib/enquirySubjects.ts.
   */
  discipline: DisciplineId;
  /** Poetic kicker revealed above the description when the service is active. */
  eyebrow: string;
  description: string;
  /** Capability tags surfaced under the active description. */
  capabilities: string[];
  /**
   * This craft's visual identity.
   *
   * ⚠ For three of the four services it only tints the DUST their drawing is made of — they have no
   * geometry, so there is no hull for a palette to land on. Only the hero's profile is ever worn by a
   * surface, and it is applied once when the model loads. There is no `modelPath` beside it any more:
   * see DECK_CRAFT.
   */
  profile: ShipProfile;
  /** Optional per-ship key-light override (see ShipLight); omit for the default warm key. */
  light?: ShipLight;
}

export const DECK_SERVICES: DeckService[] = [
  {
    index: '01',
    name: 'Web Experiences',
    discipline: 'web',
    eyebrow: 'Interfaces with escape velocity',
    description:
      'Bespoke platforms engineered from the metal up — no templates, no compromise. Every interaction is hand-tuned until the product moves like it has its own momentum.',
    capabilities: ['Next.js', 'WebGL / GLSL', 'Realtime', 'Design Systems'],
    // Ember Noir — a full-black hull lit almost neutrally; only a faint rim catch remains as a nod to
    // the heat. Predominantly black. Matte, low-reflectance.
    //
    // The catch was a crimson (#a01824 / #4a0f13) sitting ~7° off the heat ramp's hue — close enough
    // to look intentional, far enough to read as a second red. These are the ramp's own stops at the
    // same luminance (heat-300 / heat-100), so the rim now reads as the hull glowing rather than as
    // paint on it.
    profile: {
      shadow: '#040404',
      hull: '#060606',
      highlight: '#0c0c0c',
      accent: '#a82600',
      rim: '#3d1503',
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
    discipline: 'mobile',
    eyebrow: 'Native, in every dimension',
    description:
      'Apps that feel like an extension of the device, not a website in a frame. Sixty frames a second, offline-first, and tactile in the hand.',
    capabilities: ['iOS / Android', 'Offline-first', 'Motion', 'Haptics'],
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
    // The key was #ff5e47 — a coral about 7° off the ramp. Nudged onto it; the warm/cool contrast the
    // note above describes is what carries this ship, and it is untouched by the hue shift.
    light: { color: '#ff5e2a', intensity: 1.9 },
  },
  {
    index: '03',
    name: 'Enterprise Platforms',
    discipline: 'enterprise',
    eyebrow: 'Gravity for your pipeline',
    description:
      'Operational cores that pull every signal into one orbit. We model the way your business actually works, then make the software disappear into the workflow.',
    capabilities: ['Workflow Engines', 'Integrations', 'Roles & Access', 'Reporting'],
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
    discipline: 'ai',
    eyebrow: 'Intelligence in orbit',
    description:
      'Models wired into real products, not demos. Retrieval, agents, and inference pipelines designed around your data — useful on day one, smarter every week.',
    capabilities: ['LLM Pipelines', 'RAG', 'Agents', 'Evaluation'],
    // Pre-overhaul original look (restored on request): a flat two-tone tint — purple body fading
    // to cyan at the edges. Keeps the model's native metalness/roughness; no graded palette.
    //
    // ⚠ THE ONE DELIBERATE EXCEPTION TO THE HEAT RAMP, and it was confirmed as such when the ramp was
    // introduced. This is the only saturated purple and the only saturated cyan left on the site — the
    // fleet is allowed exactly one alien, and this is it. Don't "fix" it to match the others.
    //
    // ⚠ It is also THE ONLY PROFILE THAT IS EVER WORN BY GEOMETRY. This is the one craft that
    // materialises, and it is only ever on screen at its own stop — so the hull is skinned from this
    // once, at load, and never re-graded. A brief cut of this rebuild had one hull standing in for all
    // four services and rewrote this as a graded profile purely so its colours could live in uniforms;
    // that constraint is gone, and with it the reason to express this as anything other than what it
    // is. The other three services' profiles now only tint their DUST (see applyServicePalette).
    profile: {
      kind: 'legacy',
      colorCore: '#7a4ad0',
      colorEdge: '#36e6ff',
    },
  },
];
