// main.js — Solano Heat's entry point and frame loop.
//
// Boot builds the renderer and the city, wires the start and pause menus, and
// starts the loop that advances every system in order: input, player, traffic,
// police, combat, missions, physics, world life, HUD. The two scripted
// interruptions — BUSTED (the meter filled) and WASTED (health ran out) — are
// staged here, as is the ?scene= screenshot mode. A small handle is published
// on window.SolanoHeat so automated checks can drive the game headlessly.

import * as THREE from 'three';
import { PLACES } from './config.js';
import { S } from './state.js';
import { initInput, keys, lockPointer, unlockPointer } from './input.js';
import { buildWorld, updateWorld } from './world.js';
import { initEffects, updateEffects } from './effects.js';
import { initPlayer, updatePlayer, placePlayer } from './player.js';
import { spawnParkedCars, integrateVehicle, collideVehicles } from './vehicles.js';
import { initTraffic, updateTraffic } from './traffic.js';
import { initPedestrians, updatePedestrians } from './pedestrians.js';
import { updatePolice, clearWanted, bustDropPoint } from './police.js';
import { updateCombat } from './combat.js';
import { initMissions, updateMissions, updateDialogue, failMission, startMission } from './missions.js';
import { initHud, updateHud, setHudVisible } from './hud.js';
import { initAudio, startAmbient, updateEngine, toggleMute } from './audio.js';
import { loadSave, applySave, saveGame, clearSave, hasSave } from './save.js';
import { stageScene, updateScene } from './scenes.js';

const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlaySub = document.getElementById('overlaySub');
let overlayUntil = 0;
let lastMuteKey = false;
let lastPauseKey = false;
let clock = null;

function showOverlay(title, sub, seconds) {
  overlayTitle.textContent = title;
  overlaySub.textContent = sub;
  overlayEl.style.display = 'flex';
  overlayUntil = S.time + seconds;
}

function startGame(fresh) {
  initAudio();
  startAmbient();
  if (fresh) {
    clearSave();
    S.cash = 250;
    S.storyComplete = false;
    if (S.progress) S.progress.nextMission = 0;
    placePlayer(PLACES.spawn.x, PLACES.spawn.z, 2.2);
  } else {
    const data = loadSave();
    if (data) {
      const at = applySave(data);
      placePlayer(at.x, at.z, 2.2);
    }
  }
  S.player.health = 100;
  S.player.dead = false;
  clearWanted();
  menuEl.style.display = 'none';
  pauseEl.style.display = 'none';
  setHudVisible(true);
  S.mode = 'playing';
  lockPointer();
}

function toMenu() {
  S.mode = 'menu';
  menuEl.style.display = 'flex';
  pauseEl.style.display = 'none';
  setHudVisible(false);
  unlockPointer();
  document.getElementById('btnContinue').style.display = hasSave() ? 'block' : 'none';
}

function togglePause() {
  if (S.mode === 'playing') {
    S.mode = 'paused';
    pauseEl.style.display = 'flex';
    unlockPointer();
  } else if (S.mode === 'paused') {
    S.mode = 'playing';
    pauseEl.style.display = 'none';
    lockPointer();
  }
}

/** BUSTED: a fine, a lift to the station, a clean record, a blown job. */
function handleBusted() {
  S.busted = false;
  failMission('the police got you');
  const fine = Math.min(S.cash, 120 + S.wanted.stars * 60);
  S.cash -= fine;
  showOverlay('BUSTED', `The PSPD lets you go with a $${fine} fine.`, 2.6);
  S.mode = 'busted';
  clearWanted();
  if (S.player.inVehicle) {
    S.player.inVehicle.parked = true;
    S.player.inVehicle = null;
    S.player.mesh.visible = true;
  }
  const drop = bustDropPoint();
  placePlayer(drop.x, drop.z, 0);
  saveGame();
}

/** WASTED: a hospital bill, a clean record, a blown job. */
function handleWasted() {
  failMission('you woke up in hospital');
  const fee = Math.min(S.cash, 200);
  S.cash -= fee;
  showOverlay('WASTED', `Port Solano General patched you up for $${fee}.`, 2.8);
  S.mode = 'wasted';
  clearWanted();
  if (S.player.inVehicle) {
    S.player.inVehicle = null;
    S.player.mesh.visible = true;
  }
  S.player.dead = false;
  S.player.health = 100;
  placePlayer(PLACES.hospital.x, PLACES.hospital.z, Math.PI);
  saveGame();
}

/** Physics step: integrate every vehicle, then resolve car-against-car. */
function integrateAll(dt) {
  for (const v of S.vehicles) integrateVehicle(v, dt);
  collideVehicles();
}

