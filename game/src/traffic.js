// traffic.js — civilian traffic. Each car follows the road grid in the right-hand
// lane, chooses turns at junctions, brakes for the car (or person) ahead, and honks
// when it gets stuck. Cars that drift too far from the player are quietly recycled
// to a road near the action so the city always feels lived in.

import { CITY } from './config.js';
import { S } from './state.js';
import { makeRng, pick, randRange } from './random.js';
import { spawnVehicle, steerToward, approachSpeed, forwardOf, CAR_COLORS } from './vehicles.js';
import { hitPedestrian } from './pedestrians.js';
import { playHorn } from './audio.js';

const TRAFFIC_COUNT = 14;
const rng = makeRng(4242);

/** Lane centre coordinate for a car travelling along a road. */
function laneCoord(coord, dir, axis) {
  // Right-hand traffic: heading +Z keeps to x = c - lane, heading +X keeps z = c + lane.
  return axis === 'z' ? coord - dir * CITY.laneOffset : coord + dir * CITY.laneOffset;
}

/** Place a traffic car on a random road, away from the player's current position. */
function placeOnRoad(v, minDist = 60) {
  const p = S.playerPos();
  for (let tries = 0; tries < 12; tries += 1) {
    const axis = rng() < 0.5 ? 'z' : 'x';
    const coord = pick(rng, S.roadCenters);
    const along = randRange(rng, -310, 310);
    const dir = rng() < 0.5 ? 1 : -1;
    const lane = laneCoord(coord, dir, axis);
    const x = axis === 'z' ? lane : along;
    const z = axis === 'z' ? along : lane;
    if (Math.hypot(x - p.x, z - p.z) < minDist) continue;
    v.x = x;
    v.z = z;
    v.heading = axis === 'z' ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    v.speed = 0;
    v.ai = { role: 'traffic', axis, coord, dir, turnTarget: null, pending: null, blockedFor: 0, cruise: randRange(rng, 10.5, 14.5) };
    return;
  }
}

/** Spawn the traffic fleet. Called once at boot. */
export function initTraffic() {
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const type = pick(rng, ['sedan', 'sedan', 'hatch', 'hatch', 'truck']);
    const v = spawnVehicle(type, pick(rng, CAR_COLORS), 0, -999, 0, {});
    placeOnRoad(v, 40);
  }
}

/** The next junction coordinate ahead of the car on its current road, or null. */
function nextJunction(v) {
  const ai = v.ai;
  const pos = ai.axis === 'z' ? v.z : v.x;
  let best = null;
  for (const c of S.roadCenters) {
    const ahead = (c - pos) * ai.dir;
    if (ahead > 4 && (best === null || ahead < best.ahead)) best = { coord: c, ahead };
  }
  return best;
}

/** Something solid ahead in this car's lane? Returns a target speed cap. */
function obstacleCap(v) {
  const fwd = forwardOf(v.heading);
  let cap = Infinity;
  const consider = (ox, oz, radius) => {
    const dx = ox - v.x;
    const dz = oz - v.z;
    const ahead = dx * fwd.x + dz * fwd.z;
    const lateral = Math.abs(dx * fwd.z - dz * fwd.x);
    if (ahead > 0 && ahead < 13 && lateral < 2.1 + radius) cap = Math.min(cap, ahead < 6 ? 0 : 4);
  };
  for (const other of S.vehicles) {
    if (other !== v) consider(other.x, other.z, 0.6);
  }
  if (!S.player.inVehicle) consider(S.player.x, S.player.z, 0);
  for (const ped of S.peds) {
    if (!ped.dead) consider(ped.x, ped.z, 0);
  }
  return cap;
}

/** Advance all traffic cars one frame. */
export function updateTraffic(dt) {
  const p = S.playerPos();
  for (const v of S.vehicles) {
    if (!v.ai || v.ai.role !== 'traffic') continue;
    if (v.dead) continue;
    // Recycle cars that ended up far from the player.
    if (Math.hypot(v.x - p.x, v.z - p.z) > 430) {
      placeOnRoad(v, 150);
      continue;
    }
    const ai = v.ai;
    let targetX;
    let targetZ;
    if (ai.turnTarget) {
      targetX = ai.turnTarget.x;
      targetZ = ai.turnTarget.z;
      const d = steerToward(v, targetX, targetZ, dt, 1.6);
      if (d < 5.5) {
        Object.assign(ai, ai.pending);
        ai.turnTarget = null;
        ai.pending = null;
      }
    } else {
      const junction = nextJunction(v);
      if (junction && junction.ahead < 9 && rng() < 0.4) {
        // Turn onto the crossing road (or keep going if it leads out of town).
        const newAxis = ai.axis === 'z' ? 'x' : 'z';
        const newDir = rng() < 0.5 ? 1 : -1;
        const junctionCoord = junction.coord;
        const lane = laneCoord(junctionCoord, newDir, newAxis);
        // The junction centre's cross-axis coordinate is the car's own road coord.
        const exitAlong = ai.coord + newDir * 16;
        ai.turnTarget = newAxis === 'z' ? { x: lane, z: exitAlong } : { x: exitAlong, z: lane };
        ai.pending = { axis: newAxis, coord: junctionCoord, dir: newDir };
        targetX = ai.turnTarget.x;
        targetZ = ai.turnTarget.z;
        steerToward(v, targetX, targetZ, dt, 1.6);
      } else {
        const lane = laneCoord(ai.coord, ai.dir, ai.axis);
        const ahead = 34;
        targetX = ai.axis === 'z' ? lane : v.x + ai.dir * ahead;
        targetZ = ai.axis === 'z' ? v.z + ai.dir * ahead : lane;
        steerToward(v, targetX, targetZ, dt, 2.2);
      }
    }
    // Speed: cruise, slow for corners, stop for obstacles.
    let target = ai.cruise;
    if (Math.abs(v.steer) > 0.45) target = Math.min(target, 6);
    const cap = obstacleCap(v);
    if (cap !== Infinity) target = Math.min(target, cap);
    if (target === 0 && v.speed < 0.4) {
      ai.blockedFor += dt;
      if (ai.blockedFor > 2.4) {
        ai.blockedFor = 0;
        if (Math.hypot(v.x - p.x, v.z - p.z) < 42) playHorn();
      }
    } else {
      ai.blockedFor = 0;
    }
    approachSpeed(v, target, dt);
    // Running someone down is the driver's problem — and the player's crime if pushed.
    if (Math.abs(v.speed) > 2.5) {
      for (const ped of S.peds) {
        if (!ped.dead && Math.hypot(ped.x - v.x, ped.z - v.z) < 1.9) hitPedestrian(ped, v);
      }
    }
  }
}
