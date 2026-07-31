import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * The camera feed's instrument frame.
 *
 * ── What it is for ───────────────────────────────────────────────────────────────────────────────
 * The works section already behaves like a remote camera — you pan it (drag-to-look), its lens zooms
 * shot to shot (36–46° authored per stop), it streaks under acceleration. It has simply never said so,
 * which is why the chamber reveal reads as a rug-pull. These readouts say it, and the reveal turns
 * into a payoff: you were the operator all along.
 *
 * Every number here is TRUE — read off the live camera, never invented. That is the rule that keeps
 * `HeroInstruments` from being set dressing, and it holds here.
 *
 * ── Why it is drawn into the SPACE stage ─────────────────────────────────────────────────────────
 * Because it has to ride onto the chamber's display with the picture it belongs to. A DOM HUD would
 * stay stuck on the glass while the feed shrank away into the room, which is exactly backwards.
 *
 * ── Why a pass, and why AFTER the bloom ──────────────────────────────────────────────────────────
 * Drawn as a mesh in the scene it would go through `UnrealBloomPass`, and the accent (#00e5ff, linear
 * max 1.0) is far over the pass's 0.6 threshold, so every hairline and every glyph would smear. The
 * alternative is grading the whole HUD to sit under the threshold — the dance that made
 * `sunBackdrop`'s shader complicated, and it would cap the accent's brightness forever. Composited
 * after bloom, this is exactly the colours authored, and glow stays available as a deliberate choice.
 *
 * ── Why a 2D canvas rather than geometry ─────────────────────────────────────────────────────────
 * It is text and hairlines, which Canvas2D does well and WebGL does badly. The upload cost that made
 * this approach wrong for the sun is fine here for the opposite reason: the sun changes every frame,
 * so it needed a full upload every frame; these values change a few times a second, and the texture is
 * only re-uploaded when one of them actually differs.
 */

// ── Layout, in design pixels. The canvas is drawn at this height and scaled to the viewport, so a
//    readout is the same size relative to the frame on every screen. ──
//
// Sized LARGE on purpose. The frame only ever appears while the display is shrinking away across the
// room (see the fade window in useWorksField), so it is read at a fraction of full size almost
// immediately — anything scaled for a full-bleed viewport is illegible by the time it is actually on
// screen. These are roughly 2.4% of frame height, where a conventional HUD label would be ~1.3%.
const DESIGN_HEIGHT = 900;
const MARGIN_X = 80;
const MARGIN_Y = 72;
const LABEL_SIZE = 34;
const VALUE_SIZE = 38;
const LETTER_SPACING = 3.8;
const ROW_GAP = 44;
/** The small square that opens a readout group — the site's existing "live channel" mark. */
const BULLET_SIZE = 13;
const BULLET_GAP = 26;

// ── Fitting a fixed layout into a frame of any shape ──
// The canvas is DESIGN_HEIGHT tall and as wide as the aspect makes it, so a portrait phone hands this
// a frame roughly 420 design px across — a quarter of the 16:9 width these sizes were drawn for. At
// full size the bottom row alone would run off both edges. Two defences, in order:
//   1. a gentle scale on the frame's width, floored so the frame never shrinks back to illegible
//   2. dropping whole readout groups that still do not fit (see `fitGroups`)
// Together they keep the type large where there is room and merely sparser where there is not, rather
// than shrinking everything toward unreadable on the screens that can least afford it.
const REFERENCE_DESIGN_WIDTH = 1600; // 16:9 at DESIGN_HEIGHT
const MIN_LAYOUT_SCALE = 0.62;
/**
 * Ceiling on the canvas's backing store, as a multiple of the design size.
 *
 * The frame is redrawn only when a readout changes, so the cost here is memory and upload size rather
 * than per-frame work — but a 4K screen at ratio 2 would ask for a canvas around 7700px wide, and
 * uploading that on the heaviest scene on the site is not worth crispness nobody can see.
 */
const MAX_RENDER_SCALE = 2.5;

