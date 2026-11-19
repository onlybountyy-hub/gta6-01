// combat.js — pistol combat: hitscan shots, tracers, health and death.
//
// The player carries one pistol with infinite reserve ammunition and a
// twelve-round magazine (R reloads, and it auto-reloads when empty).
// Firing casts a hitscan ray from the camera through the crosshair: the
// nearest pedestrian, enemy or car within range takes the hit. Enemies
// (mission guards) shoot back on a per-enemy cooldown with spread, which
// is what makes the warehouse fight dangerous. Muzzle flash is a brief
// point light plus a small sprite plane; tracers are fading line segments
// kept in a small pool so a firefight never allocates per shot.

import * as THREE from 'three';
import { distance2d } from './rng.js';
import { killPedestrian } from './traffic.js';
import { damageCar } from './vehicles.js';

export function createCombat(scene, audio) {
  const flashLight = new THREE.PointLight(0xffc266, 0, 18);
  scene.add(flashLight);
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
  const enemyTracerMat = new THREE.LineBasicMaterial({ color: 0xff9a7a, transparent: true, opacity: 0.8 });

  function spawnTracer(from, to, mat = tracerMat) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    tracers.push({ line, life: 0.07 });
  }

  // --- small particle pools -------------------------------------------------
  // Two fixed pools of tiny boxes give shots their physical punctuation:
  // brass casings that eject from the pistol, arc and bounce once, and
  // impact sparks that burst wherever a round lands. Both recycle the
  // oldest live particle, so a long firefight never allocates.
  function makePool(count, size, color) {
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshBasicMaterial({ color });
    const items = [];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      items.push({ mesh, vel: new THREE.Vector3(), spin: 0, life: 0, maxLife: 1, bounced: false });
    }
    return { items, cursor: 0 };
  }
  const casings = makePool(26, 0.09, 0xd8a03c);
  const sparks = makePool(40, 0.07, 0xffc266);

  function spawnParticle(pool, origin, vel, life, spin) {
    const p = pool.items[pool.cursor];
    pool.cursor = (pool.cursor + 1) % pool.items.length;
    p.mesh.position.copy(origin);
    p.mesh.visible = true;
    p.vel.copy(vel);
    p.life = life;
    p.maxLife = life;
    p.spin = spin;
    p.bounced = false;
    p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  }

  function stepPool(pool, dt, gravity, floorY) {
    for (const p of pool.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < floorY) {
        p.mesh.position.y = floorY;
        if (!p.bounced) {
          p.bounced = true;
          p.vel.y = Math.abs(p.vel.y) * 0.35;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
        } else {
          p.vel.set(0, 0, 0);
        }
      }
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.z += p.spin * 0.7 * dt;
    }
  }

  // The muzzle flash itself: a small spiky octahedron at the gun that
  // exists for two frames per shot, scaled randomly so no two flashes
  // look stamped from the same mould.
  const flashMesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.34),
    new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.95 })
  );
  flashMesh.visible = false;
  scene.add(flashMesh);
  let flashTimer = 0;

  function burstSparks(at) {
    for (let i = 0; i < 6; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 3.4,
        (Math.random() - 0.5) * 5
      );
      spawnParticle(sparks, at, vel, 0.28 + Math.random() * 0.15, 9);
    }
  }

  return {
    ammo: 12,
    magSize: 12,
    reloadTimer: 0,
    cooldown: 0,
    shotsFired: 0,

    update(dt) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.reloadTimer > 0) {
        this.reloadTimer -= dt;
        if (this.reloadTimer <= 0) this.ammo = this.magSize;
      }
      flashLight.intensity = Math.max(0, flashLight.intensity - dt * 60);
      if (flashTimer > 0) {
        flashTimer -= dt;
        if (flashTimer <= 0) flashMesh.visible = false;
      }
      stepPool(casings, dt, 7.5, 0.06);
      stepPool(sparks, dt, 9, 0.05);
      for (let i = tracers.length - 1; i >= 0; i--) {
        tracers[i].life -= dt;
        if (tracers[i].life <= 0) {
          scene.remove(tracers[i].line);
          tracers[i].line.geometry.dispose();
          tracers.splice(i, 1);
        }
      }
    },

    // Visual-only enemy fire: a warmer tracer from the guard's gun to a
    // point near the player, plus a small flash at their muzzle, so the
    // player can read where shots are coming from.
    enemyShot(from, to) {
      const muzzle = new THREE.Vector3(from.x, 1.35, from.z);
      const end = new THREE.Vector3(to.x + (Math.random() - 0.5) * 3, 1.1, to.z + (Math.random() - 0.5) * 3);
      spawnTracer(muzzle, end, enemyTracerMat);
      flashLight.position.copy(muzzle);
      flashLight.intensity = 1.6;
    },

    reload() {
      if (this.ammo < this.magSize && this.reloadTimer <= 0) this.reloadTimer = 0.9;
    },

    // Fire from origin toward a world target point. Targets is a list of
    // {pos, radius, kind, ref} entries; returns the entry hit, or null.
    fire(origin, targetPoint, targets, onCrime) {
      if (this.cooldown > 0 || this.reloadTimer > 0) return null;
      if (this.ammo <= 0) {
        audio.dryFire();
        this.reload();
        return null;
      }
      this.ammo -= 1;
      this.cooldown = 0.22;
      this.shotsFired += 1;
      audio.shot();
      if (onCrime) onCrime('shot', origin);
      flashLight.position.copy(origin).y += 1.4;
      flashLight.intensity = 3;

      const dir = new THREE.Vector3().subVectors(targetPoint, origin).normalize();
      let bestT = 90;
      let best = null;
      for (const t of targets) {
        const to = new THREE.Vector3(t.pos.x - origin.x, 1.1 - origin.y, t.pos.z - origin.z);
        const along = to.dot(dir);
        if (along < 0 || along > bestT) continue;
        const closest = new THREE.Vector3().copy(dir).multiplyScalar(along).add(origin);
        const miss = distance2d(closest.x, closest.z, t.pos.x, t.pos.z);
        if (miss < (t.radius ?? 0.7)) {
          bestT = along;
          best = t;
        }
      }
      const end = best
        ? new THREE.Vector3(best.pos.x, 1.1, best.pos.z)
        : new THREE.Vector3().copy(dir).multiplyScalar(90).add(origin);
      end.y = Math.max(0.4, end.y);
      const muzzle = new THREE.Vector3(origin.x, origin.y + 1.35, origin.z);
      spawnTracer(muzzle, end);
      // Flash mesh at the muzzle, stretched along the shot direction.
      flashMesh.position.copy(muzzle);
      flashMesh.scale.set(0.7 + Math.random() * 0.5, 0.7 + Math.random() * 0.5, 1.6 + Math.random());
      flashMesh.lookAt(end);
      flashMesh.visible = true;
      flashTimer = 0.045;
      // One brass casing pops out sideways and up, every shot.
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const casingVel = side.multiplyScalar(1.3 + Math.random() * 0.7);
      casingVel.y = 2.1 + Math.random() * 0.6;
      spawnParticle(casings, muzzle, casingVel, 0.85, 12);
      if (best) {
        audio.hit();
        burstSparks(end);
        if (best.kind === 'car') damageCar(best.ref, 14);
        else if (best.ref) {
          best.ref.health -= 34;
          if (best.ref.health <= 0 && !best.ref.dead) {
            killPedestrian(best.ref);
            if (onCrime) onCrime(best.ref.isEnemy ? 'shot' : 'murder', best.ref.pos);
          } else if (onCrime && !best.ref.isEnemy) {
            onCrime('assault', best.ref.pos);
          }
        }
      }
      if (this.ammo === 0) this.reload();
      return best;
    },
  };
}

