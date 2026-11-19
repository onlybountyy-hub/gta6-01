// world.js — Port Solano itself, built procedurally at boot.
//
// The sunset sky and its lights, the seeded grid of roads, instanced buildings
// with lit facades, palms and streetlights, the beach, and the harbour with its
// pier, crates, containers and Lola's boat. This module also owns the static
// collision boxes and the road-geometry helpers (isOnRoad, nearestIntersection,
// clampToWorld) that every moving system navigates by.

import * as THREE from 'three';
import { CITY, PLACES, roadCenters } from './config.js';
import { S } from './state.js';
import { makeRng, randRange, randInt, pick } from './random.js';
import {
  makeRoadTexture,
  makePavementTexture,
  makeSandTexture,
  makeWaterTexture,
  makeFacadeTexture,
  makeFrondTexture,
  makeCrateTexture,
  makeGlowTexture,
  makeSkyTexture,
} from './textures.js';

const FACADE_COLORS = ['#c96f4a', '#d9a05b', '#9db4c0', '#e3d3ae', '#b85c5c', '#7fa6a3', '#e8e3d8', '#c98aa6'];
export const CITY_BOUNDS = { minX: -332, maxX: 412, minZ: -332, maxZ: 332 };

/**
 * Concatenate baked geometries into one. Buildings and crates are drawn as a
 * handful of merged or instanced meshes, never as hundreds of scene nodes.
 */
