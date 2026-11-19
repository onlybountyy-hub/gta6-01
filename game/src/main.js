// main.js — SOLANO HEAT entry point: boot, game loop, input, camera, glue.
//
// This module owns the THREE renderer and the frame loop, creates every
// subsystem (world, player, traffic, police, combat, missions, HUD,
// audio), and wires them together each frame:
//   input -> player or car physics -> traffic & police & enemies ->
//   missions -> combat timers -> HUD & minimap -> camera -> render.
// It also owns the menus, the save file (localStorage), the spray shop and
// hospital interactions, the ?scene= screenshot setups, and the
// window.__solano debug hook that automated tests drive.

import * as THREE from 'three';
import { createWorld, LOCATIONS, nearestRoadCoord } from './world.js';
import { createPlayer, stepPlayerOnFoot, stepPlayerDriving, findNearbyCar, enterCar, exitCar, hurtPlayer, healPlayer, buildPersonMesh } from './player.js';
import { createTraffic, stepTrafficCar, createPedestrians, stepPedestrian, scarePeds } from './traffic.js';
import { separateCars, createCar, createSkidMarks, rearWheelPositions, setHeadlights } from './vehicles.js';
import { createPoliceSystem } from './police.js';
import { createCombat, stepEnemyGunman } from './combat.js';
import { createMissions } from './missions.js';
import { createHud, el } from './hud.js';
import { createAudio } from './audio.js';
import { distance2d, clamp } from './rng.js';

const SAVE_KEY = 'solano-heat-save-v1';
const params = new URLSearchParams(location.search);
const sceneMode = params.get('scene') || 'menu';

// --- boot -------------------------------------------------------------------

const canvas = el('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
function fitRenderer() {
  renderer.setSize(window.innerWidth, window.innerHeight);
}
fitRenderer();
window.addEventListener('resize', fitRenderer);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const audio = createAudio();
const world = createWorld(scene);
const hud = createHud();
const player = createPlayer(scene, LOCATIONS.playerStart);
const trafficCars = createTraffic(scene, 18, audio);
const peds = createPedestrians(scene, 26);
let enemies = [];
const skids = createSkidMarks(scene);

const police = createPoliceSystem(scene);
const combat = createCombat(scene, audio);

const marker = world.makeMarker(0xffd23c);
const packageMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1.1, 1.1, 1.1),
  new THREE.MeshLambertMaterial({ color: 0xffd23c })
);
packageMesh.position.set(LOCATIONS.harborPickup.x, 0.8, LOCATIONS.harborPickup.z);
scene.add(packageMesh);

// Lola herself: a figure standing on her corner who never wanders off.
const lolaMesh = buildPersonMesh(0x9b59b6, 0x1a1a2e, 0xc68863);
lolaMesh.position.set(LOCATIONS.lolaCorner.x + 3, 0, LOCATIONS.lolaCorner.z + 3);
scene.add(lolaMesh);

// The mission-1 target car: a red sporty Comet, parked uptown.
const targetCar = createCar(scene, LOCATIONS.missionCar.x, LOCATIONS.missionCar.z, 0.4, 0xd7263d, { sport: true, topSpeed: 40, accel: 20 });
targetCar.isMissionCar = true;

// --- missions wiring ----------------------------------------------------------

function spawnWave(wave) {
  clearEnemies();
  const count = wave === 1 ? 3 : 4;
  for (let i = 0; i < count; i++) {
    const mesh = buildPersonMesh(0x222222, 0x111111, 0xd9a066);
    const ex = LOCATIONS.warehouse.x + (i % 2 === 0 ? -12 : 12) + i * 2;
    const ez = LOCATIONS.warehouse.z + (i < 2 ? -12 : 12);
    mesh.position.set(ex, 0, ez);
    scene.add(mesh);
    enemies.push({
      mesh, pos: mesh.position, heading: Math.PI, health: 70, dead: false,
      isEnemy: true, isCivilian: false, shootTimer: 1.5 + i * 0.5, walkPhase: 0, speed: 3,
    });
  }
  return count;
}

function clearEnemies() {
  for (const e of enemies) scene.remove(e.mesh);
  enemies = [];
}

const missions = createMissions({
  toast: (t) => hud.toast(t),
  phone: (t) => hud.phone(t),
  pay: (amount) => { player.cash = Math.max(0, player.cash + amount); },
  setWanted: (stars) => police.setWanted(stars),
  spawnWave,
  clearEnemies,
  audio,
});
missions.state.targetCar = targetCar;

// --- game state -----------------------------------------------------------------

const game = {
  mode: 'menu', // menu | playing | paused | ended
  endKind: '',
  camYaw: Math.PI,
  camPitch: 0.32,
  time: 0,
  started: false,
  // Camera shake: impacts and nearby gunfire trauma add to it, the frame
  // loop decays it and offsets the camera by a jitter scaled to it.
  shake: 0,
  lastCrashAt: -9,
  lastScreechAt: -9,
  prevCarSpeed: 0,
  headlightsOn: false,
};