// The tokens from globals.css. Duplicated as literals because a canvas cannot read a CSS variable;
// keep them in step with :root.
//
// ⚠ The accent is the SUN's amber, NOT the brand cyan. globals.css:14-19 sets that split out: the
// star's palette belongs to anything reading as lit by it, and cyan stays with the navbar, the fleet
// and the deck. This frame is the last thing the visitor sees before the star's own section, it sits
// on a display in a room lit by that star, and the mark it is framing already burns amber — a cyan
// instrument here would be the one cold thing in a warm picture.
const COLOR_VALUE = 'rgba(235, 232, 224, 0.92)'; // --fg
const COLOR_LABEL = 'rgba(235, 232, 224, 0.42)'; // --muted, lifted slightly for the smaller on-screen size
const COLOR_ACCENT = '#ff8a1a'; // --sun-accent
const COLOR_ACCENT_HOT = '#ffcd8c'; // --sun-accent-bright, for a value that is actively moving
const COLOR_RULE = 'rgba(235, 232, 224, 0.14)';

/** Hairline rules bracketing the top and bottom rows — the frame that makes it read as an instrument. */
const RULE_WIDTH = 2;
const RULE_LENGTH = 120;

// ── Deriving a focal length from the camera ──
// The works camera authors a VERTICAL field of view per stop. A full-frame sensor is 24mm tall, so the
// equivalent focal length is half that over the tangent of the half-angle. At the authored 36–46° this
// yields ~28–37mm, which is a real and readable range for the kind of shot each stop is framed as —
// the readout is the lens the visitor is actually looking through.
const SENSOR_HALF_HEIGHT_MM = 12;

/** Everything the frame draws. All of it read from live state; none of it authored copy. */
export interface WorksHudState {
  /** 1-based, to match the counter the visitor already sees. */
  feedIndex: number;
  feedTotal: number;
  /** The camera's live vertical field of view, in degrees — converted to a focal length for display. */
  fovDegrees: number;
  /** Drag-to-look, in radians, as the scene holds them. */
  panRadians: number;
  tiltRadians: number;
  /** Mid-hop between two projects. */
  slewing: boolean;
  /**
   * Stops, below nominal. The reveal's turn away from the star is the camera protecting its sensor,
   * and this is that decision made visible — which is what turns the sun's fade from a cheat into the
   * instrument doing its job.
   */
  exposureStops: number;
}

/**
 * The warning that arrives with the frame.
 *
 * The single most useful thing the instrument can say, because it explains the move the visitor has
 * just watched without a word of prose: the camera swung off the star and stopped down because a star
 * is what a sensor cannot look at. It is stated as a fault the equipment is REPORTING, not as a
 * caption — which is why it reads as diegetic rather than as a label.
 */
const WARNING_TEXT = 'Sensor flare — source occluded';

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D uHud;
  uniform float uOpacity;
  varying vec2 vUv;

  // The HUD canvas is sRGB-encoded; the space stage is LINEAR (the tone curve and the encode both
  // happen later, in the screen composer's OutputPass). A raw ShaderMaterial gets no automatic
  // conversion, so it is done by hand — the same correction sunBackdrop needed, for the same reason.
  vec3 srgbToLinear(vec3 channel) {
    return mix(
      channel / 12.92,
      pow((channel + 0.055) / 1.055, vec3(2.4)),
      step(0.04045, channel)
    );
  }

  void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    vec4 hud = texture2D(uHud, vUv);
    // Canvas textures arrive premultiplied, so the colour has to be recovered before it can be
    // decoded and then folded back in. Decoding it premultiplied would darken every antialiased edge,
    // which on hairlines and small type is most of the pixels.
    vec3 straight = hud.a > 0.0001 ? hud.rgb / hud.a : vec3(0.0);
    float coverage = hud.a * uOpacity;

    // ⚠ Composite ALPHA as well as colour, and do it premultiplied.
    //
    // The space buffer is NOT opaque — empty space is genuinely transparent, which is the whole reason
    // a DOM sun behind the canvas was ever visible through it. Carrying the base alpha through
    // unchanged would leave every readout drawn over open space at alpha 0: correct colour, invisible.
    // And the buffer holds PREMULTIPLIED colour (the renderer's default), which is the same convention
    // sunBackdrop had to honour — so this is "over" in premultiplied form, not a mix.
    gl_FragColor = vec4(
      srgbToLinear(straight) * coverage + base.rgb * (1.0 - coverage),
      coverage + base.a * (1.0 - coverage)
    );
  }
