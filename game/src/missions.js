// missions.js — Lola Marchetti's five-job story chain for SOLANO HEAT.
//
// The story is a linear state machine. Each mission is a list of steps;
// each step has a target location, a HUD line, and a check that runs every
// frame. Completing a step advances the machine, completing a mission pays
// cash and queues the next phone message, and finishing the fifth mission
// sets the story-complete flag that the save file and the end screen use.
//
//   1. GRAND THEFT SOLANO — steal the marked Comet and deliver it.
//   2. HARBOR RUN — collect a package at Berth 7, bring it to the lockup
//      while the heat rises on a script.
//   3. CLOCKWORK GETAWAY — drive four checkpoints against the clock.
//   4. WAREHOUSE CLEARANCE — clear two waves of guards on foot.
//   5. LONG WAY HOME — cross the city at four stars to the beach hideout.
//
// Failing a timed step restarts that mission at a small cash cost, never
// the whole chain, so the story can always be finished in one sitting.

import { LOCATIONS } from './world.js';
import { distance2d } from './rng.js';

export const MISSION_DEFS = [
  {
    id: 'm1',
    title: '1 · GRAND THEFT SOLANO',
    pay: 400,
    intro: "LOLA: See that red Comet parked uptown? It's mine now. Bring it to my drop-off garage. Don't scratch it. Much.",
  },
  {
    id: 'm2',
    title: '2 · HARBOR RUN',
    pay: 650,
    intro: 'LOLA: A package is waiting at Berth 7, down at the harbor. Pick it up and bring it to my lockup. If the stars rise, keep moving.',
  },
  {
    id: 'm3',
    title: '3 · CLOCKWORK GETAWAY',
    pay: 800,
    intro: "LOLA: My driver bailed. You drive the route — hit every checkpoint before the clock dies. Fast, clean, gone.",
  },
  {
    id: 'm4',
    title: '4 · WAREHOUSE CLEARANCE',
    pay: 1100,
    intro: 'LOLA: Rivals took my harbor warehouse. Go in on foot and clear them out. All of them. I will make it worth your while.',
  },
  {
    id: 'm5',
    title: '5 · LONG WAY HOME',
    pay: 1600,
    intro: "LOLA: Last one, and it's hot. Every badge in Solano will be lit. Get to the beach hideout alive and the city is yours.",
  },
];

