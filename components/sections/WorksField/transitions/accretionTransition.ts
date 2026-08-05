import * as THREE from 'three';
import { createMeteorMaterial } from '../meteorBody';
import { SLATE_600 } from '@/lib/coolPalette';
import { lobeAt, type RockField } from '../markRockField';
import { buildAccretionChunks, type AccretionChunks } from './accretionChunks';
import { createCrystalGeometry, placeAccretionCrystals } from './accretionCrystals';
import {
  ACCRETION_MODE,
  enableCrystalGrowth,
  enableStoneGrowth,
  type CrystalGrowthUniforms,
  type StoneGrowthUniforms,
} from './accretionGrowth';
import {
  clampProgress,
  measureGeometryBytes,
  type MarkTransitionBuildOptions,
  type MarkTransitionStrategy,
  type PreparedMark,
} from './markTransition';

/**
 * ACCRETION — the mark grown out of a seed, then overgrown with geode.
 *
 * ── The beat, from the reference ─────────────────────────────────────────────────────────────────
 * Dark rock veined with amber crystal, and faceted points erupting from its edges and cavities.
 * Crucially the two are SEQUENTIAL, not simultaneous: the body is whole all the way up, and only once
 * the mark has landed do the points grow on the edges.
 *
 * The body's surface is the geode itself (`geode-druse.webp`) rather than the crust around it. It was
 * basalt, on the reading that the mark is stone until the very end — but that made the points arrive as
 * decoration on an unrelated material. Growing them out of a body that is already visibly geode makes
 * them the finish of something rather than an addition to it.
 *
 *   p=0          p≈0.25         p≈0.5          p≈0.78         p=1
 *   the mark     outer stones   two streams    stone whole    geode grown
 *   + geode      let go,        crossing a     — bare rock    on the edges
 *                crystal        swollen core
 *                already gone
 *
 *   ████████      ▙▖   ▗▟        ·  ▟█▙  ·      ████████       ▲█████▲
 *   ██▲  ▲██  ─▶  ▘▝ ●● ▘▝  ─▶  ▝ ·███· ▘  ─▶   ██    ██  ─▶  ██▲  ▲██
 *   ████████      ▛▘   ▝▜        ·  ▜█▛  ·      ████████       ▲█████▲
 *
 * Crystal leaves FIRST on the way out and arrives LAST on the way in, so the mark is only ever seen
 * bare in the middle of a change. That ordering is what makes the geode read as the finish rather than
 * as decoration.
 *
 * ── Three objects, and only two of five drawn at once ────────────────────────────────────────────
 * One stone mesh and one crystal mesh per mark, plus the persistent core. Only the outgoing and
 * incoming marks are visible, so the draw is: 2 stone + 2 crystal + 1 core. Every mark's animation is
 * a vertex shader reading `uProgress` — the CPU writes three uniforms per frame and nothing else.
 */

// ── The core ──
const CORE_DETAIL = 3;
const CORE_SEED = 271;
const CORE_CARVE = 0.34;
const MIN_CARVE_RADIUS = 0.55;
/** Radius before the rest/peak scales act on it, as a share of the mark. */
const CORE_RADIUS_FRACTION = 0.24;

/**
 * The mark's surface: cold fractured rock, carrying no light of its own.
 *
 * It has been all three of the repo's candidates now, and the reasoning that settles it is the
 * reference's: the body is DARK, and every bit of light in the frame comes from the crystal or from
 * what the crystal is growing out of. Both earlier choices fought that.
 *
 *   basalt-magma  a lava network baked into the albedo — the body glowed everywhere by construction,
 *                 and no tint could reach it because the same image drives the emissive map.
 *   geode-druse   bright crystal across most of its area, so the whole mark read as the pocket. It is
 *                 a SUBJECT, and a subject tiled across a surface stops being legible as itself.
 *   black-stone   angular facets, no bright channel at all. The body can finally be a body.
 *
 * ⚠ Still a JPEG, and the only live texture NOT built from `textures-src`. At 70 KB it was never worth
 * the round trip, but that also means it is the one surface here nobody can re-encode — add it to
 * `textures-src` if it ever needs to change.
 */
// Typed as `string` rather than left as a literal: these two are meant to be repointed while authoring,
// and the loader below compares them. Narrowed to literals, that comparison is provably false and the
// compiler rejects it — which would mean deleting a guard that matters the moment they agree again.
const STONE_TEXTURE_PATH: string = '/textures/meteor/black-stone-background-material_1127-22469.jpg';
/**
 * What an opened cavity shows — and now that the body is dark again, this is the whole light source.
 *
 * This is the pairing the reference actually describes: cold rock that OPENS into glowing geode. It
 * briefly matched the surface, which made a cavity a scale change rather than a reveal; against black
 * stone the druse does the job it was picked for.
 */
const CAVITY_TEXTURE_PATH: string = '/textures/geode/geode-druse.webp';
/** Tiles across the core's diameter. The mark's own repeat is authored — see `stoneTextureRepeat`. */
const CORE_TEXTURE_REPEAT = 2;

/**
 * ── Why every colour here is scaled down, and what happens when one isn't ────────────────────────
 *
 * The rig tone-maps with `NeutralToneMapping` (Khronos PBR Neutral), and that operator DESATURATES
 * toward white as a channel is pushed past its knee — see three's `tonemapping_pars_fragment`, which
 * ends `return mix( color, vec3( newPeak ), g )`. So an over-bright amber does not clip to a hotter
 * amber the way a naive filmic curve would; it clips to WHITE. Every look knob in this file was cooled
 * once already on the assumption that brightness clips to saturated orange. It does not, which is why
 * cooling the emissive alone never recovered the colour.
 *
 * The practical rule: keep a lit surface's peak channel under roughly 0.75 in linear and the hue
 * survives intact. Above that it washes, and no amount of emissive tuning brings it back.
 *
 * Two things dominate that budget, and both are ALBEDO rather than emissive — which is why they were
 * missed. `STONE_TINT` already does the job for the basalt. `crystalAlbedo` and `cavityAlbedo` are the
 * same lever for the other two surfaces, and `envIntensity` is the ceiling over all of them.
 */

