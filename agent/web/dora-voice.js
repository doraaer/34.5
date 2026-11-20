import { Conversation } from "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.35.0/+esm";

const caseKey = "dora_case_id";
// Appointments are offered as 1-hour slots carved out of the partner's longer windows.
const SLOT_MINUTES = 60;
const MAX_SLOTS = 12;
const WATCH_INTERVAL_MS = 4000;
const windowsByApi = new Map();
const proposalsByApi = new Map();
const berlinDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
});
const berlinTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const httpErrors = {
  400: ["invalid_input", "Please check the information and try again."],
  422: ["invalid_input", "Please check the information and try again."],
  404: ["not_found", "I couldn't find that maintenance case."],
  409: ["invalid_state", "That action isn't available at the current case status."],
};

function labelSlot({ start, end }) {
  const from = new Date(start);
  const to = new Date(end);
  const startDate = berlinDate.format(from);
  const endDate = berlinDate.format(to);
  const endLabel = from.getTime() + 86400000 <= to.getTime() || startDate !== endDate
    ? `${endDate}, ${berlinTime.format(to)}`
    : berlinTime.format(to);
  return `${startDate}, ${berlinTime.format(from)} to ${endLabel}`;
}

// Keep the partner's original UTC offset (e.g. +01:00) so the backend's slot checks compare like with like.
function isoWithOffset(reference, epochMs) {
  const offset = /([+-]\d{2}:\d{2}|Z)$/.exec(reference)?.[1] ?? "Z";
  const sign = offset === "Z" ? 0 : (offset[0] === "-" ? -1 : 1);
  const minutes = offset === "Z" ? 0 : sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(epochMs + minutes * 60000).toISOString().slice(0, 19);
  return local + (offset === "Z" ? "Z" : offset);
}

function icsStamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function buildIcs({ uid, start, end, summary, location, description }) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DORA//Team 34.5//EN", "BEGIN:VEVENT",
    `UID:${uid}@dora.demo`, `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(summary)}`, `LOCATION:${icsEscape(location)}`, `DESCRIPTION:${icsEscape(description)}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function notify(callback, value) {
  // A UI observer must not change the outcome of a saved backend operation.
  try {
    Promise.resolve(callback?.(value)).catch(console.error);
  } catch (error) {
    console.error(error);
  }
}

export function createDoraVoice({
  agentId, apiBase = "", onStatus, onMessage, onToolEvent, onError, onCalendarFile, onCalendarAdded,
}) {
  const base = apiBase.replace(/\/+$/, "");
  let memoryCaseId = null;
  let storageAvailable = true;
  let session;
  let starting;
  let stopping;

  function currentCaseId() {
    if (storageAvailable) {
      try {
        memoryCaseId = localStorage.getItem(caseKey);
      } catch {
        storageAvailable = false;
      }
    }
    return memoryCaseId;
  }

  function rememberCase(id) {
    memoryCaseId = id;
    if (storageAvailable) {
      try {
        if (id) localStorage.setItem(caseKey, id);
        else localStorage.removeItem(caseKey);
      } catch {
        storageAvailable = false;
      }
    }
  }

  function casePath(id = currentCaseId()) {
    if (!id) throw new ToolError("no_current_case", "Please report a heating issue first.");
    return `/api/cases/${encodeURIComponent(id)}`;
  }

  async function request(path, method = "GET", payload) {
    let response;
    try {
      response = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch {
      throw new ToolError("backend_unreachable", "I couldn't reach the maintenance system. Please try again.");
    }
    if (!response.ok) {
      throw new ToolError(...(httpErrors[response.status] ?? [
        "backend_unreachable", "The maintenance system couldn't complete that request. Please try again.",
      ]));
    }
    return response.json();
  }

  async function loadContext() {
    const context = await request("/api/context");
    const windows = new Map();
    for (const { start, end } of context.partner.availability) {
      const last = new Date(end).getTime();
      for (let t = new Date(start).getTime(); t + SLOT_MINUTES * 60000 <= last; t += SLOT_MINUTES * 60000) {
        if (windows.size >= MAX_SLOTS) break;
        windows.set(`W${windows.size + 1}`, {
          start: isoWithOffset(start, t),
          end: isoWithOffset(start, t + SLOT_MINUTES * 60000),
        });
      }
    }
    windowsByApi.set(base, windows);
    return { context, windows };
  }

  async function openCase() {
    const id = currentCaseId();
    if (!id) return null;
    try {
      const { case_id, status } = await request(casePath(id));
      return { case_id, status };
    } catch (error) {
      if (error.code !== "not_found") throw error;
      if (currentCaseId() === id) rememberCase(null);
      return null;
    }
  }

  // Per-case calendar state in localStorage: "auto" = tenant agreed to auto-add once confirmed,
  // "added:<method>" = already added. Survives page reloads so the watcher can resume.
  const calendarKey = id => `dora_calendar:${id}`;
  function getCalendarState(id) {
    try { return localStorage.getItem(calendarKey(id)); } catch { return null; }
  }
  function setCalendarState(id, value) {
    try {
      if (value) localStorage.setItem(calendarKey(id), value);
      else localStorage.removeItem(calendarKey(id));
    } catch { /* storage unavailable: auto-add just won't survive a reload */ }
  }

  // Adds the confirmed appointment: directly via the backend calendar endpoint when it exists,
  // otherwise by handing the page an .ics file. Never adds an unconfirmed appointment.
  async function addToCalendar(id) {
    const path = casePath(id);
    const current = await request(path);
    if (current.status !== "scheduled" || !current.appointment) {
      throw new ToolError("not_confirmed", "The appointment isn't confirmed yet, so I can't add it to your calendar.");
    }
    const label = labelSlot(current.appointment);
    const done = getCalendarState(current.case_id);
    if (done?.startsWith("added:")) return { method: done.slice(6), appointment: label, already_added: true };
    let result;
    try {
      const created = await request(path + "/calendar-event", "POST", {});
      result = { method: "calendar", provider: created.provider ?? "calendar", appointment: label };
      notify(onCalendarAdded, { label, provider: result.provider });
    } catch (error) {
      if (!["not_found", "invalid_state", "invalid_input", "backend_unreachable"].includes(error.code)) throw error;
      const { context } = await loadContext();
      const ics = buildIcs({
        uid: current.case_id,
        start: current.appointment.start,
        end: current.appointment.end,
        summary: `Heating repair - ${context.partner.name}`,
        location: context.building.address,
        description: `Maintenance case ${current.case_id}. Arranged by DORA.`,
      });
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
      notify(onCalendarFile, { url, filename: `heating-repair-${current.case_id}.ics`, label });
      result = { method: "ics_download", appointment: label };
    }
    setCalendarState(current.case_id, `added:${result.method}`);
    return result;
  }

  // After dispatch: if the tenant agreed to auto-add, poll the case and add it the moment the partner accepts.
  // Runs in the page, independent of the voice session.
  const watchers = new Map();
  function watchForConfirmation(id) {
    if (!id || watchers.has(id) || getCalendarState(id) !== "auto") return;
    const timer = setInterval(async () => {
      try {
        const current = await request(casePath(id));
        if (["needs_attention", "completed"].includes(current.status) && !current.appointment) {
          clearInterval(timer); watchers.delete(id); return;
        }
        if (current.status !== "scheduled" && current.status !== "in_progress" && current.status !== "completed") return;
        clearInterval(timer); watchers.delete(id);
        const result = await addToCalendar(id);
        notify(onToolEvent, { name: "auto_add_to_calendar", params: {}, result: { ok: true, ...result } });
      } catch (error) {
        if (error?.code === "not_found") { clearInterval(timer); watchers.delete(id); }
      }
    }, WATCH_INTERVAL_MS);
    watchers.set(id, timer);
  }
  // Resume after a page reload.
  try { const resume = localStorage.getItem(caseKey); if (resume) watchForConfirmation(resume); } catch { /* ignore */ }

  function tool(name, run) {
    return async (params = {}) => {
      let result;
      try {
        result = { ok: true, ...await run(params) };
      } catch (error) {
        result = error instanceof ToolError
          ? { ok: false, error: error.code, message: error.message }
          : { ok: false, error: "backend_unreachable", message: "I couldn't read the maintenance system response. Please try again." };
      }
      const output = JSON.stringify(result);
      notify(onToolEvent, { name, params, result });
      return output;
    };
  }

  const clientTools = {
    get_tenant_context: tool("get_tenant_context", async () => {
      const { context: { tenant, building, partner }, windows } = await loadContext();
      return {
        tenant_name: tenant.name,
        unit_id: tenant.unit_id,
        building_address: building.address,
        heating_type: building.heating_type,
        partner_name: partner.name,
        windows: Array.from(windows, ([window_id, slot]) => ({ window_id, label: labelSlot(slot), ...slot })),
        open_case: await openCase(),
      };
    }),

    create_maintenance_case: tool("create_maintenance_case", async ({ description, priority }) => {
      const { case_id, status } = await request("/api/cases", "POST", { description, priority });
      rememberCase(case_id);
      return { case_id, status };
    }),

    save_availability_and_consent: tool("save_availability_and_consent", async ({
      window_ids, booking_authorized, data_sharing_consent, add_to_calendar,
    }) => {
      const path = casePath();
      if (booking_authorized !== true || data_sharing_consent !== true) {
        throw new ToolError("consent_missing", "I need your permission to book and share the repair details.");
      }
      if (!Array.isArray(window_ids) || window_ids.length === 0) {
        throw new ToolError("invalid_input", "Please choose at least one offered appointment window.");
      }
      let windows = windowsByApi.get(base);
      if (!windows?.size) ({ windows } = await loadContext());
      const proposals = proposalsByApi.get(base) ?? new Map();
      const slots = window_ids.map(id => {
        const slot = windows.get(id) ?? proposals.get(id);
        if (!slot) throw new ToolError("unknown_window", "Please choose one of the offered appointment windows.");
        return slot;
      });
      const { case_id, status } = await request(path + "/availability", "POST", {
        available_slots: slots, booking_authorized: true, data_sharing_consent: true,
      });
      const autoAdd = add_to_calendar === true;
      setCalendarState(case_id, autoAdd ? "auto" : null);
      return { case_id, status, authorized_windows: slots.map(labelSlot), calendar_auto_add: autoAdd };
    }),

    propose_times_from_calendar: tool("propose_times_from_calendar", async () => {
      const path = casePath();
      let data;
      try {
        data = await request(path + "/calendar-proposal", "POST", {});
      } catch (error) {
        // 404 (endpoint not deployed yet / no case) and 409 (calendar not connected) mean:
        // fall back to the partner windows. Anything else is reported the same way.
        throw new ToolError("calendar_unavailable",
          "I wasn't able to read your calendar. Say exactly that to the tenant, then offer the next available slots.");
      }
      const proposals = new Map((data.proposals ?? []).slice(0, 3).map(({ start, end }, index) => [
        `P${index + 1}`, { start, end },
      ]));
      proposalsByApi.set(base, proposals);
      return {
        source: data.source ?? "calendar",
        proposals: Array.from(proposals, ([proposal_id, slot]) => ({ proposal_id, label: labelSlot(slot), ...slot })),
      };
    }),

    dispatch_to_partner: tool("dispatch_to_partner", async () => {
      const { case_id, status } = await request(casePath() + "/dispatch", "POST");
      watchForConfirmation(case_id);
      return { case_id, status, confirmed: false };
    }),

    add_appointment_to_calendar: tool("add_appointment_to_calendar", async () => addToCalendar(currentCaseId())),

    get_case_status: tool("get_case_status", async () => {
      const { case_id, status, appointment, service_report } = await request(casePath());
      return {
        case_id,
        status,
        appointment: appointment ? labelSlot(appointment) : null,
        service_report: service_report?.summary ?? null,
      };
    }),
  };

  const status = (value, mode) => notify(onStatus, { status: value, mode });
  const reportError = message => notify(onError, message);

  async function connect() {
    status("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release the permission-check stream. The SDK owns its own audio input.
      stream.getTracks().forEach(track => track.stop());
    } catch {
      reportError("DORA couldn't access your microphone. Allow microphone access or use the text form.");
      status("disconnected");
      return;
    }

    // Load the tenant record first and hand it to DORA as dynamic variables, so she knows the
    // tenant, flat and 1-hour slots from her very first sentence without a lookup mid-conversation.
    const dynamicVariables = {
      tenant_name: "there", unit_id: "unknown", building_address: "unknown",
      heating_type: "unknown", partner_name: "unknown", available_slots: "unknown",
    };
    try {
      const { context, windows } = await loadContext();
      dynamicVariables.tenant_name = String(context.tenant?.name ?? "").trim().split(/\s+/)[0] || "there";
      dynamicVariables.unit_id = context.tenant?.unit_id ?? "unknown";
      dynamicVariables.building_address = context.building?.address ?? "unknown";
      dynamicVariables.heating_type = context.building?.heating_type ?? "unknown";
      dynamicVariables.partner_name = context.partner?.name ?? "unknown";
      dynamicVariables.available_slots = Array.from(windows, ([id, slot]) => `${id} = ${labelSlot(slot)}`).join("; ") || "none";
    } catch {
      // Backend unreachable: still start; DORA greets generically and her tools report the problem.
    }

    let disconnected = false;
    try {
      const conversation = await Conversation.startSession({
        agentId,
        clientTools,
        dynamicVariables,
        onConnect: () => status("connected"),
        onDisconnect: () => {
          disconnected = true;
          session = undefined;
          status("disconnected");
        },
        onMessage: message => notify(onMessage, message),
        onError: () => reportError("DORA's voice session encountered a problem. Try again or use the text form."),
        onModeChange: ({ mode }) => status("connected", mode),
        onStatusChange: ({ status: value }) => status(value),
      });
      if (!disconnected) session = conversation;
    } catch {
      reportError("DORA couldn't start the voice session. Try again or use the text form.");
      status("disconnected");
    }
  }

  async function start() {
    if (starting || stopping || session) return;
    if (!agentId?.trim()) {
      reportError("DORA voice is unavailable until a public agent ID is configured. You can use the text form.");
      return;
    }
    starting = connect();
    try {
      await starting;
    } finally {
      starting = undefined;
    }
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    try {
      await starting;
      await session?.endSession();
      session = undefined;
      status("disconnected");
    } catch {
      reportError("DORA couldn't end the voice session. Please try again.");
    } finally {
      stopping = false;
    }
  }

  return { start, stop, clientTools };
}
