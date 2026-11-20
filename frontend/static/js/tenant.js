(() => {
  "use strict";
  const D = window.Dora, $ = id => document.getElementById(id);
  let context = null, cases = [], current = D.storageGet("dora_case_id"), selected = null;
  let windows = [], mutation = false, epoch = 0, caseSignature = "", listSignature = "";
  let slotsLoading = false, uncertainCreate = false, refreshing = false;
  const bookingFields = $("booking-fields"), reportFields = $("report-fields");
  function controls() {
    reportFields.disabled = !context || mutation || uncertainCreate;
    bookingFields.disabled = mutation || slotsLoading || !selected || selected.status !== "reported";
    $("dispatch").disabled = !windows.length;
    $("refresh").disabled = mutation;
  }
  function choose(id) {
    if (mutation) return;
    current = id; D.storageSet("dora_case_id", id);
    $("booking-form").reset(); D.feedback($("booking-feedback"), "");
    caseSignature = ""; listSignature = ""; render();
  }
  function render() {
    selected = cases.find(c => c.case_id === current) || null;
    const signature = JSON.stringify(selected);
    if (signature !== caseSignature) {
      caseSignature = signature;
      if (selected) {
        const node = D.caseSummary(selected);
        const link = D.el("a", "View this case in mock Centrix", "text-link");
        link.href = "/centrix?case=" + encodeURIComponent(selected.case_id); node.append(link);
        $("case").replaceChildren(node);
      } else {
        const empty = D.el("div", "", "empty-state");
        empty.append(D.el("span", "◎", "empty-symbol"), D.el("h3", "No request selected"), D.el("p", "Report your issue to start, or select one of your saved requests."));
        $("case").replaceChildren(empty);
      }
    }
    $("booking").hidden = selected?.status !== "reported";
    const historySignature = JSON.stringify([current, cases.map(c => [c.case_id, c.status, c.description])]);
    if (historySignature !== listSignature) {
      listSignature = historySignature;
      $("request-count").textContent = "(" + cases.length + ")";
      const nodes = cases.map(c => {
        const button = D.el("button", c.description, "request-item");
        button.type = "button"; button.setAttribute("aria-pressed", String(c.case_id === current));
        button.append(D.el("span", c.case_id + " · " + D.state(c)[0]));
        button.onclick = () => choose(c.case_id); return button;
      });
      $("request-list").replaceChildren(...(nodes.length ? nodes : [D.el("p", "No saved requests yet.", "hint")]));
    }
    controls();
  }
  async function loadSlots() {
    if (slotsLoading) return;
    slotsLoading = true; controls();
    $("retry-slots").hidden = true;
    try {
      const data = await D.api("/partner/availability");
      if (!Array.isArray(data)) throw new Error("Available windows could not be read.");
      windows = data.filter(D.validSlot);
      const old = $("slot").value;
      $("slot").replaceChildren(new Option("Choose a time window", ""), ...windows.map((slot, i) => new Option(D.formatSlot(slot), String(i))));
      if (windows[Number(old)] && old !== "") $("slot").value = old;
      $("slot-feedback").textContent = windows.length ? "Demo availability supplied by the provider. No calendar has been accessed." : "No provider windows are available. Your request is saved; try again later.";
      $("retry-slots").hidden = windows.length > 0;
    } catch (error) {
      windows = []; $("slot").replaceChildren(new Option("Windows unavailable", ""));
      $("slot-feedback").textContent = error.message + " Your maintenance request is still saved.";
      $("retry-slots").hidden = false;
    } finally { slotsLoading = false; controls(); }
  }
  async function refresh() {
    if (mutation || refreshing || document.hidden) return;
    refreshing = true;
    const version = epoch;
    try {
      if (!context) {
        const data = await D.api("/api/context");
        if (!data.tenant?.tenant_id || !data.tenant?.unit_id || !data.building) throw new Error("Your home details are unavailable.");
        context = data;
        $("home-context").textContent = [data.tenant.name, data.building.address, data.tenant.unit_id].filter(Boolean).join(" · ");
        $("partner-context").textContent = data.partner?.name || "Partner details unavailable";
      }
      const data = await D.api("/api/cases");
      if (!Array.isArray(data)) throw new Error("Case records could not be read.");
      if (mutation || version !== epoch) return;
      cases = data.filter(c => c.tenant_id === context.tenant.tenant_id && c.unit_id === context.tenant.unit_id);
      if (!cases.some(c => c.case_id === current)) {
        current = cases[0]?.case_id || null; D.storageSet("dora_case_id", current);
      }
      uncertainCreate = false;
      render();
      D.feedback($("sync-status"), "Up to date · checked " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    } catch (error) {
      D.feedback($("sync-status"), error.message + " Showing the last available information. Use Refresh to try again.", true);
      if (!context) { $("home-context").textContent = "Home details unavailable"; $("partner-context").textContent = "Not loaded"; }
    } finally { refreshing = false; controls(); }
  }
  $("report-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (mutation || !context || uncertainCreate) return;
    const description = $("description").value.trim();
    if (description.length < 3) { D.feedback($("report-feedback"), "Please describe the issue in a little more detail.", true); $("description").focus(); return; }
    mutation = true; epoch++; controls(); $("create").textContent = "Creating request…";
    D.feedback($("report-feedback"), "");
    try {
      const result = await D.api("/api/cases", { method: "POST", body: JSON.stringify({
        description, priority: $("priority").value, tenant_id: context.tenant.tenant_id, unit_id: context.tenant.unit_id
      }) });
      if (!result.case_id) { const error = new Error("We couldn’t verify the saved request."); error.uncertain = true; throw error; }
      current = result.case_id; D.storageSet("dora_case_id", current);
      cases = [result, ...cases.filter(c => c.case_id !== current)];
      $("description").value = ""; $("booking-form").reset(); D.feedback($("booking-feedback"), "");
      render(); D.feedback($("report-feedback"), "Request saved. Choose when you can be home, then send it to the provider.");
      $("slot").focus();
    } catch (error) {
      uncertainCreate = !!error.uncertain;
      D.feedback($("report-feedback"), error.message + (error.uncertain ? " The request may have been saved. Refresh and review your saved requests before submitting again." : ""), true);
    } finally {
      mutation = false; epoch++; $("create").textContent = "Create maintenance request"; controls();
    }
  });
  $("booking-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (mutation || selected?.status !== "reported") return;
    const value = $("slot").value, slot = value !== "" ? windows[Number(value)] : null;
    if (!slot || !$("booking-consent").checked || !$("sharing-consent").checked) {
      D.feedback($("booking-feedback"), "Choose a window and give both permissions before sending.", true); return;
    }
    const id = selected.case_id; let stage = "availability";
    mutation = true; epoch++; controls(); $("dispatch").textContent = "Sending request…";
    D.feedback($("booking-feedback"), "");
    try {
      await D.api("/api/cases/" + encodeURIComponent(id) + "/availability", { method: "POST", body: JSON.stringify({ available_slots: [slot], booking_authorized: true, data_sharing_consent: true }) });
      stage = "dispatch";
      const result = await D.api("/api/cases/" + encodeURIComponent(id) + "/dispatch", { method: "POST" });
      cases = cases.map(c => c.case_id === id ? result : c);
      render(); D.feedback($("booking-feedback"), "Request sent. The provider still needs to confirm your appointment.");
    } catch (error) {
      D.feedback($("booking-feedback"), error.message + (stage === "dispatch" ? " Your availability was saved. Refresh to check whether the request was sent before trying again." : " Your request is saved, but availability could not be verified. Refresh before trying again."), true);
    } finally {
      mutation = false; epoch++; $("dispatch").textContent = "Send request to provider"; controls();
      await refresh();
    }
  });
  $("open-dora").onclick = () => {
    const opener = $("open-dora");
    opener.disabled = true;
    opener.setAttribute("aria-expanded", "true");
    opener.classList.add("opening");
    setTimeout(() => {
      $("dora-landing").hidden = true;
      $("dora-app").hidden = false;
      $("conversation").hidden = false;
      $("conversation").querySelector("h1").focus({ preventScroll: true });
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420);
  };
  $("retry-slots").onclick = loadSlots;
  $("slot").onchange = () => { $("booking-consent").checked = false; $("sharing-consent").checked = false; };
  $("refresh").onclick = refresh;
  D.poll(refresh); loadSlots();
})();
