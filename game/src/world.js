// world.js — the city of Solano: layout, meshes, landmarks and collisions.
//
// Layout maths (all units are metres):
//   * The street grid is 12 blocks by 12 blocks.
//   * Each block is 40 m of buildable land; each road is 12 m wide, so the
//     pitch between neighbouring road centrelines is 52 m.
//   * Road centrelines therefore sit at -286, -234, ... , +286 on both axes,
//     and the built city spans roughly -312..+312 on x and z.
//   * South of the grid (z beyond +330) the land falls away into a beach
//     strip and then open water. East of the grid (x beyond +330) a harbour
//     basin holds the docks, cranes and the warehouse used by the story.
//   * Named locations (hospital, spray shop, hideout, drop-off, Lola's
//     corner) are pinned to fixed intersections so missions, the minimap and
//     the debug hook all agree on where things are.
//
// Collision is deliberately simple: every solid building contributes an
// axis-aligned box, and movers ask resolveCollisions() to push them out.
// Roads and sidewalks never collide, so driving the grid always works.

import * as THREE from 'three';
import { makeRng, randRange, randInt, pickOne } from './rng.js';

export const BLOCK = 40;
export const ROAD = 12;
export const PITCH = BLOCK + ROAD;
export const GRID = 12;
export const CITY_EDGE = 312;
export const WORLD_SEED = 20261119;

export function roadCoord(i) {
  return -286 + i * PITCH;
}

export function nearestRoadCoord(v) {
  const i = Math.round((v + 286) / PITCH);
  const clamped = Math.max(0, Math.min(GRID, i));
  return roadCoord(clamped);
}

export function isOnRoad(x, z) {
  const rx = Math.abs(((x + 286) % PITCH) + PITCH) % PITCH;
  const rz = Math.abs(((z + 286) % PITCH) + PITCH) % PITCH;
  const nearX = rx <= ROAD / 2 + 1 || rx >= PITCH - ROAD / 2 - 1 || Math.abs(x) > CITY_EDGE;
  const nearZ = rz <= ROAD / 2 + 1 || rz >= PITCH - ROAD / 2 - 1 || Math.abs(z) > CITY_EDGE;
  return nearX || nearZ;
}

// Fixed story locations. Coordinates sit on roads or plazas, never inside a
// building footprint, so a marker can always be reached by car.
export const LOCATIONS = {
  lolaCorner: { x: roadCoord(3), z: roadCoord(6), label: "Lola's Corner" },
  dropOff: { x: roadCoord(9), z: roadCoord(3), label: 'Drop-Off Garage' },
  harborPickup: { x: 372, z: 120, label: 'Harbor — Berth 7' },
  harborReturn: { x: roadCoord(10), z: roadCoord(8), label: "Lola's Lockup" },
  warehouse: { x: 380, z: -140, label: 'Harbor Warehouse' },
  hideout: { x: roadCoord(1), z: roadCoord(1), label: 'Beach Hideout' },
  hospital: { x: roadCoord(6), z: roadCoord(11), label: 'Solano General Hospital' },
  sprayShop: { x: roadCoord(7), z: roadCoord(5), label: 'Palm Avenue Spray Shop' },
  sprayShop2: { x: roadCoord(10), z: roadCoord(1), label: 'Northgate Spray Shop' },
  marina: { x: 452, z: 0, label: 'Solano Marina' },
  playerStart: { x: roadCoord(3) + 4, z: roadCoord(6) + 16, label: 'Start' },
  missionCar: { x: roadCoord(5), z: roadCoord(8) + 3, label: 'Target Car' },
};

const PAINTS = [0xf2e3c6, 0xe8b4a0, 0xa8d8d8, 0xf7d774, 0xd96c47, 0x8ecae6, 0xf4f1de, 0xe07a5f, 0x81b29a, 0xf2cc8f, 0xbc6c25, 0x606c38];

function boxMesh(w, h, d, color, x, y, z) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