const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyE') interactPressed = true;
  if (e.code === 'KeyR') combat.reload();
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
let interactPressed = false;
let mouseDown = false;
canvas.addEventListener('mousedown', () => { mouseDown = true; });
window.addEventListener('mouseup', () => { mouseDown = false; });
let lastMouseX = null;
window.addEventListener('mousemove', (e) => {
  if (game.mode === 'playing' && mouseDown) {
    if (lastMouseX !== null) game.camYaw -= (e.movementX || 0) * 0.005;
  }
  lastMouseX = e.clientX;
});

// --- save / load ------------------------------------------------------------------

function saveGame() {
  const data = {
    cash: player.cash,
    missionIndex: missions.state.index,
    storyComplete: missions.state.complete,
    x: player.pos.x,
    z: player.pos.z,
    health: player.health,
    packagesFound,
    faresDone: fare.done,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
  return data;
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function applySave(data) {
  if (!data) return;
  player.cash = data.cash ?? player.cash;
  missions.state.index = data.missionIndex ?? -1;
  missions.state.complete = !!data.storyComplete;
  if (typeof data.x === 'number') { player.pos.x = data.x; player.pos.z = data.z; }
  if (typeof data.health === 'number') player.health = data.health;
  // Collectibles and side work persist too: re-hide the packages the
  // save says were already found, in list order.
  if (typeof data.packagesFound === 'number') {
    packagesFound = Math.min(data.packagesFound, packages.length);
    for (let i = 0; i < packagesFound; i++) {
      packages[i].taken = true;
      packages[i].mesh.visible = false;
    }
  }
  if (typeof data.faresDone === 'number') fare.done = data.faresDone;
}

// --- flow: menus, bust, death -------------------------------------------------------

function startGame(fresh) {
  audio.unlock();
  audio.startMusic();
  el('menu-screen').classList.add('hidden');
  el('end-screen').classList.add('hidden');
  hud.show();
  game.mode = 'playing';
  game.started = true;
  if (fresh) {
    hud.phone('LOLA: Welcome to Solano, hotshot. Come to my corner — gold marker — and press E. I have work that pays.');
  }
}

function togglePause() {
  if (game.mode === 'playing') {
    game.mode = 'paused';
    el('pause-screen').classList.remove('hidden');
  } else if (game.mode === 'paused') {
    game.mode = 'playing';
    el('pause-screen').classList.add('hidden');
  }
}

function endRun(kind, title, text) {
  game.mode = 'ended';
  game.endKind = kind;
  el('end-title').textContent = title;
  el('end-text').textContent = text;
  el('end-screen').classList.remove('hidden');
  audio.setSiren(false);
  audio.setEngine(0, false);
}

function onBusted() {
  const fine = Math.min(player.cash, 150 + police.stars * 60);
  player.cash -= fine;
  police.clearWanted();
  police.busted = false;
  endRun('busted', 'BUSTED', `Solano PD got cuffs on you. Fine paid: $${fine}. Your car was impounded — you walk out of the precinct with your pride dented and your wallet lighter.`);
}

function onDeath() {
  police.clearWanted();
  endRun('wasted', 'WASTED', 'You wake up at Solano General. The city keeps your $100 hospital fee and whatever dignity you had left.');
  player.cash = Math.max(0, player.cash - 100);
}

el('btn-start').addEventListener('click', () => startGame(true));
el('btn-continue').addEventListener('click', () => { applySave(loadGame()); startGame(false); });
el('btn-how').addEventListener('click', () => el('how-box').classList.toggle('hidden'));
el('btn-resume').addEventListener('click', togglePause);
el('btn-save').addEventListener('click', () => { saveGame(); hud.toast('Game saved.'); togglePause(); });
el('btn-quit').addEventListener('click', () => location.reload());
el('btn-again').addEventListener('click', () => {
  el('end-screen').classList.add('hidden');
  if (game.endKind === 'wasted') {
    player.pos.set(LOCATIONS.hospital.x + 4, 0, LOCATIONS.hospital.z + 4);
    healPlayer(player, 100);
    player.dead = false;
    if (player.car) { player.car = null; player.mesh.visible = true; }
  } else {
    player.pos.set(LOCATIONS.hospital.x - 20, 0, LOCATIONS.hospital.z - 10);
    healPlayer(player, 40);
  }
  game.mode = 'playing';
});
if (loadGame()) el('btn-continue').classList.remove('hidden');

// --- interactions ---------------------------------------------------------------------

function tryInteract() {
  const p = player.pos;
  // Lola: start the next mission.
  if (!player.car && !missions.state.active && !missions.state.complete &&
      distance2d(p.x, p.z, LOCATIONS.lolaCorner.x, LOCATIONS.lolaCorner.z) < 7) {
    missions.startNext();
    return;
  }
  // Spray shops (two of them now): clear wanted for cash.
  for (const shop of [LOCATIONS.sprayShop, LOCATIONS.sprayShop2]) {
    if (distance2d(p.x, p.z, shop.x, shop.z) < 10) {
      if (police.stars > 0) {
        const cost = 150 + police.stars * 50;
        if (player.cash >= cost) {
          player.cash -= cost;
          police.clearWanted();
          hud.toast(`Fresh paint, clean record. -$${cost}`);
          audio.cash();
        } else {
          hud.toast(`Spray shop needs $${cost} — you are short.`);
        }
        return;
      }
    }
  }
  // Cars: enter or exit.
  if (player.car) {
    exitCar(player, audio);
  } else {
    const car = findNearbyCar(player, allCars());
    if (car) {
      enterCar(player, car, (kind, pos) => onCrime(kind, pos), audio);
      if (car === targetCar) hud.toast('This is the Comet. Deliver it!');
    }
  }
}

function onCrime(kind, pos) {
  police.reportCrime(kind, pos);
  if (kind === 'shot' || kind === 'murder') scarePeds(peds, pos);
}

function allCars() {
  return [...trafficCars, ...police.cars, targetCar, ...enemiesCars()];
}
function enemiesCars() { return []; }

function currentPrompt() {
  if (game.mode !== 'playing') return '';
  const p = player.pos;
  if (player.car) return 'E — exit car · Space — handbrake';
  if (!missions.state.active && !missions.state.complete && distance2d(p.x, p.z, LOCATIONS.lolaCorner.x, LOCATIONS.lolaCorner.z) < 7) return 'E — talk to Lola';
  if (police.stars > 0 && (distance2d(p.x, p.z, LOCATIONS.sprayShop.x, LOCATIONS.sprayShop.z) < 10 || distance2d(p.x, p.z, LOCATIONS.sprayShop2.x, LOCATIONS.sprayShop2.z) < 10)) return `E — spray shop: clear heat for $${150 + police.stars * 50}`;
  if (findNearbyCar(player, allCars())) return 'E — enter car';
  return '';
}

// --- shooting ---------------------------------------------------------------------------

function tryShoot() {
  if (game.mode !== 'playing' || player.car || player.dead) return;
  const origin = new THREE.Vector3(player.pos.x, 1.4, player.pos.z);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const targetPoint = origin.clone().add(dir.multiplyScalar(90));
  targetPoint.y = Math.max(0.5, targetPoint.y);
  const targets = [];
  for (const ped of [...peds, ...enemies]) {
    if (!ped.dead) targets.push({ pos: ped.pos, radius: 0.8, kind: 'person', ref: ped });
  }
  for (const car of allCars()) {
    if (!car.dead) targets.push({ pos: car.pos, radius: 2.0, kind: 'car', ref: car });
  }
  combat.fire(origin, targetPoint, targets, onCrime);
}

// --- scene setups for screenshots --------------------------------------------------------

function teleport(x, z, heading = 0) {
  if (player.car) { player.car.pos.set(x, 0, z); player.car.heading = heading; }
  player.pos.set(x, 0, z);
  player.heading = heading;
  game.camYaw = heading + Math.PI;
}

function setupScene(mode) {
  if (mode === 'menu') return; // menu overlays the live city on purpose
  startGame(false);
  if (mode === 'street') {
    // A mid-city intersection ringed by buildings reads far better than the
    // plaza at Lola's corner, so the street scene starts there.
    teleport(-74, 74, 0.6);
    missions.startNext();
  } else if (mode === 'chase') {
    const car = trafficCars[0];
    car.pos.set(-78, 0, 78);
    enterCar(player, car, null, null);
    car.wasPlayerCar = true;
    police.setWanted(3);
    // Run a few long pursuit ticks so the full quota of police cars spawns,
    // then pull the nearest one in close behind the player — placed on the
    // car's own rear axis so it sits squarely in the chase camera's frame.
    for (let i = 0; i < 5; i++) police.update(1.6, player, world, onBusted);
    missions.startNext();
    teleport(-78, 78, 0.8);
    if (police.cars.length > 0) {
      const cop = police.cars[0];
      // 8.5 m back puts the cruiser between the chase camera (10.5 m back)
      // and the player's car, squarely in frame.
      const backX = player.pos.x - Math.sin(0.8) * 8.5;
      const backZ = player.pos.z - Math.cos(0.8) * 8.5;
      cop.pos.set(backX, 0, backZ);
      cop.heading = 0.8;
      cop.speed = 6;
      cop.mesh.position.copy(cop.pos);
      cop.mesh.rotation.y = cop.heading;
    }
  } else if (mode === 'harbor') {
    teleport(LOCATIONS.harborPickup.x - 8, LOCATIONS.harborPickup.z + 6, 2.2);
    if (missions.state.index < 1) { missions.state.index = 1; }
    missions.startMission(1);
  } else if (mode === 'warehouse') {
    teleport(LOCATIONS.warehouse.x - 20, LOCATIONS.warehouse.z, Math.PI / 2);
    if (missions.state.index < 3) missions.state.index = 3;
    missions.startMission(3);
  }
}

// --- hidden packages: a free-roam collectible ------------------------------------------
// Eighteen glowing briefcases are stashed around Solano — rooftops are
// off limits, so they sit in alleys, on the beach, in the park and
// around the harbour. Walking or driving through one pays a $75
// finder's fee and the HUD keeps count, which gives free roam a quiet
// long-term goal alongside Lola's story chain. The last six spots were
// added with the expansion pass: the park, the marina dock, the far
// corners of the grid and the beach bar all hide one now.
const PACKAGE_SPOTS = [
  { x: -250, z: -60 }, { x: -130, z: 182 }, { x: -26, z: -182 }, { x: 78, z: 26 },
  { x: 182, z: 234 }, { x: 234, z: -234 }, { x: -182, z: -130 }, { x: 26, z: 130 },
  { x: 52, z: -52 }, { x: 120, z: 344 }, { x: 400, z: 200 }, { x: 386, z: -60 },
  { x: -78, z: -26 }, { x: 156, z: -234 }, { x: -234, z: 78 }, { x: 286, z: 286 },
  { x: -286, z: -286 }, { x: 448, z: 8 },
];
const packages = PACKAGE_SPOTS.map((spot) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.55, 0.65),
    new THREE.MeshLambertMaterial({ color: 0x7dff9a })
  );
  mesh.position.set(spot.x, 0.7, spot.z);
  scene.add(mesh);
  return { ...spot, mesh, taken: false };
});
let packagesFound = 0;

