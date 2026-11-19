// pedestrians.js — the people of Port Solano.
//
// Each pedestrian is a small articulated figure of boxes — swinging arms and
// legs, no model files — who strolls the sidewalks between random destinations,
// panics and runs when violence happens nearby, and can be knocked down by
// fists, bullets and bumpers. The downed recover and flee; the dead are quietly
// replaced across town so the city never empties.

import * as THREE from 'three';
import { CRIME } from './config.js';
import { S } from './state.js';
import { makeRng, pick, randRange } from './random.js';
import { collideCircle, clampToWorld } from './world.js';
import { playPunch } from './audio.js';

const PED_COUNT = 22;
const SKIN = [0xf2c89b, 0xd9a066, 0xa06a38, 0x6e4525, 0xffe0bd];
const SHIRTS = [0xd94f30, 0x2f6db8, 0x3f9e58, 0xc7a23a, 0xe07ba0, 0xe8e3d8, 0x7456a6, 0x35b5ac];
const PANTS = [0x2c3550, 0x4a3b2c, 0x22262b, 0x707880, 0x7a2e2e];
const rng = makeRng(9182);

const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.19);
legGeo.translate(0, -0.39, 0);
const armGeo = new THREE.BoxGeometry(0.13, 0.66, 0.15);
armGeo.translate(0, -0.3, 0);
const torsoGeo = new THREE.BoxGeometry(0.46, 0.62, 0.24);
const headGeo = new THREE.BoxGeometry(0.26, 0.3, 0.26);

/** Build one articulated figure; the limb pivots land in userData for animation. */
export function buildPedMesh(shirt, pants, skin) {
  const group = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(-0.12, 0.8, 0);
  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.set(0.12, 0.8, 0);
  const torso = new THREE.Mesh(torsoGeo, shirtMat);
  torso.position.y = 1.11;
  const armL = new THREE.Mesh(armGeo, shirtMat);
  armL.position.set(-0.31, 1.38, 0);
  const armR = new THREE.Mesh(armGeo, shirtMat);
  armR.position.set(0.31, 1.38, 0);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 1.6;
  group.add(legL, legR, torso, armL, armR, head);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  group.userData = { legL, legR, armL, armR };
  return group;
}

/** A random point on a sidewalk somewhere in the city. */
function randomSidewalkPoint() {
  const vertical = rng() < 0.5;
  const coord = pick(rng, S.roadCenters);
  const side = rng() < 0.5 ? -8.9 : 8.9;
  const along = randRange(rng, -315, 315);
  return vertical ? { x: coord + side, z: along } : { x: along, z: coord + side };
}

function spawnPed(at) {
  const mesh = buildPedMesh(pick(rng, SHIRTS), pick(rng, PANTS), pick(rng, SKIN));
  S.scene.add(mesh);
  const ped = {
    mesh,
    x: at.x,
    z: at.z,
    heading: rng() * Math.PI * 2,
    speed: 0,
    health: 100,
    state: 'walk', // 'walk' | 'flee' | 'down'
    target: randomSidewalkPoint(),
    walkPhase: rng() * 6,
    fleeTimer: 0,
    threat: null,
    downTimer: 0,
    dead: false,
    deadTimer: 0,
  };
  S.peds.push(ped);
  return ped;
}

/** Populate the sidewalks. Called once at boot. */
export function initPedestrians() {
  for (let i = 0; i < PED_COUNT; i += 1) spawnPed(randomSidewalkPoint());
}

/** Everyone within `radius` of a frightening event runs directly away from it. */
export function panicAt(x, z, radius = 26) {
  for (const ped of S.peds) {
    if (ped.dead || ped.state === 'down') continue;
    if (Math.hypot(ped.x - x, ped.z - z) < radius) {
      ped.state = 'flee';
      ped.threat = { x, z };
      ped.fleeTimer = randRange(rng, 2.4, 4.4);
    }
  }
}

function knockDown(ped, recoverySeconds) {
  ped.state = 'down';
  ped.downTimer = ped.health <= 0 ? 999 : recoverySeconds;
  if (ped.health <= 0) {
    ped.dead = true;
    ped.deadTimer = 24;
  }
}

