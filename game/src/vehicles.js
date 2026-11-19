// vehicles.js — car meshes and arcade driving physics for SOLANO HEAT.
//
// Every car in the game, whether it belongs to traffic, the police, a
// mission or the player, is the same small structure: a THREE group built
// from boxes (body, cabin, four wheels, lights) plus a plain state object
// holding position, heading, speed and health. One physics stepper moves
// them all, which keeps traffic, chases and player driving consistent.
//
// The model is intentionally arcade: throttle builds speed toward a top
// speed, steering authority scales with speed, a handbrake kills grip, and
// collisions are circles against the world's building boxes plus soft
// circle-versus-circle pushes between cars.

import * as THREE from 'three';
import { clamp } from './rng.js';

export const CAR_COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0xecf0f1, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xfd79a8, 0x636e72];

let plateCounter = 0;

export function buildCarMesh(color, opts = {}) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x22282c });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fd8e8 });

  // Three body families share the same chassis furniture (wheels, lights)
  // but read very differently in traffic: the default sedan, a tall
  // delivery van (one slab body, windshield band, no separate cabin) and
  // a pickup (low bed with side walls behind a proper cab).
  let bodyLen = 4.3;
  if (opts.van) {
    bodyLen = 4.7;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.55, 4.7), bodyMat);
    shell.position.y = 1.05;
    group.add(shell);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 0.15), glassMat);
    shield.position.set(0, 1.35, 2.36);
    group.add(shield);
    const rearDoor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.1), darkMat);
    rearDoor.position.set(0, 1.05, -2.36);
    group.add(rearDoor);
  } else if (opts.pickup) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.4), bodyMat);
    bed.position.y = 0.55;
    group.add(bed);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.62, 1.7), glassMat);
    cab.position.set(0, 1.12, 0.9);
    group.add(cab);
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 2.2), bodyMat);
    wallL.position.set(-0.93, 1.0, -1.1);
    group.add(wallL);
    const wallR = wallL.clone();
    wallR.position.x = 0.93;
    group.add(wallR);
    const noseP = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 0.7), bodyMat);
    noseP.position.set(0, 0.42, 2.35);
    group.add(noseP);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.3), bodyMat);
    body.position.y = 0.55;
    group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 2.1), glassMat);
    cabin.position.set(0, 1.1, -0.2);
    group.add(cabin);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 0.7), bodyMat);
    nose.position.set(0, 0.42, 2.3);
    group.add(nose);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
    wheels.push(wheel);
  }

  const lightGeo = new THREE.BoxGeometry(0.36, 0.16, 0.08);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c9 });
  const tailMats = [];
  const frontZ = opts.van ? 2.38 : 2.62;
  const rearZ = opts.van ? -2.38 : -2.16;
  for (const lx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(lightGeo, headMat);
    head.position.set(lx, 0.62, frontZ);
    group.add(head);
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    const tail = new THREE.Mesh(lightGeo, tailMat);
    tail.position.set(lx, 0.62, rearZ);
    group.add(tail);
    tailMats.push(tailMat);
  }
  group.userData.tailMats = tailMats;
  // Headlight cones: two translucent beams that main.js switches on when
  // the day cycle dips toward golden hour. They live in the car group so
  // they inherit heading for free, and depthWrite is off so they never
  // z-fight the road.
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffeeb0, transparent: true, opacity: 0.10, depthWrite: false });
  const cones = [];
  for (const lx of [-0.6, 0.6]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15, 6.5, 10, 1, true), coneMat);
    cone.rotation.x = -Math.PI / 2 + 0.05;
    cone.position.set(lx, 0.55, frontZ + 3.1);
    cone.visible = false;
    cone.name = 'headlight-cone';
    group.add(cone);
    cones.push(cone);
  }
  group.userData.cones = cones;
  void bodyLen;

  if (opts.police) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    bar.position.set(0, 1.5, -0.2);
    bar.name = 'lightbar';
    group.add(bar);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.3, 4.34), new THREE.MeshLambertMaterial({ color: 0x1b2a6b }));
    stripe.position.y = 0.72;
    group.add(stripe);
  }
  if (opts.sport) {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.4), darkMat);
    spoiler.position.set(0, 1.05, -2.0);
    group.add(spoiler);
  }

  group.userData.wheels = wheels;
  return group;
}

export function createCar(scene, x, z, heading, color, opts = {}) {
  plateCounter += 1;
  const mesh = buildCarMesh(color, opts);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  scene.add(mesh);
  const car = {
    id: 'car-' + plateCounter,
    mesh,
    pos: mesh.position,
    heading,
    speed: 0,
    steer: 0,
    health: 100,
    radius: 2.3,
    topSpeed: opts.topSpeed ?? 34,
    accel: opts.accel ?? 16,
    isPolice: !!opts.police,
    isSport: !!opts.sport,
    bodyType: opts.van ? 'van' : opts.pickup ? 'pickup' : 'sedan',
    driver: null,
    dead: false,
    color,
  };
  return car;
}

