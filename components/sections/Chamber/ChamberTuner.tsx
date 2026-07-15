'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import {
  CHAMBER_TUNING_DEFAULTS,
  getChamberParts,
  getChamberTuning,
  isChamberTuningEnabled,
  resetChamberTuning,
  sendChamberCommand,
  setChamberTuning,
  subscribeChamberTuning,
  type ChamberTuning,
} from '@/lib/chamberTuning';

/**
 * On-screen controls for the chamber reveal — localhost (or `?tune`) only. Renders nothing otherwise.
 *
 * Every number in the reveal was authored without being able to see the scene, so this exists to make
 * them all draggable while it's on screen. The tabs keep each object's controls together: the screen
 * (and the space feed painted on it), and each prop in the set.
 *
 * The control that matters most is **Hold**: the reveal is a committed glide between two scroll stops,
 * so scrolling can only ever leave you at progress 0 or 1 — you cannot stop halfway to look at it. Hold
 * pins it open at any progress and ignores the scroll, so the set stands still while you work on it.
 *
 * It lives outside the 3D scene (which isn't built until the visitor reaches Works) so that it's on
 * screen from the moment the page loads.
 */

type BoolKey = {
  [K in keyof ChamberTuning]: ChamberTuning[K] extends boolean ? K : never;
}[keyof ChamberTuning];
type NumKey = {
  [K in keyof ChamberTuning]: ChamberTuning[K] extends number ? K : never;
}[keyof ChamberTuning];

interface Slider {
  key: NumKey;
  min: number;
  max: number;
  step: number;
  hint?: string;
}

/**
 * The keys a nudge pad drives. Dragging a slider is for finding roughly the right value; these buttons
 * are for landing on it — one click, one step, in a named direction.
 */
interface Nudge {
  x: NumKey;
  y: NumKey;
  z: NumKey;
  /** Rotations, in degrees. Omit an axis the object shouldn't turn on. */
  rotX?: NumKey;
  rotY?: NumKey;
  rotZ?: NumKey;
}

type ColorKey = {
  [K in keyof ChamberTuning]: ChamberTuning[K] extends string ? K : never;
}[keyof ChamberTuning];

interface Tab {
  id: string;
  title: string;
  toggle?: { key: BoolKey; label: string };
  toggle2?: { key: BoolKey; label: string };
  nudge?: Nudge;
  colors?: { key: ColorKey; label: string }[];
  /** A loaded model whose individual meshes can be switched off, and which a drag turns. */
  model?: 'podium' | 'table';
  /** The showcase recorder needs more than sliders. */
  showcase?: boolean;
  /** The ring portal — the hologram's home, so it gets a "put the screen here" of its own. */
  rings?: boolean;
  sliders: Slider[];
}

const MOVE_STEPS = [0.01, 0.05, 0.25, 1];
const TURN_STEPS = [1, 5, 15, 45];

// Placement is the same story for every prop: scale it, move it, turn it. Scale is PER AXIS — that's
// how you make a prop's screen match the render's shape, by stretching the prop rather than distorting
// the picture to fit it.
const placement = (
  prefix: 'podium' | 'table',
  scaleMax: number,
): Slider[] => [
  // The point it scales and turns AROUND. Use "⌖ pin" on a part below to drop it there.
  { key: `${prefix}PivotX` as NumKey, min: -30, max: 30, step: 0.05, hint: 'pivot — the point it turns around' },
  { key: `${prefix}PivotY` as NumKey, min: -30, max: 30, step: 0.05 },
  { key: `${prefix}PivotZ` as NumKey, min: -30, max: 30, step: 0.05 },
  { key: `${prefix}ScaleX` as NumKey, min: 0.01, max: scaleMax, step: 0.01, hint: 'scale each axis on its own — stretch it to fit' },
  { key: `${prefix}ScaleY` as NumKey, min: 0.01, max: scaleMax, step: 0.01 },
  { key: `${prefix}ScaleZ` as NumKey, min: 0.01, max: scaleMax, step: 0.01 },
  { key: `${prefix}X` as NumKey, min: -20, max: 20, step: 0.05 },
  { key: `${prefix}Y` as NumKey, min: -10, max: 15, step: 0.05 },
  { key: `${prefix}Z` as NumKey, min: -20, max: 20, step: 0.05 },
  { key: `${prefix}RotX` as NumKey, min: -180, max: 180, step: 1 },
  { key: `${prefix}RotY` as NumKey, min: -180, max: 180, step: 1 },
  { key: `${prefix}RotZ` as NumKey, min: -180, max: 180, step: 1 },
];

