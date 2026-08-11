/**
 * The vessel, as nine parts and four waves.
 *
 * `public/models/vessel.glb` ships as nine named nodes, cut out of the export's 39 mesh islands by
 * `scripts/buildVessel.mjs`. This file says what each one MEANS: which service brings it, where it
 * waits before it does, how it drifts while it waits, and — the part that makes the assembly read as
 * assembly — which direction it FITS from.
 *
 * ── Why the parts are grouped the way they are ───────────────────────────────────────────────────
 * Each wave is the part of a machine that its service actually is, not an arbitrary quarter of the
 * mesh count:
 *
 *   1 · Web Experiences      THE FRAME          spine + body plates — what everything else mounts to
 *   2 · Mobile Systems       THE REACH          the outer wings — it extends, it goes further
 *   3 · Enterprise Platforms THE POWER          the nacelles — throughput, "gravity for your pipeline"
 *   4 · Artificial Intelligence  THE INTELLIGENCE   the core — and the ignition
 *
 * ⚠ Wave 4 is 83 triangles a side, and that is deliberate. It is not carrying mass, it is carrying the
 * FINALE: the last pieces lock and the light runs outward from them through the whole hull.
 *
 * ── The holding ring ─────────────────────────────────────────────────────────────────────────────
 * A part that is not yet attached waits on a ring measured in fractions of the LIVE frame (see
 * deckFrame.ts), so the same authored angle puts it round the side of a desktop and over the top of a
 * phone. Mirror pairs are authored on opposite sides on purpose — a pair converging from the two edges
 * of the screen and meeting on the centreline is the read this whole model was chosen for.
 *
 *                    ·w3L        w1R·                 90° = straight up, measured from the
 *              ·w1L                    ·w3R           camera's aim line at the part's own depth
 *          ·w2L          ╱▔╲              ·w2R
 *              ·w4L     ▟ ╲╱ ▙       ·w4R             radius < 1 → inside the frame
 *                        ·w1S                         radius > 1 → just outside it
 */

/** How a loose part waits, how it travels, and how it seats. */
export interface VesselPart {
  /** The node name in vessel.glb. Must match exactly — the deck fails loudly if one is missing. */
  node: string;
  /** 1–4; indexes DECK_SERVICES, and picks the circuit colour this part wears. */
  wave: number;

  // ── Where it waits ──
  /** Degrees round the holding ring. 0 = screen-right, 90 = up, 180 = screen-left. */
  holdAngle: number;
  /** Ring radius as a fraction of the frame's half-extent at this part's depth. */
  holdRadius: number;
  /** World z the part waits at. Negative is behind the stage — a spread here is what makes the
   *  swarm read as a cloud with depth rather than as a flat hoop drawn round the ship. */
  holdDepth: number;

  // ── How it drifts while it waits ──
  /** Two axes for the tumble. Real debris PRECESSES; one axis at a constant rate reads as a prop. */
  tumbleAxis: [number, number, number];
  tumbleAxisB: [number, number, number];
  /** Radians per second of the primary tumble. Slow — this is debris in vacuum. */
  tumbleSpeed: number;
  /** Phase offset for the drift, so nine parts don't breathe in unison. */
  driftPhase: number;

