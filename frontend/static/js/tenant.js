(() => {
  "use strict";
  const D = window.Dora, $ = id => document.getElementById(id);
  let context = null, cases = [], current = D.storageGet("dora_case_id"), selected = null;
  let windows = [], mutation = false, epoch = 0, caseSignature = "", listSignature = "";
  let slotsLoading = false, uncertainCreate = false, refreshing = false;
  const bookingFields = $("booking-fields"), reportFields = $("report-fields");
  function showLibrary(open) {
    $("requests").hidden = !open;
    document.querySelector(".welcome").hidden = open;
    $("library").setAttribute("aria-expanded", String(open));
    window.scrollTo(0, 0);
    if (!open) $("conversation").scrollTop = 0;
    (open ? $("library-title") : $("conversation").querySelector("h1")).focus({preventScroll:true});
  }
  $("library").onclick = () => showLibrary($("requests").hidden);
  $("back-assistant").onclick = () => showLibrary(false);
  $("urgent").onclick = event => {
    const button = event.currentTarget;
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
  };
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
    window.tenantCalendar.select(selected, context?.partner);
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
        button.append(D.el("span", D.state(c)[0], "request-status"));
        button.title = c.case_id;
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
      const previous = $("slot").querySelector(":checked")?.value;
      const date = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/Berlin", weekday:"short", day:"numeric", month:"short"});
      const clock = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/Berlin", hour:"2-digit", minute:"2-digit"});
      $("slot").replaceChildren(...windows.map(slot => {
        const start = new Date(slot.start), end = new Date(slot.end);
        const label = D.el("label", "", "visit-option");
        const radio = document.createElement("input");
        radio.type = "radio"; radio.name = "visit-window"; radio.required = true;
        radio.value = JSON.stringify([slot.start, slot.end]); radio.checked = radio.value === previous;
        const endDay = date.format(start) === date.format(end) ? "" : date.format(end) + " ";
        label.append(radio, D.el("strong", date.format(start)), D.el("span", clock.format(start) + "–" + endDay + clock.format(end)));
        return label;
      }));
      $("slot-feedback").textContent = windows.length ? "" : "The heating company has no free times right now. Your request is saved; try again later.";
      $("retry-slots").hidden = windows.length > 0;
    } catch (error) {
      windows = []; $("slot").replaceChildren();
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
        description, priority: $("urgent").getAttribute("aria-pressed") === "true" ? "urgent" : "routine", tenant_id: context.tenant.tenant_id, unit_id: context.tenant.unit_id
      }) });
      if (!result.case_id) { const error = new Error("We couldn’t verify the saved request."); error.uncertain = true; throw error; }
      current = result.case_id; D.storageSet("dora_case_id", current);
      cases = [result, ...cases.filter(c => c.case_id !== current)];
      $("description").value = ""; $("booking-form").reset(); D.feedback($("booking-feedback"), "");
      render(); D.feedback($("booking-feedback"), "Request saved. Choose when you can be home, then send it to the heating company.");
      $("urgent").setAttribute("aria-pressed", "false");
      showLibrary(true);
    } catch (error) {
      uncertainCreate = !!error.uncertain;
      D.feedback($("report-feedback"), error.message + (error.uncertain ? " The request may have been saved. Refresh and review your saved requests before submitting again." : ""), true);
    } finally {
      mutation = false; epoch++; $("create").textContent = "Send request"; controls();
    }
  });
  $("booking-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (mutation || selected?.status !== "reported") return;
    const value = $("slot").querySelector(":checked")?.value;
    const slot = windows.find(item => JSON.stringify([item.start, item.end]) === value);
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
      render(); D.feedback($("booking-feedback"), "Request sent. The heating company still needs to confirm your appointment.");
    } catch (error) {
      D.feedback($("booking-feedback"), error.message + (stage === "dispatch" ? " Your availability was saved. Refresh to check whether the request was sent before trying again." : " Your request is saved, but availability could not be verified. Refresh before trying again."), true);
    } finally {
      mutation = false; epoch++; $("dispatch").textContent = "Send request to heating company"; controls();
      await refresh();
    }
  });
  const landing = $("dora-landing");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const descriptionField = $("description");
  const examples = [
    descriptionField.placeholder,
    "The heating turns off every evening.",
    "Only one room in my flat feels warm."
  ];
  let example = 0, length = examples[0].length, deleting = true, timer;
  let composerVisible = false;
  function typeExample() {
    const phrase = examples[example];
    length += deleting ? -1 : 1;
    descriptionField.placeholder = phrase.slice(0, length);
    if (!length) {
      example = (example + 1) % examples.length;
      deleting = false;
    } else if (length === phrase.length) {
      deleting = true;
    }
    const pause = deleting && length === phrase.length ? 1800 : !length ? 330 : deleting ? 32 : 60;
    timer = setTimeout(typeExample, pause);
  }
  function resetExamples() {
    clearTimeout(timer);
    descriptionField.placeholder = examples[example];
    length = examples[example].length;
    deleting = true;
    if (composerVisible && !motion.matches && !document.hidden &&
        document.activeElement !== descriptionField && !descriptionField.value) {
      timer = setTimeout(typeExample, 1800);
    }
  }
  new IntersectionObserver(([entry]) => {
    composerVisible = entry.isIntersecting;
    resetExamples();
  }, {threshold: .5}).observe(descriptionField);
  descriptionField.addEventListener("focus", resetExamples);
  descriptionField.addEventListener("blur", resetExamples);
  document.addEventListener("visibilitychange", resetExamples);
  motion.addEventListener("change", resetExamples);
  const conversation = $("conversation");
  let wheelDistance = 0, lastWheel = 0, latched = false;
  conversation.addEventListener("wheel", event => {
    if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (event.target === descriptionField && descriptionField.scrollHeight > descriptionField.clientHeight) return;
    const now = performance.now();
    if (now - lastWheel > 170 || wheelDistance * event.deltaY < 0) {
      wheelDistance = 0;
      latched = false;
    }
    lastWheel = now;
    wheelDistance += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? conversation.clientHeight : 1);
    const stage = document.querySelector(".composer-stage");
    if (stage.offsetHeight > conversation.clientHeight + 2 && conversation.scrollTop >= conversation.clientHeight - 2) return;
    event.preventDefault();
    if (latched || Math.abs(wheelDistance) < 16) return;
    latched = true;
    conversation.scrollTo({top: wheelDistance > 0 ? conversation.clientHeight : 0,
      behavior: motion.matches ? "instant" : "smooth"});
  }, {passive:false});
  document.querySelector(".write-link").onclick = event => {
    event.preventDefault();
    document.querySelector(".composer-stage").scrollIntoView({behavior: motion.matches ? "instant" : "smooth"});
    descriptionField.focus({preventScroll:true});
  };
  landing.addEventListener("pointermove", event => {
    if (motion.matches || event.pointerType !== "mouse") return;
    const bounds = landing.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    landing.style.setProperty("--mouse-x", x * 92 + "px");
    landing.style.setProperty("--mouse-y", y * 72 + "px");
  });
  landing.addEventListener("pointerleave", () => {
    landing.style.removeProperty("--mouse-x");
    landing.style.removeProperty("--mouse-y");
  });
  $("open-dora").onclick = () => {
    const opener = $("open-dora");
    opener.disabled = true;
    opener.setAttribute("aria-expanded", "true");
    opener.classList.add("opening");
    const reveal = () => {
      $("dora-landing").hidden = true;
      $("dora-app").hidden = false;
      $("conversation").hidden = false;
      $("conversation").querySelector("h1").focus({ preventScroll: true });
    };
    const opening = opener.getAnimations().find(animation => animation.animationName === "dissolve");
    if (opening) opening.finished.then(reveal, reveal);
    else reveal();
  };
  $("retry-slots").onclick = loadSlots;
  $("slot").onchange = () => { $("booking-consent").checked = false; $("sharing-consent").checked = false; };
  $("refresh").onclick = refresh;
  // DORA voice (tenant-voice.js) announces cases it creates or updates, so the saved requests stay in sync.
  window.addEventListener("dora:case-updated", event => {
    const id = event.detail?.case_id;
    if (id && !mutation) { current = id; D.storageSet("dora_case_id", id); }
    caseSignature = ""; listSignature = ""; refresh();
  });
  D.poll(refresh); loadSlots();
})();
