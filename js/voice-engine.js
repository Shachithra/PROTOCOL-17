// PROTOCOL 17 — AI voice engine (Kokoro-82M ONNX in a Web Worker)
// WebGPU preferred, WASM fallback. If neither is reachable, the engine
// degrades to the browser's built-in speech synthesis (a real capability —
// nothing is faked). Never two lines at once. Silence is part of the score.

import { horrorState, emit } from "./state.js";
import { audio } from "./audio-engine.js";
import { wait } from "./utils.js";

const KOKORO_URLS = [
  "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.js",
  "https://esm.sh/kokoro-js@1.2.1",
  "./vendor/kokoro-js.js"
];

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// calm, low-energy preference order; anything available is fine
const VOICE_PREFS = ["am_michael", "bm_george", "am_adam", "bm_lewis"];

export const voice = {
  status: "off", // off | loading | available | fallback | failed
  worker: null,
  workerReady: false,
  chosenVoice: null,
  queue: [],
  speaking: false,
  currentHandle: null,
  currentUtterance: null,
  lastSpokeAt: 0,
  defaultGapMs: 4000,
  activeProfile: "A",
  lineCounter: 0,
  listenersBound: false,

  init() {
    if (this.worker) return;
    const device =
      typeof navigator !== "undefined" && "gpu" in navigator
        ? "webgpu"
        : "wasm";

    this.setStatus("loading");

    try {
      this.worker = new Worker("./workers/tts-worker.js", {
        type: "module"
      });
    } catch (err) {
      console.warn("[p17] module worker unavailable", err);
      this.setStatus("failed");
      return;
    }

    this.worker.onmessage = (e) => this.onWorkerMessage(e.data);
    this.worker.onerror = (err) => {
      console.warn("[p17] tts worker error", err);
      if (!this.workerReady) this.setStatus("failed");
    };

    this.worker.postMessage({
      type: "INIT",
      device,
      urls: KOKORO_URLS,
      modelId: MODEL_ID,
      prefs: VOICE_PREFS
    });
  },

  setStatus(status, detail = {}) {
    this.status = status;
    horrorState.voiceReady = status === "available";
    emit("voice:status", { status, ...detail });
  },

  onWorkerMessage(msg) {
    switch (msg.type) {
      case "PROGRESS":
        emit("voice:progress", msg);
        break;
      case "READY": {
        this.workerReady = true;
        this.chosenVoice =
          msg.voices?.find((v) => VOICE_PREFS.includes(v)) ||
          VOICE_PREFS.find((v) => msg.voices?.includes(v)) ||
          msg.voices?.[0] ||
          null;
        this.setStatus("available", { voice: this.chosenVoice });
        break;
      }
      case "ERROR":
        console.warn("[p17] tts init error", msg.message);
        if (!this.workerReady) this.setStatus("failed", { reason: msg.message });
        break;
      case "AUDIO":
        this.onAudio(msg);
        break;
      default:
        break;
    }
  },

  /* ---------------- queue ---------------- */

  // never overlaps; resolves when the line has finished (or been dropped)
  speak(text, profile = this.activeProfile, opts = {}) {
    if (!text) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.queue.push({ text, profile, opts, resolve, id: `line_${++this.lineCounter}` });
      this.pump();
    });
  },

  setProfile(profile) {
    this.activeProfile = profile;
  },

  cancelAll() {
    this.queue.splice(0).forEach((i) => i.resolve(null));
    this.stopCurrent();
  },

  // stage changed: drop queued lines but let the current one finish
  clearQueue() {
    this.queue.splice(0).forEach((i) => i.resolve(null));
  },

  stopCurrent() {
    if (this.currentHandle) {
      try {
        this.currentHandle.stop();
      } catch {}
      this.currentHandle = null;
    }
    if (this.currentUtterance) {
      try {
        speechSynthesis.cancel();
      } catch {}
      this.currentUtterance = null;
    }
    this.pendingResolve = null;
  },

  async pump() {
    if (this.speaking || this.queue.length === 0) return;
    this.speaking = true;
    const item = this.queue.shift();

    const gap = item.opts.gap ?? this.defaultGapMs;
    const sinceLast = Date.now() - this.lastSpokeAt;
    if (sinceLast < gap && !item.opts.ignoreGap) {
      await wait(gap - sinceLast);
    }

    try {
      await this.deliver(item);
    } catch (err) {
      console.warn("[p17] speak failed", err);
    } finally {
      this.lastSpokeAt = Date.now();
      this.speaking = false;
      this.currentHandle = null;
      this.currentUtterance = null;
      item.resolve(true);
      this.pump();
    }
  },

  async deliver(item) {
    // wait (bounded) if the model is still initializing
    if (this.status === "loading") {
      const waited = await Promise.race([
        waitForStatus(this, ["available", "fallback", "failed"], 25000),
        wait(25000).then(() => false)
      ]);
      if (!waited) return;
    }

    if (this.status === "available" && this.worker && audio.ready) {
      await this.deliverKokoro(item);
      return;
    }

    if ("speechSynthesis" in window) {
      await this.deliverBrowserSpeech(item);
      return;
    }

    // nothing available — the line is simply never spoken
  },

  deliverKokoro(item) {
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this.worker.postMessage({
        type: "SPEAK",
        id: item.id,
        text: item.text,
        voice: this.chosenVoice,
        profile: item.profile,
        pan: item.opts.pan ?? null
      });

      // hard timeout so a stuck worker cannot freeze the story
      const timer = setTimeout(() => {
        if (this.pendingResolve === resolve) {
          this.pendingResolve = null;
          resolve();
        }
      }, 40000);

      this._audioResolver = () => {
        clearTimeout(timer);
        if (this.pendingResolve === resolve) {
          this.pendingResolve = null;
          resolve();
        }
      };
    });
  },

  onAudio(msg) {
    if (!audio.ready) {
      this._audioResolver && this._audioResolver();
      return;
    }
    try {
      const pcm = msg.pcm instanceof Float32Array
        ? msg.pcm
        : new Float32Array(msg.pcm);
      const buffer = audio.bufferFromPCM(pcm, msg.sampleRate || 24000);
      this.currentHandle = audio.playBuffer(buffer, msg.profile || "A", {
        pan: msg.pan ?? null
      });
      if (this.currentHandle && this.currentHandle.onended) {
        this.currentHandle.onended(() => {
          this.currentHandle = null;
          this._audioResolver && this._audioResolver();
        });
      } else {
        setTimeout(() => {
          this._audioResolver && this._audioResolver();
        }, (buffer.duration || 2) * 1000 + 150);
      }
    } catch (err) {
      console.warn("[p17] audio decode failed", err);
      this._audioResolver && this._audioResolver();
    } finally {
      this._audioResolver = null;
    }
  },

  deliverBrowserSpeech(item) {
    return new Promise((resolve) => {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(item.text);
        u.rate = 0.82;
        u.pitch = 0.75;
        u.volume = 0.7;
        const all = speechSynthesis.getVoices();
        const preferred =
          all.find((v) => /en(-|_)?(GB|UK)/i.test(v.lang)) ||
          all.find((v) => /^en/i.test(v.lang));
        if (preferred) u.voice = preferred;
        this.currentUtterance = u;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        speechSynthesis.speak(u);
        setTimeout(resolve, 4000 + item.text.length * 90);
      } catch {
        resolve();
      }
    });
  }
};

function waitForStatus(v, statuses, timeoutMs) {
  return new Promise((resolve) => {
    if (statuses.includes(v.status)) return resolve(true);
    const off = emitSubscribe(v, statuses, resolve, timeoutMs);
    return off;
  });
}

function emitSubscribe(v, statuses, resolve, timeoutMs) {
  // small polling shim (state.js has no global emit subscription for voice here)
  const start = Date.now();
  const iv = setInterval(() => {
    if (statuses.includes(v.status)) {
      clearInterval(iv);
      resolve(true);
    } else if (Date.now() - start > timeoutMs) {
      clearInterval(iv);
      resolve(false);
    }
  }, 150);
  return () => clearInterval(iv);
}

// pre-load browser voices list for the fallback path
if ("speechSynthesis" in window) {
  try {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  } catch {}
}
