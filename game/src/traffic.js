// traffic.js — civilian traffic, the city's background pulse.
//
// Each traffic car owns a lane on the road grid: it cruises its road in the
// right-hand lane, sometimes turns at a junction onto the crossing road, brakes
// for whatever is ahead of it, and honks when it has been stuck too long. Cars
// that drift far from the player are recycled onto a road near the action, so
// wherever Marco goes, Port Solano feels lived in.

import { CITY } from './config.js';
import { S } from './state.js';
import { makeRng, pick, randRange } from './random.js';
import { spawnVehicle, steerToward, approachSpeed, forwardOf, CAR_COLORS } from './vehicles.js';
import { hitPedestrian } from './pedestrians.js';
import { playHorn } from './audio.js';

const TRAFFIC_COUNT = 14;
const rng = makeRng(4242);

/**
 * The lane-centre coordinate for a car on a road. Right-hand traffic: heading
 * +Z you keep to x = c − lane; heading +X you keep to z = c + lane.
 */
function laneCoord(coord, dir, axis) {
  return axis === 'z' ? coord - dir * CITY.laneOffset : coord + dir * CITY.laneOffset;
}

/** Drop a car onto a random road, at least `minDist` from the player. */
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
    v.ai = {
      role: 'traffic', axis, coord, dir,
      turnTarget: null, pending: null, blockedFor: 0,
      cruise: randRange(rng, 10.5, 14.5),
    };
    return;
  }
}

/** Spawn the traffic fleet. Called once at boot. */
export function initTraffic() {
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const v = spawnVehicle(pick(rng, ['sedan', 'sedan', 'hatch', 'hatch', 'truck']), pick(rng, CAR_COLORS), 0, -999, 0, {});
    placeOnRoad(v, 40);
  }
}

/** The nearest junction ahead of the car on its current road, or null. */
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

/** A speed cap from whatever is solid ahead in this car's lane (Infinity = clear). */
function obstacleCap(v) {
  const fwd = forwardOf(v.heading);
  let cap = Infinity;
  const consider = (ox, oz, radius) => {
    const dx = ox - v.x;
    const dz = oz - v.z;
    const ahead = dx * fwd.x + dz * fwd.z;
    const lateral = Math.abs(dx * fwd.z - dz * fwd.x);
    if (ahead > 0 && ahead < 13 && lateral < 2.1 + radius) {
      cap = Math.min(cap, ahead < 6 ? 0 : 4);
    }
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

/** Advance every traffic car one frame: route, steer, speed, consequences. */
export function updateTraffic(dt) {
  const p = S.playerPos();
  for (const v of S.vehicles) {
    if (!v.ai || v.ai.role !== 'traffic' || v.dead) continue;
    if (Math.hypot(v.x - p.x, v.z - p.z) > 430) {
      placeOnRoad(v, 150);
      continue;
    }
    const ai = v.ai;
    if (ai.turnTarget) {
      const d = steerToward(v, ai.turnTarget.x, ai.turnTarget.z, dt, 1.6);
      if (d < 5.5) {
        Object.assign(ai, ai.pending);
        ai.turnTarget = null;
        ai.pending = null;
      }
    } else {
      const junction = nextJunction(v);
      if (junction && junction.ahead < 9 && rng() < 0.4) {
        // Turn onto the crossing road: aim past the junction in the new lane.
        const newAxis = ai.axis === 'z' ? 'x' : 'z';
        const newDir = rng() < 0.5 ? 1 : -1;
        const lane = laneCoord(junction.coord, newDir, newAxis);
        const exitAlong = ai.coord + newDir * 16;
        ai.turnTarget = newAxis === 'z' ? { x: lane, z: exitAlong } : { x: exitAlong, z: lane };
        ai.pending = { axis: newAxis, coord: junction.coord, dir: newDir };
        steerToward(v, ai.turnTarget.x, ai.turnTarget.z, dt, 1.6);
      } else {
        const lane = laneCoord(ai.coord, ai.dir, ai.axis);
        const tx = ai.axis === 'z' ? lane : v.x + ai.dir * 34;
        const tz = ai.axis === 'z' ? v.z + ai.dir * 34 : lane;
        steerToward(v, tx, tz, dt, 2.2);
      }
    }
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
    if (Math.abs(v.speed) > 2.5) {
      for (const ped of S.peds) {
        if (!ped.dead && Math.hypot(ped.x - v.x, ped.z - v.z) < 1.9) hitPedestrian(ped, v);
      }
    }
  }
}
