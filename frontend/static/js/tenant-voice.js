// DORA voice on the tenant page (Person 2). Mounts into #elevenlabs-agent-container.
// Voice logic lives in dora-voice.js (copy of agent/web/dora-voice.js); this file is only the UI glue.
import { createDoraVoice } from "/static/js/dora-voice.js";

const container = document.getElementById("elevenlabs-agent-container");
const sculpture = document.querySelector(".voice-sculpture");

if (container) {
  const el = (tag, className, text = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  };
  const talk = el("button", "voice-talk", "Talk to DORA");
  talk.type = "button";
  const state = el("p", "voice-state", "Tap to talk, or scroll down to write.");
  state.setAttribute("role", "status");
  const caption = el("p", "voice-caption");
  caption.setAttribute("aria-live", "polite");
  const calendar = el("p", "voice-calendar");
  calendar.hidden = true;
  container.replaceChildren(talk, state, caption, calendar);

  let voice, connected = false;
  const setSculpture = mode => {
    sculpture?.classList.toggle("listening", mode === "listening");
    sculpture?.classList.toggle("speaking", mode === "speaking");
  };
  const announceCase = caseId =>
    window.dispatchEvent(new CustomEvent("dora:case-updated", { detail: { case_id: caseId ?? null } }));

  const options = {
    agentId: container.dataset.agentId,
    onStatus: ({ status, mode }) => {
      connected = status === "connected";
      talk.textContent = connected ? "End conversation" : "Talk to DORA";
      talk.classList.toggle("active", connected);
      if (status === "connecting") state.textContent = "Connecting…";
      else if (connected) state.textContent = mode === "speaking" ? "DORA is speaking" : "Listening…";
      else state.textContent = "Tap to talk, or scroll down to write.";
      setSculpture(connected ? (mode === "speaking" ? "speaking" : "listening") : null);
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

  talk.addEventListener("click", async () => {
    talk.disabled = true;
    state.classList.remove("error");
    try {
      voice ??= createDoraVoice(options);
      if (connected) await voice.stop();
      else await voice.start();
    } catch {
      state.textContent = "Voice isn't available right now. Scroll down to write instead.";
      state.classList.add("error");
    } finally {
      talk.disabled = false;
    }
  });

  // Resume an automatic "add to calendar" watcher after a reload, without starting a call.
  if (!voice) {
    try { if (localStorage.getItem("dora_case_id")) voice = createDoraVoice(options); } catch { /* no storage */ }
  }
}
