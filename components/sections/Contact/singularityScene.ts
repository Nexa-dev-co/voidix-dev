import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getSharedDracoLoader, getSharedKtx2Loader } from '@/lib/modelLoading';
import { SUN_BODY_FILL } from '@/components/effects/IntroSequence/gatherShader';
import { createSunParticles, type SunParticles } from '@/lib/sunParticles';
import { createSunPlasma, type SunPlasma } from '@/components/sections/Hero/sunPlasma';
import { isOmittedSunPart } from '@/components/sections/Hero/sunParts';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import {
  BURST_FRAGMENT_SHADER,
  BURST_UNIFORMS,
  BURST_VERTEX_SHADER,
  flashEnvelope,
} from '@/lib/burstShader';
import {
  ACCRETION_FRAGMENT_SHADER,
  ACCRETION_UNIFORMS,
  ACCRETION_VERTEX_SHADER,
} from '@/lib/accretionShader';

// The star that dies in the contact section.
//
// This is the SAME `fractured_sun.glb` the hero flies in and the works section collapses — but a second
// instance of it, living inside the works scene rather than in its own transparent canvas. It is here
// because the finale needs LENSING, and lensing bends whatever is already in the framebuffer: the
// starfield and the debris are in this renderer, and a pass on the hero sun's canvas would have nothing
// behind it to bend. See docs/contact-singularity-plan.md §2.
//
// ── Why two stars is not the cross-fade that failed before ─────────────────────────────────────────
// `useWorksField.ts` warns against putting the finale here, because a sun in one WebGL context becoming
// a black hole in another is a cross-context cross-fade, and one of those was built and reverted. The
// condition CLAUDE.md sets for retrying it is that the two images must be mutually exclusive BY
// CONSTRUCTION, not by timing — and they are:
//
//   the hero sun's opacity is a function of REVEAL progress, and is 0 past 0.18
//   this star's presence  is a function of RETURN progress, which cannot leave 0 until reveal is 1
//
// The two spans are sequential crossings with a whole section between them, so no arbitration decides
// which star is on screen. The reverted attempt arbitrated with a threshold on eased progress, and both
// suns ended up visible at once. Nothing here can do that.
//
// ── What this deliberately is NOT ──
// Not a second `SunModelCanvas`. It needs none of that file's machinery — no shard assembly, no intro
// flight, no cracks ramp, no orbital rings, no drag-to-look parallax (it is a real object in the scene,
// so the camera moves it for free), no resize choreography, no demand-render gate. It opens already
// collapsed and its only job is to die.

// ⚠ The SAME file the hero sun loads, and it IS fetched twice — a second 1.31 MB off the wire, spent
// mid-scroll during the chamber reveal. Sharing it via three's `Cache` was tried and reverted because
// that flag breaks the works field outright; `lib/modelLoading.ts` has the full reason and the way to
// reclaim it safely.
const MODEL_PATH = '/models/fractured_sun.glb';

/** The fracture shards are the only children whose names start with this. Everything else is corona. */
const SHARD_NAME_PREFIX = 'Sphere_0_cell';
/** The only lit material on the star, and the one carrying its glow — so the one redshift acts on. */
const REDSHIFT_MATERIAL = 'magma';

// ── The pose: the authored "Collapse", which is where the star already is when you arrive ──
// The works section carries the hero sun into this pose across the services→works handoff, so the star
// you left and the star you come back to have to match. These four mirror the COLLAPSE_* block in
// `SunModelCanvas.tsx`; they are GEOMETRY, so they must not drift. The grade below is a different
// matter — see the note on emissive.
const COLLAPSE_FRACTURE_SPREAD = -0.5;
const COLLAPSE_MODEL_SCALE = 0.5;
const COLLAPSE_ROTATE_DEGREES_PER_SECOND = 45;
const COLLAPSE_FLARE_SPIN_DEGREES_PER_SECOND = 40;
/** The model's authored resting pose. Static; the spinner turns around it. */
const MODEL_ROTATION = { x: 5, y: 106, z: -59 };

/**
 * The star's radius in works-world units, BEFORE the collapse pose halves it.
 *
 * Everything in this scene is sized against a camera sitting 6–8 units out at a 36–46° lens, so the
 * model's own scale is meaningless here and it is fitted to this instead.
 *
 * ⚠ There is a hard ceiling on this and it is the RINGS, not the star. The outermost band sits at 1.95
 * body radii — i.e. `1.95 × STAR_BODY_FRACTION × STAR_RADIUS` world units — and the frame's half-height
 * at a typical stop is ~2.55. Past ~2.9 here the outer ring starts leaving frame.
 *
 * The floor is the finale: the collapse's detail (a 0.09-cell-radius tremor, the shard crush) is a
 * couple of PIXELS on a star that only covers 8% of the viewport, which is what "it just vanishes"
 * looks like. At 2.4 the collapsed star is ~10.6% of viewport height and its implosion reads.
 */
const STAR_RADIUS = 2.4;

/** Below this the star is indistinguishable from absent, so the whole group stops drawing. */
const PRESENCE_EPSILON = 0.001;

// ── The grade ──
// ⚠ These do NOT mirror where they were authored, and cannot. That editor (and the hero sun) grade with ACESFilmic tone
// mapping and a hand-rolled additive bloom on a frame containing nothing but the star. This renderer is
// NeutralToneMapping + UnrealBloom at threshold 0.6, and its exposure and bloom are GLOBAL — they grade
// the starfield and the debris too, so the star cannot be lit by pushing them. It is lit through its own
// emissive instead, which is the only channel that touches the star alone.
//
// Authored against the works field's own numbers rather than converted from the editor's: the magma has to
// sit clearly above BLOOM_THRESHOLD (0.6) to glow at all, without dragging the whole frame up with it.
const MAGMA_EMISSIVE = 3.2;
const ENV_INTENSITY = 1.0;
/** The white-hot compression light inside the shell. Bounded so a dying star doesn't light the field. */
const CORE_LIGHT_COLOR = 0xffe6c8;
const CORE_LIGHT_INTENSITY = 14;
const CORE_LIGHT_DISTANCE = 6;

// ── The rings ──
// The star wore three orbiting bands through services and works, so the one you come back to has to
// wear them too — the ending is "you return and something is missing", and the rings going missing is
// not the absence the section is about. Same `lib/sunParticles` the hero sun uses, unchanged.
/**
 * The visible star body, as a fraction of the model's BOUNDING SPHERE radius.
 *
 * They are not the same thing and the gap is large: the sphere encloses the flares and corona planes,
 * which stick well out past anything that reads as the star's surface. The rings are authored in body
 * radii (1.0 sits exactly on the surface), so handing them the bounding radius would place the innermost
 * band nearly a whole radius clear of the star and the set would read as a halo rather than as orbits.
 *
 * Derived from the hero canvas's own framing rather than guessed: there the body fills `SUN_BODY_FILL`
 * of the frame half-extent, and that half-extent is ~1.62 bounding radii at the current headroom.
 */
const STAR_BODY_FRACTION = 0.45;
/**
 * Grain size, in pixels at one world unit of camera distance.
 *
 * Tuned against THIS scene and deliberately not carried over from the hero's 8.5 — see the ⚠ on
 * `SunParticlesOptions.pointSize`. The works camera sits ~7 units out, so this lands a grain around
 * 4px against a star body of ~80px.
 */
const RING_POINT_SIZE = 28;

// ── The glow ──
// The works field blooms globally at BLOOM_STRENGTH (0.48) — tuned for a starfield, and nowhere near
// the 2.5 the hero canvas grades the collapsed star with. The star cannot be lit by pushing exposure
// (that grades the whole space), so the field lifts its bloom while the star is present instead.
//
// This is not a compromise: at contact the frame is a star, a starfield and nothing else, so a hotter
// bloom IS the section's grade — and it is the same dial the flash will ride later.
export const CONTACT_BLOOM_STRENGTH = 1.05;

// ── The finale ──
// Every number below was authored in a sun-and-black-hole editor that has since been deleted, so this
// file is now the only copy of the look. There is nothing left to keep it in step with — and equally
// nothing left to re-author against, so treat these as expensive to have gotten right.
//
// The sequence, 0 → 1, and the order is the whole point:
//
//   0.00      0.14        0.15                    0.50                          1.00
//     │ TREMOR │            │ COLLAPSE             │ FLASH                       │
//     │ shudder, strain     │ the star falls in    │ peaks exactly where the     │
//     │ before anything     │ on an accelerating   │ star's scale reaches zero,  │
//     │ actually falls      │ curve                │ so its last frame is inside │
//     │                     │                      │ the glare                   │

