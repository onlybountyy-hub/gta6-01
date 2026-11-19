// player.js — Marco Vale: the man, his walk, his camera and his car door.
//
// On foot he is the pedestrian figure in a red jacket and flat cap, animated by
// the same limb rig as the crowd. Movement is camera-relative; the camera is a
// mouse orbit that drifts behind a moving car. F enters and exits vehicles —
// taking one that is not a mission car is grand theft auto, and the wanted
// system hears about it. The punch lives here; the pistol lives in combat.js.

import * as THREE from 'three';
import { PLAYER, PLACES, CRIME } from './config.js';
import { S } from './state.js';
import { keys, takeMouseDelta, takeClick } from './input.js';
import { buildPedMesh, punchPedestrian } from './pedestrians.js';
import { collideCircle, clampToWorld } from './world.js';
import { drivePlayerVehicle } from './vehicles.js';
import { playPunch } from './audio.js';

let gunMesh = null;
let enterCooldown = 0;
let punchTimer = 0;

/** Create Marco's mesh — red jacket, dark jeans, flat cap, holstered pistol prop. */
export function initPlayer() {
  const mesh = buildPedMesh(0xc23b22, 0x232733, 0xd9a066);
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.09, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x1d2c3a }),
  );
  cap.position.y = 1.79;
  mesh.add(cap);
  gunMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.12, 0.34),
    new THREE.MeshLambertMaterial({ color: 0x14161a }),
  );
  gunMesh.position.set(0.31, 0.78, 0.22);
  gunMesh.visible = false;
  mesh.add(gunMesh);
  S.scene.add(mesh);
  S.player.mesh = mesh;
  placePlayer(PLACES.spawn.x, PLACES.spawn.z, 2.2);
}

/** Teleport the player (respawns, continues and scene staging all land here). */
export function placePlayer(x, z, heading = 0) {
  S.player.x = x;
  S.player.z = z;
  S.player.heading = heading;
  S.player.mesh.position.set(x, 0, z);
  S.player.mesh.rotation.y = heading;
}

/** F: climb into the nearest usable car, or out of the current one. */
export function tryEnterExit() {
  const p = S.player;
  if (enterCooldown > 0) return;
  enterCooldown = 0.45;
  if (p.inVehicle) {
    const v = p.inVehicle;
    p.inVehicle = null;
    v.parked = true;
    // Step out on the car's left side.
    const side = { x: Math.cos(v.heading), z: -Math.sin(v.heading) };
    const spot = collideCircle(v.x + side.x * 2.2, v.z + side.z * 2.2, PLAYER.radius);
    placePlayer(spot.x, spot.z, v.heading);
    p.mesh.visible = true;
    return;
  }
  let best = null;
  let bestDist = PLAYER.enterCarRange;
  for (const v of S.vehicles) {
    const d = Math.hypot(v.x - p.x, v.z - p.z);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  if (!best) return;
  if (!best.missionMark) {
    S.addCrime(best.type === 'cruiser' ? CRIME.stealCar + 12 : CRIME.stealCar);
    if (best.ai && best.ai.role === 'traffic') S.notify('Vehicle stolen', 'bad');
  }
  best.ai = null;
  best.parked = false;
  p.inVehicle = best;
  p.mesh.visible = false;
  S.cam.yaw = best.heading;
}

/** Orbit camera: mouse-steered on foot, chase-drift behind a moving car. */
function updateCamera(dt) {
  const p = S.player;
  const cam = S.cam;
  const delta = takeMouseDelta();
  cam.yaw -= delta.x * 0.0026;
  cam.pitch = Math.max(-0.12, Math.min(1.05, cam.pitch + delta.y * 0.0022));
  const inCar = Boolean(p.inVehicle);
  const targetDist = inCar ? 11.5 : 7.2;
  cam.distance += (targetDist - cam.distance) * Math.min(1, dt * 4);
  if (inCar && Math.abs(p.inVehicle.speed) > 5 && delta.x === 0) {
    let diff = p.inVehicle.heading - cam.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cam.yaw += diff * Math.min(1, dt * 1.1);
  }
  const focus = inCar
    ? { x: p.inVehicle.x, y: 1.5, z: p.inVehicle.z }
    : { x: p.x, y: 1.55, z: p.z };
  const backX = Math.sin(cam.yaw) * Math.cos(cam.pitch);
  const backZ = Math.cos(cam.yaw) * Math.cos(cam.pitch);
  cam.x = focus.x - backX * cam.distance;
  cam.z = focus.z - backZ * cam.distance;
  cam.y = Math.max(0.7, focus.y + Math.sin(cam.pitch) * cam.distance + 0.6);
  S.camera.position.set(cam.x, cam.y, cam.z);
  S.camera.lookAt(focus.x, focus.y + 0.4, focus.z);
}

/** A short-range swing at the nearest person standing in front of Marco. */
function tryPunch() {
  const p = S.player;
  if (p.punchCooldown > 0 || p.gunDrawn) return;
  p.punchCooldown = 0.42;
  punchTimer = 0.22;
  playPunch();
  const fx = Math.sin(p.heading);
  const fz = Math.cos(p.heading);
  for (const ped of S.peds) {
    if (ped.dead) continue;
    const dx = ped.x - p.x;
    const dz = ped.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < PLAYER.punchRange && (dx * fx + dz * fz) / Math.max(0.01, d) > 0.35) {
      punchPedestrian(ped);
      return;
    }
  }
}

