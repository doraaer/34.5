# DORA partner connector specification

Team 34.5 · Reltix track · Residential heating repair

## Why this partner

When a resident reports cold radiators, the property manager already knows which contractor covers the building. The missing pieces are permission to share the repair request, a time the resident can let a technician in, and evidence that the repair was completed. DORA connects those steps through one work order.

The example uses a fictional German heating contractor, `SHK-001`, assigned to a six-unit building with central gas heating. The resident authorizes a visit to Unit 102. The contractor chooses a time, records the work performed and sends an invoice addressed to the property owner. The manager can follow the same case from the first report to the repair outcome.

## What a provider implements

DORA owns the resident’s authorization and the Centrix case, identified by `case_id`. The provider owns its capacity, its work order (`partner_job_id`), and the account of what its technician did. The demo runs locally at `http://127.0.0.1:8000`. All request and response bodies use JSON.

| Capability | Mock provider interface | Provider responsibility |
|---|---|---|
| Service and eligibility | `GET /partner/services` | Return the catalogue. In the demo, the building fixture identifies its contracted provider and the catalogue offers `heating_repair`. A new provider must define which services and buildings it covers. |
| Availability | `GET /partner/availability` | Return an array of windows with offset-aware `start` and `end`. The operator can select an interval inside a window. A lookup does not reserve time. |
| Job creation | `POST /partner/jobs` | Return a job record containing both IDs and status `received`. Repeated creation for the same case returns the existing record. |
| Job lookup | `GET /partner/jobs` | Return the provider’s job records. Find the relevant record by its job ID. |
| Acceptance or rejection | `POST /partner/jobs/{job_id}/accept` or `/reject` | Accept a specific slot or decline with a reason. Each suffix is relative to the same job URL. |
| Fulfilment | `POST /partner/jobs/{job_id}/start`, then `/complete` | Start the visit, then return the service report and invoice. Successful actions return the updated job. |

## One repair from request to invoice

IDs below illustrate one repair. Use the IDs returned by your running system.

**1. Authorize and dispatch.** DORA creates the Centrix case through `POST /api/cases`. For this example the tenant gives their availability directly. DORA sends this body to `POST /api/cases/{case_id}/availability` before calling `POST /api/cases/{case_id}/dispatch`.

```json
{
  "available_slots": [{"start":"2026-11-23T15:00:00+01:00","end":"2026-11-23T16:00:00+01:00"}],
  "booking_authorized": true,
  "data_sharing_consent": true
}
```

**2. Receive the work order.** The following is the provider’s `POST /partner/jobs` request shape. Local dispatch invokes the same job-creation logic in-process and saves the returned job ID on the case. The provider receives the address, unit, issue, authorized windows and case reference. Calendar contents, owner documents and other residents’ records stay outside the handoff.

```json
{
  "case_id": "CASE-1A2B3C4D",
  "service_type": "heating_repair",
  "location": "Musterstrasse 12, Düsseldorf, Germany, UNIT-102",
  "description": "Cold radiator in Unit 102",
  "available_slots": [{"start":"2026-11-23T15:00:00+01:00","end":"2026-11-23T16:00:00+01:00"}]
}
```

For example, the returned job has `partner_job_id` equal to `JOB-AB12CD34`, the same `case_id`, and status `received`. The case is `awaiting_partner` and its appointment is empty.

**3. Accept the visit.** The provider offers 14:00–17:00 on 23 November. The resident authorized 15:00–16:00. Send the following to `POST /partner/jobs/{job_id}/accept`. Only a successful acceptance changes the case to `scheduled`.

```json
{"slot":{"start":"2026-11-23T15:00:00+01:00","end":"2026-11-23T16:00:00+01:00"}}
```

In the single-technician implementation, acceptance reserves just that interval. Subsequent availability includes 14:00–15:00 and 16:00–17:00. A competing acceptance for 15:30–16:30 returns `409`. If the contractor declines before accepting, send a body such as `{"reason":"Technician unavailable"}` to the rejection endpoint. The job becomes `rejected` and the case becomes `needs_attention`.

**4. Finish the repair.** Call `POST /partner/jobs/{job_id}/start` with no body. After the technician finishes, send this body to `POST /partner/jobs/{job_id}/complete`.

```json
{
  "service_report": {"summary":"Heating restored","work_done":"Freed the radiator valve and verified heat in Unit 102."},
  "invoice": {"invoice_id":"INV-001","amount_eur":125.0,"currency":"EUR","recipient":"property_owner"}
}
```

Read `GET /api/cases/{case_id}` to verify the outcome. The case and job should both be `completed` and carry the same report and invoice. The invoice is a record for the manager. Payment processing is outside the demo.

## Returning events to Centrix

The local SHK service calls `emit_partner_event` in-process. A separate adapter can call the implemented `POST /internal/partner-events` receiver with the server-side `X-DORA-Token` header matching `DORA_INTERNAL_TOKEN`. The receiver updates the Centrix case and returns it. The adapter remains responsible for its own job record.

| Event type | Payload | Resulting Centrix state |
|---|---|---|
| `partner.accepted` | The acceptance body from step 3 | `scheduled` |
| `partner.started` | `{}` | `in_progress` |
| `partner.completed` | The completion body from step 4 | `completed` |
| `partner.rejected` | `{"reason":"Technician unavailable"}` | `needs_attention` |

Example callback for the start of the same repair:

```json
{
  "event_id":"JOB-AB12CD34:partner.started",
  "type":"partner.started",
  "case_id":"CASE-1A2B3C4D",
  "partner_job_id":"JOB-AB12CD34",
  "payload":{}
}
```

Use the same `<partner_job_id>:<event_type>` on every delivery of one event. If the response is lost, retry the callback with the same ID and payload. A processed ID returns the current case. If a provider action times out, check the job record first. Repeating completion returns the original result and invoice. Repeating acceptance after success returns a state conflict.

| Response | How the caller should handle it |
|---|---|
| `400` | Correct the callback payload, for example a malformed accepted slot or missing completion report. |
| `403` | Check the internal callback token and server configuration. Keep the token out of browsers and job payloads. |
| `404` | Check the case or job ID against the original dispatch. |
| `409` | Read the job and case again. For a slot conflict, refresh provider availability and respect the tenant’s authorized window. |
| `422` | Correct the request shape. Slots need a timezone offset and an end after the start. |

## Adding a second partner

For a move-out cleaner, for example, define the cleaning service and eligible properties, map the provider’s job reference to `partner_job_id`, and translate its booking, start, rejection and completion signals into the four events above. Use its completion report and invoice to close the same Centrix case. Supporting that service would require extending the demo’s heating-only service catalogue and request model. The lifecycle and event envelope can be reused.

**Delivery status.** The mock job lifecycle and token-authenticated receiver are implemented. Single-technician reservations and stored, nonblank rejection reasons are implemented on the Person 4 working branch; verify their inclusion in the submitted build. The mock partner routes are intended for local use. When N8N_WEBHOOK_URL is configured, dispatch posts the work order to the n8n webhook. Otherwise it calls the mock provider locally. External provider authentication, network delivery retries and live calendar matching remain integration work.
