// effects.js — transient visual effects: a pooled particle system for sparks, smoke
// and splashes, a pooled tracer for gunfire, and a shared muzzle-flash light. Pools
// are fixed-size so effects never allocate during the frame loop.

import * as THREE from 'three';
import { S } from './state.js';
import { makeGlowTexture } from './textures.js';

const MAX_PARTICLES = 900;
let points = null;
let positions = null;
let colors = null;
let particles = [];
let flashLight = null;
let flashSprite = null;
let flashTimer = 0;
const tracers = [];

/** Build the particle pool and flash objects. Called once by main.js. */
export function initEffects() {
  positions = new Float32Array(MAX_PARTICLES * 3);
  colors = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    particles.push({ alive: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, gravity: 0, drag: 1 });
    positions[i * 3 + 1] = -50;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.55,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    map: makeGlowTexture(),
    blending: THREE.AdditiveBlending,
  });
  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  S.scene.add(points);

  flashLight = new THREE.PointLight(0xffc37e, 0, 26, 1.6);
  S.scene.add(flashLight);
  const spriteMat = new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0xffd9a0,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  flashSprite = new THREE.Sprite(spriteMat);
  flashSprite.scale.set(1.6, 1.6, 1);
  S.scene.add(flashSprite);

  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
  for (let i = 0; i < 10; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1), tracerMat.clone());
    mesh.visible = false;
    S.scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
}

const _color = new THREE.Color();

/** Spawn `count` particles at a point with a colour, spread and behaviour profile. */
export function spawnParticles(x, y, z, { count = 10, color = 0xffcc66, speed = 5, life = 0.5, gravity = -4, up = 2, size = null } = {}) {
  _color.set(color);
  let spawned = 0;
  for (let i = 0; i < MAX_PARTICLES && spawned < count; i += 1) {
    const p = particles[i];
    if (p.alive) continue;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.z = z;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * speed;
    p.vx = Math.cos(a) * r;
    p.vz = Math.sin(a) * r;
    p.vy = Math.random() * up;
    p.life = life * (0.5 + Math.random() * 0.7);
    p.maxLife = p.life;
    p.gravity = gravity;
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
    spawned += 1;
  }
  if (size !== null && points) points.material.size = size;
}

/** Sparks where a bullet lands. */
export function spawnSparks(x, y, z) {
  spawnParticles(x, y, z, { count: 9, color: 0xffd76a, speed: 4.5, life: 0.35, gravity: -9, up: 3 });
}

/** Dark smoke puff, used for damaged engines. */
export function spawnSmoke(x, y, z, big = false) {
  spawnParticles(x, y, z, {
    count: big ? 3 : 1,
    color: 0x2c2c30,
    speed: 0.7,
    life: 1.4,
    gravity: 1.6,
    up: 2.6,
  });
}

/** A short-lived bright line from the muzzle to the impact point. */
export function spawnTracer(from, to) {
  const slot = tracers.find((t) => t.life <= 0) || tracers[0];
  const mesh = slot.mesh;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.max(0.1, Math.sqrt(dx * dx + dy * dy + dz * dz));
  mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  mesh.scale.set(1, 1, len);
  mesh.lookAt(to.x, to.y, to.z);
  mesh.visible = true;
  mesh.material.opacity = 0.85;
  slot.life = 0.07;
}

/** Flash the shared light + sprite at the gun muzzle. */
export function muzzleFlash(x, y, z) {
  if (!flashLight) return;
  flashLight.position.set(x, y, z);
  flashLight.intensity = 60;
  flashSprite.position.set(x, y, z);
  flashSprite.material.opacity = 0.95;
  flashTimer = 0.05;
}

/** Advance all effects by dt seconds. */
export function updateEffects(dt) {
  if (!points) return;
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    const p = particles[i];
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
  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.color.needsUpdate = true;

  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0) {
      flashLight.intensity = 0;
      flashSprite.material.opacity = 0;
    }
  }
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }
}