/** Seconds of stillness after the return lands, before anything happens. The beat that sells it. */
const FINALE_ARM_DELAY_SECONDS = 0.2;
/**
 * Seconds the sequence takes to run 0 → 1.
 *
 * Shorter than the editor's 6, and the difference is what the two are FOR. Six seconds is a Play button's
 * duration: someone is reviewing the finale, scrubbing it, watching it deliberately. Here it is the end
 * of a page and the visitor is waiting for it, so the same choreography wants to be tighter.
 *
 * ⚠ It is also the only honest lever on how soon the collapse reads, and that is worth writing down
 * because the obvious levers do not work. The star's scale runs on `explode³`, so it is still at 88% of
 * full size when the collapse window is HALFWAY through — moving the window's start earlier barely
 * moves the moment anything becomes visible (0.15 → 0.07 buys under a fifth of a second), and dropping
 * the cube would forfeit the accelerating-gravity read that is the whole point of the curve. Compressing
 * the timeline is what actually moves it.
 */
const FINALE_SECONDS = 3.5;
/**
 * Seconds to rewind 0 ← 1 when the visitor scrolls back out of contact.
 *
 * Faster than it played, and it has to be: the return's own fade takes the star off screen by 0.42 of
 * a 5.8s glide (~2.4s), so a rewind slower than that would be cut off mid-unwind and the star would be
 * left part-dead the next time you came down. A latch was the alternative and is worse — see §7 of the
 * plan; it would leave a black hole sitting in the works section.
 */
const FINALE_REWIND_SECONDS = 1.2;

/**
 * When the star falls in. Smoothstepped, then CUBED — see the note on `collapse`.
 *
 * The START is earlier than the editor's 0.15 so the shell begins giving way almost as soon as the tremor
 * has established itself. The END is not, and must not move: `FLASH_AT` is where the cubed curve reaches
 * zero, so the two are one decision — move this and the flash fires over a star that is already gone.
 */
const FINALE_EXPLODE: readonly [number, number] = [0.07, 0.5];
/** The anticipation beat builds across this, then is swallowed by the collapse rather than fighting it. */
const TREMOR_IN = 0.07;
/** Radians per unit of sequence — about three shudders across the beat. */
const TREMOR_FREQUENCY = 140;
/** Per-shard phase, so they shudder out of step. In lockstep it reads as one mechanical pulse. */
const TREMOR_PHASE_STEP = 0.9;
/** What the beat adds beyond the shudder itself, at full amplitude. */
const TREMOR_SPIN_LIFT = 0.8;
const TREMOR_GLOW_SWELL = 0.5;
/** Shudder amplitude in cell-radius units. */
const FINALE_TREMOR = 0.09;
/** How far the ten shards are crushed inward BEYOND the collapse pose, in cell-radius units. */
const FINALE_SHARD_CRUSH = 1.2;
/** Gravitational redshift: light loses energy climbing out of a deepening well. */
const FINALE_REDSHIFT = 0.85;
const FINALE_REDSHIFT_COLOR = 0xff2600;
/** Conservation of angular momentum — the figure-skater effect. Peak multiplier on the spin. */
const FINALE_SPIN_UP = 5;

// ── The flash ──
/**
 * Master brightness.
 *
 * Higher than the editor's 0.5, and its own reasoning is why. It pulled this down because Singularity
 * stacks a flash on top of a hot grade AND 120k additively-blended particles, which clipped the frame to
 * white. None of that is on screen here at sequence 0.5: the star has just reached zero scale and there
 * is nothing else left to blow out — which is exactly the condition `lib/burstShader.ts` says the burst
 * exists for ("cranking exposure on a dark frame just gives you a slightly less dark frame"). The flash
 * has to bring all of its own light.
 */
const FLASH_STRENGTH = 1.2;
/**
 * Where on the sequence the flash peaks.
 *
 * Not arbitrary, and moving it means moving `FINALE_EXPLODE[1]` with it: the collapse curve is cubed,
 * so the star's scale reaches exactly zero at 0.5. The flash peaks on the frame the star disappears,
 * which is what stops you watching it shrink away to nothing.
 */
const FLASH_AT = 0.5;
/** How long the screen stays flooded after the peak. The plateau the black hole will form inside. */
const FLASH_HOLD = 0.18;
const FLASH_COLOR = 0xfff5e0;
/** Attack is short — a detonation arrives fast. */
const FLASH_ATTACK = 0.05;
/** The burst core clears quickly so it isn't standing in front of what it just revealed. */
const FLASH_CORE_HOLD_FRACTION = 0.25;
const FLASH_CORE_DECAY = 0.16;
/** The screen grade lags the core slightly — the eye is overwhelmed a beat AFTER the light arrives. */
const FLASH_SCREEN_LAG = 0.015;
const FLASH_SCREEN_ATTACK = 0.07;
const FLASH_SCREEN_DECAY = 0.24;
/**
 * The burst's size unit, in WORLD units — deliberately not the star's radius.
 *
 * ⚠ This is the one number that did not survive the trip from where it was authored, and it is worth knowing why
 * before "restoring" it. There the burst is sized in sun-radii, which works because that view frames the
 * sun to fill its viewport — sun-radii and screen-fractions are nearly the same thing. Here the star is
 * a small object in a wide space, so the same sizing put the flash's readable core at **3% of viewport
 * height**: a ~30px blob nobody could see. Sized against the frame instead (~2.55 units of half-height
 * at a contact pose), it covers the screen the way a detonation should.
 */
const FLASH_BASE_WORLD_UNITS = 2.6;
/**
 * How far the burst expands, in units of the above.
 *
 * ⚠ `FROM` is the one that matters and it is counter-intuitive. Expansion is monotonic across the whole
 * pulse while brightness rises and falls, so the quad is only ~10% of the way through its travel at the
 * moment it is BRIGHTEST — by the time it reaches `TO` the core has decayed to nothing. So `FROM` is
 * effectively the size of the flash you actually see, and `TO` only shapes the dying edge travelling
 * outward. The lab's 0.5 is far too small to read at this framing.
 */
const FLASH_SCALE_FROM = 2.2;
const FLASH_SCALE_TO = 5;
/** What the screen-wide stage ADDS at full intensity, on top of the field's own grade. */
const FLASH_EXPOSURE_BOOST = 0.45;
const FLASH_BLOOM_BOOST = 0.4;
/** A sudden bright flash is a photosensitivity trigger, so it is damped hard rather than merely eased. */
const REDUCED_MOTION_FLASH_SCALE = 0.22;

// ── The black hole ──
// `black_hole.glb` is *"Black Hole"* by NestaEric, CC-BY-4.0. ⚠ THE CREDIT IS LEGALLY REQUIRED WHEREVER
// THIS SHIPS and is still nowhere on the site — the contact footer is where it goes. See step 8.
// Exported for the same reason as TABLE_MODEL in chamberScene: nothing else should hold a second
// copy of the path. It is a GATED source now — `useWorksField` builds this star during the loader
// rather than during the works-to-chamber reveal. See lib/assetLoadProgress.ts.
export const BLACKHOLE_MODEL_PATH = '/models/black_hole.glb';
/** The horizon opens from the middle, and only once the star is essentially gone. */
const FINALE_HORIZON: readonly [number, number] = [0.4, 0.62];
// The disc assembles only AFTER the hole is finished. There is a deliberate beat of just-a-black-hole
// between the horizon completing (0.62) and the first ring appearing, so the disc reads as something
// that gathered AROUND the hole rather than arriving with it.
const FINALE_RING_FORM_EARLY: readonly [number, number] = [0.68, 0.88];
const FINALE_RING_FORM_LATE: readonly [number, number] = [0.78, 1];
/**
 * How big the hole's full ring span reads, in star-radii.
 *
 * ⚠ The lab uses 1.3 and it does not transfer, for the same reason the burst's sizing did not: framing.
 * The lab fits its camera so the frame's half-height is ~1.46 sun-radii, leaving room for a 1.3 span.
 * Here the star is fitted to STAR_RADIUS against a frame half-height of ~2.55 world units, so the frame
 * is only ~1.06 star-radii — and a 1.3 span would put the outer ring well off screen.
 */
