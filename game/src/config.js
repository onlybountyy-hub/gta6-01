// config.js — the numbers that define Port Solano, gathered in one place.
//
// Grid geometry, movement speeds, the wanted-level ladder, crime values and the
// named story locations all live here. Gameplay modules import these constants
// instead of scattering literals, so balancing the game means editing this file
// and nothing else.

/** Distances are metres. The city is a square lattice of blocks and roads. */
export const CITY = {
  /** Centreline-to-centreline distance between neighbouring roads. */
  pitch: 54,
  /** Roads along each axis (so blocks number roadsPerAxis - 1 per row). */
  roadsPerAxis: 12,
  /** Full road width, sidewalks included. */
  roadWidth: 22,
  /** Width of the asphalt strip cars actually drive on. */
  asphaltWidth: 13,
  /** Lane offset from a centreline under right-hand traffic. */
  laneOffset: 3.4,
  /** The sand starts at this x coordinate; the city grid ends before it. */
  beachStartX: 338,
  /** Open water starts here. */
  shorelineX: 402,
};

/** The twelve road centreline coordinates along one axis, west to east. */
export function roadCenters() {
  const half = ((CITY.roadsPerAxis - 1) * CITY.pitch) / 2;
  const centers = [];
  for (let i = 0; i < CITY.roadsPerAxis; i += 1) centers.push(i * CITY.pitch - half);
  return centers;
}

export const PLAYER = {
  walkSpeed: 6.2,
  sprintSpeed: 10.5,
  radius: 0.55,
  maxHealth: 100,
  punchRange: 1.9,
  enterCarRange: 4.2,
};

export const DRIVING = {
  brake: 30,
  reverseMax: 9,
  drag: 0.55,
  gripTurnRate: 1.55,
  handbrakeTurnRate: 2.6,
  radius: 2.15,
};

/** Car archetypes. `cruiser` is the PSPD interceptor: fastest thing in town. */
export const CAR_TYPES = {
  sedan: { topSpeed: 33, accel: 15, length: 4.4, width: 1.9, height: 1.35 },
  hatch: { topSpeed: 29, accel: 16, length: 3.8, width: 1.8, height: 1.45 },
  truck: { topSpeed: 25, accel: 11, length: 5.6, width: 2.2, height: 2.1 },
  cruiser: { topSpeed: 37, accel: 19, length: 4.6, width: 1.95, height: 1.5 },
};

/** Cumulative heat needed to hold each wanted star (index = star count). */
export const WANTED_THRESHOLDS = [0, 12, 32, 58, 92, 135];
/** Cruisers the PSPD fields at each wanted level (index = star count). */
export const POLICE_PER_STAR = [0, 1, 2, 3, 5, 7];

/** Heat added by each offence, before police.js turns heat into stars. */
export const CRIME = {
  stealCar: 14,
  hitPedestrian: 30,
  hitVehicle: 8,
  shotFired: 10,
  shotHitsPerson: 22,
  shotHitsPolice: 30,
  punchPerson: 12,
};

/** Story locations. Missions, respawns and the minimap all point at these. */
export const PLACES = {
  cafe: { x: -236, z: -236, label: "Lola's Café" },
  warehouse: { x: 252, z: -243, label: 'Solano Freight Warehouse' },
  garage: { x: -252, z: 243, label: "Rico's Chop Garage" },
  hospital: { x: 14, z: -290, label: 'Port Solano General' },
  policeStation: { x: 60, z: 60, label: 'PSPD Central' },
  pierEnd: { x: 388, z: 220, label: 'Harbor Pier' },
  boat: { x: 404, z: 220, label: "Lola's Boat" },
  spawn: { x: -228, z: -228, label: 'Palm Court' },
};

export const SAVE_KEY = 'solano-heat-save-v2';
