// vehicles.js — every car in Port Solano, from mesh to motion.
//
// Cars are assembled from primitives (a body, a glass cabin, lights, spinning
// wheels, and for PSPD cruisers a light bar and white doors). This module owns
// spawning and removal, the arcade driving model the player uses, the shared
// steering helpers the AI drivers use, per-frame integration with building
// collision, and car-against-car resolution.

import * as THREE from 'three';
import { CAR_TYPES, DRIVING, PLACES } from './config.js';
import { S } from './state.js';
import { makeRng, pick, randRange } from './random.js';
import { collideCircle, clampToWorld } from './world.js';
import { spawnSmoke } from './effects.js';
import { playCrash } from './audio.js';

export const CAR_COLORS = [0xd94f30, 0x2f6db8, 0xe8e3d8, 0x3f9e58, 0xc7a23a, 0x7456a6, 0x22262b, 0xb8bcc2, 0x7fb3c8, 0xe07ba0];

const geoCache = new Map();
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(key);
}
const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
wheelGeo.rotateZ(Math.PI / 2); // axle along X

/** Assemble one car's visible mesh. Wheels and light-bar parts land in userData. */
export function buildCarMesh(type, colorHex) {
  const spec = CAR_TYPES[type];
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: colorHex });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1d2c3a });
  const trim = new THREE.MeshLambertMaterial({ color: 0x17191d });

  const body = new THREE.Mesh(boxGeo(spec.width, spec.height * 0.62, spec.length), paint);
  body.position.y = 0.42 + spec.height * 0.28;
  group.add(body);
  const cabin = new THREE.Mesh(boxGeo(spec.width * 0.86, spec.height * 0.5, spec.length * 0.46), glass);
  cabin.position.set(0, 0.42 + spec.height * 0.78, -spec.length * 0.04);
  group.add(cabin);
  if (type === 'truck') {
    const bed = new THREE.Mesh(boxGeo(spec.width * 0.96, spec.height * 0.42, spec.length * 0.4), paint);
    bed.position.set(0, 0.42 + spec.height * 0.62, spec.length * 0.28);
    group.add(bed);
  }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xd42a2a });
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(boxGeo(0.34, 0.16, 0.06), headMat);
    head.position.set(sx * spec.width * 0.32, 0.72, spec.length / 2 + 0.01);
    group.add(head);
    const tail = new THREE.Mesh(boxGeo(0.34, 0.14, 0.06), tailMat);
    tail.position.set(sx * spec.width * 0.32, 0.78, -spec.length / 2 - 0.01);
    group.add(tail);
  }
  const wheels = [];
  const frontWheels = [];
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141518 });
  for (const [wx, wz, isFront] of [
    [-spec.width / 2, spec.length * 0.32, true],
    [spec.width / 2, spec.length * 0.32, true],
    [-spec.width / 2, -spec.length * 0.32, false],
    [spec.width / 2, -spec.length * 0.32, false],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.36, wz);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    pivot.add(wheel);
    group.add(pivot);
    wheels.push(wheel);
    if (isFront) frontWheels.push(pivot);
  }
  group.userData = { wheels, frontWheels, lightRed: null, lightBlue: null };
  if (type === 'cruiser') {
    const barBase = new THREE.Mesh(boxGeo(1.1, 0.1, 0.4), trim);
    barBase.position.set(0, 0.42 + spec.height * 1.06, -spec.length * 0.04);
    group.add(barBase);
    const red = new THREE.Mesh(boxGeo(0.5, 0.16, 0.36), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    red.position.set(-0.28, 0.42 + spec.height * 1.06 + 0.12, -spec.length * 0.04);
    const blue = new THREE.Mesh(boxGeo(0.5, 0.16, 0.36), new THREE.MeshBasicMaterial({ color: 0x2a5cff }));
    blue.position.set(0.28, 0.42 + spec.height * 1.06 + 0.12, -spec.length * 0.04);
    group.add(red);
    group.add(blue);
    group.userData.lightRed = red;
    group.userData.lightBlue = blue;
    // White doors on a black body: reads as POLICE from two blocks away.
    const doorMat = new THREE.MeshLambertMaterial({ color: 0xf0f0ea });
    for (const sx of [-1, 1]) {
      const door = new THREE.Mesh(boxGeo(0.03, spec.height * 0.4, spec.length * 0.4), doorMat);
      door.position.set(sx * (spec.width / 2 + 0.01), 0.42 + spec.height * 0.3, 0);
      group.add(door);
    }
  }
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return group;
}