function mergeGeoms(geoms) {
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const part of parts) total += part.attributes.position.count;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let offset = 0;
  for (const part of parts) {
    position.set(part.attributes.position.array, offset * 3);
    normal.set(part.attributes.normal.array, offset * 3);
    if (part.attributes.uv) uv.set(part.attributes.uv.array, offset * 2);
    offset += part.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

/** A box geometry with its transform already baked in, ready for merging. */
function boxAt(w, h, d, x, y, z, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
  return geo;
}

/** Build the whole static city and register its data (colliders, roads) on S. */
export function buildWorld() {
  const scene = S.scene;
  const rng = makeRng(S.seed);
  const centers = roadCenters();
  S.roadCenters = centers;
  S.parkingSpots = [];
  const cityLen = centers[centers.length - 1] - centers[0] + CITY.pitch;

  // --- Sky, fog, lights ------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1600, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(0xdd8a5c, 160, 1150);

  scene.add(new THREE.HemisphereLight(0x8fb4e8, 0xcf9a62, 0.85));
  const sun = new THREE.DirectionalLight(0xffb877, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -130;
  sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 130;
  sun.shadow.camera.bottom = -130;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  S.sun = sun;
  // The low sun itself: a fat glow sprite hanging over the western sea road.
  const glare = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xffc98a, transparent: true, opacity: 0.9, fog: false, depthWrite: false }),
  );
  glare.position.set(-1200, 190, -300);
  glare.scale.set(700, 700, 1);
  scene.add(glare);

  // --- Ground sheet, beach, sea ----------------------------------------------
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(2600, 2600),
    new THREE.MeshLambertMaterial({ color: 0x9a8a6d }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.08;
  base.receiveShadow = true;
  scene.add(base);

  const sandTex = makeSandTexture();
  sandTex.repeat.set(6, 60);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.shorelineX - CITY.beachStartX, 1500),
    new THREE.MeshLambertMaterial({ map: sandTex }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set((CITY.beachStartX + CITY.shorelineX) / 2, -0.02, 0);
  beach.receiveShadow = true;
  scene.add(beach);

  const waterTex = makeWaterTexture();
  waterTex.repeat.set(10, 30);
  const waterMat = new THREE.MeshPhongMaterial({
    map: waterTex, color: 0x9fd4de, shininess: 90, transparent: true, opacity: 0.94,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1100, 2400), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(CITY.shorelineX + 540, -0.05, 0);
  scene.add(water);
  S.waterMaterial = waterMat;

  // --- Roads ------------------------------------------------------------------
  const roadTex = makeRoadTexture();
  roadTex.repeat.set(1, cityLen / 24);
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  const roadGeoV = new THREE.PlaneGeometry(CITY.roadWidth, cityLen);
  roadGeoV.rotateX(-Math.PI / 2);
  const roadGeoH = new THREE.PlaneGeometry(CITY.roadWidth, cityLen);
  roadGeoH.rotateX(-Math.PI / 2);
  roadGeoH.rotateY(Math.PI / 2);
  for (const c of centers) {
    const v = new THREE.Mesh(roadGeoV, roadMat);
    v.position.set(c, 0.01, 0);
    v.receiveShadow = true;
    scene.add(v);
    const h = new THREE.Mesh(roadGeoH, roadMat);
    h.position.set(0, 0.02, c);
    h.receiveShadow = true;
    scene.add(h);
  }

  // --- Block pavement (one merged mesh) and buildings (instanced) -------------
  const pavementTex = makePavementTexture();
  pavementTex.repeat.set(3, 3);
  const pavementGeos = [];
  const blockSize = CITY.pitch - CITY.roadWidth;
  const facadeMats = [];
  const facadeInstances = [];
  for (let v = 0; v < 4; v += 1) {
    facadeMats.push(new THREE.MeshLambertMaterial({ map: makeFacadeTexture(v, FACADE_COLORS[v]) }));
    facadeInstances.push([]);
  }
  const roofMatrices = [];
  const signGeos = [];
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  for (let i = 0; i < centers.length - 1; i += 1) {
    for (let j = 0; j < centers.length - 1; j += 1) {
      const cx = (centers[i] + centers[i + 1]) / 2;
      const cz = (centers[j] + centers[j + 1]) / 2;
      pavementGeos.push(boxAt(blockSize, 0.12, blockSize, cx, 0.03, cz));
      const roll = rng();
      const nearBeach = cx > 220;
      if (roll < 0.1) {
        // Pocket park: no building; the palm pass plants a cluster here.
        S.parkingSpots.push({ park: true, x: cx, z: cz });
        continue;
      }
      if (roll < 0.2) {
        // Open lot: two rows of marked bays for the parked-car scatter.
        for (let k = -1; k <= 1; k += 1) {
          S.parkingSpots.push({ x: cx + k * 10, z: cz - blockSize / 2 + 3.4, heading: 0 });
          S.parkingSpots.push({ x: cx + k * 10, z: cz + blockSize / 2 - 3.4, heading: Math.PI });
        }
        continue;
      }
      const addBuilding = (bx, bz, w, d, hgt) => {
        const variant = randInt(rng, 0, 3);
        dummy.position.set(bx, 0.09, bz);
        dummy.scale.set(w, hgt, d);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        facadeInstances[variant].push({ matrix: dummy.matrix.clone(), color: pick(rng, FACADE_COLORS) });
        dummy.position.set(bx, 0.09 + hgt + 0.18, bz);
        dummy.scale.set(w + 0.7, 0.36, d + 0.7);
        dummy.updateMatrix();
        roofMatrices.push(dummy.matrix.clone());
        S.colliders.push({ minX: bx - w / 2, maxX: bx + w / 2, minZ: bz - d / 2, maxZ: bz + d / 2 });
        // A few towers carry a glowing rooftop sign — pure sunset eye-candy.
        if (hgt > 30 && rng() < 0.4) {
          signGeos.push(boxAt(w * 0.5, 1.6, 0.4, bx, 0.09 + hgt + 1.1, bz - d / 2 - 0.2));
        }
      };
      if (roll < 0.52 || nearBeach) {
        const w = randRange(rng, 17, 25);
        const d = randRange(rng, 17, 25);
        const hgt = nearBeach ? randRange(rng, 9, 22) : randRange(rng, 10, 34);
        addBuilding(cx + randRange(rng, -3, 3), cz + randRange(rng, -3, 3), w, d, hgt);
      } else {
        // Tower on a podium: a low slab with a needle behind it.
        addBuilding(cx, cz + 6, 24, 18, randRange(rng, 7, 11));
        addBuilding(cx, cz - 5, 15, 14, randRange(rng, 26, 58));
      }
    }
  }
  const pavement = new THREE.Mesh(mergeGeoms(pavementGeos), new THREE.MeshLambertMaterial({ map: pavementTex }));
  pavement.receiveShadow = true;
  scene.add(pavement);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.translate(0, 0.5, 0);
  facadeInstances.forEach((list, v) => {
    const inst = new THREE.InstancedMesh(unitBox, facadeMats[v], list.length);
    list.forEach((entry, idx) => {
      inst.setMatrixAt(idx, entry.matrix);
      inst.setColorAt(idx, tint.set(entry.color));
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    scene.add(inst);
  });
  const roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x4c4238 }), roofMatrices.length);
  roofMatrices.forEach((m, idx) => roofs.setMatrixAt(idx, m));
  roofs.castShadow = true;
  scene.add(roofs);
  if (signGeos.length) {
    const signs = new THREE.Mesh(
      mergeGeoms(signGeos),
      new THREE.MeshBasicMaterial({ color: 0xff7a4d }),
    );
    scene.add(signs);
  }

  buildPalmsAndLights(rng, centers);
  buildHarbor(rng);
}

