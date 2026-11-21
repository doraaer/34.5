(() => {
  "use strict";
  const D = window.Dora, $ = id => document.getElementById(id);
  let cases = [], context = null, current = new URLSearchParams(location.search).get("case"), signature = "", optionsSignature = "";
  let loaded = false, chooseFirst = current === null;
  let refreshing = false;
  function render() {
    const key = JSON.stringify(cases.map(c => [c.case_id, c.status, c.description]));
    if (key !== optionsSignature) {
      optionsSignature = key;
      $("case-select").replaceChildren(new Option("Select a case", ""), ...cases.map(c => new Option(c.case_id + " · " + D.state(c)[0], c.case_id)));
      $("record-count").textContent = cases.length + (cases.length === 1 ? " maintenance record" : " maintenance records");
    }
    $("case-select").value = current || "";
    const c = cases.find(c => c.case_id === current);
    const next = JSON.stringify([current, c, context, cases.length]);
    if (next === signature) return;
    signature = next;
    if (!c) {
      const empty = D.el("div", "", "empty-state");
      empty.append(D.el("h2", current ? "Case not found" : cases.length ? "No case selected" : "No maintenance records yet"), D.el("p", current ? "This record is unavailable. Select another saved case or refresh." : cases.length ? "Choose a case from the list." : "Create a request in the resident view to start."));
      $("case-detail").replaceChildren(empty); return;
    }
    const container = D.el("div");
    const heading = D.el("div", "", "case-title");
    heading.append(D.el("h2", c.case_id, "case-id"), D.badge(c));
    container.append(heading, D.el("p", c.description, "issue"));
    if (c.status !== "needs_attention") container.append(D.timeline(c));
    if (["scheduled", "in_progress", "completed"].includes(c.status) && D.validSlot(c.appointment)) {
      const appointment = D.el("section", "", "appointment");
      appointment.append(D.el("h3", "Confirmed appointment"), D.el("p", D.formatSlot(c.appointment)));
      container.append(appointment);
    } else {
      container.append(D.el("p", "No confirmed appointment on record.", "hint"));
    }
    const sameTenant = context?.tenant?.tenant_id === c.tenant_id;
    const sameBuilding = context?.building?.building_id === c.building_id;
    const samePartner = context?.partner?.partner_id === c.partner_id;
    container.append(D.facts([
      ["Tenant", sameTenant ? context.tenant.name : c.tenant_id],
      ["Property", sameBuilding ? context.building.address : c.building_id], ["Unit", c.unit_id],
      ["Provider", samePartner ? context.partner.name : c.partner_id],
      ["Provider job", c.partner_job_id || "Not dispatched"], ["Priority", c.priority]
    ]));
    const report = D.el("section", "", "document"); report.append(D.el("h3", "Service report"));
    if (c.service_report && typeof c.service_report === "object") {
      report.append(D.el("p", c.service_report.summary || "Summary not provided"), D.el("p", c.service_report.work_done || "Work details not provided", "hint"));
    } else report.append(D.el("p", "Not received yet. The provider supplies the report after the repair.", "hint"));
    const invoice = D.el("section", "", "document"); invoice.append(D.el("h3", "Linked invoice"));
    if (c.invoice && typeof c.invoice === "object") {
      const amount = typeof c.invoice.amount_eur === "number" ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(c.invoice.amount_eur) : "Amount unavailable";
      invoice.append(D.el("p", amount, "amount"), D.facts([["Invoice ID", c.invoice.invoice_id], ["Recipient", c.invoice.recipient === "property_owner" ? "Property owner" : c.invoice.recipient], ["Currency", c.invoice.currency]]));
      invoice.append(D.el("p", "Invoice record supplied by the fictional provider. No payment is collected here.", "hint"));
    } else invoice.append(D.el("p", "Not received yet. The invoice will be linked to this case.", "hint"));
    container.append(report, invoice);
    $("case-detail").replaceChildren(container);
  }
  async function refresh() {
    if (document.hidden || refreshing) return;
    refreshing = true;
    $("refresh").disabled = true;
    D.feedback($("sync-status"), "Refreshing case records…");
    try {
      const results = await Promise.allSettled([D.api("/api/cases"), context ? Promise.resolve(context) : D.api("/api/context")]);
      if (results[0].status === "rejected") throw results[0].reason;
      if (!Array.isArray(results[0].value)) throw new Error("Case records could not be read.");
      cases = results[0].value;
      if (results[1].status === "fulfilled") context = results[1].value;
      if (chooseFirst && cases.length) { current = cases[0].case_id; chooseFirst = false; }
      loaded = true;
      render();
      D.feedback($("sync-status"), context ? "Up to date · same shared case records as the resident view" : "Cases loaded. Property names are unavailable; showing stored IDs.", !context);
    } catch (error) {
      if (!loaded) {
        $("case-select").replaceChildren(new Option("Records unavailable", ""));
        $("case-detail").replaceChildren(D.el("p", "Case records could not be loaded. Use Refresh to try again.", "hint"));
      }
      D.feedback($("sync-status"), error.message + (loaded ? " Showing the last available records. Try Refresh." : " Try Refresh."), true);
    }
    finally { refreshing = false; $("refresh").disabled = false; }
  }
  $("case-select").onchange = () => {
    chooseFirst = false; current = $("case-select").value || null;
    const url = new URL(location.href); current ? url.searchParams.set("case", current) : url.searchParams.delete("case");
    history.replaceState(null, "", url); render();
  };
  $("refresh").onclick = refresh;
  D.poll(refresh);
})();