/**
 * The stone's own look — a cool cast over the rock, not a dimmer on it.
 *
 * It was `#55555a`, roughly a tenth in linear, and that number existed to CRUSH a texture that carried
 * its own fire. Against a rock that is already dark it would take the body to near-black and throw away
 * the facets that are the whole reason this texture was chosen. So it is near-neutral now, and slightly
 * blue — the field's debris runs a cool slate (`meteorMaterial.ts`) for the same reason, which is that
 * a cold body is what makes the amber in the cavities read as heat rather than as the general colour of
 * everything. That cross-reference is now a shared value rather than two files agreeing by comment:
 * both pull from `lib/coolPalette`.
 *
 * `stoneAlbedo` scales it, and is the knob to reach for rather than editing this.
 *
 * ⚠ The grading survives the consolidation: SLATE_600 is ~2% darker than the `#aab2bd` it replaces and
 * its peak channel is scaled by `stoneAlbedo` at 0.2, so it lands nowhere near the ~0.75 linear ceiling
 * the note above sets. If that albedo is ever raised, re-check the peak against that ceiling.
 *
 * ⚠ It reaches the albedo ONLY. `createMeteorMaterial` points `emissiveMap` at the same texture, and the
 * emissive path is `emissive × emissiveIntensity × emissiveMap` — the material's tint is not in it.
 * That mattered enormously with a lava texture; with this one the emissive channel has almost nothing
 * bright to multiply, which is exactly why the body can now be trusted to stay dark.
 */
const STONE_TINT = SLATE_600;

/** Scratch for the stone's albedo scale, so a per-frame tint costs no allocation. */
const STONE_BASE_COLOR = new THREE.Color(STONE_TINT);

/**
 * The crystal's HUE. Its brightness is the `crystalAlbedo` control, not this.
 *
 * At full strength this is linear red 1.0 — a fully saturated maximum-red diffuse, which clips from
 * ordinary lighting before a single unit of emissive is added. The panel used to offer four knobs for
 * the emissive half and none for the albedo, so the one value that was actually blowing the crystal out
 * was never authorable at all.
 */
const CRYSTAL_COLOR = '#ff8a1f';
const CRYSTAL_EMISSIVE_COLOR = '#ff7a2a';
const CRYSTAL_METALNESS = 0;

/** Scratch for the albedo scale, so a per-frame tint costs no allocation. */
const CRYSTAL_BASE_COLOR = new THREE.Color(CRYSTAL_COLOR);

/**
 * Every authored number the accretion mark is built and animated from.
 *
 * These were dragged out on a comparison rig that no longer exists, which is why so many of them carry
 * a paragraph: the value is rarely the interesting part, the reason it is *that* value is. The old
 * "rebuilds" flag each one used to carry is gone with the sliders — nothing changes at runtime now, so
 * everything is applied once at build.
 */