/** One frame of the living city without the player systems (menus, overlays). */
function simulateCity(dt, withPolice) {
  updateTraffic(dt);
  updatePedestrians(dt);
  if (withPolice) updatePolice(dt);
  integrateAll(dt);
  updateWorld(dt);
  updateEffects(dt);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  S.time += dt;

  const muteNow = Boolean(keys.KeyM);
  if (muteNow && !lastMuteKey) S.notify(toggleMute() ? 'Sound off' : 'Sound on');
  lastMuteKey = muteNow;
  const pauseNow = Boolean(keys.KeyP || keys.Escape);
  if (pauseNow && !lastPauseKey && (S.mode === 'playing' || S.mode === 'paused')) togglePause();
  lastPauseKey = pauseNow;

  if (overlayUntil && S.time > overlayUntil) {
    overlayEl.style.display = 'none';
    overlayUntil = 0;
    if (S.mode === 'busted' || S.mode === 'wasted') S.mode = 'playing';
  }

  switch (S.mode) {
    case 'menu': {
      // The city lives behind the title: a slow aerial drift over downtown.
      const t = S.time * 0.05;
      S.camera.position.set(Math.sin(t) * 150, 55, Math.cos(t) * 150);
      S.camera.lookAt(0, 0, 0);
      simulateCity(dt, false);
      break;
    }
    case 'scene': {
      if (S.sceneName === 'chase') updatePolice(dt);
      updateTraffic(dt);
      updatePedestrians(dt);
      integrateAll(dt);
      updateWorld(dt);
      updateEffects(dt);
      updateScene(dt);
      updateHud();
      break;
    }
    case 'dialogue': {
      updateDialogue(dt);
      simulateCity(dt, true);
      updateHud();
      break;
    }
    case 'playing': {
      if (S.busted) {
        handleBusted();
        break;
      }
      if (S.player.dead) {
        handleWasted();
        break;
      }
      updatePlayer(dt);
      updateTraffic(dt);
      updatePedestrians(dt);
      updatePolice(dt);
      updateCombat(dt);
      updateMissions(dt);
      integrateAll(dt);
      updateWorld(dt);
      updateEffects(dt);
      updateEngine(
        S.player.inVehicle ? Math.abs(S.player.inVehicle.speed) / S.player.inVehicle.spec.topSpeed : 0,
        Boolean(S.player.inVehicle),
      );
      updateHud();
      break;
    }
    case 'busted':
    case 'wasted': {
      simulateCity(dt, false);
      break;
    }
    default:
      break; // 'paused': the world holds its breath
  }
  S.renderer.render(S.scene, S.camera);
}

function boot() {
  const canvas = document.getElementById('game');
  S.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  S.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  S.renderer.setSize(window.innerWidth, window.innerHeight);
  S.renderer.shadowMap.enabled = true;
  S.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  S.renderer.outputColorSpace = THREE.SRGBColorSpace;
  S.scene = new THREE.Scene();
  S.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3200);
  S.camera.position.set(-40, 26, -60);
  window.addEventListener('resize', () => {
    S.camera.aspect = window.innerWidth / window.innerHeight;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(window.innerWidth, window.innerHeight);
  });

  buildWorld();
  initEffects();
  initPlayer();
  spawnParkedCars();
  initTraffic();
  initPedestrians();
  initMissions();
  initHud();
  initInput(canvas, () => initAudio());

  document.getElementById('btnNew').addEventListener('click', () => startGame(true));
  document.getElementById('btnContinue').addEventListener('click', () => startGame(false));
  document.getElementById('btnResume').addEventListener('click', () => togglePause());
  document.getElementById('btnSave').addEventListener('click', () => {
    saveGame();
    S.notify('Game saved', 'good');
    togglePause();
  });
  document.getElementById('btnQuit').addEventListener('click', () => {
    saveGame();
    toMenu();
  });
  canvas.addEventListener('click', () => {
    if (S.mode === 'playing') lockPointer();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && S.mode === 'playing') togglePause();
  });

  // A handle for automated verification: state plus the verbs a test needs.
  window.SolanoHeat = { S, startGame, placePlayer, startMission };

  const params = new URLSearchParams(window.location.search);
  const scene = params.get('scene') || params.get('shot');
  clock = new THREE.Clock();
  if (scene) {
    menuEl.style.display = 'none';
    setHudVisible(true);
    stageScene(scene === 'play' ? 'chase' : scene === 'start' ? 'downtown' : scene === 'end' ? 'harbor' : scene);
  } else {
    toMenu();
  }
  frame();
}

boot();
