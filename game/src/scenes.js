// scenes.js — the staged moments behind ?scene=chase|downtown|harbor|mission.
//
// Each scene drops the real game — same city, same systems, same HUD — into a
// photogenic instant and flies a cinematic camera, so the entry's screenshots
// are honest renders of gameplay rather than mock-ups: a three-star chase down
// the east–west avenue, Marco idling at the central junction, the boat waiting
// at the pier, and a delivery run in progress with Lola on the radio.

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

/** Stage the named scene. Called once by main.js, after the world exists. */
export function stageScene(name) {
  S.sceneMode = true;
  S.mode = 'scene';
  if (name === 'chase') {
    // The cover: an orange sedan at speed on the z = −27 avenue, three
    // cruisers on its tail, three stars lit, the boat set as the escape point.
    const car = spawnVehicle('sedan', 0xd94f30, -30, -23.6, Math.PI / 2, {});
    putPlayerIn(car);
    car.speed = 17;
    driveTarget = { x: 400, z: -23.6 };
    for (let i = 0; i < 3; i += 1) {
      const cop = spawnVehicle('cruiser', 0x23262b, -44 - i * 12, -31 + i * 4.5, Math.PI / 2, {
        ai: { role: 'police', wreckTimer: 0 },
      });
      cop.speed = 15.5;
    }
    setWantedStars(3);
    S.wanted.lastSeenAt = 99999; // the chase never cools off during the shot
    S.objective = { x: PLACES.boat.x, z: PLACES.boat.z, label: 'Escape' };
    S.objectiveText = "Shake the PSPD — make it to Lola's boat";
    anchor = { x: car.x, z: car.z };
    S.sceneName = 'chase';
  } else if (name === 'harbor') {
    // Marco on the pier boards, the boat riding at anchor just past him.
    placePlayer(378, 208, Math.PI / 2);
    S.cam.yaw = Math.PI / 2;
    anchor = { x: 424, z: PLACES.boat.z };
    S.objective = { x: PLACES.boat.x, z: PLACES.boat.z, label: 'The Boat' };
    S.objectiveText = 'Escape to the boat';
    S.sceneName = 'harbor';
  } else if (name === 'mission') {
    // A delivery in progress: blue sedan eastbound, package aboard, Lola talking.
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
    S.sceneName = 'mission';
  } else {
    // downtown (and any unknown name): Marco on foot at the central junction.
    placePlayer(27, 27, 2.4);
    S.cam.yaw = 2.4;
    anchor = { x: 27, z: 27 };
    S.cash = 250;
    S.sceneName = 'downtown';
  }
}

/** Per-frame scene work: drive the staged car, then fly the camera. */
export function updateScene(dt) {
  orbitAngle += dt * 0.07;
  if (driveTarget && S.player.inVehicle) {
    const car = S.player.inVehicle;
    steerToward(car, driveTarget.x, driveTarget.z, dt, 1.2);
    approachSpeed(car, 16, dt);
    anchor = { x: car.x, z: car.z };
    // A tracking shot from the FRONT three-quarter, looking back at the car:
    // the sedan charges at the lens and the cruisers on its tail stay in the
    // same frame behind it, the city streaming past all of them.
    const swing = Math.sin(S.time * 0.16) * 0.5;
    const front = car.heading + swing;
    const dist = 14;
    S.camera.position.set(
      car.x + Math.sin(front) * dist,
      4.6,
      car.z + Math.cos(front) * dist,
    );
    S.camera.lookAt(
      car.x - Math.sin(car.heading) * 3,
      1.1,
      car.z - Math.cos(car.heading) * 3,
    );
    return;
  }
  // Orbiting shots for downtown and the harbour.
  const radius = S.sceneName === 'harbor' ? 17 : 8.5;
  const height = S.sceneName === 'harbor' ? 3.4 : 3.2;
  S.camera.position.set(
    anchor.x + Math.sin(orbitAngle) * radius,
    height,
    anchor.z + Math.cos(orbitAngle) * radius,
  );
  S.camera.lookAt(anchor.x, 1.6, anchor.z);
}