const ACCRETION_TUNING = {
  // ── The stone, cut and roughened. ──
  //
  // ⚠ The size hierarchy is authored HARD: rim stones at the slider's floor, core masses at its
  // ceiling. Fine detail exactly where the eye reads the outline, few large masses behind it. It is
  // also the expensive end of both sliders — see the note on tessellation below.
  rimSpacing: 0.04,
  coreSpacing: 1.2,
  spacingFalloff: 0.33,
  // ⚠ At the floor, and the floor is dense: edge length is `capEdgeFraction × targetSize`, so 0.008 asks
  // for ~0.021 world units on a 2.6 mark, and each subdivision quadruples what that produced. Paired
  // with a 0.04 rim spacing this is by far the heaviest setting in the file. Watch the rig's triangle
  // and build-time read-outs before carrying it into the section.
  capEdgeFraction: 0.008,
  capSubdivisions: 2,
  // Both back on, and this only became authorable once the wall UVs were fixed. While every wall
  // sampled one identical sliver of texture, any displacement read as more of the same banding, so the
  // two were indistinguishable from the bug and got zeroed together chasing it.
  //
  // Pit scale sits at its floor — big slow undulations through the thickness rather than fine noise,
  // which is what keeps this reading as a hewn face and not as sandpaper.
  capAmplitude: 0.03,
  capFrequency: 0.4,
  // Chipping is ON, harder than it ever was — but protection is at 1, and the pair is the whole point.
  //
  // `restPositionOf` damps the in-plane displacement by `1 − protection × rimProximity`, so at
  // protection 1 the silhouette gets NOTHING and the interior gets the full 0.05. The outline stays the
  // mark's own contour, exactly, while the partition inside it is visibly hewn. That is the combination
  // the earlier "clean cut" pass could not reach by moving one slider: it needed both ends at once.
  //
  // The protected band is `rimSpacing × 2` wide — now 0.08, narrow, because the rim stones are fine.
  inPlaneAmplitude: 0.05,
  silhouetteProtection: 1,
  // ⚠ OFF, and this is the one value here with a known failure mode. It exists so neighbouring stones
  // interpenetrate slightly and floating-point error cannot open a hairline crack between them
  // (`accretionChunks` §8). At 0 nothing pushes them together, so seams can show as light leaking
  // through the body. If pinholes appear along the partition at rest, this is the knob — 0.0005 is
  // enough. Deliberate for now: with the faces pitted, visible fracture lines may be wanted.
  chunkInflate: 0,
  // ── The geode. Rebuilds. ──
  // Fewer sites, tighter patches, but six points at each and barely sunk in — clusters that read as
  // distinct druse rather than a trim running the whole outline.
  crystalCoverage: 0.36,
  crystalSiteSpacing: 0.075,
  crystalPatchScale: 1.7,
  crystalCluster: 6,
  crystalLength: 0.17,
  crystalSpread: 0.38,
  // Low: the points stand proud of the stone rather than emerging from it. Raise toward 0.3 if they
  // start reading as perched on the surface instead of grown out of it.
  crystalEmbed: 0.1,
  // ── How dark each surface sits. Live, and the FIRST thing to reach for. ──
  // These are albedo, not glow. See the tone-mapping note above: a surface whose peak channel clears
  // ~0.75 in linear loses its hue to the operator's highlight desaturation, and no emissive knob below
  // can undo that. Every one of these was previously a hardcoded value with no control at all.
  //
  // The probe is the ceiling over all three. RoomEnvironment carries emissive area lights at 50…100, so
  // at full strength it dominates the key light, and leaving these materials at three's default of 1
  // was the single largest reason the whole mark once read as molten.
  //
  // 0.8 is well above the 0.35 the shipped field's rocks use (`createStoneMaterial`, `meteorMaterial`),
  // and that is a deliberate trade rather than a regression: the stone is held down by `stoneAlbedo` at
  // 0.2 instead, so the body stays dark while the crystal and the cavities — which want the specular —
  // get a probe strong enough to shape them. Lower this and the geode goes flat, so lower `stoneAlbedo`
  // with it if the body ever comes up too bright.
  envIntensity: 0.8,
  // Scales STONE_TINT, and it is doing the heavy lifting now — see the probe above. A fifth of the
  // tint, which is what keeps a body lit at 0.8 from reading as a lamp.
  stoneAlbedo: 0.2,
  // ── These two are the reflectivity, and nothing else is ──
  // Roughness at 1 is fully matte: the specular lobe spreads so wide it stops reading as a reflection
  // at all, leaving only the ~4% dielectric Fresnel that every non-metal has. This is the knob that was
  // making the body look wet — at 0.54 against a 0.8 probe, RoomEnvironment's area lights (50…100) come
  // back as a broad gloss, which is exactly what `markChunkMaterial`'s note warns happens below 1.
  //
  // Turning the PROBE down is the wrong fix for it: `envMapIntensity` scales the environment's diffuse
  // and its specular together, so dropping it to kill the sheen also unlights the body. Kill the
  // specular here and let the probe go on doing the lighting.
  stoneRoughness: 1,
  // Was hardcoded at 0.05 by `createMeteorMaterial`, with no control — small, but metalness tints the
  // reflection with the albedo and drops the diffuse, so even a little of it reads as sheen on a dark
  // body. Rock is a dielectric; 0 is the physically honest value and the least reflective one.
  stoneMetalness: 0,
  crystalAlbedo: 0.5,
  cavityAlbedo: 0.48,
  // Tiles of the rock across the mark. The black stone is a SURFACE — its facets are grain, so it wants
  // to tile more often than the druse ever could without turning to noise.
  //
  // Labelled for the surface, not "Geode scale" — the `crystalCoverage`/`crystalSiteSpacing` group
  // already owns "Geode" for the points that grow on the edges, and two knobs reading the same in one
  // panel is how you spend ten minutes dragging the wrong one.
  stoneTextureRepeat: 2.2,
  // ── How hot it burns. Live, and deliberately low: it all lands on top of a bloom pass. ──
  // Nearly off, and it barely matters now — this multiplies the emissive MAP, and the black stone has
  // no bright channel for it to find. That is the point of the texture: the body cannot glow by
  // accident any more, so all the light in the frame has to come from the cavities and the crystal.
  // Raising it warms the facet highlights rather than lighting seams; there are no seams.
  stoneVeinGlow: 0.1,
  // Fewer stones open, but each opens FURTHER and burns brighter — a cavity is now an event on the
  // body rather than a speckle across it. Coverage picks whole stones (see `accretionGrowth`'s hash),
  // so dropping it removes pockets rather than dimming them, which is the read that was wanted.
  cavityCoverage: 0.14,
  // Reaches well in from the outline: a cavity narrower than the druse's own crystal pockets can only
  // ever show a fragment of one, and the texture needs room before it reads as a geode at all.
  cavityWidth: 0.42,
  cavityGlow: 0.8,
  // Tiles of the druse across the mark, independent of the stone's. It sits near the stone's own 2.2
  // rather than far below it — with the cavities now wide and sparse, each one has room for whole
  // pockets without the texture having to be blown up to find them.
  cavityRepeat: 2.05,
  // Held down deliberately: this rides on top of the root multiplier below AND a bloom pass, so the
  // crystal reads as a lit dielectric rather than a bulb. The colour comes from `crystalAlbedo`.
  crystalGlow: 0.36,
  crystalRootGlow: 1.2,
  crystalTipGlow: 0.3,
  // Roughness, not gloss — LOW is shiny. Raised from 0.16, because a near-mirror crystal against the
  // room probe was throwing specular highlights straight through the bloom threshold.
  crystalRoughness: 0.32,
  // OFF. It was the only warm thing in the frame that appeared ONLY while the mark was changing, which
  // is precisely why it had to go: it read as the transition itself glowing rather than as stone seating.
  // `#ffb066` is also the most saturated orange here and it lands on top of the bloom pass, so hundreds
  // of stones crossing the seat band across five staggered waves stopped being sparks and became one
  // orange wash sweeping the mark.
  //
  // Kept as a knob rather than deleted, like `spinTurns` and `shrinkOvershoot` — the gesture is sound at
  // a far lower strength if the growth ever reads as too quiet.
  //
  // ⚠ If you do raise it: `vFlash` does not check `uMode`, so a retracting stone runs growth 1 → 0 and
  // crosses the same band on the way down. The OUTGOING mark sparks as it comes apart, which is an
  // arrival gesture landing on a departure — the same mistake `shrinkOvershoot` was split out to fix.
  flashStrength: 0,
  // ── The break face, molten. Live. See `docs/molten-fracture-plan.md`. ──
  //
  // This is the flash's replacement and it is the same warm colour, so it is worth being explicit about
  // why one was a wash and this is not: `vFlash` was a PER-STONE value applied across the whole stone,
  // so every square millimetre of a seating mark lit at once. This is gated on `aFractureDistance`, so
  // the lit area is a thin band around cut faces — a fraction of the surface, and one whose shape tells
  // you something. Brightness is not what made the flash fail; having nowhere to be was.
  //
  // ⚠ Brightness and hue move TOGETHER here, and pushing one without the other is why this took two
  // passes. `markLabRig` thresholds bloom at 0.6 luminance. A near-white seam clears that easily but has
  // no colour left in it; a saturated orange is what was actually wanted and carries only about 0.45
  // luminance per unit of strength — so darkening the hue COSTS bloom, and the strength has to come up
  // to buy it back. 1.2 against `#ff9a2e` lands just over the threshold with the hue intact.
  //
  // That it is double the previous value and still safe is entirely down to the reach below: a tenth of
  // each stone is roughly a tenth of the area that was lit before, so this is more light per pixel over
  // far fewer pixels. Total light in frame went DOWN.
  moltenStrength: 1.2,
  // A FRACTION of each stone, not world units — 0.1 is a tenth of the way in from its break faces.
  //
  // It was world units and that was the bug: at 0.09 a core mass 1.2 across got the intended thin lip
  // while a rim stone 0.04 across went molten end to end, and since the mark's outline is entirely rim
  // stones, the whole edge lit up. `aFractureDistance` is now normalised per stone, so this reads the
  // same on every one of them regardless of how big it was cut.
  moltenDepth: 0.1,
  // A span of PROGRESS, not seconds — `setTransition` is pure and a timer here would be a second clock.
  // 0.17 is one second at the six-second round trip it was authored on; at the field's `MORPH_SECONDS`
  // of 1.0s the
  // whole transition is a second, so read this as "most of the way" there rather than re-tuning it.
  moltenCool: 0.17,
  moltenLead: 0.08,
  // ── The choreography. Live. ──
  // Retimed so the stone actually has room: it used to grow across 0.38 → 0.80, which is 42% of the
  // timeline for the whole assembly. Retraction now clears earlier and the geode starts later, giving
  // the growth just over half of the run.
  shrinkWindow: 0.42,
  growDelay: 0.26,
  crystalStart: 0.84,
  crystalRetractBy: 0.18,
  /** How a stone arrives: 0 travel · 1 in place · 2 extend · 3 creep. Read by `uArrival`. */
  arrival: 2,
  // Its own control, not the arrival reversed — see `uDeparture`. `Recede` is the storyboard's own
  // answer: the outgoing mark streams back into the core while the incoming one grows out of it, which
  // is what makes the middle of the transition read as two flows crossing rather than as one mark
  // evaporating in place while another swells behind it.
  /** How a stone leaves: 0 recede · 1 in place · 2 collapse · 3 withdraw. Read by `uDeparture`. */
  departure: 0,
  growthSteps: 5,
  growStagger: 0.72,
  shrinkStagger: 0.62,
  crystalStagger: 0.6,
  orderJitter: 0.08,
  overshoot: 1.15,
  // The slam is an ARRIVAL gesture. Sharing it with the retraction made every stone swell past full
  // size just before it vanished, which is most of why the departure looked mushy. Off by default.
  shrinkOvershoot: 0,
  scaleLead: 0.55,
  // 1 means it shrinks across the whole retraction rather than holding full size and blinking out.
  shrinkScaleLead: 1,
  rotateLead: 0.72,
  // Self-rotation, off: a stone spinning on its own axis reads as debris thrown rather than as material
  // placed, and it wastes the one thing a fragment has that a pebble did not — a correct orientation.
  spinTurns: 0,
  // The OTHER rotation, and a different thing: the whole stone swung about the centre as it travels, so
  // the two streams curve past each other. Lowered rather than removed — this is what makes the middle
  // read as two flows instead of one radial burst.
  spiralTurns: 0.14,
  tremorCycles: 2.5,
  tremorAmplitude: 0.035,
  // ── The core. Off — see the note on `setTransition`. Kept as a 0/1 because the shader reads it. ──
  coreVisible: 0,
  baseRestScale: 0.3,
  basePeakScale: 1.15,
};

