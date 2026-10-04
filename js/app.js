// PROTOCOL 17 — director
// Wires the engines together and choreographs the thirteen stages.

import { horrorState, on, emit } from "./state.js";
import { memory } from "./memory-engine.js";
import { behavior } from "./behavior-engine.js";
import { ui } from "./ui-engine.js";
import { terminal } from "./terminal-engine.js";
import { audio } from "./audio-engine.js";
import { voice } from "./voice-engine.js";
import { location as networkLocation } from "./location-engine.js";
import { progression, profileForStage } from "./horror-engine.js";
import { events } from "./event-engine.js";
import {
  Scheduler,
  wait,
  chance,
  randInt,
  pick,
  formatSecs
} from "./utils.js";

const sched = new Scheduler();
const BASE_TITLE = "Protocol 17";

let currentStage = 0;
let firstInteractionDone = false;
let runLock = false;
let deferredPrompt = null;
let installShown = false;
let postUnlockLines = [];
let lastGap = 0;
let voiceLoadSlow = false;

let s9Ticker = null;
let s4Timers = [];
let lastWordAt = 0;
let wordFlip = false;

const flags = {
  firstClickSaid: false,
  idle6: false,
  idle12: false,
  s3FirstVoice: false,
  s4Predicted: false,
  s48Fired: false,
  s415Fired: false,
  s5Done: false,
  s8Asked: false,
  s8BetterPending: false,
  s10Exited: false,
  s11Ready: false
};

const cooldownMap = {};
function cooled(key, ms) {
  const now = Date.now();
  if (cooldownMap[key] && now - cooldownMap[key] < ms) return false;
  cooldownMap[key] = now;
  return true;
}

/* ---------------- helpers ---------------- */

async function say(text, opts = {}) {
  return ui.say(text, opts);
}

async function voiceSay(text, profile = profileForStage(currentStage), opts = {}) {
  if (!horrorState.soundOn) {
    await wait(text.length * 60 + 350);
    return null;
  }
  return voice.speak(text, profile, opts);
}

function clearS4Timers() {
  s4Timers.forEach(clearTimeout);
  s4Timers = [];
}

function stopS9Ticker() {
  if (s9Ticker) {
    clearInterval(s9Ticker);
    s9Ticker = null;
  }
  ui.brokenTracking(false);
  ui.duplicateText(false);
}

/* ---------------- boot ---------------- */

function boot() {
  ui.init();
  memory.openSession();
  ui.setSession(Math.max(1, memory.visitCount));
  ui.setMeter(horrorState.displayedLevel);
  ui.setStatus("SESSION ACTIVE");
  ui.setVoiceStatus("OFFLINE");
  ui.setNetworkStatus("IDLE");

  behavior.init({ getButton: () => ui.els.forbidden });

  wireControls();
  wireVoiceStatus();
  wireLevel();
  wireBehavior();
  wireInstall();
  registerServiceWorker();

  ui.els.forbidden.addEventListener("click", onForbiddenClick);

  currentStage = 0;

  if (memory.completed) {
    document.body.classList.add("return-visit");
    bootReturnVisit();
  }
}