export function createWorld(scene) {
  const rng = makeRng(WORLD_SEED);
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  // --- sky, light and ground ----------------------------------------------
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0xaed6e8, 260, 900);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
  sun.position.set(180, 320, 120);
  scene.add(sun);
  const amb = new THREE.AmbientLight(0xbfd9e8, 0.85);
  scene.add(amb);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0xe8d8b0, 0.5);
  scene.add(hemi);
  // Day-cycle endpoints: the lighting rig eases between a high noon look
  // and a low golden-hour look over a five-minute cycle (see
  // updateEnvironment in the returned object). It never reaches night —
  // Solano is a postcard, not a noir — but the warm end of the swing is
  // what switches the traffic headlights on.
  const SKY_NOON = new THREE.Color(0x87ceeb);
  const SKY_GOLD = new THREE.Color(0xf2a56b);
  const FOG_NOON = new THREE.Color(0xaed6e8);
  const FOG_GOLD = new THREE.Color(0xe8b48a);
  const SUN_NOON = new THREE.Color(0xfff2d8);
  const SUN_GOLD = new THREE.Color(0xffab5e);
  const envState = { daylight: 1 };

  const groundMat = new THREE.MeshLambertMaterial({ color: 0x9aa578 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  // Water: one big translucent plane east and south of the landmass.
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x1d7a8c, transparent: true, opacity: 0.88 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 500), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.12, 580);
  group.add(water);
  // The eastern water starts beyond the harbour apron (which reaches
  // x=460): an earlier, wider plane sat above the apron and drowned the
  // docks in teal, so this one begins at x=470.
  const waterEast = new THREE.Mesh(new THREE.PlaneGeometry(420, 1400), waterMat);
  waterEast.rotation.x = -Math.PI / 2;
  waterEast.position.set(680, 0.12, 0);
  group.add(waterEast);

  // Beach sand strip along the south edge.
  const sand = boxMesh(700, 0.3, 46, 0xeed9a4, 0, 0.1, 345);
  group.add(sand);

  // --- roads ---------------------------------------------------------------
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3f44 });
  const walkMat = new THREE.MeshLambertMaterial({ color: 0xb8b0a0 });
  for (let i = 0; i <= GRID; i++) {
    const c = roadCoord(i);
    const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, CITY_EDGE * 2 + ROAD), roadMat);
    vRoad.rotation.x = -Math.PI / 2;
    vRoad.position.set(c, 0.02, 0);
    group.add(vRoad);
    const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(CITY_EDGE * 2 + ROAD, ROAD), roadMat);
    hRoad.rotation.x = -Math.PI / 2;
    hRoad.position.set(0, 0.02, c);
    group.add(hRoad);
    // Sidewalk slabs flanking each road.
    for (const s of [-1, 1]) {
      const sv = new THREE.Mesh(new THREE.PlaneGeometry(2.4, CITY_EDGE * 2), walkMat);
      sv.rotation.x = -Math.PI / 2;
      sv.position.set(c + s * (ROAD / 2 + 1.2), 0.04, 0);
      group.add(sv);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(CITY_EDGE * 2, 2.4), walkMat);
      sh.rotation.x = -Math.PI / 2;
      sh.position.set(0, 0.04, c + s * (ROAD / 2 + 1.2));
      group.add(sh);
    }
    // Dashed centre line segments.
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf7d774 });
    for (let d = -300; d < 300; d += 16) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 6), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(c, 0.05, d);
      group.add(dash);
    }
  }

  // Intersection dressing: a tall lamp post on alternating corners and
  // the occasional bench facing the traffic. These sit on sidewalk
  // corners, clear of both the road and the building line.
  const lampPostMat = new THREE.MeshLambertMaterial({ color: 0x2f3538 });
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
  for (let i = 0; i <= GRID; i += 2) {
    for (let j = 0; j <= GRID; j += 2) {
      const lx = roadCoord(i) + ROAD / 2 + 1.6;
      const lz = roadCoord(j) + ROAD / 2 + 1.6;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 7.6, 6), lampPostMat);
      post.position.set(lx, 3.8, lz);
      group.add(post);
      const headLamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 5), lampGlowMat);
      headLamp.position.set(lx, 7.7, lz);
      group.add(headLamp);
      if ((i + j) % 4 === 0) {
        const bench = boxMesh(2.2, 0.45, 0.65, 0x7a4a21, lx - 2.4, 0.4, lz);
        group.add(bench);
        group.add(boxMesh(2.2, 0.7, 0.18, 0x7a4a21, lx - 2.4, 0.85, lz - 0.3));
      }
    }
  }

  // Harbour apron and warehouse yard (drivable concrete east of the grid).
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(150, 700), new THREE.MeshLambertMaterial({ color: 0x8f8a80 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(385, 0.03, 0);
  group.add(apron);

  // --- buildings -------------------------------------------------------------
  // One to four buildings per block, heights and paint from the seeded rng.
  // Blocks containing a named location keep a plaza instead of buildings.
  const plazaBlocks = new Set(['3,6', '6,11', '7,5', '1,1', '9,3', '10,8', '10,1']);
  for (let bx = 0; bx < GRID; bx++) {
    for (let bz = 0; bz < GRID; bz++) {
      const cx = roadCoord(bx) + ROAD / 2 + BLOCK / 2;
      const cz = roadCoord(bz) + ROAD / 2 + BLOCK / 2;
      if (plazaBlocks.has(bx + ',' + bz)) {
        const plaza = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK), new THREE.MeshLambertMaterial({ color: 0xd8cba8 }));
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.set(cx, 0.045, cz);
        group.add(plaza);
        continue;
      }
      const count = randInt(rng, 1, 3);
      for (let k = 0; k < count; k++) {
        const w = randRange(rng, 12, 20);
        const d = randRange(rng, 12, 20);
        const h = randRange(rng, 10, 62);
        const ox = count === 1 ? 0 : randRange(rng, -10, 10);
        const oz = count === 1 ? 0 : randRange(rng, -10, 10);
        const color = pickOne(rng, PAINTS);
        const b = boxMesh(w, h, d, color, cx + ox, h / 2, cz + oz);
        group.add(b);
        // Roof lip and a darker window band give the blocks some read at speed.
        const roof = boxMesh(w + 1, 1.2, d + 1, 0x555049, cx + ox, h + 0.6, cz + oz);
        group.add(roof);
        const band = boxMesh(w + 0.2, Math.max(2, h * 0.35), d + 0.2, 0x2b3a42, cx + ox, h * 0.55, cz + oz);
        group.add(band);
        colliders.push({ minX: cx + ox - w / 2, maxX: cx + ox + w / 2, minZ: cz + oz - d / 2, maxZ: cz + oz + d / 2 });
        // --- per-building variety, all seeded so the city is stable ----
        // A second, higher window band on taller towers breaks up the
        // single stripe the first pass used.
        if (h > 30) {
          const band2 = boxMesh(w + 0.2, Math.max(2, h * 0.16), d + 0.2, 0x39525e, cx + ox, h * 0.85, cz + oz);
          group.add(band2);
        }
        // Stepped crown: some towers narrow near the top, wedding-cake
        // style, which reads well against the sky from street level.
        if (h > 38 && rng() > 0.45) {
          const stepW = w * randRange(rng, 0.55, 0.75);
          const stepD = d * randRange(rng, 0.55, 0.75);
          const stepH = randRange(rng, 4, 8);
          group.add(boxMesh(stepW, stepH, stepD, color, cx + ox, h + stepH / 2, cz + oz));
          group.add(boxMesh(stepW + 0.8, 1, stepD + 0.8, 0x555049, cx + ox, h + stepH + 0.5, cz + oz));
        }
        // Rooftop clutter: air-conditioning boxes on most roofs, and a
        // wooden water tower on the tallest ones.
        if (rng() > 0.35) {
          const acCount = randInt(rng, 1, 3);
          for (let a = 0; a < acCount; a++) {
            const acw = randRange(rng, 1.6, 3);
            group.add(boxMesh(acw, 1.1, acw, 0x9aa0a3,
              cx + ox + randRange(rng, -w / 4, w / 4), h + 1.7, cz + oz + randRange(rng, -d / 4, d / 4)));
          }
        }
        if (h > 44 && rng() > 0.5) {
          const tx = cx + ox + randRange(rng, -w / 5, w / 5);
          const tz = cz + oz + randRange(rng, -d / 5, d / 5);
          const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.4, 9), new THREE.MeshLambertMaterial({ color: 0x8a6642 }));
          tank.position.set(tx, h + 3.4, tz);
          group.add(tank);
          group.add(boxMesh(0.3, 1.8, 0.3, 0x5d4630, tx - 1.1, h + 0.9, tz));
          group.add(boxMesh(0.3, 1.8, 0.3, 0x5d4630, tx + 1.1, h + 0.9, tz));
          const tankRoof = new THREE.Mesh(new THREE.ConeGeometry(2, 1.1, 9), new THREE.MeshLambertMaterial({ color: 0x6e4f30 }));
          tankRoof.position.set(tx, h + 5.6, tz);
          group.add(tankRoof);
        }
        // Ground-floor life: a striped awning over the pavement on the
        // south face, and on some blocks a bright shopfront sign board
        // whose colour is drawn from the billboard palette.
        if (rng() > 0.4) {
          const awn = boxMesh(w * 0.7, 0.25, 2.6, pickOne(rng, [0xe07a5f, 0x2ec4b6, 0xffb03a, 0xd7263d]), cx + ox, 3.1, cz + oz + d / 2 + 1.2);
          awn.rotation.x = 0.35;
          group.add(awn);
        }
        if (rng() > 0.55) {
          const sign = boxMesh(w * 0.6, 1.1, 0.3, pickOne(rng, [0xffb03a, 0x2ec4b6, 0xff5a3c, 0xf7d774]), cx + ox, 4.4, cz + oz + d / 2 + 0.25);
          group.add(sign);
        }
      }
      // Street palms on some corners.
      if (rng() > 0.45) {
        const px = cx - BLOCK / 2 + 2;
        const pz = cz - BLOCK / 2 + 2;
        const trunk = boxMesh(0.5, 6, 0.5, 0x8a6642, px, 3, pz);
        group.add(trunk);
        const crown = new THREE.Mesh(new THREE.SphereGeometry(2.6, 7, 5), new THREE.MeshLambertMaterial({ color: 0x3d9970 }));
        crown.position.set(px, 6.6, pz);
        group.add(crown);
      }
      // Lamp posts.
      if (rng() > 0.3) {
        const lx = cx + BLOCK / 2 - 1;
        const lz = cz + BLOCK / 2 - 1;
        group.add(boxMesh(0.3, 7, 0.3, 0x333333, lx, 3.5, lz));
        const lampHead = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
        lampHead.position.set(lx, 7.1, lz);
        group.add(lampHead);
      }
    }
  }

  // --- harbour dressing: containers, cranes, warehouse ----------------------
  const containerColors = [0xc0392b, 0x2471a3, 0x229954, 0xca6f1e, 0x616a6b];
  for (let i = 0; i < 26; i++) {
    const cx = randRange(rng, 340, 440);
    const cz = randRange(rng, -260, 260);
    if (Math.abs(cz - 120) < 16 && cx < 410) continue;
    if (Math.abs(cz + 140) < 30 && cx > 350 && cx < 415) continue;
    const box = boxMesh(12, 5, 5, pickOne(rng, containerColors), cx, 2.5, cz);
    box.rotation.y = rng() > 0.5 ? 0 : Math.PI / 2;
    group.add(box);
    colliders.push({ minX: cx - 6, maxX: cx + 6, minZ: cz - 3, maxZ: cz + 3 });
    // Roughly a third of the stacks carry a second box on top, slightly
    // askew — real container yards are never perfectly neat.
    if (rng() > 0.62) {
      const top = boxMesh(12, 5, 5, pickOne(rng, containerColors), cx + randRange(rng, -0.5, 0.5), 7.5, cz);
      top.rotation.y = box.rotation.y + randRange(rng, -0.06, 0.06);
      group.add(top);
    }
  }
  // Fuel drums and pallet stacks scattered through the yard: the small
  // clutter that makes the harbour feel worked-in rather than staged.
  for (let i = 0; i < 22; i++) {
    const dx = randRange(rng, 336, 448);
    const dz = randRange(rng, -280, 280);
    if (Math.abs(dz - 120) < 14 && dx < 410) continue;
    if (Math.abs(dz + 140) < 26 && dx > 348 && dx < 418) continue;
    if (rng() > 0.5) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 9), new THREE.MeshLambertMaterial({ color: pickOne(rng, [0xc0392b, 0x2471a3, 0xe67e22]) }));
      drum.position.set(dx, 0.65, dz);
      group.add(drum);
      colliders.push({ minX: dx - 0.6, maxX: dx + 0.6, minZ: dz - 0.6, maxZ: dz + 0.6 });
    } else {
      group.add(boxMesh(2.4, 0.3, 2, 0xa67c52, dx, 0.15, dz));
      group.add(boxMesh(2, 1, 1.7, 0x8f8a80, dx, 0.8, dz));
      colliders.push({ minX: dx - 1.2, maxX: dx + 1.2, minZ: dz - 1, maxZ: dz + 1 });
    }
  }
  for (const cz of [-220, 20, 230]) {
    const legA = boxMesh(1.5, 34, 1.5, 0xd35400, 430, 17, cz - 10);
    const legB = boxMesh(1.5, 34, 1.5, 0xd35400, 430, 17, cz + 10);
    const beam = boxMesh(2, 2, 44, 0xd35400, 430, 34, cz);
    group.add(legA, legB, beam);
    colliders.push({ minX: 428, maxX: 432, minZ: cz - 11, maxZ: cz + 11 });
  }
  // The warehouse itself: a big shed the fourth mission fights inside of.
  // Walls are colliders with a gap on the west side as the door.
  const wh = LOCATIONS.warehouse;
  const whMat = 0x7d6608;
  group.add(boxMesh(56, 16, 2, whMat, wh.x, 8, wh.z - 26));
  group.add(boxMesh(56, 16, 2, whMat, wh.x, 8, wh.z + 26));
  group.add(boxMesh(2, 16, 54, whMat, wh.x + 27, 8, wh.z));
  group.add(boxMesh(2, 16, 20, whMat, wh.x - 27, 8, wh.z - 17));
  group.add(boxMesh(2, 16, 20, whMat, wh.x - 27, 8, wh.z + 17));
  const whRoof = boxMesh(58, 1.5, 54, 0x935116, wh.x, 16.5, wh.z);
  whRoof.material.transparent = true;
  whRoof.material.opacity = 0.35;
  group.add(whRoof);
  colliders.push({ minX: wh.x - 28, maxX: wh.x + 28, minZ: wh.z - 27, maxZ: wh.z - 25 });
  colliders.push({ minX: wh.x - 28, maxX: wh.x + 28, minZ: wh.z + 25, maxZ: wh.z + 27 });
  colliders.push({ minX: wh.x + 26, maxX: wh.x + 28, minZ: wh.z - 27, maxZ: wh.z + 27 });
  colliders.push({ minX: wh.x - 28, maxX: wh.x - 26, minZ: wh.z - 27, maxZ: wh.z - 7 });
  colliders.push({ minX: wh.x - 28, maxX: wh.x - 26, minZ: wh.z + 7, maxZ: wh.z + 27 });
  // Crates inside the warehouse for cover.
  for (let i = 0; i < 10; i++) {
    const cx = wh.x + randRange(rng, -20, 20);
    const cz = wh.z + randRange(rng, -20, 20);
    group.add(boxMesh(3, 3, 3, 0xa67c52, cx, 1.5, cz));
    colliders.push({ minX: cx - 1.5, maxX: cx + 1.5, minZ: cz - 1.5, maxZ: cz + 1.5 });
  }

  // --- district dressing -----------------------------------------------------
  // A central park fills one whole block: grass, paths, a fountain, benches
  // and a ring of palms. It gives the downtown grid a landmark that is not
  // another tower, and pedestrians cut across it on their walks.
  const parkCx = roadCoord(6) + ROAD / 2 + BLOCK / 2;
  const parkCz = roadCoord(4) + ROAD / 2 + BLOCK / 2;
  const parkGrass = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK), new THREE.MeshLambertMaterial({ color: 0x5da85f }));
  parkGrass.rotation.x = -Math.PI / 2;
  parkGrass.position.set(parkCx, 0.06, parkCz);
  group.add(parkGrass);
  const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.6, 1, 18), new THREE.MeshLambertMaterial({ color: 0xd8d3c3 }));
  fountainBase.position.set(parkCx, 0.5, parkCz);
  group.add(fountainBase);
  const fountainWater = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.4, 18), new THREE.MeshLambertMaterial({ color: 0x4fb3c9 }));
  fountainWater.position.set(parkCx, 1.05, parkCz);
  group.add(fountainWater);
  const fountainJet = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.7, 3.4, 8), new THREE.MeshLambertMaterial({ color: 0xbfeef7 }));
  fountainJet.position.set(parkCx, 2.6, parkCz);
  group.add(fountainJet);
  colliders.push({ minX: parkCx - 5.6, maxX: parkCx + 5.6, minZ: parkCz - 5.6, maxZ: parkCz + 5.6 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = parkCx + Math.sin(a) * 15;
    const pz = parkCz + Math.cos(a) * 15;
    group.add(boxMesh(0.5, 5.4, 0.5, 0x8a6642, px, 2.7, pz));
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2.4, 7, 5), new THREE.MeshLambertMaterial({ color: 0x2e8b57 }));
    crown.position.set(px, 6, pz);
    group.add(crown);
    const bench = boxMesh(2.4, 0.5, 0.7, 0x7a4a21, parkCx + Math.sin(a + 0.4) * 9, 0.45, parkCz + Math.cos(a + 0.4) * 9);
    bench.rotation.y = a;
    group.add(bench);
  }
  // Park paths: two pale gravel strips crossing at the fountain, so the
  // park reads as a designed space rather than a lawn with props on it.
  const pathMat = new THREE.MeshLambertMaterial({ color: 0xe4d9bd });
  const pathNS = new THREE.Mesh(new THREE.PlaneGeometry(3.4, BLOCK), pathMat);
  pathNS.rotation.x = -Math.PI / 2;
  pathNS.position.set(parkCx, 0.075, parkCz);
  group.add(pathNS);
  const pathEW = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, 3.4), pathMat);
  pathEW.rotation.x = -Math.PI / 2;
  pathEW.position.set(parkCx, 0.075, parkCz);
  group.add(pathEW);
  // A bandstand gazebo in the park's north-east quadrant: six posts, a
  // raised floor and a coral cone roof.
  const gzX = parkCx + 12;
  const gzZ = parkCz - 12;
  const gzFloor = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0xd8d3c3 }));
  gzFloor.position.set(gzX, 0.25, gzZ);
  group.add(gzFloor);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    group.add(boxMesh(0.28, 3, 0.28, 0xf4f6f6, gzX + Math.sin(a) * 3.6, 1.9, gzZ + Math.cos(a) * 3.6));
  }
  const gzRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2, 6), new THREE.MeshLambertMaterial({ color: 0xe07a5f }));
  gzRoof.position.set(gzX, 4.4, gzZ);
  group.add(gzRoof);
  colliders.push({ minX: gzX - 4.2, maxX: gzX + 4.2, minZ: gzZ - 4.2, maxZ: gzZ + 4.2 });
  // Flower beds: low soil boxes with a bright scatter of bloom cubes,
  // one in each quadrant the paths leave behind.
  const bloomColors = [0xff5a3c, 0xffd23c, 0xff79a8, 0xf4f6f6];
  for (const [qx, qz] of [[-11, -11], [11, 11], [-11, 11]]) {
    const bedX = parkCx + qx;
    const bedZ = parkCz + qz;
    group.add(boxMesh(7, 0.4, 5, 0x5d4630, bedX, 0.2, bedZ));
    for (let i = 0; i < 9; i++) {
      group.add(boxMesh(0.5, 0.5, 0.5, pickOne(rng, bloomColors),
        bedX + randRange(rng, -3, 3), 0.6, bedZ + randRange(rng, -1.8, 1.8)));
    }
  }
  // The park statue: Solano's founder, allegedly. A plinth, a figure and
  // a sphere held high — abstract enough to survive any art review.
  const stX = parkCx - 12;
  const stZ = parkCz + 12;
  group.add(boxMesh(2.2, 1.6, 2.2, 0xb8b0a0, stX, 0.8, stZ));
  group.add(boxMesh(0.7, 2.6, 0.7, 0x7f8c8d, stX, 2.9, stZ));
  const stOrb = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffb03a }));
  stOrb.position.set(stX, 4.9, stZ);
  group.add(stOrb);
  colliders.push({ minX: stX - 1.1, maxX: stX + 1.1, minZ: stZ - 1.1, maxZ: stZ + 1.1 });

  // Beach dressing: umbrellas, towels, a lifeguard stand and beach balls
  // scattered along the sand strip, plus two volleyball nets.
  const umbrellaColors = [0xff5a3c, 0xffd23c, 0x2ec4b6, 0xff79a8, 0x74b9ff];
  for (let i = 0; i < 16; i++) {
    const ux = randRange(rng, -300, 300);
    const uz = randRange(rng, 332, 358);
    group.add(boxMesh(0.18, 2.4, 0.18, 0xeeeeee, ux, 1.2, uz));
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.1, 0.8, 9), new THREE.MeshLambertMaterial({ color: pickOne(rng, umbrellaColors) }));
    canopy.position.set(ux, 2.6, uz);
    group.add(canopy);
    const towel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), new THREE.MeshLambertMaterial({ color: pickOne(rng, umbrellaColors) }));
    towel.rotation.x = -Math.PI / 2;
    towel.rotation.z = randRange(rng, 0, 3);
    towel.position.set(ux + randRange(rng, -2, 2), 0.28, uz + randRange(rng, 1, 3));
    group.add(towel);
  }
  const lifeguard = new THREE.Group();
  const lgBase = boxMesh(2.6, 3.4, 2.6, 0xf4f6f6, 0, 1.7, 0);
  const lgRoof = boxMesh(3.4, 0.4, 3.4, 0xe74c3c, 0, 3.8, 0);
  lifeguard.add(lgBase, lgRoof);
  lifeguard.position.set(40, 0, 342);
  group.add(lifeguard);
  colliders.push({ minX: 38.4, maxX: 41.6, minZ: 340.4, maxZ: 343.6 });
  for (const vx of [-120, 170]) {
    group.add(boxMesh(0.2, 2.6, 0.2, 0xdddddd, vx - 4, 1.3, 344));
    group.add(boxMesh(0.2, 2.6, 0.2, 0xdddddd, vx + 4, 1.3, 344));
    const net = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.1), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    net.position.set(vx, 1.8, 344);
    group.add(net);
  }

  // A palm row along the back of the beach, leaning over the sand, and a
  // little beach bar hut with a thatched roof near the lifeguard stand.
  for (let i = 0; i < 9; i++) {
    const px = -280 + i * 70 + randRange(rng, -6, 6);
    const pz = 330;
    const trunk = boxMesh(0.45, 7.5, 0.45, 0x8a6642, px, 3.7, pz);
    trunk.rotation.z = randRange(rng, -0.09, 0.09);
    group.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2.9, 7, 5), new THREE.MeshLambertMaterial({ color: 0x3d9970 }));
    crown.position.set(px + trunk.rotation.z * -8, 7.9, pz);
    group.add(crown);
  }
  const barBase = boxMesh(6, 2.8, 4, 0xd9a066, -60, 1.4, 338);
  group.add(barBase);
  const barRoof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.6, 4), new THREE.MeshLambertMaterial({ color: 0xbc6c25 }));
  barRoof.position.set(-60, 3.6, 338);
  barRoof.rotation.y = Math.PI / 4;
  group.add(barRoof);
  group.add(boxMesh(6.4, 0.25, 1.2, 0x7a4a21, -60, 1.1, 340.4));
  colliders.push({ minX: -63, maxX: -57, minZ: 336, maxZ: 340 });

  // Marina: boats moored in the harbour basin and a fuel dock. The boats
  // are kept in a list so updateEnvironment can bob them on the swell.
  const boats = [];
  for (const [bx, bz, hull] of [[492, -60, 0xf4f6f6], [492, 60, 0xe74c3c], [500, 150, 0x2ec4b6], [486, -160, 0xf7d774]]) {
    const boat = new THREE.Group();
    const hullMesh = boxMesh(4.4, 1.6, 11, hull, 0, 0.6, 0);
    const cabinMesh = boxMesh(3, 1.8, 4, 0x2b3a42, 0, 2, -1);
    const mast = boxMesh(0.24, 8, 0.24, 0x888888, 0, 5, 1.5);
    boat.add(hullMesh, cabinMesh, mast);
    // A furled sail triangle dresses the mast without any canvas cost.
    const sail = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 5.4, 6), new THREE.MeshLambertMaterial({ color: 0xf4f1de }));
    sail.position.set(0, 3.4, 1.7);
    boat.add(sail);
    boat.position.set(bx, 0.1, bz);
    boat.rotation.y = randRange(rng, -0.2, 0.2);
    boat.name = 'boat';
    group.add(boat);
    boats.push({ mesh: boat, phase: randRange(rng, 0, Math.PI * 2), baseY: 0.1 });
  }
  const dock = boxMesh(60, 1, 8, 0x9a7b4f, 452, 0.4, 0);
  group.add(dock);
  // Mooring posts along the dock edge and a line of channel buoys
  // marking the fairway out of the basin.
  for (let i = 0; i < 7; i++) {
    group.add(boxMesh(0.4, 1.6, 0.4, 0x5d4630, 428 + i * 8, 0.9, 4.5));
  }
  const buoys = [];
  for (let i = 0; i < 5; i++) {
    const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xd7263d : 0x2ecc71 }));
    buoy.position.set(520 + i * 6, 0.3, -120 + i * 60);
    group.add(buoy);
    buoys.push({ mesh: buoy, phase: i * 1.3 });
  }

  // The harbour lighthouse: banded tower on a rock jetty at the south
  // end of the apron, with a breakwater of tumbled rocks keeping the
  // basin calm. Pure landmark — it exists so the harbour screenshot has
  // a silhouette and drivers get a bearing at the golden end of the day.
  const lhX = 458;
  const lhZ = -306;
  for (let i = 0; i < 7; i++) {
    const rock = boxMesh(randRange(rng, 2.5, 4.5), randRange(rng, 1.2, 2.2), randRange(rng, 2.5, 4), 0x5d5648, 452 + i * 2.2, 0.4, -288 + i * 3.4);
    rock.rotation.y = randRange(rng, 0, 3);
    group.add(rock);
  }
  const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4, 2, 10), new THREE.MeshLambertMaterial({ color: 0x8f8a80 }));
  lhBase.position.set(lhX, 1, lhZ);
  group.add(lhBase);
  const lhLow = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.3, 6, 10), new THREE.MeshLambertMaterial({ color: 0xf4f6f6 }));
  lhLow.position.set(lhX, 5, lhZ);
  group.add(lhLow);
  const lhBand = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.85, 4.4, 10), new THREE.MeshLambertMaterial({ color: 0xd7263d }));
  lhBand.position.set(lhX, 10.2, lhZ);
  group.add(lhBand);
  const lhTop = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.6, 3.4, 10), new THREE.MeshLambertMaterial({ color: 0xf4f6f6 }));
  lhTop.position.set(lhX, 14.1, lhZ);
  group.add(lhTop);
  const lhLamp = new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
  lhLamp.position.set(lhX, 16.6, lhZ);
  group.add(lhLamp);
  const lhRoof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.6, 10), new THREE.MeshLambertMaterial({ color: 0x2b3a42 }));
  lhRoof.position.set(lhX, 18.2, lhZ);
  group.add(lhRoof);
  colliders.push({ minX: lhX - 3.4, maxX: lhX + 3.4, minZ: lhZ - 3.4, maxZ: lhZ + 3.4 });

  // Billboards on the busiest intersections — pure Solano advertising.
  const billboardTexts = [0xffb03a, 0x2ec4b6, 0xff5a3c, 0xf7d774];
  for (const [bx, bz] of [[2, 2], [8, 9], [5, 10], [10, 2]]) {
    const px = roadCoord(bx) + 9;
    const pz = roadCoord(bz) + 9;
    group.add(boxMesh(0.5, 11, 0.5, 0x444444, px, 5.5, pz));
    const board = boxMesh(9, 4, 0.4, pickOne(rng, billboardTexts), px, 12, pz);
    board.rotation.y = Math.PI / 4;
    group.add(board);
    colliders.push({ minX: px - 0.5, maxX: px + 0.5, minZ: pz - 0.5, maxZ: pz + 0.5 });
  }

  // Street clutter: dumpsters, hydrants and bus stops sprinkled by the rng.
  for (let i = 0; i < 34; i++) {
    const bx = randInt(rng, 0, 11);
    const bz = randInt(rng, 0, 11);
    const cx = roadCoord(bx) + ROAD / 2 + BLOCK / 2 + randRange(rng, -17, 17);
    const cz = roadCoord(bz) + ROAD / 2 + BLOCK / 2 + randRange(rng, -17, 17);
    const kind = rng();
    if (kind < 0.4) {
      group.add(boxMesh(2.2, 1.3, 1.2, 0x2d6a4f, cx, 0.65, cz));
      colliders.push({ minX: cx - 1.1, maxX: cx + 1.1, minZ: cz - 0.6, maxZ: cz + 0.6 });
    } else if (kind < 0.7) {
      const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.9, 8), new THREE.MeshLambertMaterial({ color: 0xd7263d }));
      hyd.position.set(cx, 0.45, cz);
      group.add(hyd);
    } else {
      group.add(boxMesh(3.4, 2.4, 0.3, 0x2ec4b6, cx, 1.2, cz));
      group.add(boxMesh(0.24, 2.6, 0.24, 0x555555, cx - 1.6, 1.3, cz));
      group.add(boxMesh(0.24, 2.6, 0.24, 0x555555, cx + 1.6, 1.3, cz));
    }
  }

  // Landmark signs: hospital cross, spray shop, hideout palms.
  const hosp = LOCATIONS.hospital;
  group.add(boxMesh(10, 26, 10, 0xf4f6f6, hosp.x + 14, 13, hosp.z + 14));
  colliders.push({ minX: hosp.x + 9, maxX: hosp.x + 19, minZ: hosp.z + 9, maxZ: hosp.z + 19 });
  group.add(boxMesh(5, 1.4, 1.4, 0xe74c3c, hosp.x + 14, 27, hosp.z + 14));
  group.add(boxMesh(1.4, 5, 1.4, 0xe74c3c, hosp.x + 14, 27, hosp.z + 14));
  const spray = LOCATIONS.sprayShop;
  group.add(boxMesh(16, 7, 12, 0x2ec4b6, spray.x + 13, 3.5, spray.z + 13));
  colliders.push({ minX: spray.x + 5, maxX: spray.x + 21, minZ: spray.z + 7, maxZ: spray.z + 19 });
  group.add(boxMesh(10, 1, 0.4, 0xf7d774, spray.x + 13, 5.6, spray.z + 6.8));
  // The second spray shop, up in Northgate: same service, orange livery,
  // so a hot driver in the north of the city is not stranded.
  const spray2 = LOCATIONS.sprayShop2;
  group.add(boxMesh(16, 7, 12, 0xe67e22, spray2.x + 13, 3.5, spray2.z + 13));
  colliders.push({ minX: spray2.x + 5, maxX: spray2.x + 21, minZ: spray2.z + 7, maxZ: spray2.z + 19 });
  group.add(boxMesh(10, 1, 0.4, 0xf7d774, spray2.x + 13, 5.6, spray2.z + 6.8));
  group.add(boxMesh(0.4, 6, 0.4, 0x444444, spray2.x + 4, 3, spray2.z + 4));
  group.add(boxMesh(3.4, 1.6, 0.3, 0xe67e22, spray2.x + 4, 6.4, spray2.z + 4));
  const hide = LOCATIONS.hideout;
  group.add(boxMesh(12, 6, 10, 0xf7d774, hide.x + 13, 3, hide.z + 13));
  colliders.push({ minX: hide.x + 7, maxX: hide.x + 19, minZ: hide.z + 8, maxZ: hide.z + 18 });

  // A mission marker pillar helper lives here so every marker looks alike.
  function makeMarker(color) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 26, 14, 1, true), mat);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.4, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(pillar);
    holder.add(ring);
    pillar.position.y = 13;
    ring.position.y = 0.15;
    holder.visible = false;
    scene.add(holder);
    return holder;
  }

  return {
    colliders,
    group,
    water,
    makeMarker,
    // 1 at high noon, easing toward ~0.84 at the golden ends of the
    // cycle. main.js reads this to decide when car headlights come on.
    get daylight() {
      return envState.daylight;
    },
    // Per-frame ambience: the five-minute day cycle, bobbing boats and
    // buoys, the fountain jet's pulse and a slow shimmer on the water.
    // `t` is the game's elapsed seconds. Everything here is cosmetic and
    // cheap: a handful of lerps and sine waves over retained references.
    updateEnvironment(t) {
      const cycle = Math.cos((t / 300) * Math.PI * 2); // 1 at noon, -1 at gold
      const k = (cycle + 1) / 2;
      envState.daylight = 0.84 + 0.16 * k;
      sun.intensity = 1.15 + 0.45 * k;
      sun.color.copy(SUN_GOLD).lerp(SUN_NOON, k);
      sun.position.set(180 * cycle, 190 + 130 * k, 120);
      amb.intensity = 0.7 + 0.15 * k;
      hemi.intensity = 0.38 + 0.12 * k;
      scene.background.copy(SKY_GOLD).lerp(SKY_NOON, k);
      scene.fog.color.copy(FOG_GOLD).lerp(FOG_NOON, k);
      waterMat.opacity = 0.85 + 0.05 * Math.sin(t * 0.7);
      for (const b of boats) {
        b.mesh.position.y = b.baseY + Math.sin(t * 0.85 + b.phase) * 0.16;
        b.mesh.rotation.z = Math.sin(t * 0.6 + b.phase) * 0.028;
        b.mesh.rotation.x = Math.cos(t * 0.5 + b.phase) * 0.02;
      }
      for (const b of buoys) {
        b.mesh.position.y = 0.3 + Math.sin(t * 1.3 + b.phase) * 0.22;
      }
      fountainJet.scale.y = 1 + 0.16 * Math.sin(t * 3.1);
      fountainWater.position.y = 1.05 + Math.sin(t * 2.2) * 0.03;
    },
    resolveCollisions(pos, radius) {
      // Push a circle (in plan view) out of every building box it overlaps,
      // and keep it inside the playable land area.
      for (const c of colliders) {
        const nx = Math.max(c.minX, Math.min(c.maxX, pos.x));
        const nz = Math.max(c.minZ, Math.min(c.maxZ, pos.z));
        const dx = pos.x - nx;
        const dz = pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < radius * radius) {
          if (d2 > 0.0001) {
            const d = Math.sqrt(d2);
            pos.x = nx + (dx / d) * radius;
            pos.z = nz + (dz / d) * radius;
          } else {
            // Centre is inside the box: leave by the shallowest side.
            const left = pos.x - c.minX;
            const right = c.maxX - pos.x;
            const top = pos.z - c.minZ;
            const bot = c.maxZ - pos.z;
            const m = Math.min(left, right, top, bot);
            if (m === left) pos.x = c.minX - radius;
            else if (m === right) pos.x = c.maxX + radius;
            else if (m === top) pos.z = c.minZ - radius;
            else pos.z = c.maxZ + radius;
          }
        }
      }
      pos.x = Math.max(-330, Math.min(455, pos.x));
      pos.z = Math.max(-330, Math.min(330, pos.z));
      return pos;
    },
  };
}