/** Palms along every street and the beach; streetlights on the corners. */
function buildPalmsAndLights(rng, centers) {
  const scene = S.scene;
  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 5.4, 6);
  trunkGeo.translate(0, 2.7, 0);
  // A crown is six frond planes fanned and tilted, baked into a single geometry.
  const frondGeos = [];
  for (let k = 0; k < 6; k += 1) {
    const plane = new THREE.PlaneGeometry(3.6, 3.6);
    plane.translate(1.2, 0, 0);
    plane.applyMatrix4(
      new THREE.Matrix4().makeRotationY((k / 6) * Math.PI * 2).multiply(new THREE.Matrix4().makeRotationZ(-0.5)),
    );
    plane.translate(0, 5.5, 0);
    frondGeos.push(plane);
  }
  const crownGeo = mergeGeoms(frondGeos);

  const spots = [];
  for (const c of centers) {
    for (let z = -320; z <= 320; z += 27) {
      if (rng() < 0.55) spots.push({ x: c - 9.6, z: z + randRange(rng, -3, 3) });
      if (rng() < 0.55) spots.push({ x: c + 9.6, z: z + randRange(rng, -3, 3) });
    }
  }
  for (let z = -330; z <= 330; z += 22) {
    if (rng() < 0.8) spots.push({ x: CITY.beachStartX + randRange(rng, 2, 26), z });
  }
  for (const spot of S.parkingSpots) {
    if (!spot.park) continue;
    for (let k = 0; k < 5; k += 1) {
      spots.push({ x: spot.x + randRange(rng, -12, 12), z: spot.z + randRange(rng, -12, 12) });
    }
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x8a6a44 }), spots.length);
  const crowns = new THREE.InstancedMesh(
    crownGeo,
    new THREE.MeshLambertMaterial({ map: makeFrondTexture(), alphaTest: 0.35, side: THREE.DoubleSide }),
    spots.length,
  );
  const dummy = new THREE.Object3D();
  spots.forEach((spot, idx) => {
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(randRange(rng, -0.06, 0.06), rng() * Math.PI * 2, randRange(rng, -0.06, 0.06));
    const s = randRange(rng, 0.85, 1.25);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    trunks.setMatrixAt(idx, dummy.matrix);
    crowns.setMatrixAt(idx, dummy.matrix);
  });
  trunks.castShadow = true;
  scene.add(trunks);
  scene.add(crowns);

  // Streetlights: pole + arm + warm head, instanced, plus one glow Points cloud.
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 5.6, 5);
  poleGeo.translate(0, 2.8, 0);
  const headGeo = new THREE.BoxGeometry(0.5, 0.16, 1.1);
  headGeo.translate(0, 5.55, 0.4);
  const lampSpots = [];
  for (let i = 0; i < centers.length; i += 2) {
    for (let j = 0; j < centers.length; j += 2) {
      lampSpots.push({ x: centers[i] - 10.4, z: centers[j] - 10.4, ry: Math.PI / 4 });
      lampSpots.push({ x: centers[i] + 10.4, z: centers[j] + 10.4, ry: -Math.PI * 0.75 });
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x3a3f45 }), lampSpots.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lampSpots.length);
  const glowPositions = new Float32Array(lampSpots.length * 3);
  lampSpots.forEach((spot, idx) => {
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, spot.ry, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(idx, dummy.matrix);
    heads.setMatrixAt(idx, dummy.matrix);
    glowPositions[idx * 3] = spot.x;
    glowPositions[idx * 3 + 1] = 5.6;
    glowPositions[idx * 3 + 2] = spot.z;
  });
  scene.add(poles);
  scene.add(heads);
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
  scene.add(
    new THREE.Points(
      glowGeo,
      new THREE.PointsMaterial({
        map: makeGlowTexture(), color: 0xffbe78, size: 4.5, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    ),
  );
}

/** The harbour: timber pier reaching into the bay, crates, containers, the boat. */
function buildHarbor(rng) {
  const scene = S.scene;
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x7d5f3a });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(56, 1, 30), woodMat);
  deck.position.set(384, 0.55, PLACES.pierEnd.z);
  deck.receiveShadow = true;
  deck.castShadow = true;
  scene.add(deck);
  S.colliders.push({ pier: true, minX: 356, maxX: 412, minZ: PLACES.pierEnd.z - 15, maxZ: PLACES.pierEnd.z + 15 });
  const postGeo = new THREE.CylinderGeometry(0.3, 0.3, 2.4, 6);
  const posts = new THREE.InstancedMesh(postGeo, woodMat, 12);
  const dummy = new THREE.Object3D();
  let pi = 0;
  for (const px of [360, 378, 396, 410]) {
    for (const pz of [PLACES.pierEnd.z - 13, PLACES.pierEnd.z, PLACES.pierEnd.z + 13]) {
      dummy.position.set(px, -0.4, pz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      posts.setMatrixAt(pi, dummy.matrix);
      pi += 1;
    }
  }
  scene.add(posts);

  const crateGeos = [];
  const crateSpots = [
    [366, 208], [369.5, 208], [367.5, 211.5], [392, 232], [395.5, 232], [250, -228], [254, -228], [252, -224],
  ];
  for (const [cx, cz] of crateSpots) {
    const onPier = cx > 340;
    crateGeos.push(boxAt(3, 3, 3, cx, (onPier ? 1.05 : 0.09) + 1.5, cz, randRange(rng, 0, 0.6)));
  }
  const crates = new THREE.Mesh(mergeGeoms(crateGeos), new THREE.MeshLambertMaterial({ map: makeCrateTexture() }));
  crates.castShadow = true;
  crates.receiveShadow = true;
  scene.add(crates);

  const containerColors = [0xb8502f, 0x2f6db8, 0x3f9e58, 0xc7a23a];
  containerColors.forEach((color, idx) => {
    const x = 300 + (idx % 2) * 13;
    const z = 268 + Math.floor(idx / 2) * 8;
    const mesh = new THREE.Mesh(boxAt(12, 3, 6.4, x, 1.6, z, idx % 2 ? 0.12 : -0.06), new THREE.MeshLambertMaterial({ color }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    S.colliders.push({ minX: x - 6, maxX: x + 6, minZ: z - 3.2, maxZ: z + 3.2 });
  });

  // Lola's boat: a small motor yacht from boxes, waiting at the pier's end.
  const boat = new THREE.Group();
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf2ede2 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(11, 1.8, 3.8), hullMat);
  hull.position.y = 0.6;
  boat.add(hull);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 2.6), hullMat);
  bow.position.set(6.4, 0.55, 0);
  bow.rotation.z = 0.18;
  boat.add(bow);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(11.1, 0.4, 3.9), new THREE.MeshLambertMaterial({ color: 0xc94f30 }));
  stripe.position.y = 1.15;
  boat.add(stripe);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.7, 3), new THREE.MeshLambertMaterial({ color: 0xdfe8ec }));
  cabin.position.set(-0.6, 2.2, 0);
  boat.add(cabin);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 5), new THREE.MeshLambertMaterial({ color: 0x666c72 }));
  mast.position.set(2.4, 3.6, 0);
  boat.add(mast);
  boat.position.set(424, 0.1, PLACES.boat.z);
  boat.rotation.y = Math.PI / 2;
  boat.traverse((o) => {
    o.castShadow = true;
  });
  scene.add(boat);
  S.boat = boat;
}

