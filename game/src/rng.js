// rng.js — deterministic randomness and small math helpers for SOLANO HEAT.
//
// The whole city is generated from one fixed seed so that every player (and
// every screenshot scene) sees the same Solano. A mulberry32 generator is
// used because it is tiny, fast, and good enough for placement decisions:
// building heights, paint colours, which corner gets a palm tree, and so on.
// Nothing here touches Math.random, which keeps replays reproducible.

export function makeRng(seed) {
  let state = seed >>> 0;
  return function nextRandom() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng, low, high) {
  return low + rng() * (high - low);
}

export function randInt(rng, low, high) {
  return Math.floor(randRange(rng, low, high + 1));
}

export function pickOne(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

export function clamp(value, low, high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function distance2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Shortest signed turn from one heading to another, in radians. Headings in
// SOLANO HEAT are plain yaw angles, so this wraps the difference into the
// (-PI, PI] range that steering code expects.
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function headingTowards(ax, az, bx, bz) {
  return Math.atan2(bx - ax, bz - az);
}

// A tiny string hash so named seeds (scene names, car plates) can feed the
// numeric generator above without a lookup table.
export function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