/** A car connects with a pedestrian. The player's car makes it the player's crime. */
export function hitPedestrian(ped, source) {
  if (ped.dead || ped.state === 'down') return;
  const speed = source && source.speed !== undefined ? Math.abs(source.speed) : 4;
  ped.health -= 34 + speed * 4;
  knockDown(ped, randRange(rng, 1.6, 2.8));
  if (source && source === S.player.inVehicle) {
    S.addCrime(CRIME.hitPedestrian);
    S.notify('You hit a pedestrian!', 'bad');
  }
  panicAt(ped.x, ped.z, 20);
}

/** A punch lands: lighter than a car, and very much a crime up close. */
export function punchPedestrian(ped) {
  if (ped.dead) return;
  playPunch();
  ped.health -= 34;
  knockDown(ped, 1.4);
  S.addCrime(CRIME.punchPerson);
  panicAt(ped.x, ped.z, 16);
}

/** Gunfire damage (combat.js resolves the shot; this applies the consequence). */
export function shootPedestrian(ped, damage) {
  if (ped.dead) return;
  ped.health -= damage;
  if (ped.health <= 0) {
    ped.dead = true;
    ped.state = 'down';
    ped.downTimer = 999;
    ped.deadTimer = 24;
  } else {
    ped.state = 'flee';
    ped.threat = { x: S.player.x, z: S.player.z };
    ped.fleeTimer = 3.4;
  }
  panicAt(ped.x, ped.z, 22);
}

/** Pose one figure for this frame: walk swing, flee flail, or flat on the ground. */
function animatePed(ped, dt) {
  const u = ped.mesh.userData;
  if (ped.state === 'down') {
    ped.mesh.rotation.x = -Math.PI / 2;
    ped.mesh.position.set(ped.x, 0.25, ped.z);
    return;
  }
  ped.mesh.rotation.x = 0;
  ped.walkPhase += dt * (2 + ped.speed * 1.9);
  const swing = Math.sin(ped.walkPhase) * Math.min(0.65, ped.speed * 0.16);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  if (ped.state === 'flee') {
    u.armL.rotation.x = -2.6 + Math.sin(ped.walkPhase * 1.4) * 0.3;
    u.armR.rotation.x = -2.6 - Math.sin(ped.walkPhase * 1.4) * 0.3;
  } else {
    u.armL.rotation.x = -swing * 0.8;
    u.armR.rotation.x = swing * 0.8;
  }
  ped.mesh.position.set(ped.x, 0, ped.z);
  ped.mesh.rotation.y = ped.heading;
}

/** Advance every pedestrian: respawn the dead, recover the downed, walk or flee. */
export function updatePedestrians(dt) {
  for (const ped of S.peds) {
    if (ped.dead) {
      ped.deadTimer -= dt;
      animatePed(ped, dt);
      if (ped.deadTimer <= 0) {
        const at = randomSidewalkPoint();
        ped.x = at.x;
        ped.z = at.z;
        ped.dead = false;
        ped.health = 100;
        ped.state = 'walk';
        ped.target = randomSidewalkPoint();
      }
      continue;
    }
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        ped.state = 'flee';
        ped.threat = { x: S.player.x, z: S.player.z };
        ped.fleeTimer = 2.2;
      }
      animatePed(ped, dt);
      continue;
    }
    let targetSpeed = 1.5;
    let tx;
    let tz;
    if (ped.state === 'flee') {
      ped.fleeTimer -= dt;
      const away = Math.atan2(ped.x - ped.threat.x, ped.z - ped.threat.z);
      tx = ped.x + Math.sin(away) * 12;
      tz = ped.z + Math.cos(away) * 12;
      targetSpeed = 6.8;
      if (ped.fleeTimer <= 0) {
        ped.state = 'walk';
        ped.target = randomSidewalkPoint();
      }
    } else {
      tx = ped.target.x;
      tz = ped.target.z;
      if (Math.hypot(tx - ped.x, tz - ped.z) < 2.4) ped.target = randomSidewalkPoint();
    }
    let diff = Math.atan2(tx - ped.x, tz - ped.z) - ped.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ped.heading += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
    ped.speed += (targetSpeed - ped.speed) * Math.min(1, dt * 5);
    ped.x += Math.sin(ped.heading) * ped.speed * dt;
    ped.z += Math.cos(ped.heading) * ped.speed * dt;
    const hit = collideCircle(ped.x, ped.z, 0.4);
    ped.x = hit.x;
    ped.z = hit.z;
    const clamped = clampToWorld(ped.x, ped.z);
    ped.x = clamped.x;
    ped.z = clamped.z;
    animatePed(ped, dt);
  }
}
