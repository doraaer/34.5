// Run against a disposable, empty demo database. Creates a fictional completed repair.
const { chromium } = require(process.env.DORA_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.DORA_CHROME_PATH });
  try {
    const context = await browser.newContext({ baseURL: process.env.DORA_BASE_URL || "http://127.0.0.1:8000" });
    const manager = await context.newPage();
    const detail = manager.locator("#case-detail");
    const refresh = async () => {
      await manager.bringToFront();
      await manager.getByRole("button", { name: "Refresh" }).click();
    };
    const status = async label => detail.locator(".pill").filter({ hasText: label }).waitFor();

    await manager.goto("/centrix");
    await detail.getByText("No maintenance records yet").waitFor();
    await manager.goto("/centrix?case=missing");
    await detail.getByText("Case not found").waitFor();

    const tenant = await context.newPage();
    await tenant.goto("/tenant");
    await tenant.locator("#open-dora").click();
    await tenant.locator(".write-link").click();
    await tenant.locator("#description").fill("Centrix smoke: cold bedroom radiator");
    await tenant.locator("#create").click();
    await tenant.locator("#case .pill").filter({ hasText: "Reported" }).waitFor();
    const id = await tenant.locator("#case .case-id").textContent();
    const link = await tenant.locator('#case a[href^="/centrix"]').getAttribute("href");
    await refresh();
    await manager.locator("#case-select").selectOption(id);
    await status("Reported");
    await manager.goto(link);
    await status("Reported");
    assert.equal(await manager.locator("#case-select").inputValue(), id);

    await tenant.bringToFront();
    await tenant.locator("#slot input").first().check();
    await tenant.locator("#booking-consent").check();
    await tenant.locator("#sharing-consent").check();
    await tenant.locator("#dispatch").click();
    await tenant.locator("#case .pill").filter({ hasText: "Waiting for heating company" }).waitFor();
    await refresh();
    await status("Waiting for heating company");
    assert.equal(await detail.locator(".appointment").count(), 0);
    await detail.getByText(/Not received yet. The provider/).waitFor();

    const provider = await context.newPage();
    await provider.goto("/partner");
    const job = provider.locator(".card").filter({ hasText: id });
    await job.locator("select").selectOption({ index: 1 });
    await job.getByRole("button", { name: /Accept .*15:00/ }).click();
    await job.getByRole("button", { name: "Start work" }).waitFor();
    await refresh();
    await status("Appointment confirmed");
    await detail.locator(".appointment").filter({ hasText: /15:00.*16:00/ }).waitFor();
    await provider.bringToFront();
    await job.getByRole("button", { name: "Start work" }).click();
    await job.getByRole("button", { name: "Complete repair" }).waitFor();
    await refresh();
    await status("Work in progress");
    await provider.bringToFront();
    await job.getByRole("button", { name: "Complete repair" }).click();
    await job.getByText("Completed", { exact: true }).waitFor();
    await refresh();
    await status("Completed");
    const record = await (await context.request.get("/api/cases/" + id)).json();
    for (const value of [record.service_report.summary, record.service_report.work_done, record.invoice.invoice_id, "€180.00", "Property owner", "EUR"]) {
      await detail.getByText(value, { exact: true }).waitFor();
    }
    await manager.route("**/api/cases", route => route.abort());
    await refresh();
    await manager.getByText(/Showing the last available records/).waitFor();
    await status("Completed");
    await manager.setViewportSize({ width: 390, height: 844 });
    assert.ok(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await manager.reload();
    await detail.getByText(/could not be loaded/).waitFor();
    await manager.unroute("**/api/cases");
    await refresh();
    await status("Completed");
    console.log("PASS: Centrix lifecycle, case links, documents, failure recovery and mobile layout");
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
