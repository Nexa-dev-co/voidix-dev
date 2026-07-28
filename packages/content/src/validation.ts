// Runtime validation for every editable collection.
//
// This exists because content is about to stop being a TypeScript literal the compiler checks and
// start being rows in Postgres that an admin form wrote. Once that's true, the only thing standing
// between a typo in the panel and a scene that renders black is this file — so the schemas are
// deliberately tighter than the interfaces: a colour has to actually be a hex triplet, a PBR factor
// has to sit in [0,1], and a model path has to point somewhere plausible.
//
// Every schema is `satisfies z.ZodType<…>` against its interface in types.ts. Drop a field from one
// side and this file stops compiling, which is the whole point of keeping both.

import { z } from 'zod';

import { MAX_WORKS_PROJECTS } from './limits';
import type {
  DeckService,
  FaqEntry,
  GradedProfile,
  LegacyProfile,
  ModelRotation,
  ProjectRock,
  ShipLight,
  ShipProfile,
  WorksProject,
  ContentPayload,
} from './types';

// CSS hex only (3 or 6 digits). The scenes feed these straight into THREE.Color, which silently
// falls back to black on anything it can't parse — exactly the failure that's invisible in a form
// and obvious on the page.
const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour such as #00e5ff');

/** A PBR factor — the shaders assume these are normalised. */
const unitFactorSchema = z.number().min(0).max(1);

/**
 * Ordinals are rendered as-is ("01"), so they're a zero-padded string, not a number. Two digits is
 * the floor rather than the ceiling — the site derives these from a row's position, and a hard
 * two-digit cap would turn "someone added a hundredth project" into a validation failure.
 */
const ordinalSchema = z.string().regex(/^\d{2,}$/, 'Must be a zero-padded ordinal such as "01"');

const nonEmptyText = z.string().trim().min(1);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Services fleet
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export const gradedProfileSchema = z.object({
  kind: z.literal('graded').optional(),
  shadow: hexColorSchema,
  hull: hexColorSchema,
  highlight: hexColorSchema,
  accent: hexColorSchema,
  rim: hexColorSchema,
  metalness: unitFactorSchema,
  roughness: unitFactorSchema,
  clearcoat: unitFactorSchema,
  clearcoatRoughness: unitFactorSchema,
  iridescence: unitFactorSchema,
  // Physical range for a thin-film IOR; outside this the sheen stops reading as a material.
  iridescenceIOR: z.number().min(1).max(3),
  gradeMid: unitFactorSchema,
  emitThreshold: unitFactorSchema,
  // Not normalised — this drives bloom and is routinely pushed above 1.
  emitStrength: z.number().min(0),
  envIntensity: z.number().min(0),
}) satisfies z.ZodType<GradedProfile>;

export const legacyProfileSchema = z.object({
  kind: z.literal('legacy'),
  colorCore: hexColorSchema,
  colorEdge: hexColorSchema,
}) satisfies z.ZodType<LegacyProfile>;

// Not a discriminated union: `kind` is absent on graded profiles (that absence is what marks them as
// the default treatment), and a discriminator has to be present on every member.
export const shipProfileSchema = z.union([
  legacyProfileSchema,
  gradedProfileSchema,
]) satisfies z.ZodType<ShipProfile>;

export const shipLightSchema = z.object({
  color: hexColorSchema,
  intensity: z.number().min(0).optional(),
  fill: hexColorSchema.optional(),
}) satisfies z.ZodType<ShipLight>;

// Degrees, not radians — a full turn either way is the most anyone needs to right a mis-exported hull.
const rotationDegreesSchema = z.number().min(-360).max(360).optional();

export const modelRotationSchema = z.object({
  x: rotationDegreesSchema,
  y: rotationDegreesSchema,
  z: rotationDegreesSchema,
}) satisfies z.ZodType<ModelRotation>;

export const deckServiceSchema = z.object({
  index: ordinalSchema,
  name: nonEmptyText,
  eyebrow: nonEmptyText,
  description: nonEmptyText,
  capabilities: z.array(nonEmptyText),
  // Draco-compressed vessels only, and always served from /public/models.
  modelPath: z
    .string()
    .regex(/^\/models\/[\w.-]+\.glb$/, 'Must be a .glb under /models'),
  profile: shipProfileSchema,
  light: shipLightSchema.optional(),
  modelRotation: modelRotationSchema.optional(),
}) satisfies z.ZodType<DeckService>;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Works field
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export const projectRockSchema = z.object({
  seed: z.number().int(),
  // The rock is meant to read as the same body between projects, so the scale barely moves.
  sizeScale: z.number().min(0.5).max(1.5),
  color: hexColorSchema,
  textureRepeat: z.number().positive(),
}) satisfies z.ZodType<ProjectRock>;

export const worksProjectSchema = z.object({
  index: ordinalSchema,
  title: nonEmptyText,
  client: nonEmptyText,
  year: z.string().regex(/^\d{4}$/, 'Must be a four-digit year'),
  description: nonEmptyText,
  tags: z.array(nonEmptyText),
  rock: projectRockSchema.optional(),
}) satisfies z.ZodType<WorksProject>;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FAQ
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export const faqEntrySchema = z.object({
  index: ordinalSchema,
  question: nonEmptyText,
  answer: z.array(nonEmptyText).min(1),
}) satisfies z.ZodType<FaqEntry>;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The published payload
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export const contentPayloadSchema = z.object({
  services: z.array(deckServiceSchema).optional(),
  // Capped, because the works field's camera stops are hand-authored and a fifth project would have
  // nowhere to fly to — see MAX_WORKS_PROJECTS. Enforcing it HERE rather than only in the panel's UI
  // means a publish carrying too many projects is rejected outright, with a clear error, instead of
  // reaching the site and failing the payload validation there (which would silently revert the whole
  // site to its bundled defaults over one extra row).
  projects: z
    .array(worksProjectSchema)
    .max(
      MAX_WORKS_PROJECTS,
      `The works field has ${MAX_WORKS_PROJECTS} authored camera stops, so it can show at most ` +
        `${MAX_WORKS_PROJECTS} projects. Author another stop in worksTuning.ts before adding one.`,
    )
    .optional(),
  faqEntries: z.array(faqEntrySchema).optional(),
}) satisfies z.ZodType<ContentPayload>;

/**
 * Parse an untrusted payload (an API response, a form submission, a row out of Postgres) into
 * content the scenes can be handed. Throws on anything malformed — callers on the site should catch
 * and fall back to the bundled defaults rather than render a half-empty page.
 */
export function parseContentPayload(input: unknown): ContentPayload {
  return contentPayloadSchema.parse(input);
}
