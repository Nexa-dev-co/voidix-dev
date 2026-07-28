import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SUN_STATE,
  applyStagePreset,
  type StagePreset,
  type SunState,
} from "../sunState";
import { PROPERTY_BY_PATH } from "../sunProperties";
import {
  EMPTY_TIMELINE,
  hasKeyAt,
  moveKeyframe,
  removeKeyframe,
  removeTrack,
  resolveState,
  setKeyframeEase,
  upsertKeyframe,
  type EaseId,
  type Timeline,
} from "../sunTimeline";

// The property paths a stage "stamp" writes as keyframes — the stage-driving arc (motion + bloom +
// the layer emissive colours the ramp sets). Static look knobs (light positions, roughness…) stay in
// the base state unless the user keys them by hand.
const STAGE_STAMP_PATHS = [
  "rotationSpeed",
  "vibration.amplitude",
  "vibration.frequency",
  "pulse.amount",
  "pulse.speed",
  "cylinderReveal",
  "shatter.amount",
  "shatter.spin",
  "shatter.stagger",
  "shatter.drift",
  "shatter.distance",
  "blackHole.amount",
  "blackHole.coreRadius",
  "blackHole.inSpiral",
  "blackHole.diskSpeed",
  "blackHole.diskScale",
  "blackHole.diskColor",
  "bloom.strength",
  "bloom.radius",
  "bloom.threshold",
  "layers.core.emissiveColor",
  "layers.shards.emissiveColor",
  "layers.shell.emissiveColor",
  "layers.blowout.emissiveColor",
  "layers.cylinders.emissiveColor",
];

const UI_UPDATE_INTERVAL_MS = 60; // throttle the React playhead update during playback

export interface SunTimelineApi {
  base: SunState;
  timeline: Timeline;
  time: number;
  playing: boolean;
  loop: boolean;
  stageTimes: number[];
  /** Always-fresh resolved state for the scene to read each frame (base + keyed tracks at `time`). */
  resolvedStateRef: React.MutableRefObject<SunState>;

  setBase: React.Dispatch<React.SetStateAction<SunState>>;
  setTimeline: React.Dispatch<React.SetStateAction<Timeline>>;
  scrub: (time: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setLoop: (loop: boolean) => void;
  setDuration: (duration: number) => void;
  setStageTime: (index: number, time: number) => void;

  /** Record-model edit: tracked property → keyframe at playhead; otherwise → base. */
  setPropertyValue: (path: string, value: number | string) => void;
  /** Toggle a keyframe at the playhead for a property (captures its current shown value). */
  toggleKeyframe: (path: string) => void;
  /** Stamp a stage preset as keyframes at a marker time, and scrub there. */
  stampStage: (preset: StagePreset, index: number) => void;

  moveKey: (path: string, keyId: string, time: number) => void;
  removeKey: (path: string, keyId: string) => void;
  setEase: (path: string, keyId: string, ease: EaseId) => void;
  clearTrack: (path: string) => void;

  isTracked: (path: string) => boolean;
  hasKeyAtPlayhead: (path: string) => boolean;
}

export function useSunTimeline(): SunTimelineApi {
  const [base, setBase] = useState<SunState>(DEFAULT_SUN_STATE);
  const [timeline, setTimeline] = useState<Timeline>(EMPTY_TIMELINE);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoopState] = useState(true);
  const [stageTimes, setStageTimes] = useState<number[]>([0, 4, 8, 12]);

  // Mirrors for the rAF, kept current every render.
  const baseRef = useRef(base);
  baseRef.current = base;
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const timeRef = useRef(time);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const durationRef = useRef(timeline.duration);
  durationRef.current = timeline.duration;

  const resolvedStateRef = useRef<SunState>(base);

  // One always-on loop: advances the playhead while playing, and always refreshes the resolved state
  // from the live refs — so the scene stays smooth whether we're playing, scrubbing, or editing, with
  // no per-frame React render (the UI playhead is updated on a throttle).
  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    let lastUi = last;
    const tick = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      if (playingRef.current) {
        let next = timeRef.current + delta;
        if (next >= durationRef.current) {
          if (loopRef.current) {
            next = durationRef.current > 0 ? next % durationRef.current : 0;
          } else {
            next = durationRef.current;
            playingRef.current = false;
            setPlaying(false);
          }
        }
        timeRef.current = next;
        if (now - lastUi >= UI_UPDATE_INTERVAL_MS) {
          lastUi = now;
          setTime(next);
        }
      }
      resolvedStateRef.current = resolveState(
        baseRef.current,
        timelineRef.current,
        timeRef.current,
      );
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const scrub = useCallback((next: number) => {
    timeRef.current = next;
    setTime(next);
  }, []);

