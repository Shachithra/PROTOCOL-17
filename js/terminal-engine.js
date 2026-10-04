// PROTOCOL 17 — terminal engine (dirty-white readout, no neon cosplay)

import { ui } from "./ui-engine.js";
import { horrorState } from "./state.js";
import { formatSecs } from "./utils.js";

export const terminal = {
  visible: false,
  lines: [],
  confidence: 0.71,
  prediction: "PRESS",

  build(snapshot = {}) {
    this.lines = [
      { rule: true, text: "SESSION/17" },
      { rule: true, text: "--------------------------------" },
      {
        key: "input_count",
        value: String(horrorState.clicks).padStart(11, " ")
      },
      {
        key: "idle",
        value: `${formatSecs(snapshot.seconds || 0)}s`
      },
      {
        key: "cursor_distance",
        value: `${Number.isFinite(horrorState.closestCursorDistance)
            ? Math.round(horrorState.closestCursorDistance)
            : "----"}px`.padStart(10, " ")
      },
      { key: "prediction", value: this.prediction },
      {
        key: "confidence",
        value: `.${String(Math.round(this.confidence * 100)).padStart(2, "0")}`
      },
      { rule: true, text: "--------------------------------" }
    ];
  },

  open(snapshot) {
    this.build(snapshot);
    ui.renderTerminal(this.lines);
    ui.terminalShow(true);
    this.visible = true;
  },

  refresh(snapshot) {
    if (!this.visible) return;
    this.build(snapshot);
    ui.renderTerminal(this.lines);
  },

  // overwrite a single value (the unsettling part)
  overwrite(key, value, { exception = false } = {}) {
    const line = this.lines.find((l) => l.key === key);
    if (!line) return;
    line.value = value;
    line.exception = exception;
    ui.renderTerminal(this.lines);
  },

  overwritePrediction(value, { exception = false } = {}) {
    this.prediction = value;
    this.overwrite("prediction", value, { exception });
  },

  setConfidence(v) {
    this.confidence = v;
    this.overwrite(
      "confidence",
      `.${String(Math.round(v * 100)).padStart(2, "0")}`
    );
  },

  exceptionLine(text) {
    this.lines.push({ text, exception: true });
    ui.renderTerminal(this.lines);
  },

  plainLine(text) {
    this.lines.push({ text, raw: true });
    ui.renderTerminal(this.lines);
  },

  close() {
    ui.terminalShow(false);
    this.visible = false;
    setTimeout(() => {
      if (!this.visible) ui.renderTerminal([]);
    }, 500);
  }
};
