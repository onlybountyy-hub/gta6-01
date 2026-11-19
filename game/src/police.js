// police.js — the Port Solano Police Department. Owns the wanted level: crimes add
// heat, heat becomes stars, stars decide how many cruisers hunt the player. Cruisers
// pursue, ram and try to box the player in; if they keep the player slow and close
// the bust meter fills. Staying unseen lets the heat bleed away.

import { WANTED_THRESHOLDS, POLICE_PER_STAR, PLACES } from './config.js';
import { S } from './state.js';
import { spawnVehicle, removeVehicle, steerToward, approachSpeed, forwardOf } from './vehicles.js';
import { hitPedestrian } from './pedestrians.js';
import { updateSiren } from './audio.js';

/** Stars implied by the current heat total. */
export function starsForHeat(heat) {
  let stars = 0;
  for (let i = 1; i < WANTED_THRESHOLDS.length; i += 1) {
    if (heat >= WANTED_THRESHOLDS[i]) stars = i;
  }
  return stars;
}

/** Full reset: used by hospital respawns, busts and mission scripts. */
export function clearWanted() {
  S.wanted.heat = 0;
  S.wanted.stars = 0;
  S.wanted.bustProgress = 0;
  for (const v of [...S.vehicles]) {
    if (v.ai && v.ai.role === 'police') removeVehicle(v);
  }
}

/** Set an exact star level (mission scripts force the heat of the moment). */
export function setWantedStars(stars) {
  S.wanted.heat = WANTED_THRESHOLDS[Math.max(0, Math.min(5, stars))] + 1;
  S.wanted.lastSeenAt = S.time;
}

/** Find a road point 130–190 m from the player to bring a cruiser in from. */
function spawnPoint() {
  const p = S.playerPos();
  const centers = S.roadCenters;
  const candidates = [];
  for (const cx of centers) {
    for (const cz of centers) {
      const d = Math.hypot(cx - p.x, cz - p.z);
      if (d > 120 && d < 200) candidates.push({ x: cx, z: cz });
    }
  }
  if (!candidates.length) return { x: p.x + 150, z: p.z };
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function spawnCruiser() {
  const at = spawnPoint();
  const v = spawnVehicle('cruiser', 0x23262b, at.x, at.z, Math.atan2(S.player.x - at.x, S.player.z - at.z), {
    ai: { role: 'police', reverseTimer: 0, wreckTimer: 0 },
  });
  return v;
}

function policeUnits() {
  return S.vehicles.filter((v) => v.ai && v.ai.role === 'police');
}

/** Advance the wanted simulation and every cruiser one frame. */
export function updatePolice(dt) {
  const w = S.wanted;
  const p = S.playerPos();
  const units = policeUnits();

  // Eyes on the player? Any unit close enough keeps the heat from cooling.
  let nearest = Infinity;
  for (const u of units) {
    const d = Math.hypot(u.x - p.x, u.z - p.z);
    if (d < nearest) nearest = d;
    if (d < 70 && !u.dead) w.lastSeenAt = S.time;
  }
  if (S.time - w.lastSeenAt > 6) {
    w.heat = Math.max(0, w.heat - dt * 1.15);
  }
  const newStars = starsForHeat(w.heat);
  if (newStars !== w.stars) {
    if (newStars > w.stars) S.notify(`Wanted level ${'★'.repeat(newStars)}`, 'bad');
    if (newStars === 0 && w.stars > 0) S.notify('You lost the cops', 'good');
    w.stars = newStars;
  }

  // Fleet size follows the stars; spares melt away when the heat dies.
  const wanted_count = POLICE_PER_STAR[w.stars];
  const active = units.filter((u) => !u.dead);
  if (active.length < wanted_count) {
    spawnCruiser();
  } else if (active.length > wanted_count) {
    const far = active.find((u) => Math.hypot(u.x - p.x, u.z - p.z) > 200);
    if (far) removeVehicle(far);
  }

  // Siren loudness follows the nearest unit.
  updateSiren(w.stars > 0 && nearest !== Infinity ? Math.max(0, 1 - nearest / 95) * 0.12 : 0);

  // Bust pressure: close units + a slow player = the meter fills.
  const playerSpeed = S.playerSpeed();
  if (w.stars > 0 && nearest < 10.5 && playerSpeed < 2.3 && !S.player.dead) {
    w.bustProgress = Math.min(1, w.bustProgress + dt / 2.8);
    if (w.bustProgress >= 1) {
      S.busted = true;
      w.bustProgress = 0;
    }
  } else {
    w.bustProgress = Math.max(0, w.bustProgress - dt * 0.55);
  }

  // Drive every cruiser.
  for (const u of units) {
    // Flash the light bar.
    const phase = Math.floor(S.time * 3.4 + u.x) % 2 === 0;
    if (u.mesh.userData.lightRed) u.mesh.userData.lightRed.visible = phase;
    if (u.mesh.userData.lightBlue) u.mesh.userData.lightBlue.visible = !phase;
    if (u.dead) {
      u.ai.wreckTimer += dt;
      u.speed = 0;
      if (u.ai.wreckTimer > 7) removeVehicle(u);
      continue;
    }
    const dist = Math.hypot(p.x - u.x, p.z - u.z);
    const fwd = forwardOf(u.heading);
    const dot = ((p.x - u.x) * fwd.x + (p.z - u.z) * fwd.z) / Math.max(1, dist);
    let target;
    if (dist < 8 && dot < -0.25) {
      // Overshot the player: back up and swing round.
      target = -9;
      steerToward(u, p.x, p.z, dt, 2.4);
    } else {
      steerToward(u, p.x, p.z, dt, 2.1);
      if (dist > 55) target = u.spec.topSpeed;
      else if (dist > 16) target = Math.max(playerSpeed + 6, 14);
      else target = Math.max(playerSpeed + 2.5, 7);
      // Do not plough through traffic at full tilt.
      for (const other of S.vehicles) {
        if (other === u || (other.ai && other.ai.role === 'police')) continue;
        const ahead = (other.x - u.x) * fwd.x + (other.z - u.z) * fwd.z;
        const lateral = Math.abs((other.x - u.x) * fwd.z - (other.z - u.z) * fwd.x);
        if (ahead > 0 && ahead < 9 && lateral < 2.4) target = Math.min(target, Math.max(0, other.speed));
      }
    }
    approachSpeed(u, target, dt);
    if (Math.abs(u.speed) > 3) {
      for (const ped of S.peds) {
        if (!ped.dead && Math.hypot(ped.x - u.x, ped.z - u.z) < 1.9) hitPedestrian(ped, u);
      }
    }
  }
}

/** Where a busted player is taken: outside PSPD Central, broke and starless. */
export function bustDropPoint() {
  return { x: PLACES.policeStation.x + 8, z: PLACES.policeStation.z + 12 };
}
