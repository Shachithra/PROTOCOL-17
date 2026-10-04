# PROTOCOL 17

Dark psychological-horror PWA — AI voice edition.

A single-page experiment built around one forbidden button. The page starts
clinical and almost boring. Every interaction changes it. Nothing is ever
loud on purpose.

## Run

No build step. Any static server works:

```bash
python -m http.server 8123
# or
npx serve .
```

Open `http://localhost:8123`. A service worker registers on
`localhost`/`https` (never on `file://`).

## What is in here

```
index.html               single page shell
manifest.webmanifest     installable standalone mode
service-worker.js        offline shell (cache-first, same-origin only)
css/                     base, typography, horror states, motion, responsive
js/
  app.js                 director: stage choreography (13 stages)
  state.js               shared state + event bus
  horror-engine.js       stage model + irregular level progression
  event-engine.js        rare random events (bag-based, 10% chance)
  behavior-engine.js     harmless interaction observation
  location-engine.js     approximate IP lookup (memory only, never stored)
  memory-engine.js       localStorage visit/completion memory
  audio-engine.js        Web Audio + voice DSP profiles A–E
  voice-engine.js        Kokoro TTS queue (worker + WebGPU/WASM + fallback)
  ui-engine.js           DOM primitives + corruption effects
  terminal-engine.js     dirty-white readout
  utils.js               scheduler, timing, typing
workers/tts-worker.js    Kokoro-82M ONNX inference off the main thread
assets/textures/         generated grain / noise / scanlines PNGs
assets/icons/            192, 512, maskable icons
tools/gen-assets.mjs     regenerates textures + icons (zero dependencies)
tools/check-refs.mjs     verifies the import graph
tools/check-sw.mjs       verifies the service-worker precache list
```

## AI voice (Kokoro)

The voice engine imports [kokoro-js](https://www.npmjs.com/package/kokoro-js)
inside a module Web Worker:

1. WebGPU if `navigator.gpu` exists, otherwise WASM.
2. `Kokoro-82M` ONNX, `q8`, loaded from the jsDelivr CDN
   (esm.sh as a second source).
3. Synthesized PCM is posted back to the main thread, decoded into an
   `AudioBuffer`, and played through the Web Audio DSP profile of the
   current stage (clean → close → unstable → broken → final clean).

If the model or the CDN is unreachable, the engine falls back to the
browser's own `speechSynthesis` — a real capability, nothing faked. If that
is also unavailable, lines are simply never spoken; the story continues.

### Optional: fully local model module

```bash
npm install kokoro-js
mkdir -p vendor
cp node_modules/kokoro-js/dist/kokoro.js vendor/kokoro-js.js
```

`./vendor/kokoro-js.js` is tried last, after the CDNs. Model weights are
fetched by the runtime's own HTTP cache; the service worker never claims
cross-origin model files.

## Approximate network location

- Fetched once, only when the story reaches the network reveal.
- Sources: `ipwho.is`, then `ipapi.co` (no keys, reviewed for this use).
- City/region/country/timezone only. Always labelled
  `NETWORK LOCATION — APPROXIMATE`.
- Kept in runtime memory, discarded immediately after the reveal.
- Never written to localStorage, never cached by the service worker.
- Offline: the reveal is replaced by `NETWORK RESOLUTION / OFFLINE`
  and the voice says *"Fine. Keep your secrets."*

## Privacy

Stores only: visit count, completed flag, total clicks, highest level.
No IP, no location, no movement traces, no camera, no microphone, no
fingerprints.

## Controls (bottom right, always reachable)

- `SOUND ON/OFF` — master mute (voice lines are skipped while muted)
- `LOW INTENSITY` — removes flashes, slices, displacement, trails
- `RESET` — wipes local memory and reloads

Honors `prefers-reduced-motion`. Master gain is capped (0.62) behind a
limiter; no spikes, no stingers, no trapped fullscreen.

## Accessibility notes

- Minimum touch target 44px, safe-area insets respected.
- Navigation is never blocked; no fake browser-chrome overlays.
- The discreet controls stay visible even during the lights-out stages.

## Regenerating assets

```bash
node tools/gen-assets.mjs   # textures, icons, favicon.ico
node tools/check-refs.mjs   # import graph
node tools/check-sw.mjs     # precache list
```

## Audio assets

Room tone, electrical hum, static and the low impact are synthesized at
runtime with the Web Audio API (noise buffers + oscillators) instead of
shipping `.ogg` files — the PWA stays tiny, fully offline-safe and level
capped.

## Testing checklist (blueprint §30)

- DESIGN: restrained start state, no horror fonts, no ghosts, red appears
  only late and rarely.
- VOICE: initializes after first gesture, worker never blocks the UI,
  WebGPU → WASM path, queue never overlaps, safe output, final stage clean.
- LOCATION: labelled approximate, never persisted, failure and offline
  states handled, one reveal only.
- PWA: installable, offline shell, no cached IP responses, icons correct.
- HORROR: first ~20% feels normal, first voice is unexpected, 94–99%
  becomes almost silent, chaos is never constant.
- A11Y: mute works, reduced intensity works, no dangerous flashing,
  exit/navigation possible, no volume spikes.
