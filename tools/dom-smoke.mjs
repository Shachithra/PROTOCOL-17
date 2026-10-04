// PROTOCOL 17 — DOM smoke test (requires jsdom)
//   npm i -D jsdom
//   node tools/dom-smoke.mjs
// Or point at an external install:
//   JSDOM_PATH=file:///C:/path/to/node_modules/jsdom/lib/api.js node tools/dom-smoke.mjs
//
// Boots the real index.html + app.js in jsdom, clicks through every stage
// with a stubbed location API, and fails on any uncaught error.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadJsdom() {
  try {
    return await import("jsdom");
  } catch {
    if (process.env.JSDOM_PATH) return import(process.env.JSDOM_PATH);
    throw new Error("jsdom not found — run: npm i -D jsdom");
  }
}

const { JSDOM } = await loadJsdom();

const errors = [];
process.on("uncaughtException", (e) => errors.push("uncaught: " + e.stack));
process.on("unhandledRejection", (e) => errors.push("rejection: " + e));

const dbgPath = process.env.P17_DEBUG;
const dbg = (m) => {
  if (dbgPath) fs.appendFileSync(dbgPath, m + "\n");
};
dbg("jsdom loaded");

/* ---------- DOM ---------- */

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const dom = new JSDOM(html.replace(/<script[^>]*module[^>]*><\/script>/, ""), {
  url: "http://localhost:8123/",
  pretendToBeVisual: true
});
const { window } = dom;

window.matchMedia =
  window.matchMedia ||
  (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
window.AudioContext = undefined;
// note: do NOT create a speechSynthesis property — the app checks `in`
delete window.speechSynthesis;
delete window.Worker;

const exposed = [
  "window", "document", "navigator", "localStorage", "sessionStorage",
  "Element", "HTMLElement", "Node", "Event", "MouseEvent", "CustomEvent",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  "screen"
  // performance intentionally omitted: jsdom's wrapper can recurse;
  // Node's own performance.now() is used instead
];

for (const key of exposed) {
  try {
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? window : window[key],
      configurable: true,
      writable: true
    });
  } catch (e) {
    errors.push(`expose ${key}: ${e.message}`);
  }
}

// app.js uses the global location (protocol / reload)
Object.defineProperty(globalThis, "location", {
  value: window.location,
  configurable: true,
  writable: true
});

// stub the approximate location APIs — deterministic, no network in tests
const FAKE_GEO = {
  country: "Testland",
  region: "Null Province",
  city: "Bitville",
  timezone: { id: "UTC" },
  connection: { org: "TEST-ISP", isp: "TEST-ISP" }
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("ipwho.is") || u.includes("ipapi.co")) {
    return {
      ok: true,
      status: 200,
      json: async () => FAKE_GEO,
      clone() { return this; }
    };
  }
  if (realFetch) return realFetch(url, opts);
  throw new Error("no network");
};

/* ---------- boot the app ---------- */

const state = await import(pathToFileURL(path.join(ROOT, "js", "state.js")).href);

const timeline = [];
const seenStages = new Set([0]);

state.on("level:changed", (d) => {
  if (d.stageChanged) {
    seenStages.add(d.stage);
    timeline.push(`stage ${d.stage} @ level ${d.level}`);
  }
});
state.on("voice:status", (d) => timeline.push(`voice: ${d.status}`));
state.on("location:resolved", (d) =>
  timeline.push(`location: ${d.city}, ${d.country}`)
);
state.on("location:failed", () => timeline.push("location: failed"));

dbg("importing app");
try {
  await import(pathToFileURL(path.join(ROOT, "js", "app.js")).href);
} catch (e) {
  errors.push("app import: " + (e && e.stack ? e.stack : e));
}
dbg("app imported (errors: " + errors.length + ")");

process.on("exit", () => {
  if (errors.length) {
    try {
      fs.writeSync(2, "\n[smoke] errors:\n" + errors.join("\n---\n") + "\n");
    } catch {}
  }
});

const doc = window.document;
const button = doc.getElementById("forbidden");
const message = doc.getElementById("message");
const meterValue = doc.getElementById("meter-value");

