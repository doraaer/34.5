# DORA — Team 34.5 | MAIN AI Hackathon

**DORA** is a voice-first maintenance coordination assistant for Reltix's *centrix* ecosystem. Our chosen single end-to-end scenario is a tenant reporting heating trouble in a centrally heated German apartment building. DORA collects only missing context, books the building's contracted SHK partner, follows a real partner status, and writes a service report and invoice back to the mock centrix case.

> **Hackathon objective:** Detect the moment → hand over centrix context → hold the conversation → close the loop. Do one working flow deeply, not many unfinished flows.

## The one demo we must finish
1. Resident opens `/tenant` and speaks to DORA (ElevenLabs voice widget; text-based fallback during development).
2. DORA loads mocked tenant, unit and property context; asks short follow-up questions.
3. The resident permits booking within proposed availability windows.
4. A case is saved; DORA sends the heating work order to our **mock SHK partner** using the defined connector contract.
5. Provider receives a job at `/partner`, accepts an available slot and performs/completes the repair.
6. DORA never claims confirmation before the partner accepts. Tenant sees the confirmed slot and case progress.
7. `/centrix` shows the same completed case, provider service report and invoice linked to the property/unit.

We do **not** diagnose exact boiler faults. Provider handles technical diagnosis. Central heating is property context, not a complex heating simulator. Standard work is pre-authorized in this demo. Actual contractors and real centrix are NOT connected.

## Required outputs
- Working end-to-end demonstration from reported problem to partner-completed job and linked invoice
- Generic **Partner Connector Specification**: services, eligibility, availability, job creation, acceptance, state updates, completed report / invoice, auth and errors
- Hackathon submission code, pitch video and connector specification (GitHub URL if requested)

## Stack
| Layer | Choice | Why |
|---|---|---|
| Web | HTML, CSS, vanilla JS | One simple website with three routes |
| API | Python 3.11+, FastAPI, Pydantic | Python-first; JSON tools for voice |
| Persistence | SQLite | One source of truth for case/job state |
| Voice | ElevenLabs conversational agent | Embedded speech; real session planned |
| Intelligence | OpenAI model configured for DORA | Intent, follow-up questions, tool calls; no invented facts |
| Workflow | n8n | Partner dispatch/orchestration adapter, integration milestone |
| Partner | Mock SHK API + lightweight dashboard | Simulates contractor receiving and completing work |
| Collaboration | GitHub feature branches + pull requests | Separated ownership and review |

**Important:** The scaffold starts in a local/mock mode. Voice, n8n and public deployment require configuration and integration work; do not claim they already run end-to-end.

## Repository map
```
README.md                     Project introduction and operating instructions
AGENTS.md                     Rules for humans and coding agents
docs/PLAN.md                  Task IDs, owners, acceptance criteria, priorities
docs/architecture.md          System boundaries and demo sequence
docs/demo-script.md           Judge-facing demonstration script
docs/connector/partner-connector.md  Deliverable connector specification
contracts/api-contract.md     Single source for HTTP endpoint schemas
contracts/event-types.md      Valid event and state transitions
contracts/maintenance-case.schema.json  Example case JSON shape
agent/                        PERSON 2: ElevenLabs prompts and tools
frontend/templates/           PERSON 1: tenant, partner, centrix pages
frontend/static/              PERSON 1: styling and browser JS
backend/core/                 PERSON 3: cases, persistence and orchestration
backend/routes/               PERSON 3: case and agent API routers
backend/partner/              PERSON 4: partner API and lifecycle
data/fixtures/                PERSON 4: mock building, tenant and SHK data
workflows/n8n/                PERSON 3: workflow documentation and export
tests/                        Owner-scoped tests plus integrated happy path
```

## Getting started (Windows PowerShell)
```powershell
git clone https://github.com/doraaer/34.5.git
cd 34.5
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn backend.main:app --reload
```
Open `http://127.0.0.1:8000/tenant`, `/partner`, `/centrix`, and API documentation at `/docs`. Run tests: `python -m pytest -q`.

## Development rules
- Never commit secrets or private personal data. `.env`, local SQLite files, virtualenvs and caches must be gitignored.
- Person 1 owns `frontend/**`. Person 2 owns `agent/**`. Person 3 owns `backend/core/**`, `backend/routes/**`, `workflows/**` and integration. Person 4 owns `backend/partner/**`, `data/fixtures/**`, `docs/connector/**`.
- Shared files (`contracts/**`, `backend/main.py`, dependency files) are changed only through reviewed coordination.
- No duplicate state engines in frontend, ElevenLabs and n8n. Backend database is authoritative; UI merely displays state.
- Do not infer partner availability from the LLM. Use partner contract responses; never report `scheduled` until acceptance/booking succeeds.
- A case closes **only after** technician completion and result/invoice record. Booking alone is not an outcome.
- Clearly label demo data and mock integrations. Do not represent mock SHK as a real business API.
- For change requests affecting API contracts: update contract first with team approval, then dependent implementations.

## Branches
```
feature/frontend
feature/voice-agent
feature/backend-n8n
feature/partner-connector
```
Each branch is created from the common scaffold commit on `main`. Work on owned paths. Open small PRs and merge early (don't leave everything until final hour). See `docs/PLAN.md`.

## Security and realism
- Resident authorization required before calendar access and booking.
- Only the minimum required tenant/address/access context goes to provider.
- Agent tools and partner callbacks should be authenticated before public deployment.
- Mock data and demo availability are seeded; don't assert live contractor bookings.
- Emergency hazard cues are out of the pitch scope; normal scheduling must not continue during direct safety risk.

## Success definition
From a fresh voice or API intake: one `case_id` persists through reported → awaiting_partner → scheduled → in_progress → completed; the provider accepts and completes it; Centrix displays the final report and invoice. **Do this before polishing optional features.**

See [Team work plan](docs/PLAN.md) · [Architecture](docs/architecture.md) · [API contract](contracts/api-contract.md) · [Connector specification](docs/connector/partner-connector.md).