  // ── How it travels ──
  /**
   * The direction the part comes FROM on its final approach, in ship space (normalised on load).
   *
   * ⚠ THIS IS THE ONE THAT MATTERS. Homing straight at a socket makes a part ARRIVE AT its position;
   * running the last stretch along the axis it actually mounts on makes it FIT INTO it. A wing slides
   * inboard, the nacelles come down onto the body, the core slots forward like a cartridge. It is the
   * single biggest difference between this reading as assembly and reading as things flying together.
   */
  approachFrom: [number, number, number];
  /** How far out along that axis the approach begins, in stage units (the hull is 2.3 across). */
  approachDistance: number;
  /**
   * Which way the part sweeps out of its holding pose: +1 / −1 round the ring.
   *
   * The swing control point is TANGENTIAL to the ring rather than pointing at the ship, so a part
   * curves around into frame instead of diving at the centre. Derived from the live holding position,
   * so it stays correct at every aspect for free — only the sign is authored, and mirror pairs get
   * opposite signs so they sweep symmetrically.
   */
  swing: number;
  /** How far that swing pushes, as a fraction of the total travel distance. 0 = a straight line. */
  arc: number;
  /**
   * What fraction of its wave's quarter the travel occupies. Default 1 — the part is still flying right
   * up to its stop.
   *
   * ⚠ Wave 4 sets this SHORT (0.6) so its parts lock well before the quarter ends, which is what
   * leaves room for the ignition to happen AFTER the last piece is in rather than over the top of it
   * arriving. `createVesselAssembly` derives the ignition's start from this, so the two cannot drift.
   */
  travelSpan?: number;
  /**
   * When this part flies, within its wave's quarter: 0 leaves with the wave, 0.3 a third of the way in.
   * The stagger eats into the travel, so the wave always completes on its stop.
   *
   * ⚠ Mirror pairs share a stagger deliberately. Both halves reaching the centreline on the same frame
   * is the beat of the whole section; cascading them would throw it away for variety nobody asked for.
   */
  stagger: number;
}

/**
 * ⚠ Radii are deliberately below 1 on most parts. The ask was parts VISIBLY floating, and a ring
 * entirely outside the frame shows an empty stage — the whole first stop would be one lonely spine.
 * These sit at the edges with their silhouettes breaking into shot, and the idle drift carries them
 * across the boundary.
 */
