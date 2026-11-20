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
- `POST /partner/jobs` → `{"case_id":"CASE-001","service_type":"heating_repair","location":"Musterstrasse 12, Unit 102","description":"Cold radiators","available_slots":[...]}`; returns `partner_job_id`, `status: "received"`
- `POST /partner/jobs/{job_id}/accept` → `{"slot":{"start":"2026-11-23T15:00:00+01:00","end":"2026-11-23T16:00:00+01:00"}}`; updates partner and linked Centrix case to scheduled
- `POST /partner/jobs/{job_id}/start` → in_progress
- `POST /partner/jobs/{job_id}/complete` → `{"service_report":{"summary":"Heating restored","work_done":"Checked and repaired radiator valve"},"invoice":{"invoice_id":"INV-001","amount_eur":125.0,"currency":"EUR","recipient":"property_owner"}}`; updates core case to completed

- `POST /partner/jobs/{job_id}/reject` with `{"reason":"No technician available"}` marks the job rejected and moves the linked case to `needs_attention`.
- A slot outside the provider's offered windows or tenant-authorized windows returns `409`.

## Planned scheduling

Google and phone calendar connection follow the local core flow. Appointment-proposal operation and any new case fields are TBD (Person 3).

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