/** A rock carved by the same lobes as everything else in the field, so the core is visibly a sibling. */
function createCoreGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, CORE_DETAIL);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const direction = new THREE.Vector3();

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    direction.fromBufferAttribute(position, vertex).normalize();
    const displaced =
      1 +
      CORE_CARVE *
        (0.3 * lobeAt(direction, 1.6, CORE_SEED) +
          0.15 * lobeAt(direction, 3.4, CORE_SEED * 2.1) +
          0.06 * lobeAt(direction, 7.1, CORE_SEED * 3.7));
    const radius = Math.max(displaced, MIN_CARVE_RADIUS);
    position.setXYZ(vertex, direction.x * radius, direction.y * radius, direction.z * radius);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function cloneRepeated(texture: THREE.Texture, repeat: number): THREE.Texture {
  const clone = texture.clone();
  clone.needsUpdate = true;
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeat, repeat);
  return clone;
}

function loadTexture(path: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      path,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        resolve(texture);
      },
      undefined,
      () => resolve(null),
    );
  });
}

/** Everything belonging to one mark. */
interface MarkLayer {
  stone: THREE.Mesh;
  stoneUniforms: StoneGrowthUniforms;
  crystal: THREE.InstancedMesh | null;
  crystalUniforms: CrystalGrowthUniforms | null;
  chunks: AccretionChunks;
  bytes: number;
}

/**
 * Longest a sliced build will wait for its next frame before pressing on regardless.
 *
 * rAF is the right yield here — handing the frame to the RENDERER is the entire point — but it is
 * throttled to a near stop in a background tab, and this runs during the loader. Someone who switches
 * tabs mid-load has to come back to a finished page, not to a build that stopped on its second mark.
 */
const BUILD_YIELD_TIMEOUT_MS = 100;

