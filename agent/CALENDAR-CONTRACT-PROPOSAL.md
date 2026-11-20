# Proposal: calendar-based appointment proposal (for Person 3 / calendar owner to approve)

Status: **PROPOSED by Person 2 (voice).** Not yet in `contracts/api-contract.md`. Once the calendar owner agrees,
copy the endpoint section below into the contract (shared file, coordinate first) and implement it in `backend/`.
The voice side is already built against this shape and falls back gracefully until it exists.

## Endpoint
```
POST /api/cases/{case_id}/calendar-proposal
Body: {}   (optional: {"duration_minutes": 60})
```
Called by DORA only after the tenant said yes to "May I check your calendar?".

### 200 OK
```json
{
  "proposals": [
    { "start": "2026-11-23T15:00:00+01:00", "end": "2026-11-23T16:00:00+01:00" }
  ],
  "source": "google_calendar"
}
```
- Earliest first, at most 3 proposals.
- Every proposal must lie **inside one of the partner windows** (`data/fixtures/partner.json` availability) AND inside the tenant's free time.
  Otherwise the later partner accept is rejected with 409 by `event_update`.
- ISO 8601 with offset, timezone Europe/Berlin.
- `proposals: []` (200) when there is no overlap.

### Errors
| Status | When | DORA does |
|---|---|---|
| 404 | case not found (or endpoint not deployed yet) | falls back to offering partner windows |
| 409 `{"detail":"calendar not connected"}` | tenant has no calendar linked | falls back to offering partner windows |
| 502 | calendar provider failed | says it could not read the calendar, falls back |

### Privacy
- The endpoint returns only free slots, never event titles, attendees or other calendar content.
- Calendar access is read-only free/busy. DORA asks for consent before calling it.

## What happens after
The tenant approves a proposal; DORA calls the existing `POST /api/cases/{case_id}/availability` with exactly that slot,
`booking_authorized: true`, `data_sharing_consent: true`. Dispatch and partner acceptance are unchanged.
No new case fields are required for the voice flow.
