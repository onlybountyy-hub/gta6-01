// audio.js — the whole soundtrack is synthesised; there are no audio files.
//
// A WebAudio engine voice (two detuned oscillators through a lowpass, pitch and
// growl following speed), an LFO-swept siren, and a kit of one-shot voices —
// gunshot, punch, horn, crash, pickup, success and fail stings — built from
// noise bursts and shaped tones. A slow synthwave pad loops underneath. The
// context is created lazily on the first user gesture, as browsers require.

let ctx = null;
let master = null;
let muted = false;

let engineOsc = null;
let engineSub = null;
let engineGain = null;
let engineFilter = null;
let sirenOsc = null;
let sirenGain = null;
let ambientTimer = null;
let sharedNoise = null;

/** Create the context and the two persistent voices. Safe to call repeatedly. */
export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(ctx.destination);

  // Engine: saw + square sub through a lowpass. Idle is a murmur; speed opens it.
  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 55;
  engineSub = ctx.createOscillator();
  engineSub.type = 'square';
  engineSub.frequency.value = 28;
  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 300;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineSub.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(master);
  engineOsc.start();
  engineSub.start();

  // Siren: a triangle whose frequency an LFO sweeps between the two tones.
  sirenOsc = ctx.createOscillator();
  sirenOsc.type = 'triangle';
  sirenOsc.frequency.value = 800;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 0.7;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain);
  lfoGain.connect(sirenOsc.frequency);
  sirenGain = ctx.createGain();
  sirenGain.gain.value = 0;
  sirenOsc.connect(sirenGain);
  sirenGain.connect(master);
  sirenOsc.start();
  lfo.start();
}

/** Per-frame engine voice: loudness and pitch from the driven car (0 on foot). */
export function updateEngine(speedNorm, driving) {
  if (!ctx || !engineGain) return;
  const t = ctx.currentTime;
  engineGain.gain.setTargetAtTime(driving ? 0.05 + speedNorm * 0.075 : 0, t, 0.08);
  const freq = 52 + speedNorm * 165;
  engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
  engineSub.frequency.setTargetAtTime(freq * 0.5, t, 0.05);
  engineFilter.frequency.setTargetAtTime(240 + speedNorm * 900, t, 0.08);
}

/** Per-frame siren voice: volume follows the nearest cruiser (0 = silent). */
export function updateSiren(level) {
  if (!ctx || !sirenGain) return;
  sirenGain.gain.setTargetAtTime(Math.min(0.11, level), ctx.currentTime, 0.12);
}

function noiseBuffer() {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A filtered noise burst with an exponential decay — the thump of every impact. */
function burst({ duration = 0.15, filterFreq = 1200, type = 'lowpass', gain = 0.3, sweepTo = null }) {
  if (!ctx) return;
  if (!sharedNoise) sharedNoise = noiseBuffer();
  const src = ctx.createBufferSource();
  src.buffer = sharedNoise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start();
  src.stop(ctx.currentTime + duration + 0.02);
}

/** One shaped oscillator note: fast attack, exponential decay, optional glide. */
function tone({ freq = 440, end = null, duration = 0.2, type = 'sine', gain = 0.2, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (end) osc.frequency.exponentialRampToValueAtTime(end, t0 + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

export function playGunshot() {
  burst({ duration: 0.16, filterFreq: 3200, gain: 0.5, sweepTo: 300 });
  tone({ freq: 160, end: 55, duration: 0.1, type: 'square', gain: 0.16 });
}
export function playPunch() {
  burst({ duration: 0.09, filterFreq: 500, gain: 0.35 });
  tone({ freq: 110, end: 60, duration: 0.09, gain: 0.3 });
}
export function playHorn(long = false) {
  const duration = long ? 0.5 : 0.22;
  tone({ freq: 370, duration, type: 'square', gain: 0.07 });
  tone({ freq: 466, duration, type: 'square', gain: 0.06 });
}
export function playCrash(strength = 1) {
  burst({ duration: 0.28, filterFreq: 900, gain: 0.3 * strength, sweepTo: 120 });
  tone({ freq: 90, end: 40, duration: 0.22, gain: 0.25 * strength });
}
export function playPickup() {
  tone({ freq: 660, duration: 0.12, gain: 0.22 });
  tone({ freq: 990, duration: 0.2, gain: 0.22, delay: 0.09 });
}
export function playSuccessSting() {
  [523, 659, 784, 1047].forEach((freq, i) => tone({ freq, duration: 0.34, type: 'triangle', gain: 0.2, delay: i * 0.1 }));
}
export function playFailSting() {
  tone({ freq: 330, end: 220, duration: 0.4, type: 'triangle', gain: 0.2 });
  tone({ freq: 220, end: 147, duration: 0.55, type: 'triangle', gain: 0.2, delay: 0.16 });
}
export function playClick() {
  tone({ freq: 840, duration: 0.05, gain: 0.12 });
}

/** The ambient pad: a slow Am–F–C–G wash, one bar scheduled at a time. */
export function startAmbient() {
  if (!ctx || ambientTimer) return;
  const chords = [
    [110, 164.8, 261.6],
    [87.3, 130.8, 220],
    [98, 146.8, 246.9],
    [130.8, 196, 329.6],
  ];
  let bar = 0;
  const playBar = () => {
    if (!ctx) return;
    const chord = chords[bar % chords.length];
    bar += 1;
    for (const freq of chord) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.028, t + 1.4);
      g.gain.linearRampToValueAtTime(0.0001, t + 5.8);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 6);
    }
  };
  playBar();
  ambientTimer = setInterval(playBar, 5800);
}

/** Toggle mute (the M key). Returns the new muted state. */
export function toggleMute() {
  muted = !muted;
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.03);
  return muted;
}
export function isMuted() {
  return muted;
}
