# n8n — "DORA – Partner Dispatch" (task B06, PERSON 3)

This n8n workflow delivers a DORA work order to the mock SHK partner API and
returns the partner's job receipt. That is all it does: it stores no state,
it never calls `/internal/partner-events`, and a received job is **not**
an acceptance. The backend stays authoritative.

Export: [`dispatch-job.template.json`](dispatch-job.template.json). I exported
it from a live n8n 2.48.7 instance after the tests below. The only change
after export is the credential id, replaced with `REPLACE_WITH_CREDENTIAL_ID`.
It contains no secrets.

```
POST /webhook/dora-dispatch
  └─ Dispatch Webhook (Header Auth: X-DORA-Token)     wrong/missing → 403
      └─ Validate Work Order (Code)
          └─ Is Valid? ── no ──→ Respond 400 {"error":"missing or invalid field(s): …"}
              └─ yes → POST Partner Job  (POST {DORA_PARTNER_BASE_URL}/partner/jobs, timeout 10 s)
                        ├─ error/timeout/non-2xx ──→ Respond 502 {"error":"partner unavailable"}
                        └─ Is Partner Job? (partner_job_id set, case_id matches)
                              ├─ yes → Respond 200 (partner job JSON, unchanged)
                              └─ no  → Respond 502 {"error":"partner unavailable"}
```

Validation requires non-empty `case_id`, `description` and `location`, plus
at least one slot in `available_slots`, each slot with `start` and `end`.
The body sent to the partner is the same fields minus `idempotency_key`.
Retries are safe because the partner returns the existing job for a repeated
`case_id`, so the workflow adds no storage of its own.

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `N8N_WEBHOOK_URL` | backend | `http://localhost:5678/webhook/dora-dispatch` (production URL, **not** `/webhook-test/`). If unset, the backend uses its in-process partner fallback. |
| `DORA_INTERNAL_TOKEN` | backend | Sent as `X-DORA-Token`. Use the same value in the n8n credential. |
| `DORA_PARTNER_BASE_URL` | n8n | Partner API base URL, default `http://127.0.0.1:8000`. |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | n8n | Lets the HTTP node read `$env.DORA_PARTNER_BASE_URL`. If it is left blocked, the URL falls back to the default. |

## Credential

- Type: **Header Auth** (`httpHeaderAuth`)
- Name: **`DORA Internal Token`**
- Header name: `X-DORA-Token`
- Value: your `DORA_INTERNAL_TOKEN`. Keep it in n8n only, never in this repo.

## Local setup

1. Backend:
   ```bash
   export DORA_INTERNAL_TOKEN=<dev value>
   export N8N_WEBHOOK_URL=http://localhost:5678/webhook/dora-dispatch   # backend dispatch via n8n (needs PR #7)
   uvicorn backend.main:app --host 127.0.0.1 --port 8000
   ```
2. n8n on port 5678. **Node 24 is required**: n8n 2.48 refuses to start on
   Node 22, and its native deps fail to build on Node 26.
   ```bash
   export N8N_BLOCK_ENV_ACCESS_IN_NODE=false DORA_PARTNER_BASE_URL=http://127.0.0.1:8000
   npx n8n            # or: docker run -it --rm -p 5678:5678 -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
                      #       -e DORA_PARTNER_BASE_URL=http://host.docker.internal:8000 docker.n8n.io/n8nio/n8n
   ```
   If `npm` fails building `isolated-vm` with `No module named 'distutils'`,
   set `PYTHON` to a Python that has `setuptools` installed.

## Import and activation

**Editor:** Workflows → Import from file → `dispatch-job.template.json`. Open
*Dispatch Webhook* and select the `DORA Internal Token` credential, then Save
and **Publish/Activate**.

**CLI** (what I used for testing):
```bash
# cred.json (local only, NOT committed):
# [{"id":"doraTokenCred001","name":"DORA Internal Token","type":"httpHeaderAuth",
#   "data":{"name":"X-DORA-Token","value":"<DORA_INTERNAL_TOKEN>"}}]
n8n import:credentials --input=cred.json
sed 's/REPLACE_WITH_CREDENTIAL_ID/doraTokenCred001/' dispatch-job.template.json > /tmp/wf.json
n8n import:workflow --input=/tmp/wf.json
n8n publish:workflow --id=doraDispatch0001     # then (re)start `n8n start`
```
On startup the n8n log shows `Processed ... 1 published workflows`.

