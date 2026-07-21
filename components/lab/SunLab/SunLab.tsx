"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Clipboard, RotateCcw } from "lucide-react";
import { useSunLab } from "./hooks/useSunLab";
import { useSunTimeline, type SunTimelineApi } from "./hooks/useSunTimeline";
import Timeline from "./Timeline";
import { groupedProperties, type SunProperty } from "./sunProperties";
import { EMPTY_TIMELINE, resolveState } from "./sunTimeline";
import { formatSunTuningSource } from "./sunPresetSource";
import {
  DEFAULT_SUN_STATE,
  STAGE_PRESETS,
  applyGradientRamp,
  applyStagePreset,
  type SunState,
} from "./sunState";

/**
 * The fractured-sun lab (Phase 4). Three tabs keep it from being a firehose:
 *   Look     — colours, glow, bloom, lights (sculpt the base look)
 *   Motion   — the four stages' motion params
 *   Timeline — sequence the stages into a keyframe animation
 * The Export button is global (top bar) and copies a pasteable `sunTuning.ts`.
 *
 * Styled with Tailwind utilities, not globals.css — a throwaway lab shouldn't grow the shipped stylesheet.
 */

const COPY_FEEDBACK_MS = 1600;

const BACKDROPS = [
  { id: "site", label: "Site", color: "#060606" },
  { id: "black", label: "Black", color: "#000000" },
  { id: "slate", label: "Slate", color: "#1a1f26" },
] as const;

const DEFAULT_RAMP = { core: "#fff2d6", mid: "#00e5ff", edge: "#8febff" };

type Tab = "look" | "motion" | "timeline";
const TABS: { id: Tab; label: string }[] = [
  { id: "look", label: "Look" },
  { id: "motion", label: "Motion" },
  { id: "timeline", label: "Timeline" },
];

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="flex justify-between text-[0.62rem] uppercase tracking-[0.12em] text-white/40">
        <span>{label}</span>
        <span className="text-white/80">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-[#00e5ff]"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-1 items-center justify-between gap-2 text-[0.62rem] uppercase tracking-[0.12em] text-white/40">
      <span>{label}</span>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-white/10 pt-3">
      <span className="text-[0.62rem] uppercase tracking-[0.18em] text-white/50">
        {title}
      </span>
      {children}
    </div>
  );
}

/** A keyframe toggle: ghost when untracked, cyan outline when tracked, filled when a key sits here. */
function KeyframeButton({
  tracked,
  keyed,
  onClick,
}: {
  tracked: boolean;
  keyed: boolean;
  onClick: () => void;
}) {
  const tone = keyed
    ? "text-[#00e5ff]"
    : tracked
      ? "text-[#00e5ff]/50"
      : "text-white/20 hover:text-white/50";
  return (
    <button
      type="button"
      onClick={onClick}
      title="Keyframe at playhead"
      className={`shrink-0 text-sm leading-none transition-colors ${tone}`}
    >
      ◆
    </button>
  );
}

