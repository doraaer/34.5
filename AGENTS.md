# AGENTS.md — Instructions for every coding agent

Project: DORA, Team 34.5, Reltix track. Read README.md, docs/PLAN.md, contracts/api-contract.md, docs/architecture.md before any edits.

## Mission
One credible finished heating-repair workflow: tenant → DORA voice → stored case → mock SHK partner receives job → partner confirms slot → technician completes → report/invoice linked back to mock centrix. No actual Reltix API or third-party partner integration exists.

## Assigned ownership / strict working directories
- PERSON 1 / frontend: `frontend/**` exclusively.
- PERSON 2 / voice: `agent/**` exclusively.
- PERSON 3 / backend: `backend/core/**`, `backend/routes/**`, `workflows/n8n/**`, `tests/core/**`, `tests/integration/**`.
- PERSON 4 / partner: `backend/partner/**`, `data/fixtures/**`, `docs/connector/**`, `tests/partner/**`.
- Shared/frozen: `contracts/**`, `backend/main.py`, `requirements.txt`, `README.md`, `AGENTS.md`, `docs/architecture.md`, `.env.example`. Coordinate before editing.
Never casually edit another owner's folder. If blocked, document the API issue, provide expected payloads and ask the owner.

## Task execution protocol
1. Determine your PERSON number and branch. If unspecified, ask who assigned the task rather than editing random modules.
2. Read your task IDs and acceptance criteria in docs/PLAN.md.
3. Check contracts/api-contract.md and contracts/event-types.md.
4. Implement smallest isolated increment. Add tests or manual verification steps relevant to your module.
5. Run `python -m pytest -q` when integration is available.
6. Report: task IDs completed, files changed, commands tested, any assumption, integration blockers.
7. Open a pull request; do not force-push main.

## Design invariants
- Backend state is authoritative. n8n orchestrates; it is not a second database.
- A request sent to the contractor is not the same as acceptance. `scheduled` requires explicit accepted slot.
- A case cannot be `completed` until service report and invoice are linked.
- Don't fabricate external API calls, telephone calls, calendar access, confirmation timestamps or repair outcomes.
- Central heating is context; exact fault diagnosis is left to SHK technician.
- Resident conversation should not keep a phone session open awaiting potentially long partner responses. Use stored status / later UI notification.
- Preauthorized standard repair in seeded demo. Real spending rules and invoice allocation are out of scope.
- Ask for consent before sharing personal details/calendar windows with provider. Share least necessary data.
- Safety: direct danger → stop routine booking and direct user to relevant emergency resources; no emergency phone feature in main demo.
- No live credentials in code, fixtures, comments, logs, screenshots or commits.

## Definition of done
Your assigned module works against the published contract, includes error handling and demonstrates at least one successful real interaction. Backend happy path ends with same case_id, provider completion, report, invoice in Centrix.

## No-go scope creep
No mobile native app; no OAuth calendar connection unless whole happy path works; no multi-provider marketplace; no building fault diagnostic engine; no production invoicing/payment; no real outbound calls until MVP stable; no broad preventive workflow before core corrective flow completes.
