// The four disciplines that build the Services vessel.
//
// This is the single source of truth for the services copy — short display `name` plus the richer
// eyebrow / description / capability detail surfaced when active — and for each discipline's CIRCUIT
// COLOUR: what the trim lines on its wave of parts burn, while it flies and after it has locked.
//
// ⚠ There is one ship now, not four. Until 2026-08-11 each service owned a whole vessel and a whole
// palette, and the deck swapped between them through a pair of portal gates. It now assembles a single
// machine across the four stops, a wave of parts per discipline — so what a service contributes is a
// PART, and its identity is carried by that part's accent rather than by a hull of its own. See
// docs/services-vessel-assembly-plan.md.

import type { DisciplineId } from '@/lib/enquirySubjects';

/** The one vessel. Nine named clusters — see vesselParts.ts and scripts/buildVessel.mjs. */
export const VESSEL_MODEL_PATH = '/models/vessel.glb';

/**
 * Base rotation in DEGREES, applied before framing.
 *
 * ⚠ THE NOSE. The export gives no reliable clue which end is forward — its two tall nacelles sit at
 * −z and are capped by flat plates perpendicular to travel, which read as exhaust nozzles and put the
 * nose at +z, but the widest cross-section is at +z too, which argues the other way. It is set from
 * what the ship actually looks like on the stage, not from the bounding boxes.
 *
 * It matters beyond the deck: the services→works flight steers by `HEADING_PHASE` in useServicesDeck
 * ("nose screen-left datum"), so a ship facing backwards here flies to Works tail-first.
 */
export const VESSEL_MODEL_ROTATION = { x: 0, y: 0, z: 0 };

/**
 * The shared hull — the body every wave's parts are made of, so the assembled ship reads as one
 * machine rather than as four donated fragments.
 *
 * ⚠ NOT pure black, and not the near-black of the old `01` either. The model's own reference render is
 * shot on a grey studio backdrop where a pure-black hull still shows every facet; our stage is black
 * and unlit (see deckTuning), so pure black there is a silhouette-shaped hole. `#0e1116` is far enough
 * off the void behind it that the panels read, and still unmistakably a black ship.
 *
 * There is nothing else to author here, because the texture carries no shading — see hullMaterial.ts.
 * The hull's form comes from the rim light and the fresnel; its identity comes from the trim.
 */
const VESSEL_HULL = {
  hull: '#0e1116',
  // The albedo's black is not perfectly uniform, and what little variation it has is worth keeping.
  hullLift: 0.9,
  metalness: 0.62,
  roughness: 0.48,
  clearcoat: 0.18,
  clearcoatRoughness: 0.45,
  envIntensity: 0.85,
} as const;

/**
 * A wave's skin: the shared hull above, plus the colour ITS circuitry burns.
 *
 * The texture is a trim mask, so the colour of every line on a part is entirely ours to choose. That is
 * what lets the finished ship be visibly four disciplines fused while staying one machine — you can
 * point at the wings and say which work built them, and nothing about the hull changed to say it.
 */
export interface VesselProfile {
  /** Base hull colour — shared by every wave. */
  hull: string;
  /** How much the albedo's own faint luminance lifts the hull off that base. */
  hullLift: number;
  /** This wave's circuit colour: the trim lines, in both diffuse and emissive. */
  trim: string;
  /** How hard the circuitry burns. Above ~1 it crosses the bloom threshold and blooms. */
  trimGlow: number;
  /** Fresnel edge-catch traced along the silhouette — most of what reads a black hull on black. */
  rim: string;
  /** PBR feel. */
  metalness: number;
  roughness: number;
  /** Lacquered-hull sheen (a thin reflective coat over the base material). */
  clearcoat: number;
  clearcoatRoughness: number;
  /** Exotic shifting sheen — only the AI wave uses it (0 elsewhere). */
  iridescence: number;
  iridescenceIOR: number;
  /** Environment-reflection strength. */
  envIntensity: number;
}

export interface DeckService {
  /** Two-digit ordinal shown beside the label, e.g. "01". */
  index: string;
  /** Short display name shown on the deck. */
  name: string;
  /**
   * Which discipline this wave sells — what the CTA's enquiry arrives already knowing.
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
  /** The skin this discipline's wave of parts wears. */
  profile: VesselProfile;
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
    // Wave 1 · THE FRAME — the spine and body plates.
    //
    // ⚠ `--heat-600`, which is the colour the MODEL'S OWN TEXTURE already is. Wave 1 is the frame, and
    // it should look like the ship the reference render shows, untouched. It was heat-300 (#a82600),
    // chosen when the trim was thought of as a PAINT colour on a hull; as emitted LIGHT that stop reads
    // as dried blood rather than as a live circuit.
    profile: {
      ...VESSEL_HULL,
      trim: '#ff8a1a',
      trimGlow: 1.9,
      rim: '#6b1a04',
      iridescence: 0,
      iridescenceIOR: 1.3,
    },
  },
  {
    index: '02',
    name: 'Mobile Systems',
    discipline: 'mobile',
    eyebrow: 'Native, in every dimension',
    description:
      'Apps that feel like an extension of the device, not a website in a frame. Sixty frames a second, offline-first, and tactile in the hand.',
    capabilities: ['iOS / Android', 'Offline-first', 'Motion', 'Haptics'],
    // Wave 2 · THE REACH — the outer wings. The cool counterweight, on the ramp's own cool axis
    // (`--slate-800`) rather than near it: amber only reads as heat if something in frame is cold, and
    // on one hull that contrast now lives on the same object.
    profile: {
      ...VESSEL_HULL,
      trim: '#dfe7ff',
      trimGlow: 1.9,
      rim: '#2a3550',
      iridescence: 0,
      iridescenceIOR: 1.3,
    },
  },
  {
    index: '03',
    name: 'Enterprise Platforms',
    discipline: 'enterprise',
    eyebrow: 'Gravity for your pipeline',
    description:
      'Operational cores that pull every signal into one orbit. We model the way your business actually works, then make the software disappear into the workflow.',
    capabilities: ['Workflow Engines', 'Integrations', 'Roles & Access', 'Reporting'],
    // Wave 3 · THE POWER — the nacelles. `--heat-800`, the hot end of the ramp, and the brightest of
    // the four before ignition: these are the parts that are supposed to look like they burn something.
    profile: {
      ...VESSEL_HULL,
      trim: '#ffb24d',
      trimGlow: 2.8,
      rim: '#a82600',
      iridescence: 0,
      iridescenceIOR: 1.3,
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
    // Wave 4 · THE INTELLIGENCE — the core, and the ignition.
    //
    // ⚠ THE ONE DELIBERATE EXCEPTION TO THE HEAT RAMP, and it survives the rebuild intact. This is the
    // only saturated purple and the only saturated cyan left on the site. On four separate hulls it was
    // simply the odd ship out; on one machine it is the BRAIN — the alien part, arriving last, and the
    // colour that floods the rest of the hull when the thing lights. The exception now has a reason.
    // Don't "fix" it to match the others.
    profile: {
      ...VESSEL_HULL,
      trim: '#7a4ad0',
      trimGlow: 3.0,
      rim: '#36e6ff',
      // The only wave that gets the exotic shifting sheen. It should not look like it was machined in
      // the same shop as the wings.
      iridescence: 0.6,
      iridescenceIOR: 1.8,
    },
  },
];
