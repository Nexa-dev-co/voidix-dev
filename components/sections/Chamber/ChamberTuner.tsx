'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import {
  CHAMBER_TUNING_DEFAULTS,
  getChamberTuning,
  isChamberTuningEnabled,
  resetChamberTuning,
  setChamberTuning,
  subscribeChamberTuning,
  type ChamberTuning,
} from '@/lib/chamberTuning';

/**
 * On-screen controls for the chamber reveal — localhost (or `?tune`) only.
 *
 * Every number in the reveal was authored blind, so this exists to make them all draggable while the
 * scene is on screen. It renders nothing in production.
 *
 * The one control that matters most is **Hold**: the reveal is a committed glide between two scroll
 * stops, so scrolling can only ever leave you at progress 0 or 1 — you can't stop halfway to look at
 * it. Hold pins it open at any progress and ignores the scroll, so the room stands still while you
 * work on it.
 *
 * It lives outside the 3D scene (which isn't built until the visitor reaches Works) so that it's on
 * screen from the moment the page loads.
 */

type NumericKey = Exclude<keyof ChamberTuning, 'holdReveal' | 'showRoom'>;

interface Slider {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
}

interface Group {
  title: string;
  sliders: Slider[];
}

const GROUPS: Group[] = [
  {
    // The camera is derived from the rig, so these walk the WHOLE shot around the room. Start here:
    // it's what gets the camera out of the cloning tank and onto clear floor.
    title: 'Rig — display + camera together',
    sliders: [
      { key: 'rigX', label: 'rigX', min: -5, max: 5, step: 0.05, hint: 'right/left in the room' },
      { key: 'rigY', label: 'rigY', min: 0, max: 3, step: 0.05, hint: 'height off the floor' },
      { key: 'rigZ', label: 'rigZ', min: -5, max: 5, step: 0.05, hint: 'front/back' },
      { key: 'rigYaw', label: 'rigYaw', min: -3.15, max: 3.15, step: 0.01, hint: 'which way it faces' },
    ],
  },
  {
    title: 'Framing',
    sliders: [
      { key: 'displayHeight', label: 'displayHeight', min: 0.4, max: 4, step: 0.05 },
      { key: 'restDistance', label: 'restDistance', min: 1, max: 12, step: 0.1, hint: 'how much room you end up seeing' },
      { key: 'restRise', label: 'restRise', min: -2, max: 2, step: 0.05 },
      { key: 'easePower', label: 'easePower', min: 1, max: 5, step: 0.1 },
    ],
  },
  {
    // The frame is exported lying flat, so it has to be stood up — and which way is "up" depends on how
    // it was exported. Get it wrong and you're looking at the frame edge-on. Turn it until it faces you.
    title: 'Bezel — rotate to face you (degrees)',
    sliders: [
      { key: 'bezelRotX', label: 'bezelRotX', min: -180, max: 180, step: 1 },
      { key: 'bezelRotY', label: 'bezelRotY', min: -180, max: 180, step: 1 },
      { key: 'bezelRotZ', label: 'bezelRotZ', min: -180, max: 180, step: 1 },
      { key: 'bezelOversize', label: 'bezelOversize', min: 1, max: 3, step: 0.01, hint: 'too small and it CROPS the picture' },
      { key: 'bezelZ', label: 'bezelZ', min: -0.5, max: 0.5, step: 0.01, hint: 'in front of / behind the display' },
    ],
  },
  {
    title: 'Room + light',
    sliders: [
      { key: 'roomScale', label: 'roomScale', min: 0.002, max: 0.02, step: 0.0002 },
      { key: 'screenLight', label: 'screenLight', min: 0, max: 40, step: 0.5 },
      { key: 'ambient', label: 'ambient', min: 0, max: 1, step: 0.01 },
    ],
  },
];

const panelStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  // Above everything the site itself draws (the navbar sits at 9999).
  zIndex: 100000,
  width: 300,
  maxHeight: '85vh',
  overflowY: 'auto',
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
  width: 70,
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
    // Everything the reveal needs, ready to paste back into CHAMBER_TUNING_DEFAULTS.
    const text = JSON.stringify(getChamberTuning(), null, 2);
    navigator.clipboard?.writeText(text).catch(() => {});
    console.log(`[chamber tuning]\n${text}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
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

      {/* The reveal is a committed glide between two scroll stops — scrolling can only ever land you
          on 0 or 1. This is the only way to stop halfway and actually look at it. */}
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
            <input
              type="checkbox"
              checked={values.showRoom}
              onChange={(event) => set({ showRoom: event.target.checked })}
            />
            <span>show room <span style={{ opacity: 0.55 }}>(off = tablet on black)</span></span>
          </label>

          {GROUPS.map((group) => (
            <div key={group.title} style={{ marginTop: 12 }}>
              <div style={{ color: '#00e5ff', opacity: 0.85, marginBottom: 5 }}>{group.title}</div>
              {group.sliders.map((slider) => (
                <Row
                  key={slider.key}
                  label={slider.label}
                  hint={slider.hint}
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={values[slider.key]}
                  onChange={(next) => set({ [slider.key]: next } as Partial<ChamberTuning>)}
                />
              ))}
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={copyValues} style={buttonStyle}>
              {copied ? '✓ copied' : '📋 copy values'}
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

/** A slider paired with the exact number, typeable — dragging is for finding it, the box is for reading it. */
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
