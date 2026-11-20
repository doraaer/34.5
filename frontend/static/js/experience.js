/* Shared presentation helpers. Backend responses remain the source of case state.
   Kept separate from common.js so the provider dashboard is unaffected. */
(() => {
  "use strict";
  const states = {
    reported: ["Reported", "neutral", "Choose your availability and authorize the request below."],
    awaiting_partner: ["Waiting for provider", "pending", "Your request was sent. The maintenance company has not confirmed an appointment yet."],
    scheduled: ["Appointment confirmed", "confirmed", "The provider accepted your appointment. Please be home during the confirmed time."],
    in_progress: ["Work in progress", "confirmed", "The provider has started the repair. We’ll update this record when the work is complete."],
    completed: ["Completed", "success", "The provider marked the work complete. The service report and invoice are recorded with your case."],
    needs_attention: ["Needs attention", "attention", "This request needs follow-up. Please contact your property manager. No new appointment has been confirmed."]
  };
  const steps = ["reported", "awaiting_partner", "scheduled", "in_progress", "completed"];
  function el(tag, text = "", className = "") {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  }
  async function api(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        ...options, signal: controller.signal, cache: "no-store",
        headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = typeof data?.detail === "string" ? data.detail :
          Array.isArray(data?.detail) ? data.detail.map(x => x.msg).join(". ") : "The request could not be completed.";
        const error = new Error(detail); error.status = response.status; throw error;
      }
      if (data === null) throw new Error("The server returned an unreadable response.");
      return data;
    } catch (error) {
      if (!error.status) {
        const message = error.name === "AbortError" ? "The server took too long to respond." : "We couldn’t reach the service.";
        const wrapped = new Error(message); wrapped.uncertain = options.method === "POST"; throw wrapped;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  function feedback(node, message, error = false) {
    node.textContent = message;
    node.classList.toggle("error", error);
  }
  function validSlot(slot) {
    return !!slot && Number.isFinite(Date.parse(slot.start)) &&
      Number.isFinite(Date.parse(slot.end)) && Date.parse(slot.end) > Date.parse(slot.start);
  }
  function formatSlot(slot) {
    if (!validSlot(slot)) return "Time details unavailable";
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return fmt.format(new Date(slot.start)) + " – " + fmt.format(new Date(slot.end)) + " · Berlin time";
  }
  function state(caseData) { return states[caseData.status] || ["Status unavailable", "neutral", "Refresh to check the latest information."]; }
  function badge(caseData) { const s = state(caseData); return el("span", s[0], "pill " + s[1]); }
  function appointment(caseData) {
    if (!["scheduled", "in_progress", "completed"].includes(caseData.status)) return null;
    const box = el("section", "", "appointment");
    box.append(el("h3", caseData.status === "scheduled" ? "Your confirmed appointment" : "Accepted appointment"));
    box.append(el("p", formatSlot(caseData.appointment)));
    if (!validSlot(caseData.appointment)) box.append(el("p", "The provider’s time details are missing. Please check with your property manager.", "hint"));
    return box;
  }
  function timeline(caseData) {
    const list = el("ol", "", "timeline");
    list.setAttribute("aria-label", "Maintenance progress");
    const position = steps.indexOf(caseData.status);
    steps.forEach((key, i) => {
      const item = el("li", states[key][0], i < position ? "done" : i === position ? "current" : "");
      if (i === position) item.setAttribute("aria-current", "step");
      list.append(item);
    });
    return list;
  }
  function caseSummary(caseData) {
    const box = el("div");
    const title = el("div", "", "case-title");
    title.append(el("span", caseData.case_id, "case-id"), badge(caseData));
    box.append(title, el("p", caseData.description, "issue"));
    const message = caseData.status === "completed" && (!caseData.service_report || !caseData.invoice)
      ? "The case is marked completed, but its documents are incomplete. Please contact your property manager."
      : state(caseData)[2];
    box.append(el("p", message, caseData.status === "needs_attention" ? "attention-box" : "next-step"));
    const slot = appointment(caseData);
    if (slot) box.append(slot);
    if (caseData.status !== "needs_attention") box.append(timeline(caseData));
    if (caseData.service_report?.summary) box.append(el("h3", "Service update"), el("p", caseData.service_report.summary));
    return box;
  }
  function facts(entries) {
    const list = el("dl", "", "facts");
    for (const [label, value] of entries) {
      const pair = el("div"); pair.append(el("dt", label), el("dd", value ?? "Not available")); list.append(pair);
    }
    return list;
  }
  function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function storageSet(key, value) { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* UI remains usable without storage. */ } }
  function poll(task) {
    let busy = false, stopped = false, timer;
    const run = async () => {
      if (busy || stopped) return;
      clearTimeout(timer); busy = true;
      try { await task(); } finally { busy = false; if (!stopped) timer = setTimeout(run, 5000); }
    };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) run(); });
    window.addEventListener("pagehide", () => { stopped = true; clearTimeout(timer); });
    window.addEventListener("pageshow", () => { if (stopped) { stopped = false; run(); } });
    run(); return run;
  }
  window.Dora = { el, api, feedback, validSlot, formatSlot, state, badge, appointment, timeline, caseSummary, facts, storageGet, storageSet, poll };
})();
