// input.js — raw keyboard and mouse state for the whole game.
//
// Systems poll this module instead of owning listeners: `keys` is a live map of
// KeyboardEvent.code → held, mouse movement accumulates into `mouseDelta` for
// whoever consumes it each frame, and clicks are latched as one-shot flags so a
// punch or a shot fires exactly once per press. Pointer lock lives here too,
// since the third-person camera is the only thing that needs it.

export const keys = Object.create(null);
export const mouseDelta = { x: 0, y: 0 };
export let mouseDownLeft = false;
export let mouseDownRight = false;
/** Latched by a fresh left click; whichever system handles it clears it. */
export let clickedLeft = false;

let canvas = null;
let firstGestureHook = null;

function onGesture() {
  if (firstGestureHook) {
    firstGestureHook();
    firstGestureHook = null;
  }
}

/** Attach every listener. `element` is the canvas that takes pointer lock. */
export function initInput(element, gestureHook) {
  canvas = element;
  firstGestureHook = gestureHook || null;
  window.addEventListener('keydown', (event) => {
    keys[event.code] = true;
    onGesture();
  });
  window.addEventListener('keyup', (event) => {
    keys[event.code] = false;
  });
  window.addEventListener('mousedown', (event) => {
    onGesture();
    if (event.button === 0) {
      mouseDownLeft = true;
      clickedLeft = true;
    }
    if (event.button === 2) mouseDownRight = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) mouseDownLeft = false;
    if (event.button === 2) mouseDownRight = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === canvas) {
      mouseDelta.x += event.movementX || 0;
      mouseDelta.y += event.movementY || 0;
    }
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('blur', () => {
    // Never leave a key stuck down when the window loses focus mid-chase.
    for (const code of Object.keys(keys)) keys[code] = false;
    mouseDownLeft = false;
    mouseDownRight = false;
  });
}

/** Request pointer lock on the game canvas (needs a user gesture). */
export function lockPointer() {
  if (canvas && document.pointerLockElement !== canvas) canvas.requestPointerLock();
}

/** Release pointer lock, e.g. when a menu opens. */
export function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

export function isLocked() {
  return document.pointerLockElement === canvas;
}

/** Consume the mouse movement accumulated since the last frame. */
export function takeMouseDelta() {
  const out = { x: mouseDelta.x, y: mouseDelta.y };
  mouseDelta.x = 0;
  mouseDelta.y = 0;
  return out;
}

/** Consume the fresh-click latch. */
export function takeClick() {
  const was = clickedLeft;
  clickedLeft = false;
  return was;
}

/** True while any of the given key codes is held. */
export function anyDown(...codes) {
  return codes.some((code) => keys[code]);
}
