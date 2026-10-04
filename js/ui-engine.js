// PROTOCOL 17 — UI engine: DOM primitives + visual corruption effects

import { qs, typewriter, wait, chance, prefersReducedMotion, pad } from "./utils.js";
import { horrorState, emit } from "./state.js";

let els = null;
let typeCancel = null;
let pendingSay = null;
let meterHideTimer = null;

function releasePendingSay() {
  if (pendingSay) {
    const resolve = pendingSay;
    pendingSay = null;
    resolve();
  }
}

export const ui = {
  init() {
    els = {
      body: document.body,
      frame: qs("#frame"),
      titleMark: qs("#title-mark"),
      sessionMark: qs("#session-mark"),
      systemLabel: qs("#system-label"),
      meter: qs("#meter"),
      meterValue: qs("#meter-value"),
      meterFill: qs("#meter-fill"),
      statusValue: qs("#status-value"),
      voiceStatus: qs("#voice-status"),
      networkStatus: qs("#network-status"),
      message: qs("#message"),
      forbidden: qs("#forbidden"),
      ghostBtn: qs("#ghost-btn"),
      reveal: qs("#reveal"),
      terminal: qs("#terminal"),
      silenceMark: qs("#silence-mark"),
      finalLine: qs("#final-line"),
      cursorWord: qs("#cursor-word"),
      installLine: qs("#install-line"),
      installBtn: qs("#install-btn"),
      flash: qs("#flash-frame"),
      dirty: qs("#dirty-frame"),
      curtain: qs("#curtain"),
      trailLayer: qs("#cursor-trail-layer"),
      controls: {
        sound: qs("#ctrl-sound"),
        intensity: qs("#ctrl-intensity"),
        reset: qs("#ctrl-reset")
      }
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.setIntensity(true, { silent: true });
    }
    return els;
  },

  get els() {
    return els;
  },

  /* ---------------- messages ---------------- */

  // returns a promise resolving when typing completes (or immediately if dead)
  say(text, { speed = 32, sub = null, keep = 900, instant = false } = {}) {
    if (typeCancel) {
      typeCancel();
      typeCancel = null;
    }
    releasePendingSay(); // a superseded line must not hang its caller
    const el = els.message;
    el.dataset.text = text;
    el.classList.remove("glitching");

    if (instant || prefersReducedMotion()) {
      el.textContent = "";
      el.appendChild(document.createTextNode(text));
      if (sub) this.appendSub(el, sub);
      return Promise.resolve();
    }

    el.textContent = "";
    return new Promise((resolve) => {
      pendingSay = resolve;
      const finish = () => {
        if (pendingSay === resolve) pendingSay = null;
        if (sub) this.appendSub(el, sub);
        resolve();
      };
      typeCancel = typewriter(el, text, {
        speed,
        onDone: () => {
          typeCancel = null;
          finish();
        }
      });
      if (keep === 0) {
        /* caller controls lifetime */
      }
    });
  },

  appendSub(el, text) {
    const small = document.createElement("small");
    small.textContent = text;
    el.appendChild(small);
  },

  clearMessage() {
    if (typeCancel) {
      typeCancel();
      typeCancel = null;
    }
    releasePendingSay();
    els.message.textContent = "";
    delete els.message.dataset.text;
    els.message.classList.remove("glitching");
  },

  glitchMessage(on = true) {
    els.message.classList.toggle("glitching", on);
  },

  /* ---------------- status chrome ---------------- */

  setStatus(text, { hot = false } = {}) {
    els.statusValue.textContent = text;
    els.statusValue.classList.toggle("hot", hot);
    els.statusValue.classList.toggle("dim", !hot);
  },

  setVoiceStatus(text) {
    els.voiceStatus.textContent = text;
  },

  setNetworkStatus(text) {
    els.networkStatus.textContent = text;
  },

  setSession(n) {
    els.sessionMark.textContent = `SESSION ${pad(n, 3)}`;
  },

  setDocumentTitle(t) {
    document.title = t;
  },

  setSystemLabel(t) {
    els.systemLabel.textContent = t;
  },

  /* meter: number may be null to hide it entirely */
  setMeter(value) {
    clearTimeout(meterHideTimer);
    if (value === null || value === undefined) {
      els.meter.classList.add("hidden");
      return;
    }
    els.meter.classList.remove("hidden");
    const shown = Math.round(value);
    els.meterValue.textContent = `${shown}%`;
    els.meterFill.style.width = `${shown}%`;
    els.meter.setAttribute("aria-valuenow", String(shown));
    els.meter.classList.toggle("hot", shown >= 70);
  },

  twitchMeter() {
    els.meter.classList.remove("anim-meter-twitch");
    void els.meter.offsetWidth;
    els.meter.classList.add("anim-meter-twitch");
  },

  /* ---------------- buttons ---------------- */

  showButton(label = "DO NOT PRESS") {
    els.forbidden.hidden = false;
    els.forbidden.textContent = label;
    els.forbidden.classList.remove("no-hover");
  },

  hideButton() {
    els.forbidden.hidden = true;
  },

  get buttonVisible() {
    return !els.forbidden.hidden;
  },

  setButtonLabel(label) {
    els.forbidden.textContent = label;
  },

  nudgeButton(dx, dy) {
    const cur = {
      x: parseFloat(els.forbidden.style.getPropertyValue("--btn-x")) || 0,
      y: parseFloat(els.forbidden.style.getPropertyValue("--btn-y")) || 0
    };
    els.forbidden.style.setProperty("--btn-x", `${cur.x + dx}px`);
    els.forbidden.style.setProperty("--btn-y", `${cur.y + dy}px`);
  },

  resetButtonPosition() {
    els.forbidden.style.setProperty("--btn-x", "0px");
    els.forbidden.style.setProperty("--btn-y", "0px");
  },

  disableHover() {
    els.forbidden.classList.add("no-hover");
  },

  warnButton(on = true) {
    els.forbidden.classList.toggle("warn", on);
  },

  showGhost(label, onClick) {
    const b = els.ghostBtn;
    b.textContent = label;
    b.hidden = false;
    b.onclick = onClick;
  },

  hideGhost() {
    els.ghostBtn.hidden = true;
    els.ghostBtn.onclick = null;
  },

  /* ---------------- lights out / curtain ---------------- */

  lightsOut(on) {
    els.body.classList.toggle("lights-out", on);
  },

  curtain(on) {
    els.curtain.classList.toggle("on", on);
  },

  cleanRun(on) {
    els.body.classList.toggle("clean-run", on);
  },

  /* ---------------- reveal block ---------------- */

  revealReset() {
    for (const id of ["rev-country", "rev-region", "rev-city"]) {
      const row = document.getElementById(id);
      row.classList.remove("on");
      row.querySelector(".rev-val").textContent = "—";
    }
    els.reveal.classList.remove("on");
    els.reveal.setAttribute("aria-hidden", "true");
  },

  revealShow() {
    els.reveal.classList.add("on");
    els.reveal.setAttribute("aria-hidden", "false");
  },

  revealRow(id, value) {
    const row = document.getElementById(id);
    row.querySelector(".rev-val").textContent = value;
    row.classList.add("on");
  },

  /* ---------------- terminal (render only; logic in terminal-engine) ------- */

  renderTerminal(lines) {
    els.terminal.innerHTML = "";
    for (const line of lines) {
      const div = document.createElement("div");
      div.className = "t-line" + (line.exception ? " exception" : "");
      if (line.rule) {
        div.className = "t-rule";
        div.textContent = line.text;
      } else if (line.raw) {
        div.textContent = line.text;
      } else {
        const key = document.createElement("span");
        key.className = "t-key";
        key.textContent = line.key.padEnd(17, " ");
        const val = document.createElement("span");
        val.className = "t-val" + (line.exception ? " exception" : "");
        val.textContent = line.value;
        div.append(key, val);
      }
      els.terminal.appendChild(div);
    }
  },

  terminalShow(on) {
    els.terminal.classList.toggle("on", on);
    els.terminal.setAttribute("aria-hidden", on ? "false" : "true");
  },

  /* ---------------- effects ---------------- */

  flash() {
    if (horrorState.lowIntensity || prefersReducedMotion()) return;
    els.flash.classList.add("on");
    setTimeout(() => els.flash.classList.remove("on"), 60);
  },

  dirty(ms = 160) {
    if (horrorState.lowIntensity) return;
    els.dirty.style.opacity = "0.18";
    setTimeout(() => {
      els.dirty.style.opacity = "0";
    }, ms);
  },

  slice(ms = 220, shifted = false) {
    if (horrorState.lowIntensity || prefersReducedMotion()) return;
    const cls = shifted ? "slicing-shift" : "slicing";
    els.body.classList.add(cls);
    setTimeout(() => els.body.classList.remove(cls), ms);
  },

  align(cls) {
    els.body.classList.remove("decay-1", "decay-2", "decay-3", "decay-chaos", "perfect");
    if (cls) els.body.classList.add(cls);
  },

  flicker() {
    if (horrorState.lowIntensity) return;
    els.frame.classList.remove("anim-flicker");
    void els.frame.offsetWidth;
    els.frame.classList.add("anim-flicker");
  },

  microShift() {
    if (horrorState.lowIntensity) return;
    els.frame.classList.remove("anim-micro-shift");
    void els.frame.offsetWidth;
    els.frame.classList.add("anim-micro-shift");
  },

  cursorTrail(ms = 480) {
    if (horrorState.lowIntensity || prefersReducedMotion()) return;
    const layer = els.trailLayer;
    const handler = (e) => {
      if (Date.now() > endAt) {
        window.removeEventListener("pointermove", handler);
        return;
      }
      const dot = document.createElement("span");
      dot.className = "trail-dot";
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
      layer.appendChild(dot);
      setTimeout(() => dot.remove(), 500);
    };
    const endAt = Date.now() + ms;
    window.addEventListener("pointermove", handler, { passive: true });
  },

  brokenTracking(on = true) {
    els.message.classList.toggle("broken-tracking", on);
    els.titleMark.classList.toggle("broken-tracking", on);
  },

  duplicateText(on = true) {
    els.titleMark.classList.toggle("duplicated", on);
    els.titleMark.dataset.text = els.titleMark.textContent;
  },

  /* ---------------- stage 8 pointer words ---------------- */

  cursorWord(text, x, y, { persist = 4000 } = {}) {
    const w = els.cursorWord;
    w.textContent = text;
    w.style.left = `${Math.min(window.innerWidth - 90, Math.max(8, x))}px`;
    w.style.top = `${Math.min(window.innerHeight - 30, Math.max(8, y))}px`;
    w.classList.add("on");
    clearTimeout(w._timer);
    if (persist > 0) {
      w._timer = setTimeout(() => w.classList.remove("on"), persist);
    }
  },

  cursorWordHide() {
    els.cursorWord.classList.remove("on");
  },

  /* ---------------- silence / final ---------------- */

  silenceMark(text) {
    els.silenceMark.textContent = text;
    els.silenceMark.classList.add("on");
  },

  silenceMarkHide() {
    els.silenceMark.classList.remove("on");
  },

  finalLine(html, { on = true, quiet = "" } = {}) {
    if (on) {
      els.finalLine.innerHTML = html;
      if (quiet) {
        const q = document.createElement("span");
        q.className = "final-quiet";
        q.textContent = quiet;
        els.finalLine.appendChild(q);
      }
      els.finalLine.classList.add("on");
      els.finalLine.setAttribute("aria-hidden", "false");
    } else {
      els.finalLine.classList.remove("on");
      els.finalLine.setAttribute("aria-hidden", "true");
    }
  },

  /* ---------------- install ---------------- */

  showInstall(handler) {
    els.installLine.hidden = false;
    requestAnimationFrame(() => els.installLine.classList.add("on"));
    els.installBtn.onclick = handler;
  },

  hideInstall() {
    els.installLine.classList.remove("on");
    setTimeout(() => {
      els.installLine.hidden = true;
    }, 700);
  },

  /* ---------------- controls ---------------- */

  setIntensity(on, { silent = false } = {}) {
    horrorState.lowIntensity = on;
    els.body.classList.toggle("low-intensity", on);
    els.controls.intensity.setAttribute("aria-pressed", String(on));
    if (!silent) emit("ui:intensity", { on });
  },

  setSoundLabel(on) {
    els.controls.sound.textContent = on ? "SOUND ON" : "SOUND OFF";
    els.controls.sound.setAttribute("aria-pressed", String(on));
  }
};
