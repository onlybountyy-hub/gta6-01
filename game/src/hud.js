// hud.js — the heads-up display: bars, stars, phone, prompts and minimap.
//
// All HUD elements live in index.html; this module only writes into them.
// The minimap is a 2D canvas redrawn each frame: streets as a light grid
// over dark ground, water to the south and east, the player as a white
// arrow, traffic as grey dots, police as flashing blue/red dots, enemies
// as red dots, and the current objective as a gold diamond. North is up
// and the map covers the whole city at a fixed scale so it doubles as a
// navigation chart, not just a radar.

import { CITY_EDGE } from './world.js';

export function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const minimap = el('minimap');
  const mm = minimap.getContext('2d');
  let toastTimer = 0;
  let phoneTimer = 0;

  function worldToMap(x, z) {
    const scale = 180 / 940;
    return { x: 90 + x * scale, y: 90 + z * scale };
  }

  return {
    show() {
      el('hud').classList.remove('hidden');
    },
    hide() {
      el('hud').classList.add('hidden');
    },
    toast(text, seconds = 3.2) {
      el('toast-box').textContent = text;
      toastTimer = seconds;
    },
    phone(text, seconds = 7) {
      el('phone-text').textContent = text;
      el('phone-box').classList.remove('hidden');
      phoneTimer = seconds;
    },
    prompt(text) {
      const node = el('prompt-label');
      if (text) {
        node.textContent = text;
        node.classList.remove('hidden');
      } else {
        node.classList.add('hidden');
      }
    },
    // The side-activity line (taxi fares, stash drops): same pattern as
    // the prompt, on its own element so the two never fight.
    side(text) {
      const node = el('side-label');
      if (!node) return;
      if (text) {
        node.textContent = text;
        node.classList.remove('hidden');
      } else {
        node.classList.add('hidden');
      }
    },
    update(dt, snap) {
      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0) el('toast-box').textContent = '';
      }
      if (phoneTimer > 0) {
        phoneTimer -= dt;
        if (phoneTimer <= 0) el('phone-box').classList.add('hidden');
      }
      el('health-bar').style.width = Math.max(0, snap.health) + '%';
      el('health-text').textContent = Math.ceil(Math.max(0, snap.health)) + '';
      el('cash-label').textContent = '$' + snap.cash.toLocaleString('en-US');
      el('wanted-stars').textContent = '★'.repeat(snap.stars) + '☆'.repeat(5 - snap.stars);
      el('mission-title').textContent = snap.objective.title;
      // Append the live distance to the objective so the gold marker is
      // not the only navigation aid on a cross-city run.
      let missionText = snap.objective.text;
      if (snap.objective.target && snap.playing) {
        const dx = snap.objective.target.x - snap.playerPos.x;
        const dz = snap.objective.target.z - snap.playerPos.z;
        missionText += ` · ${Math.round(Math.sqrt(dx * dx + dz * dz))}m`;
      }
      el('mission-text').textContent = missionText;
      el('mission-timer').textContent = snap.timer > 0 ? Math.ceil(snap.timer) + 's' : '';
      el('crosshair').classList.toggle('hidden', !(snap.onFoot && snap.playing));
      const bust = el('bust-wrap');
      if (snap.bust > 0.02) {
        bust.classList.remove('hidden');
        el('bust-bar').style.width = Math.round(snap.bust * 100) + '%';
      } else {
        bust.classList.add('hidden');
      }
      el('speed-label').textContent = snap.speedKmh > 1 ? Math.round(snap.speedKmh) + ' km/h' : '';
      this.drawMinimap(snap);
    },
    drawMinimap(snap) {
      mm.fillStyle = '#274b3a';
      mm.fillRect(0, 0, 180, 180);
      // Water south and east.
      mm.fillStyle = '#1d7a8c';
      const south = worldToMap(0, 330);
      mm.fillRect(0, south.y, 180, 180 - south.y);
      const east = worldToMap(330, 0);
      mm.fillRect(east.x, 0, 180 - east.x, 180);
      // Street grid.
      mm.strokeStyle = 'rgba(255,247,234,0.5)';
      mm.lineWidth = 1.4;
      for (let i = 0; i <= 12; i++) {
        const c = -286 + i * 52;
        const a = worldToMap(c, -CITY_EDGE);
        const b = worldToMap(c, CITY_EDGE);
        mm.beginPath();
        mm.moveTo(a.x, a.y);
        mm.lineTo(b.x, b.y);
        mm.stroke();
        const c2 = worldToMap(-CITY_EDGE, c);
        const d2 = worldToMap(CITY_EDGE, c);
        mm.beginPath();
        mm.moveTo(c2.x, c2.y);
        mm.lineTo(d2.x, d2.y);
        mm.stroke();
      }
      // Traffic dots.
      mm.fillStyle = '#b8b0a0';
      for (const car of snap.trafficCars) {
        const p = worldToMap(car.pos.x, car.pos.z);
        mm.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      // Police dots, strobing.
      mm.fillStyle = Math.floor(performance.now() / 220) % 2 ? '#ff4444' : '#4488ff';
      for (const car of snap.policeCars) {
        const p = worldToMap(car.pos.x, car.pos.z);
        mm.beginPath();
        mm.arc(p.x, p.y, 3, 0, Math.PI * 2);
        mm.fill();
      }
      // Enemies.
      mm.fillStyle = '#ff2222';
      for (const e of snap.enemies) {
        if (e.dead) continue;
        const p = worldToMap(e.pos.x, e.pos.z);
        mm.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      // Hidden packages still out there: tiny green squares.
      if (snap.packages) {
        mm.fillStyle = '#7dff9a';
        for (const pack of snap.packages) {
          if (pack.taken) continue;
          const p = worldToMap(pack.x, pack.z);
          mm.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        }
      }
      // Objective diamond.
      if (snap.objective.target) {
        const p = worldToMap(snap.objective.target.x, snap.objective.target.z);
        mm.fillStyle = '#ffd23c';
        mm.save();
        mm.translate(p.x, p.y);
        mm.rotate(Math.PI / 4);
        mm.fillRect(-4, -4, 8, 8);
        mm.restore();
      }
      // Side-activity targets: a cyan diamond for the taxi fare (pickup
      // or destination), an orange ring for a live stash drop.
      if (snap.fareTarget) {
        const p = worldToMap(snap.fareTarget.x, snap.fareTarget.z);
        mm.fillStyle = '#2ec4b6';
        mm.save();
        mm.translate(p.x, p.y);
        mm.rotate(Math.PI / 4);
        mm.fillRect(-3.5, -3.5, 7, 7);
        mm.restore();
      }
      if (snap.eventTarget) {
        const p = worldToMap(snap.eventTarget.x, snap.eventTarget.z);
        mm.strokeStyle = '#ff8c42';
        mm.lineWidth = 2;
        mm.beginPath();
        mm.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        mm.stroke();
      }
      // Street-race target: a magenta diamond (start gate when idle,
      // the live checkpoint while the sprint is running).
      if (snap.raceTarget) {
        const p = worldToMap(snap.raceTarget.x, snap.raceTarget.z);
        mm.fillStyle = '#ff5ad0';
        mm.save();
        mm.translate(p.x, p.y);
        mm.rotate(Math.PI / 4);
        mm.fillRect(-3.5, -3.5, 7, 7);
        mm.restore();
      }
      // Player arrow.
      const pp = worldToMap(snap.playerPos.x, snap.playerPos.z);
      mm.save();
      mm.translate(pp.x, pp.y);
      mm.rotate(snap.playerHeading);
      mm.fillStyle = '#ffffff';
      mm.beginPath();
      mm.moveTo(0, -6);
      mm.lineTo(4, 5);
      mm.lineTo(-4, 5);
      mm.closePath();
      mm.fill();
      mm.restore();
    },
  };
}