/** Create a vehicle record and its mesh, and register both in S.vehicles. */
export function spawnVehicle(type, colorHex, x, z, heading, opts = {}) {
  const spec = CAR_TYPES[type];
  const mesh = buildCarMesh(type, type === 'cruiser' ? 0x23262b : colorHex);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  S.scene.add(mesh);
  const vehicle = {
    mesh,
    type,
    spec,
    x,
    z,
    heading,
    speed: 0,
    steer: 0,
    health: 100,
    radius: DRIVING.radius * (spec.length / 4.4),
    ai: opts.ai || null, // {role: 'traffic' | 'police', ...}; null when parked or player-driven
    parked: Boolean(opts.parked),
    missionMark: false,
    smokeTimer: Math.random(),
    wheelSpin: 0,
    dead: false,
  };
  S.vehicles.push(vehicle);
  return vehicle;
}

/** Remove a vehicle from the world entirely (police.js despawning far units). */
export function removeVehicle(vehicle) {
  const idx = S.vehicles.indexOf(vehicle);
  if (idx >= 0) S.vehicles.splice(idx, 1);
  S.scene.remove(vehicle.mesh);
}

/** Scatter locked civilian cars through the lot bays world.js marked out. */
export function spawnParkedCars() {
  const rng = makeRng(S.seed + 77);
  const spots = S.parkingSpots.filter((s) => !s.park);
  const count = Math.min(spots.length, 30);
  for (let i = 0; i < count; i += 1) {
    const spot = spots[Math.floor(rng() * spots.length)];
    if (S.vehicles.some((v) => Math.abs(v.x - spot.x) < 3 && Math.abs(v.z - spot.z) < 3)) continue;
    spawnVehicle(pick(rng, ['sedan', 'sedan', 'hatch', 'truck']), pick(rng, CAR_COLORS), spot.x, spot.z, spot.heading || 0, { parked: true });
  }
}

/** The forward vector of a heading angle. */
export function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/**
 * Move one vehicle for one frame: advance along its heading, resolve building
 * and world-edge collisions (a hard hit costs health), sync the mesh including
 * wheel spin and front-wheel steer, and puff smoke when the engine is hurt.
 */
export function integrateVehicle(v, dt) {
  const fwd = forwardOf(v.heading);
  v.x += fwd.x * v.speed * dt;
  v.z += fwd.z * v.speed * dt;
  const hit = collideCircle(v.x, v.z, v.radius);
  if (hit.x !== v.x || hit.z !== v.z) {
    if (Math.abs(v.speed) > 7) {
      damageVehicle(v, Math.abs(v.speed) * 0.55);
      if (S.player.inVehicle === v) S.notify('Crash!');
    }
    v.x = hit.x;
    v.z = hit.z;
    v.speed *= 0.35;
  }
  const clamped = clampToWorld(v.x, v.z);
  v.x = clamped.x;
  v.z = clamped.z;
  const onPier = v.x > 356 && Math.abs(v.z - PLACES.pierEnd.z) < 15;
  v.mesh.position.set(v.x, onPier ? 1.05 : 0, v.z);
  v.mesh.rotation.y = v.heading;
  v.wheelSpin += (v.speed * dt) / 0.36;
  for (const wheel of v.mesh.userData.wheels) wheel.rotation.x = v.wheelSpin;
  for (const pivot of v.mesh.userData.frontWheels) pivot.rotation.y = v.steer * 0.45;
  if (v.health < 55 && !v.dead) {
    v.smokeTimer -= dt;
    if (v.smokeTimer <= 0) {
      v.smokeTimer = v.health < 25 ? 0.08 : 0.22;
      spawnSmoke(v.x + fwd.x * v.spec.length * 0.4, 1.1, v.z + fwd.z * v.spec.length * 0.4, v.health < 25);
    }
  }
}