// Enemy shooting: guards fire at the player when they have line-of-sight
// range and their personal cooldown has elapsed. Accuracy is modest at
// range so cover (the warehouse crates) genuinely helps.
export function stepEnemyGunman(enemy, dt, player, audio, hurtPlayerFn, fx = null) {
  if (enemy.dead) return;
  enemy.shootTimer = (enemy.shootTimer ?? 1.5) - dt;
  const d = distance2d(enemy.pos.x, enemy.pos.z, player.pos.x, player.pos.z);
  // Guards advance until they are in comfortable range, and strafe a
  // little while in it so they are not standing targets in the open.
  if (d > 16) {
    const h = Math.atan2(player.pos.x - enemy.pos.x, player.pos.z - enemy.pos.z);
    enemy.pos.x += Math.sin(h) * 3.4 * dt;
    enemy.pos.z += Math.cos(h) * 3.4 * dt;
    enemy.heading = h;
  } else {
    enemy.heading = Math.atan2(player.pos.x - enemy.pos.x, player.pos.z - enemy.pos.z);
    enemy.strafePhase = (enemy.strafePhase ?? Math.random() * 6) + dt;
    const strafe = Math.sin(enemy.strafePhase * 0.9) * 1.1;
    enemy.pos.x += Math.cos(enemy.heading) * strafe * dt;
    enemy.pos.z -= Math.sin(enemy.heading) * strafe * dt;
  }
  enemy.mesh.position.copy(enemy.pos);
  enemy.mesh.rotation.y = enemy.heading;
  if (d < 42 && enemy.shootTimer <= 0) {
    enemy.shootTimer = 1.1 + Math.random() * 0.9;
    audio.shot();
    if (fx) fx(enemy.pos, player.pos);
    const hitChance = Math.max(0.12, 0.55 - d * 0.008);
    if (Math.random() < hitChance) {
      audio.hurt();
      hurtPlayerFn(player.car ? 4 : 8);
    }
  }
}
