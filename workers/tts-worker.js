// PROTOCOL 17 — TTS Web Worker (Kokoro-82M ONNX)
// Runs inference off the main thread so the interface stays responsive.

let tts = null;
let voices = [];
let ready = false;
let busy = false;

async function loadModule(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (mod && (mod.KokoroTTS || mod.default)) return mod;
      lastErr = new Error(`no KokoroTTS export from ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("no TTS module");
}

async function init(msg) {
  const { urls, modelId, device } = msg;
  try {
    postMessage({ type: "PROGRESS", phase: "import" });
    const mod = await loadModule(urls);
    const KokoroTTS = mod.KokoroTTS || mod.default?.KokoroTTS;
    if (!KokoroTTS) throw new Error("KokoroTTS constructor missing");

    const wantsWebGPU = device === "webgpu";
    postMessage({ type: "PROGRESS", phase: "model" });

    const progress_callback = (data) => {
      if (data && data.status === "progress") {
        postMessage({
          type: "PROGRESS",
          phase: "model",
          file: data.file,
          loaded: data.loaded,
          total: data.total
        });
      }
    };

    try {
      tts = await KokoroTTS.from_pretrained(modelId, {
        dtype: "q8",
        device: wantsWebGPU ? "webgpu" : "wasm",
        progress_callback
      });
    } catch (err) {
      if (wantsWebGPU) {
        postMessage({ type: "PROGRESS", phase: "model-wasm" });
        tts = await KokoroTTS.from_pretrained(modelId, {
          dtype: "q8",
          device: "wasm",
          progress_callback
        });
      } else {
        throw err;
      }
    }

    voices = tts.voices ? Object.keys(tts.voices) : [];
    ready = true;
    postMessage({ type: "READY", voices });
  } catch (err) {
    postMessage({
      type: "ERROR",
      message: err && err.message ? err.message : String(err)
    });
  }
}

async function speak(msg) {
  if (!ready || !tts) {
    postMessage({ type: "ERROR", message: "not ready", id: msg.id });
    return;
  }
  if (busy) return; // one line at a time
  busy = true;
  try {
    const voiceName =
      (msg.voice && tts.voices && tts.voices[msg.voice] && msg.voice) ||
      (tts.voices ? Object.keys(tts.voices)[0] : undefined);

    const output = await tts.generate(msg.text, voiceName ? { voice: voiceName } : {});

    const raw = output.audio ?? output.data ?? output;
    let pcm;
    if (raw instanceof Float32Array) {
      pcm = raw;
    } else if (raw && raw.data instanceof Float32Array) {
      pcm = raw.data;
    } else {
      pcm = new Float32Array(raw);
    }

    const sampleRate = output.sampling_rate || output.samplingRate || 24000;

    postMessage(
      {
        type: "AUDIO",
        id: msg.id,
        pcm,
        sampleRate,
        profile: msg.profile || "A"
      },
      [pcm.buffer]
    );
  } catch (err) {
    postMessage({
      type: "ERROR",
      message: err && err.message ? err.message : String(err),
      id: msg.id
    });
  } finally {
    busy = false;
  }
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;
  if (msg.type === "INIT") init(msg);
  else if (msg.type === "SPEAK") speak(msg);
  else if (msg.type === "CANCEL") busy = false;
};
