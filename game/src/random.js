// random.js — a tiny seeded pseudo-random generator (mulberry32). The whole city is
// generated from one seed so every load, and every screenshot scene, builds the exact
// same Port Solano.

/** Create a generator function returning floats in [0, 1) from a numeric seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random float in [min, max) from a generator made by makeRng. */
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** Random integer in [min, max] inclusive. */
export function randInt(rng, min, max) {
  return Math.floor(randRange(rng, min, max + 1));
}

/** Pick one element of an array with the generator. */
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}
