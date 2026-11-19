// random.js — seeded pseudo-random numbers for Solano Heat.
//
// Port Solano is generated, not modelled: every building, palm and parked car is
// placed by rolling dice. The dice are a mulberry32 generator fed from one fixed
// seed, so the city that loads today is the city that loads tomorrow — and the
// city in the screenshots is the city a player gets.

/**
 * Build a generator from a numeric seed. Each call returns a float in [0, 1).
 * The generator is a closure over one 32-bit state word; mulberry32's mix of
 * multiply-xor-shift rounds is plenty random for street furniture.
 */
export function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [min, max) drawn from `rng`. */
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** An integer in [min, max], both ends included. */
export function randInt(rng, min, max) {
  return Math.floor(min + rng() * (max - min + 1));
}

/** One element of `items`, chosen by `rng`. */
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}
