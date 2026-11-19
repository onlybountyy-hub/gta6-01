// combat.js — Marco's pistol, and Marco's mortality.
//
// Holding the right mouse button (or latching with R) draws the gun and turns
// clicks into shots: a ray from the camera through the crosshair, resolved
// against pedestrians, vehicles, building boxes and the ground, dressed with a
// tracer, sparks and a muzzle flash. Every shot is a crime the whole street
// hears. This module also hurts the player — mostly by being run over — and
// handles the slow recovery once the shooting stops.

import * as THREE from 'three';
import { CRIME, PLAYER } from './config.js';
import { S } from './state.js';
import { keys, mouseDownRight, takeClick } from './input.js';
import { shootPedestrian, panicAt } from './pedestrians.js';
import { damageVehicle } from './vehicles.js';
import { spawnTracer, spawnSparks, spawnParticles, muzzleFlash } from './effects.js';
import { playGunshot } from './audio.js';

const FIRE_COOLDOWN = 0.21;
const GUN_DAMAGE = 62;
let fireTimer = 0;
let latched = false;
let lastR = false;
let hazardTimer = 0;

const rayDir = new THREE.Vector3();
const rayOrigin = new THREE.Vector3();

/** Hurt the player. Death itself is staged by main.js when health runs out. */
export function damagePlayer(amount) {
  const p = S.player;
  if (p.dead || S.mode !== 'playing') return;
  p.health -= amount;
  p.lastDamageAt = S.time;
  if (p.health <= 0) {
    p.health = 0;
    p.dead = true;
  }
}

/** Ray vs sphere: the distance along the ray to the surface, or Infinity. */
function raySphere(origin, dir, cx, cy, cz, r) {
  const ox = cx - origin.x;
  const oy = cy - origin.y;
  const oz = cz - origin.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  if (t < 0) return Infinity;
  const d2 = ox * ox + oy * oy + oz * oz - t * t;
  if (d2 > r * r) return Infinity;
  return t - Math.sqrt(r * r - d2);
}

/** Ray vs a building's footprint, slab test in plan view with a roofline cap. */
function rayAabb(origin, dir, c) {
  let tmin = 0;
  let tmax = Infinity;
  for (const [o, d, lo, hi] of [
    [origin.x, dir.x, c.minX, c.maxX],
    [origin.z, dir.z, c.minZ, c.maxZ],
  ]) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  // No building stands taller than 65 m for this test's purposes.
  if (origin.y + dir.y * tmin > 65) return Infinity;
  return tmin;
}

/** Fire one shot from the camera through the crosshair. */
function fire() {
  const p = S.player;
  S.camera.getWorldDirection(rayDir);
  rayOrigin.copy(S.camera.position);
  const muzzle = {
    x: p.x + Math.sin(p.heading) * 0.55,
    y: 1.32,
    z: p.z + Math.cos(p.heading) * 0.55,
  };
  muzzleFlash(muzzle.x, muzzle.y, muzzle.z);
  playGunshot();
  S.addCrime(CRIME.shotFired);
  panicAt(p.x, p.z, 24);

  let bestT = 130;
  let hitKind = null;
  let hitRef = null;
  for (const ped of S.peds) {
    if (ped.dead) continue;
    const t = raySphere(rayOrigin, rayDir, ped.x, 1.05, ped.z, 0.8);
    if (t < bestT) {
      bestT = t;
      hitKind = 'ped';
      hitRef = ped;
    }
  }
  for (const v of S.vehicles) {
    const t = raySphere(rayOrigin, rayDir, v.x, 0.95, v.z, v.radius + 0.7);
    if (t < bestT) {
      bestT = t;
      hitKind = 'vehicle';
      hitRef = v;
    }
  }
  for (const c of S.colliders) {
    if (c.pier) continue;
    const t = rayAabb(rayOrigin, rayDir, c);
    if (t < bestT) {
      bestT = t;
      hitKind = 'wall';
      hitRef = null;
    }
  }
  if (rayDir.y < -0.001) {
    const tGround = -rayOrigin.y / rayDir.y;
    if (tGround > 0 && tGround < bestT) {
      bestT = tGround;
      hitKind = 'ground';
      hitRef = null;
    }
  }
  const hitPoint = {
    x: rayOrigin.x + rayDir.x * bestT,
    y: rayOrigin.y + rayDir.y * bestT,
    z: rayOrigin.z + rayDir.z * bestT,
  };
  spawnTracer(muzzle, hitPoint);
  if (hitKind === 'ped') {
    shootPedestrian(hitRef, GUN_DAMAGE);
    S.addCrime(CRIME.shotHitsPerson);
    spawnParticles(hitPoint.x, hitPoint.y, hitPoint.z, { count: 6, color: 0xa02020, speed: 2, life: 0.4, gravity: -6, up: 1.5 });
  } else if (hitKind === 'vehicle') {
    damageVehicle(hitRef, 14);
    if (hitRef.type === 'cruiser') S.addCrime(CRIME.shotHitsPolice);
    spawnSparks(hitPoint.x, hitPoint.y, hitPoint.z);
  } else if (hitKind === 'wall' || hitKind === 'ground') {
    spawnSparks(hitPoint.x, hitPoint.y, hitPoint.z);
  }
}

/** Advance combat: draw state, firing, run-over hazards, health recovery. */
export function updateCombat(dt) {
  const p = S.player;
  fireTimer = Math.max(0, fireTimer - dt);
  hazardTimer = Math.max(0, hazardTimer - dt);

  const rNow = Boolean(keys.KeyR);
  if (rNow && !lastR) latched = !latched;
  lastR = rNow;
  p.gunDrawn = !p.inVehicle && (mouseDownRight || latched);
  if (p.gunDrawn) {
    // Aiming turns the man to face where the camera faces.
    p.heading = S.cam.yaw;
    if (takeClick() && fireTimer <= 0) {
      fireTimer = FIRE_COOLDOWN;
      fire();
    }
  }

  // Being run down hurts, whoever is driving.
  if (!p.inVehicle && hazardTimer <= 0) {
    for (const v of S.vehicles) {
      if (Math.abs(v.speed) > 4.5 && Math.hypot(v.x - p.x, v.z - p.z) < 2.1) {
        damagePlayer(14 + Math.abs(v.speed) * 0.7);
        hazardTimer = 0.9;
        const dx = p.x - v.x;
        const dz = p.z - v.z;
        const d = Math.max(0.5, Math.hypot(dx, dz));
        p.x += (dx / d) * 2.4;
        p.z += (dz / d) * 2.4;
        S.notify('You got run over!', 'bad');
        break;
      }
    }
  }

  // Slow recovery once the shooting stops.
  if (!p.dead && p.health < PLAYER.maxHealth && S.time - p.lastDamageAt > 8) {
    p.health = Math.min(PLAYER.maxHealth, p.health + 6 * dt);
  }
}
