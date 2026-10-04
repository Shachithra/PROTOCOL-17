// PROTOCOL 17 — utils

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[randInt(0, arr.length - 1)];

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export function formatSecs(secs) {
  return secs.toFixed(1).padStart(4, "0");
}

export function pad(n, len = 3) {
  return String(n).padStart(len, "0");
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isCoarsePointer() {
  return window.matchMedia("(hover: none)").matches;
}

// distance between two points
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

// distance from point to rect edge (0 if inside)
export function distToRect(px, py, rect) {
  const dx = Math.max(rect.left - px, 0, px - rect.right);
  const dy = Math.max(rect.top - py, 0, py - rect.bottom);
  return Math.hypot(dx, dy);
}

// Cancellable sequential scheduler used by the director (app.js).
export class Scheduler {
  constructor() {
    this.token = 0;
    this.chain = Promise.resolve();
  }

  invalidate() {
    this.token++;
    return this.token;
  }

  // enqueue an async task; it receives a live token check via ctx
  push(fn) {
    const scheduler = this;
    const myToken = this.token;
    this.chain = this.chain.then(async () => {
      if (myToken !== this.token) return;
      const ctx = {
        get alive() {
          return myToken === scheduler.token;
        },
        wait: async (ms) => {
          await wait(ms);
          return myToken === scheduler.token;
        },
      };
      try {
        await fn(ctx);
      } catch (err) {
        if (!(err && err.name === "AbortError")) {
          console.warn("[p17] task error", err);
        }
      }
    });
    return this.chain;
  }

  // run immediately, not queued (for reactions)
  run(fn) {
    const scheduler = this;
    const myToken = this.token;
    const ctx = {
      get alive() {
        return myToken === scheduler.token;
      },
    };
    return Promise.resolve(fn(ctx)).catch((err) => {
      console.warn("[p17] run error", err);
    });
  }
}

export function on(el, type, fn, opts) {
  el.addEventListener(type, fn, opts);
  return () => el.removeEventListener(type, fn, opts);
}

// typing effect: writes chars one by one, returns cancel()
export function typewriter(el, text, { speed = 34, onDone, caret = true } = {}) {
  let i = 0;
  let stopped = false;
  el.textContent = "";
  const caretEl = document.createElement("span");
  caretEl.className = "caret";
  if (caret) el.appendChild(caretEl);

  const tick = () => {
    if (stopped) return;
    if (i >= text.length) {
      if (caretEl.parentNode) caretEl.remove();
      onDone && onDone();
      return;
    }
    const ch = text[i++];
    if (caret) {
      caretEl.remove();
      el.appendChild(document.createTextNode(ch));
      el.appendChild(caretEl);
    } else {
      el.appendChild(document.createTextNode(ch));
    }
    setTimeout(tick, speed + (ch === " " ? 14 : 0));
  };
  tick();

  return () => {
    stopped = true;
    if (caretEl.parentNode) caretEl.remove();
  };
}