/** Car against car: separate overlaps, trade momentum, bill both for the damage. */
export function collideVehicles() {
  const list = S.vehicles;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const minDist = a.radius + b.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      const overlap = (minDist - d) / 2;
      a.x -= nx * overlap;
      a.z -= nz * overlap;
      b.x += nx * overlap;
      b.z += nz * overlap;
      const relSpeed = Math.abs(a.speed - b.speed);
      if (relSpeed > 5) {
        damageVehicle(a, relSpeed * 0.5);
        damageVehicle(b, relSpeed * 0.5);
        if (S.player.inVehicle === a || S.player.inVehicle === b) {
          playCrash(Math.min(1, relSpeed / 22));
          if (b.ai && b.ai.role === 'traffic') S.addCrime(8);
        }
      }
      const swap = ((a.speed + b.speed) / 2) * 0.8;
      a.speed = swap;
      b.speed = swap;
    }
  }
}

/** Apply damage; at zero health a car is a wreck that will never move again. */
export function damageVehicle(v, amount) {
  if (v.dead) return;
  v.health -= amount;
  if (v.health <= 0) {
    v.health = 0;
    v.dead = true;
    v.speed = 0;
  }
}

/**
 * The player's driving model: throttle, brake-that-becomes-reverse, drag,
 * speed-sensitive steering, and a handbrake that trades grip for turn rate.
 */
export function drivePlayerVehicle(v, dt, input) {
  const topSpeed = v.dead ? 0 : v.spec.topSpeed;
  if (input.throttle) {
    v.speed += v.spec.accel * dt * (v.speed < 0 ? 2.2 : 1);
  } else if (input.brake) {
    if (v.speed > 0.6) v.speed -= DRIVING.brake * dt;
    else v.speed = Math.max(-DRIVING.reverseMax, v.speed - v.spec.accel * 0.7 * dt);
  }
  v.speed -= v.speed * DRIVING.drag * dt;
  if (!input.throttle && !input.brake) {
    v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 2.2 * dt);
  }
  v.speed = Math.max(-DRIVING.reverseMax, Math.min(topSpeed, v.speed));
  const steerTarget = (input.steerLeft ? 1 : 0) - (input.steerRight ? 1 : 0);
  v.steer += (steerTarget - v.steer) * Math.min(1, dt * 7);
  const speedFactor = Math.min(1, Math.abs(v.speed) / 9);
  const turnRate = input.handbrake ? DRIVING.handbrakeTurnRate : DRIVING.gripTurnRate;
  if (Math.abs(v.speed) > 0.2) {
    v.heading += v.steer * turnRate * speedFactor * dt * Math.sign(v.speed);
  }
  if (input.handbrake) v.speed -= v.speed * 1.4 * dt;
}

/** Steer an AI vehicle toward a point at a capped turn rate; returns distance left. */
export function steerToward(v, tx, tz, dt, turnRate = 1.9) {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const dist = Math.hypot(dx, dz);
  let diff = Math.atan2(dx, dz) - v.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  v.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
  v.steer = Math.max(-1, Math.min(1, diff * 1.6));
  return dist;
}

/** Ease an AI vehicle's speed toward a target using its own accel/brake limits. */
export function approachSpeed(v, target, dt) {
  const accel = target > v.speed ? v.spec.accel : DRIVING.brake;
  if (v.speed < target) v.speed = Math.min(target, v.speed + accel * dt);
  else v.speed = Math.max(target, v.speed - accel * dt);
}
