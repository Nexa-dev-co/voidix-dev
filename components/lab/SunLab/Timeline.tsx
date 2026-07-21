"use client";

import { useState } from "react";
import { Pause, Play, Square, Trash2 } from "lucide-react";
import { STAGE_PRESETS } from "./sunState";
import { PROPERTY_BY_PATH } from "./sunProperties";
import { EASE_IDS, type EaseId } from "./sunTimeline";
import type { SunTimelineApi } from "./hooks/useSunTimeline";

/**
 * The keyframe timeline editor, laid out for the narrow control panel. The ◆ buttons on the Look/Motion
 * tabs add tracks; this is where they're sequenced. Time↔position is a plain percentage of the duration,
 * so there's no fragile pixel maths.
 */

interface SelectedKey {
  path: string;
  keyId: string;
}

const labelFor = (path: string) => PROPERTY_BY_PATH.get(path)?.label ?? path;

export default function Timeline({ api }: { api: SunTimelineApi }) {
  const {
    timeline,
    time,
    playing,
    loop,
    stageTimes,
    play,
    pause,
    stop,
    setLoop,
    scrub,
    setDuration,
    stampStage,
    moveKey,
    removeKey,
    setEase,
    clearTrack,
  } = api;

  const [selected, setSelected] = useState<SelectedKey | null>(null);
  const duration = timeline.duration;
  const percent = (value: number) =>
    `${duration > 0 ? (value / duration) * 100 : 0}%`;

  const selectedKey =
    selected &&
    timeline.tracks
      .find((track) => track.path === selected.path)
      ?.keys.find((key) => key.id === selected.keyId);

  return (
    <div className="flex flex-col gap-3 text-white/80">
      {/* Transport */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={playing ? pause : play}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white transition-colors hover:border-[#00e5ff] hover:text-[#00e5ff]"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button
          type="button"
          onClick={stop}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/70 transition-colors hover:border-[#00e5ff] hover:text-[#00e5ff]"
          aria-label="Stop"
        >
          <Square size={12} />
        </button>
        <label className="flex items-center gap-1.5 text-[0.58rem] uppercase tracking-[0.1em] text-white/50">
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => setLoop(event.target.checked)}
            className="h-3.5 w-3.5 accent-[#00e5ff]"
          />
          Loop
        </label>
        <span className="ml-auto font-mono text-xs text-white/80">
          {time.toFixed(2)}s
        </span>
        <label className="flex items-center gap-1 text-[0.58rem] uppercase tracking-[0.1em] text-white/50">
          Dur
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            className="w-12 rounded border border-white/15 bg-transparent px-1.5 py-0.5 text-xs text-white/80"
          />
        </label>
      </div>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={duration}
        step={0.01}
        value={time}
        onChange={(event) => scrub(Number(event.target.value))}
        className="w-full accent-[#00e5ff]"
      />

      {/* Stage stamps — build the whole animation by stamping each stage at its marker. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.6rem] uppercase tracking-[0.12em] text-white/40">
          Stamp a stage at its marker
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {STAGE_PRESETS.map((preset, index) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => stampStage(preset, index)}
              title={`Stamp ${preset.label} at ${stageTimes[index]?.toFixed(1)}s`}
              className="rounded border border-white/15 px-2 py-1.5 text-[0.58rem] uppercase tracking-[0.08em] text-white/70 transition-colors hover:border-[#00e5ff] hover:text-[#00e5ff]"
            >
              ◆ {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selected-key inspector */}
      {selected && selectedKey && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[0.58rem] uppercase tracking-[0.1em] text-white/60">
          <span className="w-full text-white/80">{labelFor(selected.path)}</span>
          <label className="flex items-center gap-1.5">
            Time
            <input
              type="number"
              min={0}
              max={duration}
              step={0.05}
              value={selectedKey.time}
              onChange={(event) =>
                moveKey(selected.path, selected.keyId, Number(event.target.value))
              }
              className="w-14 rounded border border-white/15 bg-transparent px-1.5 py-0.5 text-white/80"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Ease
            <select
              value={selectedKey.ease}
              onChange={(event) =>
                setEase(selected.path, selected.keyId, event.target.value as EaseId)
              }
              className="rounded border border-white/15 bg-black px-1.5 py-0.5 text-white/80"
            >
              {EASE_IDS.map((ease) => (
                <option key={ease} value={ease}>
                  {ease}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              removeKey(selected.path, selected.keyId);
              setSelected(null);
            }}
            className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-white/70 transition-colors hover:border-red-400 hover:text-red-400"
          >
            <Trash2 size={11} /> Delete
          </button>
        </div>
      )}

      {/* Track lanes */}
      <div className="max-h-[38dvh] overflow-y-auto">
        {timeline.tracks.length === 0 ? (
          <p className="py-6 text-center text-[0.62rem] uppercase tracking-[0.12em] text-white/30">
            No tracks yet — stamp a stage above, or hit ◆ next to any control on
            the Look / Motion tabs.
          </p>
        ) : (
          timeline.tracks.map((track) => (
            <div
              key={track.path}
              className="flex items-center gap-2 border-b border-white/5 py-1.5"
            >
              <button
                type="button"
                onClick={() => clearTrack(track.path)}
                title="Clear track"
                className="text-white/30 transition-colors hover:text-red-400"
              >
                <Trash2 size={11} />
              </button>
              <span className="w-24 shrink-0 truncate text-[0.6rem] text-white/70">
                {labelFor(track.path)}
              </span>
              {/* Lane — click a dot to select; the playhead is the cyan line. */}
              <div className="relative h-5 flex-1 rounded bg-white/5">
                <div
                  className="absolute bottom-0 top-0 w-px bg-[#00e5ff]"
                  style={{ left: percent(time) }}
                />
                {track.keys.map((key) => {
                  const isSelected =
                    selected?.path === track.path && selected?.keyId === key.id;
                  return (
                    <button
                      key={key.id}
                      type="button"
                      onClick={() =>
                        setSelected({ path: track.path, keyId: key.id })
                      }
                      title={`${key.time.toFixed(2)}s · ${key.ease}`}
                      className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${
                        isSelected
                          ? "border-[#00e5ff] bg-[#00e5ff]"
                          : "border-white/50 bg-white/80 hover:border-[#00e5ff]"
                      }`}
                      style={{ left: percent(key.time) }}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
