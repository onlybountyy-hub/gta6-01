// missions.js — Lola Marchetti's five-job story chain, the dialogue system, the
// objective beacon and the stage engine that runs each job: go somewhere, take a
// car, lose the police, beat the clock, run cargo hot, and finally escape to the
// boat. Between jobs the café marker offers the next one; after the finale the
// chain loops for replays.

import * as THREE from 'three';
import { PLACES } from './config.js';
import { S } from './state.js';
import { keys } from './input.js';
import { spawnVehicle } from './vehicles.js';
import { setWantedStars } from './police.js';
import { playPickup, playSuccessSting, playFailSting } from './audio.js';
import { saveGame } from './save.js';

let beacon = null;
let beaconRing = null;
let packageProp = null;
let cargoProp = null;
let promptCooldown = 0;

S.progress = { nextMission: 0 };
S.mission = { active: false, index: -1, stage: -1, stages: [], data: {} };
S.dialogue = null; // {lines: [{who, text}], index, timer, onDone}
S.prompt = ''; // "Press E …" line hud.js shows near the bottom
S.banner = null; // {title, sub, until}

/** Show a dialogue sequence; gameplay input pauses until it finishes. */
export function showDialogue(lines, onDone = null) {
  S.dialogue = { lines, index: 0, timer: 0, onDone };
  S.mode = 'dialogue';
}

/** Advance dialogue: E or a click of time moves to the next line. */
export function updateDialogue(dt) {
  const d = S.dialogue;
  if (!d) return;
  d.timer += dt;
  if ((keys.KeyE && d.timer > 0.35) || d.timer > 4.2) {
    d.index += 1;
    d.timer = 0;
    if (d.index >= d.lines.length) {
      S.dialogue = null;
      S.mode = 'playing';
      if (d.onDone) d.onDone();
    }
  }
}

function banner(title, sub) {
  S.banner = { title, sub, until: S.time + 3.6 };
}

function gotoStage(x, z, text, radius = 8) {
  return {
    kind: 'goto',
    x,
    z,
    radius,
    text,
    check() {
      const p = S.playerPos();
      return Math.hypot(p.x - x, p.z - z) < radius;
    },
  };
}

