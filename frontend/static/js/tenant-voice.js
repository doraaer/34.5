// DORA voice on the tenant page (Person 2). No extra button: tapping the existing voice sculpture
// starts/ends the conversation. Status, caption and calendar note render in #elevenlabs-agent-container.
// Voice logic lives in dora-voice.js (copy of agent/web/dora-voice.js); this file is only the UI glue.
import { createDoraVoice } from "/static/js/dora-voice.js";

const container = document.getElementById("elevenlabs-agent-container");
const sculpture = document.querySelector(".voice-sculpture");

if (container && sculpture) {
  const el = (tag, className, text = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  };
  const IDLE = "Tap DORA to talk, or scroll down to write.";
  const state = el("p", "voice-state", IDLE);
  state.setAttribute("role", "status");
  const caption = el("p", "voice-caption");
  caption.setAttribute("aria-live", "polite");
  const calendar = el("p", "voice-calendar");
  calendar.hidden = true;
  container.replaceChildren(state, caption, calendar);

  // Make the existing sculpture the (keyboard-accessible) talk control.
  sculpture.removeAttribute("aria-hidden");
  sculpture.setAttribute("role", "button");
  sculpture.setAttribute("tabindex", "0");
  sculpture.setAttribute("aria-label", "Talk to DORA");
  sculpture.classList.add("voice-trigger");

  let voice, connected = false, busy = false;
  const setMode = mode => {
    sculpture.classList.toggle("listening", mode === "listening");
    sculpture.classList.toggle("speaking", mode === "speaking");
  };
  const announceCase = caseId =>
    window.dispatchEvent(new CustomEvent("dora:case-updated", { detail: { case_id: caseId ?? null } }));

  const options = {
    agentId: container.dataset.agentId,
    onStatus: ({ status, mode }) => {
      connected = status === "connected";
      sculpture.setAttribute("aria-label", connected ? "End conversation with DORA" : "Talk to DORA");
      sculpture.setAttribute("aria-pressed", String(connected));
      if (status === "connecting" || connected) state.classList.remove("error");
      if (status === "connecting") state.textContent = "Connecting…";
      else if (connected) state.textContent = mode === "speaking" ? "DORA is speaking · tap to end" : "Listening… · tap to end";
      else if (!state.classList.contains("error")) state.textContent = IDLE; // keep a shown error visible
      setMode(connected ? (mode === "speaking" ? "speaking" : "listening") : null);
    },
    onMessage: ({ message, role, source }) => {
      const fromUser = (role ?? source) === "user";
      caption.textContent = fromUser ? `“${message}”` : message;
      caption.classList.toggle("from-user", fromUser);
    },
    onToolEvent: ({ result }) => announceCase(result?.case_id),
    onError: message => { state.textContent = message; state.classList.add("error"); },
    onCalendarAdded: ({ label }) => {
      calendar.textContent = `✓ Added to your calendar: ${label}`;
      calendar.hidden = false;
    },
    onCalendarFile: ({ url, filename, label }) => {
      const link = el("a", "", `Add to your calendar: ${label}`);
      link.href = url;
      link.download = filename;
      calendar.replaceChildren(link);
      calendar.hidden = false;
    },
  };

  async function toggle() {
    if (busy) return;
    busy = true;
    state.classList.remove("error");
    try {
      voice ??= createDoraVoice(options);
      if (connected) await voice.stop();
      else await voice.start();
    } catch {
      state.textContent = "Voice isn't available right now. Scroll down to write instead.";
      state.classList.add("error");
    } finally {
      busy = false;
    }
  }
  sculpture.addEventListener("click", toggle);
  sculpture.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
  });

  // Resume an automatic "add to calendar" watcher after a reload, without starting a call.
  try { if (localStorage.getItem("dora_case_id")) voice = createDoraVoice(options); } catch { /* no storage */ }
}