function checkPackages() {
  for (const pack of packages) {
    if (pack.taken) continue;
    pack.mesh.rotation.y += 0.03;
    if (distance2d(player.pos.x, player.pos.z, pack.x, pack.z) < 2.6) {
      pack.taken = true;
      pack.mesh.visible = false;
      packagesFound += 1;
      player.cash += 75;
      audio.pickup();
      hud.toast(`Hidden package ${packagesFound}/${packages.length} — +$75`);
      if (packagesFound === packages.length) {
        player.cash += 500;
        hud.phone('LOLA: You found every stash in Solano. Bonus $500 — you have officially cleaned out my city.');
      }
    }
  }
}

// --- side activities: taxi fares and stash drops -----------------------------------------
// Two free-roam earners that run alongside (never instead of) Lola's
// chain, each with its own marker colour so the minimap stays readable:
// cyan for the fare, orange for the stash drop.
//
// TAXI: a passenger waits at one of a handful of kerbs. Roll up slowly in
// any car and they climb in; a destination and a generous clock appear.
// The fare pays distance money, with a tip for arriving with time and
// paint to spare. Exiting the car mid-fare starts a short grace timer —
// abandon the passenger for good and the fare is lost.
//
// STASH DROP: every minute or two a tipster texts about a dropped stash
// somewhere on the road grid. Reach it before the clock dies for a cash
// grab; miss it and someone else pockets it.