const MISSIONS = [
  {
    title: 'First Run',
    reward: 300,
    intro: [
      { who: 'Lola', text: 'Marco. You drive, you do not ask what is in the box. That is the whole job.' },
      { who: 'Marco', text: 'And the pay?' },
      { who: 'Lola', text: 'Three hundred, and my continued friendship. Pick up the package behind the café, take it to Solano Freight.' },
    ],
    outro: [
      { who: 'Lola', text: 'Clean and quick. The warehouse boys like you already. Come back, there is more.' },
    ],
    build() {
      packageProp.visible = true;
      packageProp.position.set(-222, 0.6, -252);
      return [
        {
          ...gotoStage(-222, -252, 'Pick up the package behind the café', 5),
          onComplete() {
            packageProp.visible = false;
            playPickup();
            S.notify('Package picked up', 'good');
          },
        },
        gotoStage(PLACES.warehouse.x, PLACES.warehouse.z, 'Deliver the package to Solano Freight', 10),
      ];
    },
  },
  {
    title: 'Hot Wheels',
    reward: 650,
    intro: [
      { who: 'Lola', text: 'A gold sedan, parked on Palmetto Avenue. A collector wants it. The owner... disagrees.' },
      { who: 'Marco', text: 'So the second I touch it, every cop in Port Solano wakes up.' },
      { who: 'Lola', text: 'Shake them off, then bring it to Rico at the chop garage. He is expecting you.' },
    ],
    outro: [{ who: 'Lola', text: 'Rico says the paint alone is worth the risk. Six fifty, as agreed.' }],
    build() {
      const car = spawnVehicle('sedan', 0xd8a920, 141, -10, 0, { parked: true });
      car.missionMark = true;
      return [
        gotoStage(141, -10, 'Find the gold sedan on Palmetto Avenue', 7),
        {
          kind: 'enter',
          x: 141,
          z: -10,
          radius: 7,
          text: 'Steal the gold sedan (F)',
          check: () => S.player.inVehicle === car,
          onComplete() {
            setWantedStars(2);
            S.notify('The owner called it in — lose the cops!', 'bad');
          },
        },
        {
          kind: 'lose',
          x: PLACES.garage.x,
          z: PLACES.garage.z,
          radius: 8,
          text: 'Lose the police',
          check: () => S.wanted.stars === 0,
        },
        {
          ...gotoStage(PLACES.garage.x, PLACES.garage.z, "Deliver the sedan to Rico's garage", 10),
          check() {
            const p = S.playerPos();
            return Math.hypot(p.x - PLACES.garage.x, p.z - PLACES.garage.z) < 10 && S.player.inVehicle === car;
          },
        },
      ];
    },
  },
  {
    title: 'Harbor Sprint',
    reward: 500,
    intro: [
      { who: 'Lola', text: 'A courier bet me his boat money that nobody can run my five points in under two minutes.' },
      { who: 'Marco', text: 'And you volunteered my driving.' },
      { who: 'Lola', text: 'I volunteered your talent. Hit every beacon, finish back here. Clock is already rude.' },
    ],
    outro: [{ who: 'Lola', text: 'He is paying up and crying about it. Beautiful. Five hundred for you.' }],
    build() {
      const points = [
        { x: 27, z: -243 },
        { x: 243, z: -27 },
        { x: 135, z: 189 },
        { x: -189, z: 135 },
        { x: PLACES.cafe.x, z: PLACES.cafe.z },
      ];
      return [
        {
          kind: 'race',
          points,
          timeLimit: 115,
          text: 'Hit every checkpoint before the clock runs out',
        },
      ];
    },
  },
  {
    title: 'Hot Cargo',
    reward: 950,
    intro: [
      { who: 'Lola', text: 'Solano Freight again. This time the cargo is... loud. Customs has questions.' },
      { who: 'Marco', text: 'Let me guess. Three stars worth of questions.' },
      { who: 'Lola', text: 'Take it to the harbour pier. My boat crew will handle the rest. Do not stop for anyone.' },
    ],
    outro: [{ who: 'Lola', text: 'The crew has it. Whatever it was, it is international water now. Nine fifty.' }],
    build() {
      cargoProp.visible = true;
      cargoProp.position.set(PLACES.warehouse.x - 8, 0.8, PLACES.warehouse.z + 6);
      return [
        {
          ...gotoStage(PLACES.warehouse.x - 8, PLACES.warehouse.z + 6, 'Collect the cargo at Solano Freight', 7),
          onComplete() {
            cargoProp.visible = false;
            playPickup();
            setWantedStars(3);
            S.notify('Cargo aboard — the PSPD is rolling!', 'bad');
          },
        },
        gotoStage(388, PLACES.pierEnd.z, 'Run the cargo to the harbour pier', 11),
      ];
    },
  },
  {
    title: 'Last Boat Out',
    reward: 2000,
    intro: [
      { who: 'Lola', text: 'Marco, listen. The last job sang. Every badge in the city has your face by now.' },
      { who: 'Marco', text: 'Tell me you have a way out of Port Solano.' },
      { who: 'Lola', text: 'My boat, at the end of the pier. Get there. Whatever it takes. I will be waiting.' },
    ],
    outro: [
      { who: 'Lola', text: 'You made it. Open water, no sirens. Port Solano is yours whenever you want it back.' },
      { who: 'Marco', text: 'Best fixer on the coast, Lola.' },
    ],
    build() {
      setWantedStars(4);
      return [gotoStage(PLACES.boat.x, PLACES.boat.z, 'Escape to the boat at the end of the pier', 12)];
    },
  },
];

/** Create the beacon and props. Called once at boot. */
export function initMissions() {
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xffc94d,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 90, 20, 1, true), beaconMat);
  beacon.visible = false;
  S.scene.add(beacon);
  beaconRing = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.4, 28),
    new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.visible = false;
  S.scene.add(beaconRing);

  packageProp = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.7, 0.9),
    new THREE.MeshLambertMaterial({ color: 0xc7a23a, emissive: 0x554411 }),
  );
  packageProp.visible = false;
  packageProp.castShadow = true;
  S.scene.add(packageProp);
  cargoProp = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.2, 1.6),
    new THREE.MeshLambertMaterial({ color: 0x707880, emissive: 0x222222 }),
  );
  cargoProp.visible = false;
  cargoProp.castShadow = true;
  S.scene.add(cargoProp);
}

/** Begin mission `index` with its intro dialogue. */
export function startMission(index) {
  const def = MISSIONS[index];
  S.mission.index = index;
  showDialogue(def.intro, () => {
    S.mission.active = true;
    S.mission.stage = 0;
    S.mission.stages = def.build();
    S.mission.data = {};
    applyStage();
    S.notify(`Mission started: ${def.title}`, 'info');
  });
}

function applyStage() {
  const m = S.mission;
  const stage = m.stages[m.stage];
  if (!stage) return;
  if (stage.kind === 'race') {
    m.data.point = 0;
    m.data.timeLeft = stage.timeLimit;
    const pt = stage.points[0];
    S.objective = { x: pt.x, z: pt.z, label: 'Checkpoint' };
    S.objectiveText = `${stage.text} — checkpoint 1/${stage.points.length}`;
  } else {
    S.objective = { x: stage.x, z: stage.z, label: m.stages.length ? MISSIONS[m.index].title : '' };
    S.objectiveText = stage.text;
  }
  if (stage.onStart) stage.onStart();
}

