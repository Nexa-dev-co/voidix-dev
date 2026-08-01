/**
 * The left-hand column every `?tune` panel lives in.
 *
 * lil-gui auto-places at the top RIGHT, so a panel left to itself lands over the scene it is editing.
 * Everything is appended to one fixed column on the left instead: stacking is then normal flow layout,
 * the column scrolls when its contents outgrow the viewport, and each panel keeps its own
 * collapse-by-clicking-the-title behaviour.
 *
 * ── One panel, now ───────────────────────────────────────────────────────────────────────────────
 * There were three — the fleet, the works field, the chamber — and together they were taller than any
 * viewport, which is what made the column's scrolling matter and then exposed that it did not work (the
 * pin was cancelling it; see `isInsideTunerDock`). The fleet's and the field's panels have been deleted
 * now that their values are authored and baked into their tuning files. The dock stays general: it has
 * never known what a panel is, and a second one appended tomorrow needs no change here.
 *
 * Created lazily and only ever by a tuner, so nothing about this exists on a normal page load.
 */

import {
  TUNER_DOCK_ID,
  isTuneScrollLocked,
  setTuneScrollLocked,
  onTuneScrollLockChange,
} from '@/lib/tuneScrollLock';
import { copyTuningExport } from '@/lib/tunerExport';
import { resetAllTuning } from '@/lib/tunerReset';

// Above the intro veil (10000) and the navbar, so the panel is reachable at any point in the scroll.
const DOCK_Z_INDEX = 10002;

export function getTunerDock(): HTMLElement {
  const existing = document.getElementById(TUNER_DOCK_ID);
  if (existing) return existing;

  const dock = document.createElement('div');
  dock.id = TUNER_DOCK_ID;
  Object.assign(dock.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    maxHeight: '100vh',
    overflowY: 'auto',
    zIndex: String(DOCK_Z_INDEX),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
    // The column is only as wide as the panels in it, so it never covers more of the scene than it has
    // to — and the gaps between panels stay click-through to the canvas behind.
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  dock.appendChild(createScrollLockButton());
  dock.appendChild(createCopyAllButton());
  dock.appendChild(createResetAllButton());
  document.body.appendChild(dock);
  return dock;
}

/**
 * Put every open panel back to its shipped values.
 *
 * Confirmed first, because it is the one control here that destroys work: a tuning session's output
 * lives only in memory until you copy it, so a mis-click costs the whole session. The copy button sits
 * directly above it for exactly that reason.
 */
function createResetAllButton(): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  styleDockButton(button);
  button.style.background = '#2a1416';
  button.style.color = '#ff8a8a';
  button.textContent = '↺ reset all to shipped';

  button.addEventListener('click', () => {
    if (!window.confirm('Reset every panel to its shipped values? Anything not copied is lost.')) {
      return;
    }
    const count = resetAllTuning();
    const previous = button.textContent;
    button.textContent = `✓ reset ${count} panel${count === 1 ? '' : 's'}`;
    window.setTimeout(() => {
      button.textContent = previous;
    }, 1600);
  });
  return button;
}

/** Shared look for the dock's own buttons — they aren't lil-gui controls, so they need their own. */
function styleDockButton(button: HTMLButtonElement): void {
  Object.assign(button.style, {
    pointerEvents: 'auto',
    width: '100%',
    padding: '7px 10px',
    border: '0',
    borderRadius: '0',
    font: '11px/1.4 system-ui, sans-serif',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
}

/**
 * One button that prints every open panel's state as pasteable source.
 *
 * Deliberately a single button covering all panels: a tuning session moves the camera, then the room,
 * then a hull — and copying those separately is how a set of values that only make sense together gets
 * half-applied.
 */
function createCopyAllButton(): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  styleDockButton(button);
  button.style.background = '#111c1f';
  button.style.color = '#6fd9ff';
  button.textContent = '⧉ copy all tuning';

  button.addEventListener('click', () => {
    copyTuningExport();
    const previous = button.textContent;
    // The clipboard write is silent on success, so say something — otherwise there's no way to tell a
    // working copy from a blocked one until you paste.
    button.textContent = '✓ copied — also logged to console';
    window.setTimeout(() => {
      button.textContent = previous;
    }, 1600);
  });
  return button;
}

/**
 * The freeze button, at the top of the column.
 *
 * It lives in the dock rather than in any one panel because the lock is a property of the SESSION, not
 * of a scene — you want the same switch whichever panel you happen to be working in, and three copies
 * of it that can disagree would be worse than none.
 */
function createScrollLockButton(): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  styleDockButton(button);

  const paint = (locked: boolean) => {
    button.textContent = locked ? '🔒 scroll frozen — click to free' : '🔓 scroll live — click to freeze';
    button.style.background = locked ? '#00e5ff' : '#1a1a1a';
    button.style.color = locked ? '#000000' : '#bbbbbb';
  };

  paint(isTuneScrollLocked());
  button.addEventListener('click', () => setTuneScrollLocked(!isTuneScrollLocked()));
  onTuneScrollLockChange(paint);
  return button;
}

/**
 * Put one panel in the dock.
 *
 * lil-gui's auto-place styling positions it absolutely against the viewport; inside a container it has
 * to flow normally instead, or every panel lands on top of the first one.
 */
export function dockPanel(panelElement: HTMLElement): void {
  const dock = getTunerDock();
  Object.assign(panelElement.style, {
    position: 'relative',
    top: 'auto',
    right: 'auto',
    // The dock itself is click-through; the panels within it must not be.
    pointerEvents: 'auto',
  } satisfies Partial<CSSStyleDeclaration>);
  dock.appendChild(panelElement);
}