const fareMarker = world.makeMarker(0x2ec4b6);
const eventMarker = world.makeMarker(0xff8c42);

const FARE_SPOTS = [
  { x: -126, z: 82 }, { x: 82, z: -126 }, { x: 238, z: 186 }, { x: -238, z: -186 },
  { x: 30, z: 238 }, { x: -186, z: 30 }, { x: 186, z: -238 }, { x: -30, z: -82 },
];
const FARE_DESTS = [
  LOCATIONS.dropOff, LOCATIONS.hospital, LOCATIONS.warehouse, LOCATIONS.hideout,
  LOCATIONS.harborPickup, LOCATIONS.lolaCorner, LOCATIONS.sprayShop2, LOCATIONS.marina,
];
const FARE_NAMES = ['a nurse on her break', 'a tourist with three suitcases', 'a chef still in whites', 'a sax player with a huge case', 'a nervous accountant', 'a surfer late for a contest'];

const fare = {
  phase: 'wait', // wait | ride | cooldown
  spot: FARE_SPOTS[0],
  dest: null,
  mesh: null,
  timeLeft: 0,
  tripDist: 0,
  grace: 0,
  cooldown: 0,
  done: 0,
  name: FARE_NAMES[0],
};

function fareSpawnPassenger() {
  fare.spot = FARE_SPOTS[Math.floor(Math.random() * FARE_SPOTS.length)];
  fare.name = FARE_NAMES[Math.floor(Math.random() * FARE_NAMES.length)];
  if (fare.mesh) scene.remove(fare.mesh);
  fare.mesh = buildPersonMesh(0x2ec4b6, 0x1a1a2e, 0xd9a066, { sunhat: true });
  fare.mesh.position.set(fare.spot.x + 2.5, 0, fare.spot.z + 2.5);
  scene.add(fare.mesh);
  fare.phase = 'wait';
}

