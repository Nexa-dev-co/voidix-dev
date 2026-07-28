import { PROPERTY_BY_PATH } from "./sunProperties";
import { mixHex, type SunState } from "./sunState";

// The keyframe model + evaluator. Pure and framework-free: given a base state, a set of tracks and a
// time, it resolves the SunState to render. The lab's playhead drives `time` today; the hero's scroll
// progress will drive the same evaluator later (docs/fractured-sun-lab-plan.md §5).

/** Easing INTO a keyframe from the previous one. `hold` steps (no interpolation). */
export type EaseId = "linear" | "in" | "out" | "inout" | "hold";

export const EASE_IDS: EaseId[] = ["linear", "in", "out", "inout", "hold"];

export interface Keyframe {
  id: string;
  time: number; // seconds
  value: number | string; // number tracks hold numbers; colour tracks hold hex strings
  ease: EaseId;
}

/** One property's keyframes over time, kept sorted by time. */
export interface Track {
  path: string;
  keys: Keyframe[];
}

export interface Timeline {
  duration: number;
  tracks: Track[];
}

export const EMPTY_TIMELINE: Timeline = { duration: 12, tracks: [] };

let keyframeCounter = 0;
const nextKeyId = () => `k${(keyframeCounter += 1)}`;

// A keyframe within this many seconds of a target time counts as "the same key" (replace, not add).
const SAME_TIME_EPSILON = 0.01;

function applyEase(t: number, ease: EaseId): number {
  switch (ease) {
    case "in":
      return t * t;
    case "out":
      return 1 - (1 - t) * (1 - t);
    case "inout":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case "hold":
      return 0; // never reached (hold is handled before interpolation), kept for exhaustiveness
    case "linear":
    default:
      return t;
  }
}

/** Value of a track at `time`, or null if it has no keys. Numbers lerp; colours RGB-mix. */
export function evaluateTrack(track: Track, time: number): number | string | null {
  const keys = track.keys;
  if (keys.length === 0) return null;
  if (time <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.value;

  let index = 0;
  while (index < keys.length - 1 && keys[index + 1].time <= time) index += 1;
  const from = keys[index];
  const to = keys[index + 1];

  if (to.ease === "hold") return from.value;
  const raw = (time - from.time) / (to.time - from.time);
  const eased = applyEase(raw, to.ease);

  if (typeof from.value === "number" && typeof to.value === "number") {
    return from.value + (to.value - from.value) * eased;
  }
  return mixHex(String(from.value), String(to.value), eased);
}

/** Resolve the state to render: the base state with every keyed track's evaluated value applied. */
export function resolveState(
  base: SunState,
  timeline: Timeline,
  time: number,
): SunState {
  let state = base;
  for (const track of timeline.tracks) {
    const property = PROPERTY_BY_PATH.get(track.path);
    if (!property) continue;
    const value = evaluateTrack(track, time);
    if (value === null) continue;
    if (property.kind === "number" && typeof value === "number") {
      state = property.set(state, value);
    } else if (property.kind === "color" && typeof value === "string") {
      state = property.set(state, value);
    }
  }
  return state;
}

// ── Immutable CRUD ──

function withTrack(
  timeline: Timeline,
  path: string,
  update: (track: Track) => Track,
): Timeline {
  const existing = timeline.tracks.find((track) => track.path === path);
  if (!existing) {
    return {
      ...timeline,
      tracks: [...timeline.tracks, update({ path, keys: [] })],
    };
  }
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.path === path ? update(track) : track,
    ),
  };
}

/** Add a keyframe at `time`, or replace the value/ease of the one already there. */
export function upsertKeyframe(
  timeline: Timeline,
  path: string,
  time: number,
  value: number | string,
  ease: EaseId = "inout",
): Timeline {
  return withTrack(timeline, path, (track) => {
    const at = track.keys.findIndex(
      (key) => Math.abs(key.time - time) <= SAME_TIME_EPSILON,
    );
    if (at >= 0) {
      const keys = track.keys.slice();
      keys[at] = { ...keys[at], value };
      return { ...track, keys };
    }
    const keys = [
      ...track.keys,
      { id: nextKeyId(), time, value, ease },
    ].sort((a, b) => a.time - b.time);
    return { ...track, keys };
  });
}

export function removeKeyframe(
  timeline: Timeline,
  path: string,
  keyId: string,
): Timeline {
  const track = timeline.tracks.find((entry) => entry.path === path);
  if (!track) return timeline;
  const keys = track.keys.filter((key) => key.id !== keyId);
  // Drop the track entirely when its last key goes, so it stops overriding the base state.
  if (keys.length === 0) {
    return {
      ...timeline,
      tracks: timeline.tracks.filter((entry) => entry.path !== path),
    };
  }
  return {
    ...timeline,
    tracks: timeline.tracks.map((entry) =>
      entry.path === path ? { ...entry, keys } : entry,
    ),
  };
}

export function moveKeyframe(
  timeline: Timeline,
  path: string,
  keyId: string,
  time: number,
): Timeline {
  return withTrack(timeline, path, (track) => {
    const keys = track.keys
      .map((key) => (key.id === keyId ? { ...key, time } : key))
      .sort((a, b) => a.time - b.time);
    return { ...track, keys };
  });
}

export function setKeyframeEase(
  timeline: Timeline,
  path: string,
  keyId: string,
  ease: EaseId,
): Timeline {
  return withTrack(timeline, path, (track) => ({
    ...track,
    keys: track.keys.map((key) => (key.id === keyId ? { ...key, ease } : key)),
  }));
}

export function removeTrack(timeline: Timeline, path: string): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.filter((track) => track.path !== path),
  };
}

export function hasKeyAt(track: Track, time: number): Keyframe | undefined {
  return track.keys.find(
    (key) => Math.abs(key.time - time) <= SAME_TIME_EPSILON,
  );
}
