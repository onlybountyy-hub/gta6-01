// save.js — persistence in localStorage: cash, story progress, and where
// Marco was standing. Saving happens on mission completion and on demand from
// the pause menu; the start screen's Continue button is what loads it back.
// Every access is wrapped: in private mode the game simply runs unsaved.

import { SAVE_KEY, PLACES } from './config.js';
import { S } from './state.js';

/** Write the current run to localStorage. */
export function saveGame() {
  try {
    const p = S.playerPos();
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        cash: S.cash,
        nextMission: S.progress ? S.progress.nextMission : 0,
        storyComplete: S.storyComplete,
        x: p.x,
        z: p.z,
      }),
    );
  } catch {
    // A full or blocked store is not an error worth surfacing mid-game.
  }
}

/** Read a saved run, or null when there is none worth loading. */
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return typeof data.cash === 'number' ? data : null;
  } catch {
    return null;
  }
}

/** Apply a save object to live state. Returns the position to spawn at. */
export function applySave(data) {
  S.cash = data.cash;
  S.storyComplete = Boolean(data.storyComplete);
  if (S.progress) S.progress.nextMission = data.nextMission || 0;
  if (typeof data.x === 'number' && typeof data.z === 'number') return { x: data.x, z: data.z };
  return { x: PLACES.spawn.x, z: PLACES.spawn.z };
}

/** True when the start screen should offer a Continue button. */
export function hasSave() {
  return loadSave() !== null;
}

/** Wipe the save (New Game). */
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}