function farePickup() {
  scene.remove(fare.mesh);
  fare.mesh = null;
  // Pick a destination genuinely across town from the pickup.
  const options = FARE_DESTS.filter((d) => distance2d(fare.spot.x, fare.spot.z, d.x, d.z) > 170);
  fare.dest = options[Math.floor(Math.random() * options.length)] || LOCATIONS.dropOff;
  fare.tripDist = distance2d(player.pos.x, player.pos.z, fare.dest.x, fare.dest.z);
  fare.timeLeft = fare.tripDist / 7.5 + 50;
  fare.grace = 0;
  fare.phase = 'ride';
  audio.carDoor();
  hud.toast(`Fare aboard: ${fare.name}.`);
  hud.phone(`FARE: "${fare.dest.label}, please — and I am already late, so the fast way, yes?"`);
}

function fareComplete() {
  const base = Math.round(45 + fare.tripDist * 0.5);
  const tip = fare.timeLeft > fare.tripDist / 15 ? Math.round(base * 0.3) : 0;
  const total = base + tip;
  player.cash += total;
  fare.done += 1;
  audio.cash();
  hud.toast(tip > 0 ? `Fare paid $${base} + $${tip} tip! (${fare.done} fares run)` : `Fare paid $${base}. (${fare.done} fares run)`);
  if (fare.done === 5) hud.phone('LOLA: Word travels — the cabbies of Solano are calling you the reliable one. Keep the meter running.');
  fare.phase = 'cooldown';
  fare.cooldown = 16;
  fare.dest = null;
}

function fareFail(reason) {
  hud.toast(reason);
  audio.fail();
  fare.phase = 'cooldown';
  fare.cooldown = 20;
  fare.dest = null;
  if (fare.mesh) { scene.remove(fare.mesh); fare.mesh = null; }
}

function updateFare(dt) {
  if (fare.phase === 'cooldown') {
    fare.cooldown -= dt;
    fareMarker.visible = false;
    if (fare.cooldown <= 0) fareSpawnPassenger();
    return '';
  }
  if (fare.phase === 'wait') {
    fareMarker.visible = true;
    fareMarker.position.set(fare.spot.x, 0, fare.spot.z);
    if (fare.mesh) {
      fare.mesh.position.y = Math.abs(Math.sin(game.time * 2.2)) * 0.12;
      fare.mesh.rotation.y += dt * 0.4;
    }
    if (player.car && Math.abs(player.car.speed) < 4 &&
        distance2d(player.pos.x, player.pos.z, fare.spot.x, fare.spot.z) < 6) {
      farePickup();
    }
    return player.car ? 'TAXI — a passenger waits nearby (cyan marker)' : '';
  }
  // phase === 'ride'
  fareMarker.visible = true;
  fareMarker.position.set(fare.dest.x, 0, fare.dest.z);
  fare.timeLeft -= dt;
  if (!player.car) {
    fare.grace += dt;
    if (fare.grace > 12) {
      fareFail('You abandoned your fare. No pay.');
      return '';
    }
  } else {
    fare.grace = Math.max(0, fare.grace - dt * 2);
  }
  if (fare.timeLeft <= 0) {
    fareFail('Fare took too long — they bailed at a red light.');
    return '';
  }
  const d = distance2d(player.pos.x, player.pos.z, fare.dest.x, fare.dest.z);
  if (d < 9 && player.car) {
    fareComplete();
    return '';
  }
  const clock = Math.max(0, Math.ceil(fare.timeLeft));
  return `FARE → ${fare.dest.label} · ${Math.round(d)}m · ${clock}s${fare.grace > 1 ? ' · GET BACK IN THE CAR' : ''}`;
}

// Stash drop events.
const stash = {
  active: false,
  x: 0,
  z: 0,
  timeLeft: 0,
  nextAt: 50,
  mesh: null,
};

function stashSpawn() {
  // A road point within a few blocks of the player, snapped to the grid
  // so it is always reachable by car.
  const rx = nearestRoadCoord(player.pos.x + (Math.random() - 0.5) * 320);
  const rz = nearestRoadCoord(player.pos.z + (Math.random() - 0.5) * 320);
  stash.x = rx;
  stash.z = rz;
  stash.timeLeft = 48;
  stash.active = true;
  if (!stash.mesh) {
    stash.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.8, 0.9),
      new THREE.MeshLambertMaterial({ color: 0xff8c42 })
    );
    scene.add(stash.mesh);
  }
  stash.mesh.position.set(stash.x, 0.7, stash.z);
  stash.mesh.visible = true;
  hud.phone('TIPSTER: A courier just dropped a stash and kept walking. Orange marker — first hands on it keep it.');
  audio.phoneBuzz();
}

function updateStash(dt) {
  if (!stash.active) {
    eventMarker.visible = false;
    if (stash.mesh) stash.mesh.visible = false;
    stash.nextAt -= dt;
    if (stash.nextAt <= 0 && !missions.state.active) stashSpawn();
    return '';
  }
  eventMarker.visible = true;
  eventMarker.position.set(stash.x, 0, stash.z);
  if (stash.mesh) stash.mesh.rotation.y += dt * 2;
  stash.timeLeft -= dt;
  const d = distance2d(player.pos.x, player.pos.z, stash.x, stash.z);
  if (d < 5) {
    const reward = 120 + Math.floor(Math.random() * 110);
    player.cash += reward;
    audio.pickup();
    audio.cash();
    hud.toast(`Stash grabbed — +$${reward}`);
    stash.active = false;
    stash.nextAt = 65 + Math.random() * 55;
    return '';
  }
  if (stash.timeLeft <= 0) {
    hud.toast('The stash is gone — someone else got there first.');
    stash.active = false;
    stash.nextAt = 70 + Math.random() * 50;
    return '';
  }
  return `STASH DROP → ${Math.round(d)}m · ${Math.ceil(stash.timeLeft)}s`;
}

// Street race — the SOLANO SPRINT. A standing start waits at the south
// end of the harbour apron (magenta marker). Drive through it in any car
// with no story job running and the route lights up: five checkpoints
// across the grid against the clock, each one buying back time. The
// purse is flat plus a per-second bonus for whatever is left on the
// clock at the warehouse finish, so a clean line pays more than a
// demolition run.
const raceMarker = world.makeMarker(0xff5ad0);
const RACE_START = { x: 420, z: 234 };
const RACE_ROUTE = [
  { x: 286, z: 130, label: 'Harbour Gate' },
  { x: 130, z: -26, label: 'Midtown Crossing' },
  { x: -26, z: -182, label: 'North Market' },
  { x: -182, z: -26, label: 'Old Town' },
  { x: LOCATIONS.warehouse.x, z: LOCATIONS.warehouse.z, label: 'Finish — Warehouse' },
];
const race = {
  active: false,
  cpIndex: 0,
  timeLeft: 0,
  cooldown: 0,
  wins: 0,
};

function raceStart() {
  race.active = true;
  race.cpIndex = 0;
  race.timeLeft = 85;
  audio.checkpoint();
  hud.toast('SOLANO SPRINT — follow the magenta markers!');
  hud.phone('RACE CONTROL: Route is live, streets are "closed" (they are not). Purse is $300 plus whatever clock you bring home.');
}

function raceFinish() {
  const bonus = Math.round(race.timeLeft) * 3;
  const total = 300 + bonus;
  player.cash += total;
  race.wins += 1;
  race.active = false;
  race.cooldown = 25;
  audio.cash();
  hud.toast(`SPRINT WON — $300 + $${bonus} time bonus! (${race.wins} wins)`);
  if (race.wins === 3) hud.phone('RACE CONTROL: Three purses. The regulars are asking who the new wheel is. So are we.');
}

function updateRace(dt) {
  if (race.cooldown > 0) race.cooldown -= dt;
  if (!race.active) {
    raceMarker.visible = !missions.state.active && race.cooldown <= 0;
    raceMarker.position.set(RACE_START.x, 0, RACE_START.z);
    if (raceMarker.visible && player.car && Math.abs(player.car.speed) > 3 &&
        distance2d(player.pos.x, player.pos.z, RACE_START.x, RACE_START.z) < 8) {
      raceStart();
    }
    return player.car && raceMarker.visible ? 'SOLANO SPRINT start — harbour apron, magenta marker' : '';
  }
  const cp = RACE_ROUTE[race.cpIndex];
  raceMarker.visible = true;
  raceMarker.position.set(cp.x, 0, cp.z);
  race.timeLeft -= dt;
  if (race.timeLeft <= 0) {
    race.active = false;
    race.cooldown = 15;
    audio.fail();
    hud.toast('Sprint over — the clock took the purse.');
    return '';
  }
  const d = distance2d(player.pos.x, player.pos.z, cp.x, cp.z);
  if (player.car && d < 11) {
    race.cpIndex += 1;
    race.timeLeft += 16;
    if (race.cpIndex >= RACE_ROUTE.length) {
      raceFinish();
      return '';
    }
    audio.checkpoint();
    hud.toast(`${cp.label} cleared — next!`);
  }
  const next = RACE_ROUTE[race.cpIndex];
  return `SPRINT ${race.cpIndex + 1}/${RACE_ROUTE.length} → ${next.label} · ${Math.round(d)}m · ${Math.ceil(race.timeLeft)}s`;
}


fareSpawnPassenger();

