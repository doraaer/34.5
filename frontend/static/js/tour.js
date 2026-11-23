// Guided demo tour with driver.js (https://github.com/kamranahmedse/driver.js).
// Off by default: add ?tour=1 to /tenant, /partner or /centrix to start it.
// Each page's last step links to the next page so one tour covers all three parties.
(() => {
  "use strict";
  if (new URLSearchParams(location.search).get("tour") !== "1") return;

  const DRIVER = "https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/";
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = DRIVER + "driver.css";
  document.head.append(css);
  const theme = document.createElement("style");
  theme.textContent = `
    .driver-popover.dora-tour { background:#21123a; color:#f6e9ff; border:1px solid #ebc3ff3d; border-radius:18px;
      box-shadow:0 30px 80px #0b0314c4; font-family:inherit; max-width:340px; }
    .driver-popover.dora-tour .driver-popover-title { display:block; position:static; padding:0; margin:0 0 6px; border:0;
      background:none; backdrop-filter:none; font-size:20px; letter-spacing:-.02em; }
    .driver-popover.dora-tour .driver-popover-description { color:#d9c8ec; line-height:1.45; }
    .driver-popover.dora-tour .driver-popover-progress-text { color:#b9a6cf; }
    .driver-popover.dora-tour button { background:#f3e4ff; color:#16092a; border:0; border-radius:999px; text-shadow:none; padding:6px 14px; }
    .driver-popover.dora-tour .driver-popover-close-btn { background:transparent; color:#d9c8ec; }
    .driver-popover.dora-tour .driver-popover-arrow { border-color:#21123a; }`;
  document.head.append(theme);

  const go = (path) => () => { location.href = path + "?tour=1"; };
  let tour;

  const tours = {
    "/tenant": () => [
      { element: "#open-dora", popover: { title: "Meet DORA", description: "The resident taps once to talk. No forms, no hotline.",
        onNextClick: () => { document.querySelector("#open-dora")?.click(); setTimeout(() => tour.moveNext(), 1500); } } },
      { element: ".assistant-stage", popover: { title: "Just say what's wrong", description: "“My radiators are cold.” DORA already knows the home, so it only asks what's missing: which rooms, how urgent, when you're free." } },
      { element: "#report-form", popover: { title: "Or write it", description: "No microphone? The same request can be typed here." } },
      { element: "#calendar-toggle", popover: { title: "Your calendar", description: "DORA proposes an hour when you're actually free, and adds the visit once it's confirmed." } },
      { element: "#library", popover: { title: "Track the request", description: "Every request keeps its status: reported, waiting for the heating company, confirmed, in progress, done.",
        nextBtnText: "Heating company →", onNextClick: go("/partner") } },
    ],
    "/partner": () => [
      { element: "#jobs > .card", popover: { title: "The heating company's side", description: "The building's contracted SHK partner gets a clear work order: problem, unit, urgency and the resident's free hours." } },
      { element: "#calendar", popover: { title: "Accept a slot", description: "The technician picks a proposed hour. Only this acceptance confirms the appointment. Then: start work, complete, attach report and invoice.",
        nextBtnText: "Property manager →", onNextClick: go("/centrix") } },
    ],
    "/centrix": () => [
      { element: "#case-select", popover: { title: "The property manager's record", description: "Every request is one case in Centrix, from the resident's words to the final documents." } },
      { element: "#case-detail", popover: { title: "Loop closed", description: "Status timeline, confirmed appointment, service report and invoice, all on the same case. Say it once. Consider it fixed.",
        nextBtnText: "Done" } },
    ],
  };

  const steps = tours[location.pathname];
  if (!steps) return;
  const js = document.createElement("script");
  js.src = DRIVER + "driver.js.iife.js";
  js.onload = () => setTimeout(() => {
    const list = steps();
    tour = window.driver.js.driver({
      showProgress: true, popoverClass: "dora-tour", overlayColor: "#0b0314", overlayOpacity: 0.72,
      stagePadding: 8, stageRadius: 18, allowClose: true, steps: list,
    });
    tour.drive();
  }, 900);
  document.head.append(js);
})();
