// PROTOCOL 17 — audio engine (Web Audio) + voice DSP profiles
// Safety: master output stays <= 0.75. No sudden spikes. No jumpscare stingers.

import { horrorState } from "./state.js";
import { rand, clamp, prefersReducedMotion } from "./utils.js";

let ctx = null;
let master = null;
let limiter = null;
let ambienceBus = null;
let voiceBus = null;
let noiseBuffer = null;
let brownBuffer = null;
let ambienceNodes = [];
let ambienceGain = null;
let startedKinds = new Set();
let unlocked = false;

const MASTER_BASE = 0.62;

function makeNoiseBuffer(context, seconds = 2) {
  const len = Math.floor(context.sampleRate * seconds);
  const buf = context.createBuffer(1, len, context.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function makeBrownBuffer(context, seconds = 3) {
  const len = Math.floor(context.sampleRate * seconds);
  const buf = context.createBuffer(1, len, context.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2;
  }
  return buf;
}

// tiny procedural "small room" impulse
function makeRoomIR(context, seconds = 0.35) {
  const len = Math.floor(context.sampleRate * seconds);
  const buf = context.createBuffer(2, len, context.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * 0.4;
    }
  }
  return buf;
}

// quantization curve for the "broken" bit-reduction simulation
function bitReduceCurve(bits = 5) {
  const n = 2048;
  const curve = new Float32Array(n);
  const levels = Math.pow(2, bits);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

export const audio = {
  get ready() {
    return unlocked && ctx !== null;
  },

  get context() {
    return ctx;
  },

  async unlock() {
    if (unlocked) {
      if (ctx.state === "suspended") await ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();

      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 8;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.18;

      master = ctx.createGain();
      master.gain.value = horrorState.soundOn ? MASTER_BASE : 0;

      master.connect(limiter);
      limiter.connect(ctx.destination);

      ambienceBus = ctx.createGain();
      ambienceBus.gain.value = 0.9;
      ambienceBus.connect(master);

      voiceBus = ctx.createGain();
      voiceBus.gain.value = 1;
      voiceBus.connect(master);

      ambienceGain = ctx.createGain();
      ambienceGain.gain.value = 1;
      ambienceGain.connect(ambienceBus);

      noiseBuffer = makeNoiseBuffer(ctx);
      brownBuffer = makeBrownBuffer(ctx);

      if (ctx.state === "suspended") await ctx.resume();
      unlocked = true;
      horrorState.audioUnlocked = true;
      return true;
    } catch (err) {
      console.warn("[p17] audio unlock failed", err);
      return false;
    }
  },

  setMuted(muted) {
    horrorState.soundOn = !muted;
    if (master) {
      master.gain.setTargetAtTime(
        muted ? 0 : MASTER_BASE,
        ctx.currentTime,
        0.08
      );
    }
    this.stopAmbience();
    if (!muted && horrorState.level > 12) this.startAmbience("room");
  },

  /* ---------------- DSP profiles ---------------- */

  buildProfile(name = "A") {
    if (!unlocked) return null;
    const input = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    const lp = ctx.createBiquadFilter();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    let delay = null;
    let delayGain = null;
    let convolver = null;
    let shaper = null;
    let lfo = null;
    let lfoGain = null;

    hp.type = "highpass";
    lp.type = "lowpass";
    let head = input;

    switch (name) {
      case "A": // CLEAN
        input.gain.value = 0.65;
        hp.frequency.value = 60;
        lp.frequency.value = 10000;
        input.connect(hp);
        hp.connect(lp);
        head = lp;
        break;

      case "B": // CLOSE
        input.gain.value = 0.55;
        hp.frequency.value = 60;
        lp.frequency.value = 7000;
        input.connect(hp);
        hp.connect(lp);
        convolver = ctx.createConvolver();
        convolver.buffer = makeRoomIR(ctx, 0.3);
        const wet = ctx.createGain();
        wet.gain.value = 0.12;
        lp.connect(out);
        lp.connect(convolver);
        convolver.connect(wet);
        wet.connect(out);
        head = null;
        break;

      case "C": // UNSTABLE
        input.gain.value = 0.55;
        hp.frequency.value = 60;
        lp.frequency.value = 4800;
        input.connect(hp);
        hp.connect(lp);
        delay = ctx.createDelay(0.5);
        delay.delayTime.value = rand(0.05, 0.09);
        delayGain = ctx.createGain();
        delayGain.gain.value = 0.14;
        lp.connect(delay);
        delay.connect(delayGain);
        delayGain.connect(delay);
        delayGain.connect(out);
        if (pan) {
          lfo = ctx.createOscillator();
          lfo.frequency.value = 0.07;
          lfoGain = ctx.createGain();
          lfoGain.gain.value = 0.15;
          lfo.connect(lfoGain);
          lfoGain.connect(pan.pan);
          lfo.start();
        }
        head = lp;
        break;

      case "D": // BROKEN (rare)
        input.gain.value = 0.55;
        hp.frequency.value = 90;
        lp.frequency.value = 3000;
        shaper = ctx.createWaveShaper();
        shaper.curve = bitReduceCurve(4);
        shaper.oversample = "none";
        input.connect(hp);
        hp.connect(lp);
        lp.connect(shaper);
        shaper.connect(out);
        head = null;
        break;

      case "E": // FINAL CLEAN
      default:
        input.gain.value = 0.65;
        hp.frequency.value = 50;
        lp.frequency.value = 12000;
        input.connect(hp);
        hp.connect(lp);
        head = lp;
        break;
    }

    if (head) head.connect(pan || out);
    if (pan && head) pan.connect(out);
    out.connect(voiceBus);

    return {
      name,
      input,
      out,
      pan,
      startDropouts(duration) {
        if (name !== "D" || prefersReducedMotion()) return () => {};
        const g = input.gain;
        const base = 0.55;
        const events = [];
        const count = Math.max(2, Math.floor(duration / 0.6));
        for (let i = 0; i < count; i++) {
          const t = rand(0.15, Math.max(0.2, duration - 0.15));
          const len = rand(0.03, 0.08);
          events.push(
            setTimeout(() => {
              g.setValueAtTime(0.0001, ctx.currentTime);
              g.setTargetAtTime(base, ctx.currentTime + len, 0.01);
            }, t * 1000)
          );
        }
        return () => events.forEach(clearTimeout);
      },
      dispose() {
        if (lfo) try { lfo.stop(); } catch {}
        try {
          out.disconnect();
        } catch {}
      }
    };
  },

  /* ---------------- playback ---------------- */

  // pcm: Float32Array mono, sampleRate: number
  bufferFromPCM(pcm, sampleRate) {
    const buf = ctx.createBuffer(1, pcm.length, sampleRate);
    buf.copyToChannel(pcm, 0);
    return buf;
  },

  playBuffer(buffer, profileName = "A", { pan = null } = {}) {
    if (!unlocked || !buffer) return null;
    const profile = this.buildProfile(profileName);
    if (!profile) return null;
    if (pan !== null && pan !== undefined && profile.pan) {
      profile.pan.pan.value = pan;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(profile.input);

    let cancelDropouts = () => {};
    try {
      cancelDropouts = profile.startDropouts(buffer.duration) || (() => {});
    } catch {}

    src.start();

    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        try {
          src.stop();
        } catch {}
        cancelDropouts();
        setTimeout(() => profile.dispose(), 60);
      },
      get duration() {
        return buffer ? buffer.duration : 0;
      },
      onended(fn) {
        src.onended = () => {
          cancelDropouts();
          setTimeout(() => profile.dispose(), 60);
          fn();
        };
      }
    };
  },

  /* ---------------- ambience (procedural, safe levels) ---------------- */

  startAmbience(kind = "room") {
    if (!unlocked || !ambienceGain || startedKinds.has(kind)) return;
    startedKinds.add(kind);

    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(ambienceGain);

    if (kind === "room" || kind === "both") {
      const src = ctx.createBufferSource();
      src.buffer = brownBuffer;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 220;
      const lvl = ctx.createGain();
      lvl.gain.value = 0.06;
      src.connect(lp);
      lp.connect(lvl);
      lvl.connect(g);
      src.start();
      ambienceNodes.push(src, lp, lvl);
    }

    if (kind === "hum" || kind === "both") {
      const o1 = ctx.createOscillator();
      o1.frequency.value = 50;
      const o2 = ctx.createOscillator();
      o2.frequency.value = 100;
      const lvl = ctx.createGain();
      lvl.gain.value = 0.012;
      const lvl2 = ctx.createGain();
      lvl2.gain.value = 0.006;
      o1.connect(lvl);
      o2.connect(lvl2);
      lvl.connect(g);
      lvl2.connect(g);
      o1.start();
      o2.start();
      ambienceNodes.push(o1, o2, lvl, lvl2);
    }

    g.gain.setTargetAtTime(1, ctx.currentTime, 1.6);
    ambienceNodes.push(g);
  },

  setAmbienceLevel(v) {
    if (!unlocked || !ambienceGain) return;
    ambienceGain.gain.setTargetAtTime(clamp(v, 0, 1.4), ctx.currentTime, 0.5);
  },

  stopAmbience() {
    for (const n of ambienceNodes) {
      try {
        if (typeof n.stop === "function") n.stop();
        n.disconnect();
      } catch {}
    }
    ambienceNodes = [];
    startedKinds = new Set();
  },

  staticBurst(duration = 0.22) {
    if (!unlocked || !horrorState.soundOn) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(bp);
    bp.connect(g);
    g.connect(ambienceBus);
    src.start();
    src.stop(ctx.currentTime + duration + 0.05);
  },

  impactLow() {
    if (!unlocked || !horrorState.soundOn) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(72, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(34, ctx.currentTime + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    o.connect(g);
    g.connect(ambienceBus);
    o.start();
    o.stop(ctx.currentTime + 0.85);
  }
};
