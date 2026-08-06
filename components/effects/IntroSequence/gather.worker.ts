/// <reference lib="webworker" />

import { GatherRenderer } from "./gatherRenderer";
import type { GatherMessage } from "./gatherMessages";

// The gather field's render loop, off the main thread.
//
// THIS IS THE WHOLE POINT OF THE WORKER: while the main thread parses glTF, uploads geometry and compiles
// shaders, it cannot run a rAF callback at all — the loader would visibly freeze. Here the loop keeps
// going and the compositor keeps presenting frames.
//
// It also means a blocked main thread simply stops posting updates, so the field carries on animating
// against its last known progress. Motion never stops; only progress pauses. That behaviour is a
// consequence of the architecture, not a special case anyone has to maintain.

let renderer: GatherRenderer | null = null;
let animationFrame = 0;

const loop = () => {
  renderer?.renderFrame();
  animationFrame = requestAnimationFrame(loop);
};

self.onmessage = (event: MessageEvent<GatherMessage>) => {
  const message = event.data;

  switch (message.type) {
    case "init": {
      if (renderer) return;
      renderer = new GatherRenderer(
        message.canvas,
        message.pixelRatio,
        message.particleCount,
      );
      renderer.resize(message.width, message.height);
      loop();
      return;
    }
    case "resize": {
      renderer?.resize(message.width, message.height);
      return;
    }
    case "update": {
      renderer?.update(message);
      return;
    }
    case "ignite": {
      renderer?.ignite();
      return;
    }
    case "dispose": {
      cancelAnimationFrame(animationFrame);
      renderer?.dispose();
      renderer = null;
      self.close();
      return;
    }
  }
};