/** Advance the player one frame: drive the car, or walk the man and pose him. */
export function updatePlayer(dt) {
  const p = S.player;
  enterCooldown = Math.max(0, enterCooldown - dt);
  p.punchCooldown = Math.max(0, p.punchCooldown - dt);
  punchTimer = Math.max(0, punchTimer - dt);

  if (keys.KeyF) tryEnterExit();

  if (p.inVehicle) {
    const v = p.inVehicle;
    drivePlayerVehicle(v, dt, {
      throttle: Boolean(keys.KeyW || keys.ArrowUp),
      brake: Boolean(keys.KeyS || keys.ArrowDown),
      steerLeft: Boolean(keys.KeyA || keys.ArrowLeft),
      steerRight: Boolean(keys.KeyD || keys.ArrowRight),
      handbrake: Boolean(keys.Space),
    });
    p.x = v.x;
    p.z = v.z;
    p.heading = v.heading;
    p.speed = Math.abs(v.speed);
  } else {
    // Camera-relative movement: view forward is (sin yaw, cos yaw) and
    // screen-right is (-cos yaw, sin yaw).
    const yaw = S.cam.yaw;
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    let mx = 0;
    let mz = 0;
    if (keys.KeyW || keys.ArrowUp) { mx += fwd.x; mz += fwd.z; }
    if (keys.KeyS || keys.ArrowDown) { mx -= fwd.x; mz -= fwd.z; }
    if (keys.KeyD || keys.ArrowRight) { mx += right.x; mz += right.z; }
    if (keys.KeyA || keys.ArrowLeft) { mx -= right.x; mz -= right.z; }
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      mx /= len;
      mz /= len;
      const speed = keys.ShiftLeft || keys.ShiftRight ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      p.speed = speed;
      p.x += mx * speed * dt;
      p.z += mz * speed * dt;
      let diff = Math.atan2(mx, mz) - p.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.heading += diff * Math.min(1, dt * 11);
      p.walkPhase += dt * speed * 1.65;
    } else {
      p.speed = 0;
    }
    const hit = collideCircle(p.x, p.z, PLAYER.radius);
    p.x = hit.x;
    p.z = hit.z;
    const clamped = clampToWorld(p.x, p.z);
    p.x = clamped.x;
    p.z = clamped.z;

    const u = p.mesh.userData;
    const swing = Math.sin(p.walkPhase) * Math.min(0.6, p.speed * 0.09);
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    if (p.gunDrawn) {
      u.armR.rotation.x = -1.35;
      u.armL.rotation.x = -1.1;
    } else if (punchTimer > 0) {
      u.armR.rotation.x = -1.9 + (0.22 - punchTimer) * 4;
      u.armL.rotation.x = 0;
    } else {
      u.armR.rotation.x = -swing * 0.8;
      u.armL.rotation.x = swing * 0.8;
    }
    const onPier = p.x > 356 && Math.abs(p.z - PLACES.pierEnd.z) < 15;
    p.mesh.position.set(p.x, onPier ? 1.05 : 0, p.z);
    p.mesh.rotation.y = p.heading;
    // Clicks punch only while the gun is away; combat.js owns them otherwise.
    if (!p.gunDrawn && takeClick()) tryPunch();
  }

  if (gunMesh) gunMesh.visible = p.gunDrawn && !p.inVehicle;
  updateCamera(dt);
}