`;

export interface WorksHud {
  pass: ShaderPass;
  /**
   * Match the canvas to the frame. Call on setup and on resize.
   *
   * `pixelRatio` is the renderer's CURRENT one (adaptive resolution moves it), so the frame is
   * rasterised at the density its texture is actually sampled at rather than at a fixed guess.
   */
  setSize: (viewportWidth: number, viewportHeight: number, pixelRatio: number) => void;
  /** Hand it the live values. Redraws only when one of them actually changed. */
  update: (state: WorksHudState) => void;
  /** 0 hides it entirely AND disables the pass, so it costs nothing outside the works section. */
  setOpacity: (opacity: number) => void;
  dispose: () => void;
}

/**
 * Width of a tracked string without drawing it, so a row can be measured before it is committed.
 *
 * `split('')` rather than a spread: the project targets ES5 downlevel here, and the readouts are
 * ASCII plus a degree sign and a minus, so there are no surrogate pairs to split apart.
 */
function trackedWidth(
  context: CanvasRenderingContext2D,
  text: string,
  letterSpacing: number,
): number {
  const characters = text.toUpperCase().split('');
  return (
    characters.reduce((total, character) => total + context.measureText(character).width, 0) +
    letterSpacing * Math.max(characters.length - 1, 0)
  );
}

/** Uppercased, letter-spaced small caps — the `.eyebrow` treatment, done by hand for canvas. */
function drawTracked(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: 'left' | 'right',
  letterSpacing: number,
): number {
  const characters = text.toUpperCase().split('');
  const width = trackedWidth(context, text, letterSpacing);
  let cursor = align === 'left' ? x : x - width;
  for (const character of characters) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + letterSpacing;
  }
  return width;
}

/** A label and its value, drawn as one unit so a crowded row drops whole groups, never half of one. */
interface ReadoutGroup {
  label: string;
  value: string;
  /** Amber when the value is actively moving; the resting colour otherwise. */
  hot?: boolean;
}

export function createWorksHud(): WorksHud {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.premultiplyAlpha = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uHud: { value: texture },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: FRAGMENT_SHADER,
  });
  pass.enabled = false;

  // next/font generates an opaque family name, so the real one has to be read off the page rather
  // than written here. Canvas needs the resolved family string, not the CSS variable.
  const bodyFontFamily =
    typeof window === 'undefined'
      ? 'sans-serif'
      : window.getComputedStyle(document.body).fontFamily || 'sans-serif';

  let designWidth = DESIGN_HEIGHT;
  /** Device pixels per design pixel — see setSize. 1 until the first real size arrives. */
  let contextScale = 1;
  let opacity = 0;
  let lastSignature = '';
  let fontsReady = false;
  // Drawn in a fallback face and never redrawn would leave the frame in the wrong typeface for the
  // session, so the first real draw is forced once the webfont lands.
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.ready.then(() => {
      fontsReady = true;
      lastSignature = '';
    });
  }

  const paint = (state: WorksHudState) => {
    if (!context) return;
    // Clear in DEVICE space, then put the context back into design units for everything below.
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(contextScale, 0, 0, contextScale, 0, 0);

    // Every metric scaled together, so the frame keeps its proportions on any aspect.
    const scale = Math.max(
      MIN_LAYOUT_SCALE,
      Math.min(1, designWidth / REFERENCE_DESIGN_WIDTH),
    );
    const marginX = MARGIN_X * scale;
    const marginY = MARGIN_Y * scale;
    const labelSize = LABEL_SIZE * scale;
    const valueSize = VALUE_SIZE * scale;
    const tracking = LETTER_SPACING * scale;
    const rowGap = ROW_GAP * scale;
    const bulletSize = BULLET_SIZE * scale;
    const bulletGap = BULLET_GAP * scale;

    const right = designWidth - marginX;
    const top = marginY;
    const bottom = DESIGN_HEIGHT - marginY;
    const labelFont = `500 ${labelSize}px ${bodyFontFamily}`;
    const valueFont = `500 ${valueSize}px ${bodyFontFamily}`;

    /**
     * Measure a run of label/value pairs, then drop them from the END until it fits.
     *
     * The rightmost groups are the least load-bearing by construction — the row is ordered so the
     * thing that identifies the shot comes first and the fine detail comes last. So a narrow frame
     * loses TILT, then PAN, and keeps LENS, rather than shrinking every readout toward unreadable on
     * exactly the screens with the least room to spare.
     */
    const fitGroups = (groups: ReadoutGroup[], available: number): ReadoutGroup[] => {
      const measure = (candidates: ReadoutGroup[]) =>
        candidates.reduce((total, group, index) => {
          context.font = labelFont;
          const label = trackedWidth(context, group.label, tracking);
          context.font = valueFont;
          const value = trackedWidth(context, group.value, tracking);
          return total + label + bulletGap + value + (index > 0 ? rowGap : 0);
        }, 0);
      const fitted = groups.slice();
      while (fitted.length > 1 && measure(fitted) > available) fitted.pop();
      return fitted;
    };

    const drawGroups = (groups: ReadoutGroup[], startX: number, baseline: number) => {
      let cursor = startX;
      groups.forEach((group, index) => {
        if (index > 0) cursor += rowGap;
        context.font = labelFont;
        context.fillStyle = COLOR_LABEL;
        cursor += drawTracked(context, group.label, cursor, baseline, 'left', tracking) + bulletGap;
        context.font = valueFont;
        context.fillStyle = group.hot ? COLOR_ACCENT_HOT : COLOR_VALUE;
        cursor += drawTracked(context, group.value, cursor, baseline, 'left', tracking);
      });
    };

    // 1. The hairline brackets. Drawn first so every readout sits on top of them.
    context.fillStyle = COLOR_RULE;
    context.fillRect(marginX, top - rowGap, RULE_LENGTH * scale, RULE_WIDTH * scale);
    context.fillRect(right - RULE_LENGTH * scale, bottom + rowGap, RULE_LENGTH * scale, RULE_WIDTH * scale);
    context.textBaseline = 'alphabetic';

    // 2. Top right FIRST — it is right-aligned and fixed, so the top-left row has to be measured
    //    against whatever it leaves behind.
    context.font = valueFont;
    const slewText = state.slewing ? 'Slewing' : 'Locked';
    context.fillStyle = state.slewing ? COLOR_ACCENT_HOT : COLOR_LABEL;
    const slewWidth = drawTracked(context, slewText, right, top, 'right', tracking);

    // 3. Top left — which feed this is.
    context.fillStyle = COLOR_ACCENT;
    context.fillRect(marginX, top - bulletSize, bulletSize, bulletSize);
    const rowStart = marginX + bulletSize + bulletGap;
    const feedValue = `${String(state.feedIndex).padStart(2, '0')} / ${String(state.feedTotal).padStart(2, '0')}`;
    drawGroups(
      fitGroups([{ label: 'Feed', value: feedValue }], right - slewWidth - rowGap - rowStart),
      rowStart,
      top,
    );

    // 4. Bottom right, then bottom left — same ordering, same reason.
    const stoppedDown = state.exposureStops > 0.05;
    const exposureText = stoppedDown ? `−${state.exposureStops.toFixed(1)} EV` : '0.0 EV';
    context.font = valueFont;
    context.fillStyle = stoppedDown ? COLOR_ACCENT_HOT : COLOR_LABEL;
    const exposureValueWidth = drawTracked(context, exposureText, right, bottom, 'right', tracking);
    context.font = labelFont;
    context.fillStyle = COLOR_LABEL;
    const exposureLabelWidth = drawTracked(
      context,
      'Exp',
      right - exposureValueWidth - bulletGap,
      bottom,
      'right',
      tracking,
    );

    // 5. The warning, centred under the top row — the one line that explains the move you just saw.
    //    Shown only while the feed is actually stopped down, so it arrives with the frame, sits through
    //    the recovery, and clears itself the moment the exposure is back. Nothing announces its exit.
    if (stoppedDown) {
      context.font = `500 ${labelSize}px ${bodyFontFamily}`;
      context.fillStyle = COLOR_ACCENT_HOT;
      const warningWidth = trackedWidth(context, WARNING_TEXT, tracking);
      const warningX = designWidth / 2 - warningWidth / 2;
      const warningY = top + rowGap * 2;
      // The bullet doubles as the alert mark — the same square that opens every other group, so the
      // warning reads as part of the instrument rather than as something bolted onto it.
      context.fillRect(warningX - bulletGap - bulletSize, warningY - bulletSize, bulletSize, bulletSize);
      drawTracked(context, WARNING_TEXT, warningX, warningY, 'left', tracking);
    }

    // 6. Bottom left — the lens, and where the head is pointing.
    context.fillStyle = COLOR_ACCENT;
    context.fillRect(marginX, bottom - bulletSize, bulletSize, bulletSize);
    const focalMm = Math.round(
      SENSOR_HALF_HEIGHT_MM / Math.tan(THREE.MathUtils.degToRad(state.fovDegrees) / 2),
    );
    const formatAngle = (radians: number) => {
      const degrees = THREE.MathUtils.radToDeg(radians);
      return `${degrees >= 0 ? '+' : '−'}${Math.abs(degrees).toFixed(1)}°`;
    };
    const exposureBlock = exposureValueWidth + exposureLabelWidth + bulletGap;
    drawGroups(
      fitGroups(
        [
          { label: 'Lens', value: `${focalMm}mm` },
          { label: 'Pan', value: formatAngle(state.panRadians) },
          { label: 'Tilt', value: formatAngle(state.tiltRadians) },
        ],
        right - exposureBlock - rowGap - rowStart,
      ),
      rowStart,
      bottom,
    );

    texture.needsUpdate = true;
  };

  return {
    pass,
    setSize: (viewportWidth, viewportHeight, pixelRatio) => {
      if (viewportWidth <= 0 || viewportHeight <= 0) return;
      // Fixed design HEIGHT, width follows the aspect — so the readouts stay a constant size relative
      // to the frame and simply sit further apart on a wider screen, rather than stretching.
      designWidth = Math.round(DESIGN_HEIGHT * (viewportWidth / viewportHeight));

      // ── Draw at the resolution the texture is actually SAMPLED at ──
      // The layout is authored against a 900-tall frame, but the quad this lands on covers the whole
      // composer buffer, which on a retina screen is the viewport times the render scale. Authoring
      // height and rasterising height are therefore different numbers: at 900 the type was being
      // upscaled roughly 2x at the exact moment the frame appears, and small text does not survive
      // that. So the backing store is sized to the real device pixels and the context is scaled by
      // the same factor, which leaves every measurement in `paint` in design units.
      const renderScale = THREE.MathUtils.clamp(
        (viewportHeight * pixelRatio) / DESIGN_HEIGHT,
        1,
        MAX_RENDER_SCALE,
      );
      const backingWidth = Math.round(designWidth * renderScale);
      const backingHeight = Math.round(DESIGN_HEIGHT * renderScale);
      if (canvas.width === backingWidth && canvas.height === backingHeight) return;
      canvas.width = backingWidth;
      canvas.height = backingHeight;
      // Assigning either dimension resets the 2D context entirely, so the scale has to be re-applied.
      // Done in `paint` rather than here, because that is the only place that knows it is about to draw.
      contextScale = renderScale;
      lastSignature = ''; // resizing clears the canvas, so the next update has to repaint
    },
    update: (state) => {
      if (opacity <= 0.001) return;
      // Redraw only on a value the frame can actually show — the raw floats change every frame while
      // the look-offset eases, and repainting a canvas for a change of a hundredth of a degree would
      // be an upload per frame for no visible difference.
      const signature = [
        fontsReady,
        state.feedIndex,
        state.feedTotal,
        Math.round(SENSOR_HALF_HEIGHT_MM / Math.tan(THREE.MathUtils.degToRad(state.fovDegrees) / 2)),
        THREE.MathUtils.radToDeg(state.panRadians).toFixed(1),
        THREE.MathUtils.radToDeg(state.tiltRadians).toFixed(1),
        state.slewing,
        state.exposureStops.toFixed(1),
      ].join('|');
      if (signature === lastSignature) return;
      lastSignature = signature;
      paint(state);
    },
    setOpacity: (next) => {
      opacity = next;
      pass.uniforms.uOpacity.value = next;
      pass.enabled = next > 0.001;
    },
    dispose: () => {
      texture.dispose();
      pass.dispose?.();
    },
  };
}