const TABS: Tab[] = [
  {
    // Where the camera ENDS — just a place in the room. Nothing to do with how the display is turned, so
    // aiming the display no longer drags the shot around with it.
    id: 'reveal',
    title: 'Reveal',
    nudge: { x: 'camX', y: 'camY', z: 'camZ' },
    sliders: [
      { key: 'camX', min: -30, max: 30, step: 0.1, hint: 'where you end up standing' },
      { key: 'camY', min: -5, max: 30, step: 0.1 },
      { key: 'camZ', min: -30, max: 30, step: 0.1 },
      // The aim starts locked to the display (it must — that's the seam) and eases off to here. Move it
      // and the reveal can LAND facing the podium instead of the screen.
      { key: 'camTargetX', min: -30, max: 30, step: 0.1, hint: 'what it\'s looking at when it lands' },
      { key: 'camTargetY', min: -10, max: 20, step: 0.1 },
      { key: 'camTargetZ', min: -30, max: 30, step: 0.1 },
      { key: 'easePower', min: 1, max: 5, step: 0.1, hint: 'how much it creeps off the display first' },
    ],
  },
  {
    // The display and the camera are ONE rig — the camera is derived from it, so these move the whole
    // shot together. This is what walks the shot around the set.
    id: 'screen',
    title: 'Screen',
    nudge: { x: 'rigX', y: 'rigY', z: 'rigZ', rotY: 'rigYaw', rotX: 'rigPitch', rotZ: 'rigRoll' },
    sliders: [
      { key: 'rigX', min: -20, max: 20, step: 0.05, hint: 'the display + camera move together' },
      { key: 'rigY', min: 0, max: 15, step: 0.05 },
      { key: 'rigZ', min: -20, max: 20, step: 0.05 },
      { key: 'rigYaw', min: -180, max: 180, step: 1, hint: 'which way it faces' },
      { key: 'rigPitch', min: -90, max: 90, step: 1, hint: 'tilt it up / down' },
      { key: 'rigRoll', min: -90, max: 90, step: 1, hint: 'cant it over — the room straightens as you pull back' },
      { key: 'displayHeight', min: 0.2, max: 8, step: 0.05, hint: 'the meteor feed. width follows the viewport' },
      // Negative values are legal and useful: equal-and-opposite left/right PANS the picture instead of
      // trimming it, and a negative pair widens the window past the render's edge.
      { key: 'cropLeft', min: -0.45, max: 0.45, step: 0.005, hint: 'trim the picture — ramps in as you pull back' },
      { key: 'cropRight', min: -0.45, max: 0.45, step: 0.005 },
      { key: 'cropTop', min: -0.45, max: 0.45, step: 0.005 },
      { key: 'cropBottom', min: -0.45, max: 0.45, step: 0.005 },
    ],
  },
  {
    id: 'podium',
    title: 'Podium',
    toggle: { key: 'showPodium', label: 'show podium' },
    nudge: { x: 'podiumX', y: 'podiumY', z: 'podiumZ', rotX: 'podiumRotX', rotY: 'podiumRotY', rotZ: 'podiumRotZ' },
    model: 'podium',
    // Its raw model is ~41 units across — it carries its own ground plane and a pyramid backdrop — so it
    // wants a small scale.
    sliders: placement('podium', 2),
  },
  {
    // The ring portal as ONE machine: the rings, the turbine in their mouth, and the cabling that feeds
    // them. Move or scale any of it alone and the model comes apart.
    //
    // It has to be liftable without lifting the ground plane it shares a model with — in the model it's
    // half-buried in its own cabling (the cables stand 0.89 tall; the rings start at 0.10), which is what
    // was cutting the bottom off the rings.
    id: 'rings',
    title: 'Portal',
    toggle: { key: 'showRings', label: 'show the ring portal' },
    rings: true,
    nudge: { x: 'ringsX', y: 'ringsY', z: 'ringsZ', rotX: 'ringsRotX', rotY: 'ringsRotY', rotZ: 'ringsRotZ' },
    toggle2: { key: 'paintJoiners', label: 'repaint the joiners too' },
    colors: [
      { key: 'cablesColor', label: 'cable runs' },
      { key: 'joinersColor', label: 'joiners (needs the toggle)' },
    ],
    sliders: [
      // The cables are pure emissive — every light here is at zero — so the strength is what turns the
      // colour back into a light instead of a flat wash.
      { key: 'cablesGlow', min: 0, max: 4, step: 0.05, hint: 'how hard the cable runs glow' },
      { key: 'joinersGlow', min: 0, max: 4, step: 0.05, hint: 'how hard the joiners glow' },
      // Only the CORE ring turns — the outer two, the turbine and the cabling all hold still.
      { key: 'ringsSpin', min: -90, max: 90, step: 1, hint: 'the CORE ring turns on its own axis (°/sec)' },
      { key: 'ringsY', min: -5, max: 10, step: 0.05, hint: 'lift the whole portal — the ground stays put' },
      { key: 'ringsX', min: -10, max: 10, step: 0.05 },
      { key: 'ringsZ', min: -10, max: 10, step: 0.05 },
      { key: 'ringsScale', min: 0.1, max: 4, step: 0.01, hint: 'grows around its own centre' },
      { key: 'ringsRotX', min: -180, max: 180, step: 1 },
      { key: 'ringsRotY', min: -180, max: 180, step: 1 },
      { key: 'ringsRotZ', min: -180, max: 180, step: 1 },
    ],
  },
  {
    id: 'table',
    title: 'Table',
    toggle: { key: 'showTable', label: 'show table' },
    nudge: { x: 'tableX', y: 'tableY', z: 'tableZ', rotX: 'tableRotX', rotY: 'tableRotY', rotZ: 'tableRotZ' },
    model: 'table',
    colors: [{ key: 'tableColor', label: 'table' }],
    sliders: placement('table', 6),
  },
  {
    // Fly a camera around, snapshot the poses you like, play them back. Authoring a move by recording
    // it beats authoring it by guessing coordinates.
    id: 'showcase',
    title: 'Showcase',
    showcase: true,
    nudge: { x: 'scoutX', y: 'scoutY', z: 'scoutZ' },
    sliders: [
      { key: 'flySpeed', min: 0.2, max: 15, step: 0.1, hint: 'WASD speed · hold shift to sprint' },
      { key: 'scoutTargetX', min: -30, max: 30, step: 0.1, hint: 'what it\'s aimed at — drag the scene to aim' },
      { key: 'scoutTargetY', min: -10, max: 20, step: 0.1 },
      { key: 'scoutTargetZ', min: -30, max: 30, step: 0.1 },
      // The TOTAL, not a per-hop time: the whole tour plays off one scroll, so it's one shot with a length.
      { key: 'showcaseSeconds', min: 0.5, max: 12, step: 0.1, hint: 'preview speed only — live tour rides the reveal glide' },
      { key: 'showcaseSway', min: 0, max: 0.3, step: 0.005, hint: 'handheld drift — 0 = a machine on rails' },
      { key: 'returnKeyStart', min: 2, max: 16, step: 1, hint: 'key the WAY OUT starts at — keys before it are the way in' },
      { key: 'returnAimWeight', min: 0, max: 12, step: 0.5, hint: 'way out pace: higher = more time turning, lower = more time walking' },
      { key: 'returnEndEase', min: 1, max: 5, step: 0.1, hint: 'way out landing: 1 = coasts in, higher = softer slow-down at the table' },
      { key: 'returnTurnEnd', min: 0.3, max: 0.95, step: 0.01, hint: 'fallback only (no way-out keys): turn ↔ walk split' },
    ],
  },
  {
    // The FAQ panel floating above the plinth. It's DOM, anchored to a point in the room — so its
    // POSITION is world coordinates, and so are its sizes (they're multiplied by the projected
    // pixels-per-unit at that depth, which is what makes it grow like a real object as you approach).
    // Use ◈ on a part in the Podium tab to drop the anchor into it.
    id: 'hologram',
    title: 'Hologram',
    toggle: { key: 'showHologram', label: 'show the hologram' },
    nudge: { x: 'holoX', y: 'holoY', z: 'holoZ' },
    colors: [
      { key: 'holoTint', label: 'hologram' },
      { key: 'holoFrameColor', label: 'the frames' },
    ],
    sliders: [
      { key: 'holoX', min: -20, max: 20, step: 0.05, hint: 'where it floats — the panel\'s centre' },
      { key: 'holoY', min: -2, max: 12, step: 0.05 },
      { key: 'holoZ', min: -20, max: 20, step: 0.05 },
      { key: 'holoWidth', min: 0.5, max: 10, step: 0.05, hint: 'world units — it grows as you walk up to it' },
      { key: 'holoMaxHeight', min: 0.5, max: 8, step: 0.05, hint: 'past this the content scrolls instead' },
      // Not polish: a projected panel can land unreadably small on a phone. These are the legibility floor.
      { key: 'holoMinWidthPx', min: 200, max: 600, step: 5, hint: 'legibility clamps, in real pixels' },
      { key: 'holoMaxWidthPx', min: 400, max: 1400, step: 10 },
      { key: 'holoFrameHeight', min: 0, max: 1, step: 0.01, hint: 'the black caps — sealed until it opens' },
      { key: 'holoFrameInset', min: -0.5, max: 0.5, step: 0.01, hint: 'how far they overhang the lit area' },
      { key: 'holoOpacity', min: 0, max: 0.5, step: 0.005, hint: 'the cyan wash. it\'s a hologram — keep it faint' },
      { key: 'holoGlow', min: 0, max: 4, step: 0.05 },
      { key: 'holoScanlines', min: 0, max: 1, step: 0.01 },
      { key: 'holoFringe', min: 0, max: 4, step: 0.05, hint: 'chromatic split — "projected light"' },
      { key: 'holoOpenSeconds', min: 0.2, max: 3, step: 0.05, hint: 'the unseal' },
      { key: 'holoRowStagger', min: 0, max: 0.2, step: 0.005 },
      { key: 'holoSwayFollow', min: 0, max: 1, step: 0.02, hint: '1 = rides the camera\'s drift · 0 = holds still' },
    ],
  },
  {
    id: 'light',
    title: 'Light',
    sliders: [
      { key: 'screenLight', min: 0, max: 40, step: 0.5, hint: 'the display lighting the set' },
      { key: 'ambient', min: 0, max: 1, step: 0.01 },
      { key: 'keyLight', min: 0, max: 3, step: 0.05 },
      { key: 'envIntensity', min: 0, max: 1, step: 0.01, hint: 'high = chrome showroom. keep it low.' },
    ],
  },
];

const panelStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  zIndex: 100000, // above everything the site draws (its navbar sits at 9999)
  width: 312,
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  padding: '12px 14px',
  borderRadius: 10,
  background: 'rgba(8, 10, 14, 0.94)',
  border: '1px solid rgba(0, 229, 255, 0.35)',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
  color: '#e6f6ff',
  font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
  backdropFilter: 'blur(6px)',
};

const buttonStyle: CSSProperties = {
  flex: 1,
  padding: '7px 8px',
  borderRadius: 6,
  border: '1px solid rgba(0, 229, 255, 0.4)',
  background: 'rgba(0, 229, 255, 0.12)',
  color: '#bdf0ff',
  cursor: 'pointer',
  font: 'inherit',
};

const numberStyle: CSSProperties = {
  width: 72,
  padding: '2px 4px',
  borderRadius: 4,
  border: '1px solid rgba(255, 255, 255, 0.18)',
  background: 'rgba(255, 255, 255, 0.06)',
  color: '#e6f6ff',
  font: 'inherit',
  textAlign: 'right',
};

export default function ChamberTuner() {
  const [enabled, setEnabled] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('screen');
  const [copied, setCopied] = useState(false);
  // Mirrors the store so the inputs re-render; the SCENE reads the store directly, every frame.
  const [values, setValues] = useState<ChamberTuning>(CHAMBER_TUNING_DEFAULTS);

  useEffect(() => {
    if (!isChamberTuningEnabled()) return;
    setEnabled(true);
    setValues({ ...getChamberTuning() });
    return subscribeChamberTuning(() => setValues({ ...getChamberTuning() }));
  }, []);

  if (!enabled) return null;

  const set = (patch: Partial<ChamberTuning>) => setChamberTuning(patch);

  const copyValues = () => {
    const text = JSON.stringify(getChamberTuning(), null, 2);
    navigator.clipboard?.writeText(text).catch(() => {});
    console.log(`[chamber tuning]\n${text}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const tab = TABS.find((candidate) => candidate.id === activeTab) ?? TABS[0];
  const parts = tab.model ? getChamberParts(tab.model) : [];

  const openTab = (id: string) => {
    setActiveTab(id);
    // A drag in the scene turns whatever's open here — so the podium can be aimed by hand instead of by
    // hunting for numbers. (While the chamber is up, the drag no longer swings the space camera.)
    const model = TABS.find((candidate) => candidate.id === id)?.model;
    set({ dragTarget: model ?? 'none' });
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <strong style={{ color: '#00e5ff', letterSpacing: '0.06em' }}>CHAMBER</strong>
        <button
          type="button"
          onClick={() => setCollapsed((wasCollapsed) => !wasCollapsed)}
          style={{ ...buttonStyle, flex: 'none', padding: '2px 9px' }}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>

      {/* The reveal is a committed glide between two scroll stops — scrolling can only ever land you on
          0 or 1. This is the only way to stop halfway and actually look at it. */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 8px',
          marginBottom: 8,
          borderRadius: 6,
          cursor: 'pointer',
          background: values.holdReveal ? 'rgba(0, 229, 255, 0.18)' : 'rgba(255, 255, 255, 0.05)',
          border: `1px solid ${values.holdReveal ? 'rgba(0,229,255,0.6)' : 'rgba(255,255,255,0.12)'}`,
        }}
      >
        <input
          type="checkbox"
          checked={values.holdReveal}
          onChange={(event) => set({ holdReveal: event.target.checked })}
        />
        <span>
          <strong>HOLD the reveal open</strong>
          <br />
          <span style={{ opacity: 0.6 }}>ignore scroll · scrub it by hand</span>
        </span>
      </label>

      <Row
        label="progress"
        hint={values.holdReveal ? undefined : 'turn HOLD on to use this'}
        min={0}
        max={1}
        step={0.005}
        value={values.revealAt}
        disabled={!values.holdReveal}
        onChange={(revealAt) => set({ revealAt })}
      />

      {/* A frozen reveal isn't moving, so the scene can't tell "going in" from "coming out" — this says
          which one to show. Flip it on and scrub `progress` through the top of the range to tune the way
          out (close → turn → walk); the split itself is `returnTurnEnd` in the Showcase tab. */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          marginBottom: 8,
          borderRadius: 6,
          cursor: values.holdReveal ? 'pointer' : 'default',
          opacity: values.holdReveal ? 1 : 0.4,
        }}
      >
        <input
          type="checkbox"
          disabled={!values.holdReveal}
          checked={values.holdReturning}
          onChange={(event) => set({ holdReturning: event.target.checked })}
        />
        <span>
          view the <strong>way out</strong>
          <br />
          <span style={{ opacity: 0.6 }}>the return: close · turn · walk</span>
        </span>
      </label>

      {!collapsed && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '12px 0 10px' }}>
            {TABS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => openTab(candidate.id)}
                style={{
                  ...buttonStyle,
                  flex: 'none',
                  padding: '4px 8px',
                  opacity: candidate.id === activeTab ? 1 : 0.45,
                  background:
                    candidate.id === activeTab
                      ? 'rgba(0, 229, 255, 0.22)'
                      : 'rgba(255, 255, 255, 0.05)',
                }}
              >
                {candidate.title}
              </button>
            ))}
          </div>

          <div style={{ overflowY: 'auto', paddingRight: 4 }}>
            {tab.toggle && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={values[tab.toggle.key]}
                  onChange={(event) =>
                    set({ [tab.toggle!.key]: event.target.checked } as Partial<ChamberTuning>)
                  }
                />
                <span>{tab.toggle.label}</span>
              </label>
            )}

            {tab.model && (
              <div style={{ opacity: 0.55, marginBottom: 8 }}>
                drag in the scene to turn the {tab.model}
              </div>
            )}

            {tab.showcase && <ShowcaseRecorder values={values} set={set} />}

            {/* The rings are the hologram's home, so put the screen where they ACTUALLY are — including
                wherever this tab has since moved them to. */}
            {tab.rings && (
              <div style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    const rings = getChamberParts('podium').find((part) =>
                      part.label.startsWith('Rings'),
                    );
                    if (rings) sendChamberCommand({ type: 'screen:to-part', partId: rings.id });
                  }}
                  style={{ ...buttonStyle, width: '100%' }}
                >
                  ▣ put the hologram in the rings
                </button>
                <div style={{ opacity: 0.55, marginTop: 4 }}>
                  drops the screen dead centre in the portal, wherever you&apos;ve moved it
                </div>
              </div>
            )}

            {parts.length > 0 && tab.model && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: '#00e5ff', opacity: 0.85, marginBottom: 2 }}>
                  parts ({parts.length})
                </div>
                <div style={{ opacity: 0.55, marginBottom: 6 }}>
                  checkbox hides it · ▣ screen · ◈ hologram · ⌖ pivots on it
                  {tab.model === 'podium' ? ' · the rings have their own tab' : ''}
                </div>
                {parts.map((part) => {
                  const hidden = values.hiddenParts.includes(part.id);
                  return (
                    <div
                      key={part.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, opacity: hidden ? 0.4 : 1 }}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={() =>
                          set({
                            hiddenParts: hidden
                              ? values.hiddenParts.filter((id) => id !== part.id)
                              : [...values.hiddenParts, part.id],
                          })
                        }
                      />
                      <span style={{ flex: 1 }}>{part.label}</span>
                      {/* Put the SCREEN inside this piece — the hologram in the podium's rings, say.
                          Works out where the part actually is in the room, so it lands dead centre in it
                          however the prop has been moved, scaled or turned since. */}
                      <button
                        type="button"
                        title={`put the screen in ${part.label}`}
                        onClick={() =>
                          sendChamberCommand({ type: 'screen:to-part', partId: part.id })
                        }
                        style={{ ...buttonStyle, flex: 'none', padding: '1px 6px' }}
                      >
                        ▣
                      </button>
                      {/* Float the HOLOGRAM above this piece — the plinth is the one you want. Same
                          measure-it-where-it-actually-is trick as the screen, so it lands right however
                          the podium has been moved or scaled since. */}
                      <button
                        type="button"
                        title={`float the hologram above ${part.label}`}
                        onClick={() =>
                          sendChamberCommand({ type: 'holo:to-part', partId: part.id })
                        }
                        style={{ ...buttonStyle, flex: 'none', padding: '1px 6px' }}
                      >
                        ◈
                      </button>
                      {/* Drop the prop's pivot onto this piece — so it scales and turns around the thing
                          you care about, instead of around wherever the model happened to be exported.
                          The prop must NOT move when you do this; only what it turns around changes. */}
                      <button
                        type="button"
                        title={`pivot on ${part.label}`}
                        onClick={() => set(repivot(values, tab.model!, part.center))}
                        style={{ ...buttonStyle, flex: 'none', padding: '1px 6px' }}
                      >
                        ⌖
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {tab.toggle2 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={values[tab.toggle2.key]}
                  onChange={(event) =>
                    set({ [tab.toggle2!.key]: event.target.checked } as Partial<ChamberTuning>)
                  }
                />
                <span>{tab.toggle2.label}</span>
              </label>
            )}

            {/* Multiplies the model's own maps rather than replacing them, so the surface detail
                survives — and it tints the EMISSIVE too, which is what you're actually looking at in a
                set lit entirely by its own glow. */}
            {tab.colors?.map((color) => (
              <label
                key={color.key}
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
              >
                <input
                  type="color"
                  value={values[color.key]}
                  onChange={(event) =>
                    set({ [color.key]: event.target.value } as Partial<ChamberTuning>)
                  }
                  style={{ width: 34, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
                />
                <span>{color.label} colour</span>
                <span style={{ opacity: 0.5 }}>{values[color.key]}</span>
              </label>
            ))}

            {tab.nudge && (
              <NudgePad
                nudge={tab.nudge}
                values={values}
                onNudge={(key, delta) =>
                  set({ [key]: round(values[key] + delta) } as Partial<ChamberTuning>)
                }
              />
            )}

            {/* Switch a prop's pieces off one at a time. This is also the honest fix for another
                object's screen glowing through the display's trimmed edges: hide that screen. */}
            {tab.sliders.map((slider) => (
              <Row
                key={slider.key}
                label={slider.key}
                hint={slider.hint}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={values[slider.key]}
                onChange={(next) => set({ [slider.key]: next } as Partial<ChamberTuning>)}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" onClick={copyValues} style={buttonStyle}>
              {copied ? '✓ copied' : '📋 copy all'}
            </button>
            <button type="button" onClick={resetChamberTuning} style={buttonStyle}>
              ↺ reset
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Floating-point drift is ugly in a number box you're going to copy out. */
const round = (value: number) => Math.round(value * 1000) / 1000;

const padButtonStyle: CSSProperties = {
  padding: '5px 0',
  borderRadius: 5,
  border: '1px solid rgba(0, 229, 255, 0.35)',
  background: 'rgba(0, 229, 255, 0.1)',
  color: '#bdf0ff',
  cursor: 'pointer',
  font: 'inherit',
};

const stepButtonStyle = (active: boolean): CSSProperties => ({
  padding: '2px 6px',
  borderRadius: 4,
  border: `1px solid ${active ? 'rgba(0,229,255,0.6)' : 'rgba(255,255,255,0.14)'}`,
  background: active ? 'rgba(0, 229, 255, 0.22)' : 'rgba(255, 255, 255, 0.05)',
  color: active ? '#bdf0ff' : '#8fa6b3',
  cursor: 'pointer',
  font: 'inherit',
});

/**
 * Move a prop's pivot WITHOUT moving the prop.
 *
 * A prop is drawn as `translate(position) · rotate · scale · translate(−pivot)`, so a model point `q`
 * lands at `position + R·S·(q − pivot)`. Change the pivot alone and every point shifts by `R·S·Δpivot` —
 * i.e. the whole prop jumps across the room, which is not what "pin it here" should mean.
 *
 * So the position absorbs the change: `position += R·S·(pivotNew − pivotOld)`. Only what the prop turns
 * around changes; where it sits does not.
 */
function repivot(
  values: ChamberTuning,
  model: 'podium' | 'table',
  pivot: [number, number, number],
): Partial<ChamberTuning> {
  const oldPivot = new THREE.Vector3(
    values[`${model}PivotX`],
    values[`${model}PivotY`],
    values[`${model}PivotZ`],
  );
  const shift = new THREE.Vector3(...pivot)
    .sub(oldPivot)
    .multiply(
      new THREE.Vector3(
        values[`${model}ScaleX`],
        values[`${model}ScaleY`],
        values[`${model}ScaleZ`],
      ),
    )
    .applyEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(values[`${model}RotX`]),
        THREE.MathUtils.degToRad(values[`${model}RotY`]),
        THREE.MathUtils.degToRad(values[`${model}RotZ`]),
      ),
    );

  return {
    [`${model}PivotX`]: pivot[0],
    [`${model}PivotY`]: pivot[1],
    [`${model}PivotZ`]: pivot[2],
    [`${model}X`]: round(values[`${model}X`] + shift.x),
    [`${model}Y`]: round(values[`${model}Y`] + shift.y),
    [`${model}Z`]: round(values[`${model}Z`] + shift.z),
  } as Partial<ChamberTuning>;
}

interface ShowcaseRecorderProps {
  values: ChamberTuning;
  set: (patch: Partial<ChamberTuning>) => void;
}

/**
 * Record a camera move by flying it, not by guessing coordinates.
 *
 * Turn the free camera on — that FREEZES the props (a drag now orbits the camera instead of turning a
 * prop) and takes the reveal's own camera out of the way. Fly to a shot you like, record it, fly to the
 * next. Play the result back and the whole path is a GSAP move through your poses.
 */
function ShowcaseRecorder({ values, set }: ShowcaseRecorderProps) {
  const keys = values.showcaseKeys;

  // A pose is the camera AND the screen. Once the reveal has landed the screen is free, so the showcase
  // can carry it — out of the table, across the room, into the podium's rings.
  const record = () =>
    set({
      showcaseKeys: [
        ...keys,
        {
          x: values.scoutX,
          y: values.scoutY,
          z: values.scoutZ,
          tx: values.scoutTargetX,
          ty: values.scoutTargetY,
          tz: values.scoutTargetZ,
          sx: values.rigX,
          sy: values.rigY,
          sz: values.rigZ,
          syaw: values.rigYaw,
          spitch: values.rigPitch,
          sroll: values.rigRoll,
          sh: values.displayHeight,
        },
      ],
    });

  /** Fly the scout AND the screen back to a recorded pose, so it can be re-judged or replaced. */
  const goTo = (index: number) => {
    const key = keys[index];
    set({
      scoutX: key.x,
      scoutY: key.y,
      scoutZ: key.z,
      scoutTargetX: key.tx,
      scoutTargetY: key.ty,
      scoutTargetZ: key.tz,
      rigX: key.sx,
      rigY: key.sy,
      rigZ: key.sz,
      rigYaw: key.syaw,
      rigPitch: key.spitch,
      rigRoll: key.sroll,
      displayHeight: key.sh,
    });
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 8px',
          marginBottom: 8,
          borderRadius: 6,
          cursor: 'pointer',
          background: values.freeCamera ? 'rgba(0, 229, 255, 0.18)' : 'rgba(255, 255, 255, 0.05)',
          border: `1px solid ${values.freeCamera ? 'rgba(0,229,255,0.6)' : 'rgba(255,255,255,0.12)'}`,
        }}
      >
        <input
          type="checkbox"
          checked={values.freeCamera}
          onChange={(event) => set({ freeCamera: event.target.checked })}
        />
        <span>
          <strong>FREE CAMERA</strong>
          <br />
          <span style={{ opacity: 0.6 }}>
            props frozen · drag to look · <strong>WASD</strong> to fly · <strong>Q/E</strong> down/up ·
            shift to sprint
          </span>
        </span>
      </label>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button type="button" onClick={record} style={{ ...buttonStyle, background: 'rgba(255, 80, 80, 0.18)', borderColor: 'rgba(255,80,80,0.5)', color: '#ffc9c9' }}>
          ◉ record pose
        </button>
        <button
          type="button"
          onClick={() => sendChamberCommand({ type: 'showcase:play' })}
          style={buttonStyle}
          disabled={keys.length < 2}
        >
          ▶ play
        </button>
        <button type="button" onClick={() => sendChamberCommand({ type: 'showcase:stop' })} style={{ ...buttonStyle, flex: 'none', padding: '7px 10px' }}>
          ■
        </button>
      </div>

      {keys.length === 0 ? (
        <div style={{ opacity: 0.5, marginBottom: 8 }}>
          no poses yet. free camera on → fly somewhere → place the screen on the Screen tab → record.
          each pose stores the camera <em>and</em> the screen, so the feed can travel with you. two or
          more make a move.
        </div>
      ) : (
        <div style={{ marginBottom: 8 }}>
          {keys.map((key, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <span style={{ opacity: 0.55, width: 18 }}>{index + 1}</span>
              <button type="button" onClick={() => goTo(index)} style={{ ...buttonStyle, padding: '2px 6px', textAlign: 'left' }}>
                {key.x.toFixed(1)}, {key.y.toFixed(1)}, {key.z.toFixed(1)}
              </button>
              <button
                type="button"
                onClick={() => set({ showcaseKeys: keys.filter((_, at) => at !== index) })}
                style={{ ...buttonStyle, flex: 'none', padding: '2px 7px' }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set({ showcaseKeys: [] })}
            style={{ ...buttonStyle, marginTop: 4 }}
          >
            clear all poses
          </button>
        </div>
      )}
    </div>
  );
}

interface NudgePadProps {
  nudge: Nudge;
  values: ChamberTuning;
  onNudge: (key: NumKey, delta: number) => void;
}

/**
 * Directional buttons: one click, one step, in a named direction. Sliders are for finding roughly the
 * right value — these are for landing on it without overshooting.
 *
 * Left/right is X, up/down is Y, and "fwd/back" is Z (into and out of the screen).
 */
function NudgePad({ nudge, values, onNudge }: NudgePadProps) {
  const [moveStep, setMoveStep] = useState(0.05);
  const [turnStep, setTurnStep] = useState(5);

  // Only the axes this object is allowed to turn on — the display has no roll, by design.
  const turnAxes: { label: string; key?: NumKey }[] = [
    { label: 'yaw', key: nudge.rotY },
    { label: 'pitch', key: nudge.rotX },
    { label: 'roll', key: nudge.rotZ },
  ];
  const liveAxes = turnAxes.flatMap(({ label, key }) => (key ? [{ label, key }] : []));

  return (
    <div
      style={{
        marginBottom: 12,
        padding: '8px 9px',
        borderRadius: 7,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#00e5ff', opacity: 0.85 }}>move</span>
        <span style={{ display: 'flex', gap: 3 }}>
          {MOVE_STEPS.map((step) => (
            <button key={step} type="button" onClick={() => setMoveStep(step)} style={stepButtonStyle(moveStep === step)}>
              {step}
            </button>
          ))}
        </span>
      </div>

      {/* left / right / up / down, plus depth on its own row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        <span />
        <button type="button" style={padButtonStyle} onClick={() => onNudge(nudge.y, moveStep)}>↑ up</button>
        <span />
        <button type="button" style={padButtonStyle} onClick={() => onNudge(nudge.x, -moveStep)}>← left</button>
        <button type="button" style={padButtonStyle} onClick={() => onNudge(nudge.y, -moveStep)}>↓ down</button>
        <button type="button" style={padButtonStyle} onClick={() => onNudge(nudge.x, moveStep)}>right →</button>
        <button type="button" style={padButtonStyle} onClick={() => onNudge(nudge.z, -moveStep)}>⤒ fwd</button>
        <span style={{ textAlign: 'center', opacity: 0.45, alignSelf: 'center' }}>depth</span>
        <button type="button" style={padButtonStyle} onClick={() => onNudge(nudge.z, moveStep)}>back ⤓</button>
      </div>

      {liveAxes.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '9px 0 6px' }}>
            <span style={{ color: '#00e5ff', opacity: 0.85 }}>turn (°)</span>
            <span style={{ display: 'flex', gap: 3 }}>
              {TURN_STEPS.map((step) => (
                <button key={step} type="button" onClick={() => setTurnStep(step)} style={stepButtonStyle(turnStep === step)}>
                  {step}
                </button>
              ))}
            </span>
          </div>

          {liveAxes.map(({ label, key }) => (
            <div key={label} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginBottom: 4 }}>
              <button type="button" style={padButtonStyle} onClick={() => onNudge(key, -turnStep)}>↺</button>
              <span style={{ textAlign: 'center', alignSelf: 'center', opacity: 0.7 }}>
                {label} {round(values[key])}
              </span>
              <button type="button" style={padButtonStyle} onClick={() => onNudge(key, turnStep)}>↻</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

interface RowProps {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/** A slider paired with the exact number, typeable — dragging finds it, the box reads it back. */
function Row({ label, hint, min, max, step, value, disabled, onChange }: RowProps) {
  return (
    <div style={{ marginBottom: 7, opacity: disabled ? 0.4 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>{label}</span>
        <input
          type="number"
          value={value}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value);
            if (!Number.isNaN(next)) onChange(next);
          }}
          style={numberStyle}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
        style={{ width: '100%', accentColor: '#00e5ff' }}
      />
      {hint && <div style={{ opacity: 0.5, marginTop: -3 }}>{hint}</div>}
    </div>
  );
}