// --- the frame loop -------------------------------------------------------------------------

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  game.time += dt;
  packageMesh.rotation.y += dt * 1.4;
  packageMesh.position.y = 0.8 + Math.sin(game.time * 2.4) * 0.2;
  packageMesh.visible = missions.state.active && missions.state.index === 1 && missions.state.step === 0;

  if (game.mode === 'playing') {
    if (interactPressed) { tryInteract(); }
    // Movement.
    if (player.car) {
      stepPlayerDriving(player, {
        throttle: (keys.KeyW || keys.ArrowUp ? 1 : 0) + (keys.KeyS || keys.ArrowDown ? -1 : 0),
        steer: (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (keys.KeyD || keys.ArrowRight ? -1 : 0),
        brake: !!keys.Space,
      }, dt, world);
      audio.setEngine(player.car.speed / player.car.topSpeed, true);
      // Impact feel: a sharp speed loss in one frame means we hit
      // something — shake the camera and play the crunch (throttled).
      const spd = Math.abs(player.car.speed);
      const drop = game.prevCarSpeed - spd;
      if (drop > 7) {
        game.shake = Math.min(0.7, game.shake + drop * 0.02);
        if (game.time - game.lastCrashAt > 0.6) {
          audio.crash();
          game.lastCrashAt = game.time;
        }
      }
      game.prevCarSpeed = spd;
      // Skid marks + tyre screech while sliding: handbrake at speed, or
      // full-lock steering fast enough to break the rear loose.
      const car = player.car;
      const slipping = (keys.Space && spd > 6) || (Math.abs(car.steer) > 0.55 && spd > 19);
      if (slipping) {
        for (const w of rearWheelPositions(car)) skids.leave(w.x, w.z, car.heading);
        if (keys.Space && game.time - game.lastScreechAt > 0.3) {
          audio.screech();
          game.lastScreechAt = game.time;
        }
      }
    } else {
      game.prevCarSpeed = 0;
      stepPlayerOnFoot(player, {
        forward: !!(keys.KeyW || keys.ArrowUp), back: !!(keys.KeyS || keys.ArrowDown),
        left: !!(keys.KeyA || keys.ArrowLeft), right: !!(keys.KeyD || keys.ArrowRight),
        sprint: !!(keys.ShiftLeft || keys.ShiftRight),
      }, game.camYaw, dt, world, onCrime);
      audio.setEngine(0, false);
      if (mouseDown) tryShoot();
    }
    // Traffic & pedestrians keep living around the player.
    for (const car of trafficCars) {
      if (car !== player.car) stepTrafficCar(car, dt, allCars(), player.pos, world);
    }
    separateCars(allCars());
    for (const ped of peds) stepPedestrian(ped, dt, world, null);
    // Enemies fight back.
    for (const e of enemies) {
      if (!e.dead) stepEnemyGunman(e, dt, player, audio, (amt) => {
        game.shake = Math.min(0.5, game.shake + 0.15);
        if (hurtPlayer(player, amt)) onDeath();
      }, (from, to) => combat.enemyShot(from, to));
    }
    // Police.
    police.update(dt, player, world, onBusted);
    audio.setSiren(police.stars > 0 && police.cars.length > 0);
    combat.update(dt);
    // Missions.
    missions.update(dt, {
      playerPos: player.pos,
      playerCar: player.car,
      stars: police.stars,
      enemiesAlive: enemies.filter((e) => !e.dead).length,
      packagesFound,
    });
    if (player.dead && game.mode === 'playing') onDeath();
    checkPackages();
    // Side activities tick here; the fare wins the side label when both
    // have something to say, because it involves a person waiting.
    const fareText = updateFare(dt);
    const raceText = updateRace(dt);
    const stashText = updateStash(dt);
    hud.side(fareText || raceText || stashText);
    hud.prompt(currentPrompt());
  }
  interactPressed = false;
  skids.update(dt);
  world.updateEnvironment(game.time);
  // Headlights follow the day cycle: re-apply the current state to every
  // car twice a second so freshly spawned police cars are included.
  game.lightTimer = (game.lightTimer || 0) - dt;
  if (game.lightTimer <= 0) {
    game.lightTimer = 0.5;
    const wantLights = world.daylight < 0.93;
    for (const car of allCars()) setHeadlights(car, wantLights);
  }

  // Objective marker follows the current target.
  const objective = missions.objective();
  if (objective.target && game.mode !== 'menu') {
    marker.visible = true;
    marker.position.set(objective.target.x, 0, objective.target.z);
  } else {
    marker.visible = false;
  }

  // Camera: orbit for the menu, chase-cam while playing.
  if (game.mode === 'menu') {
    const t = game.time * 0.07;
    camera.position.set(Math.sin(t) * 120, 55, Math.cos(t) * 120);
    camera.lookAt(0, 8, 0);
  } else {
    const focus = player.car ? player.car.pos : player.pos;
    const heading = player.car ? player.car.heading : player.heading;
    const desiredYaw = game.mode === 'playing' && !player.car ? game.camYaw : heading + Math.PI;
    const dist = player.car ? 10.5 : 7.5;
    const height = player.car ? 4.2 : 3.4;
    const cx = focus.x + Math.sin(desiredYaw) * dist * Math.cos(game.camPitch);
    const cz = focus.z + Math.cos(desiredYaw) * dist * Math.cos(game.camPitch);
    camera.position.lerp(new THREE.Vector3(cx, height + Math.sin(game.camPitch) * dist, cz), 0.35);
    // Impact shake: jitter applied after the smooth follow so it reads
    // as trauma, not as a change of direction.
    if (game.shake > 0.004) {
      camera.position.x += (Math.random() - 0.5) * game.shake;
      camera.position.y += (Math.random() - 0.5) * game.shake * 0.7;
      camera.position.z += (Math.random() - 0.5) * game.shake;
    }
    camera.lookAt(focus.x, 1.6, focus.z);
    if (!player.car && game.mode === 'playing') {
      // Keep the on-foot heading aligned with the camera so WASD feels right.
      player.heading = desiredYaw + Math.PI;
      player.mesh.rotation.y = player.heading;
    }
  }

  game.shake = Math.max(0, game.shake - dt * 1.6);

  hud.update(dt, {
    health: player.health,
    cash: player.cash,
    stars: police.stars,
    objective,
    timer: missions.state.active && missions.state.index === 2 ? missions.state.timer : 0,
    bust: police.bust,
    onFoot: !player.car,
    playing: game.mode === 'playing',
    playerPos: player.pos,
    playerHeading: player.heading,
    trafficCars,
    policeCars: police.cars,
    enemies,
    speedKmh: player.car ? Math.abs(player.car.speed) * 3.6 : 0,
    packages,
    fareTarget: fare.phase === 'wait' ? fare.spot : fare.phase === 'ride' ? fare.dest : null,
    eventTarget: stash.active ? stash : null,
    raceTarget: race.active ? RACE_ROUTE[race.cpIndex] : (!missions.state.active && race.cooldown <= 0 ? RACE_START : null),
  });

  renderer.render(scene, camera);
}

