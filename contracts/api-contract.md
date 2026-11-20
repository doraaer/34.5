# DORA HTTP contract — v0 (freeze before parallel work)

Base: local `http://127.0.0.1:8000`; JSON camel/snake policy: **snake_case**.

## Resident / core
- `GET /health` → `{"status":"ok"}`
- `GET /api/context` → seeded `tenant`, `unit`, `building`, `partner` (mock Centrix)
- `POST /api/cases` → `{"description":"Radiators not heating", "priority":"routine"}`; returns full case with `case_id` and `status:"reported"`.
- `GET /api/cases/{case_id}` → full case, including appointment, report, invoice if available
- `GET /api/cases` → list cases, newest first
- `POST /api/cases/{case_id}/availability` → `{"available_slots":["2026-11-23T14:00:00+01:00"],"booking_authorized":true}`; updates consent.
- `POST /api/cases/{case_id}/dispatch` → creates partner job and changes case to `awaiting_partner`; don't claim confirmed.

## Mock SHK partner
- `GET /partner/services` → heating repair/maintenance offerings
- `GET /partner/availability` → partner slot list, each with ISO datetime + offset
- `GET /partner/jobs` → list job records
- `POST /partner/jobs` → `{"case_id":"CASE-001","description":"...","available_slots":[...]}`; returns `partner_job_id`, requested status
- `POST /partner/jobs/{job_id}/accept` → `{"slot":"2026-11-23T14:00:00+01:00"}`; updates partner and linked Centrix case to scheduled
- `POST /partner/jobs/{job_id}/start` → in_progress
- `POST /partner/jobs/{job_id}/complete` → `{"service_report":"...","invoice":{"invoice_id":"INV-001","amount_eur":125.0,"billed_to":"owner"}}`; updates core case to completed

## Production interface to implement (not yet implied working)
- `POST /internal/partner-events` with authenticated partner event, event ID, case ID, job ID, accepted/scheduled/completed status; idempotent.
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
