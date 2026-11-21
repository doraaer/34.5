# DORA HTTP contract — v0 (freeze before parallel work)

Base: local `http://127.0.0.1:8000`; JSON camel/snake policy: **snake_case**.

## Resident / core
- `GET /health` → `{"status":"ok"}`
- `GET /api/context` → seeded `tenant`, `unit`, `building`, `partner` (mock Centrix)
- `POST /api/cases` → `{"description":"Radiators not heating", "priority":"routine"}`; returns full case with `case_id` and `status:"reported"`.
- `GET /api/cases/{case_id}` → full case, including appointment, report, invoice if available
- `GET /api/cases` → list cases, newest first
- `POST /api/cases/{case_id}/availability` → `{"available_slots":[{"start":"2026-11-23T14:00:00+01:00","end":"2026-11-23T17:00:00+01:00"}],"booking_authorized":true,"data_sharing_consent":true}`; updates consent.
- `POST /api/cases/{case_id}/dispatch` → creates partner job and changes case to `awaiting_partner`; don't claim confirmed.

## Mock SHK partner
- `GET /partner/services` → heating repair/maintenance offerings
- `GET /partner/availability` → partner slot list, each with ISO datetime + offset
- `GET /partner/jobs` → list job records
- `POST /partner/jobs` → `{"case_id":"CASE-001","service_type":"heating_repair","location":"Musterstrasse 12, Unit 102","description":"Cold radiators","available_slots":[...],"priority":"urgent"}`; `priority` is `routine` (default) or `urgent`, copied from the case on dispatch; returns `partner_job_id`, `status: "received"` and `priority`
- `POST /partner/jobs/{job_id}/accept` → `{"slot":{"start":"2026-11-23T15:00:00+01:00","end":"2026-11-23T16:00:00+01:00"}}`; updates partner and linked Centrix case to scheduled
- `POST /partner/jobs/{job_id}/start` → in_progress
- `POST /partner/jobs/{job_id}/complete` → `{"service_report":{"summary":"Heating restored","work_done":"Checked and repaired radiator valve"},"invoice":{"invoice_id":"INV-001","amount_eur":125.0,"currency":"EUR","recipient":"property_owner"}}`; updates core case to completed

- `POST /partner/jobs/{job_id}/reject` with `{"reason":"No technician available"}` marks the job rejected and moves the linked case to `needs_attention`.
- A slot outside the provider's offered windows or tenant-authorized windows returns `409`.

## Planned scheduling

Google and phone calendar connection follow the local core flow. Phone calendar and `calendar-event` (adding the confirmed appointment to the tenant's calendar) are not built yet.

### Calendar proposal — implemented (Person 3)
- `POST /api/cases/{case_id}/calendar-proposal` → body `{}` or `{"duration_minutes":60}` (30–240, default 60). Called by DORA only after the tenant agreed to a calendar check.
- 200 → `{"proposals":[{"start":"2026-11-23T15:00:00+01:00","end":"2026-11-23T16:00:00+01:00"}],"source":"google_calendar"}`
  - Up to 3 slots, earliest first, non-overlapping, starting on the full hour, Europe/Berlin with offset.
  - Each slot lies inside a partner window (`data/fixtures/partner.json`) and the tenant's free time. Slots in the past are skipped.
  - `proposals: []` when there is no overlap.
  - `source` names where the busy time came from: `google_calendar`, or `fake_calendar` for the offline demo fallback.
- 404 unknown case; 409 `{"detail":"calendar not connected"}` when no calendar is configured or the token is rejected; 502 calendar provider failed.
- Read-only: the case is not changed. The tenant approves one proposal, then DORA calls `/availability` with exactly that slot. Partner accept/reject is unchanged; a rejection leaves the booking unconfirmed.
- `GET /api/calendar/busy` → busy blocks of the **simulated** tenant calendar, for the tenant page's demo calendar panel: `{"source":"fake_calendar","simulated":true,"busy":[{"start":"2026-11-23T13:00:00+01:00","end":"2026-11-23T15:00:00+01:00"}]}`. Covers the whole Berlin days of the partner windows, start/end only, sorted. 409 `{"detail":"calendar not connected"}` when no calendar is configured; also 409 when the provider is a real calendar (Google is never exposed here); 502 bad fixture.
- One calendar per server (env `DORA_CALENDAR_PROVIDER=google|fake`, `DORA_GOOGLE_CALENDAR_ACCESS_TOKEN`, `DORA_GOOGLE_CALENDAR_ID`, `DORA_FAKE_CALENDAR_FILE`), not per tenant. No new case fields. Google access is read-only free/busy (`calendar.freebusy` scope); only busy start/end is read, never event details.

## Production interface (partner events implemented; the rest still to do)
- `POST /internal/partner-events` — **implemented** (Person 3). Header `X-DORA-Token: <DORA_INTERNAL_TOKEN>` is required; a missing or wrong token returns `403`, and every request is refused if the token is not configured. Body:
  ```json
  {"event_id":"JOB-AB12CD34:partner.completed","type":"partner.completed","case_id":"CASE-1A2B3C4D","partner_job_id":"JOB-AB12CD34","payload":{}}
  ```
  `type` is one of `partner.accepted`, `partner.started`, `partner.completed`, `partner.rejected`. `event_id` is optional and defaults to `<partner_job_id>:<type>`. Payloads: accepted `{"slot":{start,end}}`; completed `{"service_report":{...},"invoice":{...}}`; rejected `{"reason":"..."}`. Returns the updated case. A replayed `event_id` returns the current case unchanged (idempotent). Unknown case `404`, invalid transition or slot outside authorized windows `409`, bad completion `400`. This updates the Centrix case only; the partner job record is updated by the partner service.
- `/agent/*` tool endpoints require secret/signature verified for external voice agent.
- n8n should send actual HTTP partner requests, not just draw workflow diagrams.

## Errors
400 invalid input, 403 unauthorized, 404 missing case/job, 409 invalid state transition, 502 failed downstream partner. Never return fake success. Store explicit `needs_attention` for unrecoverable partner failures.

## Transition invariants
- reported → awaiting_partner when dispatch succeeds
- awaiting_partner → scheduled only when provider accepts authorized slot
- scheduled → in_progress only when provider starts
- in_progress → completed only with service report and invoice
- duplicate events must not create duplicate jobs or invoices.

## Privacy
Share property address, issue and authorized slot with SHK; tenant phone/email only if required and consented. Do not send owner documents, unrelated tenant data or full lease.