const click = () => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snapshot(label) {
  return {
    label,
    stage: state.horrorState.level,
    meter: meterValue.textContent,
    button: button.hidden ? "(hidden)" : button.textContent.trim(),
    message: message.textContent.slice(0, 60),
    status: doc.getElementById("status-value").textContent,
    voice: doc.getElementById("voice-status").textContent
  };
}

const states = [];
const record = (label) => states.push(snapshot(label));

record("boot");

// pointer noise (approach / leave)
for (let i = 0; i < 6; i++) {
  window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 4, clientY: 4, bubbles: true }));
  await sleep(30);
}
for (let i = 0; i < 4; i++) {
  window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 900, clientY: 700, bubbles: true }));
  await sleep(30);
}

/* stage 0-4: click fast, let scripts breathe */
async function clickUntil(stageWanted, { max = 220, delay = 140 } = {}) {
  for (let i = 0; i < max; i++) {
    if (currentStageGuess() >= stageWanted) break;
    // stage-specific required interactions
    const stage = currentStageGuess();
    if (stage === 5 && !doc.getElementById("ghost-btn").hidden) {
      // exercise the false-control path
      if (i % 6 === 5) {
        doc.getElementById("ghost-btn").dispatchEvent(
          new window.MouseEvent("click", { bubbles: true })
        );
      }
    }
    click();
    await sleep(delay);
  }
}

function currentStageGuess() {
  let s = 0;
  const lvl = state.horrorState.level;
  const table = [0, 8, 18, 28, 38, 48, 58, 66, 74, 82, 88, 94, 100];
  for (let i = table.length - 1; i >= 0; i--) if (lvl >= table[i]) { s = i; break; }
  return s;
}

// run through stage 10 (0..10 = 11 stage entries)
const deadline = Date.now() + 150_000;
while (!seenStages.has(10) && Date.now() < deadline && errors.length === 0) {
  if (currentStageGuess() === 8) {
    // stage 8: movement is the input
    window.dispatchEvent(
      new window.MouseEvent("pointermove", {
        clientX: 100 + Math.random() * 600,
        clientY: 100 + Math.random() * 400,
        bubbles: true
      })
    );
    await sleep(700);
    continue;
  }
  const before = seenStages.size;
  await clickUntil(currentStageGuess() + 1, { max: 30, delay: 120 });
  if (seenStages.size === before) await sleep(700); // let scripts finish
}
record("mid");

// stage 10: wait for EXIT, click it
const exitDeadline = Date.now() + 30_000;
while (seenStages.has(10) && !seenStages.has(11) && Date.now() < exitDeadline) {
  if (button.textContent.trim() === "EXIT" && !button.hidden) {
    record("exit-visible");
    click();
  }
  await sleep(300);
}
record("post-exit");

// stage 11: wait for CONTINUE, click it
const contDeadline = Date.now() + 40_000;
while (seenStages.has(11) && !seenStages.has(12) && Date.now() < contDeadline) {
  if (button.textContent.trim() === "CONTINUE" && !button.hidden) {
    record("continue-visible");
    click();
  }
  await sleep(300);
}

// stage 12: wait for START OVER
const overDeadline = Date.now() + 60_000;
let sawStartOver = false;
while (seenStages.has(12) && Date.now() < overDeadline) {
  if (button.textContent.trim() === "START OVER" && !button.hidden) {
    sawStartOver = true;
    record("start-over-visible");
    break;
  }
  await sleep(300);
}

/* ---------- report ---------- */

console.log("--- timeline ---");
for (const t of timeline) console.log(" ", t);
console.log("--- states ---");
for (const s of states) console.log(" ", JSON.stringify(s));
console.log("--- result ---");
console.log("  stages reached:", [...seenStages].sort((a, b) => a - b).join(","));
console.log("  start-over shown:", sawStartOver);
console.log("  errors:", errors.length);
for (const e of errors) console.log("   ", e);

const ok =
  errors.length === 0 &&
  seenStages.has(11) &&
  seenStages.has(12) &&
  sawStartOver;

console.log(ok ? "SMOKE TEST: PASS" : "SMOKE TEST: FAIL");
process.exit(ok ? 0 : 1);
