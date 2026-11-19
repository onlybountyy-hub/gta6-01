// traffic.js — ambient life: road-following traffic cars and pedestrians.
//
// Traffic cars drive the street grid as a graph: each car heads along a
// road toward the next intersection, then turns (or goes straight) and
// continues. They slow for the car ahead and for the player, and they stop
// being simulated in detail when far away. Pedestrians stroll along
// sidewalk offsets, cross at intersections now and then, flee when a shot
// is fired or a car mounts the pavement near them, and can be shoved —
// which the player controller reports as an assault when it is the player
// doing the shoving.

import { makeRng, randRange, pickOne, clamp, distance2d, angleDelta, headingTowards } from './rng.js';
import { roadCoord, GRID } from './world.js';
import { createCar, CAR_COLORS, setBrakeLights } from './vehicles.js';
import { buildPersonMesh, animatePerson } from './player.js';

const trafficRng = makeRng(777001);

// Set by createTraffic when main passes its audio module in: traffic cars
// honk when they have been blocked for a while, which sells the gridlock
// without any extra wiring in the frame loop.
let trafficAudio = null;

function randomRoadPoint() {
  const i = Math.floor(trafficRng() * (GRID + 1));
  const along = randRange(trafficRng, -300, 300);
  const horizontal = trafficRng() > 0.5;
  if (horizontal) return { x: along, z: roadCoord(i), dir: trafficRng() > 0.5 ? 1 : -1, axis: 'x' };
  return { x: roadCoord(i), z: along, dir: trafficRng() > 0.5 ? 1 : -1, axis: 'z' };
}

