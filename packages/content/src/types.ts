// The shape of everything the site treats as editable content: the services fleet, the works
// projects, and the FAQ. These interfaces were the contract before this package existed (they lived
// beside their data in components/sections/**) and they are unchanged — moving them here is what
// lets the admin panel and the site agree on one definition instead of two that drift.
//
// This file is the CONTRACT ONLY. Runtime validation of the same shapes lives in validation.ts,
// where each zod schema is type-checked against the interface it mirrors, so the two cannot
// disagree without failing the build.

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Services fleet
// ─────────────────────────────────────────────────────────────────────────────────────────────────

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

/** Base model rotation in DEGREES, applied before framing (e.g. flip a mis-oriented hull). */
export interface ModelRotation {
  x?: number;
  y?: number;
  z?: number;
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
  modelRotation?: ModelRotation;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Works field
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * How the rock looks for one project. `seed` and `sizeScale` are baked into geometry, so changing
 * them means re-carving the body (`buildMeteor`); `color` and `textureRepeat` are pushed onto the
 * material every frame, so they take effect immediately.
 *
 * These four deliberately OVERRIDE their equivalents in worksTuning — the tuner's global
 * `meteorSeed` / `meteorColor` / `meteorTextureRepeat` are the fallback for a project that omits a
 * profile, not a live knob once one is set. Everything else about the rock (emissive, roughness,
 * metalness, stretch, detail, idle spin) stays global and stays tunable.
 */
export interface ProjectRock {
  /** Which silhouette gets carved. Any integer; the same seed is always the same rock. */
  seed: number;
  /** Multiplies the global `meteorRadius`. Keep inside ±10% or the swap stops reading as the same body. */
  sizeScale: number;
  /** Tint over the basalt albedo. */
  color: string;
  /** How many times the surface texture wraps the body — the apparent grain of the rock. */
  textureRepeat: number;
}

export interface WorksProject {
  /** Two-digit ordinal shown by the nav counter, e.g. "01". */
  index: string;
  /** Codename / display title of the project. */
  title: string;
  /** Who it was built for (or the context). */
  client: string;
  /** Year shipped. */
  year: string;
  /** One paragraph surfaced in the detail panel when this project is focused. */
  description: string;
  /** Capability / tech chips under the description. */
  tags: string[];
  /** The rock the camera finds at this project's stop. Omit to keep the global tuning values. */
  rock?: ProjectRock;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FAQ
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface FaqEntry {
  /** Two-digit ordinal, shown down the left of each row. */
  index: string;
  question: string;
  /** One or more paragraphs. Long answers scroll inside the hologram rather than growing it forever. */
  answer: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The payload the site is hydrated with
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One published snapshot of every editable collection. Today this is only ever the bundled
 * defaults; once the admin panel is writing to Postgres, this is exactly what a server component
 * fetches and hands to `hydrateContent`.
 *
 * Every field is optional so a partial publish (say, FAQ copy only) leaves the other collections
 * on whatever they were.
 */
export interface ContentPayload {
  services?: DeckService[];
  projects?: WorksProject[];
  faqEntries?: FaqEntry[];
}