// --- debug hook (used by automated playthrough tests) --------------------------------------

window.__solano = {
  get state() {
    return {
      mode: game.mode,
      cash: player.cash,
      health: player.health,
      stars: police.stars,
      bust: police.bust,
      missionIndex: missions.state.index,
      missionStep: missions.state.step,
      missionActive: missions.state.active,
      storyComplete: missions.state.complete,
      enemiesAlive: enemies.filter((e) => !e.dead).length,
      playerPos: { x: player.pos.x, z: player.pos.z },
      inCar: !!player.car,
      isTargetCar: player.car === targetCar,
      packagesFound,
      packagesTotal: packages.length,
      faresDone: fare.done,
      farePhase: fare.phase,
      fareDest: fare.dest ? { x: fare.dest.x, z: fare.dest.z, label: fare.dest.label } : null,
      stashActive: stash.active,
      raceActive: race.active,
      raceCp: race.cpIndex,
      raceWins: race.wins,
      daylight: world.daylight,
      save: loadGame(),
    };
  },
  teleport,
  startMission: () => missions.startNext(),
  completeStep: () => missions.forceStep(),
  completeMission: () => { if (missions.state.active) missions.finishMissionPublic ? missions.finishMissionPublic() : missions.forceStep(); },
  spawnPolice: (stars = 3) => police.setWanted(stars),
  clearWanted: () => police.clearWanted(),
  giveCash: (n) => { player.cash += n; },
  hurt: (n) => hurtPlayer(player, n),
  heal: () => healPlayer(player, 100),
  enterTargetCar: () => { teleport(targetCar.pos.x + 2, targetCar.pos.z); enterCar(player, targetCar, (k, p) => onCrime(k, p), audio); },
  driveTo: (x, z) => { if (player.car) { player.car.pos.set(x, 0, z); } player.pos.set(x, 0, z); },
  killEnemies: () => { for (const e of enemies) { e.health = 0; e.dead = true; e.mesh.rotation.z = Math.PI / 2; } },
  save: () => saveGame(),
  start: () => startGame(true),
  // Side-activity test hooks: force a fare pickup from wherever the
  // passenger currently waits, and force a stash drop to spawn now.
  farePickupNow: () => { if (fare.phase === 'wait') { teleport(fare.spot.x, fare.spot.z); if (!player.car) enterCar(player, trafficCars[0], null, null); player.car.pos.set(fare.spot.x, 0, fare.spot.z); player.pos.set(fare.spot.x, 0, fare.spot.z); } },
  spawnStash: () => { stash.nextAt = 0; },
  raceStartPos: () => ({ ...RACE_START }),
  raceRoute: () => RACE_ROUTE.map((cp) => ({ ...cp })),
  player, police, missions, targetCar, fare, stash, packages, race,
};

// Boot: scene modes other than menu jump straight into their setup.
setupScene(sceneMode);
frame();