const BLACKHOLE_TARGET_FACTOR = 0.95;
const BLACKHOLE_SPIN_DEGREES_PER_SECOND = 24;
/** The dark parts. Their specular has to be killed by hand — see the note where it is applied. */
const BLACK_HOLE_HORIZON_MATERIALS = ['black_hole_blackoutside', 'black_hole_center'];
/** The emissive layers. With the rings, these form EARLY; the main `ring` mesh forms last. */
const BLACK_HOLE_GLOW_MATERIALS = [
  'black_hole_light1',
  'black_hole_light2',
  'black_hole_light3',
  'black_hole_distortion',
];
/** The model ships a small off-centre planet that has nothing to do with the black hole. */
const BLACK_HOLE_PLANET_MATERIAL = 'Planet';
/** Where the field's bloom settles once the hole has formed — the disc is bright on its own by then. */
const BLACKHOLE_BLOOM_STRENGTH = 0.55;

// ── The accretion spiral ──
// Every number mirrors SINGULARITY_STATE.accretion. The spiral shape is not authored: particles are
// seeded from the star's OWN MESH and wound by Keplerian shear — see lib/accretionShader.ts.
/**
 * How many particles the disc is built from.
 *
 * The lab uses 120k on a frame containing nothing else. This scene also draws a starfield, a debris
 * field and a room, so it takes a third of that — the shader's own header notes the binding cost is
 * fill rate (count × pointSize²) rather than vertex count, and at ~4px this stays well inside budget.
 * Dropped entirely on the low tier.
 */
const ACCRETION_PARTICLES = 45000;
const ACCRETION_STRENGTH = 0.6;
const ACCRETION_WIND = 1.1;
const ACCRETION_FLATTEN = 0.85;
const ACCRETION_TURBULENCE = 0.12;
const ACCRETION_INNER_RADIUS = 0.28;
const ACCRETION_COLOR_COOL = 0xd92a05;
const ACCRETION_COLOR_HOT = 0xffeeb8;
/**
 * Grain size, in pixels × world-units — the same unit as RING_POINT_SIZE, and for the same reason.
 *
 * The shader computes `uSize × uScale / viewDepth`, so setting `uSize = this / uScale` cancels the
 * star-relative term and leaves `this / viewDepth`: a grain of ~4px at the works camera's ~7 units.
 * Without that cancellation the size would swing with whatever the model's own bounding radius happens
 * to be, which is not a number anybody tuning this should have to know.
 */
const ACCRETION_POINT_SIZE = 28;

// ── Lensing ──
// The pass itself belongs to the field (it owns the composer); this scene only says what it should be
// set to each frame. Values mirror SINGULARITY_STATE.lensing.
const LENSING_STRENGTH = 0.9;
const LENSING_ABERRATION = 0.24;
const LENSING_LIQUID = 0.6;
/** No photon ring: the accretion spiral already draws a bright edge, and a second reads as an outline. */
const LENSING_RING = 0;
const LENSING_SHADOW = 0.7;
const LENSING_RADIUS_SCALE = 1;
/**
 * The liquid swells in while the screen is held bright — the hole being BORN inside the glare — then
 * drains as that brightness leaves, settling to a plain black hole. This is the best beat in the whole
 * finale and it is the reason the star was moved into this renderer at all: a lensing pass only has
 * something to bend when the starfield is in the same framebuffer.
 */
const FINALE_LIQUID_IN_FRACTION = 0.7;

// ── The dive (the loop's crossing) ──
// By the time the visitor falls in, the finale's own liquid envelope has drained to zero and the pass is
// disabled. The dive turns it back on and pushes it well past where the birth used it: you are inside
// the distortion now rather than watching it from outside.
/** Lensing strength at full fall. Above the finale's 0.9 — the whole frame should be bending. */
const DIVE_LENSING_STRENGTH = 1.6;
/** Ripple amplitude at full fall. This is what makes the last second read as liquid rather than as zoom. */
const DIVE_LENSING_LIQUID = 1.35;
/**
 * How far into the dive the shadow has taken the whole screen.
 *
 * This is the MASK: the teleport fires at dive 1 and must be invisible, so the frame has to be black
 * before it. Reaching full black at 0.82 rather than 1.0 leaves a deliberate beat of pure darkness at
 * the end of the fall — the jump lands inside that beat, with margin either side of it.
 */
const DIVE_BLACKOUT: readonly [number, number] = [0.68, 0.93];

/** One fracture shard: where it sits when the shell is whole, and the axis it moves along. */
interface Shard {
  object: THREE.Object3D;
  home: THREE.Vector3;
  /** Unit direction from the fracture centroid out to this shard — same construction the editor used. */
  outward: THREE.Vector3;
}

/** One flare disc's spin state. The axis is its own normal, so it turns flat like a coin. */
interface FlareSpin {
  mesh: THREE.Mesh;
  axis: THREE.Vector3;
  base: THREE.Quaternion;
  angle: number;
}

/**
 * Which beat of the finale a black-hole mesh belongs to.
 *
 * Scaling these SEPARATELY, rather than scaling the whole group, is what lets the hole open from the
 * middle while the disc assembles around it afterwards — scaling the group inflated the accretion disc
 * out of a single point, which is not how a disc arrives.
 */
type BlackHolePhase = 'horizon' | 'early' | 'late';

interface MeshForm {
  mesh: THREE.Mesh;
  baseScale: THREE.Vector3;
  phase: BlackHolePhase;
}

/**
 * What the field's lensing pass should be set to this frame.
 *
 * The scene computes it (only it knows where the hole is and how far it has opened); the FIELD owns the
 * pass, because the pass lives in its composer. `strength` 0 means the pass can be disabled outright —
 * a pass-through still costs a full-screen blit.
 */
export interface SingularityLensing {
  strength: number;
  centerX: number;
  centerY: number;
  radius: number;
  aberration: number;
  liquid: number;
  ring: number;
  shadow: number;
  time: number;
}

/** Mirrors the editor's `blackHoleGroupForMaterialNames`, minus the parts only it needed. */
function classifyBlackHoleMesh(materialNames: string[]): BlackHolePhase | null {
  if (materialNames.includes(BLACK_HOLE_PLANET_MATERIAL)) return null;
  const isRing = materialNames.some((name) => name === 'ring' || name === 'ring2');
  const isGlow = materialNames.some((name) => BLACK_HOLE_GLOW_MATERIALS.includes(name));
  // The main `ring` mesh completes the disc last; every other ring and glow layer forms with the
  // earlier beat, so the disc builds up rather than switching on.
  if (isRing || isGlow) return materialNames.includes('ring') ? 'late' : 'early';
  return 'horizon';
}

export interface SingularityScene {
  /** Add this to the works scene. It sits at the origin, which every camera key already aims at. */
  readonly group: THREE.Group;
  /** True once the model has landed and the star is posed. Nothing draws before it. */
  isReady(): boolean;
  /**
   * How present the star is, 0..1 — driven off the return crossing, so it fades up as the camera swings
   * back onto the place it used to be. Below the epsilon the whole group is hidden and costs nothing.
   */
  setPresence(presence: number): void;
  /**
   * Arm the finale — true once the return crossing has fully landed, i.e. the visitor is standing in
   * contact. Arming starts a `FINALE_ARM_DELAY_SECONDS` wait and then the sequence; disarming rewinds
   * it. There is deliberately no play() and no trigger: scroll is the only thing that starts this.
   */
  setArmed(armed: boolean): void;
  /** Advance the clock, the spin and the rings' orbits. Called every frame the field draws. */
  update(deltaSeconds: number, elapsedSeconds: number, camera: THREE.Camera): void;
  /**
   * What the field's bloom strength should be this frame, given its own resting value.
   *
   * One method rather than a lift and a boost, because three things move this number and they have to
   * compose in a known order: the star's arrival lifts it to CONTACT_BLOOM_STRENGTH, the flash spikes
   * above that, and the formed hole settles it back down to BLACKHOLE_BLOOM_STRENGTH.
   */
  bloomStrength(fieldBase: number): number;
  /** Extra tone-mapping exposure the flash wants this frame, on top of the field's own. */
  exposureBoost(): number;
  /** What to set the field's lensing pass to this frame. `strength` 0 means disable it. */
  lensing(): Readonly<SingularityLensing>;
  /**
   * The dive into the hole, 0..1 — the loop's crossing.
   *
   * Takes the lensing back over from the finale's own envelope, which by then has drained to nothing:
   * the liquid comes back hard and the shadow grows until it owns the frame. That shadow IS the mask the
   * teleport happens behind, which is why it is worth having the fall drive it rather than a veil alone.
   */
  setDive(progress: number): void;
  /**
   * The scrollbar has jumped to the top. Be at sequence 0 NOW, not eased toward it.
   *
   * Without this the star spends `FINALE_REWIND_SECONDS` visibly un-dying behind the cover — see
   * LOOP_RESET_EVENT.
   */
  reset(): void;
  dispose(): void;
}