function completeMission() {
  const def = MISSIONS[S.mission.index];
  S.mission.active = false;
  S.mission.stages = [];
  S.objective = null;
  S.objectiveText = '';
  S.cash += def.reward;
  playSuccessSting();
  banner('MISSION COMPLETE', `${def.title} — +$${def.reward}`);
  if (S.mission.index === MISSIONS.length - 1) {
    S.storyComplete = true;
    banner('STORY COMPLETE', 'Port Solano is yours. Lola still has work, if you want it.');
  }
  S.progress.nextMission = (S.mission.index + 1) % MISSIONS.length;
  saveGame();
  showDialogue(def.outro, null);
}

/** Called when the player is busted or wasted mid-job: the job is blown. */
export function failMission(reason) {
  if (!S.mission.active) return;
  S.mission.active = false;
  S.mission.stages = [];
  S.objective = null;
  S.objectiveText = '';
  packageProp.visible = false;
  cargoProp.visible = false;
  playFailSting();
  S.notify(`Mission failed — ${reason}. Lola still has the job open.`, 'bad');
}

/** Per-frame mission logic: giver prompt, stage checks, race clock, beacon pose. */
export function updateMissions(dt) {
  promptCooldown = Math.max(0, promptCooldown - dt);
  const m = S.mission;
  const p = S.playerPos();

  if (!m.active && !S.dialogue) {
    // The café marker offers the next job.
    S.objective = { x: PLACES.cafe.x, z: PLACES.cafe.z, label: 'Lola — next job' };
    S.objectiveText = S.storyComplete ? 'Free roam — talk to Lola for another run' : `Talk to Lola: ${MISSIONS[S.progress.nextMission].title}`;
    const near = Math.hypot(p.x - PLACES.cafe.x, p.z - PLACES.cafe.z) < 6.5 && !S.player.inVehicle;
    S.prompt = near ? 'Press E — Talk to Lola' : '';
    if (near && keys.KeyE && promptCooldown <= 0) {
      promptCooldown = 1;
      startMission(S.progress.nextMission);
    }
  } else {
    S.prompt = '';
  }

  if (m.active) {
    const stage = m.stages[m.stage];
    if (stage) {
      if (stage.kind === 'race') {
        m.data.timeLeft -= dt;
        const pt = stage.points[m.data.point];
        S.objectiveText = `Checkpoint ${m.data.point + 1}/${stage.points.length} — ${Math.max(0, Math.ceil(m.data.timeLeft))}s`;
        if (m.data.timeLeft <= 0) {
          playFailSting();
          S.notify('Out of time — the run restarts.', 'bad');
          m.data.point = 0;
          m.data.timeLeft = stage.timeLimit;
          const first = stage.points[0];
          S.objective = { x: first.x, z: first.z, label: 'Checkpoint' };
        } else if (Math.hypot(p.x - pt.x, p.z - pt.z) < 11) {
          playPickup();
          m.data.point += 1;
          if (m.data.point >= stage.points.length) {
            finishStage();
          } else {
            const next = stage.points[m.data.point];
            S.objective = { x: next.x, z: next.z, label: 'Checkpoint' };
            S.notify(`Checkpoint ${m.data.point}/${stage.points.length}`, 'good');
          }
        }
      } else if (stage.check(dt)) {
        if (stage.onComplete) stage.onComplete();
        finishStage();
      }
    }
  }

  // Beacon follows the objective.
  const show = Boolean(S.objective) && S.mode !== 'menu';
  beacon.visible = show;
  beaconRing.visible = show;
  if (show) {
    const onPier = S.objective.x > 356;
    beacon.position.set(S.objective.x, 45, S.objective.z);
    beaconRing.position.set(S.objective.x, onPier ? 1.2 : 0.15, S.objective.z);
    const s = 1 + Math.sin(S.time * 3.2) * 0.12;
    beaconRing.scale.set(s, s, 1);
  }
  if (packageProp.visible) packageProp.rotation.y += dt * 1.4;
  if (cargoProp.visible) cargoProp.rotation.y += dt * 0.9;
}

function finishStage() {
  const m = S.mission;
  m.stage += 1;
  if (m.stage >= m.stages.length) completeMission();
  else applyStage();
}

/** Mission metadata for menus and the HUD. */
export function missionCount() {
  return MISSIONS.length;
}
export function missionTitle(index) {
  return MISSIONS[index].title;
}