/** Give the browser a frame to paint in. Resolves on the next frame, or on the timeout above. */
function yieldToNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    timer = window.setTimeout(settle, BUILD_YIELD_TIMEOUT_MS);
    requestAnimationFrame(settle);
  });
}

class AccretionTransition implements MarkTransitionStrategy {
  readonly object = new THREE.Group();
  metrics: { buildMilliseconds: number; bufferBytes: number; perMarkBytes: number };

  private readonly marks: PreparedMark[];
  private readonly options: MarkTransitionBuildOptions;

  private readonly stoneTexture: THREE.Texture | null;
  /**
   * The stone surface at the authored repeat, cloned ONCE and shared by every mark.
   *
   * ⚠ It used to be cloned per mark, inside the build loop, with identical arguments every time.
   * `Texture.clone()` shares the `.image` but takes a fresh uuid, and three keys its GPU uploads by
   * uuid — so four marks meant four uploads of the same 1254² image with mips, about 24 MB of VRAM
   * for nothing. The repeat is the only thing a clone was buying, and all four wanted the same one.
   *
   * If a mark ever needs its own repeat, this goes back in the loop — and the disposal below has to
   * go with it.
   */
  private readonly sharedStoneMap: THREE.Texture | null;
  private readonly cavityTexture: THREE.Texture | null;
  private readonly crystalGeometry: THREE.BufferGeometry;
  private readonly core: THREE.Mesh;
  private readonly coreRadius: number;

  private layers: MarkLayer[] = [];
  /** Set by `dispose`, checked by `build` after every yield — the build outlives a fast unmount. */
  private disposed = false;

  constructor(
    marks: PreparedMark[],
    options: MarkTransitionBuildOptions,
    stoneTexture: THREE.Texture | null,
    cavityTexture: THREE.Texture | null,
  ) {
    this.marks = marks;
    this.options = options;
    this.stoneTexture = stoneTexture;
    this.sharedStoneMap = stoneTexture
      ? cloneRepeated(stoneTexture, ACCRETION_TUNING.stoneTextureRepeat)
      : null;
    this.cavityTexture = cavityTexture;
    this.crystalGeometry = createCrystalGeometry();

    this.coreRadius = options.targetSize * CORE_RADIUS_FRACTION;
    const coreMaterial = createMeteorMaterial(
      stoneTexture ? cloneRepeated(stoneTexture, CORE_TEXTURE_REPEAT) : new THREE.Texture(),
      false,
    );
    if (!stoneTexture) {
      coreMaterial.map = null;
      coreMaterial.emissiveMap = null;
    }
    // The same tint the stones get. It was missing, so the core rendered at `createMeteorMaterial`'s
    // undimmed white albedo — a rock an order of magnitude brighter than every stone around it, which
    // is not what "the core is visibly a sibling" was supposed to mean.
    coreMaterial.color.copy(STONE_BASE_COLOR).multiplyScalar(ACCRETION_TUNING.stoneAlbedo);
    coreMaterial.roughness = ACCRETION_TUNING.stoneRoughness;
    coreMaterial.metalness = ACCRETION_TUNING.stoneMetalness;
    coreMaterial.emissiveIntensity = ACCRETION_TUNING.stoneVeinGlow;
    coreMaterial.envMapIntensity = ACCRETION_TUNING.envIntensity;
    this.core = new THREE.Mesh(createCoreGeometry(), coreMaterial);
    // It swells past its resting size at the midpoint, so a sphere fitted to rest would cull it exactly
    // when it matters.
    this.core.frustumCulled = false;
    this.object.add(this.core);

    // Zeroed rather than measured: cutting the marks is NOT done here — it is sliced across frames, and
    // `createAccretionMark` awaits `build()` before handing the strategy over. See the note on `build`.
    this.metrics = { buildMilliseconds: 0, bufferBytes: 0, perMarkBytes: 0 };
  }

  /** The core, as the field every stone is seeded from. Rebuilt per call so a knob can move it. */
  private coreField(): RockField {
    return {
      centre: new THREE.Vector3(0, 0, 0),
      radius: this.coreRadius,
      stretch: new THREE.Vector3(1, 1, 1),
      seed: CORE_SEED,
      carveAmplitude: CORE_CARVE,
    };
  }

