const D = window.Dora;
const jobs = document.querySelector("#jobs");
const info = document.querySelector("#info");
const hour = 3600000;
let loading = false;
let writing = false;
let signature = "";
const drafts = new Map();
const selections = new Map();
const sampleVisits = [
  ["2026-11-23T09:00:00+01:00", "2026-11-23T11:00:00+01:00", "Unit 104", "Valve check"],
  ["2026-11-24T13:00:00+01:00", "2026-11-24T15:00:00+01:00", "Unit 101", "Boiler visit"],
  ["2026-11-25T10:00:00+01:00", "2026-11-25T12:00:00+01:00", "Unit 105", "Radiator check"],
  ["2026-11-27T14:00:00+01:00", "2026-11-27T16:00:00+01:00", "Unit 103", "Service visit"]
];
let currentJobs = [], freeWindows = [], weekStart, proposalId;
const day = 24 * hour;
const dateKey = new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Berlin", year:"numeric", month:"2-digit", day:"2-digit"});
const timeText = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/Berlin", hour:"2-digit", minute:"2-digit"});
const dayName = new Intl.DateTimeFormat("en-GB", {timeZone:"UTC", weekday:"short"});
const weekLabel = new Intl.DateTimeFormat("en-GB", {timeZone:"UTC", day:"numeric", month:"short", year:"numeric"});

function mondayFor(value) {
  const date = new Date(dateKey.format(new Date(value)) + "T00:00:00Z");
  return date.getTime() - ((date.getUTCDay() + 6) % 7) * day;
}

function calendarEntries() {
  const entries = [];
  for (const job of currentJobs) {
    const unit = job.location?.match(/\bunit[-\s]+(\d+)\b/i);
    const title = unit ? "Unit " + unit[1] : job.partner_job_id;
    if (job.slot) entries.push({...job.slot, title, detail:job.description, kind:"booked"});
    else if (job.status === "received" && job.partner_job_id === proposalId) {
      const start = selections.get(proposalId);
      if (start) entries.push({start, end:new Date(Date.parse(start) + hour).toISOString(), title, detail:job.description, kind:"proposal"});
    }
  }
  const reserved = [...freeWindows, ...entries];
  for (const [start, end, title, detail] of sampleVisits) {
    // Samples only decorate unused time. They never change the API's availability.
    const overlaps = reserved.some(s => Date.parse(start) < Date.parse(s.end) && Date.parse(s.start) < Date.parse(end));
    if (!overlaps) entries.push({start, end, title, detail, kind:"demo"});
  }
  return entries;
}

function renderCalendar() {
  if (weekStart === undefined) return;
  const entries = calendarEntries();
  const days = Array.from({length:7}, (_, i) => new Date(weekStart + i * day));
  const grid = document.querySelector("#calendar");
  document.querySelector("#week-range").textContent = weekLabel.formatRange(days[0], days[6]) + " · Berlin time";
  grid.replaceChildren(D.el("span", "", "time-head"));
  for (const date of days) {
    const head = D.el("div", "", "day-head");
    head.append(D.el("small", dayName.format(date)), D.el("strong", date.getUTCDate()));
    grid.append(head);
  }
  const firstKey = days[0].toISOString().slice(0,10), lastKey = days[6].toISOString().slice(0,10);
  const visible = entries.filter(e => dateKey.format(new Date(e.start)) <= lastKey && dateKey.format(new Date(e.end)) >= firstKey);
  const minute = t => Number(t.slice(0,2)) * 60 + Number(t.slice(3));
  const overnight = visible.some(e => dateKey.format(new Date(e.start)) !== dateKey.format(new Date(e.end)));
  const first = overnight ? 0 : Math.min(8, ...visible.map(e => Math.floor(minute(timeText.format(new Date(e.start))) / 60)));
  const last = overnight ? 24 : Math.max(18, ...visible.map(e => Math.ceil(minute(timeText.format(new Date(e.end))) / 60)));
  grid.style.setProperty("--hours", last - first);
  const axis = D.el("div", "", "axis");
  for (let h = first; h < last; h++) axis.append(D.el("small", String(h).padStart(2,"0") + ":00"));
  grid.append(axis);
  for (const date of days) {
    const key = date.toISOString().slice(0,10);
    const col = D.el("div", "", "day-col");
    for (const entry of visible) {
      const start = new Date(entry.start), end = new Date(entry.end);
      const from = dateKey.format(start), until = dateKey.format(end);
      if (key < from || key > until) continue;
      const a = key === from ? minute(timeText.format(start)) : 0;
      const b = key === until ? minute(timeText.format(end)) : 1440;
      if (b <= a) continue;
      const block = D.el("div", "", "visit " + entry.kind);
      block.style.top = ((a / 60 - first) / (last - first) * 100) + "%";
      block.style.height = ((b - a) / 60 / (last - first) * 100) + "%";
      const times = timeText.format(start) + "–" + timeText.format(end);
      const kind = {demo:"Demo visit", proposal:"Proposed", booked:"Booked"}[entry.kind];
      block.title = [kind, entry.title, entry.detail, times].join(" · ");
      block.append(D.el("small", times), D.el("strong", entry.title), D.el("span", entry.kind === "demo" ? entry.detail : kind));
      col.append(block);
    }
    grid.append(col);
  }
}

