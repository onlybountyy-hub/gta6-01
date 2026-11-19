// police.js — the wanted system and police pursuit AI for SOLANO HEAT.
//
// Wanted level is a float underneath the displayed stars: crimes add heat,
// heat decays slowly when no officer can see the player, and the star
// count is the ceiling of the heat clamped to 0..5. Each star wants one
// police car on the street (two at the top end); cars spawn at a distance
// on the road grid and drive at the player's position, ramming to slow
// them. When an officer is close and the player is slow or on foot, the
// bust meter fills; filling it ends the run with a fine. Reaching the
// spray shop with enough cash clears all heat instantly.

import { clamp, distance2d, headingTowards, angleDelta } from './rng.js';
import { createCar, stepCar } from './vehicles.js';

const CRIME_HEAT = {
  theft: 1.0,
  assault: 1.0,
  shot: 0.6,
  murder: 1.6,
  crash: 0.25,
  policeHit: 1.2,
};

export function createPoliceSystem(scene) {
  return {
    scene,
    heat: 0,
    stars: 0,
    cars: [],
    bust: 0,
    busted: false,
    decayTimer: 0,
    spawnTimer: 0,
    crimeLog: [],

    reportCrime(kind, pos) {
      const add = CRIME_HEAT[kind] ?? 0.4;
      this.heat = clamp(this.heat + add, 0, 5.6);
      this.crimeLog.push({ kind, at: Date.now() });
      if (this.crimeLog.length > 40) this.crimeLog.shift();
    },

    setWanted(stars) {
      this.heat = clamp(stars, 0, 5.6);
    },

    clearWanted() {
      this.heat = 0;
      this.bust = 0;
      for (const car of this.cars) {
        this.scene.remove(car.mesh);
      }
      this.cars = [];
    },

    wantedCars() {
      if (this.stars <= 0) return 0;
      return Math.min(6, this.stars + (this.stars >= 4 ? 1 : 0));
    },

    update(dt, player, world, onBusted) {
      this.stars = this.heat <= 0.05 ? 0 : Math.min(5, Math.ceil(this.heat));
      // Heat decay: only while no police car is near enough to see us.
      const seen = this.cars.some((c) => distance2d(c.pos.x, c.pos.z, player.pos.x, player.pos.z) < 55);
      if (!seen && this.stars > 0) {
        this.decayTimer += dt;
        if (this.decayTimer > 6) {
          this.heat = Math.max(0, this.heat - dt * 0.06);
        }
      } else {
        this.decayTimer = 0;
      }

      // Spawn to quota, a little away and on a road.
      this.spawnTimer -= dt;
      if (this.cars.length < this.wantedCars() && this.spawnTimer <= 0) {
        this.spawnTimer = 1.4;
        const angle = Math.random() * Math.PI * 2;
        const dist = 85;
        let sx = player.pos.x + Math.sin(angle) * dist;
        let sz = player.pos.z + Math.cos(angle) * dist;
        sx = clamp(sx, -300, 300);
        sz = clamp(sz, -300, 300);
        // Snap to the nearest road centreline so the car starts on tarmac.
        sx = Math.round((sx + 286) / 52) * 52 - 286;
        // At four stars and up, some spawns are interceptors: dark,
        // spoilered and meaningfully faster than the standard cruiser.
        // They are the reason the top end of the wanted scale feels
        // different rather than just more crowded.
        const interceptor = this.stars >= 4 && Math.random() < 0.45;
        const car = interceptor
          ? createCar(this.scene, sx, sz, headingTowards(sx, sz, player.pos.x, player.pos.z), 0x23283b, { police: true, sport: true, topSpeed: 41, accel: 22 })
          : createCar(this.scene, sx, sz, headingTowards(sx, sz, player.pos.x, player.pos.z), 0xf4f6f6, { police: true, topSpeed: 37, accel: 19 });
        car.isInterceptor = interceptor;
        this.cars.push(car);
      }
      // Despawn the surplus when heat falls.
      while (this.cars.length > this.wantedCars() + 1) {
        const far = this.cars.pop();
        this.scene.remove(far.mesh);
      }

      // Pursuit steering: aim at a point a touch ahead of the player.
      let nearest = Infinity;
      const playerSpeed = player.car ? Math.abs(player.car.speed) : 0;
      for (const car of this.cars) {
        if (car.dead) continue;
        const d = distance2d(car.pos.x, car.pos.z, player.pos.x, player.pos.z);
        nearest = Math.min(nearest, d);
        const lead = clamp(d / 30, 0, 1) * 4;
        const tx = player.pos.x + Math.sin(player.heading) * lead;
        const tz = player.pos.z + Math.cos(player.heading) * lead;
        const wantHeading = headingTowards(car.pos.x, car.pos.z, tx, tz);
        const delta = angleDelta(car.heading, wantHeading);
        const steer = clamp(delta * 1.6, -1, 1);
        const throttle = d > 7 ? 1 : 0.25;
        stepCar(car, { throttle, steer, brake: d < 5 && playerSpeed < 2 }, dt, world);
        // Light bar strobe.
        const bar = car.mesh.getObjectByName('lightbar');
        if (bar) bar.material.color.setHex(Math.floor(performance.now() / 220) % 2 ? 0xff2222 : 0x2266ff);
      }

      // Bust logic: close + slow player = the meter fills.
      const playerSlow = !player.car || Math.abs(player.car.speed) < 3.2;
      if (this.stars > 0 && nearest < 13 && playerSlow) {
        this.bust = clamp(this.bust + dt / 3.2, 0, 1);
      } else {
        this.bust = clamp(this.bust - dt / 2.4, 0, 1);
      }
      if (this.bust >= 1 && !this.busted) {
        this.busted = true;
        if (onBusted) onBusted();
      }
      return { stars: this.stars, nearest, seen };
    },
  };
}