export function createMissions(hooks) {
  // hooks: { toast, phone, pay, setWanted, spawnWave, clearEnemies, audio }
  const state = {
    index: -1, // -1 = not started, 0..4 active/done count
    step: 0,
    active: false,
    complete: false,
    timer: 0,
    checkpoints: [],
    cpIndex: 0,
    wave: 0,
    killsNeeded: 0,
    targetCar: null,
    hasPackage: false,
    // One-shot flavour pings: mid-mission phone lines fire once per
    // mission run (halfway points, low-clock warnings) and reset here.
    midPing: false,
    lowTimePing: false,
  };

  function currentDef() {
    return MISSION_DEFS[state.index] || null;
  }

  function startMission(i) {
    state.index = i;
    state.step = 0;
    state.active = true;
    state.timer = 0;
    state.cpIndex = 0;
    state.wave = 0;
    state.hasPackage = false;
    state.midPing = false;
    state.lowTimePing = false;
    const def = currentDef();
    hooks.phone(def.intro);
    hooks.audio.phoneBuzz();
    if (def.id === 'm3') {
      state.checkpoints = [
        { x: -60, z: -120, label: 'Checkpoint 1' },
        { x: 120, z: -60, label: 'Checkpoint 2' },
        { x: 60, z: 140, label: 'Checkpoint 3' },
        { x: LOCATIONS.dropOff.x, z: LOCATIONS.dropOff.z, label: 'Finish — Drop-Off' },
      ];
      // Snap checkpoints onto roads.
      for (const cp of state.checkpoints) {
        cp.x = Math.round((cp.x + 286) / 52) * 52 - 286;
        cp.z = Math.round((cp.z + 286) / 52) * 52 - 286;
      }
      state.timer = 115;
    }
    if (def.id === 'm4') {
      state.wave = 1;
      state.killsNeeded = hooks.spawnWave(1);
    }
    if (def.id === 'm5') {
      hooks.setWanted(4);
    }
  }

  // One outro line per job, so the phone feels like a conversation with
  // a person rather than a payment terminal.
  const OUTROS = {
    m1: 'The Comet purrs like she missed me. You have a thief\'s hands and a valet\'s manners — rare combo.',
    m2: 'Package is home and nobody is in a cell. The harbour boys send their confusion.',
    m3: 'Every checkpoint, time to spare. My old driver is officially retired.',
    m4: 'The warehouse is mine again and the rivals are a rumour. You are expensive and worth it.',
    m5: 'Sirens gone, sand between your toes. That was the last job on my list.',
  };

  function finishMission() {
    const def = currentDef();
    hooks.pay(def.pay);
    hooks.audio.cash();
    hooks.toast(`Mission complete: +$${def.pay}`);
    const outro = OUTROS[def.id] || 'Good work.';
    hooks.phone(`LOLA: ${outro} $${def.pay} is yours. ${state.index >= 4 ? 'Solano is yours now — keep her warm for me.' : 'Come back to my corner when you are ready for more.'}`);
    state.active = false;
    if (state.index >= 4) {
      state.complete = true;
    }
    state.index += 1;
  }

  function failMission(reason) {
    hooks.audio.fail();
    hooks.toast(reason + ' — job restarted, $50 fee');
    hooks.pay(-50);
    hooks.clearEnemies();
    startMission(state.index);
    hooks.phone('LOLA: Sloppy. I am giving you another run at it — do not make me regret the faith.');
  }

  // The per-frame objective query the HUD and minimap both read.
  function objective() {
    if (state.complete) return { title: 'STORY COMPLETE', text: 'Solano is yours. Free roam — the spray shop still works.', target: null };
    if (!state.active) {
      return { title: 'FREE ROAM', text: "Go to Lola's corner (gold marker) and press E to take the next job.", target: LOCATIONS.lolaCorner };
    }
    const def = currentDef();
    switch (def.id) {
      case 'm1':
        if (state.step === 0) return { title: def.title, text: 'Steal the marked red Comet uptown.', target: state.targetCar ? { x: state.targetCar.pos.x, z: state.targetCar.pos.z } : LOCATIONS.missionCar };
        return { title: def.title, text: 'Deliver the Comet to the drop-off garage.', target: LOCATIONS.dropOff };
      case 'm2':
        if (state.step === 0) return { title: def.title, text: 'Pick up the package at Berth 7 in the harbor.', target: LOCATIONS.harborPickup };
        return { title: def.title, text: "Bring the package to Lola's lockup.", target: LOCATIONS.harborReturn };
      case 'm3': {
        const cp = state.checkpoints[state.cpIndex];
        return { title: def.title, text: `Drive to ${cp ? cp.label : 'the finish'} — in any car, fast.`, target: cp || LOCATIONS.dropOff };
      }
      case 'm4':
        return { title: def.title, text: `Clear the warehouse — wave ${state.wave}, ${state.killsNeeded} rival(s) left standing.`, target: LOCATIONS.warehouse };
      case 'm5':
        return { title: def.title, text: 'Lose yourself at the beach hideout. Survive the heat.', target: LOCATIONS.hideout };
      default:
        return { title: def.title, text: '', target: null };
    }
  }

  // Called every frame with the live game snapshot.
  function update(dt, snap) {
    if (!state.active || state.complete) return;
    const def = currentDef();
    const p = snap.playerPos;
    const near = (loc, r) => distance2d(p.x, p.z, loc.x, loc.z) < r;

    if (def.id === 'm1') {
      if (state.step === 0 && snap.playerCar && state.targetCar && snap.playerCar === state.targetCar) {
        state.step = 1;
        hooks.toast('Car stolen! Get it to the drop-off.');
        hooks.phone('LOLA: That is my girl rolling. Garage, gold marker — and if the paint comes back scratched, so does your pay.');
        hooks.setWanted(Math.max(snap.stars, 2));
      } else if (state.step === 1 && snap.playerCar === state.targetCar && near(LOCATIONS.dropOff, 9)) {
        finishMission();
      }
    } else if (def.id === 'm2') {
      if (state.step === 0 && near(LOCATIONS.harborPickup, 7)) {
        state.step = 1;
        state.hasPackage = true;
        hooks.audio.pickup();
        hooks.toast('Package collected!');
        hooks.phone('LOLA: You have it? Good. Do not open it, do not drop it, do not let the harbour patrol make it a story.');
        hooks.setWanted(Math.max(snap.stars, 2));
      } else if (state.step === 1 && near(LOCATIONS.harborReturn, 9)) {
        state.hasPackage = false;
        finishMission();
      }
    } else if (def.id === 'm3') {
      state.timer -= dt;
      if (state.timer <= 0) {
        failMission('Out of time');
        return;
      }
      if (!state.lowTimePing && state.timer < 25) {
        state.lowTimePing = true;
        hooks.phone('LOLA: Clock is chewing your tyres, driver. Whatever you are saving the fast driving for — this is it.');
      }
      const cp = state.checkpoints[state.cpIndex];
      if (cp && snap.playerCar && near(cp, 10)) {
        hooks.audio.checkpoint();
        hooks.toast(cp.label + ' cleared!');
        state.cpIndex += 1;
        state.timer += 22;
        if (state.cpIndex === 2 && state.checkpoints.length > 2) {
          hooks.phone('LOLA: Half the route in the bag and the car still has all its mirrors. Keep exactly that energy.');
        }
        if (state.cpIndex >= state.checkpoints.length) finishMission();
      }
    } else if (def.id === 'm4') {
      state.killsNeeded = snap.enemiesAlive;
      if (snap.enemiesAlive === 0) {
        if (state.wave === 1) {
          state.wave = 2;
          state.killsNeeded = hooks.spawnWave(2);
          hooks.toast('Wave 2 — hold on!');
          hooks.phone('LOLA: More of them pouring in? Then they agree with me about what that warehouse is worth. Finish it.');
          hooks.setWanted(Math.max(snap.stars, 1));
        } else {
          finishMission();
        }
      }
    } else if (def.id === 'm5') {
      if (snap.stars < 3) hooks.setWanted(4);
      if (!state.midPing && distance2d(p.x, p.z, LOCATIONS.hideout.x, LOCATIONS.hideout.z) < 240) {
        state.midPing = true;
        hooks.phone('LOLA: I can hear the sirens from the beach, hotshot. Nearly home — bring my city back in one piece.');
      }
      if (near(LOCATIONS.hideout, 10)) {
        hooks.setWanted(0);
        finishMission();
      }
    }
  }

  return {
    state,
    startMission,
    finishMission,
    objective,
    update,
    // Debug / test helpers.
    startNext() {
      if (state.complete) return false;
      startMission(Math.max(0, state.index));
      return true;
    },
    forceStep() {
      // Advance the active mission by one step (used by automated tests).
      const def = currentDef();
      if (!def || !state.active) return;
      if (def.id === 'm1') {
        if (state.step === 0) state.step = 1;
        else finishMission();
      } else if (def.id === 'm2') {
        if (state.step === 0) { state.step = 1; state.hasPackage = true; }
        else finishMission();
      } else if (def.id === 'm3') {
        state.cpIndex += 1;
        if (state.cpIndex >= state.checkpoints.length) finishMission();
      } else if (def.id === 'm4') {
        hooks.clearEnemies();
        if (state.wave === 1) { state.wave = 2; state.killsNeeded = hooks.spawnWave(2); }
        else finishMission();
      } else if (def.id === 'm5') {
        finishMission();
      }
    },
  };
}
