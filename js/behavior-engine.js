// PROTOCOL 17 — behavior engine
// Harmless interaction observation only: clicks, timing, pointer, tab state.
// No camera, microphone, fingerprinting or persistent personal data.

import { horrorState, emit } from "./state.js";
import { distToRect, isCoarsePointer } from "./utils.js";

export const behavior = {
  started: false,
  lastActivity: Date.now(),
  lastClickAt: 0,
  clickIntervals: [],
  pointer: { x: -1, y: -1, vx: 0, vy: 0, speed: 0, hasPointer: false },
  approachState: "far", // far | near | leaving
  nearSince: 0,
  scrollAttempts: 0,
  touchStarts: 0,
  touchEnds: 0,
  getButton: null,

  context() {
    return {
      screen: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language || "unknown",
      timezone: (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
        } catch {
          return "unknown";
        }
      })(),
      coarse: isCoarsePointer(),
      sessionSeconds: 0
    };
  },

  init({ getButton }) {
    if (this.started) return;
    this.started = true;
    this.getButton = getButton;

    const markActive = () => {
      const now = Date.now();
      const idle = (now - this.lastActivity) / 1000;
      if (idle > 0.4) {
        this.lastActivity = now;
        horrorState.idleSeconds = 0;
        emit("behavior:resumed", { idleSeconds: idle });
      } else {
        this.lastActivity = now;
      }
    };

    // pointer sampling
    let lastSample = performance.now();
    let lastX = null;
    let lastY = null;

    window.addEventListener(
      "pointermove",
      (e) => {
        markActive();
        const now = performance.now();
        const dt = Math.max(1, now - lastSample);
        if (lastX !== null) {
          const dx = e.clientX - lastX;
          const dy = e.clientY - lastY;
          this.pointer.vx = (dx / dt) * 1000;
          this.pointer.vy = (dy / dt) * 1000;
          this.pointer.speed = Math.hypot(this.pointer.vx, this.pointer.vy);
          horrorState.cursorVelocity = this.pointer.speed;
        }
        lastSample = now;
        lastX = e.clientX;
        lastY = e.clientY;
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;
        this.pointer.hasPointer = true;

        this.evaluateButtonProximity(e.clientX, e.clientY);
        emit("behavior:pointer", {
          x: e.clientX,
          y: e.clientY,
          speed: this.pointer.speed
        });
      },
      { passive: true }
    );

    window.addEventListener("pointerdown", (e) => {
      markActive();
      if (e.pointerType === "touch") this.touchStarts++;
      emit("behavior:press", { x: e.clientX, y: e.clientY });
    });

    window.addEventListener("pointerup", (e) => {
      if (e.pointerType === "touch") this.touchEnds++;
    });

    window.addEventListener("keydown", markActive);
    window.addEventListener("wheel", (e) => {
      markActive();
      if (Math.abs(e.deltaY) > 0) {
        this.scrollAttempts++;
        emit("behavior:scroll", { count: this.scrollAttempts });
      }
    }, { passive: true });

    // clicks + intervals
    window.addEventListener(
      "click",
      (e) => {
        markActive();
        const now = Date.now();
        if (this.lastClickAt) {
          const iv = now - this.lastClickAt;
          this.clickIntervals.push(iv);
          if (this.clickIntervals.length > 12) this.clickIntervals.shift();
        }
        this.lastClickAt = now;
        horrorState.clicks++;
        emit("behavior:click", {
          x: e.clientX,
          y: e.clientY,
          interval: this.clickIntervals.at(-1) || null,
          count: horrorState.clicks
        });
      },
      true
    );

    // tab visibility
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        horrorState.tabLeaveCount++;
        emit("behavior:tab-leave", { count: horrorState.tabLeaveCount });
      } else {
        emit("behavior:tab-enter", { count: horrorState.tabLeaveCount });
        this.lastActivity = Date.now();
      }
    });

    window.addEventListener("blur", () => emit("behavior:window-blur"));
    window.addEventListener("focus", () => emit("behavior:window-focus"));

    // idle heartbeat
    setInterval(() => {
      const idle = (Date.now() - this.lastActivity) / 1000;
      horrorState.idleSeconds = idle;
      emit("behavior:idle", { seconds: idle });
    }, 250);
  },

  evaluateButtonProximity(x, y) {
    const el = this.getButton && this.getButton();
    if (!el || el.hidden || el.offsetParent === null) {
      this.approachState = "far";
      return;
    }
    const rect = el.getBoundingClientRect();
    const d = distToRect(x, y, rect);
    if (d < horrorState.closestCursorDistance) {
      horrorState.closestCursorDistance = d;
    }

    const nearThreshold = 160;
    if (d <= nearThreshold && this.approachState === "far") {
      this.approachState = "near";
      this.nearSince = Date.now();
      emit("behavior:approach", { distance: d });
    } else if (d > nearThreshold * 1.9 && this.approachState === "near") {
      this.approachState = "leaving";
      emit("behavior:approach-leave", {
        distance: d,
        dwellMs: Date.now() - this.nearSince
      });
      setTimeout(() => {
        if (this.approachState === "leaving") this.approachState = "far";
      }, 1200);
    }
  },

  // app calls this periodically to allow idle-based story beats
  idleSnapshot() {
    return {
      seconds: horrorState.idleSeconds,
      lastClickAt: this.lastClickAt,
      meanInterval:
        this.clickIntervals.length > 0
          ? this.clickIntervals.reduce((a, b) => a + b, 0) /
            this.clickIntervals.length
          : null
    };
  },

  resetIdle() {
    this.lastActivity = Date.now();
    horrorState.idleSeconds = 0;
  }
};