function bootReturnVisit() {
  ui.lightsOut(true);
  sched.push(async (ctx) => {
    if (!(await ctx.wait(2000))) return;
    ui.finalLine("You came back.");
    if (!(await ctx.wait(2600))) return;
    ui.finalLine("", { on: false });
    ui.lightsOut(false);
    ui.setSession(Math.max(1, memory.visitCount));
    ui.setStatus("SESSION ACTIVE");
    // the voice cannot speak until the first gesture unlocks audio
    postUnlockLines.push({
      text: "I wasn't expecting that.",
      profile: "A"
    });
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const proto = location.protocol;
  if (proto !== "https:" && proto !== "http:") return;
  navigator.serviceWorker.register("./service-worker.js").catch(() => {
    /* offline shell is optional */
  });
}

/* ---------------- controls ---------------- */

function wireControls() {
  ui.els.controls.sound.addEventListener("click", () => {
    const nextMuted = horrorState.soundOn; // currently on -> mute
    audio.setMuted(nextMuted);
    ui.setSoundLabel(!nextMuted);
    if (nextMuted) voice.clearQueue();
  });

  ui.els.controls.intensity.addEventListener("click", () => {
    ui.setIntensity(!horrorState.lowIntensity);
  });

  ui.els.controls.reset.addEventListener("click", () => {
    memory.wipe();
    location.reload();
  });

  ui.setSoundLabel(horrorState.soundOn);
}

/* ---------------- voice status chrome ---------------- */

function wireVoiceStatus() {
  on("voice:status", ({ status }) => {
    const map = {
      off: "OFFLINE",
      loading: voiceLoadSlow ? "PREPARING" : "STANDBY",
      available: "AVAILABLE",
      fallback: "AVAILABLE",
      failed: "UNAVAILABLE"
    };
    ui.setVoiceStatus(map[status] || "OFFLINE");
  });

  on("voice:progress", () => {
    voiceLoadSlow = true;
    ui.setVoiceStatus("PREPARING");
  });
}

/* ---------------- level / stage ---------------- */

function wireLevel() {
  on("level:changed", (d) => {
    ui.setMeter(d.displayed);
    if (chance(0.25) && horrorState.level < 94) ui.twitchMeter();
    if (d.stageChanged) enterStage(d.stage);
  });

  // occasional vanishing meter (stage 6+)
  setInterval(() => {
    const s = currentStage;
    if (s < 6 || s > 10) return;
    if (!chance(0.2) || !cooled("meterVanish", 22000)) return;
    ui.setMeter(null);
    setTimeout(() => ui.setMeter(horrorState.displayedLevel), randInt(3500, 6000));
  }, 5000);
}

function enterStage(id) {
  const prev = currentStage;
  if (id === prev) return;
  currentStage = id;

  runLock = false;
  voice.clearQueue();
  sched.invalidate();
  stopS9Ticker();
  clearS4Timers();
  ui.glitchMessage(false);
  if (id !== 7) networkLocation.forget();

  const isQuietStage = id === 7 || id === 8 || id === 11 || id === 12;
  if (isQuietStage) {
    ui.hideButton();
    ui.hideGhost();
  } else {
    ui.lightsOut(false);
    ui.curtain(false);
    document.body.classList.remove("silence-ui");
    ui.silenceMarkHide();
    ui.cursorWordHide();
    ui.showButton("DO NOT PRESS");
    ui.hideGhost();
    ui.revealReset();
    if (id !== 10) ui.clearMessage();
    if (id <= 1) {
      ui.setStatus("SESSION ACTIVE");
      ui.setDocumentTitle(BASE_TITLE);
      ui.setSystemLabel("SYSTEM");
    }
    if (id === 2 || id === 3) ui.setStatus("NORMAL");
    if (id === 10) {
      ui.setStatus("NORMAL");
      ui.hideButton(); // EXIT appears only when the fake ending settles
    }
  }

  const script = stageScripts[id];
  if (script) sched.push((ctx) => script(ctx));
}

/* ---------------- stage scripts ---------------- */

const stageScripts = {
  0: async () => {},

  1: async () => {
    ui.setStatus("NORMAL");
  },

  2: async () => {
    ui.setStatus("NORMAL");
  },

  3: async () => {
    ui.setStatus("NORMAL");
    // the screen says nothing unusual. the first voice arrives later.
  },

  4: async (ctx) => {
    ui.setStatus("NORMAL");
    terminal.open(behavior.idleSnapshot());
    if (!(await ctx.wait(1300))) return;
    terminal.overwritePrediction("LEAVE", { exception: true });
    if (!(await ctx.wait(1000))) return;
    terminal.overwritePrediction("PRESS");
    if (!(await ctx.wait(1400))) return;
    await say("Don't prove it right.");
    if (!(await ctx.wait(1800))) return;
    terminal.close();
    if (!ctx.alive) return;

    s4Timers.push(
      setTimeout(() => {
        if (currentStage !== 4 || flags.s4Predicted) return;
        say("Interesting.");
      }, 8000)
    );
    s4Timers.push(
      setTimeout(() => {
        if (currentStage !== 4 || flags.s4Predicted) return;
        voiceSay("You're still thinking about it.", profileForStage(4), {
          gap: 0
        });
      }, 15000)
    );
  },

  5: async (ctx) => {
    ui.setStatus("NORMAL");
    if (!(await ctx.wait(1400))) return;
    ui.showGhost("END SESSION", onEndSession);
  },

  6: async (ctx) => {
    ui.setStatus("NORMAL");
    if (!(await ctx.wait(900))) return;

    if (memory.visitCount > 1) {
      await say("PREVIOUS SESSION FOUND", { sub: "LOCAL DEVICE STORAGE" });
      if (!(await ctx.wait(1500))) return;
      await voiceSay("You came back.", profileForStage(6), { gap: 0 });
    } else {
      await say("SESSION MEMORY CREATED", { sub: "LOCAL DEVICE STORAGE" });
      if (!(await ctx.wait(1700))) return;
      await voiceSay("Don't worry. It stays here.", profileForStage(6), {
        gap: 0
      });
    }
  },

  7: async (ctx) => {
    runLock = true;
    ui.hideButton();
    ui.hideGhost();
    ui.clearMessage();
    ui.lightsOut(true);
    ui.setNetworkStatus("ANALYZING");
    ui.revealShow();

    if (!(await ctx.wait(1000))) return;

    const pending = networkLocation.resolve();
    await voiceSay("Let's try something else.", "A", { gap: 0 });
    if (!(await ctx.wait(1500))) return;

    const res = await pending;
    if (!ctx.alive) return;

    if (res.offline) {
      ui.revealReset();
      ui.finalLine("NETWORK RESOLUTION<br />OFFLINE");
      if (!(await ctx.wait(2400))) return;
      await voiceSay("Fine. Keep your secrets.", "A", { gap: 0 });
      if (!(await ctx.wait(2200))) return;
      finish7();
      return;
    }

    if (!res.ok) {
      ui.revealReset();
      ui.finalLine("LOCATION RESOLUTION FAILED");
      if (!(await ctx.wait(2600))) return;
      ui.finalLine("That's probably better.");
      if (!(await ctx.wait(2600))) return;
      finish7();
      return;
    }

    const s = networkLocation.state;
    ui.revealRow("rev-country", (s.country || "UNKNOWN").toUpperCase());
    if (!(await ctx.wait(1700))) return;
    ui.revealRow("rev-region", (s.region || s.country || "UNKNOWN").toUpperCase());
    if (!(await ctx.wait(1700))) return;
    ui.revealRow(
      "rev-city",
      (s.city || s.region || "UNRESOLVED").toUpperCase()
    );

    if (!(await ctx.wait(3200))) return;
    await voiceSay("Close enough.", "A", { gap: 0 });
    if (!(await ctx.wait(2000))) return;

    networkLocation.forget();
    finish7();
  },

  8: async () => {
    ui.hideButton();
    ui.hideGhost();
    ui.clearMessage();
    ui.cursorWordHide();
    flags.s8Asked = false;
    flags.s8BetterPending = false;
    lastWordAt = 0;
  },

  9: async (ctx) => {
    ui.setStatus("SUBJECT ACTIVE", { hot: true });
    ui.setSystemLabel("SUBJECT");
    ui.align("decay-chaos");
    ui.showButton();
    terminal.open(behavior.idleSnapshot());
    terminal.plainLine("SUBJECT ACTIVE");
    terminal.plainLine("INPUT CONTINUES");
    terminal.plainLine("MODEL CONFIDENCE: 93%");
    terminal.plainLine("NEXT RESPONSE: CONTINUE");

    if (!(await ctx.wait(2400))) return;
    await voiceSay("Go on.", profileForStage(9), { gap: 0 });
    if (!(await ctx.wait(1900))) return;
    terminal.close();
    if (!ctx.alive) return;
    startS9Ticker();
  },

  10: async (ctx) => {
    runLock = true;
    stopS9Ticker();
    ui.cleanRun(true);
    ui.align("perfect");
    ui.brokenTracking(false);
    ui.duplicateText(false);
    ui.setStatus("NORMAL");
    ui.setSystemLabel("SYSTEM");
    ui.resetButtonPosition();
    ui.clearMessage();
    ui.setMeter(horrorState.displayedLevel);

    if (!(await ctx.wait(1400))) return;
    await say("EXPERIMENT COMPLETE");
    if (!(await ctx.wait(1000))) return;
    ui.showButton("EXIT");
    runLock = false;
  },

  11: async (ctx) => {
    ui.hideGhost();
    ui.clearMessage();
    ui.setStatus("SESSION ACTIVE");
    ui.setSystemLabel("SYSTEM");

    if (!(await ctx.wait(1700))) return; // the 94% meter lingers
    document.body.classList.add("silence-ui");
    ui.silenceMark("98%");

    if (!(await ctx.wait(7000))) return;
    ui.finalLine("still here?");
    if (!(await ctx.wait(3400))) return;
    ui.finalLine("", { on: false });

    await voiceSay("Good.", "E", { gap: 0 });
    if (!(await ctx.wait(2200))) return;

    ui.showButton("CONTINUE");
    ui.disableHover();
    flags.s11Ready = true;
  },

  12: async (ctx) => {
    runLock = true;
    memory.recordCompletion();
    ui.hideButton();
    ui.silenceMarkHide();
    document.body.classList.remove("silence-ui");
    ui.lightsOut(true);
    emit("protocol:complete");

    if (!(await ctx.wait(1200))) return;
    await voiceSay("There was never anything behind the button.", "E", {
      gap: 0
    });
    if (!(await ctx.wait(2600))) return;
    await voiceSay("You kept going because you wanted something to happen.", "E", {
      gap: 0
    });
    if (!(await ctx.wait(2400))) return;

    ui.finalLine("PROTOCOL COMPLETE");
    if (!(await ctx.wait(3000))) return;
    await voiceSay("You were the interesting part.", "E", { gap: 0 });
    if (!(await ctx.wait(4200))) return;

    ui.finalLine("SESSION CLOSED");
    if (!(await ctx.wait(2000))) return;
    ui.showButton("START OVER");
    runLock = false;
  }
};

function finish7() {
    ui.revealReset();
  ui.finalLine("", { on: false });
  ui.lightsOut(false);
  ui.showButton("DO NOT PRESS");
  ui.setNetworkStatus("IDLE");
  ui.setStatus("NORMAL");
  networkLocation.forget();
  runLock = false;
}

/* ---------------- stage 9 corruption ticker ---------------- */

function startS9Ticker() {
  stopS9Ticker();
  s9Ticker = setInterval(() => {
    if (currentStage !== 9) return stopS9Ticker();
    const roll = randInt(0, 6);
    switch (roll) {
      case 0:
        ui.slice(randInt(140, 260), chance(0.5));
        break;
      case 1:
        ui.flash();
        break;
      case 2:
        ui.brokenTracking(chance(0.6));
        break;
      case 3:
        ui.duplicateText(chance(0.6));
        break;
      case 4: {
        const impossible = pick([143, 97, 12, 200]);
        ui.setMeter(impossible);
        setTimeout(() => ui.setMeter(horrorState.displayedLevel), 240);
        break;
      }
      case 5:
        ui.dirty(160);
        ui.microShift();
        break;
      default:
        ui.twitchMeter();
        break;
    }
  }, randInt(900, 1700));
}

/* ---------------- first interaction ---------------- */

async function firstInteraction() {
  firstInteractionDone = true;
  const ok = await audio.unlock();

  ui.setStatus("INITIALIZING AUDIO SUBSYSTEM");
  ui.setVoiceStatus("STANDBY");
  setTimeout(() => {
    ui.setStatus(currentStage <= 1 ? "SESSION ACTIVE" : "NORMAL");
  }, 2600);

  voice.init();
  if (ok) audio.startAmbience("room");

  if (postUnlockLines.length) {
    const lines = postUnlockLines;
    postUnlockLines = [];
    sched.push(async (ctx) => {
      for (const line of lines) {
        if (!(await ctx.wait(1600))) return;
        await voiceSay(line.text, line.profile, { gap: 0 });
      }
    });
  }
}

/* ---------------- forbidden button ---------------- */

async function onForbiddenClick() {
  if (!ui.buttonVisible || runLock) return;
  const stageAtClick = currentStage;

  if (!firstInteractionDone) await firstInteraction();

  if (events.consumeNoopClick()) return;

  memory.recordClick();
  behavior.resetIdle();

  if (stageAtClick === 11) return handleContinue();
  if (stageAtClick === 12) return handleStartOver();
  if (stageAtClick === 10) return handleExit();

  if (stageAtClick < 10) progression.advance("click");

  sched.push((ctx) => clickReaction(stageAtClick, ctx));
  events.maybeFire(stageAtClick, { profile: profileForStage(stageAtClick) });
}

/* ---------------- click reactions ---------------- */

async function clickReaction(stage, ctx) {
  switch (stage) {
    case 0: {
      flags.firstClickSaid = true;
      await say("Noted.");
      break;
    }

    case 1: {
      if (cooled("s1", 1400)) {
        ui.nudgeButton(chance(0.5) ? 2 : -2, 0);
        await say(
          pick(["Again?", "That was unnecessary.", "You understood the instruction."])
        );
      }
      break;
    }

    case 2: {
      if (lastGap > 10) {
        await say("No.");
        break;
      }
      if (lastGap > 5.5 && cooled("s2gap", 9000)) {
        await say(`You waited ${formatSecs(lastGap)} seconds.`);
        break;
      }
      if (cooled("s2", 2600)) {
        await say(
          pick([
            "You moved away.",
            "You almost clicked it.",
            "You came back.",
            "You stopped."
          ])
        );
      }
      break;
    }

    case 3: {
      if (!flags.s3FirstVoice) {
        flags.s3FirstVoice = true;
        if (!(await ctx.wait(2000))) return;
        await voiceSay("Why did you do that?", "A", { gap: 0 });
        if (!ctx.alive) return;
        if (!(await ctx.wait(600))) return;
        await say("VOICE CHANNEL: CLOSED", { sub: "TRANSCRIPT SUPPRESSED" });
      } else if (cooled("s3", 6000) && chance(0.3)) {
        await say(pick(["Again.", "Why?", "You understood the instruction."]));
      }
      break;
    }

    case 4: {
      if (!flags.s4Predicted) {
        flags.s4Predicted = true;
        clearS4Timers();
        await voiceSay("Predictable.", profileForStage(4), { gap: 1600 });
      } else if (cooled("s4", 4000)) {
        terminal.refresh(behavior.idleSnapshot());
      }
      break;
    }

    case 5: {
      if (cooled("s5", 2400)) {
        await say(pick(["Again?", "No."]));
      }
      break;
    }

    case 6: {
      if (cooled("s6", 3200)) {
        await say(pick(["Still local.", "Again.", "You understood the instruction."]));
      }
      break;
    }

    case 9: {
      if (cooled("s9click", 2200)) {
        await say(pick(["Continue.", "Go on.", "INPUT ACCEPTED"]));
        ui.glitchMessage(true);
        setTimeout(() => ui.glitchMessage(false), 500);
      }
      break;
    }

    default:
      break;
  }
}

/* ---------------- END SESSION / EXIT / CONTINUE / START OVER ---------- */

async function onEndSession() {
  if (flags.s5Done || runLock) return;
  flags.s5Done = true;
  runLock = true;

  await say("REQUEST RECEIVED");
  await wait(1900);
  await say("REQUEST REJECTED", { sub: "SESSION PERSISTS" });
  ui.hideButton();
  await wait(900);
  await voiceSay("That wasn't an option.", profileForStage(5), { gap: 0 });
  await wait(1400);

  // everything returns to perfect normal. that should feel wrong.
  ui.hideGhost();
  ui.clearMessage();
  ui.align("perfect");
  ui.setStatus("NORMAL");
  ui.showButton("DO NOT PRESS");
  ui.resetButtonPosition();
  runLock = false;
  progression.advance("false-control");
}

async function handleExit() {
  if (flags.s10Exited) return;
  flags.s10Exited = true;
  runLock = true;

  ui.hideButton();
  ui.clearMessage();
  ui.curtain(true);

  await wait(4000); // no sound at all

  ui.finalLine("That was easier than expected.");
  await wait(2000);
  await voiceSay("Wasn't it?", "B", { gap: 0, pan: -0.75 });
  await wait(2200);

  ui.finalLine("", { on: false });
  ui.curtain(false);
  ui.cleanRun(false);
  runLock = false;

  progression.setLevel(94, "script"); // -> stage 11
}

function handleContinue() {
  if (!flags.s11Ready) return;
  flags.s11Ready = false;
  progression.setLevel(100, "script"); // -> stage 12
}

function handleStartOver() {
  location.reload();
}

/* ---------------- behavior reactions ---------------- */

function wireBehavior() {
  on("behavior:resumed", ({ idleSeconds }) => {
    lastGap = idleSeconds;
    flags.idle6 = false;
    flags.idle12 = false;

    // scripted/endgame stages never advance from idling
    const s = currentStage;
    if (idleSeconds > 4 && s >= 1 && (s <= 6 || s === 9)) {
      progression.advance("idle");
    }
  });

  on("behavior:idle", ({ seconds }) => {
    const s = currentStage;

    if (s === 8) {
      if (seconds > 4.5 && !flags.s8Asked) {
        flags.s8Asked = true;
        flags.s8BetterPending = true;
        ui.cursorWordHide();
        voiceSay("Why did you stop?", profileForStage(8), { gap: 0 });
      }
      return;
    }

    if (s < 2 || s === 7 || s >= 10) return;

    if (seconds >= 6 && !flags.idle6) {
      flags.idle6 = true;
      if (s !== 4) sched.push((ctx) => idle6Reaction(ctx));
      if (s < 10) progression.advance("idle6");
    }

    if (seconds >= 12 && !flags.idle12) {
      flags.idle12 = true;
      if (s !== 4 && s !== 8) sched.push(() => say("Good."));
    }
  });

  on("behavior:pointer", ({ x, y }) => {
    if (currentStage !== 8) return;

    if (flags.s8BetterPending) {
      flags.s8BetterPending = false;
      flags.s8Asked = false;
      ui.cursorWord("better.", x, y, { persist: 3400 });
      progression.advance("pointer");
      return;
    }

    const now = Date.now();
    if (now - lastWordAt < 2600) return;
    lastWordAt = now;
    wordFlip = !wordFlip;
    ui.cursorWord(wordFlip ? "there" : "again", x, y, { persist: 3600 });
    // in this stage the movement itself is the input
    if (chance(0.45)) progression.advance("pointer");
  });

  on("behavior:approach", () => {
    const s = currentStage;
    if (s === 1 && cooled("s1nudge", 5000)) {
      ui.nudgeButton(chance(0.5) ? 2 : -2, 0);
    }
    if (events.consumeApproachNudge()) {
      ui.nudgeButton(chance(0.5) ? 6 : -6, chance(0.3) ? 4 : 0);
    }
    if (s === 9 && chance(0.35)) ui.microShift();
  });

  on("behavior:approach-leave", () => {
    const s = currentStage;
    if (s < 2 || s > 9) return;
    if (cooled("approachLeave", 26000)) {
      sched.push(() =>
        say(
          pick(["Changed your mind?", "You moved away.", "You almost clicked it."])
        )
      );
    }
    events.maybeFire(s, { profile: profileForStage(s) });
  });

  on("behavior:tab-leave", () => {
    if (currentStage >= 2 && currentStage <= 9) {
      ui.setDocumentTitle("DON'T");
    }
  });

  on("behavior:tab-enter", () => {
    ui.setDocumentTitle(BASE_TITLE);
    const s = currentStage;
    if (s >= 2 && s <= 9 && s !== 7 && s !== 8) {
      if (cooled("tabReturn", 12000)) {
        sched.push(() => say("There you are."));
        progression.advance("tab");
      }
    }
  });
}

async function idle6Reaction() {
  await say("You stopped.");
}

/* ---------------- install ---------------- */

function wireInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  const check = on("level:changed", (d) => {
    if (installShown || !deferredPrompt) return;
    if (d.level >= 50) {
      installShown = true;
      check();
      ui.showInstall(async () => {
        ui.hideInstall();
        try {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
        } catch {
          /* dismissed */
        }
        deferredPrompt = null;
      });
    }
  });

  window.addEventListener("appinstalled", () => {
    ui.hideInstall();
    deferredPrompt = null;
  });
}

/* ---------------- go ---------------- */

boot();