function PropertyRow({
  property,
  state,
  api,
}: {
  property: SunProperty;
  state: SunState;
  api: SunTimelineApi;
}) {
  const keyframe = (
    <KeyframeButton
      tracked={api.isTracked(property.path)}
      keyed={api.hasKeyAtPlayhead(property.path)}
      onClick={() => api.toggleKeyframe(property.path)}
    />
  );

  if (property.kind === "number") {
    return (
      <div className="flex items-end gap-2">
        <Slider
          label={property.label}
          value={property.get(state)}
          min={property.min}
          max={property.max}
          step={property.step}
          onChange={(value) => api.setPropertyValue(property.path, value)}
        />
        {keyframe}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <ColorField
        label={property.label}
        value={property.get(state)}
        onChange={(value) => api.setPropertyValue(property.path, value)}
      />
      {keyframe}
    </div>
  );
}

export default function SunLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const api = useSunTimeline();
  const [tab, setTab] = useState<Tab>("look");
  const [backdrop, setBackdrop] = useState<string>(BACKDROPS[0].id);
  const [ramp, setRamp] = useState(DEFAULT_RAMP);
  const [hasCopied, setHasCopied] = useState(false);

  const backdropColor =
    BACKDROPS.find((option) => option.id === backdrop)?.color ??
    BACKDROPS[0].color;

  // The scene reads the always-fresh resolved ref (60fps); the panel reads this reactive copy.
  const displayState = useMemo(
    () => resolveState(api.base, api.timeline, api.time),
    [api.base, api.timeline, api.time],
  );

  useSunLab(canvasRef, api.resolvedStateRef, backdropColor);

  const { lookGroups, motionGroups } = useMemo(() => {
    const groups = groupedProperties();
    return {
      lookGroups: groups.filter((entry) => !entry.group.startsWith("Stage ")),
      motionGroups: groups.filter((entry) => entry.group.startsWith("Stage ")),
    };
  }, []);

  const applyRamp = () =>
    api.setBase((current) => ({
      ...current,
      layers: applyGradientRamp(current.layers, ramp.core, ramp.mid, ramp.edge),
    }));

  const resetAll = () => {
    api.setBase(DEFAULT_SUN_STATE);
    api.setTimeline(EMPTY_TIMELINE);
  };

  const exportSource = () => {
    const source = formatSunTuningSource(api.base, api.timeline);
    navigator.clipboard?.writeText(source).catch(() => {});
    console.log(source);
    setHasCopied(true);
    window.setTimeout(() => setHasCopied(false), COPY_FEEDBACK_MS);
  };

  const renderProperties = (
    groups: { group: string; properties: SunProperty[] }[],
  ) =>
    groups.map(({ group, properties }) => (
      <Section key={group} title={group}>
        {properties.map((property) => (
          <PropertyRow
            key={property.path}
            property={property}
            state={displayState}
            api={api}
          />
        ))}
      </Section>
    ));

  return (
    <div
      className="relative h-[100dvh] w-full overflow-hidden"
      style={{ background: backdropColor }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
      />

      {/* Control panel */}
      <div className="pointer-events-auto absolute inset-y-0 left-0 flex w-full max-w-xs flex-col border-white/10 bg-black/70 text-white/80 backdrop-blur md:inset-y-4 md:left-4 md:w-80 md:rounded-xl md:border">
        {/* Global bar — Export lives here, above the tabs, always reachable. */}
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <span className="font-medium tracking-wide text-white">
            Fractured Sun
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={resetAll}
              title="Reset base + timeline"
              className="flex items-center rounded border border-white/15 px-2 py-1.5 text-white/70 transition-colors hover:border-white/40 hover:text-white"
            >
              <RotateCcw size={12} />
            </button>
            <button
              type="button"
              onClick={exportSource}
              title="Copy sunTuning.ts (also logged to console)"
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[0.58rem] uppercase tracking-[0.12em] transition-colors ${
                hasCopied
                  ? "border-[#00e5ff] bg-[#00e5ff]/10 text-[#00e5ff]"
                  : "border-white/15 text-white/70 hover:border-[#00e5ff] hover:text-[#00e5ff]"
              }`}
            >
              {hasCopied ? <Check size={12} /> : <Clipboard size={12} />}
              {hasCopied ? "Copied" : "Export"}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/10 p-2">
          {TABS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTab(option.id)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[0.62rem] uppercase tracking-[0.12em] transition-colors ${
                tab === option.id
                  ? "bg-[#00e5ff] text-black"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {tab === "look" && (
            <>
              {/* Backdrop + material mode. */}
              <div className="flex flex-col gap-2">
                <span className="text-[0.62rem] uppercase tracking-[0.12em] text-white/40">
                  Backdrop
                </span>
                <div className="flex gap-1 rounded-full border border-white/10 p-1">
                  {BACKDROPS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setBackdrop(option.id)}
                      className={`flex-1 rounded-full px-2 py-1 text-[0.58rem] uppercase tracking-[0.1em] transition-colors ${
                        backdrop === option.id
                          ? "bg-[#00e5ff] text-black"
                          : "text-white/50 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <label className="mt-1 flex items-center justify-between text-[0.62rem] uppercase tracking-[0.12em] text-white/40">
                  <span>Studio materials (lit)</span>
                  <input
                    type="checkbox"
                    checked={displayState.studioMaterials}
                    onChange={(event) =>
                      api.setBase((current) => ({
                        ...current,
                        studioMaterials: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-[#00e5ff]"
                  />
                </label>
              </div>

              {/* Gradient ramp. */}
              <Section title="Gradient ramp">
                <ColorField
                  label="Core"
                  value={ramp.core}
                  onChange={(value) => setRamp((r) => ({ ...r, core: value }))}
                />
                <ColorField
                  label="Mid"
                  value={ramp.mid}
                  onChange={(value) => setRamp((r) => ({ ...r, mid: value }))}
                />
                <ColorField
                  label="Edge"
                  value={ramp.edge}
                  onChange={(value) => setRamp((r) => ({ ...r, edge: value }))}
                />
                <button
                  type="button"
                  onClick={applyRamp}
                  className="rounded border border-white/15 px-3 py-1.5 text-[0.58rem] uppercase tracking-[0.12em] text-white/70 transition-colors hover:border-[#00e5ff] hover:text-[#00e5ff]"
                >
                  Apply to layers
                </button>
              </Section>

              {renderProperties(lookGroups)}
            </>
          )}

          {tab === "motion" && (
            <>
              {/* Stage preview — sets the base look+motion (a quick look, not the timeline). */}
              <div className="flex flex-col gap-2">
                <span className="text-[0.62rem] uppercase tracking-[0.12em] text-white/40">
                  Stage preview → base
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {STAGE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        api.setBase((current) =>
                          applyStagePreset(current, preset),
                        )
                      }
                      className="rounded border border-white/15 px-2 py-1.5 text-[0.58rem] uppercase tracking-[0.1em] text-white/70 transition-colors hover:border-[#00e5ff] hover:text-[#00e5ff]"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {renderProperties(motionGroups)}
            </>
          )}

          {tab === "timeline" && <Timeline api={api} />}
        </div>
      </div>

      <p className="pointer-events-none absolute right-5 top-4 text-[0.58rem] uppercase tracking-[0.18em] text-white/30 md:right-6">
        drag to orbit · scroll to zoom
      </p>
    </div>
  );
}