/** Per-frame life: scrolling water, the boat's bob, and the sun tracking the player. */
export function updateWorld(dt) {
  if (S.waterMaterial && S.waterMaterial.map) {
    S.waterMaterial.map.offset.x = (S.time * 0.008) % 1;
    S.waterMaterial.map.offset.y = (Math.sin(S.time * 0.11) * 0.01 + S.time * 0.002) % 1;
  }
  if (S.boat) {
    S.boat.position.y = 0.1 + Math.sin(S.time * 0.9) * 0.14;
    S.boat.rotation.z = Math.sin(S.time * 0.7) * 0.02;
    S.boat.rotation.x = Math.sin(S.time * 0.55 + 1) * 0.015;
  }
  // The shadow camera only covers ±130 m, so the sun follows the action.
  if (S.sun) {
    const p = S.playerPos();
    S.sun.position.set(p.x - 260, 300, p.z - 130);
    S.sun.target.position.set(p.x, 0, p.z);
  }
}

/** Push a circle out of every building AABB it overlaps; returns the fixed point. */
export function collideCircle(x, z, radius) {
  for (const c of S.colliders) {
    if (c.pier) continue;
    if (x > c.minX - radius && x < c.maxX + radius && z > c.minZ - radius && z < c.maxZ + radius) {
      const pushLeft = x - (c.minX - radius);
      const pushRight = c.maxX + radius - x;
      const pushDown = z - (c.minZ - radius);
      const pushUp = c.maxZ + radius - z;
      const min = Math.min(pushLeft, pushRight, pushDown, pushUp);
      if (min === pushLeft) x = c.minX - radius;
      else if (min === pushRight) x = c.maxX + radius;
      else if (min === pushDown) z = c.minZ - radius;
      else z = c.maxZ + radius;
    }
  }
  return { x, z };
}

/** Is the point on drivable asphalt (within a lane's width of a centreline)? */
export function isOnRoad(x, z) {
  const half = CITY.asphaltWidth / 2 + 1;
  for (const c of S.roadCenters) {
    if (Math.abs(x - c) < half || Math.abs(z - c) < half) return true;
  }
  return false;
}

/** The closest road intersection to a point (used for spawns and staging). */
export function nearestIntersection(x, z) {
  let best = null;
  let bestDist = Infinity;
  for (const cx of S.roadCenters) {
    for (const cz of S.roadCenters) {
      const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
      if (d < bestDist) {
        bestDist = d;
        best = { x: cx, z: cz };
      }
    }
  }
  return best;
}

/** Clamp to the playable bounds; the pier deck is the only ground over water. */
export function clampToWorld(x, z) {
  const onPier = z > PLACES.pierEnd.z - 15 && z < PLACES.pierEnd.z + 15 && x > 356;
  const maxX = onPier ? 411 : CITY.shorelineX - 2;
  return {
    x: Math.max(CITY_BOUNDS.minX, Math.min(maxX, x)),
    z: Math.max(CITY_BOUNDS.minZ, Math.min(CITY_BOUNDS.maxZ, z)),
  };
}
