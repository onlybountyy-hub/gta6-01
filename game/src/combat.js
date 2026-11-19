// combat.js — Marco's pistol and the player's own mortality. Drawing the gun (right
// mouse, or R to latch it) turns clicks into shots: a ray from the camera through the
// crosshair, resolved against pedestrians, vehicles, buildings and the ground, with
// tracers, sparks and a muzzle flash. This file also applies damage to the player
// (mostly from being run down) and handles slow health recovery.

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

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();

/** Hurt the player; death itself is staged by main.js when health runs out. */
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

/** Ray vs sphere: returns the distance along the ray, or Infinity. */
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

/** Ray vs a building AABB (slab test): distance or Infinity. */
function rayAabb(origin, dir, c) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [origin.x, dir.x, c.minX, c.maxX],
    [origin.z, dir.z, c.minZ, c.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
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
  // Buildings stand 60 m tall at most for this test; ignore hits above the roofline
  // band by checking the y at tmin against a generous cap.
  const y = origin.y + dir.y * tmin;
  if (y > 65) return Infinity;
  return tmin;
}

/** Fire one shot from the camera through the crosshair. */
function fire() {
  const p = S.player;
  S.camera.getWorldDirection(_dir);
  _origin.copy(S.camera.position);
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
    const t = raySphere(_origin, _dir, ped.x, 1.05, ped.z, 0.8);
    if (t < bestT) {
      bestT = t;
      hitKind = 'ped';
      hitRef = ped;
    }
  }
  for (const v of S.vehicles) {
    const t = raySphere(_origin, _dir, v.x, 0.95, v.z, v.radius + 0.7);
    if (t < bestT) {
      bestT = t;
      hitKind = 'vehicle';
      hitRef = v;
    }
  }
  for (const c of S.colliders) {
    if (c.pier) continue;
    const t = rayAabb(_origin, _dir, c);
    if (t < bestT) {
      bestT = t;
      hitKind = 'wall';
      hitRef = null;
    }
  }
  if (_dir.y < -0.001) {
    const tGround = -_origin.y / _dir.y;
    if (tGround > 0 && tGround < bestT) {
      bestT = tGround;
      hitKind = 'ground';
      hitRef = null;
    }
  }
  const hitPoint = {
    x: _origin.x + _dir.x * bestT,
    y: _origin.y + _dir.y * bestT,
    z: _origin.z + _dir.z * bestT,
  };
  spawnTracer(muzzle, hitPoint);
  if (hitKind === 'ped') {
    shootPedestrian(hitRef, GUN_DAMAGE);
    S.addCrime(CRIME.shotHitsPerson);
    spawnParticles(hitPoint.x, hitPoint.y, hitPoint.z, { count: 6, color: 0xa02020, speed: 2, life: 0.4, gravity: -6, up: 1.5 });
  } else if (hitKind === 'vehicle') {
    damageVehicle(hitRef, 14, false);
    if (hitRef.type === 'cruiser') S.addCrime(CRIME.shotHitsPolice);
    spawnSparks(hitPoint.x, hitPoint.y, hitPoint.z);
  } else if (hitKind === 'wall' || hitKind === 'ground') {
    spawnSparks(hitPoint.x, hitPoint.y, hitPoint.z);
  }
}

/** Advance combat: draw state, firing, run-over hazards and health recovery. */
export function updateCombat(dt) {
  const p = S.player;
  fireTimer = Math.max(0, fireTimer - dt);
  hazardTimer = Math.max(0, hazardTimer - dt);

  const rNow = Boolean(keys.KeyR);
  if (rNow && !lastR) latched = !latched;
  lastR = rNow;
  p.gunDrawn = !p.inVehicle && (mouseDownRight || latched);
  if (p.gunDrawn) {
    // Aim where the camera aims.
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
        // Knocked aside.
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