  /**
   * Cut every mark. One mark per frame.
   *
   * ⚠ The slicing is the point, not an implementation detail. This is the longest uninterrupted block
   * on the loader and it runs MID-DOWNLOAD, while the wordmark and the sun are on screen and expected to
   * be moving — and triangulating four marks back to back froze all of it at once. Yielding does not
   * make the work cheaper; it turns one visible stop into a stutter, which is the best available
   * without moving the geometry off the main thread altogether.
   *
   * Separate from the constructor for the same reason: it has to be awaited, and `createAccretionMark`
   * does that before handing the strategy over — so nothing outside this module ever sees a half-cut
   * mark, and `setTransition` never has to defend against one.
   */
  async build(): Promise<void> {
    // ⚠ Accumulated per mark, NOT wall clock across the whole loop. The loop yields a frame between
    // marks on purpose (see the note above), so elapsed time here would include ~16 ms of deliberate
    // waiting per mark and report the cut as far more expensive than it is. This is the question the
    // number exists to answer: how long does CUTTING cost. Wall clock is this plus one frame per mark,
    // and the caller can work that out.
    let workMilliseconds = 0;
    this.disposeLayers();

    const baseRock = this.coreField();

    for (let markIndex = 0; markIndex < this.marks.length; markIndex += 1) {
      // Between marks, never before the first: the caller is already awaiting us, so an opening yield
      // would spend a frame buying nothing.
      if (markIndex > 0) await yieldToNextFrame();
      if (this.disposed) return;

      const markStartedAt = performance.now();
      const mark = this.marks[markIndex];
      const chunks = buildAccretionChunks(mark.shapes, mark.flipY, {
        targetSize: this.options.targetSize,
        depth: this.options.depth,
        capEdgeFraction: ACCRETION_TUNING.capEdgeFraction,
        capSubdivisions: ACCRETION_TUNING.capSubdivisions,
        rimSpacing: ACCRETION_TUNING.rimSpacing,
        coreSpacing: ACCRETION_TUNING.coreSpacing,
        spacingFalloff: ACCRETION_TUNING.spacingFalloff,
        chunkInflate: ACCRETION_TUNING.chunkInflate,
        capAmplitude: ACCRETION_TUNING.capAmplitude,
        capFrequency: ACCRETION_TUNING.capFrequency,
        inPlaneAmplitude: ACCRETION_TUNING.inPlaneAmplitude,
        silhouetteProtection: ACCRETION_TUNING.silhouetteProtection,
        baseRock,
        // Per mark, so four marks are not cut identically — and stable, so re-tuning something
        // unrelated never reshuffles the subject being judged.
        seed: 149 + markIndex * 101,
      });

      const stoneMaterial = createMeteorMaterial(
        this.sharedStoneMap ?? new THREE.Texture(),
        false,
      );
      // The throwaway above stands in when the surface failed to load. BOTH channels have to be cleared:
      // an empty Texture has no image, and a material sampling one renders black, which looks exactly
      // like a lighting bug.
      if (!this.stoneTexture) {
        stoneMaterial.map = null;
        stoneMaterial.emissiveMap = null;
      }
      stoneMaterial.color.copy(STONE_BASE_COLOR).multiplyScalar(ACCRETION_TUNING.stoneAlbedo);
      stoneMaterial.roughness = ACCRETION_TUNING.stoneRoughness;
      stoneMaterial.metalness = ACCRETION_TUNING.stoneMetalness;
      stoneMaterial.emissiveIntensity = ACCRETION_TUNING.stoneVeinGlow;
      stoneMaterial.envMapIntensity = ACCRETION_TUNING.envIntensity;
      const stoneUniforms = enableStoneGrowth(stoneMaterial, this.cavityTexture);

      const stone = new THREE.Mesh(chunks.geometry, stoneMaterial);
      // Stones leave their resting bounds entirely during the transition.
      stone.frustumCulled = false;
      this.object.add(stone);

      const { crystal, crystalUniforms, crystalBytes } = this.buildCrystalLayer(chunks, markIndex);

      // Pushed as each mark finishes rather than assigned in one go at the end: a build abandoned
      // part-way through has to leave its finished layers reachable, or `dispose` cannot free their
      // buffers. Nothing is ever left half-built across a yield — the yield is between marks, and one
      // mark is cut start to finish inside a single iteration.
      this.layers.push({
        stone,
        stoneUniforms,
        crystal,
        crystalUniforms,
        chunks,
        bytes: measureGeometryBytes(chunks.geometry) + crystalBytes,
      });
      workMilliseconds += performance.now() - markStartedAt;
    }

    const bufferBytes =
      this.layers.reduce((total, layer) => total + layer.bytes, 0) +
      measureGeometryBytes(this.crystalGeometry) +
      measureGeometryBytes(this.core.geometry);
    this.metrics = {
      buildMilliseconds: workMilliseconds,
      bufferBytes,
      perMarkBytes: Math.round(bufferBytes / Math.max(1, this.layers.length)),
    };
  }

  private buildCrystalLayer(
    chunks: AccretionChunks,
    markIndex: number,
  ): {
    crystal: THREE.InstancedMesh | null;
    crystalUniforms: CrystalGrowthUniforms | null;
    crystalBytes: number;
  } {
    const { matrices, order } = placeAccretionCrystals({
      rimPoints: chunks.rimPoints,
      rimNormals: chunks.rimNormals,
      depth: this.options.depth,
      targetSize: this.options.targetSize,
      siteSpacing: ACCRETION_TUNING.crystalSiteSpacing,
      coverage: ACCRETION_TUNING.crystalCoverage,
      patchScale: ACCRETION_TUNING.crystalPatchScale,
      clusterSize: ACCRETION_TUNING.crystalCluster,
      length: ACCRETION_TUNING.crystalLength,
      lengthJitter: 0.45,
      spread: ACCRETION_TUNING.crystalSpread,
      embed: ACCRETION_TUNING.crystalEmbed,
      seed: 401 + markIndex * 137,
    });

    if (matrices.length === 0) {
      return { crystal: null, crystalUniforms: null, crystalBytes: 0 };
    }

    const crystalMaterial = new THREE.MeshStandardMaterial({
      // Scaled, not raw — see CRYSTAL_COLOR. `THREE.Color` holds linear-sRGB once ColorManagement has
      // converted the hex, so this multiply lands in the space the shader actually reads.
      color: CRYSTAL_BASE_COLOR.clone().multiplyScalar(ACCRETION_TUNING.crystalAlbedo),
      emissive: new THREE.Color(CRYSTAL_EMISSIVE_COLOR),
      emissiveIntensity: ACCRETION_TUNING.crystalGlow,
      roughness: ACCRETION_TUNING.crystalRoughness,
      metalness: CRYSTAL_METALNESS,
      envMapIntensity: ACCRETION_TUNING.envIntensity,
      // Every facet its own plane. A crystal that shades smoothly is a lump, and the facets are the
      // entire reason this reads as mineral.
      flatShading: true,
    });
    const crystalUniforms = enableCrystalGrowth(crystalMaterial);

    const crystal = new THREE.InstancedMesh(
      this.crystalGeometry,
      crystalMaterial,
      matrices.length,
    );
    crystal.frustumCulled = false;
    matrices.forEach((matrix, index) => crystal.setMatrixAt(index, matrix));
    crystal.instanceMatrix.needsUpdate = true;

    // Per-instance growth data. Two floats rather than a CPU-written scale, so the whole crystal layer
    // animates without the main thread touching a buffer.
    const orderArray = new Float32Array(order);
    const jitterArray = new Float32Array(order.length);
    for (let index = 0; index < order.length; index += 1) {
      jitterArray[index] = ((Math.sin(index * 12.9898 + markIndex) * 43758.5453) % 1 + 1) % 1;
    }
    // Instanced attributes live on the geometry, and this geometry is SHARED across marks — so each
    // mark needs its own copy of it rather than fighting over one set of attributes.
    const perMarkGeometry = this.crystalGeometry.clone();
    perMarkGeometry.setAttribute('aOrder', new THREE.InstancedBufferAttribute(orderArray, 1));
    perMarkGeometry.setAttribute(
      'aCrystalJitter',
      new THREE.InstancedBufferAttribute(jitterArray, 1),
    );
    crystal.geometry = perMarkGeometry;

    this.object.add(crystal);
    return {
      crystal,
      crystalUniforms,
      crystalBytes: matrices.length * 17 * 4 + measureGeometryBytes(perMarkGeometry),
    };
  }