## Verified runs (2026-11-20, n8n 2.48.7, Node 24.22.3, backend from `main` @ f6bf988)

`body.json` is the example request from the task:
`{"idempotency_key":"CASE-1A2B3C4D:dispatch:v1","case_id":"CASE-1A2B3C4D","service_type":"heating_repair","description":"Cold radiators","location":"Musterstrasse 12, Düsseldorf, Germany, UNIT-102","available_slots":[{"start":"2026-11-23T14:00:00+01:00","end":"2026-11-23T17:00:00+01:00"}]}`

The token used was a throwaway dev value, `dev-local-token`.

**Success → 200, partner job unchanged**
```console
$ curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:5678/webhook/dora-dispatch \
    -H 'Content-Type: application/json' -H 'X-DORA-Token: dev-local-token' --data-binary @body.json
{"partner_job_id":"JOB-6BE355F8","case_id":"CASE-1A2B3C4D","service_type":"heating_repair","description":"Cold radiators","location":"Musterstrasse 12, Düsseldorf, Germany, UNIT-102","available_slots":[{"start":"2026-11-23T14:00:00+01:00","end":"2026-11-23T17:00:00+01:00"}],"status":"received","slot":null,"service_report":null,"invoice":null}
HTTP 200
```
Repeating the same request returned the same `JOB-6BE355F8`, and
`GET /partner/jobs` then listed exactly one job:
`[('JOB-6BE355F8', 'CASE-1A2B3C4D', 'received')]`.

**Bad token → 403** (the plain-text body is n8n's own; the result is the same without the header)
```console
$ curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:5678/webhook/dora-dispatch \
    -H 'Content-Type: application/json' -H 'X-DORA-Token: wrong' --data-binary @body.json
Authorization data is wrong!
HTTP 403
```

**Missing field → 400**
```console
$ curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:5678/webhook/dora-dispatch \
    -H 'Content-Type: application/json' -H 'X-DORA-Token: dev-local-token' \
    -d '{"case_id":"CASE-1A2B3C4D","service_type":"heating_repair","location":"Musterstrasse 12","available_slots":[{"start":"2026-11-23T14:00:00+01:00","end":"2026-11-23T17:00:00+01:00"}]}'
{"error":"missing or invalid field(s): description"}
HTTP 400
```
With `"available_slots":[]` the response is
`{"error":"missing or invalid field(s): available_slots"}`, `HTTP 400`.

**Partner down (backend stopped) → 502**
```console
$ curl -s -w "\nHTTP %{http_code}  time %{time_total}s\n" -X POST http://localhost:5678/webhook/dora-dispatch \
    -H 'Content-Type: application/json' -H 'X-DORA-Token: dev-local-token' --data-binary @body.json
{"error":"partner unavailable"}
HTTP 502  time 0.031997s
```
Two further 502 checks:
- **Partner hangs:** a socket on :8000 that accepts and never answers gives
  `{"error":"partner unavailable"}`, `HTTP 502  time 10.034252s`, which
  shows the 10 s timeout.
- **Partner rejects the body:** `service_type: "plumbing"`, which the
  partner answers with 422, also gives `502 {"error":"partner unavailable"}`.

**Full run, backend → n8n → partner.** This used the backend from
`feature/backend-n8n` (PR #7, `send_via_n8n`) with `N8N_WEBHOOK_URL` set.
`POST /api/cases`, then `/availability` (with consent), then
`POST /api/cases/CASE-BDD1AC04/dispatch` returned `HTTP 200`, with
`"status":"awaiting_partner","partner_job_id":"JOB-F74A8B46"`. The backend
log shows the n8n call to `POST /partner/jobs 200`. The case is **not**
`scheduled`: acceptance still has to come from the partner.

## Notes and limitations
- The 403 body is n8n's built-in text, not JSON. The backend only checks
  status codes, so this is harmless.
- The workflow never calls `/internal/partner-events`. Acceptance and
  completion events stay with the partner side (PERSON 4).
- A malformed 2xx partner response (no `partner_job_id`, or a mismatched
  `case_id`) is treated as unavailable (502), never as a job.
