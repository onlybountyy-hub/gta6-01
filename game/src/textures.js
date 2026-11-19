// textures.js — every texture in Solano Heat is painted on a canvas at boot: asphalt
// with lane paint, sun-bleached pavement, lit building facades, palm fronds, sand,
// harbour water and crate wood. No image files are loaded, which keeps the game fully
// offline and the file count tiny.

import * as THREE from 'three';
import { makeRng } from './random.js';

function canvasTexture(width, height, painter, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  painter(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Speckle noise over a base colour, the cheapest way to make flat fills feel real. */
function speckle(ctx, width, height, rng, base, flecks, count, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = flecks[Math.floor(rng() * flecks.length)];
    ctx.globalAlpha = alpha * (0.4 + rng() * 0.6);
    ctx.fillRect(rng() * width, rng() * height, 1 + rng() * 3, 1 + rng() * 3);
  }
  ctx.globalAlpha = 1;
}

/**
 * One road tile: sidewalks on both edges, asphalt in the middle, a dashed centre line.
 * The tile is drawn so it repeats along the road's length (the V axis).
 */
export function makeRoadTexture() {
  const rng = makeRng(41);
  return canvasTexture(256, 256, (ctx, w, h) => {
    // Sidewalks across the whole tile first.
    speckle(ctx, w, h, rng, '#b8ab98', ['#a89a85', '#c9bca6', '#9c8d76'], 500, 0.25);
    // Asphalt band in the middle 60%, speckled inside a clip so it stays off the walks.
    const x0 = w * 0.2;
    const x1 = w * 0.8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0, h);
    ctx.clip();
    ctx.translate(x0, 0);
    speckle(ctx, x1 - x0, h, rng, '#3c3f45', ['#33363c', '#484b52', '#2e3036'], 1200, 0.35);
    ctx.restore();
    // Curb lines.
    ctx.fillStyle = '#e8e2d4';
    ctx.fillRect(x0 - 3, 0, 3, h);
    ctx.fillRect(x1, 0, 3, h);
    // Centre dashes.
    ctx.fillStyle = '#f7c948';
    ctx.fillRect(w / 2 - 2, 10, 4, 70);
    // Sidewalk joints.
    ctx.strokeStyle = 'rgba(90,80,66,0.5)';
    ctx.lineWidth = 2;
    for (const x of [w * 0.1, w * 0.9]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.2, 0);
    ctx.moveTo(w * 0.8, 0);
    ctx.lineTo(w, 0);
    ctx.stroke();
  });
}

/** Plain city-block ground: warm concrete with expansion joints. */
export function makePavementTexture() {
  const rng = makeRng(97);
  return canvasTexture(256, 256, (ctx, w, h) => {
    speckle(ctx, w, h, rng, '#a99c86', ['#9c8d76', '#b7a98f', '#8f8168'], 700, 0.3);
    ctx.strokeStyle = 'rgba(80,70,55,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  });
}

/** Beach sand with soft ripples. */
export function makeSandTexture() {
  const rng = makeRng(7);
  return canvasTexture(256, 256, (ctx, w, h) => {
    speckle(ctx, w, h, rng, '#e8cd93', ['#dec284', '#f2dca6', '#d4b878'], 900, 0.3);
    ctx.strokeStyle = 'rgba(190,160,105,0.35)';
    ctx.lineWidth = 2;
    for (let y = 16; y < h; y += 32) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.11 + y) * 3);
      ctx.stroke();
    }
  });
}

/** Harbour water: deep teal with lighter wave streaks; the offset scrolls at runtime. */
export function makeWaterTexture() {
  const rng = makeRng(23);
  return canvasTexture(256, 256, (ctx, w, h) => {
    speckle(ctx, w, h, rng, '#155e6b', ['#0f4c59', '#1c6d7a', '#22707f'], 500, 0.3);
    ctx.strokeStyle = 'rgba(140,225,235,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 26; i += 1) {
      const y = rng() * h;
      const x = rng() * w;
      const len = 14 + rng() * 42;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(Math.min(w, x + len), y + (rng() - 0.5) * 3);
      ctx.stroke();
    }
  });
}

/**
 * A building facade: coloured render with a grid of windows, some of them lit by the
 * evening sun. `variant` picks the palette so the skyline does not repeat itself.
 */
export function makeFacadeTexture(variant, baseColor) {
  const rng = makeRng(1000 + variant * 131);
  return canvasTexture(256, 512, (ctx, w, h) => {
    speckle(ctx, w, h, rng, baseColor, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.10)'], 500, 0.25);
    const cols = 6;
    const rows = 14;
    const winW = w / cols;
    const winH = h / rows;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const lit = rng() < 0.34;
        ctx.fillStyle = lit ? '#ffd98c' : '#22384c';
        ctx.fillRect(c * winW + 5, r * winH + 6, winW - 10, winH - 12);
        ctx.fillStyle = 'rgba(255,255,255,0.20)';
        ctx.fillRect(c * winW + 5, r * winH + 6, winW - 10, 3);
      }
    }
    // Awnings / shop band at street level for low variants.
    if (variant % 2 === 0) {
      ctx.fillStyle = 'rgba(146,64,44,0.85)';
      ctx.fillRect(0, h - winH * 1.4, w, winH * 0.5);
    }
  });
}

/** Palm frond: one long tapered leaf drawn with alpha, used on crossed planes. */
export function makeFrondTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#2e7d46';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(4, h - 4);
    ctx.quadraticCurveTo(w * 0.5, h * 0.25, w - 4, h * 0.55);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#359754';
    for (let i = 0; i < 12; i += 1) {
      const t = i / 12;
      const x = 4 + (w - 8) * t;
      const y = h - 4 - Math.sin(t * 2.4) * h * 0.42;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 9, y + 13);
      ctx.stroke();
    }
  });
}

/** Weathered crate wood with a stencilled edge. */
export function makeCrateTexture() {
  const rng = makeRng(55);
  return canvasTexture(128, 128, (ctx, w, h) => {
    speckle(ctx, w, h, rng, '#9a7443', ['#8a6538', '#ab8552'], 350, 0.3);
    ctx.strokeStyle = '#6f5227';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.moveTo(w, 0);
    ctx.lineTo(0, h);
    ctx.lineWidth = 3;
    ctx.stroke();
  });
}

/** Soft radial glow sprite, used for lamps, the sun glare and muzzle flashes. */
export function makeGlowTexture() {
  const texture = canvasTexture(128, 128, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/** The sunset sky: a vertical gradient from deep blue to hot orange at the horizon. */
export function makeSkyTexture() {
  const texture = canvasTexture(64, 512, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1d3a63');
    grad.addColorStop(0.42, '#4a6ea6');
    grad.addColorStop(0.62, '#c96f4a');
    grad.addColorStop(0.74, '#ff9a56');
    grad.addColorStop(0.8, '#ffc37e');
    grad.addColorStop(1, '#7a4a3a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
