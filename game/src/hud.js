// hud.js — everything drawn over the 3D view: health and cash, wanted stars, the
// weapon tag, objective line, toasts, dialogue box, mission banners, the bust meter,
// and the canvas minimap (roads, beach, traffic dots, police blips, the objective
// marker and the player's arrow). DOM elements are declared in index.html; this
// file only reads game state and paints.

import { CITY } from './config.js';
import { S } from './state.js';

const el = {};
let lastNotifyRender = '';
let minimapCtx = null;

export function initHud() {
  for (const id of [
    'hud', 'healthFill', 'cash', 'stars', 'weapon', 'objective', 'notify', 'dialogue',
    'dlgWho', 'dlgText', 'prompt', 'banner', 'bannerTitle', 'bannerSub', 'bustWrap',
    'bustFill', 'crosshair', 'vignette', 'minimap', 'speedo',
  ]) {
    el[id] = document.getElementById(id);
  }
  minimapCtx = el.minimap ? el.minimap.getContext('2d') : null;
}

export function setHudVisible(visible) {
  if (el.hud) el.hud.style.display = visible ? 'block' : 'none';
}

/** World → minimap coordinates. The map spans x [-345, 435], z [-345, 345]. */
function mapPoint(x, z, w, h) {
  return [((x + 345) / 780) * w, ((z + 345) / 690) * h];
}

function drawMinimap() {
  if (!minimapCtx) return;
  const ctx = minimapCtx;
  const w = el.minimap.width;
  const h = el.minimap.height;
  // Land, beach and sea.
  ctx.fillStyle = '#24303c';
  ctx.fillRect(0, 0, w, h);
  const [shoreX] = mapPoint(CITY.shorelineX, 0, w, h);
  ctx.fillStyle = '#17607a';
  ctx.fillRect(shoreX, 0, w - shoreX, h);
  const [beachX] = mapPoint(CITY.beachStartX, 0, w, h);
  ctx.fillStyle = '#c9ab72';
  ctx.fillRect(beachX, 0, shoreX - beachX, h);
  // Roads.
  ctx.strokeStyle = 'rgba(210,200,180,0.55)';
  ctx.lineWidth = 2;
  for (const c of S.roadCenters) {
    const [vx] = mapPoint(c, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(vx, 0);
    ctx.lineTo(vx, h);
    ctx.stroke();
    const [, hz] = mapPoint(0, c, w, h);
    ctx.beginPath();
    ctx.moveTo(0, hz);
    ctx.lineTo(w, hz);
    ctx.stroke();
  }
  // Traffic as pale dots.
  ctx.fillStyle = 'rgba(230,230,230,0.75)';
  for (const v of S.vehicles) {
    if (v.ai && v.ai.role === 'police') continue;
    const [x, y] = mapPoint(v.x, v.z, w, h);
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  // Police as red blips (they matter most when the stars are lit).
  for (const v of S.vehicles) {
    if (!v.ai || v.ai.role !== 'police') continue;
    const [x, y] = mapPoint(v.x, v.z, w, h);
    ctx.fillStyle = Math.floor(S.time * 3) % 2 ? '#ff4444' : '#ff9a9a';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Pedestrians as faint specks.
  ctx.fillStyle = 'rgba(255,220,170,0.5)';
  for (const ped of S.peds) {
    if (ped.dead) continue;
    const [x, y] = mapPoint(ped.x, ped.z, w, h);
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  // Objective marker, pulsing gold.
  if (S.objective) {
    const [x, y] = mapPoint(S.objective.x, S.objective.z, w, h);
    const r = 4.5 + Math.sin(S.time * 4) * 1.3;
    ctx.strokeStyle = '#ffc94d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffc94d';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // The player: a white arrow on the facing.
  const p = S.playerPos();
  const heading = S.player.inVehicle ? S.player.inVehicle.heading : S.player.heading;
  const [px, py] = mapPoint(p.x, p.z, w, h);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.PI - heading); // canvas y is +z (south), so north-facing is a half turn
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(0, 2.6);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Frame + north tick.
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px system-ui';
  ctx.fillText('N', w - 13, 12);
}

/** Refresh every HUD element from state. Called each frame by main.js. */
export function updateHud() {
  if (!el.hud) return;
  const p = S.player;
  el.healthFill.style.width = `${Math.max(0, p.health)}%`;
  el.healthFill.style.background = p.health > 35 ? '#57c84d' : '#d43a2a';
  el.cash.textContent = `$${S.cash.toLocaleString('en-US')}`;
  const stars = S.wanted.stars;
  el.stars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  el.stars.style.color = stars > 0 ? '#ffc94d' : 'rgba(255,255,255,0.35)';
  el.stars.style.textShadow = stars > 0 ? '0 0 9px rgba(255,180,0,0.8)' : 'none';
  el.weapon.textContent = p.inVehicle ? '🚗' : p.gunDrawn ? 'PISTOL' : 'FISTS';
  el.objective.textContent = S.objectiveText || '';
  el.prompt.textContent = S.prompt || '';
  el.crosshair.style.display = p.gunDrawn && !p.inVehicle ? 'block' : 'none';
  el.speedo.textContent = p.inVehicle ? `${Math.round(Math.abs(p.inVehicle.speed) * 3.6)} km/h` : '';

  // Bust meter.
  const bust = S.wanted.bustProgress;
  el.bustWrap.style.display = bust > 0.02 ? 'block' : 'none';
  el.bustFill.style.width = `${bust * 100}%`;

  // Damage vignette fades over a second after a hit.
  const sinceHit = S.time - p.lastDamageAt;
  el.vignette.style.opacity = sinceHit < 1 ? String(0.55 * (1 - sinceHit)) : '0';

  // Dialogue box.
  if (S.dialogue) {
    const line = S.dialogue.lines[S.dialogue.index];
    el.dialogue.style.display = 'block';
    el.dlgWho.textContent = line.who;
    el.dlgText.textContent = line.text;
  } else {
    el.dialogue.style.display = 'none';
  }

  // Mission banner.
  if (S.banner && S.time < S.banner.until) {
    el.banner.style.display = 'block';
    el.bannerTitle.textContent = S.banner.title;
    el.bannerSub.textContent = S.banner.sub;
  } else {
    el.banner.style.display = 'none';
  }

  // Toasts: rebuild only when the visible set changes.
  const visible = S.notifications.filter((n) => S.time - n.at < 4.2);
  const renderKey = visible.map((n) => n.text).join('|');
  if (renderKey !== lastNotifyRender) {
    lastNotifyRender = renderKey;
    el.notify.innerHTML = visible
      .map((n) => `<div class="toast ${n.kind}">${n.text}</div>`)
      .join('');
  }

  drawMinimap();
}
