// player.js — the player character: on-foot movement and car entry.
//
// On foot the player is a simple articulated figure (body, head, limbs that
// swing while walking) moved by WASD relative to the camera yaw, with a
// sprint modifier and building collision from the world module. Driving is
// delegated to vehicles.js; this module owns the hand-off: pressing the
// interact key near a car door claims the nearest car, and pressing it
// again steps out beside it. Crimes committed by those actions (stealing a
// car, shoving a pedestrian) are reported through callbacks so the police
// module can price them into the wanted level.

import * as THREE from 'three';
import { clamp, distance2d } from './rng.js';
import { stepCar } from './vehicles.js';

export function buildPersonMesh(shirtColor, pantsColor = 0x2c3e50, skinColor = 0xe8b88a, opts = {}) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: pantsColor });
  const skin = new THREE.MeshLambertMaterial({ color: skinColor });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
  torso.position.y = 1.12;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.36), skin);
  head.position.y = 1.72;
  group.add(head);
  group.userData.head = head;
  // Headwear varies the silhouette: a coloured cap by default, a hair
  // slab when opts.hair is set, or a wide sun hat for beach types.
  if (opts.sunhat) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.1, 10), new THREE.MeshLambertMaterial({ color: 0xf7d774 }));
    hat.position.y = 1.94;
    group.add(hat);
  } else if (opts.hair) {
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.4), new THREE.MeshLambertMaterial({ color: opts.hair }));
    hair.position.y = 1.95;
    group.add(hair);
  } else {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.42), new THREE.MeshLambertMaterial({ color: opts.capColor ?? 0xff5a3c }));
    cap.position.y = 1.96;
    group.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.24), cap.material);
    brim.position.set(0, 1.92, 0.3);
    group.add(brim);
  }
  // Optional props: a phone slab held out front, or a backpack.
  if (opts.phone) {
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.04), new THREE.MeshLambertMaterial({ color: 0x14181c }));
    phone.position.set(0.34, 1.18, 0.3);
    phone.rotation.x = -0.5;
    group.add(phone);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.22, 0.045), new THREE.MeshBasicMaterial({ color: 0x9fd8e8 }));
    screen.position.copy(phone.position);
    screen.rotation.x = -0.5;
    group.add(screen);
  }
  if (opts.backpack) {
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.55, 0.22), new THREE.MeshLambertMaterial({ color: opts.backpack }));
    pack.position.set(0, 1.15, -0.3);
    group.add(pack);
  }
  const limbs = {};
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.66, 0.16), shirt);
    arm.geometry.translate(0, -0.3, 0);
    arm.position.set(side * 0.4, 1.42, 0);
    group.add(arm);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.2), pants);
    leg.geometry.translate(0, -0.36, 0);
    leg.position.set(side * 0.16, 0.8, 0);
    group.add(leg);
    limbs[side < 0 ? 'armL' : 'armR'] = arm;
    limbs[side < 0 ? 'legL' : 'legR'] = leg;
  }
  group.userData.limbs = limbs;
  return group;
}

export function animatePerson(mesh, walkPhase, moving) {
  const limbs = mesh.userData.limbs;
  if (!limbs) return;
  const swing = moving ? Math.sin(walkPhase) * 0.65 : 0;
  limbs.legL.rotation.x = swing;
  limbs.legR.rotation.x = -swing;
  limbs.armL.rotation.x = -swing * 0.8;
  limbs.armR.rotation.x = swing * 0.8;
}

export function createPlayer(scene, start) {
  const mesh = buildPersonMesh(0xff7847);
  mesh.position.set(start.x, 0, start.z);
  scene.add(mesh);
  const player = {
    mesh,
    pos: mesh.position,
    heading: 0,
    health: 100,
    maxHealth: 100,
    cash: 250,
    walkPhase: 0,
    car: null,
    dead: false,
    regenTimer: 0,
    onFootPos: { x: start.x, z: start.z },
  };
  return player;
}

// input = { forward, back, left, right, sprint } as booleans, plus camYaw.
export function stepPlayerOnFoot(player, input, camYaw, dt, world, onCrime) {
  let mx = 0;
  let mz = 0;
  if (input.forward) mz += 1;
  if (input.back) mz -= 1;
  if (input.left) mx -= 1;
  if (input.right) mx += 1;
  const moving = mx !== 0 || mz !== 0;
  if (moving) {
    const len = Math.sqrt(mx * mx + mz * mz);
    mx /= len;
    mz /= len;
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    const wx = mx * cos + mz * sin;
    const wz = -mx * sin + mz * cos;
    // Camera yaw convention: forward on screen is -sin/-cos of yaw; the
    // mapping above is paired with the camera placement in main.js.
    const speed = input.sprint ? 10.5 : 6.2;
    player.pos.x += wx * speed * dt * -1 * -1;
    player.pos.z += wz * speed * dt;
    player.heading = Math.atan2(wx, wz);
    player.walkPhase += dt * (input.sprint ? 13 : 9);
  }
  if (world) world.resolveCollisions(player.pos, 0.55);
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = player.heading;
  animatePerson(player.mesh, player.walkPhase, moving);
  // Slow health regeneration after a quiet spell.
  player.regenTimer += dt;
  if (player.regenTimer > 5 && player.health > 0 && player.health < player.maxHealth) {
    player.health = Math.min(player.maxHealth, player.health + dt * 4);
  }
  return moving;
}

export function findNearbyCar(player, cars, maxDist = 3.6) {
  let best = null;
  let bestD = maxDist;
  for (const car of cars) {
    if (car.dead) continue;
    const d = distance2d(player.pos.x, player.pos.z, car.pos.x, car.pos.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

export function enterCar(player, car, onCrime, audio) {
  player.car = car;
  car.driver = 'player';
  player.mesh.visible = false;
  if (audio) audio.carDoor();
  if (onCrime && !car.wasPlayerCar) onCrime('theft', car.pos);
  return car;
}

export function exitCar(player, audio) {
  const car = player.car;
  if (!car) return null;
  car.driver = null;
  player.car = null;
  const sideX = Math.cos(car.heading);
  const sideZ = -Math.sin(car.heading);
  player.pos.x = car.pos.x + sideX * 2.4;
  player.pos.z = car.pos.z + sideZ * 2.4;
  player.mesh.visible = true;
  if (audio) audio.carDoor();
  return car;
}

export function stepPlayerDriving(player, input, dt, world) {
  const car = player.car;
  if (!car) return;
  stepCar(car, input, dt, world);
  player.pos.x = car.pos.x;
  player.pos.z = car.pos.z;
  player.heading = car.heading;
}

export function hurtPlayer(player, amount) {
  player.health = clamp(player.health - amount, 0, player.maxHealth);
  player.regenTimer = 0;
  if (player.health <= 0) player.dead = true;
  return player.dead;
}

export function healPlayer(player, amount) {
  player.health = clamp(player.health + amount, 0, player.maxHealth);
  if (player.health > 0) player.dead = false;
}