export interface SingularitySceneOptions {
  /**
   * The renderer's DPR, so the rings' point sizes match what the canvas actually draws.
   *
   * ⚠ A GETTER, AND IT USED TO BE A NUMBER. Read once at build time it was allowed to drift a little,
   * on the reasoning that a grain slightly large or small is well inside what the twinkle already
   * varies. That was true while this scene was built at CHAMBER_PROGRESS, long after the resolution
   * had settled. It is built during the LOADER now (it is a gated source), which is before the
   * burn-in decides anything — so a captured number would be the provisional ratio every time, on
   * every machine, rather than occasionally.
   *
   * Still read exactly once, just later: at the moment the rings are actually created, inside the
   * model's own callback. Nothing chases it per frame and nothing needs to.
   */
  pixelRatio: () => number;
  /** Drops the accretion spiral entirely — the one part of the finale with a real per-frame cost. */
  lowPower?: boolean;
  onReady?: () => void;
  /**
   * The BLACK HOLE's download fraction, 0..1 — this star is a GATED SOURCE now (see
   * lib/assetLoadProgress).
   *
   * ⚠ The black hole's, not the whole scene's, and that is the honest choice rather than a shortcut.
   * `fractured_sun.glb` is loaded here for the second time on the page — the hero pulled it in at
   * rung 1 — so by the time this runs it comes out of cache and its progress is a single jump from
   * nothing to everything. `black_hole.glb` is 2.37 MB and genuinely on the wire, which makes it the
   * only part of this scene a progress bar can describe.
   */
  onProgress?: (fraction: number) => void;
  /**
   * Every model this scene needs is in — or has failed and is not coming.
   *
   * ⚠ NOT `onReady`, and the difference is 2.37 MB. `onReady` fires when the STAR lands, because that
   * is when there is something to draw; the black hole is only requested from inside that callback,
   * since the hole has to be fitted against a measured star. Gating the loader on `onReady` would open
   * it while the largest asset on the site was still downloading — which is the exact failure this
   * source was added to stop.
   */
  onSettled?: () => void;
}

/**
 * Build the contact star. The model load is asynchronous and deliberately late — the caller kicks this
 * off when the chamber reveal STARTS, which buys the room, a full stop and a 5.8s return glide before
 * the first frame that needs it.
 */