export function createTraffic(scene, count = 16, audio = null) {
  trafficAudio = audio;
  const cars = [];
  for (let i = 0; i < count; i++) {
    const p = randomRoadPoint();
    const heading = p.axis === 'x' ? (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (p.dir > 0 ? 0 : Math.PI);
    // Keep to the correct side of the road.
    const lane = 2.8;
    const x = p.axis === 'x' ? p.x : p.x + (p.dir > 0 ? lane : -lane) * 1;
    const z = p.axis === 'z' ? p.z : p.z + (p.dir > 0 ? -lane : lane) * 1;
    // Body mix: mostly sedans, a quarter delivery vans (slower, taller),
    // the rest pickups. Vans cruise a touch slower and it shows. The
    // first car is always a sedan: the chase screenshot scene puts the
    // player in trafficCars[0], and a van's tall shell crowds the frame.
    const roll = i === 0 ? 0.5 : trafficRng();
    const opts = { topSpeed: randRange(trafficRng, 17, 24) };
    if (roll < 0.25) { opts.van = true; opts.topSpeed = randRange(trafficRng, 15, 19); }
    else if (roll < 0.42) { opts.pickup = true; }
    const car = createCar(scene, x, z, heading, pickOne(trafficRng, CAR_COLORS), opts);
    car.traffic = { axis: p.axis, dir: p.dir, cruise: randRange(trafficRng, 10, 16), blockedFor: 0, honkIn: randRange(trafficRng, 2, 5) };
    cars.push(car);
  }
  return cars;
}

function nextIntersectionAhead(car) {
  const t = car.traffic;
  if (t.axis === 'x') {
    const ahead = car.pos.x + t.dir * 30;
    const idx = Math.round((ahead + 286) / 52);
    return { x: roadCoord(clampIndex(idx)), z: car.pos.z, atX: true };
  }
  const ahead = car.pos.z + t.dir * 30;
  const idx = Math.round((ahead + 286) / 52);
  return { x: car.pos.x, z: roadCoord(clampIndex(idx)), atX: false };
}

function clampIndex(i) {
  return Math.max(0, Math.min(GRID, i));
}

// Drive one traffic car for a frame. Returns nothing; mutates the car.
export function stepTrafficCar(car, dt, allCars, playerPos, world) {
  const t = car.traffic;
  if (!t || car.driver === 'player' || car.dead) return;
  // Slow down if something is close ahead.
  let want = t.cruise;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  for (const other of allCars) {
    if (other === car) continue;
    const dx = other.pos.x - car.pos.x;
    const dz = other.pos.z - car.pos.z;
    const ahead = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    if (ahead > 0 && ahead < 11 && side < 2.6) want = Math.min(want, Math.max(0, (ahead - 6) * 1.6));
  }
  if (playerPos) {
    const dx = playerPos.x - car.pos.x;
    const dz = playerPos.z - car.pos.z;
    const ahead = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    if (ahead > 0 && ahead < 9 && side < 2.4) want = 0;
  }
  // Accelerate or brake toward the wanted speed.
  const braking = car.speed > want + 0.5;
  if (car.speed < want) car.speed = Math.min(want, car.speed + 9 * dt);
  else car.speed = Math.max(want, car.speed - 22 * dt);
  setBrakeLights(car, braking);
  // Gridlock theatre: a car held at a standstill by the car ahead counts
  // its frustration, then leans on the horn (if audio was wired in).
  if (want < 0.5 && car.speed < 0.5) {
    t.blockedFor += dt;
    t.honkIn -= dt;
    if (t.blockedFor > 2 && t.honkIn <= 0) {
      if (trafficAudio) trafficAudio.honk();
      t.honkIn = randRange(trafficRng, 3.5, 8);
    }
  } else {
    t.blockedFor = 0;
    t.honkIn = Math.max(t.honkIn, 1.5);
  }

  // Near an intersection, maybe turn onto the crossing road.
  const cross = nextIntersectionAhead(car);
  const distCross = t.axis === 'x' ? Math.abs(cross.x - car.pos.x) : Math.abs(cross.z - car.pos.z);
  if (distCross < 2.2 && trafficRng() > 0.45) {
    if (t.axis === 'x') {
      // Turn onto the crossing north-south road at this intersection.
      car.pos.x = cross.x;
      t.axis = 'z';
      t.dir = trafficRng() > 0.5 ? 1 : -1;
      car.heading = t.dir > 0 ? 0 : Math.PI;
    } else {
      car.pos.z = cross.z;
      t.axis = 'x';
      t.dir = trafficRng() > 0.5 ? 1 : -1;
      car.heading = t.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }
  car.pos.x += Math.sin(car.heading) * car.speed * dt;
  car.pos.z += Math.cos(car.heading) * car.speed * dt;
  // Grid edge: turn around rather than leaving the city.
  if (Math.abs(car.pos.x) > 305 || Math.abs(car.pos.z) > 305) {
    car.heading += Math.PI;
    if (t.axis === 'x') t.dir = -t.dir;
    else t.dir = -t.dir;
    car.pos.x = clamp(car.pos.x, -300, 300);
    car.pos.z = clamp(car.pos.z, -300, 300);
  }
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
}

// Pedestrians ---------------------------------------------------------------

const SHIRTS = [0xffeaa7, 0x74b9ff, 0x55efc4, 0xff7675, 0xa29bfe, 0xfdcb6e, 0xe17055, 0x00b894];
const CAPS = [0xff5a3c, 0x2ec4b6, 0x1b2a6b, 0xf4f6f6, 0xffb03a, 0x222222];
const SKINS = [0xd9a066, 0xc68863, 0x8d5524, 0xffdbac, 0x6b4423];

// Pedestrian kinds, assigned at spawn:
//   walker  — the baseline stroller.
//   jogger  — faster, brighter kit, longer strides, never stops.
//   phone   — walks in bursts, then stops to stare at a phone prop.
//   partner — walks half a step behind a leader ped, chatting distance.
// The kind only changes speed, costume and the small state machine in
// stepPedestrian; collision, fleeing and death stay shared.
export function createPedestrians(scene, count = 22) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const kind = i % 9 === 4 ? 'jogger' : i % 7 === 3 ? 'phone' : 'walker';
    const meshOpts = { capColor: pickOne(trafficRng, CAPS) };
    if (kind === 'phone') meshOpts.phone = true;
    if (kind === 'jogger') { meshOpts.hair = 0x2b2118; meshOpts.capColor = undefined; }
    if (i % 6 === 5) meshOpts.backpack = pickOne(trafficRng, [0xd7263d, 0x2471a3, 0x606c38]);
    if (i % 11 === 6) { meshOpts.sunhat = true; meshOpts.capColor = undefined; meshOpts.hair = undefined; }
    const mesh = buildPersonMesh(pickOne(trafficRng, SHIRTS), pickOne(trafficRng, [0x353b48, 0x5d4630, 0x2c3e50, 0x74553a]), pickOne(trafficRng, SKINS), meshOpts);
    const p = randomRoadPoint();
    const x = p.axis === 'x' ? p.x : p.x + (trafficRng() > 0.5 ? 8 : -8);
    const z = p.axis === 'z' ? p.z : p.z + (trafficRng() > 0.5 ? 8 : -8);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    peds.push({
      mesh,
      pos: mesh.position,
      heading: randRange(trafficRng, 0, Math.PI * 2),
      speed: kind === 'jogger' ? randRange(trafficRng, 4.1, 5) : randRange(trafficRng, 1.1, 2.1),
      health: 30,
      walkPhase: randRange(trafficRng, 0, 6),
      fleeTimer: 0,
      dead: false,
      turnTimer: randRange(trafficRng, 2, 7),
      isEnemy: false,
      isCivilian: true,
      kind,
      state: 'walk',
      stateTimer: randRange(trafficRng, 3, 8),
      follow: null,
    });
  }
  // Pair up a few walkers: every fifth ped from index 6 walks as the
  // partner of the ped spawned just before it.
  for (let i = 6; i < peds.length; i += 5) {
    if (peds[i].kind === 'walker' && peds[i - 1].kind === 'walker') {
      peds[i].kind = 'partner';
      peds[i].follow = peds[i - 1];
      peds[i].pos.x = peds[i - 1].pos.x + 1.2;
      peds[i].pos.z = peds[i - 1].pos.z + 0.6;
      peds[i].speed = peds[i - 1].speed;
    }
  }
  return peds;
}

