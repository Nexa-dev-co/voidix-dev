// The four vessels that sit on the Services deck. Each ship is dormant until the
// visitor hovers (lights ignite) or clicks (it powers up and steps forward).
//
// This is the services fleet as authored in code — short display `name` plus the richer eyebrow /
// description / capability detail surfaced when active, and each ship's full visual identity (its
// `profile`). It is the seed for the database and the fallback the site falls back to when nothing
// is published, so it stays a complete, shippable fleet rather than a stub.
//
// The shapes these entries satisfy live in ../types.

import type { DeckService } from '../types';

// Model → service assignment. Each ship is one line — swap a path to reassign a
// vessel. The carousel shows one craft at a time, so every bay gets a distinct hull.
const WEB_VESSEL        = '/models/spaceship.glb';
const MOBILE_VESSEL     = '/models/spaceship3.glb';
const ENTERPRISE_VESSEL = '/models/cargo_spaceship.glb';
const AI_VESSEL         = '/models/star_aventure_spaceship_starship_fighter.glb';

export const DEFAULT_DECK_SERVICES: DeckService[] = [
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
