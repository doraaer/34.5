/* Run against an already running local FastAPI server.
   DORA_PLAYWRIGHT_PATH may point to an existing Playwright installation.
   Creates fictional test cases in the local demo database. */
const { chromium } = require(process.env.DORA_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.DORA_CHROME_PATH ? { executablePath: process.env.DORA_CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const base = process.env.DORA_BASE_URL || "http://127.0.0.1:8000";
  const waitText = async (locator, text) => {
    await locator.filter({ hasText: text }).waitFor({ state: "visible", timeout: 15000 });
  };
  try {
    await page.goto(base + "/tenant");
    assert.equal(await page.locator("#dora-app").isVisible(), false);
    assert.ok(await page.locator("#open-dora img").evaluate(async img => {
      await img.decode();
      return img.naturalWidth > 0;
    }));
    await page.locator("#open-dora").click();
    await page.locator("#report-fields:not([disabled])").waitFor();
    await page.locator("#library").click();
    await waitText(page.locator("#home-context"), "Lena Demo");
    await page.locator("#back-assistant").click();
    const description = "Browser smoke: cold living room radiators " + Date.now();

    await page.locator("#description").fill(description);
    await page.locator("#create").click();
    await waitText(page.locator("#case"), description);
    const caseId = await page.locator("#case .case-id").textContent();
    await page.locator("#slot").selectOption("0");
    await page.locator("#booking-consent").check();
    await page.locator("#sharing-consent").check();
    await page.locator("#dispatch").click();
    await waitText(page.locator("#case .pill"), "Waiting for provider");
    assert.equal(await page.locator("#case .appointment").count(), 0);
    await page.reload(); await page.locator("#open-dora").click(); await page.locator("#library").click();
    await waitText(page.locator("#case"), caseId);
    assert.equal(await page.locator("#case .appointment").count(), 0);
    const provider = await context.newPage();
    await provider.goto(base + "/partner");
    const card = provider.locator(".card").filter({ hasText: caseId });
    await card.locator("select").selectOption({ index: 1 });
    await card.getByRole("button", { name: /^Accept .*15:00/ }).click();
    await card.getByRole("button", { name: "Start work", exact: true }).waitFor();
    await page.bringToFront(); await page.locator("#refresh").click();
    await waitText(page.locator("#case .pill"), "Appointment confirmed");
    await waitText(page.locator("#case .appointment"), /15:00.*16:00/);
    await provider.bringToFront();
    await card.getByRole("button", { name: "Start work", exact: true }).click();
    await card.getByRole("button", { name: "Complete repair", exact: true }).waitFor();
    await page.bringToFront(); await page.locator("#refresh").click();
    await waitText(page.locator("#case .pill"), "Work in progress");
    await provider.bringToFront();
    await card.getByRole("button", { name: "Complete repair", exact: true }).click();
    await waitText(card, "Completed");
    await page.bringToFront(); await page.locator("#refresh").click();
    await waitText(page.locator("#case .pill"), "Completed");
    const manager = await context.newPage();
    await manager.goto(base + "/centrix?case=" + encodeURIComponent(caseId));
    await waitText(manager.locator("#case-detail"), "Heating restored");
    await waitText(manager.locator("#case-detail"), "€180.00");
    await waitText(manager.locator("#case-detail"), caseId);
    const screenshots = process.env.DORA_SCREENSHOT_DIR;
    if (screenshots) {
      fs.mkdirSync(screenshots, { recursive: true });
      await manager.screenshot({ path: screenshots + "/centrix.png", fullPage: true });
      await page.screenshot({ path: screenshots + "/tenant-desktop.png", fullPage: true });
    }
    // A stale appointment field cannot turn an unaccepted request into confirmation.
    assert.equal(await page.evaluate(() => window.Dora.appointment({ status: "awaiting_partner", appointment: { start: "2026-11-23T15:00:00+01:00", end: "2026-11-23T16:00:00+01:00" } })), null);
    // Reject a separate request through the real partner API.
    const request = await context.request.post(base + "/api/cases", { data: { description: "Browser smoke: provider rejection" } });
    const rejected = await request.json();
    const available = await (await context.request.get(base + "/partner/availability")).json();
    await context.request.post(base + "/api/cases/" + rejected.case_id + "/availability", { data: { available_slots: [available[0]], booking_authorized: true, data_sharing_consent: true } });
    const sent = await (await context.request.post(base + "/api/cases/" + rejected.case_id + "/dispatch")).json();
    await provider.locator("#refresh").click();
    const rejectedCard = provider.locator(".card").filter({hasText: rejected.case_id});
    await rejectedCard.getByRole("button", {name:"Reject", exact:true}).click();
    await rejectedCard.locator("textarea").fill("No technician available");
    await rejectedCard.getByRole("button", {name:"Confirm rejection"}).click();
    await waitText(rejectedCard, "Rejected");
    await page.evaluate(id => localStorage.setItem("dora_case_id", id), rejected.case_id);
    await page.reload(); await page.locator("#open-dora").click(); await page.locator("#library").click(); await waitText(page.locator("#case .pill"), "Needs attention");
    assert.equal(await page.locator("#case .appointment").count(), 0);
    // Network errors must retain the last known case rather than clear it.
    await page.route("**/api/cases", route => route.abort());
    await page.locator("#refresh").click();
    await waitText(page.locator("#sync-status"), "last available information");
    await waitText(page.locator("#case"), rejected.case_id);
    await page.unroute("**/api/cases");
    await page.locator("#refresh").click();
    await waitText(page.locator("#sync-status"), "Up to date");
    // Mobile layout and real form remain usable without horizontal overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (screenshots) await page.screenshot({ path: screenshots + "/tenant-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
    console.log("PASS: report → consent → dispatch → provider accept → start → complete → Centrix report/invoice");
    console.log("PASS: reload recovery, no premature confirmation, rejection, offline preservation, mobile overflow, no JS errors");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });


