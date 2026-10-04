// PROTOCOL 17 — local memory (localStorage / sessionStorage only)
// Never stores IP, city, location or movement traces.

import { horrorState, emit } from "./state.js";

const LS_KEY = "protocol17:v1";
const SS_KEY = "protocol17:session:v1";

const DEFAULTS = {
  visitCount: 0,
  completed: false,
  totalClicks: 0,
  maxLevel: 0
};

function safeRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return { ...fallback };
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage disabled — experience still works */
  }
}

let persistent = safeRead(LS_KEY, DEFAULTS);
let session = safeRead(SS_KEY, { sessionStart: 0, sessionId: 0 });

export const memory = {
  // called once at boot
  openSession() {
    const now = Date.now();
    if (!session.sessionStart || now - session.sessionStart > 30 * 60 * 1000) {
      persistent.visitCount += 1;
      session = {
        sessionStart: now,
        sessionId: persistent.visitCount
      };
      safeWrite(SS_KEY, session);
      safeWrite(LS_KEY, persistent);
    } else {
      session = { sessionStart: now, sessionId: persistent.visitCount };
      safeWrite(SS_KEY, session);
    }

    horrorState.visitCount = persistent.visitCount;
    horrorState.completed = persistent.completed;
    emit("session:opened", {
      visitCount: persistent.visitCount,
      returning: persistent.completed || persistent.visitCount > 1
    });
    return persistent;
  },

  get visitCount() {
    return persistent.visitCount;
  },

  get completed() {
    return persistent.completed;
  },

  get totalClicks() {
    return persistent.totalClicks;
  },

  get maxLevel() {
    return persistent.maxLevel;
  },

  recordClick() {
    persistent.totalClicks += 1;
    safeWrite(LS_KEY, persistent);
  },

  recordLevel(level) {
    if (level > persistent.maxLevel) {
      persistent.maxLevel = level;
      safeWrite(LS_KEY, persistent);
    }
  },

  recordCompletion() {
    persistent.completed = true;
    horrorState.completed = true;
    safeWrite(LS_KEY, persistent);
    emit("memory:completed");
  },

  // used by the RESET control
  wipe() {
    try {
      localStorage.removeItem(LS_KEY);
      sessionStorage.removeItem(SS_KEY);
    } catch {
      /* ignore */
    }
    persistent = { ...DEFAULTS };
    session = { sessionStart: 0, sessionId: 0 };
  },

  elapsedSeconds() {
    if (!session.sessionStart) return 0;
    return (Date.now() - session.sessionStart) / 1000;
  }
};
