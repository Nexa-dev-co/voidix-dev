'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import {
  CHAMBER_TUNING_DEFAULTS,
  getChamberParts,
  getChamberTuning,
  isChamberTuningEnabled,
  resetChamberTuning,
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

interface Tab {
  id: string;
  title: string;
  toggle?: { key: BoolKey; label: string };
  nudge?: Nudge;
  /** A loaded model whose individual meshes can be switched off, and which a drag turns. */
  model?: 'podium' | 'table';
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
    id: 'table',
    title: 'Table',
    toggle: { key: 'showTable', label: 'show table' },
    nudge: { x: 'tableX', y: 'tableY', z: 'tableZ', rotX: 'tableRotX', rotY: 'tableRotY', rotZ: 'tableRotZ' },
    model: 'table',
    sliders: placement('table', 6),
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
            {parts.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: '#00e5ff', opacity: 0.85, marginBottom: 5 }}>
                  parts ({parts.length})
                </div>
                {parts.map((part) => {
                  const hidden = values.hiddenParts.includes(part.id);
                  return (
                    <label
                      key={part.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, opacity: hidden ? 0.4 : 1 }}
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
                      <span>{part.label}</span>
                    </label>
                  );
                })}
              </div>
            )}

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
