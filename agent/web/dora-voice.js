import { Conversation } from "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.35.0/+esm";

const caseKey = "dora_case_id";
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

export function createDoraVoice({ agentId, apiBase = "", onStatus, onMessage, onToolEvent, onError }) {
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
    const windows = new Map(context.partner.availability.map(({ start, end }, index) => [
      `W${index + 1}`, { start, end },
    ]));
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
      window_ids, booking_authorized, data_sharing_consent,
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
      return { case_id, status, authorized_windows: slots.map(labelSlot) };
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
          "I can't read your calendar right now, so let me offer the available times instead.");
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
      return { case_id, status, confirmed: false };
    }),

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

    let disconnected = false;
    try {
      const conversation = await Conversation.startSession({
        agentId,
        clientTools,
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
