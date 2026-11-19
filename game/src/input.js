// input.js — keyboard and mouse state for the whole game. Systems poll `keys` and the
// accumulated mouse movement each frame instead of juggling their own listeners, and
// pointer lock is requested from here so the third-person camera can orbit freely.

export const keys = Object.create(null);
/** Mouse movement accumulated since the last frame; main.js consumes and resets it. */
export const mouseDelta = { x: 0, y: 0 };
export let mouseDownLeft = false;
export let mouseDownRight = false;
/** Set true by a fresh left click; gameplay code clears it once handled. */
export let clickedLeft = false;

let canvas = null;
let onFirstGesture = null;

/** Attach all listeners. `element` receives pointer lock; `gestureHook` runs once. */
export function initInput(element, gestureHook) {
  canvas = element;
  onFirstGesture = gestureHook || null;
  window.addEventListener('keydown', (event) => {
    keys[event.code] = true;
    if (onFirstGesture) {
      onFirstGesture();
      onFirstGesture = null;
    }
  });
  window.addEventListener('keyup', (event) => {
    keys[event.code] = false;
  });
  window.addEventListener('mousedown', (event) => {
    if (onFirstGesture) {
      onFirstGesture();
      onFirstGesture = null;
    }
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
    for (const code of Object.keys(keys)) keys[code] = false;
    mouseDownLeft = false;
    mouseDownRight = false;
  });
}

/** Ask the browser for pointer lock on the game canvas (needs a user gesture). */
export function lockPointer() {
  if (canvas && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
}

/** Release pointer lock, e.g. when a menu opens. */
export function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

export function isLocked() {
  return document.pointerLockElement === canvas;
}

/** Consume the accumulated mouse movement for this frame. */
export function takeMouseDelta() {
  const out = { x: mouseDelta.x, y: mouseDelta.y };
  mouseDelta.x = 0;
  mouseDelta.y = 0;
  return out;
}

/** Consume the fresh-click flag. */
export function takeClick() {
  const was = clickedLeft;
  clickedLeft = false;
  return was;
}

/** True while any of the given key codes is held. */
export function anyDown(...codes) {
  return codes.some((code) => keys[code]);
}
