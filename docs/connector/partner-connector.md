# DORA Partner Connector Specification (Reltix deliverable, v0)

## Purpose
Define reusable integration points so additional service partners can connect to a centrix-like maintenance platform without rewriting DORA's tenant agent or case engine. This hackathon implements ONE simulated German SHK (Sanitär/Heizung/Klima) provider; the external live integration is **not** claimed.

## Principles
- DORA and Centrix own resident context, authorization and case state.
- Partner owns its service catalogue, regional eligibility, available appointments, job acceptance, technician updates, completion report and invoice.
- Connector exposes stable generic operations; individual adapters may speak API, email or phone, but those channels have NOT been implemented equally.
- Never treat receiving an HTTP request as confirmed booking.
- Partner data sharing is limited to what's needed, consent-aware and logged.

## Minimum capabilities
1. `list_services()`: service code, name, coverage, emergency availability, requirements.
2. `check_eligibility(building, service)`: geographic and contract eligibility.
3. `get_availability(service, address, preferred_windows)`: time slots, timezone, expiration.
4. `create_job(request)`: case_id, issue, necessary access details, authorized windows, idempotency key.
5. `accept_job(job_id, slot)` or `decline_job(job_id, reason)`.
6. `get_job_status(job_id)` and/or authenticated callback for state change.
7. `complete_job(job_id, report, invoice)`: final outcome linked to original case.

## Mock REST wire shape

`GET /partner/services` returns a mock heating repair service. `GET /partner/availability` returns offered windows as `start`/`end` objects with ISO 8601 offsets. Acceptance requires a slot inside a provider window and a tenant-authorized window. An out-of-window slot returns `409`. The eligibility and signed callback capabilities above describe a future adapter. The local mock hands off events in-process.

### `POST /partner/jobs`
```json
{
  "case_id": "CASE-001",
  "service_type": "heating_repair",
  "location": "Musterstrasse 12, Unit 102, Düsseldorf, Germany",
  "description": "Resident reports cold radiators",
  "available_slots": [{"start":"2026-11-23T14:00:00+01:00","end":"2026-11-23T17:00:00+01:00"}]
}
```

## Example response to accepted booking
```json
{"partner_job_id":"SHK-JOB-001","case_id":"CASE-001","status":"accepted","slot":{"start":"2026-11-23T15:00:00+01:00","end":"2026-11-23T16:00:00+01:00"}}
```

## Example completion event
```json
{
  "event_id":"SHK-JOB-001:partner.completed",
  "type":"partner.completed",
  "case_id":"CASE-001",
  "partner_job_id":"SHK-JOB-001",
  "payload": {
    "service_report":{"summary":"Heating restored","work_done":"Repaired radiator valve"},
    "invoice":{"invoice_id":"INV-001","amount_eur":125.0,"currency":"EUR","recipient":"property_owner"}
  }
}
```

## Status semantics and ownership
`received` = delivered to partner platform, **not** assigned. `accepted` = company commits to request/slot. `in_progress` = technician attending. `completed` = report and invoice received. `rejected` = work not accepted. DORA persists a matching case lifecycle but never silently infers contractor acceptance.

## API adapter & alternative channels
Hackathon backend implements a mock REST API; provider dashboard simulates employee acceptance/completion. An email/SMS/voice adapter could translate the same request, but would require acknowledgement parsing, human confirmation, delivery error handling and service agreements. Do not label future adapters as live functionality.

## Failure and security rules
- Authentication: signed token/OAuth/API key or webhook signature; private backend configuration only.
- Idempotency: the mock returns the existing job for the same `case_id` and the stored result for repeated completion. Core deduplicates local events by `<partner_job_id>:<event_type>`.
- Timeout: retry with backoff, track delivery/ack separately; do not fabricate confirmation.
- Invalid slot: return 409 and request new options.
- Rejection: `rejected` + reason; normal escalation or another contracted partner if policy allows.
- Cancellation/rescheduling: implement in mature version; preserve audit history.
- Time: ISO 8601 timestamp and Europe/Berlin offset in this example.
- GDPR hygiene: only authorized data, retention controls, access logs; mock data in public demo.

## Extensibility
A second partner adapter satisfies the same methods and maps its native states into DORA statuses. Service catalogue and eligibility are configuration/data, not hardcoded LLM assumptions.

## Hackathon honesty
This document states the proposed full generic contract. Current scaffold runs only a simplified local mock partner. Confirm actual endpoint coverage before final submission; do not call unimplemented callback/phone features finished.