for (const [id, direction] of [["previous-week",-1],["next-week",1]]) {
  document.getElementById(id).onclick = () => {
    if (weekStart !== undefined) { weekStart += direction * 7 * day; renderCalendar(); }
  };
}
const berlin = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "short",
  hour: "2-digit", minute: "2-digit"
});
const states = {received:"Awaiting response", accepted:"Scheduled", in_progress:"In progress", completed:"Completed", rejected:"Rejected"};

function slotText(slot) {
  return berlin.formatRange(new Date(slot.start), new Date(slot.end));
}

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
    info.classList.remove("error");
    info.textContent = {accept:"Accepted", reject:"Rejected", start:"Work started", complete:"Repair completed"}[action];
  } catch (error) {
    info.classList.add("error");
    info.textContent = action === "accept" && error.status === 409 ? "That time is no longer available" : error.message;
  } finally {
    writing = false;
    await refresh();
  }
}

function incoming(card, job, free) {
  const id = job.partner_job_id;
  const windows = job.available_slots || [];
  const schedule = D.el("div", "", "schedule");
  const availability = D.el("div", "", "field");
  availability.append(D.el("strong", "Tenant availability · Berlin time"));
  for (const slot of windows) availability.append(D.el("p", slotText(slot)));
  const appointment = D.el("div", "", "field");
  appointment.append(D.el("strong", "Your appointment · Berlin time"));
  schedule.append(availability, appointment);
  card.append(schedule);
  const slots = hoursInside(windows, free);
  const select = document.createElement("select");
  select.setAttribute("aria-label", "One-hour appointment");
  slots.forEach(slot => select.add(new Option(slotText(slot), slot.start)));
  if (slots.some(slot => slot.start === selections.get(id))) select.value = selections.get(id);
  const chosen = () => slots.find(slot => slot.start === select.value);
  const accept = button("Accept", () => act(job, "accept", {slot: chosen()}));
  accept.className = "primary";
  const update = () => {
    selections.set(id, select.value);
    accept.disabled = !chosen();
    accept.setAttribute("aria-label", chosen() ? "Accept " + slotText(chosen()) + " Berlin time" : "Accept");
  };
  update();
  select.onchange = () => {
    update();
    proposalId = id;
    weekStart = mondayFor(chosen().start);
    renderCalendar();
  };
  if (slots.length > 1) appointment.append(select);
  else appointment.append(D.el("p", slots.length ? slotText(slots[0]) : "No one-hour appointment fits the authorized times"));
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
  const actions = D.el("div", "", "actions");
  actions.append(accept, button("Reject", () => {
    drafts.set(id, reason.value); form.hidden = false; reason.focus();
  }));
  card.append(actions, form);
}

function cardFor(job, free) {
  const urgent = job.priority === "urgent";
  const card = D.el("section", "", "card" + (urgent ? " urgent" : ""));
  const heading = D.el("div", "", "order-heading");
  heading.append(D.el("span", states[job.status] || job.status, "state " + job.status));
  if (urgent) {
    const flag = D.el("span", "Urgent", "urgent-flag");
    flag.title = "The tenant marked this as urgent (no heating or vulnerable people affected)";
    heading.append(flag);
  }
  heading.append(D.el("h3", job.description));
  card.append(heading, D.el("p", job.location, "location"));
  if (job.status === "received") incoming(card, job, free);
  if (job.slot) card.append(D.el("p", "Appointment · " + slotText(job.slot) + " · Berlin time", "record"));
  if (job.status === "rejected" && job.rejection_reason) card.append(D.el("p", "Reason · " + job.rejection_reason, "record"));
  if (job.status === "completed" && job.service_report) card.append(D.el("p", job.service_report.summary, "record"));
  if (job.status === "accepted") card.append(button("Start work", () => act(job, "start")));
  if (job.status === "in_progress") card.append(button("Complete repair", () => act(job, "complete", {
    service_report: {summary:"Heating restored", work_done:"SHK technician inspected and repaired reported heating issue"},
    invoice: {invoice_id:"INV-" + job.partner_job_id, amount_eur:180, currency:"EUR", recipient:"property_owner"}
  })));
  card.append(D.el("p", job.partner_job_id + "  /  " + job.case_id, "refs"));
  return card;
}

async function refresh() {
  if (loading || writing) return;
  loading = true;
  try {
    const [rows, free] = await Promise.all([D.api("/partner/jobs"), D.api("/partner/availability")]);
    const next = JSON.stringify([rows, free]);
    if (next !== signature) {
      currentJobs = rows;
      freeWindows = free;
      const pending = rows.filter(job => job.status === "received");
      if (!pending.some(job => job.partner_job_id === proposalId)) proposalId = pending[0]?.partner_job_id;
      if (weekStart === undefined) weekStart = mondayFor(pending[0]?.available_slots[0]?.start || free[0]?.start || rows[0]?.slot?.start || sampleVisits[0][0]);
      // Urgent jobs that still need an answer go to the top; everything else keeps its order.
      const needsUrgentAnswer = job => job.priority === "urgent" && job.status === "received";
      const ordered = [...rows.filter(needsUrgentAnswer), ...rows.filter(job => !needsUrgentAnswer(job))];
      jobs.replaceChildren(...ordered.map(job => cardFor(job, free)));
      if (!rows.length) jobs.textContent = "No incoming jobs yet.";
      renderCalendar();
      signature = next;
    }
  } catch (error) { info.textContent = error.message; }
  finally { loading = false; }
}
document.querySelector("#refresh").onclick = refresh;
D.poll(refresh);
