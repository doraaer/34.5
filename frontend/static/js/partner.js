const D = window.Dora;
const jobs = document.querySelector("#jobs");
const info = document.querySelector("#info");
const hour = 3600000;
let loading = false;
let writing = false;
let signature = "";
const drafts = new Map();
const selections = new Map();

function hoursInside(authorized, free) {
  const starts = new Set();
  for (const tenant of authorized) {
    for (const tech of free) {
      const start = Math.max(Date.parse(tenant.start), Date.parse(tech.start));
      const end = Math.min(Date.parse(tenant.end), Date.parse(tech.end));
      for (let t = start; t + hour <= end; t += hour) starts.add(t);
    }
  }
  return Array.from(starts).sort((a,b) => a-b).map(t => ({
    start: new Date(t).toISOString().replace("Z", "+00:00"),
    end: new Date(t + hour).toISOString().replace("Z", "+00:00")
  }));
}

function button(label, handler) {
  const node = D.el("button", label);
  node.type = "button";
  node.onclick = handler;
  return node;
}

async function act(job, action, body) {
  if (writing) return;
  writing = true;
  try {
    await D.api("/partner/jobs/" + encodeURIComponent(job.partner_job_id) + "/" + action, {
      method: "POST", ...(body ? {body: JSON.stringify(body)} : {})
    });
    drafts.delete(job.partner_job_id);
    info.textContent = {accept:"Accepted", reject:"Rejected", start:"Work started", complete:"Repair completed"}[action];
  } catch (error) {
    info.textContent = action === "accept" && error.status === 409 ? "That time is no longer available" : error.message;
  } finally {
    writing = false;
    await refresh();
  }
}

function incoming(card, job, free) {
  const id = job.partner_job_id;
  const windows = job.available_slots || [];
  card.append(D.el("h3", "Authorized times"));
  for (const slot of windows) card.append(D.el("p", D.formatSlot(slot)));
  const slots = hoursInside(windows, free);
  const select = document.createElement("select");
  select.setAttribute("aria-label", "One-hour appointment");
  slots.forEach(slot => select.add(new Option(D.formatSlot(slot), slot.start)));
  if (slots.some(slot => slot.start === selections.get(id))) select.value = selections.get(id);
  const chosen = () => slots.find(slot => slot.start === select.value);
  const accept = button("Accept", () => act(job, "accept", {slot: chosen()}));
  const update = () => {
    selections.set(id, select.value);
    accept.disabled = !chosen();
    accept.textContent = chosen() ? "Accept " + D.formatSlot(chosen()) : "Accept";
  };
  update();
  select.onchange = update;
  if (slots.length > 1) card.append(select);
  if (!slots.length) card.append(D.el("p", "No one-hour appointment fits the authorized times"));
  const form = document.createElement("form");
  const reason = document.createElement("textarea");
  reason.setAttribute("aria-label", "Reason for rejection");
  reason.placeholder = "Reason for rejection";
  reason.required = true;
  reason.value = drafts.get(id) || "";
  reason.oninput = () => drafts.set(id, reason.value);
  const confirm = D.el("button", "Confirm rejection");
  form.hidden = !drafts.has(id);
  form.append(reason, confirm);
  form.onsubmit = event => {
    event.preventDefault();
    if (reason.value.trim()) act(job, "reject", {reason: reason.value.trim()});
    else { info.textContent = "Enter a reason for rejection."; reason.focus(); }
  };
  card.append(accept, button("Reject", () => {
    drafts.set(id, reason.value); form.hidden = false; reason.focus();
  }), form);
}

function cardFor(job, free) {
  const card = D.el("section", "", "card");
  card.append(D.el("strong", job.partner_job_id + " · " + job.status[0].toUpperCase() + job.status.slice(1)),
    D.el("p", job.description), D.el("p", job.location), D.el("p", "Case: " + job.case_id));
  if (job.status === "received") incoming(card, job, free);
  if (job.slot) card.append(D.el("p", D.formatSlot(job.slot)));
  if (job.status === "rejected" && job.rejection_reason) card.append(D.el("p", job.rejection_reason));
  if (job.status === "accepted") card.append(button("Start work", () => act(job, "start")));
  if (job.status === "in_progress") card.append(button("Complete repair", () => act(job, "complete", {
    service_report: {summary:"Heating restored", work_done:"SHK technician inspected and repaired reported heating issue"},
    invoice: {invoice_id:"INV-" + job.partner_job_id, amount_eur:180, currency:"EUR", recipient:"property_owner"}
  })));
  return card;
}

async function refresh() {
  if (loading || writing) return;
  loading = true;
  try {
    const [rows, free] = await Promise.all([D.api("/partner/jobs"), D.api("/partner/availability")]);
    const next = JSON.stringify([rows, free]);
    if (next !== signature) {
      jobs.replaceChildren(...rows.map(job => cardFor(job, free)));
      if (!rows.length) jobs.textContent = "No incoming jobs yet.";
      signature = next;
    }
  } catch (error) { info.textContent = error.message; }
  finally { loading = false; }
}
document.querySelector("#refresh").onclick = refresh;
D.poll(refresh);
