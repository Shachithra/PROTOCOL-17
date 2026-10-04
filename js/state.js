// PROTOCOL 17 — shared state + event bus

export const horrorState = {
  level: 0, // internal 0-100
  displayedLevel: 0, // what the meter shows (may differ)
  clicks: 0,
  visitCount: 0,
  idleSeconds: 0,
  cursorVelocity: 0,
  closestCursorDistance: Infinity,
  tabLeaveCount: 0,
  predictionsCorrect: 0,
  locationLoaded: false,
  voiceReady: false,
  audioUnlocked: false,
  finalSequenceStarted: false,
  completed: false,
  stage: 0,
  soundOn: true,
  lowIntensity: false,
  mutedByControl: false
};

const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function emit(type, detail = {}) {
  const set = listeners.get(type);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(detail);
    } catch (err) {
      console.warn("[p17] listener error", type, err);
    }
  }
}

// one-shot listener
export function once(type, fn) {
  const off = on(type, (detail) => {
    off();
    fn(detail);
  });
  return off;
}

export function waitFor(type, timeoutMs = Infinity) {
  return new Promise((resolve) => {
    let timer = null;
    const off = on(type, (detail) => {
      if (timer) clearTimeout(timer);
      off();
      resolve(detail);
    });
    if (Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        off();
        resolve(null);
      }, timeoutMs);
    }
  });
}
