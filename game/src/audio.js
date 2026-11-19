// audio.js — all sound in SOLANO HEAT is synthesized with WebAudio.
//
// There are no audio assets: effects are short oscillator/noise envelopes
// (gunshot, hit, pickup, cash register, siren wail, engine hum, UI blips)
// and the music is a tiny looping bass-and-pluck pattern scheduled from a
// lookahead timer. Everything is created lazily on the first user gesture
// so the browser autoplay policy is respected, and every entry point is
// safe to call before the context exists (it simply stays silent).

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicTimer = null;
  let musicStep = 0;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type = 'square', vol = 0.2, slideTo = null, delay = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol = 0.3, freq = 1200, delay = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  // Band-passed noise: tyre screech and wind gusts live here, where a
  // lowpass would sound like a rumble instead of a wail.
  function noiseBand(dur, vol = 0.2, freq = 900, delay = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 2.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  // --- ambience -------------------------------------------------------------
  // A permanent soft wind bed (looped noise through a low filter, gain
  // breathing on a slow LFO) plus a bird-chirp scheduler. Started once
  // with the music; both layers sit far under the action sounds.
  let ambienceStarted = false;
  function startAmbience() {
    if (!ensure() || ambienceStarted) return;
    ambienceStarted = true;
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.value = 0.016;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.09;
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    lfo.start();
    // Gulls and sparrows: two or three descending sine blips, only ever
    // in the gaps — a coin flip every few seconds keeps them sparse.
    setInterval(() => {
      if (!ctx || Math.random() > 0.45) return;
      const base = 2100 + Math.random() * 900;
      tone(base, 0.09, 'sine', 0.028, base * 0.72);
      tone(base * 1.1, 0.08, 'sine', 0.024, base * 0.8, 0.13);
      if (Math.random() > 0.5) tone(base * 0.95, 0.07, 'sine', 0.02, base * 0.7, 0.26);
    }, 3400);
  }

  // A cheerful two-bar loop: bass notes under a sparse pluck melody, in a
  // sun-soaked major key. Scheduled note-by-note so it can stop cleanly.
  const BASS = [110, 110, 130.8, 98, 110, 110, 164.8, 146.8];
  const PLUCK = [440, 0, 523, 0, 659, 0, 523, 392, 440, 0, 523, 0, 587, 659, 0, 0];
  function scheduleStep() {
    if (!ctx) return;
    const i = musicStep % 16;
    const bass = BASS[Math.floor(i / 2) % BASS.length];
    if (i % 2 === 0) tone(bass, 0.32, 'triangle', 0.16);
    const pluck = PLUCK[i];
    if (pluck) tone(pluck, 0.18, 'sine', 0.07);
    if (i % 4 === 2) noise(0.05, 0.03, 6000);
    musicStep += 1;
  }

  return {
    unlock() {
      ensure();
    },
    startMusic() {
      if (!ensure() || musicTimer) return;
      musicStep = 0;
      scheduleStep();
      musicTimer = setInterval(scheduleStep, 240);
      startAmbience();
    },
    stopMusic() {
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = null;
    },
    shot() {
      noise(0.12, 0.4, 2600);
      tone(160, 0.1, 'square', 0.22, 60);
    },
    dryFire() {
      tone(900, 0.04, 'square', 0.08);
    },
    hit() {
      noise(0.08, 0.25, 900);
    },
    hurt() {
      tone(220, 0.16, 'sawtooth', 0.2, 110);
    },
    cash() {
      tone(880, 0.09, 'square', 0.14);
      tone(1318, 0.14, 'square', 0.14, null, 0.08);
    },
    pickup() {
      tone(660, 0.08, 'sine', 0.16);
      tone(990, 0.12, 'sine', 0.16, null, 0.07);
    },
    phoneBuzz() {
      tone(140, 0.09, 'square', 0.1);
      tone(140, 0.09, 'square', 0.1, null, 0.14);
    },
    carDoor() {
      noise(0.07, 0.2, 700);
    },
    crash() {
      noise(0.25, 0.4, 500);
      tone(90, 0.2, 'sawtooth', 0.2, 40);
    },
    honk() {
      // A short two-tone car horn, quiet enough to layer in traffic.
      tone(392, 0.16, 'square', 0.05);
      tone(494, 0.16, 'square', 0.04);
    },
    screech() {
      noiseBand(0.32, 0.11, 950 + Math.random() * 250);
    },
    splash() {
      noise(0.3, 0.12, 700);
    },
    checkpoint() {
      tone(784, 0.1, 'sine', 0.16);
      tone(1046, 0.16, 'sine', 0.16, null, 0.09);
    },
    fail() {
      tone(392, 0.2, 'sawtooth', 0.16);
      tone(311, 0.2, 'sawtooth', 0.16, null, 0.18);
      tone(233, 0.34, 'sawtooth', 0.16, null, 0.36);
    },
    setEngine(speedRatio, active) {
      if (!ensure()) return;
      if (active && !engineOsc) {
        // Two oscillators: the saw carries the revs, a triangle an
        // octave-plus below gives the note some chest. Both run through
        // one lowpass so the top end stays muffled like a real cabin.
        engineOsc = ctx.createOscillator();
        engineOsc.type = 'sawtooth';
        const sub = ctx.createOscillator();
        sub.type = 'triangle';
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 900;
        engineGain = ctx.createGain();
        engineGain.gain.value = 0.0;
        const subGain = ctx.createGain();
        subGain.gain.value = 0.5;
        engineOsc.connect(filter);
        sub.connect(subGain);
        subGain.connect(filter);
        filter.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
        sub.start();
        engineOsc.userData = { sub, filter };
      }
      if (engineOsc) {
        const r = Math.abs(speedRatio);
        engineOsc.frequency.value = 55 + r * 130;
        engineOsc.userData.sub.frequency.value = 28 + r * 62;
        engineOsc.userData.filter.frequency.value = 700 + r * 900;
        engineGain.gain.value = active ? 0.05 + r * 0.05 : 0.0;
      }
    },
    setSiren(active) {
      if (!ensure()) return;
      if (active && !sirenOsc) {
        sirenOsc = ctx.createOscillator();
        sirenGain = ctx.createGain();
        sirenOsc.type = 'triangle';
        sirenGain.gain.value = 0.028;
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 0.7;
        lfoGain.gain.value = 180;
        lfo.connect(lfoGain);
        lfoGain.connect(sirenOsc.frequency);
        sirenOsc.frequency.value = 760;
        sirenOsc.connect(sirenGain);
        sirenGain.connect(master);
        sirenOsc.start();
        lfo.start();
        sirenOsc.userData = { lfo };
      }
      if (!active && sirenOsc) {
        try {
          sirenOsc.stop();
          sirenOsc.userData.lfo.stop();
        } catch { /* already stopped */ }
        sirenOsc = null;
        sirenGain = null;
      }
    },
  };
}