export function stepPedestrian(ped, dt, world, dangerPos) {
  if (ped.dead) return;
  ped.turnTimer -= dt;
  if (dangerPos && distance2d(ped.pos.x, ped.pos.z, dangerPos.x, dangerPos.z) < 14) {
    ped.fleeTimer = 2.5;
  }
  let speed = ped.speed;
  let moving = true;
  let phoning = false;
  if (ped.fleeTimer > 0) {
    ped.fleeTimer -= dt;
    speed = 5.2;
    ped.state = 'walk';
    if (dangerPos) {
      ped.heading = headingTowards(dangerPos.x, dangerPos.z, ped.pos.x, ped.pos.z);
    }
  } else if (ped.kind === 'partner' && ped.follow && !ped.follow.dead) {
    // Trail the leader at a conversational offset; if we drift too far,
    // hurry to catch up, and mirror their heading when close.
    const lead = ped.follow;
    const tx = lead.pos.x - Math.sin(lead.heading) * 0.4 + Math.cos(lead.heading) * 1.1;
    const tz = lead.pos.z - Math.cos(lead.heading) * 0.4 - Math.sin(lead.heading) * 1.1;
    const d = distance2d(ped.pos.x, ped.pos.z, tx, tz);
    if (d > 0.5) {
      ped.heading = headingTowards(ped.pos.x, ped.pos.z, tx, tz);
      speed = d > 3 ? lead.speed + 1.6 : lead.speed;
    } else {
      ped.heading = lead.heading;
      speed = lead.speed;
    }
  } else if (ped.kind === 'phone') {
    // Burst-walk, then stop and scroll. The pose (arm up, head down) is
    // applied after the walk animation below.
    ped.stateTimer -= dt;
    if (ped.state === 'walk' && ped.stateTimer <= 0) {
      ped.state = 'phone';
      ped.stateTimer = randRange(trafficRng, 1.8, 4);
    } else if (ped.state === 'phone' && ped.stateTimer <= 0) {
      ped.state = 'walk';
      ped.stateTimer = randRange(trafficRng, 4, 9);
    }
    if (ped.state === 'phone') {
      speed = 0;
      moving = false;
      phoning = true;
    } else if (ped.turnTimer <= 0) {
      ped.turnTimer = randRange(trafficRng, 2, 8);
      const cardinals = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      ped.heading = pickOne(trafficRng, cardinals) + randRange(trafficRng, -0.2, 0.2);
    }
  } else if (ped.turnTimer <= 0) {
    ped.turnTimer = randRange(trafficRng, 2, 8);
    // Prefer walking along a road: snap heading to a cardinal direction.
    const cardinals = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    ped.heading = pickOne(trafficRng, cardinals) + randRange(trafficRng, -0.2, 0.2);
  }
  ped.pos.x += Math.sin(ped.heading) * speed * dt;
  ped.pos.z += Math.cos(ped.heading) * speed * dt;
  if (world) world.resolveCollisions(ped.pos, 0.5);
  ped.walkPhase += dt * (4 + speed * 1.9);
  ped.mesh.position.copy(ped.pos);
  ped.mesh.rotation.y = ped.heading;
  animatePerson(ped.mesh, ped.walkPhase, moving);
  // Phone pose overrides the walk swing: right arm raised to the prop,
  // head tipped down at the screen.
  const head = ped.mesh.userData.head;
  if (head) head.rotation.x = phoning ? 0.48 : 0;
  if (phoning) {
    const limbs = ped.mesh.userData.limbs;
    if (limbs) {
      limbs.armR.rotation.x = -1.9;
      limbs.armL.rotation.x = -1.5;
    }
  }
}

export function scarePeds(peds, pos, radius = 18) {
  for (const ped of peds) {
    if (!ped.dead && distance2d(ped.pos.x, ped.pos.z, pos.x, pos.z) < radius) ped.fleeTimer = 3;
  }
}

export function killPedestrian(ped) {
  ped.dead = true;
  ped.mesh.rotation.z = Math.PI / 2;
  ped.mesh.position.y = 0.25;
}