  private disposeLayers(): void {
    this.layers.forEach((layer) => {
      this.object.remove(layer.stone);
      layer.chunks.geometry.dispose();
      // NOT `stoneMaterial.map?.dispose()` — the map is `sharedStoneMap`, one texture behind every
      // layer. Freeing it here would pull it out from under the other three materials still using it.
      // It belongs to the strategy's own lifetime; `dispose()` releases it.
      (layer.stone.material as THREE.MeshStandardMaterial).dispose();

      if (!layer.crystal) return;
      this.object.remove(layer.crystal);
      // Cloned per mark, so this one IS ours to dispose — unlike the shared source geometry.
      layer.crystal.geometry.dispose();
      (layer.crystal.material as THREE.MeshStandardMaterial).dispose();
      layer.crystal.dispose();
    });
    this.layers = [];
  }

  /** Push the live choreography numbers onto one mark's uniforms. */
  private applyChoreography(layer: MarkLayer, mode: number): void {
    const stone = layer.stoneUniforms;
    stone.uMode.value = mode;
    stone.uArrival.value = ACCRETION_TUNING.arrival;
    stone.uDeparture.value = ACCRETION_TUNING.departure;
    stone.uGrowDelay.value = ACCRETION_TUNING.growDelay;
    stone.uGrowStagger.value = ACCRETION_TUNING.growStagger;
    stone.uShrinkWindow.value = ACCRETION_TUNING.shrinkWindow;
    stone.uShrinkStagger.value = ACCRETION_TUNING.shrinkStagger;
    stone.uOrderJitter.value = ACCRETION_TUNING.orderJitter;
    stone.uGrowthSteps.value = ACCRETION_TUNING.growthSteps;
    stone.uOvershoot.value = ACCRETION_TUNING.overshoot;
    stone.uShrinkOvershoot.value = ACCRETION_TUNING.shrinkOvershoot;
    stone.uScaleLead.value = ACCRETION_TUNING.scaleLead;
    stone.uShrinkScaleLead.value = ACCRETION_TUNING.shrinkScaleLead;
    stone.uRotateLead.value = ACCRETION_TUNING.rotateLead;
    stone.uSpinTurns.value = ACCRETION_TUNING.spinTurns;
    stone.uSpiralTurns.value = ACCRETION_TUNING.spiralTurns;
    stone.uTremorCycles.value = ACCRETION_TUNING.tremorCycles;
    stone.uTremorAmplitude.value = ACCRETION_TUNING.tremorAmplitude;
    stone.uFlashStrength.value = ACCRETION_TUNING.flashStrength;
    stone.uMoltenStrength.value = ACCRETION_TUNING.moltenStrength;
    stone.uMoltenDepth.value = ACCRETION_TUNING.moltenDepth;
    stone.uMoltenCool.value = ACCRETION_TUNING.moltenCool;
    stone.uMoltenLead.value = ACCRETION_TUNING.moltenLead;
    stone.uCavityWidth.value = ACCRETION_TUNING.cavityWidth;
    stone.uCavityCoverage.value = ACCRETION_TUNING.cavityCoverage;
    stone.uCavityGlow.value = ACCRETION_TUNING.cavityGlow;
    stone.uCavityTint.value = ACCRETION_TUNING.cavityAlbedo;
    // Authored as tiles across the mark, like the basalt's — but the shader reads `vMapUv`, which the
    // basalt's repeat has already scaled. Dividing here is what lets the two be independent numbers in
    // the panel instead of one being expressed as a fraction of the other.
    stone.uCavityUvScale.value =
      ACCRETION_TUNING.cavityRepeat / Math.max(ACCRETION_TUNING.stoneTextureRepeat, 1e-4);

    // Material properties rather than uniforms, so they are set here rather than injected — but they are
    // just as live, which matters because how hot this burns is the hardest thing to judge from a number.
    const stoneMaterial = layer.stone.material as THREE.MeshStandardMaterial;
    stoneMaterial.emissiveIntensity = ACCRETION_TUNING.stoneVeinGlow;
    stoneMaterial.envMapIntensity = ACCRETION_TUNING.envIntensity;
    stoneMaterial.roughness = ACCRETION_TUNING.stoneRoughness;
    stoneMaterial.metalness = ACCRETION_TUNING.stoneMetalness;
    stoneMaterial.color.copy(STONE_BASE_COLOR).multiplyScalar(ACCRETION_TUNING.stoneAlbedo);
    // The repeat is NOT re-applied here any more. It was a live knob when a panel could drag it; now
    // it is a constant, baked into `sharedStoneMap` once at construction. Re-writing it every frame
    // would also mean four layers writing the same value to one shared texture.

    const crystal = layer.crystalUniforms;
    if (!crystal || !layer.crystal) return;
    crystal.uMode.value = mode;
    crystal.uCrystalStart.value = ACCRETION_TUNING.crystalStart;
    crystal.uCrystalStagger.value = ACCRETION_TUNING.crystalStagger;
    crystal.uCrystalRetractBy.value = ACCRETION_TUNING.crystalRetractBy;
    crystal.uRootGlow.value = ACCRETION_TUNING.crystalRootGlow;
    crystal.uTipGlow.value = ACCRETION_TUNING.crystalTipGlow;

    const crystalMaterial = layer.crystal.material as THREE.MeshStandardMaterial;
    crystalMaterial.emissiveIntensity = ACCRETION_TUNING.crystalGlow;
    crystalMaterial.roughness = ACCRETION_TUNING.crystalRoughness;
    crystalMaterial.envMapIntensity = ACCRETION_TUNING.envIntensity;
    crystalMaterial.color.copy(CRYSTAL_BASE_COLOR).multiplyScalar(ACCRETION_TUNING.crystalAlbedo);
  }

