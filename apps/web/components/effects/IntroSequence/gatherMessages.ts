import type { GatherFrameInput } from "./gatherRenderer";

// The main thread ↔ worker contract for the gather field.
//
// Deliberately one-way: the worker never replies. It owns its own render loop and needs nothing back, so
// there is no round trip that a blocked main thread could stall.

export interface GatherInitMessage {
  type: "init";
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  pixelRatio: number;
}

export interface GatherResizeMessage {
  type: "resize";
  width: number;
  height: number;
}

/** Progress and the convergence point. Sent whenever the main thread has something new to say. */
export interface GatherUpdateMessage extends GatherFrameInput {
  type: "update";
}

export interface GatherIgniteMessage {
  type: "ignite";
}

export interface GatherDisposeMessage {
  type: "dispose";
}

export type GatherMessage =
  | GatherInitMessage
  | GatherResizeMessage
  | GatherUpdateMessage
  | GatherIgniteMessage
  | GatherDisposeMessage;
