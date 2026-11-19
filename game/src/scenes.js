// scenes.js — the screenshot scenes behind ?scene=downtown|chase|harbor|mission.
// Each one stages the real game (same city, same systems) into a photogenic moment
// and flies a slow cinematic camera, so the maker's screenshots are honest renders
// of gameplay: a police chase with the wanted stars lit, a harbour sunset, a job
// in progress with its beacon on the minimap.

import { PLACES } from './config.js';
import { S } from './state.js';
import { spawnVehicle, steerToward, approachSpeed } from './vehicles.js';
import { setWantedStars } from './police.js';
import { placePlayer } from './player.js';

let anchor = { x: 0, z: 0 };
let orbitAngle = 0.6;
let driveTarget = null;

/** Put the player into a car as its driver, the way pressing F would. */
function putPlayerIn(car) {
  car.ai = null;
  car.parked = false;
  S.player.inVehicle = car;
  S.player.mesh.visible = false;
  S.player.x = car.x;
  S.player.z = car.z;
}

/** Stage the named scene. Called once by main.js after the world exists. */
export function stageScene(name) {
  S.sceneMode = true;
  S.sceneName = name;
  S.mode = 'scene';
  if (name === 'chase') {
    const car = spawnVehicle('sedan', 0xd94f30, -30, -23.6, Math.PI / 2, {});
    putPlayerIn(car);
    car.speed = 17;
    driveTarget = { x: 400, z: -23.6 };
    for (let i = 0; i < 3; i += 1) {
      const cop = spawnVehicle('cruiser', 0x23262b, -42 - i * 12, -32 + i * 5, Math.PI / 2, {
        ai: { role: 'police', reverseTimer: 0, wreckTimer: 0 },
      });
      cop.speed = 15;
    }
    setWantedStars(3);
    S.wanted.lastSeenAt = 99999; // the chase does not cool off during the shot
    S.objective = { x: PLACES.boat.x, z: PLACES.boat.z, label: 'Escape' };
    S.objectiveText = "Shake the PSPD — make it to Lola's boat";
    anchor = { x: car.x, z: car.z };
  } else if (name === 'harbor') {
    placePlayer(378, 208, Math.PI / 2);
    S.cam.yaw = Math.PI / 2;
    anchor = { x: 424, z: PLACES.boat.z }; // the boat mesh rides just past the pier-end marker
    S.objective = { x: PLACES.boat.x, z: PLACES.boat.z, label: 'The Boat' };
    S.objectiveText = 'Escape to the boat';
  } else if (name === 'mission') {
    const car = spawnVehicle('sedan', 0x2f6db8, 120, -239.6, Math.PI / 2, {});
    putPlayerIn(car);
    car.speed = 14;
    driveTarget = { x: 400, z: -239.6 };
    S.cash = 1450;
    S.objective = { x: PLACES.warehouse.x, z: PLACES.warehouse.z, label: 'Delivery' };
    S.objectiveText = 'Deliver the package to Solano Freight';
    S.dialogue = {
      lines: [{ who: 'Lola', text: 'Solano Freight, Marco. Quick and clean — the boys are waiting.' }],
      index: 0,
      timer: 0,
      onDone: null,
    };
    anchor = { x: car.x, z: car.z };
  } else {
    // downtown (and any unknown name): Marco on foot at the central junction.
    name = 'downtown';
    S.sceneName = 'downtown';
    placePlayer(27, 27, 2.4);
    S.cam.yaw = 2.4;
    anchor = { x: 27, z: 27 };
    S.cash = 250;
  }
}

/** Per-frame scene work: drive the staged car, then fly the cinematic camera. */
export function updateScene(dt) {
  orbitAngle += dt * 0.07;
  const p = S.playerPos();
  if (driveTarget && S.player.inVehicle) {
    const car = S.player.inVehicle;
    steerToward(car, driveTarget.x, driveTarget.z, dt, 1.2);
    approachSpeed(car, 16, dt);
    anchor = { x: car.x, z: car.z };
    // Camera: a slow swing from rear three-quarter to front three-quarter.
    const swing = Math.sin(S.time * 0.16) * 0.6;
    const back = car.heading + Math.PI + swing;
    const dist = 14.5;
    S.camera.position.set(
      car.x - Math.sin(back) * -dist * Math.cos(0.12),
      5.8,
      car.z - Math.cos(back) * -dist * Math.cos(0.12),
    );
    S.camera.lookAt(car.x + Math.sin(car.heading) * 3, 1.2, car.z + Math.cos(car.heading) * 3);
    return;
  }
  // Orbiting shots: downtown and harbour.
  const radius = S.sceneName === 'harbor' ? 17 : 13;
  const height = S.sceneName === 'harbor' ? 3.4 : 4.6;
  S.camera.position.set(
    anchor.x + Math.sin(orbitAngle) * radius,
    height,
    anchor.z + Math.cos(orbitAngle) * radius,
  );
  S.camera.lookAt(anchor.x, 1.6, anchor.z);
  if (S.sceneName === 'downtown') {
    // Marco idles in frame; keep him near the anchor.
    S.player.mesh.position.set(p.x, 0, p.z);
  }
}
