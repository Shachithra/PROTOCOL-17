// PROTOCOL 17 — horror engine: stage model + deliberately irregular progression

import { horrorState, emit } from "./state.js";
import { rand, randInt, chance, clamp, pick } from "./utils.js";
import { memory } from "./memory-engine.js";

export const STAGES = [
  { id: 0, min: 0, max: 8, name: "THE LIE" },
  { id: 1, min: 8, max: 18, name: "IRRITATION" },
  { id: 2, min: 18, max: 28, name: "OBSERVATION" },
  { id: 3, min: 28, max: 38, name: "FIRST VOICE" },
  { id: 4, min: 38, max: 48, name: "PREDICTION" },
  { id: 5, min: 48, max: 58, name: "FALSE CONTROL" },
  { id: 6, min: 58, max: 66, name: "MEMORY" },
  { id: 7, min: 66, max: 74, name: "NETWORK REVEAL" },
  { id: 8, min: 74, max: 82, name: "THE PAGE KNOWS" },
  { id: 9, min: 82, max: 88, name: "CORRUPTION" },
  { id: 10, min: 88, max: 94, name: "THE FAKE ENDING" },
  { id: 11, min: 94, max: 99, name: "SILENCE" },
  { id: 12, min: 100, max: 100, name: "THE REVEAL" }
];

export function stageForLevel(level) {
  if (level >= 100) return 12;
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (level >= STAGES[i].min) return STAGES[i].id;
  }
  return 0;
}

export function stageMeta(id) {
  return STAGES[id] || STAGES[0];
}

// voice DSP profile per stage (blueprint §12)
export function profileForStage(id) {
  if (id <= 3) return "A"; // clean
  if (id <= 6) return "B"; // close
  if (id === 7) return "A"; // the reveal is delivered clean
  if (id <= 9) {
    if (id === 9 && chance(0.18)) return "D"; // broken, rarely
    return "C"; // unstable
  }
  return "E"; // final clean
}

const INCREMENTS = [4, 7, 2, 11, 1, 6, 3, 5, 9, 2, 4];

export const progression = {
  // returns { delta, level, stage, stageChanged, from }
  advance(reason = "interaction") {
    const from = horrorState.level;
    const fromStage = stageForLevel(from);

    let delta;
    const roll = Math.random();
    if (roll < 0.14) delta = 0; // sometimes nothing happens
    else if (roll < 0.22) delta = -randInt(1, 3); // the meter lies downward
    else delta = pick(INCREMENTS);

    let next = clamp(from + delta, 0, 100);

    // never leak into a scripted stage without the director's blessing:
    // stage 12 requires the final CONTINUE
    if (next >= 100 && fromStage < 11) next = 99;

    // a single irregular jump may skip at most into the next stage —
    // every stage must be entered, no stage is ever leapfrogged
    const targetStage = stageForLevel(next);
    if (targetStage > fromStage + 1 && fromStage + 1 < STAGES.length) {
      next = clamp(
        STAGES[fromStage + 1].min + randInt(0, 4),
        0,
        next > 100 ? 100 : next
      );
    }

    horrorState.level = next;
    horrorState.displayedLevel = this.displayValue(next);
    memory.recordLevel(next);

    const toStage = stageForLevel(next);
    const stageChanged = toStage !== fromStage;

    emit("level:changed", {
      reason,
      delta,
      level: next,
      displayed: horrorState.displayedLevel,
      stage: toStage,
      stageChanged,
      from: fromStage
    });

    return { delta, level: next, stage: toStage, stageChanged, from: fromStage };
  },

  // the shown number occasionally disagrees with the real one
  displayValue(internal) {
    if (chance(0.12)) return clamp(internal + pick([-3, -2, 2, 3]), 0, 99);
    return internal;
  },

  setLevel(v, reason = "script") {
    const fromStage = stageForLevel(horrorState.level);
    horrorState.level = clamp(v, 0, 100);
    horrorState.displayedLevel = horrorState.level;
    memory.recordLevel(horrorState.level);
    const toStage = stageForLevel(horrorState.level);
    emit("level:changed", {
      reason,
      delta: 0,
      level: horrorState.level,
      displayed: horrorState.level,
      stage: toStage,
      stageChanged: toStage !== fromStage,
      from: fromStage
    });
    return toStage;
  }
};

// weather for the visual engine: how chaotic is it allowed to be right now
export function chaosBudget(stage) {
  if (stage <= 1) return 0;
  if (stage <= 3) return 0.05;
  if (stage <= 6) return 0.1;
  if (stage <= 8) return 0.14;
  if (stage === 9) return 0.34; // controlled instability
  if (stage === 10) return 0; // perfect again
  if (stage === 11) return 0; // silence
  return 0;
}
