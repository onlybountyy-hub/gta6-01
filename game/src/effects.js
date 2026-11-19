// effects.js — short-lived visual noise: sparks, smoke, blood-free impact puffs,
// bullet tracers and the muzzle flash. Everything is pooled at a fixed size, so
// a firefight never allocates inside the frame loop: particles live in one big
// Points cloud whose buffers are rewritten in place, tracers in a ring of ten
// stretched boxes, and the flash is a single shared light plus sprite.

import * as THREE from 'three';
import { S } from './state.js';
import { makeGlowTexture } from './textures.js';

const MAX_PARTICLES = 900;

let cloud = null;
let positions = null;
let colors = null;
const pool = [];
let flashLight = null;
let flashSprite = null;
let flashLeft = 0;
const tracerPool = [];

/** Allocate the particle cloud, the flash and the tracer ring. Boot-time only. */
export function initEffects() {
  positions = new Float32Array(MAX_PARTICLES * 3);
  colors = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    pool.push({ alive: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, gravity: 0 });
    positions[i * 3 + 1] = -50; // parked far under the city until spawned
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  cloud = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.55,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      map: makeGlowTexture(),
      blending: THREE.AdditiveBlending,
    }),
  );
  cloud.frustumCulled = false;
  S.scene.add(cloud);

  flashLight = new THREE.PointLight(0xffc37e, 0, 26, 1.6);
  S.scene.add(flashLight);
  flashSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xffd9a0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  flashSprite.scale.set(1.6, 1.6, 1);
  S.scene.add(flashSprite);

  for (let i = 0; i < 10; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.03, 1),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }),
    );
    mesh.visible = false;
    S.scene.add(mesh);
    tracerPool.push({ mesh, life: 0 });
  }
}

const scratchColor = new THREE.Color();

/** Wake `count` pooled particles at a point with a shared look and behaviour. */
export function spawnParticles(x, y, z, { count = 10, color = 0xffcc66, speed = 5, life = 0.5, gravity = -4, up = 2 } = {}) {
  scratchColor.set(color);
  let spawned = 0;
  for (let i = 0; i < MAX_PARTICLES && spawned < count; i += 1) {
    const p = pool[i];
    if (p.alive) continue;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.z = z;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * speed;
    p.vx = Math.cos(angle) * r;
    p.vz = Math.sin(angle) * r;
    p.vy = Math.random() * up;
    p.life = life * (0.5 + Math.random() * 0.7);
    p.gravity = gravity;
    colors[i * 3] = scratchColor.r;
    colors[i * 3 + 1] = scratchColor.g;
    colors[i * 3 + 2] = scratchColor.b;
    spawned += 1;
  }
}

/** Bright sparks where a bullet strikes something solid. */
export function spawnSparks(x, y, z) {
  spawnParticles(x, y, z, { count: 9, color: 0xffd76a, speed: 4.5, life: 0.35, gravity: -9, up: 3 });
}

/** A dark puff from a wounded engine; bigger and faster when the car is dying. */
export function spawnSmoke(x, y, z, big = false) {
  spawnParticles(x, y, z, { count: big ? 3 : 1, color: 0x2c2c30, speed: 0.7, life: 1.4, gravity: 1.6, up: 2.6 });
}

/** Stretch a pooled tracer box between muzzle and impact for a few frames. */
export function spawnTracer(from, to) {
  const slot = tracerPool.find((t) => t.life <= 0) || tracerPool[0];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.max(0.1, Math.hypot(dx, dy, dz));
  slot.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  slot.mesh.scale.set(1, 1, len);
  slot.mesh.lookAt(to.x, to.y, to.z);
  slot.mesh.visible = true;
  slot.mesh.material.opacity = 0.85;
  slot.life = 0.07;
}

/** Fire the shared flash light and sprite at the muzzle for one frame's worth. */
export function muzzleFlash(x, y, z) {
  if (!flashLight) return;
  flashLight.position.set(x, y, z);
  flashLight.intensity = 60;
  flashSprite.position.set(x, y, z);
  flashSprite.material.opacity = 0.95;
  flashLeft = 0.05;
}

/** Integrate particles, fade the flash and age the tracers. */
export function updateEffects(dt) {
  if (!cloud) return;
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    const p = pool[i];
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.alive = false;
      positions[i * 3 + 1] = -50;
      continue;
    }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    if (p.y < 0.05) p.y = 0.05;
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  }
  cloud.geometry.attributes.position.needsUpdate = true;
  cloud.geometry.attributes.color.needsUpdate = true;

  if (flashLeft > 0) {
    flashLeft -= dt;
    if (flashLeft <= 0) {
      flashLight.intensity = 0;
      flashSprite.material.opacity = 0;
    }
  }
  for (const t of tracerPool) {
    if (t.life <= 0) continue;
    t.life -= dt;
    t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
    if (t.life <= 0) t.mesh.visible = false;
  }
}