  const play = useCallback(() => {
    // Restart from the top if parked at the end.
    if (timeRef.current >= durationRef.current) scrub(0);
    setPlaying(true);
  }, [scrub]);
  const pause = useCallback(() => {
    setPlaying(false);
    setTime(timeRef.current);
  }, []);
  const stop = useCallback(() => {
    setPlaying(false);
    scrub(0);
  }, [scrub]);
  const setLoop = useCallback((next: boolean) => setLoopState(next), []);
  const setDuration = useCallback((next: number) => {
    setTimeline((current) => ({ ...current, duration: Math.max(0.5, next) }));
  }, []);
  const setStageTime = useCallback((index: number, next: number) => {
    setStageTimes((current) =>
      current.map((value, at) => (at === index ? next : value)),
    );
  }, []);

  const setPropertyValue = useCallback(
    (path: string, value: number | string) => {
      const property = PROPERTY_BY_PATH.get(path);
      if (!property) return;
      const track = timelineRef.current.tracks.find((entry) => entry.path === path);
      const tracked = !!track && track.keys.length > 0;
      if (tracked) {
        setTimeline((current) =>
          upsertKeyframe(current, path, timeRef.current, value),
        );
        return;
      }
      if (property.kind === "number" && typeof value === "number") {
        setBase((current) => property.set(current, value));
      } else if (property.kind === "color" && typeof value === "string") {
        setBase((current) => property.set(current, value));
      }
    },
    [],
  );

  const toggleKeyframe = useCallback((path: string) => {
    const property = PROPERTY_BY_PATH.get(path);
    if (!property) return;
    const track = timelineRef.current.tracks.find((entry) => entry.path === path);
    const existing = track ? hasKeyAt(track, timeRef.current) : undefined;
    if (existing) {
      setTimeline((current) => removeKeyframe(current, path, existing.id));
      return;
    }
    const value = property.get(resolvedStateRef.current);
    setTimeline((current) =>
      upsertKeyframe(current, path, timeRef.current, value),
    );
  }, []);

  const stampStage = useCallback((preset: StagePreset, index: number) => {
    const markerTime = stageTimes[index] ?? timeRef.current;
    const presetState = applyStagePreset(baseRef.current, preset);
    setTimeline((current) => {
      let next = current;
      for (const path of STAGE_STAMP_PATHS) {
        const property = PROPERTY_BY_PATH.get(path);
        if (!property) continue;
        next = upsertKeyframe(next, path, markerTime, property.get(presetState));
      }
      return next;
    });
    scrub(markerTime);
  }, [scrub, stageTimes]);

  const moveKey = useCallback(
    (path: string, keyId: string, next: number) =>
      setTimeline((current) => moveKeyframe(current, path, keyId, next)),
    [],
  );
  const removeKey = useCallback(
    (path: string, keyId: string) =>
      setTimeline((current) => removeKeyframe(current, path, keyId)),
    [],
  );
  const setEase = useCallback(
    (path: string, keyId: string, ease: EaseId) =>
      setTimeline((current) => setKeyframeEase(current, path, keyId, ease)),
    [],
  );
  const clearTrack = useCallback(
    (path: string) => setTimeline((current) => removeTrack(current, path)),
    [],
  );

  const isTracked = useCallback(
    (path: string) =>
      timeline.tracks.some(
        (entry) => entry.path === path && entry.keys.length > 0,
      ),
    [timeline],
  );
  const hasKeyAtPlayhead = useCallback(
    (path: string) => {
      const track = timeline.tracks.find((entry) => entry.path === path);
      return !!track && !!hasKeyAt(track, time);
    },
    [timeline, time],
  );

  return {
    base,
    timeline,
    time,
    playing,
    loop,
    stageTimes,
    resolvedStateRef,
    setBase,
    setTimeline,
    scrub,
    play,
    pause,
    stop,
    setLoop,
    setDuration,
    setStageTime,
    setPropertyValue,
    toggleKeyframe,
    stampStage,
    moveKey,
    removeKey,
    setEase,
    clearTrack,
    isTracked,
    hasKeyAtPlayhead,
  };
}