  setTransition(fromIndex: number, toIndex: number, progress: number): void {
    const clamped = clampProgress(progress);
    const count = this.layers.length;
    if (count === 0) return;

    const from = Math.max(0, Math.min(count - 1, fromIndex));
    const to = Math.max(0, Math.min(count - 1, toIndex));
    // Sitting still. Handed both roles, a mark would be told to retract and grow at once and would sink
    // below full size in the middle of a transition that is not happening.
    const isStill = from === to;

    this.layers.forEach((layer, index) => {
      const isFrom = index === from;
      const isTo = index === to;
      const visible = isFrom || isTo;
      layer.stone.visible = visible;
      if (layer.crystal) layer.crystal.visible = visible;
      if (!visible) return;

      const mode = isStill
        ? ACCRETION_MODE.settled
        : isTo
          ? ACCRETION_MODE.incoming
          : ACCRETION_MODE.outgoing;
      this.applyChoreography(layer, mode);
      layer.stoneUniforms.uProgress.value = clamped;
      if (layer.crystalUniforms) layer.crystalUniforms.uProgress.value = clamped;
    });

    // ── The core is a FIRST-FORMATION element ──
    // It belongs to the entry — the moment the section arrives and the first mark is grown out of a
    // rock. On every mark→mark change after that it is off, and the stones simply converge on the middle
    // and shrink away while the next mark's spray out of it. Leaving it on for every change would make
    // the same object interrupt the mark four times, and it would have to survive being looked at with
    // no mark around it to hide behind.
    //
    // Nothing else changes when it is hidden: the stones still seed from where its skin WOULD be, so the
    // spiral still has a convergence point and the streams still cross. What goes away is the object,
    // not the geometry it organises.
    this.core.visible = ACCRETION_TUNING.coreVisible > 0.5;
    if (!this.core.visible) return;

    // Only while it is on screen — the core is off by default, and there is no sense pushing three
    // properties a frame at an object nobody is looking at.
    const coreMaterial = this.core.material as THREE.MeshStandardMaterial;
    coreMaterial.emissiveIntensity = ACCRETION_TUNING.stoneVeinGlow;
    coreMaterial.envMapIntensity = ACCRETION_TUNING.envIntensity;
    coreMaterial.roughness = ACCRETION_TUNING.stoneRoughness;
    coreMaterial.metalness = ACCRETION_TUNING.stoneMetalness;
    coreMaterial.color.copy(STONE_BASE_COLOR).multiplyScalar(ACCRETION_TUNING.stoneAlbedo);

    // Swells at the midpoint and returns. A sine rather than a ramp, so the resting scale is reached
    // exactly at both ends and the beat has no corner in it.
    const swell = isStill ? 0 : Math.sin(Math.PI * clamped);
    const scale = THREE.MathUtils.lerp(
      ACCRETION_TUNING.baseRestScale,
      ACCRETION_TUNING.basePeakScale,
      swell,
    );
    this.core.scale.setScalar(this.coreRadius * scale);
  }

  update(): void {
    // Nothing idles — the rig owns the spin, and motion here would be a second clock.
  }

  dispose(): void {
    // Stops a sliced `build()` at its next yield. Whatever it finished before then is in `this.layers`
    // already and is freed by the call below.
    this.disposed = true;
    this.disposeLayers();
    this.crystalGeometry.dispose();
    this.core.geometry.dispose();
    const coreMaterial = this.core.material as THREE.MeshStandardMaterial;
    coreMaterial.map?.dispose();
    coreMaterial.dispose();
    // The one shared across every layer — see `sharedStoneMap`. Freed here rather than in
    // `disposeLayers`, because it outlives any single rebuild of them.
    this.sharedStoneMap?.dispose();
    this.stoneTexture?.dispose();
    // Guarded, because the two roles normally share one image — disposing it twice would free a texture
    // the second reference still thinks it owns.
    if (this.cavityTexture !== this.stoneTexture) this.cavityTexture?.dispose();
  }
}

/**
 * Build the works section's one body.
 *
 * A plain function rather than a registered factory: this was one of four candidates behind a common
 * interface while a lab compared them, and it is the one that shipped. The others are gone, so the
 * indirection has nothing left to abstract over.
 */
export async function createAccretionMark(
  marks: PreparedMark[],
  options: MarkTransitionBuildOptions,
): Promise<MarkTransitionStrategy> {
  // The surface and the cavity are the same geode at two different scales, so this is normally ONE
  // image — loading it per role would put a second copy of it on the GPU for nothing. Still written as
  // two lookups, because pointing the cavity back at the basalt has to keep working (see the paths).
  const sharesOneImage = STONE_TEXTURE_PATH === CAVITY_TEXTURE_PATH;
  const stoneTexture = await loadTexture(STONE_TEXTURE_PATH);
  const cavityTexture = sharesOneImage ? stoneTexture : await loadTexture(CAVITY_TEXTURE_PATH);
  const strategy = new AccretionTransition(marks, options, stoneTexture, cavityTexture);
  // Cutting the marks is sliced across frames, so it is awaited here rather than done in the
  // constructor. Callers get a strategy that is already whole.
  await strategy.build();
  return strategy;
}
