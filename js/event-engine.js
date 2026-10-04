// PROTOCOL 17 — random events (rare, 8–12% after eligible interactions)
// A bag is used so events do not repeat until the bag is empty,
// and never all in one run.

import { ui } from "./ui-engine.js";
import { audio } from "./audio-engine.js";
import { voice } from "./voice-engine.js";
import { terminal } from "./terminal-engine.js";
import { horrorState, emit } from "./state.js";
import { chance, shuffle, randInt, wait } from "./utils.js";

let bag = [];
let cooldownUntil = 0;
let noopClickArmed = false;
let approachNudgeArmed = false;

const EVENT_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function refill() {
  bag = shuffle(EVENT_IDS);
}
refill();

function eligible(stage) {
  if (stage < 1) return false; // stage 0 must stay disappointing and plain
  if (stage >= 10) return false; // fake ending onward: no carnival
  if (horrorState.lowIntensity) return false;
  return true;
}

export const events = {
  // call after an interaction; returns true if an event fired
  maybeFire(stage, context = {}) {
    if (!eligible(stage)) return false;
    if (Date.now() < cooldownUntil) return false;
    if (!chance(0.1)) return false; // 10%
    if (bag.length === 0) refill();

    const id = bag.pop();
    cooldownUntil = Date.now() + randInt(9000, 18000);
    this.fire(id, stage, context);
    return true;
  },

  fire(id, stage, context) {
    switch (id) {
      case 1: // all text shifts 4px left and stays
        ui.align("decay-2");
        emit("random:event", { id, name: "alignment" });
        break;

      case 2: // one click produces no reaction
        noopClickArmed = true;
        break;

      case 3: // STATUS flickers to LISTENING
        ui.setStatus("LISTENING", { hot: false });
        setTimeout(() => {
          ui.setStatus(horrorState.level > 60 ? "SUBJECT ACTIVE" : "NORMAL");
        }, 1800);
        break;

      case 4: // title becomes ...
        ui.setDocumentTitle("...");
        break;

      case 5: // one letter disappears
        const msg = ui.els.message.textContent;
        if (msg && msg.length > 3) {
          const i = randInt(0, msg.length - 1);
          ui.els.message.textContent = msg.slice(0, i) + msg.slice(i + 1);
        }
        break;

      case 6: // button creeps 6px away on approach
        approachNudgeArmed = true;
        break;

      case 7: // everything realigns perfectly (unsettling after chaos)
        ui.align("perfect");
        break;

      case 8: // the voice says "No."
        voice.speak("No.", context.profile || "A", { gap: 2500 });
        break;

      case 9: // terminal overwrites itself
        if (terminal.visible) {
          terminal.exceptionLine("IGNORE PREVIOUS OUTPUT");
          setTimeout(() => terminal.close(), 2400);
        } else {
          audio.staticBurst(0.18);
        }
        break;

      case 10: // short static burst, safe volume
        audio.staticBurst(0.2);
        ui.dirty(140);
        break;

      default:
        break;
    }
  },

  consumeNoopClick() {
    if (!noopClickArmed) return false;
    noopClickArmed = false;
    return true;
  },

  consumeApproachNudge() {
    if (!approachNudgeArmed) return false;
    approachNudgeArmed = false;
    return true;
  },

  reset() {
    refill();
    noopClickArmed = false;
    approachNudgeArmed = false;
    cooldownUntil = 0;
  }
};
