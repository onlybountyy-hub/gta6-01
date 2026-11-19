// player.js — Marco Vale himself: the on-foot character and its animation, the
// third-person camera (mouse orbit on foot, chase orbit in a car), getting in and
// out of vehicles, and the punch. Combat with the pistol lives in combat.js; this
// file owns everything about moving the man.

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

/** Create Marco's mesh (red jacket, dark jeans) and his pistol prop. */
export function initPlayer() {
  const mesh = buildPedMesh(0xc23b22, 0x232733, 0xd9a066);
  // A flat cap so the player reads differently from the crowd.
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

/** Teleport the player (used by respawns and scene staging). */
export function placePlayer(x, z, heading = 0) {
  S.player.x = x;
  S.player.z = z;
  S.player.heading = heading;
  S.player.mesh.position.set(x, 0, z);
  S.player.mesh.rotation.y = heading;
}

/** Enter the nearest usable car, or climb out of the current one. */
export function tryEnterExit() {
  const p = S.player;
  if (enterCooldown > 0) return;
  enterCooldown = 0.45;
  if (p.inVehicle) {
    const v = p.inVehicle;
    p.inVehicle = null;
    v.parked = true;
    // Step out on the left side of the car.
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
    // Taking a car that is not yours is a crime, worse if it says POLICE on it.
    S.addCrime(best.type === 'cruiser' ? CRIME.stealCar + 12 : CRIME.stealCar);
    if (best.ai && best.ai.role === 'traffic') S.notify('Vehicle stolen', 'bad');
  }
  best.ai = null;
  best.parked = false;
  p.inVehicle = best;
  p.mesh.visible = false;
  S.cam.yaw = best.heading;
}

/** Where the camera wants to look from, given the mode and the mouse. */
function updateCamera(dt) {
  const p = S.player;
  const cam = S.cam;
  const delta = takeMouseDelta();
  cam.yaw -= delta.x * 0.0026;
  cam.pitch += delta.y * 0.0022;
  cam.pitch = Math.max(-0.12, Math.min(1.05, cam.pitch));
  const inCar = Boolean(p.inVehicle);
  const targetDist = inCar ? 11.5 : 7.2;
  cam.distance += (targetDist - cam.distance) * Math.min(1, dt * 4);
  // In a moving car with no mouse input, drift round behind it.
  if (inCar && Math.abs(p.inVehicle.speed) > 5 && delta.x === 0) {
    let diff = p.inVehicle.heading - cam.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cam.yaw += diff * Math.min(1, dt * 1.1);
  }
  const focus = inCar
    ? { x: p.inVehicle.x, y: 1.5, z: p.inVehicle.z }
    : { x: p.x, y: 1.55, z: p.z };
  const back = {
    x: Math.sin(cam.yaw) * Math.cos(cam.pitch),
    z: Math.cos(cam.yaw) * Math.cos(cam.pitch),
  };
  cam.x = focus.x - back.x * cam.distance;
  cam.z = focus.z - back.z * cam.distance;
  cam.y = focus.y + Math.sin(cam.pitch) * cam.distance + 0.6;
  if (cam.y < 0.7) cam.y = 0.7;
  S.camera.position.set(cam.x, cam.y, cam.z);
  S.camera.lookAt(focus.x, focus.y + 0.4, focus.z);
}

/** The punch: a short-range swing that connects with the nearest person ahead. */
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

/** Advance the player (and the driven car) one frame. */
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
    // Movement is relative to where the camera looks: the view direction is
    // (sin yaw, cos yaw) and screen-right is (-cos yaw, sin yaw).
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
    const sprinting = keys.ShiftLeft || keys.ShiftRight;
    if (len > 0.01) {
      mx /= len;
      mz /= len;
      const speed = sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      p.speed = speed;
      p.x += mx * speed * dt;
      p.z += mz * speed * dt;
      const targetHeading = Math.atan2(mx, mz);
      let diff = targetHeading - p.heading;
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
    // Animate the figure.
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
    // Clicks punch only with the gun away; combat.js takes them when it is drawn.
    if (!p.gunDrawn && takeClick()) tryPunch();
  }

  if (gunMesh) gunMesh.visible = p.gunDrawn && !p.inVehicle;
  updateCamera(dt);
}
