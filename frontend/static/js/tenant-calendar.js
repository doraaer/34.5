(() => {
  "use strict";
  const D = window.Dora;
  const element = id => document.getElementById(id);
  const day = element("calendar-day"), agenda = element("calendar-agenda");
  const note = document.querySelector("#booking .calendar-note");
  const fallback = note.cloneNode(true);
  const dateFormat = new Intl.DateTimeFormat("sv-SE", {timeZone:"Europe/Berlin", year:"numeric", month:"2-digit", day:"2-digit"});
  const timeFormat = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/Berlin", hour:"2-digit", minute:"2-digit"});
  const proposals = new Map(), files = new Map();
  let record = null, partner = null, busy = [], connection = "Loading calendar…", generation = 0, signature;
  const confirmed = () => ["scheduled","in_progress","completed"].includes(record?.status) && D.validSlot(record.appointment);

  function draw() {
    const id = record?.case_id;
    const blocks = busy.map(slot => ({slot, label:"Busy", kind:"busy"}));
    const add = (slot, label, kind) => { if (D.validSlot(slot)) blocks.push({slot, label, kind}); };
    let message = connection;
    if (!connection) {
      if (confirmed()) {
        add(record.appointment, "Heating repair — confirmed", "confirmed");
      } else if (record?.status === "needs_attention") {
        message = "The heating company declined this time. Nothing is booked.";
      } else if (record?.status === "awaiting_partner") {
        add(record.available_slots?.[0], "Waiting for heating company — not confirmed", "waiting");
      } else if (record?.status === "reported") {
        if (record.available_slots?.length) {
          record.available_slots.forEach(slot => add(slot, "Approved by you", "approved"));
        } else {
          (proposals.get(id) || []).forEach((slot, index) => add(slot, "Proposed by DORA", index ? "proposal" : "proposal first"));
        }
      }
    }
    const key = JSON.stringify([day.value, message, blocks, partner?.name, files.get(id)?.href, id]);
    if (signature === key) return;
    signature = key;
    element("calendar-status").textContent = message;
    element("calendar-days").hidden = Boolean(connection);
    if (connection) return;
    const rows = [];
    for (let hour = 8; hour <= 18; hour++) {
      const row = D.el("div", "", "calendar-hour");
      row.append(D.el("span", String(hour).padStart(2,"0") + ":00"));
      const entries = D.el("div");
      for (const {slot, label, kind} of blocks.slice().sort((a,b) => Date.parse(a.slot.start)-Date.parse(b.slot.start))) {
        const start = new Date(slot.start), end = new Date(slot.end);
        const clock = timeFormat.format(start);
        if (dateFormat.format(start) !== day.value || Number(clock.slice(0,2)) !== hour) continue;
        const entry = D.el("div", "", "calendar-event " + kind);
        entry.append(D.el("strong", label), D.el("small", clock + "–" + timeFormat.format(end)));
        if (slot.label) entry.title = slot.label;
        if (kind === "confirmed") {
          if (partner?.partner_id === record.partner_id) entry.append(D.el("small", partner.name));
          if (files.has(id)) entry.append(files.get(id).cloneNode(true));
        }
        entries.append(entry);
      }
      row.append(entries); rows.push(row);
    }
    agenda.replaceChildren(...rows);
  }
  async function loadBusy() {
    const request = ++generation;
    try {
      const data = await D.api("/api/calendar/busy");
      if (request !== generation) return;
      if (!data.simulated || !Array.isArray(data.busy)) throw new Error("Invalid calendar");
      busy = data.busy.filter(D.validSlot); connection = "";
      note.replaceChildren(D.el("strong", "Simulated calendar connected (demo data)"));
    } catch (error) {
      if (request !== generation) return;
      busy = [];
      connection = [404,409].includes(error.status) ? "No calendar connected" : "Calendar unavailable";
      note.replaceChildren(...fallback.cloneNode(true).childNodes);
    }
    draw();
  }
  day.onchange = draw;
  window.tenantCalendar = {
    select(next, nextPartner) {
      const changed = next?.case_id !== record?.case_id;
      record = next; partner = nextPartner;
      if (record && (record.status !== "reported" || record.available_slots?.length)) proposals.delete(record.case_id);
      if (changed) loadBusy();
      draw();
    },
    propose(id, slots) {
      if (id) proposals.set(id, Array.isArray(slots) ? slots.filter(D.validSlot) : []);
      draw();
    },
    calendarFile(filename, link) {
      const match = /^heating-repair-(.+)\.ics$/.exec(filename);
      if (match) files.set(match[1], link);
      draw();
    }
  };
  loadBusy();
})();