export const VESSEL_PARTS: VesselPart[] = [
  // ── Wave 1 · THE FRAME ──
  // The spine comes up from below and behind rather than round a side: it is the keel, and it should
  // read as the ship being laid down on a slipway, not as another piece of debris arriving.
  {
    node: 'w1_spine',
    wave: 1,
    holdAngle: 268,
    holdRadius: 0.92,
    holdDepth: -5.5,
    tumbleAxis: [0.2, 1, 0.1],
    tumbleAxisB: [1, 0.15, -0.3],
    tumbleSpeed: 0.16,
    driftPhase: 0,
    approachFrom: [0, -1, 0.15],
    approachDistance: 0.3,
    swing: 1,
    arc: 0.34,
    stagger: 0,
  },
  // The plates close onto the spine from either side — so they approach along ±x, level, and the pair
  // meets on the centreline.
  {
    node: 'w1_body_left',
    wave: 1,
    holdAngle: 158,
    holdRadius: 0.86,
    holdDepth: -2.2,
    tumbleAxis: [0.3, 0.6, 1],
    tumbleAxisB: [1, -0.2, 0.4],
    tumbleSpeed: 0.21,
    driftPhase: 1.1,
    approachFrom: [-1, 0.12, 0],
    approachDistance: 0.28,
    swing: 1,
    arc: 0.4,
    stagger: 0.24,
  },
  {
    node: 'w1_body_right',
    wave: 1,
    holdAngle: 22,
    holdRadius: 0.86,
    holdDepth: -2.2,
    tumbleAxis: [-0.3, 0.6, 1],
    tumbleAxisB: [-1, -0.2, 0.4],
    tumbleSpeed: 0.21,
    driftPhase: 1.1 + Math.PI,
    approachFrom: [1, 0.12, 0],
    approachDistance: 0.28,
    swing: -1,
    arc: 0.4,
    stagger: 0.24,
  },

  // ── Wave 2 · THE REACH ──
  // Widest parts, held widest — they sweep in from beyond the frame edges, which is the one moment the
  // section uses the full width of the screen. Longest slide of the four: a wing seating on its mount.
  {
    node: 'w2_wing_left',
    wave: 2,
    holdAngle: 196,
    holdRadius: 1.04,
    holdDepth: -3.4,
    tumbleAxis: [0.1, 1, 0.35],
    tumbleAxisB: [0.9, 0.1, -0.4],
    tumbleSpeed: 0.14,
    driftPhase: 2.4,
    approachFrom: [-1, 0, -0.1],
    approachDistance: 0.42,
    swing: 1,
    arc: 0.46,
    stagger: 0,
  },
  {
    node: 'w2_wing_right',
    wave: 2,
    holdAngle: 344,
    holdRadius: 1.04,
    holdDepth: -3.4,
    tumbleAxis: [-0.1, 1, -0.35],
    tumbleAxisB: [-0.9, 0.1, -0.4],
    tumbleSpeed: 0.14,
    driftPhase: 2.4 + Math.PI,
    approachFrom: [1, 0, -0.1],
    approachDistance: 0.42,
    swing: -1,
    arc: 0.46,
    stagger: 0,
  },

  // ── Wave 3 · THE POWER ──
  // The heaviest pair, held high and wide so they come DOWN onto the frame, and approaching from above
  // for the same reason: weight wants to arrive downward, and a nacelle is lowered onto a hull.
  {
    node: 'w3_engine_left',
    wave: 3,
    holdAngle: 137,
    holdRadius: 0.95,
    holdDepth: -4.6,
    tumbleAxis: [0.45, 0.8, 0.2],
    tumbleAxisB: [-0.6, 0.3, 0.8],
    tumbleSpeed: 0.12,
    driftPhase: 0.6,
    approachFrom: [-0.3, 1, 0],
    approachDistance: 0.32,
    swing: 1,
    arc: 0.38,
    stagger: 0,
  },
  {
    node: 'w3_engine_right',
    wave: 3,
    holdAngle: 43,
    holdRadius: 0.95,
    holdDepth: -4.6,
    tumbleAxis: [-0.45, 0.8, -0.2],
    tumbleAxisB: [0.6, 0.3, 0.8],
    tumbleSpeed: 0.12,
    driftPhase: 0.6 + Math.PI,
    approachFrom: [0.3, 1, 0],
    approachDistance: 0.32,
    swing: -1,
    arc: 0.38,
    stagger: 0,
  },

  // ── Wave 4 · THE INTELLIGENCE ──
  // Small, close, and already half in shot through the whole build — the last pieces are visible on the
  // stage from the beginning, waiting, which is what makes their arrival read as a completion rather
  // than as one more delivery. They slot in from ASTERN along the ship's axis, like a cartridge.
  {
    node: 'w4_core_left',
    wave: 4,
    holdAngle: 232,
    holdRadius: 0.74,
    holdDepth: -1.4,
    tumbleAxis: [0.8, 0.4, 0.45],
    tumbleAxisB: [-0.3, 0.9, -0.3],
    tumbleSpeed: 0.34,
    driftPhase: 3.3,
    approachFrom: [-0.15, 0.1, -1],
    approachDistance: 0.44,
    swing: 1,
    arc: 0.3,
    travelSpan: 0.6,
    stagger: 0,
  },
  {
    node: 'w4_core_right',
    wave: 4,
    holdAngle: 308,
    holdRadius: 0.74,
    holdDepth: -1.4,
    tumbleAxis: [-0.8, 0.4, -0.45],
    tumbleAxisB: [0.3, 0.9, -0.3],
    tumbleSpeed: 0.34,
    driftPhase: 3.3 + Math.PI,
    approachFrom: [0.15, 0.1, -1],
    approachDistance: 0.44,
    swing: -1,
    arc: 0.3,
    travelSpan: 0.6,
    stagger: 0,
  },
];

/** How many waves the build has. Derived, so adding a fifth service and its parts needs no edit here. */
export const VESSEL_WAVE_COUNT = VESSEL_PARTS.reduce(
  (highest, part) => Math.max(highest, part.wave),
  0,
);
