// state.js — the single shared game-state object. Every system (world, traffic, police,
// missions, HUD) reads and writes through this singleton instead of importing each
// other, which keeps the module graph free of cycles. main.js creates the Three.js
// objects and parks them here; the rest of the game treats this as its blackboard.

export const S = {
  // Three.js handles, filled in by main.js.
  renderer: null,
  scene: null,
  camera: null,
  sun: null,
  waterMaterial: null,
  boat: null,

  /** 'menu' | 'playing' | 'paused' | 'dialogue' | 'busted' | 'wasted' | 'scene' */
  mode: 'menu',
  /** True while a ?scene= screenshot scene is staged (no menus, cinematic camera). */
  sceneMode: false,
  sceneName: '',
  time: 0,
  seed: 20261119,

  // World data, filled in by world.js.
  colliders: [], // building AABBs: {minX, maxX, minZ, maxZ}
  roadCenters: [],

  // The player character (player.js owns the numbers, the mesh lives in the scene).
  player: {
    mesh: null,
    x: 0,
    z: 0,
    heading: 0, // facing angle, forward = (sin, cos)
    speed: 0,
    health: 100,
    lastDamageAt: -99,
    inVehicle: null,
    gunDrawn: false,
    walkPhase: 0,
    punchCooldown: 0,
    dead: false,
  },

  // Camera orbit, driven by the mouse through input.js.
  cam: { yaw: 0.6, pitch: 0.32, distance: 7.5, x: 0, y: 3, z: 0 },

  // Entities. Vehicle objects are shared by traffic, police and the player.
  vehicles: [], // {mesh, type, x, z, heading, speed, ai, health, ...}
  peds: [], // {mesh, x, z, heading, state, health, ...}

  // Wanted / police state (police.js).
  wanted: {
    heat: 0,
    stars: 0,
    lastSeenAt: -99, // S.time when a police unit last had eyes on the player
    bustProgress: 0, // 0..1
    unseenTimer: 0,
  },

  // Economy and story progress.
  cash: 250,
  storyComplete: false,

  // Current objective marker: {x, z, label} or null (missions.js, hud.js).
  objective: null,
  objectiveText: '',

  // One-shot UI events for hud.js: notifications pushed by gameplay systems.
  notifications: [],

  /** Add heat for a crime and let police.js recompute the star level. */
  addCrime(points) {
    S.wanted.heat = Math.min(220, S.wanted.heat + points);
  },

  /** Queue a toast line for the HUD. */
  notify(text, kind = 'info') {
    S.notifications.push({ text, kind, at: S.time });
    if (S.notifications.length > 5) S.notifications.shift();
  },

  /** Where the player effectively is: in the driven car, or on foot. */
  playerPos() {
    const v = S.player.inVehicle;
    if (v) return { x: v.x, z: v.z };
    return { x: S.player.x, z: S.player.z };
  },

  /** How fast the player is moving, on foot or in the driven car. */
  playerSpeed() {
    const v = S.player.inVehicle;
    if (v) return Math.abs(v.speed);
    return S.player.speed;
  },
};
