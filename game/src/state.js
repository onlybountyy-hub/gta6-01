// state.js — the shared blackboard every system reads and writes.
//
// Instead of modules importing each other in circles, they all import this one
// singleton. main.js creates the Three.js renderer, scene and camera and parks
// them here; world.js registers the colliders it builds; the player, vehicles,
// pedestrians, wanted level, cash and story progress all live here too. If a
// system needs to know something, it looks on the board.

export const S = {
  // Three.js handles, assigned by main.js during boot.
  renderer: null,
  scene: null,
  camera: null,
  sun: null,
  waterMaterial: null,
  boat: null,

  /** 'menu' | 'playing' | 'paused' | 'dialogue' | 'busted' | 'wasted' | 'scene' */
  mode: 'menu',
  /** True while a ?scene= screenshot scene is staged. */
  sceneMode: false,
  sceneName: '',
  /** Seconds since boot; every timer in the game reads this clock. */
  time: 0,
  /** The one seed the whole city is generated from. */
  seed: 20261119,
  /** Set by police.js when the bust meter fills; main.js stages the arrest. */
  busted: false,

  // World data, filled in by buildWorld().
  colliders: [], // {minX, maxX, minZ, maxZ} per building, {pier: true, ...} for the pier
  roadCenters: [],
  parkingSpots: [],

  // The player character. player.js owns the behaviour; the numbers live here.
  player: {
    mesh: null,
    x: 0,
    z: 0,
    heading: 0, // radians; forward is (sin(heading), cos(heading))
    speed: 0,
    health: 100,
    lastDamageAt: -99,
    inVehicle: null,
    gunDrawn: false,
    walkPhase: 0,
    punchCooldown: 0,
    dead: false,
  },

  // Camera orbit state, steered by the mouse through input.js.
  cam: { yaw: 0.6, pitch: 0.32, distance: 7.5, x: 0, y: 3, z: 0 },

  // Live entities. Vehicle records are shared by traffic, police and the player.
  vehicles: [], // {mesh, type, spec, x, z, heading, speed, ai, health, ...}
  peds: [], // {mesh, x, z, heading, state, health, ...}

  // Wanted state, owned by police.js.
  wanted: {
    heat: 0,
    stars: 0,
    lastSeenAt: -99, // S.time of the last moment a cruiser had eyes on the player
    bustProgress: 0, // 0..1, fills while boxed in at low speed
  },

  cash: 250,
  storyComplete: false,

  // The current objective marker {x, z, label} and its HUD line (missions.js).
  objective: null,
  objectiveText: '',

  // Toast queue for hud.js; gameplay pushes, the HUD renders and ages them out.
  notifications: [],

  /** Commit a crime: heat rises now, police.js derives the stars from it. */
  addCrime(points) {
    S.wanted.heat = Math.min(220, S.wanted.heat + points);
  },

  /** Queue a HUD toast ('info' | 'good' | 'bad'). */
  notify(text, kind = 'info') {
    S.notifications.push({ text, kind, at: S.time });
    if (S.notifications.length > 5) S.notifications.shift();
  },

  /** The player's effective position: the driven car's, when driving. */
  playerPos() {
    const v = S.player.inVehicle;
    return v ? { x: v.x, z: v.z } : { x: S.player.x, z: S.player.z };
  },

  /** The player's effective speed, on foot or behind the wheel. */
  playerSpeed() {
    const v = S.player.inVehicle;
    return v ? Math.abs(v.speed) : S.player.speed;
  },
};