// One arcade physics step. input = { throttle: -1..1, steer: -1..1, brake }.
export function stepCar(car, input, dt, world) {
  if (car.dead) {
    car.speed *= Math.max(0, 1 - dt * 2);
  } else {
    const target = input.throttle >= 0 ? car.topSpeed * input.throttle : -11 * -input.throttle * -1;
    const reverseTarget = -11;
    const goal = input.throttle >= 0 ? car.topSpeed * input.throttle : reverseTarget * -input.throttle;
    void target;
    const rate = input.brake ? 26 : car.accel;
    if (car.speed < goal) car.speed = Math.min(goal, car.speed + rate * dt);
    else car.speed = Math.max(goal, car.speed - rate * dt);
    if (input.throttle === 0 && !input.brake) {
      car.speed -= car.speed * Math.min(1, dt * 0.7);
      if (Math.abs(car.speed) < 0.05) car.speed = 0;
    }
    if (input.brake) {
      car.speed -= car.speed * Math.min(1, dt * 2.2);
    }
    const steerAuthority = clamp(Math.abs(car.speed) / 9, 0, 1) * (car.speed < 0 ? -1 : 1);
    car.steer = lerpSteer(car.steer, input.steer, dt);
    car.heading += car.steer * 1.55 * steerAuthority * dt * (input.brake ? 1.5 : 1);
  }
  const vx = Math.sin(car.heading) * car.speed;
  const vz = Math.cos(car.heading) * car.speed;
  car.pos.x += vx * dt;
  car.pos.z += vz * dt;
  if (world) {
    const beforeX = car.pos.x;
    const beforeZ = car.pos.z;
    world.resolveCollisions(car.pos, car.radius);
    // Hitting a building scrubs speed hard.
    if (Math.abs(car.pos.x - (beforeX + vx * dt)) > 0.01 || Math.abs(car.pos.z - (beforeZ + vz * dt)) > 0.01) {
      if (Math.abs(car.speed) > 8) car.health -= 4;
      car.speed *= 0.35;
    }
  }
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  const wheels = car.mesh.userData.wheels || [];
  for (const w of wheels) w.rotation.x += (car.speed * dt) / 0.36;
  // Brake lights flare whenever the driver is actively slowing down.
  setBrakeLights(car, !!input.brake || input.throttle < 0 || (input.throttle === 0 && Math.abs(car.speed) > 6));
  return car;
}

// Toggle a car's tail-light brightness. Traffic cars call this from their
// own stepper (they do not use stepCar), pursuit cars get it for free.
export function setBrakeLights(car, on) {
  const mats = car.mesh.userData.tailMats || [];
  const hex = on ? 0xff8a7a : 0xff3b30;
  for (const m of mats) {
    if (m.userData.hex !== hex) {
      m.color.setHex(hex);
      m.userData.hex = hex;
    }
  }
}

// Switch a car's headlight cones on or off (golden-hour driving).
export function setHeadlights(car, on) {
  const cones = car.mesh.userData.cones || [];
  for (const c of cones) c.visible = on;
}

function lerpSteer(current, goal, dt) {
  const step = 6 * dt;
  if (current < goal) return Math.min(goal, current + step);
  return Math.max(goal, current - step);
}

// Soft push-apart so cars never overlap for long.
export function separateCars(cars) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      const min = a.radius + b.radius - 0.6;
      if (d2 > 0.01 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5;
        a.pos.x -= dx * push;
        a.pos.z -= dz * push;
        b.pos.x += dx * push;
        b.pos.z += dz * push;
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 10) {
          a.health -= 2;
          b.health -= 2;
        }
        a.speed *= 0.92;
        b.speed *= 0.92;
      }
    }
  }
}

// --- skid marks -------------------------------------------------------------
// A fixed pool of dark rubber quads laid behind a car that is sliding
// (handbrake turns, hard launches, big steering at speed). Each mark
// fades over about seven seconds and the pool recycles the oldest, so a
// long drift never allocates. Marks are purely cosmetic: no collision,
// no state, and they sit a hair above the road plane to avoid z-fighting.
const SKID_POOL = 220;
const SKID_LIFE = 7;

export function createSkidMarks(scene) {
  const geo = new THREE.PlaneGeometry(0.3, 1.15);
  const marks = [];
  for (let i = 0; i < SKID_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.06;
    mesh.visible = false;
    scene.add(mesh);
    marks.push({ mesh, life: 0 });
  }
  let cursor = 0;
  return {
    // Drop one mark centred at (x, z), aligned with the car's heading.
    leave(x, z, heading) {
      const m = marks[cursor];
      cursor = (cursor + 1) % SKID_POOL;
      m.mesh.position.x = x;
      m.mesh.position.z = z;
      m.mesh.rotation.z = heading + Math.PI;
      m.mesh.visible = true;
      m.life = SKID_LIFE;
      m.mesh.material.opacity = 0.5;
    },
    update(dt) {
      for (const m of marks) {
        if (m.life <= 0) continue;
        m.life -= dt;
        if (m.life <= 0) {
          m.mesh.visible = false;
          m.mesh.material.opacity = 0;
        } else if (m.life < 2) {
          m.mesh.material.opacity = 0.5 * (m.life / 2);
        }
      }
    },
  };
}

// Rear-wheel world positions for a car, used by the skid system so the
// twin stripes track the tyres instead of the car's centre.
export function rearWheelPositions(car) {
  const sin = Math.sin(car.heading);
  const cos = Math.cos(car.heading);
  const back = 1.45;
  const side = 0.95;
  return [
    { x: car.pos.x - sin * back - cos * side, z: car.pos.z - cos * back + sin * side },
    { x: car.pos.x - sin * back + cos * side, z: car.pos.z - cos * back - sin * side },
  ];
}

export function damageCar(car, amount) {
  car.health -= amount;
  if (car.health <= 0 && !car.dead) {
    car.dead = true;
    car.mesh.traverse((child) => {
      if (child.isMesh && child.material && child.material.color) {
        child.material = child.material.clone();
        child.material.color.multiplyScalar(0.35);
      }
    });
  }
  return car.dead;
}