export function createSingularityScene({
  pixelRatio,
  lowPower = false,
  onReady,
  onProgress,
  onSettled,
}: SingularitySceneOptions): SingularityScene {
  const group = new THREE.Group();
  // Hidden until the return brings it in. The star does not exist for the rest of the site.
  group.visible = false;

  // The spinner carries the idle rotation and the model keeps its authored pose, so the two never fight
  // over one Euler — the same split `SunModelCanvas` uses.
  const spinner = new THREE.Group();
  group.add(spinner);

  const coreLight = new THREE.PointLight(CORE_LIGHT_COLOR, 0, CORE_LIGHT_DISTANCE);
  group.add(coreLight);

  const shards: Shard[] = [];
  const flareSpins: FlareSpin[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  const scratchSpin = new THREE.Quaternion();

  let modelRoot: THREE.Object3D | null = null;
  /** The star's burning surface — what the omitted `sunouter` shells used to be. */
  let plasma: SunPlasma | null = null;
  /** The glTF's own root scale, so the collapse shrinks FROM it rather than replacing it. */
  const modelBaseScale = new THREE.Vector3(1, 1, 1);
  let shardRadius = 1;
  let ready = false;
  let disposed = false;
  let presence = 0;
  // Built with the model, because the rings are sized in units of the star's own body radius and that
  // is not known until it has loaded.
  let rings: SunParticles | null = null;

  // ── The finale's clock ──
  // A one-shot with a duration, not a scrubbed span. CLAUDE.md's one-clock rule scopes itself to
  // CROSSINGS, and contact is a stop — the precedents for a timed beat at a stop are the shard assembly
  // ("a reveal needs a duration of its own or it is never actually seen") and the hologram unseal.
  let armed = false;
  let armDelayRemaining = 0;
  let sequence = 0;
  /** Multiplier on the star's spin, from the collapse's wind-up. Applied where the spin accumulates. */
  let spinMultiplier = 1;
  /** How far the star has fallen in, 0..1. The rings are taken out with it — see `update`. */
  let collapseAmount = 0;
  /** The lensing envelope, 0..1 — see the note where it is computed. Off outside the flash's window. */
  let liquidRamp = 0;
  /** The loop's dive, 0..1. Drives the lensing back on and the shadow up to full — see setDive. */
  let dive = 0;
  /** The flash's screen-wide stage this frame, already damped. Read by the field's grade. */
  let screenPulse = 0;
  const reduceMotion = prefersReducedMotion();
  const flashDamping = reduceMotion ? REDUCED_MOTION_FLASH_SCALE : 1;

  /** The magma's authored emissive, so redshift lerps FROM it and returns to it exactly at sequence 0. */
  let magmaMaterial: THREE.MeshStandardMaterial | null = null;
  const magmaBaseEmissive = new THREE.Color(0xffffff);
  /** FLASH_BASE_WORLD_UNITS expressed in group-local units, so the quad's size is frame-relative. */
  let burstBaseRadius = 1;
  const redshiftColor = new THREE.Color(FINALE_REDSHIFT_COLOR);
  const scratchColor = new THREE.Color();

  // ── The supernova burst ──
  // A billboarded additive disc at the star's centre. `depthTest` is off so it always reads: it is
  // light hitting the lens, not an object in the scene, and the star is dissolving in the same place.
  const burstMaterial = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(BURST_UNIFORMS),
    vertexShader: BURST_VERTEX_SHADER,
    fragmentShader: BURST_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const burstMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), burstMaterial);
  burstMesh.frustumCulled = false;
  burstMesh.renderOrder = 999;
  burstMesh.visible = false;
  group.add(burstMesh);

  // ── The black hole ──
  // Two nodes: the GROUP carries the fit, the SPINNER inside it carries the idle turn — so the fit and
  // the spin never fight over one transform. It stays at full scale throughout; the reveal happens
  // per-mesh below (see MeshForm).
  const blackHoleGroup = new THREE.Group();
  const blackHoleSpinner = new THREE.Group();
  blackHoleGroup.add(blackHoleSpinner);
  blackHoleGroup.visible = false;
  group.add(blackHoleGroup);
  const blackHoleForms: MeshForm[] = [];
  let blackHoleRoot: THREE.Object3D | null = null;
  let blackHoleLoaded = false;
  /** LOCAL radius of the horizon meshes ALONE — the lensing edge sits on the dark sphere, not the disc. */
  let blackHoleHorizonRadius = 1;
  /** How far the horizon has opened, 0..1. An unopened horizon has nothing to bend light around. */
  let horizonForm = 0;

  // ── The accretion spiral ──
  // On the SPINNER, so it shares the star's frame and winds with it; the hole sits at that frame's
  // origin, which is exactly where the particles fall to.
  const accretionParticleCount = lowPower ? 0 : ACCRETION_PARTICLES;
  const accretionGeometry = new THREE.BufferGeometry();
  const accretionMaterial = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(ACCRETION_UNIFORMS),
    vertexShader: ACCRETION_VERTEX_SHADER,
    fragmentShader: ACCRETION_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const accretionPoints = new THREE.Points(accretionGeometry, accretionMaterial);
  // The vertex shader moves points far from their bind pose, so three's culling maths has nothing
  // meaningful to test.
  accretionPoints.frustumCulled = false;
  accretionPoints.visible = false;
  spinner.add(accretionPoints);
  let accretionSeeded = false;

  const lensingState: SingularityLensing = {
    strength: 0,
    centerX: 0.5,
    centerY: 0.5,
    radius: 0.1,
    aberration: LENSING_ABERRATION,
    liquid: LENSING_LIQUID,
    ring: LENSING_RING,
    shadow: LENSING_SHADOW,
    time: 0,
  };
  const scratchLensCentre = new THREE.Vector3();
  const scratchLensEdge = new THREE.Vector3();
  const scratchCameraUp = new THREE.Vector3();
  const scratchWorldScale = new THREE.Vector3();

  /**
   * Place every shard for a spread, plus a per-shard shudder.
   *
   * Each shard carries its own phase so they fight out of step — in lockstep it reads as one mechanical
   * pulse rather than a star straining. Purely a function of `sequence`, so rewinding reproduces it
   * exactly. Same construction as the editor's `positionShardsWithTremor`.
   */
  const positionShards = (spread: number, tremor: number, at: number) => {
    shards.forEach(({ object, home, outward }, index) => {
      const shudder =
        tremor === 0 ? 0 : Math.sin(at * TREMOR_FREQUENCY + index * TREMOR_PHASE_STEP) * tremor;
      object.position.copy(home).addScaledVector(outward, (spread + shudder) * shardRadius);
    });
  };

  /**
   * Seed the accretion spiral from the star's ACTUAL surface.
   *
   * Sampling TRIANGLES rather than vertices gives even coverage — the model's vertices are clustered
   * around detail, so vertex sampling would clump. Positions are taken into the spinner's frame (which
   * is where the points live) and normalised, so the shader's radius maths is scale-free.
   *
   * ⚠ Must run with the star already POSED at sequence 0. The finale opens on a collapsed star, and
   * seeding an uncollapsed one would release the disc from a shell twice the size of the thing it is
   * supposed to be coming off.
   */
  const seedAccretion = () => {
    if (!modelRoot || accretionSeeded || accretionParticleCount === 0) return;
    group.updateMatrixWorld(true);
    const spinnerInverse = new THREE.Matrix4().copy(spinner.matrixWorld).invert();
    const toSpinner = new THREE.Matrix4();
    const corner = new THREE.Vector3();
    const triangles: number[] = [];

    modelRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const positionAttribute = object.geometry.getAttribute('position');
      if (!positionAttribute) return;
      toSpinner.multiplyMatrices(spinnerInverse, object.matrixWorld);
      const index = object.geometry.getIndex();
      const triangleCount = index ? index.count / 3 : positionAttribute.count / 3;
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        for (let vertex = 0; vertex < 3; vertex += 1) {
          const slot = triangle * 3 + vertex;
          const attributeIndex = index ? index.getX(slot) : slot;
          corner.fromBufferAttribute(positionAttribute, attributeIndex).applyMatrix4(toSpinner);
          triangles.push(corner.x, corner.y, corner.z);
        }
      }
    });

    const triangleCount = triangles.length / 9;
    if (triangleCount === 0) return;

    const starts = new Float32Array(accretionParticleCount * 3);
    const seeds = new Float32Array(accretionParticleCount);
    let starRadius = 0;
    for (let particle = 0; particle < accretionParticleCount; particle += 1) {
      const base = Math.floor(Math.random() * triangleCount) * 9;
      // Uniform barycentric point on the triangle — the fold keeps it inside rather than biased to a
      // corner.
      let u = Math.random();
      let v = Math.random();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const w = 1 - u - v;
      const target = particle * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        starts[target + axis] =
          triangles[base + axis] * w + triangles[base + 3 + axis] * u + triangles[base + 6 + axis] * v;
      }
      starRadius = Math.max(
        starRadius,
        Math.hypot(starts[target], starts[target + 1], starts[target + 2]),
      );
      // Kept in [0,1): the shader's hash multiplies it up, and a large number there costs float
      // precision and bands the release times.
      seeds[particle] = Math.random();
    }
    // Normalise to star-radii, which is what the shader's `uInnerRadius` and winding maths assume.
    const scale = starRadius || 1;
    for (let component = 0; component < starts.length; component += 1) starts[component] /= scale;

    accretionGeometry.setAttribute('position', new THREE.BufferAttribute(starts, 3));
    accretionGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    accretionMaterial.uniforms.uScale.value = scale;
    // Cancels the star-relative term in the shader's point-size formula — see ACCRETION_POINT_SIZE.
    accretionMaterial.uniforms.uSize.value = ACCRETION_POINT_SIZE / scale;
    accretionMaterial.uniforms.uColorCool.value.set(ACCRETION_COLOR_COOL);
    accretionMaterial.uniforms.uColorHot.value.set(ACCRETION_COLOR_HOT);
    accretionMaterial.uniforms.uStrength.value = ACCRETION_STRENGTH;
    accretionMaterial.uniforms.uWind.value = ACCRETION_WIND;
    accretionMaterial.uniforms.uFlatten.value = ACCRETION_FLATTEN;
    accretionMaterial.uniforms.uTurbulence.value = ACCRETION_TURBULENCE;
    accretionMaterial.uniforms.uInnerRadius.value = ACCRETION_INNER_RADIUS;
    accretionSeeded = true;
  };

  /** Scale each black-hole mesh by its own beat's form, so the hole opens before its disc assembles. */
  const applyRingForm = (horizon: number, early: number, late: number) => {
    blackHoleForms.forEach(({ mesh, baseScale, phase }) => {
      const form = phase === 'horizon' ? horizon : phase === 'early' ? early : late;
      mesh.scale.set(baseScale.x * form, baseScale.y * form, baseScale.z * form);
    });
  };

  /**
   * Put the star at a moment on the finale's timeline. THE SINGLE OWNER of everything it touches —
   * shard positions, model scale, magma emissive, core light, material opacity, the burst.
   *
   * Called from `setPresence` as well as from the frame loop, so presence changes and sequence changes
   * resolve through one function. Two writers of `coreLight.intensity` was the obvious alternative and
   * it is exactly the pattern this codebase keeps having to undo.
   *
   * At `sequence = 0` every term below resolves to the Collapse pose the works section left the star
   * in: explode 0, collapse 0, tremor 0, scale × COLLAPSE_MODEL_SCALE, shards at COLLAPSE_FRACTURE_SPREAD,
   * emissive untinted. That exactness is what makes the rewind clean rather than approximate.
   */
  const applyFinale = () => {
    group.visible = ready && presence > PRESENCE_EPSILON;
    // The POSE is applied whether or not the star is on screen. `seedAccretion` samples the star's real
    // surface and has to see it collapsed, and it runs at load — long before any presence.
    if (!ready) return;

    const explode = THREE.MathUtils.smoothstep(sequence, FINALE_EXPLODE[0], FINALE_EXPLODE[1]);
    // Cubed, not smoothstepped. A smoothstep DECELERATES into its end, which reads as a slider being
    // dragged; gravity does the opposite — barely moves, then plummets. This is what makes the last of
    // the star vanish fast, and it is why the flash peaks at exactly 0.5 (where the cube reaches 1).
    const collapse = explode * explode * explode;
    collapseAmount = collapse;

    // 0. TREMOR — the anticipation beat. Builds over TREMOR_IN, then is swallowed by the collapse so it
    //    hands over instead of competing. Without it the finale opens mid-thought: nothing happens until
    //    the collapse curve bites, and the first half-second is dead air. A smooth ramp reads as
    //    "growing"; the shudder is what makes it read as STRUGGLING.
    const tremor = FINALE_TREMOR * THREE.MathUtils.smoothstep(sequence, 0, TREMOR_IN) * (1 - collapse);

    // 1. The shards are crushed inward past the collapse pose, so the star implodes rather than merely
    //    getting smaller — it uses the model's real fracture geometry instead of a uniform scale.
    positionShards(COLLAPSE_FRACTURE_SPREAD - FINALE_SHARD_CRUSH * collapse, tremor, sequence);

    // 2. It shrinks to nothing on the same accelerating curve. Multiplied onto the model's OWN scale.
    modelRoot?.scale
      .copy(modelBaseScale)
      .multiplyScalar(COLLAPSE_MODEL_SCALE * (1 - collapse));

    // 3. Gravitational redshift — light loses energy climbing out of a deepening well. The cue that
    //    reads most as real physics, and the cheapest thing in this function.
    if (magmaMaterial) {
      magmaMaterial.emissive
        .copy(magmaBaseEmissive)
        .lerp(redshiftColor, FINALE_REDSHIFT * collapse);
    }

    // 4. Angular momentum — a contracting star spins up. Applied in `update`, where the spin actually
    //    accumulates; the tremor adds a restless lift before the real wind-up.
    spinMultiplier = 1 + (FINALE_SPIN_UP - 1) * collapse + TREMOR_SPIN_LIFT * tremor;

    // 5. The hole opens from the middle, and only once the star is essentially gone; its disc gathers
    //    afterwards. The GROUP stays at full size and each mesh carries its own beat — scaling the group
    //    instead would inflate the accretion disc out of a single point, which no disc does.
    horizonForm = THREE.MathUtils.smoothstep(sequence, FINALE_HORIZON[0], FINALE_HORIZON[1]);
    applyRingForm(
      horizonForm,
      THREE.MathUtils.smoothstep(sequence, FINALE_RING_FORM_EARLY[0], FINALE_RING_FORM_EARLY[1]),
      THREE.MathUtils.smoothstep(sequence, FINALE_RING_FORM_LATE[0], FINALE_RING_FORM_LATE[1]),
    );
    blackHoleGroup.visible = group.visible && blackHoleLoaded && horizonForm > 0;

    if (!group.visible) {
      // Dropped to zero as well as hidden: a light does not care whether its owner is visible, and a
      // white-hot point source left burning inside a hidden star would still light the debris field.
      coreLight.intensity = 0;
      burstMesh.visible = false;
      accretionPoints.visible = false;
      screenPulse = 0;
      lensingState.strength = 0;
      return;
    }

    materials.forEach((material) => {
      material.opacity = presence;
    });

    // The surface fades and reddens with the crust, so the two halves of the star cannot separate as
    // it dies. Its CHURN is driven from the frame loop instead — this function is also called from
    // `setPresence`, which has no clock, and it is the single owner of everything keyed to the
    // sequence rather than to time.
    plasma?.setPresence(presence, FINALE_REDSHIFT * collapse);

    // 6. The accretion spiral: the star's own matter, released and wound inward. Runs on the RAW
    //    sequence rather than on `explode`, because the particles carry their own staggered release —
    //    which is what fills the long dead beat the collapse curve leaves at the front of the finale.
    accretionPoints.visible = accretionSeeded && presence > PRESENCE_EPSILON;
    if (accretionPoints.visible) {
      accretionMaterial.uniforms.uSequence.value = sequence;
      accretionMaterial.uniforms.uStrength.value = ACCRETION_STRENGTH * presence;
    }
    // The core swells while the star strains, then is sucked in with the rest of it.
    coreLight.intensity =
      CORE_LIGHT_INTENSITY * presence * (1 - explode) * (1 + TREMOR_GLOW_SWELL * tremor);

    // ── The flash ──
    // Two stages. The CORE burst is the detonation itself and holds only briefly, so it gets out of the
    // way of what it revealed. The SCREEN grade lags it slightly (the eye is overwhelmed a beat after
    // the light arrives) and plateaus for the full hold — that plateau is the window the black hole
    // will form inside, in step 4.
    const flashStrength = FLASH_STRENGTH * flashDamping * presence;
    const corePulse = flashEnvelope(
      sequence,
      FLASH_AT,
      FLASH_ATTACK,
      FLASH_HOLD * FLASH_CORE_HOLD_FRACTION,
      FLASH_CORE_DECAY,
    );
    screenPulse =
      flashEnvelope(
        sequence,
        FLASH_AT + FLASH_SCREEN_LAG,
        FLASH_SCREEN_ATTACK,
        FLASH_HOLD,
        FLASH_SCREEN_DECAY,
      ) * flashStrength;

    burstMesh.visible = flashStrength > 0 && corePulse > 0;
    if (burstMesh.visible) {
      // Expansion is monotonic across the whole pulse while brightness rises then falls — so the light
      // keeps travelling outward as it dies, instead of shrinking back into itself.
      const expand = THREE.MathUtils.smoothstep(
        sequence,
        FLASH_AT - FLASH_ATTACK,
        FLASH_AT + FLASH_HOLD * FLASH_CORE_HOLD_FRACTION + FLASH_CORE_DECAY,
      );
      burstMesh.scale.setScalar(
        THREE.MathUtils.lerp(FLASH_SCALE_FROM, FLASH_SCALE_TO, expand) * burstBaseRadius,
      );
      burstMaterial.uniforms.uIntensity.value = corePulse * flashStrength;
      burstMaterial.uniforms.uColor.value.set(FLASH_COLOR);
    }

    // ── The lensing envelope ──
    // The liquid belongs to the hole, and only while it is FORMING: it swells in across the held flash
    // — so the hole is born as a churning distortion inside the glare, which is the beat this whole
    // rewrite exists for — then drains as that brightness leaves, settling to a plain black hole.
    //
    // It reaching zero on its own is what lets the field disable the pass without anything having to
    // turn it off by hand, so the full-screen cost is paid for about a second and never again.
    const swellIn = THREE.MathUtils.smoothstep(
      sequence,
      FLASH_AT,
      FLASH_AT + FLASH_HOLD * FINALE_LIQUID_IN_FRACTION,
    );
    const drainOut =
      1 -
      THREE.MathUtils.smoothstep(
        sequence,
        FLASH_AT + FLASH_HOLD,
        FLASH_AT + FLASH_HOLD + FLASH_SCREEN_DECAY,
      );
    liquidRamp = swellIn * drainOut;
  };

  /**
   * Point the lensing pass at wherever the hole is on screen. Measured every frame, so it tracks the
   * visitor's drag-to-look rather than assuming the hole sits at the centre of the frame.
   */
  const updateLensing = (camera: THREE.Camera, elapsedSeconds: number) => {
    // The dive OVERRIDES the finale's envelope rather than adding to it. By the time anyone falls in,
    // `liquidRamp` has drained to zero and the pass is off; taking the max is what turns it back on
    // without the two fighting over one number.
    const diveEase = dive * dive * (3 - 2 * dive);
    const strength = Math.max(
      LENSING_STRENGTH * liquidRamp,
      DIVE_LENSING_STRENGTH * diveEase,
    ) * presence;
    lensingState.liquid = Math.max(LENSING_LIQUID, DIVE_LENSING_LIQUID * diveEase);
    // The shadow grows until it owns the frame. This is the cover the teleport happens behind.
    lensingState.shadow = Math.max(
      LENSING_SHADOW,
      THREE.MathUtils.smoothstep(dive, DIVE_BLACKOUT[0], DIVE_BLACKOUT[1]),
    );
    // Fold in how far the horizon has opened: an unopened horizon is nothing to bend light around.
    const worldScale =
      blackHoleGroup.getWorldScale(scratchWorldScale).x * horizonForm;
    if (!blackHoleLoaded || strength <= 0 || worldScale <= 1e-4) {
      lensingState.strength = 0;
      return;
    }
    // The camera has just been placed, but its matrices are only refreshed inside render() — without
    // this the lens centre would trail the camera by a frame while the visitor drags.
    camera.updateMatrixWorld();
    blackHoleGroup.getWorldPosition(scratchLensCentre);
    scratchLensCentre.project(camera);
    // Behind the camera: the projection wraps and would smear the effect across the whole frame.
    if (scratchLensCentre.z > 1) {
      lensingState.strength = 0;
      return;
    }
    lensingState.strength = strength;
    lensingState.centerX = scratchLensCentre.x * 0.5 + 0.5;
    lensingState.centerY = scratchLensCentre.y * 0.5 + 0.5;

    // Project the horizon's edge to get its on-screen size. Offset along camera UP rather than right, so
    // it lands in NDC-y — which is the shader's vertical unit, with no aspect correction to undo.
    scratchCameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
    blackHoleGroup.getWorldPosition(scratchLensEdge);
    scratchLensEdge
      .addScaledVector(scratchCameraUp, blackHoleHorizonRadius * worldScale * LENSING_RADIUS_SCALE)
      .project(camera);
    lensingState.radius = Math.max(
      Math.abs(scratchLensEdge.y - scratchLensCentre.y) * 0.5,
      1e-4,
    );
    lensingState.time = elapsedSeconds;
  };

  // Declared above the load on purpose: the callback calls it, and a `const` arrow declared below would
  // only work by accident of the load being asynchronous.
  const setPresence = (next: number) => {
    presence = THREE.MathUtils.clamp(next, 0, 1);
    applyFinale();
  };

  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(getSharedDracoLoader());
  // Same as the chamber: drawn by the works field's renderer, never handed one, and detection has
  // already happened there. See lib/modelLoading.ts.
  gltfLoader.setKTX2Loader(getSharedKtx2Loader());

  gltfLoader.load(MODEL_PATH, (gltf) => {
    // The load is fired well before it is needed, so a visitor who leaves the page mid-glide can land
    // here after teardown. Without this the scene keeps a model nobody will ever dispose.
    if (disposed) return;
    modelRoot = gltf.scene;
    // Captured before anything touches it: the collapse SHRINKS from this rather than assigning a
    // scale, so a glTF that arrives with a non-unit (or non-uniform) root scale is preserved.
    modelBaseScale.copy(modelRoot.scale);

    // The magma ships an emissive TEXTURE but no emissive factor, so by the glTF spec it renders
    // dead-black. Prime it to white or the star has no glow at all. (Same trap as `SunModelCanvas`.)
    modelRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      meshMaterials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        if (material.emissiveMap && material.emissive.getHex() === 0x000000) {
          material.emissive.setHex(0xffffff);
        }
        material.emissiveIntensity = MAGMA_EMISSIVE;
        material.envMapIntensity = ENV_INTENSITY;
        // Held transparent for the star's whole life rather than toggled: `transparent` is part of a
        // material's program key in three, so flipping it mid-fade forces a shader recompile at exactly
        // the moment the frame is already doing the most work.
        material.transparent = true;
        material.opacity = 0;
        if (!materials.includes(material)) materials.push(material);
        // The magma is the star's only lit material and the one carrying its glow, so it is the one
        // the redshift acts on. Its authored emissive is kept so the lerp returns to it EXACTLY at
        // sequence 0 — rewinding has to leave no tint behind.
        if (material.name === REDSHIFT_MATERIAL) {
          magmaMaterial = material;
          magmaBaseEmissive.copy(material.emissive);
        }
      });
    });

    // ── The same star the hero draws, so it must be the same PARTS ──
    //
    // `SUN_OMITTED_PARTS` is shared with `SunModelCanvas` precisely so this cannot drift: the hero sun
    // stopped drawing the flares, the blowout planes and the eleven `sunouter` shells, and a star at
    // contact that still had them would be a visibly different object at the one moment the site asks
    // you to recognise it as the one you left at works.
    //
    // ⚠ Hidden AFTER the material walk above, not instead of it. Those materials still need their
    // emissive primed and their `transparent`/`opacity` set, because `materials` drives the whole
    // star's fade and the rewind's exactness depends on every entry being present.
    modelRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      if (meshMaterials.some((material) => isOmittedSunPart(material.name))) object.visible = false;
    });

    // The atmosphere those shells used to be, procedurally — one surface instead of eleven blended
    // meshes. Transparent here and only here: this star fades out, and `transparent` is part of a
    // material's program key, so it is set at construction rather than toggled mid-finale.
    plasma = createSunPlasma({ transparent: true });
    modelRoot.add(plasma.mesh);

    // Flares are FLAT discs whose geometry centre is offset from the mesh origin — spinning about the
    // origin would ORBIT them. Recentre each so it turns in place, compensating the mesh position so
    // nothing moves visually.
    //
    // ⚠ Skipped when the flares are omitted: they are invisible, but this would still clone their
    // geometry and the spin below would keep rebuilding quaternions for them every frame.
    modelRoot.traverse((object) => {
      if (isOmittedSunPart('flare')) return;
      if (!(object instanceof THREE.Mesh)) return;
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      if (!meshMaterials.some((material) => material.name === 'flare')) return;

      const geometry = object.geometry.clone();
      geometry.computeBoundingBox();
      const centre = new THREE.Vector3();
      geometry.boundingBox?.getCenter(centre);
      object.position.add(centre.clone().multiply(object.scale).applyQuaternion(object.quaternion));
      geometry.translate(-centre.x, -centre.y, -centre.z);
      object.geometry = geometry;

      geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      geometry.boundingBox?.getSize(size);
      // The shortest local dimension is the disc's normal — spin about that and it turns flat.
      const axis =
        size.x <= size.y && size.x <= size.z
          ? new THREE.Vector3(1, 0, 0)
          : size.y <= size.z
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(0, 0, 1);
      flareSpins.push({ mesh: object, axis, base: object.quaternion.clone(), angle: 0 });
    });

    modelRoot.rotation.set(
      THREE.MathUtils.degToRad(MODEL_ROTATION.x),
      THREE.MathUtils.degToRad(MODEL_ROTATION.y),
      THREE.MathUtils.degToRad(MODEL_ROTATION.z),
    );
    spinner.add(modelRoot);

    // Put the model's centre ON the spinner's axis, or the idle spin does not turn the star in place —
    // it orbits it, because the model's content is centred off the origin. Measured in world space
    // (Box3 always is) and converted back into the spinner's frame.
    spinner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelRoot);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const centre = box.getCenter(new THREE.Vector3());
    spinner.worldToLocal(centre);
    modelRoot.position.sub(centre);

    // Fit the star to the works scene. Applied to the GROUP, not the model, so the collapse's own
    // `COLLAPSE_MODEL_SCALE` still multiplies the model's authored scale rather than replacing this.
    group.scale.setScalar(STAR_RADIUS / (sphere.radius || 1));

    // ── The shards, and the axis each parts along ──
    // The ten fracture cells are Groups at the model root; their local positions carry the real assembly
    // offsets, so "outward" is measured entirely within that one frame — the same construction as the
    // same construction `SunModelCanvas` uses to open the shell, so the two agree.
    const shardObjects = modelRoot.children.filter((child) =>
      child.name.startsWith(SHARD_NAME_PREFIX),
    );
    if (shardObjects.length > 0) {
      const centroid = new THREE.Vector3();
      shardObjects.forEach((shard) => centroid.add(shard.position));
      centroid.multiplyScalar(1 / shardObjects.length);

      let radiusSum = 0;
      shardObjects.forEach((shard) => {
        radiusSum += shard.position.distanceTo(centroid);
      });
      shardRadius = radiusSum / shardObjects.length || 1;

      shardObjects.forEach((shard) => {
        const outward = shard.position.clone().sub(centroid);
        // A shard sitting exactly on the centroid has no outward — default to +Y so it still moves.
        if (outward.lengthSq() < 1e-8) outward.set(0, 1, 0);
        shards.push({
          object: shard,
          home: shard.position.clone(),
          outward: outward.normalize(),
        });
      });
    }

    // The burst lives under `group` and so inherits the fit above — but it is authored in WORLD units
    // (see FLASH_BASE_WORLD_UNITS), so undo that scale here. Converted once at load rather than every
    // frame, and it is the reason the flash's size is independent of how big the star happens to be.
    burstBaseRadius = FLASH_BASE_WORLD_UNITS / (group.scale.x || 1);

    // ── The rings ──
    // On the GROUP rather than the spinner or the model, and both matter. Not the spinner, because the
    // bands have their own orbital motion and must not also inherit the star's spin. Not the model,
    // because the collapse shrinks it — and the whole read is matter left in orbit around something
    // that is caving in, so the bands have to stay where they are while the star implodes inside them.
    //
    // `setFrameExtent` is the sizing hook: the shader resolves a ring to `radius × SUN_BODY_FILL ×
    // frameExtent`, so handing it `bodyRadius / SUN_BODY_FILL` makes `radius` mean body radii exactly,
    // which is what the RINGS table is authored in. The hero passes its canvas frame extent instead,
    // because there the binding constraint is the canvas edge; here there is no edge to clip against.
    const bodyRadius = sphere.radius * STAR_BODY_FRACTION;
    rings = createSunParticles(bodyRadius / SUN_BODY_FILL, pixelRatio(), {
      pointSize: RING_POINT_SIZE,
    });
    group.add(rings.object);

    ready = true;
    // Pose the star at sequence 0 BEFORE seeding: the disc is sampled off the star's real surface, and
    // the finale opens on a collapsed one.
    applyFinale();
    seedAccretion();
    // Re-applied now that there is something to apply it to: the return can legitimately have scrubbed
    // past the fade window while the model was still in flight.
    setPresence(presence);
    onReady?.();

    // The hole is fitted against the star, so it can only be loaded once the star has been measured.
    gltfLoader.load(BLACKHOLE_MODEL_PATH, (blackHoleGltf) => {
      if (disposed) return;
      blackHoleRoot = blackHoleGltf.scene;

      blackHoleRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
        const materialNames = meshMaterials.map((material) => material.name);

        meshMaterials.forEach((material) => {
          // A black hole in deep space has nothing to reflect. The works scene lights with a studio
          // RoomEnvironment, and leaving this on puts a room that isn't there onto the rings.
          if ('envMapIntensity' in material) {
            (material as THREE.MeshStandardMaterial).envMapIntensity = 0;
          }
          // The horizon's specular. The model faithfully carries the artist's specularFactor 0.2, which
          // three encodes as a 20%-reflective surface — and black albedo kills the diffuse term but NOT
          // the specular one, so the key light would put a glossy highlight on an event horizon.
          // Collapsing it to zero is the only way a black hole stays black.
          if (
            material instanceof THREE.MeshPhysicalMaterial &&
            BLACK_HOLE_HORIZON_MATERIALS.includes(material.name)
          ) {
            material.specularIntensity = 0;
            material.needsUpdate = true;
          }
        });

        const phase = classifyBlackHoleMesh(materialNames);
        if (!phase) {
          // The stray planet. Not part of the black hole and not part of this story.
          object.visible = false;
          return;
        }
        blackHoleForms.push({ mesh: object, baseScale: object.scale.clone(), phase });
      });

      blackHoleRoot.updateMatrixWorld(true);
      // Measure the horizon ALONE, while the model is still unparented (so world == local). The lensing
      // shadow edge has to sit on the dark sphere, not on the far wider ring span. Recentring below only
      // translates it, which leaves the radius correct.
      const horizonBox = new THREE.Box3();
      blackHoleRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
        if (!meshMaterials.some((material) => BLACK_HOLE_HORIZON_MATERIALS.includes(material.name))) {
          return;
        }
        horizonBox.expandByObject(object);
      });
      if (!horizonBox.isEmpty()) {
        blackHoleHorizonRadius = horizonBox.getBoundingSphere(new THREE.Sphere()).radius || 1;
      }

      // Centre and fit on the black hole NODE, so the small off-centre planet cannot skew where it sits
      // or how big it reads.
      const focusNode = blackHoleRoot.getObjectByName('black hole') ?? blackHoleRoot;
      focusNode.updateMatrixWorld(true);
      const holeBox = new THREE.Box3().setFromObject(focusNode);
      const holeCentre = holeBox.getCenter(new THREE.Vector3());
      const holeSize = holeBox.getSize(new THREE.Vector3());
      const holeRadius = Math.max(holeSize.x, holeSize.y, holeSize.z) / 2 || 1;
      blackHoleRoot.position.sub(holeCentre); // onto the group origin, which is the star's centre
      blackHoleSpinner.add(blackHoleRoot);
      blackHoleGroup.scale.setScalar((sphere.radius * BLACKHOLE_TARGET_FACTOR) / holeRadius);
      blackHoleLoaded = true;
      // Reflect whatever moment the finale is already at — the return can have scrubbed while this
      // was in flight, exactly as with the star.
      applyFinale();
      onSettled?.();
    },
    (event) => onProgress?.(event.total > 0 ? event.loaded / event.total : 0),
    (error) => {
      // The finale degrades to a star that collapses into nothing rather than into a hole, which is
      // worth having. What it must not do is leave the loader holding for a file that is not coming.
      console.error(`Failed to load ${BLACKHOLE_MODEL_PATH}`, error);
      onSettled?.();
    });
  },
  undefined,
  (error) => {
    console.error(`Failed to load ${MODEL_PATH}`, error);
    onSettled?.();
  });

  const setArmed = (next: boolean) => {
    if (next === armed) return;
    armed = next;
    // Restarted on every arrival rather than only the first, so coming back down to contact gives the
    // same beat of stillness before the star goes. A one-time wait would make every replay abrupt.
    if (armed) armDelayRemaining = FINALE_ARM_DELAY_SECONDS;
  };

  const update = (deltaSeconds: number, elapsedSeconds: number, camera: THREE.Camera) => {
    // ── The clock ──
    // Runs whether or not the star is on screen, so a sequence left part-played always finishes
    // unwinding. `deltaSeconds` is the field's own clamped delta, so a backgrounded tab cannot dump a
    // multi-second jump into the middle of the finale.
    if (armed) {
      if (armDelayRemaining > 0) {
        armDelayRemaining = Math.max(0, armDelayRemaining - deltaSeconds);
      } else {
        sequence = Math.min(1, sequence + deltaSeconds / FINALE_SECONDS);
      }
    } else if (sequence > 0) {
      sequence = Math.max(0, sequence - deltaSeconds / FINALE_REWIND_SECONDS);
    }
    applyFinale();
    updateLensing(camera, elapsedSeconds);
    if (!group.visible) return;

    // The hole's own slow turn, independent of the star's wind-up — it is a different object and by the
    // time it exists the star is gone.
    if (blackHoleLoaded) {
      blackHoleSpinner.rotation.y +=
        THREE.MathUtils.degToRad(BLACKHOLE_SPIN_DEGREES_PER_SECOND) * deltaSeconds;
    }
    // Turbulence shimmer only — the disc's STRUCTURE is a closed-form function of the sequence, which is
    // what lets the whole finale rewind exactly.
    accretionMaterial.uniforms.uTime.value = elapsedSeconds;

    // The star winds up as it contracts — conservation of angular momentum. Applied here rather than in
    // applyFinale because this is where the rotation accumulates.
    const spinRate = COLLAPSE_ROTATE_DEGREES_PER_SECOND * spinMultiplier;
    const flareRate = COLLAPSE_FLARE_SPIN_DEGREES_PER_SECOND * spinMultiplier;
    spinner.rotation.y += THREE.MathUtils.degToRad(spinRate) * deltaSeconds;
    const flareDelta = THREE.MathUtils.degToRad(flareRate) * deltaSeconds;
    flareSpins.forEach((spin) => {
      spin.angle += flareDelta;
      scratchSpin.setFromAxisAngle(spin.axis, spin.angle);
      spin.mesh.quaternion.copy(spin.base).multiply(scratchSpin);
    });

    // The burst is light on the lens, not an object in the room — so it always faces the viewer, however
    // far the visitor has dragged the camera round. (The lab never needed this: its camera is fixed
    // facing the star, so a world-space quad happened to read correctly there and would sit edge-on here.)
    burstMesh.quaternion.copy(camera.quaternion);

    // Both eruption ramps held at 1: these rings are not forming, they are already formed — the star
    // threw them off two sections ago. `presence` rides the master fade instead, so they arrive with
    // the star rather than bursting out of it a second time.
    //
    // The finale then takes them with it. Faded on the master rather than the form ramps on purpose:
    // winding the form back down would sweep every grain home into the launch knot and sink it into the
    // star, which is the eruption played backwards — not a disc being consumed.
    rings?.update(elapsedSeconds, 1, 1, presence * (1 - collapseAmount));

    // The burning surface, churning. ⚠ Both ramps pinned at 1 for the same reason the rings' are: this
    // star ARRIVES already collapsed — the works section carried the hero sun into that pose, which is
    // what the COLLAPSE_* block above mirrors — so its surface is at its hottest and most violent from
    // the first frame. The finale's own additions, the fade and the redshift, are applied in
    // `applyFinale`, which owns everything keyed to the sequence.
    plasma?.update(elapsedSeconds, 1, 1);
  };

  const dispose = () => {
    disposed = true;
    modelRoot?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      meshMaterials.forEach((material) => material.dispose());
    });
    blackHoleRoot?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      meshMaterials.forEach((material) => material.dispose());
    });
    rings?.dispose();
    plasma?.dispose();
    accretionGeometry.dispose();
    accretionMaterial.dispose();
    burstMesh.geometry.dispose();
    burstMaterial.dispose();
    // No dracoLoader.dispose() — it is shared and page-lifetime (see lib/modelLoading.ts).
  };

  return {
    group,
    isReady: () => ready,
    setPresence,
    setArmed,
    update,
    /**
     * Three things move this, and they compose in this order: the star's arrival lifts the field's
     * resting bloom to CONTACT_BLOOM_STRENGTH; the formed hole then settles it back down (its disc is
     * bright on its own by then, and a hot bloom on it just hazes the horizon); and the flash spikes
     * above whatever that resolves to.
     */
    bloomStrength: (fieldBase) =>
      THREE.MathUtils.lerp(
        fieldBase,
        THREE.MathUtils.lerp(CONTACT_BLOOM_STRENGTH, BLACKHOLE_BLOOM_STRENGTH, horizonForm),
        presence,
      ) +
      screenPulse * FLASH_BLOOM_BOOST,
    // Already scaled by the pulse and the reduced-motion damping, so the field only has to add it.
    exposureBoost: () => screenPulse * FLASH_EXPOSURE_BOOST,
    lensing: () => lensingState,
    setDive: (progress) => {
      dive = THREE.MathUtils.clamp(progress, 0, 1);
    },
    reset: () => {
      // Snap, do not ease. The rewind exists for a visitor scrolling back OUT of contact, where the
      // star un-dying is the point; here the page has already jumped and nobody may see it happen.
      dive = 0;
      armed = false;
      armDelayRemaining = 0;
      sequence = 0;
      presence = 0;
      applyFinale();
      lensingState.strength = 0;
    },
    dispose,
  };
}
