// config.js — every shared tuning constant for Solano Heat lives here: the city grid,
// movement and driving speeds, wanted-level thresholds and mission rewards. Other modules
// import from this file instead of hard-coding numbers, so the game can be balanced in
// one place.

/** World units are metres. The city is a square grid of blocks and roads. */
export const CITY = {
  /** Distance between neighbouring road centrelines (block face + road width). */
  pitch: 54,
  /** Number of roads along each axis. */
  roadsPerAxis: 12,
  /** Full road width including both sidewalks. */
  roadWidth: 22,
  /** Width of the drivable asphalt between the sidewalks. */
  asphaltWidth: 13,
  /** Lane offset from a road centreline for right-hand traffic. */
  laneOffset: 3.4,
  /** The sand strip starts at this x; open water beyond the shoreline. */
  beachStartX: 338,
  shorelineX: 402,
};

/** Road centrelines along one axis, from the westernmost to the easternmost avenue. */
export function roadCenters() {
  const centers = [];
  const half = ((CITY.roadsPerAxis - 1) * CITY.pitch) / 2;
  for (let i = 0; i < CITY.roadsPerAxis; i += 1) centers.push(-half + i * CITY.pitch);
  return centers;
}

export const PLAYER = {
  walkSpeed: 6.2,
  sprintSpeed: 10.5,
  radius: 0.55,
  maxHealth: 100,
  punchRange: 1.9,
  punchDamage: 34,
  enterCarRange: 4.2,
};

export const DRIVING = {
  accel: 16,
  brake: 30,
  reverseMax: 9,
  drag: 0.55,
  gripTurnRate: 1.55,
  handbrakeTurnRate: 2.6,
  radius: 2.15,
};

/** Vehicle archetypes: top speed, acceleration feel, size and whether it is a cruiser. */
export const CAR_TYPES = {
  sedan: { topSpeed: 33, accel: 15, length: 4.4, width: 1.9, height: 1.35, mass: 1 },
  hatch: { topSpeed: 29, accel: 16, length: 3.8, width: 1.8, height: 1.45, mass: 0.9 },
  truck: { topSpeed: 25, accel: 11, length: 5.6, width: 2.2, height: 2.1, mass: 1.6 },
  cruiser: { topSpeed: 37, accel: 19, length: 4.6, width: 1.95, height: 1.5, mass: 1.1 },
};

/** Heat points needed for each wanted star, index = stars. */
export const WANTED_THRESHOLDS = [0, 12, 32, 58, 92, 135];
/** How many police cruisers the city sends out at each wanted level. */
export const POLICE_PER_STAR = [0, 1, 2, 3, 5, 7];

export const CRIME = {
  stealCar: 14,
  hitPedestrian: 30,
  hitVehicle: 8,
  shotFired: 10,
  shotHitsPerson: 22,
  shotHitsPolice: 30,
  punchPerson: 12,
};

/** Named places the story and the respawn logic refer to. */
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

export const SAVE_KEY = 'solano-heat-save-v1';
